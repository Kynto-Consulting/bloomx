import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireAdmin = vi.fn();
const rateLimitAsync = vi.fn();
const queryRawUnsafe = vi.fn();
const loadDomainPrivateKey = vi.fn();

vi.mock('@/lib/admin-auth', () => {
    const guardFn = (...a: unknown[]) => requireAdmin(...a);
    // adminRoute usa requireLevel(n): en estas pruebas el nivel no se evalua (lo cubre admin-levels.test / admin-cli.pg.test)
    return { requireAdmin: guardFn, requireLevel: (_min: number, ...a: unknown[]) => (guardFn as (...x: unknown[]) => unknown)(...a) };
});
vi.mock('@/lib/security', () => ({
    auditLog: vi.fn(),
    rateLimitAsync: (...a: unknown[]) => rateLimitAsync(...a),
    getClientIp: () => '9.9.9.9',
}));
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRawUnsafe: (...a: unknown[]) => queryRawUnsafe(...a) } }));
vi.mock('@/lib/backend-auth', () => ({ loadDomainPrivateKey: (...a: unknown[]) => loadDomainPrivateKey(...a) }));

import { GET } from '../status/route';

const okGuard = { ok: true, actor: { kind: 'manager', id: 'm1', email: 'owner@acme.com' } };
const call = () => GET(new NextRequest('http://localhost/api/admin/security/status'));

// Valores de secreto reconocibles: NINGUNO puede aparecer en la respuesta.
const SECRETS: Record<string, string> = {
    NEXTAUTH_SECRET: 'SECRET-nextauth-0123456789abcdefghijklmnopqrstuvwxyz',
    DATA_ENCRYPTION_KEY: 'SECRET-enc-key-aaaaaaaaaaaaaaaaaaaa',
    WEBHOOK_SECRET: 'whsec_SECRETWEBHOOK1234',
    RESEND_WEBHOOK_SECRET: 'whsec_SECRETRESEND5678',
    INTERNAL_SECRET: 'SECRET-internal-9999',
    CRON_SECRET: 'SECRET-cron-7777',
    UPSTASH_REDIS_REST_URL: 'https://redis-secret-host.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'SECRET-redis-token-4242',
    BLOOMX_DOMAIN_PRIVATE_KEY: 'SECRET-private-key-pem',
    MFA_RECOVERY_PEPPER: 'SECRET-pepper',
};

interface Db { adminRows?: unknown[]; mfaMissing?: boolean; counts?: unknown[]; recent?: unknown[]; auditMissing?: boolean }
function installDb(db: Db = {}) {
    queryRawUnsafe.mockImplementation(async (sql: string) => {
        const missing = () => Promise.reject(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
        if (sql.includes('"UserMfa"')) return db.mfaMissing ? missing() : (db.adminRows ?? []);
        if (sql.includes('FROM "User" u WHERE LOWER')) return (db.adminRows ?? []).map((r: any) => ({ id: r.id, email: r.email }));
        if (sql.includes('"AuditEvent"')) {
            if (db.auditMissing) return missing();
            return sql.includes('GROUP BY "event"') ? (db.counts ?? []) : (db.recent ?? []);
        }
        if (sql.includes('"disabled" = TRUE')) return [{ n: BigInt(2) }];
        if (sql.includes('"mustChangePassword"')) return [{ n: BigInt(1) }];
        if (sql.includes('"UserSession"')) return [{ n: BigInt(6) }];
        return [];
    });
}
const codes = (body: any) => Object.fromEntries(body.checks.map((c: any) => [c.code, c.status]));

beforeEach(() => {
    for (const m of [requireAdmin, rateLimitAsync, queryRawUnsafe, loadDomainPrivateKey]) m.mockReset();
    requireAdmin.mockResolvedValue(okGuard);
    rateLimitAsync.mockResolvedValue({ ok: true, retryAfter: 0, backend: 'memory' });
    loadDomainPrivateKey.mockReturnValue(null);
    for (const k of ['NEXTAUTH_SECRET', 'DATA_ENCRYPTION_KEY', 'WEBHOOK_SECRET', 'RESEND_WEBHOOK_SECRET', 'INTERNAL_SECRET', 'CRON_SECRET', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'MFA_ENFORCE_ADMIN', 'MFA_REQUIRED_ALL', 'ADMIN_EMAILS']) vi.stubEnv(k, '');
    installDb();
});
afterEach(() => vi.unstubAllEnvs());

describe('GET /api/admin/security/status', () => {
    it('401 sin sesion y 403 sin rol', async () => {
        requireAdmin.mockResolvedValueOnce({ ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
        expect((await call()).status).toBe(401);
        requireAdmin.mockResolvedValueOnce({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
        expect((await call()).status).toBe(403);
        expect(queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('con todos los secretos definidos NO devuelve ningun valor (ni parcial) y marca booleanos', async () => {
        for (const [k, v] of Object.entries(SECRETS)) vi.stubEnv(k, v);
        vi.stubEnv('ADMIN_EMAILS', 'boss@corp.com');
        loadDomainPrivateKey.mockReturnValue({ type: 'private' });
        installDb({ adminRows: [{ id: 'u1', email: 'boss@corp.com', enabled: true }] });
        const res = await call();
        expect(res.status).toBe(200);
        const text = await res.text();
        for (const v of Object.values(SECRETS)) {
            expect(text).not.toContain(v);
            expect(text).not.toContain(v.slice(0, 12));
        }
        expect(text).not.toContain('redis-secret-host');
        const body = JSON.parse(text);
        expect(body.config).toEqual({
            nextauthSecret: true, dataEncryptionKey: true, webhookSecret: true, resendWebhookSecret: true, internalSecret: true, cronSecret: true,
            adminEmails: true, rateLimitBackend: 'redis', domainSigning: true,
        });
        const c = codes(body);
        expect(c['config.nextauth_secret_ok']).toBe('ok');
        expect(c['config.signing_key_present']).toBe('ok');
        expect(c['config.rate_limit_redis']).toBe('ok');
        expect(c['mfa.admins_enrolled']).toBe('ok');
        expect(res.headers.get('cache-control')).toBe('no-store');
    });

    it('sin configuracion: estados fail/warn/info con codigos estables (modo heredado = aviso, no error)', async () => {
        const body = await (await call()).json();
        const c = codes(body);
        expect(c['config.nextauth_secret_missing']).toBe('fail');
        expect(c['config.encryption_key_missing']).toBe('warn');
        expect(c['config.webhook_secret_unset']).toBe('info');
        expect(c['config.resend_webhook_secret_unset']).toBe('info');
        expect(c['config.internal_secret_derived']).toBe('info');
        expect(c['config.cron_secret_missing']).toBe('warn');
        expect(c['config.rate_limit_memory']).toBe('warn');
        expect(c['config.signing_legacy']).toBe('warn');
        expect(c['admins.none_configured']).toBe('warn');
        expect(c['mfa.admin_enforced']).toBe('ok');
        expect(body.config.rateLimitBackend).toBe('memory');
        expect(body.config.domainSigning).toBe(false);
    });

    it('NEXTAUTH_SECRET corto => aviso (sin revelar su longitud ni valor)', async () => {
        vi.stubEnv('NEXTAUTH_SECRET', 'short-one');
        const text = await (await call()).text();
        expect(JSON.parse(text).checks.find((c: any) => c.id === 'nextauth_secret')).toMatchObject({ status: 'warn', code: 'config.nextauth_secret_short' });
        expect(text).not.toContain('short-one');
    });

    it('politica MFA: desactivada es critica, obligatoria para todos es ok', async () => {
        vi.stubEnv('MFA_ENFORCE_ADMIN', 'false');
        expect(codes(await (await call()).json())['mfa.admin_not_enforced']).toBe('fail');
        vi.stubEnv('MFA_REQUIRED_ALL', 'true');
        expect(codes(await (await call()).json())['mfa.required_all']).toBe('ok');
    });

    it('admins: MFA faltante = aviso, correo sin cuenta = info y enlace por userId', async () => {
        vi.stubEnv('ADMIN_EMAILS', 'Boss@corp.com, ghost@corp.com, noMfa@corp.com');
        installDb({ adminRows: [{ id: 'u1', email: 'boss@corp.com', enabled: true }, { id: 'u2', email: 'nomfa@corp.com', enabled: null }] });
        const body = await (await call()).json();
        expect(body.admins).toEqual([
            { email: 'boss@corp.com', userId: 'u1', mfaEnabled: true },
            { email: 'ghost@corp.com', userId: null, mfaEnabled: null },
            { email: 'nomfa@corp.com', userId: 'u2', mfaEnabled: false },
        ]);
        const c = codes(body);
        expect(c['mfa.admins_missing']).toBe('warn');
        expect(c['admins.no_account']).toBe('info');
        expect(body.checks.find((x: any) => x.code === 'mfa.admins_missing').params).toEqual({ count: 1 });
    });

    it('sin tabla UserMfa: estado "no disponible" sin romper', async () => {
        vi.stubEnv('ADMIN_EMAILS', 'boss@corp.com');
        installDb({ mfaMissing: true, adminRows: [{ id: 'u1', email: 'boss@corp.com' }] });
        const body = await (await call()).json();
        expect(codes(body)['mfa.unavailable']).toBe('info');
        expect(body.mfaPolicy.available).toBe(false);
        expect(body.admins[0]).toMatchObject({ userId: 'u1', mfaEnabled: null });
    });

    it('eventos: conteos 24h/7d, ultimos 10 con IP y correos enmascarados, y avisos por umbrales', async () => {
        installDb({
            counts: [{ event: 'auth.login.failure', h24: BigInt(25), d7: BigInt(40) }, { event: 'auth.login.locked', h24: BigInt(2), d7: BigInt(3) }, { event: 'admin.access_denied', h24: BigInt(1), d7: BigInt(6) }],
            recent: [{ id: 'e1', ts: new Date('2026-09-01T10:00:00Z'), event: 'admin.access_denied', userId: 'u9', ip: '203.0.113.77', data: { reason: 'not_admin', email: 'x@y.com' } }],
        });
        const text = await (await call()).text();
        const body = JSON.parse(text);
        expect(body.events.last24h['auth.login.failure']).toBe(25);
        expect(body.events.last7d['admin.access_denied']).toBe(6);
        expect(body.events.last24h['auth.mfa.verify_failed']).toBe(0);
        expect(body.events.recent[0]).toMatchObject({ event: 'admin.access_denied', ip: '203.0.x.x', reason: 'not_admin', userId: 'u9' });
        expect(text).not.toContain('203.0.113.77');
        expect(text).not.toContain('x@y.com');
        const c = codes(body);
        expect(c['events.login_failures_high']).toBe('warn');
        expect(c['events.accounts_locked']).toBe('info');
        expect(c['events.access_denied_high']).toBeUndefined();
        expect(body.counts).toEqual({ disabledUsers: 2, mustChangePassword: 1, activeSessions: 6 });
    });

    it('sin eventos: "quiet"; sin tabla de auditoria: no disponible', async () => {
        expect(codes(await (await call()).json())['events.quiet']).toBe('ok');
        installDb({ auditMissing: true });
        const body = await (await call()).json();
        expect(codes(body)['events.unavailable']).toBe('info');
        expect(body.events).toMatchObject({ available: false, recent: [] });
    });

    it('limites de sesion por defecto = ok; TTL enorme = aviso', async () => {
        expect(codes(await (await call()).json())['session.limits_ok']).toBe('ok');
        vi.stubEnv('SESSION_TTL_SECONDS', String(20 * 86400));
        expect(codes(await (await call()).json())['session.limits_long']).toBe('warn');
    });
});
