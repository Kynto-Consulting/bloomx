import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireAdmin = vi.fn();
const auditLog = vi.fn();
const rateLimitAsync = vi.fn();
const queryRawUnsafe = vi.fn();
const executeRawUnsafe = vi.fn();
const runRetention = vi.fn();
const loadOverrides = vi.fn();

vi.mock('@/lib/admin-auth', () => ({ requireAdmin: (...a: unknown[]) => requireAdmin(...a) }));
vi.mock('@/lib/security', () => ({
    auditLog: (...a: unknown[]) => auditLog(...a),
    rateLimitAsync: (...a: unknown[]) => rateLimitAsync(...a),
    getClientIp: () => '9.9.9.9',
    safeEqual: () => false,
}));
vi.mock('@/lib/prisma', () => ({
    prisma: { $queryRawUnsafe: (...a: unknown[]) => queryRawUnsafe(...a), $executeRawUnsafe: (...a: unknown[]) => executeRawUnsafe(...a) },
}));
vi.mock('@/lib/storage', () => ({ deleteManyFromStorage: vi.fn(), deleteStoragePrefix: vi.fn(), listStorageObjects: vi.fn() }));
vi.mock('@/lib/retention', async (orig) => ({
    ...(await orig<typeof import('@/lib/retention')>()),
    runRetention: (...a: unknown[]) => runRetention(...a),
    loadRetentionOverrides: (...a: unknown[]) => loadOverrides(...a),
}));

import { GET as getSettings, PUT as putSettings } from '../settings/route';
import { POST as runRoute } from '../run/route';
import { GET as storageRoute } from '../storage/route';
import { GET as getQuota, PUT as putQuota } from '../quota/route';

const okGuard = { ok: true, actor: { kind: 'user', id: 'u-admin', email: 'boss@corp.com' } };
const url = (p: string) => `http://localhost/api/admin/retention/${p}`;
const get = (p: string) => new NextRequest(url(p));
const send = (p: string, method: string, body: unknown) =>
    new NextRequest(url(p), { method, body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' } });

const REPORT = {
    dryRun: true, spamEmails: 3, trashEmails: 0, rawPayloads: 1, secureMessages: 2, auditEventsPurged: 10, revocationsPurged: 0,
    extensionNotificationsPurged: 0, storageFailed: 0, sessionRowsPurged: 4,
};

beforeEach(() => {
    for (const m of [requireAdmin, auditLog, rateLimitAsync, queryRawUnsafe, executeRawUnsafe, runRetention, loadOverrides]) m.mockReset();
    requireAdmin.mockResolvedValue(okGuard);
    rateLimitAsync.mockResolvedValue({ ok: true, retryAfter: 0, backend: 'memory' });
    loadOverrides.mockResolvedValue({ overrides: {}, updatedAt: null, updatedBy: null });
    executeRawUnsafe.mockResolvedValue(1);
    runRetention.mockResolvedValue(REPORT);
    vi.stubEnv('RETENTION_SPAM_DAYS', '45');
    vi.stubEnv('AUDIT_RETENTION_DAYS', '365');
});
afterEach(() => vi.unstubAllEnvs());

describe('acceso (401/403) en todas las rutas de retencion', () => {
    it.each([
        ['GET settings', () => getSettings(get('settings'))],
        ['PUT settings', () => putSettings(send('settings', 'PUT', { spamDays: 1 }))],
        ['POST run', () => runRoute(send('run', 'POST', { dryRun: true }))],
        ['GET storage', () => storageRoute(get('storage'))],
        ['GET quota', () => getQuota(get('quota'))],
        ['PUT quota', () => putQuota(send('quota', 'PUT', { mailQuotaMb: 5 }))],
    ])('%s', async (_n, call) => {
        requireAdmin.mockResolvedValueOnce({ ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
        expect((await call()).status).toBe(401);
        requireAdmin.mockResolvedValueOnce({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
        expect((await call()).status).toBe(403);
        expect(runRetention).not.toHaveBeenCalled();
        expect(executeRawUnsafe).not.toHaveBeenCalled();
    });
});

describe('settings', () => {
    it('GET: efectivo = entorno + overrides, con origen y limites', async () => {
        loadOverrides.mockResolvedValue({ overrides: { spamDays: 10 }, updatedAt: new Date('2026-09-01T00:00:00Z'), updatedBy: 'boss@corp.com' });
        const body = await (await getSettings(get('settings'))).json();
        expect(body.env.spamDays).toBe(45);
        expect(body.overrides).toEqual({ spamDays: 10 });
        expect(body.effective).toMatchObject({ spamDays: 10, auditDays: 365 });
        expect(body.updatedAt).toBe('2026-09-01T00:00:00.000Z');
        expect(body.updatedBy).toBe('b***@corp.com'); // el correo no sale en claro
        expect(body.limits.auditDays).toMatchObject({ zeroOrMin: 30 });
    });

    it.each([
        [{ spamDays: 3651 }], [{ spamDays: -1 }], [{ spamDays: 1.5 }], [{ spamDays: '10' }], [{ batch: 0 }], [{ batch: 1001 }],
        [{ auditDays: 10 }], [{ auditDays: 29 }], [{ desconocida: 1 }], [{}], ['no json'],
    ])('PUT rechaza %j con 400 y no escribe', async (body) => {
        const res = await putSettings(send('settings', 'PUT', body));
        expect(res.status).toBe(400);
        expect(executeRawUnsafe).not.toHaveBeenCalled();
        expect(auditLog).not.toHaveBeenCalled();
    });

    it('PUT acepta los limites (0, 30, 3650, batch 1 y 1000)', async () => {
        for (const body of [{ auditDays: 0 }, { auditDays: 30 }, { spamDays: 3650, trashDays: 0 }, { batch: 1 }, { batch: 1000 }]) {
            expect((await putSettings(send('settings', 'PUT', body))).status).toBe(200);
        }
    });

    it('PUT guarda solo overrides validos y audita claves y valores numericos', async () => {
        const res = await putSettings(send('settings', 'PUT', { spamDays: 20, batch: 50 }));
        expect(res.status).toBe(200);
        const [sql, ...params] = executeRawUnsafe.mock.calls[0];
        expect(String(sql)).toContain('INSERT INTO "AdminSetting"');
        expect(params[0]).toBe('retention');
        expect(JSON.parse(params[1] as string)).toEqual({ spamDays: 20, batch: 50 });
        expect(params[2]).toBe('boss@corp.com');
        expect(auditLog).toHaveBeenCalledWith('admin.retention.settings_changed', expect.objectContaining({
            changedKeys: ['spamDays', 'batch'], values: { spamDays: 20, batch: 50 }, actorId: 'u-admin',
        }));
    });

    it('PUT con null vuelve a env para esa clave y conserva las demas', async () => {
        loadOverrides.mockResolvedValue({ overrides: { spamDays: 10, trashDays: 5 }, updatedAt: null, updatedBy: null });
        await putSettings(send('settings', 'PUT', { spamDays: null, batch: 50 }));
        expect(JSON.parse(executeRawUnsafe.mock.calls[0][2] as string)).toEqual({ trashDays: 5, batch: 50 });
        expect(auditLog).toHaveBeenCalledWith('admin.retention.settings_changed', expect.objectContaining({ values: { spamDays: null, batch: 50 } }));
    });

    it('PUT que deja sin overrides borra la fila', async () => {
        loadOverrides.mockResolvedValue({ overrides: { spamDays: 10 }, updatedAt: null, updatedBy: null });
        await putSettings(send('settings', 'PUT', { spamDays: null }));
        expect(String(executeRawUnsafe.mock.calls[0][0])).toContain('DELETE FROM "AdminSetting"');
    });

    it('sin tabla AdminSetting: 503 settings_unavailable', async () => {
        executeRawUnsafe.mockRejectedValue(Object.assign(new Error('relation "AdminSetting" does not exist'), { code: '42P01' }));
        const res = await putSettings(send('settings', 'PUT', { spamDays: 5 }));
        expect(res.status).toBe(503);
        expect((await res.json()).code).toBe('settings_unavailable');
    });
});

describe('run', () => {
    it('simulacion: no borra (quiet), audita run_manual y no consume el limite estricto', async () => {
        const res = await runRoute(send('run', 'POST', { dryRun: true }));
        expect(res.status).toBe(200);
        expect(runRetention).toHaveBeenCalledWith({ dryRun: true, quiet: true });
        expect(await res.json()).toMatchObject({ dryRun: true, spamEmails: 3, sessionRowsPurged: 4 });
        expect(auditLog).toHaveBeenCalledWith('admin.retention.run_manual', expect.objectContaining({ dryRun: true, spamEmails: 3 }));
        expect(rateLimitAsync.mock.calls.some((c) => String(c[0]).includes('run:real'))).toBe(false);
    });

    it('por defecto (cuerpo vacio) es una simulacion; dryRun no booleano es 400', async () => {
        await runRoute(send('run', 'POST', {}));
        expect(runRetention).toHaveBeenCalledWith({ dryRun: true, quiet: true });
        expect((await runRoute(send('run', 'POST', { dryRun: 'false' }))).status).toBe(400);
        expect((await runRoute(send('run', 'POST', { dryRun: false, extra: 1 }))).status).toBe(400);
    });

    it('ejecucion real: limite 3 por 10 min; si se excede 429 y no se purga', async () => {
        runRetention.mockResolvedValue({ ...REPORT, dryRun: false });
        expect((await runRoute(send('run', 'POST', { dryRun: false }))).status).toBe(200);
        expect(runRetention).toHaveBeenCalledWith({ dryRun: false, quiet: false });
        expect(rateLimitAsync).toHaveBeenCalledWith('admin:retention.run:real:u-admin', 3, 600_000);
        runRetention.mockClear();
        rateLimitAsync.mockImplementation(async (key: string) => ({ ok: !String(key).includes('run:real'), retryAfter: 120, backend: 'memory' }));
        const res = await runRoute(send('run', 'POST', { dryRun: false }));
        expect(res.status).toBe(429);
        expect(res.headers.get('retry-after')).toBe('120');
        expect(runRetention).not.toHaveBeenCalled();
    });

    it('candado: una segunda ejecucion simultanea recibe 409 y se libera al terminar', async () => {
        let release: (r: unknown) => void = () => undefined;
        runRetention.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
        const first = runRoute(send('run', 'POST', { dryRun: true }));
        await new Promise((r) => setTimeout(r, 10));
        const second = await runRoute(send('run', 'POST', { dryRun: true }));
        expect(second.status).toBe(409);
        expect((await second.json()).code).toBe('run_in_progress');
        release(REPORT);
        expect((await first).status).toBe(200);
        expect((await runRoute(send('run', 'POST', { dryRun: true }))).status).toBe(200);
    });

    it('un fallo de la purga libera el candado y devuelve 500 sin detalles', async () => {
        runRetention.mockRejectedValueOnce(new Error('S3 keys emails/2030/secret-key-123'));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const res = await runRoute(send('run', 'POST', { dryRun: true }));
        expect(res.status).toBe(500);
        expect(JSON.stringify(await res.json())).not.toContain('secret-key-123');
        expect((await runRoute(send('run', 'POST', { dryRun: true }))).status).toBe(200);
    });
});

describe('storage', () => {
    const SQL_FORBIDDEN = /subject|htmlKey|textKey|rawKey|"body"|"from"|"to"\b/i;

    it('solo agregados: sin claves ni contenido y con la simulacion de lo que se borraria', async () => {
        queryRawUnsafe.mockImplementation(async (sql: string) => {
            if (sql.includes('SUM("size")') && !sql.includes('GROUP BY')) return [{ n: BigInt(3), bytes: BigInt(4096) }];
            if (sql.includes('GROUP BY "folder"')) return [{ folder: 'inbox', n: BigInt(7) }, { folder: 'spam', n: BigInt(2) }];
            if (sql.includes('GROUP BY u."id"')) return [{ id: 'u1', email: 'big@user.com', bytes: BigInt(4096), n: BigInt(3) }];
            if (sql.includes('MIN("ts")')) return [{ ts: new Date('2026-01-01T00:00:00Z') }];
            if (sql.includes('COUNT(*)')) return [{ n: BigInt(5) }];
            return [];
        });
        const res = await storageRoute(get('storage'));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Object.keys(body).sort()).toEqual(['attachments', 'emailsByFolder', 'policy', 'tables', 'topUsers', 'wouldDelete']);
        expect(body.attachments).toEqual({ count: 3, bytes: 4096 });
        expect(body.emailsByFolder).toEqual([{ folder: 'inbox', count: 7 }, { folder: 'spam', count: 2 }]);
        expect(body.topUsers).toEqual([{ userId: 'u1', email: 'big@user.com', bytes: 4096, attachments: 3 }]);
        expect(body.tables).toMatchObject({ userSessions: 5, auditEvents: 5, revokedSessions: 5, oldestAuditAt: '2026-01-01T00:00:00.000Z' });
        expect(body.wouldDelete).toMatchObject({ dryRun: true, spamEmails: 3 });
        expect(runRetention).toHaveBeenCalledWith({ dryRun: true, quiet: true });
        for (const c of queryRawUnsafe.mock.calls) expect(String(c[0])).not.toMatch(SQL_FORBIDDEN);
        expect(JSON.stringify(body)).not.toMatch(/emails\/\d|"key"|htmlKey|rawKey/);
    });

    it('tablas ausentes => null (degradacion elegante) y simulacion fallida => null', async () => {
        queryRawUnsafe.mockRejectedValue(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
        runRetention.mockRejectedValue(new Error('boom'));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const body = await (await storageRoute(get('storage'))).json();
        expect(body).toMatchObject({ attachments: null, emailsByFolder: null, topUsers: null, wouldDelete: null });
        expect(body.tables).toEqual({ userSessions: null, auditEvents: null, oldestAuditAt: null, revokedSessions: null });
    });
});

describe('quota (cuota de buzon del dominio)', () => {
    beforeEach(() => { vi.stubEnv('MAIL_QUOTA_MB', '250'); });

    it('GET: efectivo = fila de la consola o, si no hay, MAIL_QUOTA_MB; nunca claves ni correos en claro', async () => {
        queryRawUnsafe.mockResolvedValue([]);
        let body = await (await getQuota(get('quota'))).json();
        expect(body).toMatchObject({ mailQuotaMb: null, enforceMailQuota: false, envMailQuotaMb: 250, effectiveMb: 250, source: 'env' });
        queryRawUnsafe.mockResolvedValue([
            { key: 'mailQuotaMb', value: 1024, updatedAt: new Date('2026-09-01T00:00:00Z'), updatedBy: 'boss@corp.com' },
            { key: 'enforceMailQuota', value: true, updatedAt: new Date('2026-09-02T00:00:00Z'), updatedBy: 'boss@corp.com' },
        ]);
        body = await (await getQuota(get('quota'))).json();
        expect(body).toMatchObject({ mailQuotaMb: 1024, enforceMailQuota: true, effectiveMb: 1024, source: 'console', updatedBy: 'b***@corp.com', updatedAt: '2026-09-02T00:00:00.000Z' });
        queryRawUnsafe.mockRejectedValue(Object.assign(new Error('relation "AdminSetting" does not exist'), { code: '42P01' }));
        expect((await (await getQuota(get('quota'))).json()).source).toBe('env'); // sin tabla: entorno
    });

    it.each([
        [{ mailQuotaMb: -1 }], [{ mailQuotaMb: 1.5 }], [{ mailQuotaMb: '10' }], [{ mailQuotaMb: 10_000_001 }], [{ enforceMailQuota: 'yes' }],
        [{}], [{ desconocida: 1 }], [{ userId: 'u1' }], [{ userId: 'u1', mailQuotaMb: 5, enforceMailQuota: true }], ['no json'],
    ])('PUT rechaza %j con 400 y no escribe', async (body) => {
        const res = await putQuota(send('quota', 'PUT', body));
        expect(res.status).toBe(400);
        expect(executeRawUnsafe).not.toHaveBeenCalled();
        expect(auditLog).not.toHaveBeenCalled();
    });

    it('PUT del dominio: guarda la cuota (0 = sin limite valido) y el bloqueo, y audita valores no sensibles', async () => {
        queryRawUnsafe.mockResolvedValue([]);
        const res = await putQuota(send('quota', 'PUT', { mailQuotaMb: 2048, enforceMailQuota: true }));
        expect(res.status).toBe(200);
        const writes = executeRawUnsafe.mock.calls.map(([sql, ...params]) => ({ sql: String(sql), params }));
        expect(writes[0].sql).toContain('INSERT INTO "AdminSetting"');
        expect(writes[0].params.slice(0, 2)).toEqual(['mailQuotaMb', '2048']);
        expect(writes[0].params[2]).toBe('boss@corp.com');
        expect(writes[1].params.slice(0, 2)).toEqual(['enforceMailQuota', 'true']);
        expect(auditLog).toHaveBeenCalledWith('admin.quota.settings_changed', expect.objectContaining({
            scope: 'domain', mailQuotaMb: 2048, enforceMailQuota: true, actorId: 'u-admin',
        }));
        executeRawUnsafe.mockClear();
        expect((await putQuota(send('quota', 'PUT', { mailQuotaMb: 0 }))).status).toBe(200);
        expect(executeRawUnsafe.mock.calls[0][2]).toBe('0');
    });

    it('PUT con null o false BORRA la fila (vuelve al entorno / al comportamiento por defecto)', async () => {
        queryRawUnsafe.mockResolvedValue([]);
        await putQuota(send('quota', 'PUT', { mailQuotaMb: null, enforceMailQuota: false }));
        const sqls = executeRawUnsafe.mock.calls.map(([sql, key]) => [String(sql), key]);
        expect(sqls.slice(0, 2)).toEqual([
            ['DELETE FROM "AdminSetting" WHERE "key" = $1', 'mailQuotaMb'],
            ['DELETE FROM "AdminSetting" WHERE "key" = $1', 'enforceMailQuota'],
        ]);
        // y publica el cambio a las demas instancias (version en BD)
        expect(sqls).toHaveLength(3);
        expect(sqls[2][1]).toBe('mailQuotaVersion');
    });

    it('PUT por usuario: comprueba que existe, guarda la fila mailQuotaMb:user:<id> y audita al usuario afectado', async () => {
        queryRawUnsafe.mockImplementation(async (sql: string) => (String(sql).includes('FROM "User"') ? [{ id: 'u-7' }] : []));
        const res = await putQuota(send('quota', 'PUT', { userId: 'u-7', mailQuotaMb: 5 }));
        expect(res.status).toBe(200);
        expect(executeRawUnsafe.mock.calls[0].slice(1, 3)).toEqual(['mailQuotaMb:user:u-7', '5']);
        expect(auditLog).toHaveBeenCalledWith('admin.quota.settings_changed', expect.objectContaining({ scope: 'user', targetUserId: 'u-7', userId: 'u-7', mailQuotaMb: 5 }));
        queryRawUnsafe.mockImplementation(async () => []);
        executeRawUnsafe.mockClear();
        expect((await putQuota(send('quota', 'PUT', { userId: 'no-existe', mailQuotaMb: 5 }))).status).toBe(404);
        expect(executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('sin tabla AdminSetting: 503 settings_unavailable', async () => {
        queryRawUnsafe.mockResolvedValue([]);
        executeRawUnsafe.mockRejectedValue(Object.assign(new Error('relation "AdminSetting" does not exist'), { code: '42P01' }));
        const res = await putQuota(send('quota', 'PUT', { mailQuotaMb: 5 }));
        expect(res.status).toBe(503);
        expect((await res.json()).code).toBe('settings_unavailable');
    });

    it('limita las escrituras por administrador (rate limit)', async () => {
        rateLimitAsync.mockResolvedValue({ ok: false, retryAfter: 30, backend: 'memory' });
        const res = await putQuota(send('quota', 'PUT', { mailQuotaMb: 5 }));
        expect(res.status).toBe(429);
        expect(res.headers.get('retry-after')).toBe('30');
        expect(executeRawUnsafe).not.toHaveBeenCalled();
    });
});
