import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { assertLocalPg, createEmail, createUser, uid } from './helpers/pg';
import { prisma } from '../prisma';

vi.mock('../storage', () => ({
    deleteManyFromStorage: vi.fn(async () => ({ deleted: 0, failed: [] })),
    listStorageObjects: vi.fn(async () => []),
    deleteStoragePrefix: vi.fn(async () => ({ deleted: 0, failed: [] })),
}));

import { getEffectiveRetentionConfig, getRetentionConfig, loadRetentionOverrides, runRetention } from '../retention';
import { getRetentionSettings, getStorageOverview, saveRetentionSettings } from '../admin/retention-settings';
import { __setAuditSink } from '../audit';

beforeAll(() => { assertLocalPg(); vi.spyOn(console, 'log').mockImplementation(() => undefined); });
beforeEach(async () => {
    __setAuditSink(async () => undefined);
    await prisma.$executeRawUnsafe(`DELETE FROM "AdminSetting" WHERE "key" = 'retention'`);
    vi.stubEnv('RETENTION_SPAM_DAYS', '30');
    vi.stubEnv('RETENTION_TRASH_DAYS', '0');
    vi.stubEnv('RETENTION_RAW_DAYS', '0');
    vi.stubEnv('AUDIT_RETENTION_DAYS', '365');
    vi.stubEnv('SECURE_MESSAGE_TTL_DAYS', '30');
    vi.stubEnv('RETENTION_BATCH', '200');
});
afterAll(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM "AdminSetting" WHERE "key" = 'retention'`);
    vi.unstubAllEnvs();
    __setAuditSink(null);
    await prisma.$disconnect();
});

const setRow = (value: unknown) =>
    prisma.$executeRawUnsafe(`INSERT INTO "AdminSetting" ("key","value","updatedBy") VALUES ('retention', $1::jsonb, 'test') ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value"`, JSON.stringify(value));

describe('getEffectiveRetentionConfig contra Postgres', () => {
    it('sin fila: igual al entorno (y getRetentionConfig sincrona sigue igual)', async () => {
        expect(await getEffectiveRetentionConfig()).toEqual(getRetentionConfig());
        expect(getRetentionConfig().spamDays).toBe(30);
    });

    it('el override valido se superpone al entorno clave a clave', async () => {
        await setRow({ spamDays: 7, batch: 50, auditDays: 0 });
        expect(await getEffectiveRetentionConfig()).toEqual({ ...getRetentionConfig(), spamDays: 7, batch: 50, auditDays: 0 });
    });

    it('valores invalidos o claves desconocidas en la BD se ignoran (nunca rompen la purga)', async () => {
        await setRow({ spamDays: -5, trashDays: 99999, rawDays: 'x', auditDays: 10, batch: 0, secureMessageDays: 3.5, hack: 1, trashDays2: 2 });
        expect(await getEffectiveRetentionConfig()).toEqual(getRetentionConfig());
        await setRow('texto');
        expect(await getEffectiveRetentionConfig()).toEqual(getRetentionConfig());
        await setRow({ auditDays: 30, batch: 1000, spamDays: 3650 });
        expect(await getEffectiveRetentionConfig()).toMatchObject({ auditDays: 30, batch: 1000, spamDays: 3650 });
    });

    it('tabla AdminSetting ausente: usa el entorno sin fallar', async () => {
        await prisma.$executeRawUnsafe('ALTER TABLE "AdminSetting" RENAME TO "AdminSetting_off"');
        try {
            expect(await getEffectiveRetentionConfig()).toEqual(getRetentionConfig());
            expect(await loadRetentionOverrides()).toEqual({ overrides: {}, updatedAt: null, updatedBy: null });
        } finally {
            await prisma.$executeRawUnsafe('ALTER TABLE "AdminSetting_off" RENAME TO "AdminSetting"');
        }
    });
});

describe('saveRetentionSettings / getRetentionSettings', () => {
    it('upsert, fusion por clave, null = volver a entorno y fila borrada al quedar vacia', async () => {
        let v = await saveRetentionSettings({ spamDays: 10, trashDays: 20 }, 'admin@x.test');
        expect(v.overrides).toEqual({ spamDays: 10, trashDays: 20 });
        expect(v.effective).toMatchObject({ spamDays: 10, trashDays: 20, rawDays: 0 });
        expect(v.updatedBy).toBe('a***@x.test');
        expect(v.updatedAt).toEqual(expect.any(String));

        v = await saveRetentionSettings({ spamDays: null, batch: 10 }, 'admin@x.test');
        expect(v.overrides).toEqual({ trashDays: 20, batch: 10 });
        expect(v.env.spamDays).toBe(30);
        expect(v.effective.spamDays).toBe(30);

        v = await saveRetentionSettings({ trashDays: null, batch: null }, 'admin@x.test');
        expect(v.overrides).toEqual({});
        const rows = await prisma.$queryRaw<any[]>`SELECT 1 FROM "AdminSetting" WHERE "key" = 'retention'`;
        expect(rows).toHaveLength(0);
        expect((await getRetentionSettings()).updatedAt).toBeNull();
    });

    it('sin tabla: 503 settings_unavailable', async () => {
        await prisma.$executeRawUnsafe('ALTER TABLE "AdminSetting" RENAME TO "AdminSetting_off"');
        try {
            await expect(saveRetentionSettings({ spamDays: 5 }, 'a@x.test')).rejects.toMatchObject({ status: 503, code: 'settings_unavailable' });
        } finally {
            await prisma.$executeRawUnsafe('ALTER TABLE "AdminSetting_off" RENAME TO "AdminSetting"');
        }
    });
});

describe('runRetention: politica editable y purga de UserSession', () => {
    it('usa la politica de la BD (spam 0 = desactivado) y purga UserSession caducadas hace >1 dia', async () => {
        const u = await createUser(prisma);
        const old = new Date(Date.now() - 45 * 24 * 3600_000);
        const spam = await createEmail(prisma, u.id, { folder: 'spam', createdAt: old });
        const ins = (jti: string, expr: string) => prisma.$executeRawUnsafe(
            `INSERT INTO "UserSession" ("jti","userId","tv","mfa","createdAt","expiresAt") VALUES ($1, $2, 0, FALSE, NOW() - interval '10 days', ${expr})`, jti, u.id);
        const oldJti = uid('jti'); const recentJti = uid('jti'); const activeJti = uid('jti');
        await ins(oldJti, `NOW() - interval '3 days'`);
        await ins(recentJti, `NOW() - interval '1 hour'`);
        await ins(activeJti, `NOW() + interval '1 day'`);

        // Politica de la consola: spam desactivado
        await setRow({ spamDays: 0 });
        const dry = await runRetention({ dryRun: true, quiet: true });
        expect(dry.spamEmails).toBe(0);
        expect(dry.sessionRowsPurged).toBeGreaterThanOrEqual(1);
        expect(await prisma.$queryRaw<any[]>`SELECT 1 FROM "UserSession" WHERE "jti" = ${oldJti}`).toHaveLength(1); // simulacion: no borra

        const real = await runRetention();
        expect(real.spamEmails).toBe(0);
        expect(await prisma.email.count({ where: { id: spam.id } })).toBe(1);
        expect(real.sessionRowsPurged).toBeGreaterThanOrEqual(1);
        const left = await prisma.$queryRaw<any[]>`SELECT "jti" FROM "UserSession" WHERE "jti" IN (${oldJti}, ${recentJti}, ${activeJti})`;
        expect(left.map((r) => r.jti).sort()).toEqual([recentJti, activeJti].sort());

        // Sin override (entorno: spam 30 dias) el spam antiguo SI se purga
        await prisma.$executeRawUnsafe(`DELETE FROM "AdminSetting" WHERE "key" = 'retention'`);
        const r2 = await runRetention();
        expect(r2.spamEmails).toBeGreaterThanOrEqual(1);
        expect(await prisma.email.count({ where: { id: spam.id } })).toBe(0);
    });

    it('sin tabla UserSession no falla y sessionRowsPurged es 0', async () => {
        await prisma.$executeRawUnsafe('ALTER TABLE "UserSession" RENAME TO "UserSession_off"');
        try {
            const r = await runRetention({ dryRun: true, quiet: true });
            expect(r.sessionRowsPurged).toBe(0);
        } finally {
            await prisma.$executeRawUnsafe('ALTER TABLE "UserSession_off" RENAME TO "UserSession"');
        }
    });
});

describe('getStorageOverview contra Postgres', () => {
    it('agregados de adjuntos, carpetas y top de usuarios, sin claves ni contenido', async () => {
        const u = await createUser(prisma);
        const e = await createEmail(prisma, u.id, {
            folder: 'inbox', subject: 'ASUNTO-SECRETO-XYZ',
            attachments: { create: [
                { filename: 'a.pdf', mimeType: 'application/pdf', size: 900_000_000, key: `emails/2030-01-01/${uid('d')}/attachments/a.pdf` },
                { filename: 'p', mimeType: 'x/y', size: 1_000_000_000, key: 'PENDING' },
            ] },
        });
        expect(e.id).toBeTruthy();
        const o = await getStorageOverview();
        expect(o.attachments!.bytes).toBeGreaterThanOrEqual(900_000_000);
        expect(o.attachments!.count).toBeGreaterThanOrEqual(1);
        expect(o.emailsByFolder!.find((f) => f.folder === 'inbox')!.count).toBeGreaterThanOrEqual(1);
        expect(o.topUsers!.length).toBeLessThanOrEqual(10);
        const me = o.topUsers!.find((t) => t.userId === u.id)!;
        expect(me).toEqual({ userId: u.id, email: u.email, bytes: 900_000_000, attachments: 1 }); // PENDING no cuenta
        expect(o.topUsers![0].bytes).toBeGreaterThanOrEqual(o.topUsers![o.topUsers!.length - 1].bytes);
        expect(o.tables.auditEvents).toEqual(expect.any(Number));
        expect(o.tables.userSessions).toEqual(expect.any(Number));
        expect(o.wouldDelete).toMatchObject({ dryRun: true });
        expect(o.policy).toEqual(getRetentionConfig());
        const text = JSON.stringify(o);
        expect(text).not.toContain('ASUNTO-SECRETO-XYZ');
        expect(text).not.toContain('attachments/a.pdf');
        expect(text).not.toContain('emails/2030');
    });

    it('tablas ausentes => null en cada agregado', async () => {
        await prisma.$executeRawUnsafe('ALTER TABLE "RevokedSession" RENAME TO "RevokedSession_off"');
        await prisma.$executeRawUnsafe('ALTER TABLE "UserSession" RENAME TO "UserSession_off"');
        try {
            const o = await getStorageOverview();
            expect(o.tables.revokedSessions).toBeNull();
            expect(o.tables.userSessions).toBeNull();
            expect(o.attachments).not.toBeNull();
        } finally {
            await prisma.$executeRawUnsafe('ALTER TABLE "RevokedSession_off" RENAME TO "RevokedSession"');
            await prisma.$executeRawUnsafe('ALTER TABLE "UserSession_off" RENAME TO "UserSession"');
        }
    });
});
