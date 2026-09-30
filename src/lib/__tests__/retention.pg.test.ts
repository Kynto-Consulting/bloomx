import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { assertLocalPg, createUser, createEmail, uid } from './helpers/pg';
import { prisma } from '../prisma';

// Almacenamiento simulado en memoria (S3/B2 no se puede probar aqui): claves => contenido.
const store = new Map<string, { lastModified: Date }>();
let failKeys = new Set<string>();
vi.mock('../storage', () => ({
    deleteManyFromStorage: vi.fn(async (keys: string[]) => {
        let deleted = 0;
        const failed: string[] = [];
        for (const k of new Set(keys)) {
            if (failKeys.has(k)) { failed.push(k); continue; }
            if (store.delete(k)) deleted++;
        }
        return { deleted, failed };
    }),
    listStorageObjects: vi.fn(async (prefix: string) => [...store.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, lastModified: v.lastModified }))),
    deleteStoragePrefix: vi.fn(async (prefix: string) => {
        const keys = [...store.keys()].filter((k) => k.startsWith(prefix.endsWith('/') ? prefix : prefix + '/'));
        keys.forEach((k) => store.delete(k));
        return { deleted: keys.length, failed: [] };
    }),
}));

import { deleteEmailsCompletely, runRetention } from '../retention';
import { __setAuditSink } from '../audit';
import { revokeSession } from '../session-revocation';

beforeAll(() => { assertLocalPg(); vi.spyOn(console, 'log').mockImplementation(() => undefined); });
beforeEach(() => { store.clear(); failKeys = new Set(); __setAuditSink(async () => undefined); });
afterAll(async () => { __setAuditSink(null); await prisma.$disconnect(); });

const put = (...keys: string[]) => keys.forEach((k) => store.set(k, { lastModified: new Date() }));

describe('deleteEmailsCompletely contra Postgres + almacenamiento simulado', () => {
    it('borra filas, adjuntos, objetos y el prefijo; EmailEvent queda huerfano (SET NULL) y RuleRun cae', async () => {
        const u = await createUser(prisma);
        const p = `emails/2030-01-01/${uid('dir')}`;
        put(`${p}/content.html`, `${p}/content.txt`, `${p}/raw.json`, `${p}/attachments/a.pdf`, `${p}/attachments/huerfano.bin`);
        const e = await createEmail(prisma, u.id, {
            htmlKey: `${p}/content.html`, textKey: `${p}/content.txt`, rawKey: `${p}/raw.json`,
            attachments: { create: [{ filename: 'a.pdf', mimeType: 'application/pdf', size: 1, key: `${p}/attachments/a.pdf` }, { filename: 'p', mimeType: 'x/y', size: 0, key: 'PENDING' }] },
        });
        await prisma.emailEvent.create({ data: { emailId: e.id, type: 'email.delivered' } });
        await prisma.$executeRaw`INSERT INTO "RuleRun" ("emailId","userId") VALUES (${e.id}, ${u.id})`;

        const r = await deleteEmailsCompletely([e.id, e.id, '']);
        expect(r).toMatchObject({ deleted: 1, storageFailed: [], storageKept: 0 });
        expect(store.size).toBe(0); // incluye el adjunto huerfano por barrido de prefijo
        expect(await prisma.email.count({ where: { id: e.id } })).toBe(0);
        expect(await prisma.attachment.count({ where: { emailId: e.id } })).toBe(0);
        expect(await prisma.$queryRaw`SELECT 1 FROM "RuleRun" WHERE "emailId" = ${e.id}`).toHaveLength(0);
        const ev = await prisma.emailEvent.findMany({ where: { type: 'email.delivered', emailId: null } });
        expect(ev.length).toBeGreaterThanOrEqual(1);
    });

    it('reference counting: correo multi-destinatario comparte objetos; solo se borran al eliminar la ultima fila', async () => {
        const a = await createUser(prisma);
        const b = await createUser(prisma);
        const p = `emails/2030-01-02/${uid('dir')}`;
        put(`${p}/content.html`, `${p}/raw.json`, `${p}/attachments/x.png`);
        const mk = (userId: string) => createEmail(prisma, userId, {
            htmlKey: `${p}/content.html`, rawKey: `${p}/raw.json`,
            attachments: { create: [{ filename: 'x.png', mimeType: 'image/png', size: 1, key: `${p}/attachments/x.png` }] },
        });
        const ea = await mk(a.id);
        const eb = await mk(b.id);

        const r1 = await deleteEmailsCompletely([ea.id]);
        expect(r1.deleted).toBe(1);
        expect(r1.storageKept).toBe(3);
        expect(store.size).toBe(3);
        expect(await prisma.email.count({ where: { id: eb.id } })).toBe(1);
        expect(await prisma.attachment.count({ where: { emailId: eb.id } })).toBe(1);

        const r2 = await deleteEmailsCompletely([eb.id]);
        expect(r2.deleted).toBe(1);
        expect(store.size).toBe(0);
    });

    it('fallos de almacenamiento se reportan pero las filas se eliminan igualmente', async () => {
        const u = await createUser(prisma);
        const p = `emails/2030-01-03/${uid('dir')}`;
        put(`${p}/content.html`, `${p}/raw.json`);
        failKeys.add(`${p}/raw.json`);
        const e = await createEmail(prisma, u.id, { htmlKey: `${p}/content.html`, rawKey: `${p}/raw.json` });
        const r = await deleteEmailsCompletely([e.id]);
        expect(r.deleted).toBe(1);
        expect(r.storageFailed).toContain(`${p}/raw.json`);
    });

    it('ids inexistentes o vacios => resultado vacio', async () => {
        expect(await deleteEmailsCompletely([])).toMatchObject({ deleted: 0 });
        expect(await deleteEmailsCompletely([uid('no')])).toMatchObject({ deleted: 0 });
    });
});

describe('runRetention contra Postgres', () => {
    it('purga spam antiguo, respeta lotes/dryRun, purga AuditEvent y revocaciones caducadas', async () => {
        vi.stubEnv('RETENTION_SPAM_DAYS', '30');
        vi.stubEnv('RETENTION_TRASH_DAYS', '0');
        vi.stubEnv('AUDIT_RETENTION_DAYS', '10');
        vi.stubEnv('SECURE_MESSAGE_TTL_DAYS', '1');
        vi.stubEnv('RETENTION_BATCH', '200');
        const u = await createUser(prisma);
        const old = new Date(Date.now() - 45 * 24 * 3600_000);
        const oldSpam = await createEmail(prisma, u.id, { folder: 'spam', createdAt: old });
        const freshSpam = await createEmail(prisma, u.id, { folder: 'spam' });
        const oldInbox = await createEmail(prisma, u.id, { folder: 'inbox', createdAt: old });
        await prisma.$executeRaw`INSERT INTO "AuditEvent" ("id","ts","event") VALUES (${uid('a')}, NOW() - interval '20 days', 'old.event')`;
        await prisma.$executeRaw`INSERT INTO "AuditEvent" ("id","ts","event") VALUES (${uid('a')}, NOW(), 'new.event')`;
        await revokeSession(uid('jti'), u.id, Math.floor(Date.now() / 1000) - 60);
        store.set('secure/old-msg', { lastModified: new Date(Date.now() - 5 * 24 * 3600_000) });
        store.set('secure/new-msg', { lastModified: new Date() });

        const dry = await runRetention({ dryRun: true });
        expect(dry).toMatchObject({ dryRun: true, spamEmails: 1, auditEventsPurged: expect.any(Number), secureMessages: 1 });
        expect(dry.auditEventsPurged).toBeGreaterThanOrEqual(1);
        expect(await prisma.email.count({ where: { id: oldSpam.id } })).toBe(1); // dry run: no borra
        expect(store.has('secure/old-msg')).toBe(true);

        const real = await runRetention();
        expect(real.spamEmails).toBeGreaterThanOrEqual(1);
        expect(real.revocationsPurged).toBeGreaterThanOrEqual(1);
        expect(await prisma.email.count({ where: { id: oldSpam.id } })).toBe(0);
        expect(await prisma.email.count({ where: { id: { in: [freshSpam.id, oldInbox.id] } } })).toBe(2);
        expect(store.has('secure/old-msg')).toBe(false);
        expect(store.has('secure/new-msg')).toBe(true);
        const left = await prisma.$queryRaw<any[]>`SELECT "event" FROM "AuditEvent" WHERE "event" IN ('old.event','new.event')`;
        expect(left.map((r) => r.event)).toEqual(['new.event']);
        vi.unstubAllEnvs();
    });
});
