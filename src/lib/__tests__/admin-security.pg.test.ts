import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { assertLocalPg, createUser, uid } from './helpers/pg';
import { prisma } from '../prisma';
import { getSecurityStatus } from '../admin/security-status';

beforeAll(() => assertLocalPg());
afterAll(async () => { vi.unstubAllEnvs(); await prisma.$disconnect(); });

const exec = (sql: string, ...p: unknown[]) => prisma.$executeRawUnsafe(sql, ...p);
const sess = (jti: string, userId: string, tv: number, expr: string) =>
    exec(`INSERT INTO "UserSession" ("jti","userId","tv","mfa","createdAt","expiresAt") VALUES ($1,$2,$3,FALSE,NOW(),${expr})`, jti, userId, tv);

describe('security-status contra Postgres', () => {
    it('admins y MFA: join real con UserMfa, correo sin cuenta y mayusculas/espacios en ADMIN_EMAILS', async () => {
        const a = await createUser(prisma, `${uid('adm')}@pg.test`);
        const b = await createUser(prisma, `${uid('adm')}@pg.test`);
        const ghost = `${uid('ghost')}@pg.test`;
        await exec(`INSERT INTO "UserMfa" ("userId","secretEnc","enabled") VALUES ($1,'enc',TRUE)`, a.id);
        await exec(`INSERT INTO "UserMfa" ("userId","secretEnc","enabled") VALUES ($1,'enc',FALSE)`, b.id); // enrolamiento sin confirmar
        vi.stubEnv('ADMIN_EMAILS', ` ${a.email.toUpperCase()} , ${b.email}, ${ghost}`);
        const s = await getSecurityStatus();
        expect(s.admins).toEqual([
            { email: a.email.toLowerCase(), userId: a.id, mfaEnabled: true },
            { email: b.email.toLowerCase(), userId: b.id, mfaEnabled: false },
            { email: ghost.toLowerCase(), userId: null, mfaEnabled: null },
        ]);
        const codes = Object.fromEntries(s.checks.map((c) => [c.code, c]));
        expect(codes['mfa.admins_missing']).toMatchObject({ status: 'warn', params: { count: 1 } });
        expect(codes['admins.no_account']).toMatchObject({ status: 'info', params: { count: 1 } });
        expect(s.mfaPolicy).toEqual({ enforceAdmin: true, requiredAll: false, available: true });
    });

    it('sin tabla UserMfa: mfa.unavailable y los usuarios siguen listados', async () => {
        const a = await createUser(prisma, `${uid('adm')}@pg.test`);
        vi.stubEnv('ADMIN_EMAILS', a.email);
        await exec('ALTER TABLE "UserMfa" RENAME TO "UserMfa_off"');
        try {
            const s = await getSecurityStatus();
            expect(s.mfaPolicy.available).toBe(false);
            expect(s.admins).toEqual([{ email: a.email.toLowerCase(), userId: a.id, mfaEnabled: null }]);
            expect(s.checks.find((c) => c.code === 'mfa.unavailable')?.status).toBe('info');
        } finally {
            await exec('ALTER TABLE "UserMfa_off" RENAME TO "UserMfa"');
        }
    });

    it('conteos: deshabilitados, cambio de clave pendiente y sesiones activas (definicion completa de "activa")', async () => {
        vi.stubEnv('ADMIN_EMAILS', '');
        const before = (await getSecurityStatus()).counts;
        const u = await createUser(prisma);
        const u2 = await createUser(prisma);
        await exec(`INSERT INTO "UserAdminState" ("userId","disabled","mustChangePassword") VALUES ($1, TRUE, FALSE), ($2, FALSE, TRUE)`, u.id, u2.id);
        await sess(uid('j'), u.id, 0, `NOW() + interval '1 day'`);                 // activa
        await sess(uid('j'), u.id, 0, `NOW() - interval '1 hour'`);                // caducada
        const revoked = uid('j');
        await sess(revoked, u.id, 0, `NOW() + interval '1 day'`);                  // revocada
        await exec(`INSERT INTO "RevokedSession" ("jti","userId","expiresAt") VALUES ($1,$2,NOW() + interval '1 day')`, revoked, u.id);
        await exec(`UPDATE "User" SET "tokenVersion" = 2 WHERE "id" = $1`, u2.id);
        await sess(uid('j'), u2.id, 1, `NOW() + interval '1 day'`);                // tv antigua (cerrada con "cerrar todas")
        await sess(uid('j'), u2.id, 2, `NOW() + interval '1 day'`);                // activa
        const after = (await getSecurityStatus()).counts;
        expect(after.disabledUsers! - before.disabledUsers!).toBe(1);
        expect(after.mustChangePassword! - before.mustChangePassword!).toBe(1);
        expect(after.activeSessions! - before.activeSessions!).toBe(2);
    });

    it('conteos nulos si faltan las tablas aditivas', async () => {
        await exec('ALTER TABLE "UserAdminState" RENAME TO "UserAdminState_off"');
        await exec('ALTER TABLE "UserSession" RENAME TO "UserSession_off"');
        try {
            const s = await getSecurityStatus();
            expect(s.counts).toEqual({ disabledUsers: null, mustChangePassword: null, activeSessions: null });
        } finally {
            await exec('ALTER TABLE "UserAdminState_off" RENAME TO "UserAdminState"');
            await exec('ALTER TABLE "UserSession_off" RENAME TO "UserSession"');
        }
    });

    it('eventos de seguridad: conteos 24h/7d, ultimos 10 enmascarados y avisos por umbral', async () => {
        const before = await getSecurityStatus();
        const marker = uid('u');
        const ins = (event: string, ago: string, ip: string | null, data: Record<string, unknown>) =>
            exec(`INSERT INTO "AuditEvent" ("id","ts","event","userId","ip","data") VALUES ($1, NOW() - interval '${ago}', $2, $3, $4, $5::jsonb)`, uid('ev'), event, marker, ip, JSON.stringify(data));
        for (let i = 0; i < 21; i++) await ins('auth.login.failure', '2 hours', '203.0.113.77', { email: 'victim@example.com', reason: 'bad_password' });
        await ins('auth.login.failure', '3 days', null, {});                      // fuera de 24 h, dentro de 7 d
        await ins('auth.login.failure', '9 days', null, {});                      // fuera de 7 d
        await ins('auth.mfa.recovery_used', '1 hour', '2001:db8:abcd::1', {});
        await ins('otro.evento', '1 hour', null, {});                              // no es de seguridad
        const s = await getSecurityStatus();
        expect(s.events.available).toBe(true);
        expect(s.events.last24h['auth.login.failure'] - before.events.last24h['auth.login.failure']).toBe(21);
        expect(s.events.last7d['auth.login.failure'] - before.events.last7d['auth.login.failure']).toBe(22);
        expect(s.events.last24h['auth.mfa.recovery_used'] - before.events.last24h['auth.mfa.recovery_used']).toBe(1);
        expect(Object.keys(s.events.last7d).sort()).toEqual([
            'admin.access_denied', 'auth.login.failure', 'auth.login.locked', 'auth.login.rate_limited', 'auth.mfa.recovery_used', 'auth.mfa.verify_failed',
        ]);
        expect(s.events.recent.length).toBeLessThanOrEqual(10);
        expect(s.events.recent.every((r) => r.event !== 'otro.evento')).toBe(true);
        const text = JSON.stringify(s.events.recent);
        expect(text).not.toContain('203.0.113.77');
        expect(text).not.toContain('2001:db8:abcd::1');
        expect(text).not.toContain('victim@example.com');
        expect(s.checks.find((c) => c.code === 'events.login_failures_high')?.status).toBe('warn');
    });

    it('sin tabla AuditEvent: eventos no disponibles sin romper el resto', async () => {
        await exec('ALTER TABLE "AuditEvent" RENAME TO "AuditEvent_off"');
        try {
            const s = await getSecurityStatus();
            expect(s.events).toEqual({ available: false, last24h: {}, last7d: {}, recent: [] });
            expect(s.checks.find((c) => c.code === 'events.unavailable')?.status).toBe('info');
        } finally {
            await exec('ALTER TABLE "AuditEvent_off" RENAME TO "AuditEvent"');
        }
    });

    it('nunca devuelve valores de secretos aunque esten definidos en el entorno', async () => {
        const secrets = ['NEXTAUTH_SECRET', 'DATA_ENCRYPTION_KEY', 'CRON_SECRET', 'WEBHOOK_SECRET', 'INTERNAL_SECRET'];
        for (const k of secrets) vi.stubEnv(k, `VALOR-SECRETO-${k}-0123456789abcdef0123456789abcdef`);
        const text = JSON.stringify(await getSecurityStatus());
        expect(text).not.toContain('VALOR-SECRETO');
    });
});
