import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLocalPg, createEmail, createUser, uid } from './helpers/pg';
import { prisma } from '../prisma';
import { getOverview } from '../admin/overview-store';
import { execute } from '../admin/sql';

beforeAll(() => assertLocalPg());
afterAll(async () => { await prisma.$disconnect(); });

describe('getOverview contra Postgres real', () => {
    it('cuenta usuarios, altas, activos y deshabilitados (UserAdminState) y solo devuelve agregados', async () => {
        const before = await getOverview();
        const a = await createUser(prisma);
        const b = await createUser(prisma);
        await execute(`INSERT INTO "UserAdminState" ("userId","lastLoginAt") VALUES ($1, NOW())`, a.id);
        await execute(`INSERT INTO "UserAdminState" ("userId","disabled","disabledAt","lastLoginAt") VALUES ($1, TRUE, NOW(), NOW() - INTERVAL '90 days')`, b.id);

        const after = await getOverview();
        expect(after.users.total).toBe(before.users.total + 2);
        expect(after.users.new7d).toBe(before.users.new7d + 2);
        expect(after.users.active30d).toBe(before.users.active30d + 1);
        expect(after.users.disabled).toBe(before.users.disabled + 1);
        expect(after.users.recent.length).toBeLessThanOrEqual(5);
        expect(after.users.recent.map((u) => u.id)).toEqual(expect.arrayContaining([a.id, b.id]));
        expect(JSON.stringify(after)).not.toMatch(/password/i);
    });

    it('correo: enviados/recibidos de 24 h, programados y rebotes/quejas (EmailEvent unsubscribe con reason)', async () => {
        const before = await getOverview();
        const u = await createUser(prisma);
        await createEmail(prisma, u.id, { folder: 'sent', status: 'sent' });
        await createEmail(prisma, u.id, { folder: 'inbox', status: 'received' });
        await createEmail(prisma, u.id, { folder: 'inbox', status: 'received' });
        await createEmail(prisma, u.id, { folder: 'scheduled', status: 'scheduled' });
        // antiguo: no cuenta en 24 h
        await createEmail(prisma, u.id, { folder: 'sent', status: 'sent', createdAt: new Date(Date.now() - 3 * 24 * 3600_000) });
        await prisma.emailEvent.create({ data: { type: 'unsubscribe', data: { sender: u.id, recipient: 'x@ext.test', reason: 'bounce' } } });
        await prisma.emailEvent.create({ data: { type: 'unsubscribe', data: { sender: u.id, recipient: 'y@ext.test', reason: 'complaint' } } });
        await prisma.emailEvent.create({ data: { type: 'unsubscribe', data: { sender: u.id, recipient: 'z@ext.test', reason: 'unsubscribe' } } });

        const after = await getOverview();
        expect(after.mail.sent24h).toBe(before.mail.sent24h + 1);
        expect(after.mail.received24h).toBe(before.mail.received24h + 2);
        expect(after.mail.scheduledPending).toBe(before.mail.scheduledPending + 1);
        expect(after.mail.bounces7d).toBe(before.mail.bounces7d + 1);
        expect(after.mail.complaints7d).toBe(before.mail.complaints7d + 1);
    });

    it('almacenamiento: suma bytes de adjuntos', async () => {
        const before = await getOverview();
        const u = await createUser(prisma);
        const e = await createEmail(prisma, u.id);
        await prisma.attachment.create({ data: { emailId: e.id, filename: 'a.pdf', mimeType: 'application/pdf', size: 1234, key: uid('k') } });
        const after = await getOverview();
        expect(after.storage.attachmentBytes).toBe(before.storage.attachmentBytes + 1234);
        expect(after.storage.attachmentCount).toBe(before.storage.attachmentCount + 1);
        expect(after.storage.emailCount).toBeGreaterThan(before.storage.emailCount);
    });

    it('extensiones con errores: cuenta extensiones distintas con eventos fallidos en 24 h', async () => {
        const before = await getOverview();
        const ext = uid('ext');
        const ins = (event: string, data: object, ago = '0 seconds') =>
            execute(`INSERT INTO "AuditEvent" ("id","ts","event","data") VALUES ($1, NOW() - $2::interval, $3, $4::jsonb)`, uid('ae'), ago, event, JSON.stringify(data));
        await ins('admin.extension.test', { extensionId: ext, outcome: 'failed' });
        await ins('admin.extension.test', { extensionId: ext, outcome: 'failed' }); // misma extension: 1
        await ins('admin.extension.credentials', { extensionId: ext + 'b', outcome: 'ok' }); // sin error
        await ins('admin.extension.test', { extensionId: ext + 'c', outcome: 'failed' }, '3 days'); // antiguo
        const after = await getOverview();
        expect(after.extensions.errors24h).toBe(before.extensions.errors24h + 1);
    });

    it('MFA de administradores: lee ADMIN_EMAILS (en minusculas) y UserMfa.enabled', async () => {
        const withMfa = await createUser(prisma, `${uid('ad')}@pg.test`);
        const without = await createUser(prisma, `${uid('ad')}@pg.test`);
        await execute(`INSERT INTO "UserMfa" ("userId","secretEnc","enabled") VALUES ($1,'x',TRUE)`, withMfa.id);
        const prev = process.env.ADMIN_EMAILS;
        process.env.ADMIN_EMAILS = `${withMfa.email.toUpperCase()}, ${without.email}`;
        try {
            const o = await getOverview();
            expect(o.adminMfa).toMatchObject({ total: 2, withMfa: 1, available: true });
            expect(o.adminMfa.missing).toEqual([without.email]);
        } finally {
            if (prev === undefined) delete process.env.ADMIN_EMAILS; else process.env.ADMIN_EMAILS = prev;
        }
    });

    it('cola de Elixir: campanas en curso y filas pendientes', async () => {
        const before = await getOverview();
        const u = await createUser(prisma);
        const cid = uid('camp');
        await execute(`INSERT INTO "ElixirCampaign" ("id","userId","status","subject","template","total") VALUES ($1,$2,'running','s','t',2)`, cid, u.id);
        await execute(`INSERT INTO "ElixirCampaignRow" ("campaignId","idx","recipient","status") VALUES ($1,0,'a@x.test','pending'),($1,1,'b@x.test','sent')`, cid);
        const after = await getOverview();
        expect(after.elixir.available).toBe(true);
        expect(after.elixir.running).toBe(before.elixir.running + 1);
        expect(after.elixir.pendingRows).toBe(before.elixir.pendingRows + 1);
    });
});
