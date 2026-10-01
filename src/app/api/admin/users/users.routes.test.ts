import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';

/**
 * Rutas /api/admin/users/** y /api/admin/accounts/** con dobles: sin BD, backend ni red reales.
 * Se mockea requireAdmin, prisma (SQL crudo: se captura texto y parametros), auditoria, sesiones y MFA.
 */

const h = vi.hoisted(() => ({
    calls: [] as { sql: string; params: unknown[] }[],
    admin: { ok: true } as any,
    total: 0,
    rows: [] as any[],
    basic: {} as Record<string, any>,
    existing: new Set<string>(),
    emailTaken: false,
    accountRows: [] as any[],
    providers: [] as string[],
    accountBrief: null as any,
    execCount: 1,
    audit: [] as { event: string; data: any }[],
    disableMfa: vi.fn(async () => undefined),
    revokeAll: vi.fn(async () => true),
    revokeSession: vi.fn(async () => true),
    setDisabled: vi.fn(async () => true),
    setMustChange: vi.fn(async () => true),
    userCreate: vi.fn(),
    userUpdate: vi.fn(async () => ({})),
    sessionsOf: { u1: [{ jti: 'jti-own', expiresAt: new Date(Date.now() + 3_600_000) }] } as Record<string, any[]>,
    activeSessions: [] as any[],
}));

function route(sql: string, params: unknown[]): unknown[] {
    if (sql.includes('to_regclass')) return [{ state: true, mfa: true, account: true, attachment: true }];
    if (sql.includes('SELECT COUNT(*) AS n')) return [{ n: BigInt(h.total) }];
    if (sql.includes('"userEmail"')) return h.accountRows;
    if (sql.includes('SELECT DISTINCT "provider"')) return h.providers.map((provider) => ({ provider }));
    if (sql.includes('FROM "Account" WHERE "id" = $1')) return h.accountBrief ? [h.accountBrief] : [];
    if (sql.includes('"User" WHERE "id" = ANY')) return (params[0] as string[]).filter((i) => h.existing.has(i)).map((id) => ({ id }));
    if (sql.includes('lower("email") = lower($1)')) return h.emailTaken ? [{ id: 'dup' }] : [];
    if (sql.includes('FROM "User" WHERE "id" = $1')) return h.basic[String(params[0])] ? [h.basic[String(params[0])]] : [];
    if (sql.includes('"hasAvatar"')) return h.rows;
    return [];
}

vi.mock('@/lib/admin-auth', () => {
    const guardFn = vi.fn(async () => h.admin);
    // adminRoute usa requireLevel(n): en estas pruebas el nivel no se evalua (lo cubre admin-levels.test / admin-cli.pg.test)
    return { requireAdmin: guardFn, requireLevel: (_min: number, ...a: unknown[]) => (guardFn as (...x: unknown[]) => unknown)(...a) };
});
vi.mock('@/lib/prisma', () => ({
    prisma: {
        $queryRawUnsafe: vi.fn(async (sql: string, ...params: unknown[]) => {
            h.calls.push({ sql, params });
            return route(sql, params);
        }),
        $executeRawUnsafe: vi.fn(async (sql: string, ...params: unknown[]) => {
            h.calls.push({ sql, params });
            return h.execCount;
        }),
        user: { create: h.userCreate, update: h.userUpdate },
    },
}));
vi.mock('@/lib/security', async (orig) => {
    const actual = await orig<typeof import('@/lib/security')>();
    return {
        ...actual,
        auditLog: vi.fn((event: string, data: any) => { h.audit.push({ event, data }); }),
        rateLimitAsync: vi.fn(async () => ({ ok: true, remaining: 10, retryAfter: 0 })),
        getClientIp: () => '203.0.113.9',
    };
});
vi.mock('@/lib/mfa', async (orig) => {
    const actual = await orig<typeof import('@/lib/mfa')>();
    return {
        ...actual,
        disableMfa: h.disableMfa,
        getMfaStatus: vi.fn(async () => ({ available: true, enabled: true, pendingEnrollment: false, recoveryCodesLeft: 7 })),
    };
});
vi.mock('@/lib/session', () => ({ revokeAllSessions: h.revokeAll }));
vi.mock('@/lib/session-revocation', () => ({ revokeSession: h.revokeSession }));
vi.mock('@/lib/admin/user-state', () => ({
    getUserState: vi.fn(async () => ({ disabled: false, disabledAt: null, mustChangePassword: false, lastLoginAt: null, lastLoginIp: null })),
    setUserDisabled: h.setDisabled,
    setMustChangePassword: h.setMustChange,
}));
vi.mock('@/lib/admin/session-registry', () => ({
    listActiveSessions: vi.fn(async () => h.activeSessions),
    countActiveSessions: vi.fn(async () => ({})),
    findSessionOfUser: vi.fn(async (userId: string, jti: string) => (h.sessionsOf[userId] ?? []).find((s) => s.jti === jti) ?? null),
}));

const ADMIN_USER = { ok: true, actor: { kind: 'user', id: 'admin1', email: 'admin@x.test' } };
const basicRow = (id: string, email = `${id}@x.test`) => ({ id, name: `Name ${id}`, email, hasAvatar: false, createdAt: new Date('2025-01-01T00:00:00Z') });
const ctxOf = (params: Record<string, string>) => ({ params: Promise.resolve(params) }) as any;
const req = (path: string, init: { method?: string; body?: unknown } = {}) =>
    new NextRequest(`http://localhost${path}`, {
        method: init.method ?? 'GET',
        headers: { 'content-type': 'application/json' },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
const auditEvents = () => h.audit.map((a) => a.event);
const mainSelect = () => h.calls.filter((c) => c.sql.includes('"hasAvatar"') && c.sql.includes('ORDER BY')).at(-1)!;

beforeEach(() => {
    h.calls.length = 0;
    h.audit.length = 0;
    h.admin = ADMIN_USER;
    h.total = 0;
    h.rows = [];
    h.basic = { u1: basicRow('u1'), admin1: basicRow('admin1', 'admin@x.test') };
    h.existing = new Set(['u1', 'u2', 'admin1']);
    h.emailTaken = false;
    h.accountRows = [];
    h.providers = [];
    h.accountBrief = null;
    h.execCount = 1;
    h.activeSessions = [];
    h.sessionsOf = { u1: [{ jti: 'jti-own', expiresAt: new Date(Date.now() + 3_600_000) }] };
    for (const f of [h.disableMfa, h.revokeAll, h.revokeSession, h.setDisabled, h.setMustChange, h.userCreate, h.userUpdate]) f.mockClear();
    h.userCreate.mockImplementation(async ({ data }: any) => ({ id: 'new1', email: data.email, name: data.name ?? null }));
    process.env.ADMIN_EMAILS = 'Admin@x.test, boss@x.test';
});

describe('autorizacion', () => {
    it('sin sesion (401) o sin rol (403) ninguna ruta llega a la logica ni a la BD', async () => {
        const users = await import('./route');
        const detail = await import('./[id]/route');
        const mfa = await import('./[id]/mfa-reset/route');
        const sess = await import('./[id]/sessions/route');
        const sess1 = await import('./[id]/sessions/[jti]/route');
        const pw = await import('./[id]/password/route');
        const force = await import('./[id]/force-password-change/route');
        const bulk = await import('./bulk/route');
        const exp = await import('./export/route');
        const accounts = await import('../accounts/route');
        const acc = await import('../accounts/[id]/route');
        const rec = await import('../accounts/[id]/reconnect/route');
        const p = ctxOf({ id: 'u1', jti: 'j' });
        const calls = [
            () => users.GET(req('/api/admin/users')),
            () => users.POST(req('/api/admin/users', { method: 'POST', body: { email: 'a@b.co' } })),
            () => detail.GET(req('/api/admin/users/u1'), p),
            () => detail.PATCH(req('/api/admin/users/u1', { method: 'PATCH', body: { disabled: true } }), p),
            () => mfa.POST(req('/x', { method: 'POST', body: {} }), p),
            () => sess.DELETE(req('/x', { method: 'DELETE' }), p),
            () => sess1.DELETE(req('/x', { method: 'DELETE' }), p),
            () => pw.POST(req('/x', { method: 'POST', body: { mode: 'temporary' } }), p),
            () => force.POST(req('/x', { method: 'POST', body: {} }), p),
            () => bulk.POST(req('/x', { method: 'POST', body: { ids: ['u1'], action: 'disable' } })),
            () => exp.GET(req('/x')),
            () => accounts.GET(req('/x')),
            () => acc.DELETE(req('/x', { method: 'DELETE' }), p),
            () => rec.POST(req('/x', { method: 'POST', body: {} }), p),
        ];
        for (const status of [401, 403]) {
            h.admin = { ok: false, response: NextResponse.json({ error: 'x' }, { status }) };
            for (const call of calls) expect((await call()).status).toBe(status);
        }
        expect(h.calls).toHaveLength(0);
        expect(h.disableMfa).not.toHaveBeenCalled();
        expect(h.revokeAll).not.toHaveBeenCalled();
        expect(h.audit).toHaveLength(0);
    });
});

describe('GET /api/admin/users', () => {
    it('traduce filtros a PARAMETROS (sin interpolar), acota la pagina y ordena por lista blanca', async () => {
        const { GET } = await import('./route');
        h.total = 230;
        const evil = "ann%_\\'; DROP TABLE \"User\";--";
        const res = await GET(req(`/api/admin/users?q=${encodeURIComponent(evil)}&status=disabled&role=admin&mfa=yes&google=no&sort=email&dir=asc&page=2&pageSize=500`));
        expect(res.status).toBe(200);
        const { sql, params } = mainSelect();
        expect(sql).not.toContain('DROP TABLE');
        expect(sql).not.toContain('ann');
        expect(params).toContain("%ann\\%\\_\\\\'; DROP TABLE \"User\";--%");
        expect(params.some((p) => Array.isArray(p) && p.join() === 'admin@x.test,boss@x.test')).toBe(true);
        expect(sql).toContain('= ANY($');
        expect(sql).toContain('ILIKE $1');
        expect(sql).toContain('ORDER BY lower(u."email") ASC');
        // pageSize=500 -> 100; page=2 -> offset 100
        expect(params.slice(-2)).toEqual([100, 100]);
        const body = await res.json();
        expect(body.page).toEqual({ page: 2, pageSize: 100, total: 230, pages: 3 });
        expect(res.headers.get('cache-control')).toBe('no-store');
    });

    it('valores fuera de la lista blanca (orden, estado...) dan 400 sin repetir el valor', async () => {
        const { GET } = await import('./route');
        for (const qs of ['sort=password', 'sort=email;DROP', 'status=hacked', 'role=root', 'dir=sideways']) {
            const res = await GET(req(`/api/admin/users?${qs}`));
            expect(res.status).toBe(400);
            expect(JSON.stringify(await res.json())).not.toMatch(/DROP|hacked|root|sideways/);
        }
        expect(h.calls).toHaveLength(0);
    });

    it('devuelve filas sin campos sensibles', async () => {
        const { GET } = await import('./route');
        h.total = 1;
        h.rows = [{ id: 'u1', name: 'Ann', email: 'ann@x.test', hasAvatar: true, createdAt: new Date('2025-02-01T00:00:00Z'), disabled: false, lastLoginAt: null, isAdmin: false, mfaEnabled: true, googleLinked: true, storageBytes: BigInt(2048) }];
        const res = await GET(req('/api/admin/users'));
        const text = await res.text();
        expect(text).not.toMatch(/password|token|hash|secret/i);
        const body = JSON.parse(text);
        expect(body.users[0]).toMatchObject({ id: 'u1', avatar: true, mfaEnabled: true, googleLinked: true, storageBytes: 2048, sessions: 0, lastLoginAt: null });
    });
});

describe('POST /api/admin/users', () => {
    const post = async (body: unknown) => (await import('./route')).POST(req('/api/admin/users', { method: 'POST', body }));

    it('valida con zod (400) y aplica la politica de contrasena', async () => {
        expect((await post({ email: 'no-es-correo' })).status).toBe(400);
        expect((await post({})).status).toBe(400);
        const weak = await post({ email: 'nuevo@x.test', password: 'corta' });
        expect(weak.status).toBe(400);
        expect((await weak.json()).code).toBe('weak_password');
        expect(h.userCreate).not.toHaveBeenCalled();
    });

    it('409 si el correo ya existe (sin distinguir mayusculas)', async () => {
        h.emailTaken = true;
        const res = await post({ email: 'Dup@X.test', password: 'una-clave-larga-123' });
        expect(res.status).toBe(409);
        expect(h.userCreate).not.toHaveBeenCalled();
        expect(h.calls.at(-1)!.params).toEqual(['dup@x.test']);
    });

    it('sin contrasena genera una temporal valida, guarda SOLO el hash y la devuelve una vez; audita sin ella', async () => {
        const res = await post({ email: 'Nuevo@X.test', name: 'Nuevo' });
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.temporaryPassword.length).toBeGreaterThanOrEqual(16);
        expect(body.mustChangePassword).toBe(true);
        const data = h.userCreate.mock.calls[0][0].data;
        expect(data.email).toBe('nuevo@x.test');
        expect(data.password).not.toBe(body.temporaryPassword);
        expect(await bcrypt.compare(body.temporaryPassword, data.password)).toBe(true);
        expect(h.setMustChange).toHaveBeenCalledWith('new1', true);
        expect(auditEvents()).toEqual(['admin.users.created']);
        expect(JSON.stringify(h.audit)).not.toContain(body.temporaryPassword);
        expect(JSON.stringify(h.audit)).not.toContain(data.password);
        expect(h.audit[0].data).toMatchObject({ targetUserId: 'new1', actorId: 'admin1' });
    });

    it('con contrasena propia no la devuelve', async () => {
        const res = await post({ email: 'otro@x.test', password: 'Clave-muy-larga-2025!', mustChangePassword: false });
        const body = await res.json();
        expect(body.temporaryPassword).toBeUndefined();
        expect(h.setMustChange).not.toHaveBeenCalled();
    });
});

describe('GET/PATCH /api/admin/users/[id]', () => {
    it('404 si no existe', async () => {
        const { GET, PATCH } = await import('./[id]/route');
        expect((await GET(req('/x'), ctxOf({ id: 'nope' }))).status).toBe(404);
        expect((await PATCH(req('/x', { method: 'PATCH', body: { disabled: true } }), ctxOf({ id: 'nope' }))).status).toBe(404);
    });

    it('detalle: MFA, rol por ADMIN_EMAILS, sesiones con jti y nada sensible', async () => {
        const { GET } = await import('./[id]/route');
        h.basic.u1 = basicRow('u1', 'boss@x.test');
        h.activeSessions = [{ jti: 'abc', userId: 'u1', tv: 0, mfa: true, ip: '1.1.1.1', userAgent: 'UA', createdAt: '2025-01-01T00:00:00.000Z', expiresAt: '2025-02-01T00:00:00.000Z' }];
        const res = await GET(req('/x'), ctxOf({ id: 'u1' }));
        const text = await res.text();
        expect(text).not.toMatch(/"password"|access_token|refresh_token|secret/i);
        const body = JSON.parse(text);
        expect(body.user).toMatchObject({ id: 'u1', isAdmin: true, isSelf: false });
        expect(body.mfa).toMatchObject({ enabled: true, recoveryCodesLeft: 7, required: true });
        expect(body.sessions).toEqual([{ jti: 'abc', mfa: true, ip: '1.1.1.1', userAgent: 'UA', createdAt: '2025-01-01T00:00:00.000Z', expiresAt: '2025-02-01T00:00:00.000Z' }]);
        expect(body.storage).toEqual({ attachmentBytes: 0, attachmentCount: 0, emailCount: 0, folders: [] });
    });

    it('no puedes deshabilitarte a ti mismo (409); a otros: deshabilita, cierra sesiones y audita', async () => {
        const { PATCH } = await import('./[id]/route');
        const self = await PATCH(req('/x', { method: 'PATCH', body: { disabled: true } }), ctxOf({ id: 'admin1' }));
        expect(self.status).toBe(409);
        expect((await self.json()).code).toBe('cannot_disable_self');
        expect(h.setDisabled).not.toHaveBeenCalled();

        const ok = await PATCH(req('/x', { method: 'PATCH', body: { disabled: true } }), ctxOf({ id: 'u1' }));
        expect(ok.status).toBe(200);
        expect(h.setDisabled).toHaveBeenCalledWith('u1', true);
        expect(h.revokeAll).toHaveBeenCalledWith('u1');
        expect(auditEvents()).toEqual(['admin.users.disabled']);

        await PATCH(req('/x', { method: 'PATCH', body: { disabled: false } }), ctxOf({ id: 'u1' }));
        expect(h.setDisabled).toHaveBeenLastCalledWith('u1', false);
        expect(h.revokeAll).toHaveBeenCalledTimes(1);
        expect(auditEvents()).toContain('admin.users.enabled');
    });

    it('un manager (sin id de usuario) puede deshabilitar y el nombre se actualiza; cuerpo vacio o invalido = 400', async () => {
        const { PATCH } = await import('./[id]/route');
        h.admin = { ok: true, actor: { kind: 'manager', id: 'admin1', email: 'm@x.test' } };
        expect((await PATCH(req('/x', { method: 'PATCH', body: { disabled: true } }), ctxOf({ id: 'admin1' }))).status).toBe(200);
        expect((await PATCH(req('/x', { method: 'PATCH', body: {} }), ctxOf({ id: 'u1' }))).status).toBe(400);
        expect((await PATCH(req('/x', { method: 'PATCH', body: { disabled: 'yes' } }), ctxOf({ id: 'u1' }))).status).toBe(400);
        expect((await PATCH(req('/x', { method: 'PATCH', body: { role: 'admin' } }), ctxOf({ id: 'u1' }))).status).toBe(400);
        await PATCH(req('/x', { method: 'PATCH', body: { name: '  Nuevo nombre ' } }), ctxOf({ id: 'u1' }));
        expect(h.userUpdate).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { name: 'Nuevo nombre' } });
    });
});

describe('MFA, sesiones y contrasena', () => {
    it('restablecer MFA: disableMfa + revokeAllSessions y auditoria sin secretos; no sobre ti mismo; 404', async () => {
        const { POST } = await import('./[id]/mfa-reset/route');
        const ok = await POST(req('/x', { method: 'POST', body: {} }), ctxOf({ id: 'u1' }));
        expect(ok.status).toBe(200);
        expect(h.disableMfa).toHaveBeenCalledWith('u1');
        expect(h.revokeAll).toHaveBeenCalledWith('u1');
        expect(auditEvents()).toEqual(['admin.users.mfa_reset']);
        expect(h.audit[0].data).toMatchObject({ targetUserId: 'u1', userId: 'u1', actorId: 'admin1', actorKind: 'user' });
        expect(JSON.stringify(h.audit)).not.toMatch(/secret|recovery|code|password/i);

        h.disableMfa.mockClear();
        expect((await POST(req('/x', { method: 'POST', body: {} }), ctxOf({ id: 'admin1' }))).status).toBe(409);
        expect((await POST(req('/x', { method: 'POST', body: {} }), ctxOf({ id: 'nope' }))).status).toBe(404);
        expect(h.disableMfa).not.toHaveBeenCalled();
    });

    it('revocar una sesion ajena -> 404 sin revocar; una propia del usuario -> revokeSession(jti, userId, exp)', async () => {
        const { DELETE } = await import('./[id]/sessions/[jti]/route');
        const foreign = await DELETE(req('/x', { method: 'DELETE' }), ctxOf({ id: 'u2', jti: 'jti-own' }));
        expect(foreign.status).toBe(404);
        expect(h.revokeSession).not.toHaveBeenCalled();
        expect((await DELETE(req('/x', { method: 'DELETE' }), ctxOf({ id: 'u1', jti: 'x'.repeat(201) }))).status).toBe(404);

        const ok = await DELETE(req('/x', { method: 'DELETE' }), ctxOf({ id: 'u1', jti: 'jti-own' }));
        expect(ok.status).toBe(200);
        const [jti, userId, exp] = h.revokeSession.mock.calls[0] as unknown as [string, string, number];
        expect([jti, userId]).toEqual(['jti-own', 'u1']);
        expect(exp).toBeGreaterThan(Date.now() / 1000);
        expect(auditEvents()).toEqual(['admin.users.session_revoked']);
    });

    it('cerrar todas las sesiones: revokeAllSessions + auditoria; 404 si el usuario no existe', async () => {
        const { DELETE } = await import('./[id]/sessions/route');
        expect((await DELETE(req('/x', { method: 'DELETE' }), ctxOf({ id: 'nope' }))).status).toBe(404);
        expect((await DELETE(req('/x', { method: 'DELETE' }), ctxOf({ id: 'u1' }))).status).toBe(200);
        expect(h.revokeAll).toHaveBeenCalledWith('u1');
        expect(auditEvents()).toEqual(['admin.users.sessions_revoked']);
    });

    it('contrasena temporal: aleatoria (>=16, cumple politica), hash bcrypt, mustChange, sesiones cerradas, no-store y auditoria SIN el valor', async () => {
        const { POST } = await import('./[id]/password/route');
        const { validateNewPassword } = await import('@/lib/security');
        const res = await POST(req('/x', { method: 'POST', body: { mode: 'temporary' } }), ctxOf({ id: 'u1' }));
        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('no-store');
        const { temporaryPassword } = await res.json();
        expect(temporaryPassword.length).toBeGreaterThanOrEqual(16);
        expect(validateNewPassword(temporaryPassword, 'u1@x.test')).toBeNull();
        const stored = (h.userUpdate.mock.calls[0] as any)[0].data.password;
        expect(stored).not.toBe(temporaryPassword);
        expect(await bcrypt.compare(temporaryPassword, stored)).toBe(true);
        expect(h.setMustChange).toHaveBeenCalledWith('u1', true);
        expect(h.revokeAll).toHaveBeenCalledWith('u1');
        expect(JSON.stringify(h.audit)).not.toContain(temporaryPassword);
        expect(JSON.stringify(h.audit)).not.toContain(stored);
        expect(auditEvents()).toEqual(['admin.users.password_reset']);

        // dos generaciones distintas
        const again = await (await POST(req('/x', { method: 'POST', body: { mode: 'temporary' } }), ctxOf({ id: 'u1' }))).json();
        expect(again.temporaryPassword).not.toBe(temporaryPassword);
    });

    it('contrasena: valida el modo (400), no sobre ti mismo (409) y 404', async () => {
        const { POST } = await import('./[id]/password/route');
        expect((await POST(req('/x', { method: 'POST', body: { mode: 'email' } }), ctxOf({ id: 'u1' }))).status).toBe(400);
        expect((await POST(req('/x', { method: 'POST', body: { mode: 'temporary' } }), ctxOf({ id: 'admin1' }))).status).toBe(409);
        expect((await POST(req('/x', { method: 'POST', body: { mode: 'temporary' } }), ctxOf({ id: 'nope' }))).status).toBe(404);
        expect(h.userUpdate).not.toHaveBeenCalled();
    });

    it('forzar cambio de contrasena: marca y cierra sesiones solo si se pide', async () => {
        const { POST } = await import('./[id]/force-password-change/route');
        await POST(req('/x', { method: 'POST', body: {} }), ctxOf({ id: 'u1' }));
        expect(h.setMustChange).toHaveBeenCalledWith('u1', true);
        expect(h.revokeAll).not.toHaveBeenCalled();
        await POST(req('/x', { method: 'POST', body: { revokeSessions: true } }), ctxOf({ id: 'u1' }));
        expect(h.revokeAll).toHaveBeenCalledWith('u1');
        expect((await POST(req('/x', { method: 'POST', body: { revokeSessions: 'si' } }), ctxOf({ id: 'u1' }))).status).toBe(400);
    });
});

describe('POST /api/admin/users/bulk', () => {
    const bulk = async (body: unknown) => (await import('./bulk/route')).POST(req('/x', { method: 'POST', body }));

    it('valida ids (1..100) y accion', async () => {
        expect((await bulk({ ids: [], action: 'disable' })).status).toBe(400);
        expect((await bulk({ ids: Array.from({ length: 101 }, (_, i) => `u${i}`), action: 'disable' })).status).toBe(400);
        expect((await bulk({ ids: ['u1'], action: 'delete' })).status).toBe(400);
        expect((await bulk({ ids: ['x'.repeat(201)], action: 'disable' })).status).toBe(400);
    });

    it('resultado por id: nunca deshabilita al propio admin, marca inexistentes y audita por usuario', async () => {
        const res = await bulk({ ids: ['u1', 'admin1', 'ghost', 'u1'], action: 'disable' });
        const body = await res.json();
        expect(body.results).toEqual([
            { id: 'u1', result: 'ok' },
            { id: 'admin1', result: 'skipped_self' },
            { id: 'ghost', result: 'not_found' },
        ]);
        expect(body.summary).toEqual({ ok: 1, notFound: 1, skippedSelf: 1, forbiddenLevel: 0, failed: 0 });
        expect(h.setDisabled).toHaveBeenCalledTimes(1);
        expect(h.setDisabled).toHaveBeenCalledWith('u1', true);
        expect(h.revokeAll).toHaveBeenCalledWith('u1');
        expect(auditEvents()).toEqual(['admin.users.disabled']);
        expect(h.audit[0].data.targetUserId).toBe('u1');
    });

    it('enable y revokeSessions', async () => {
        const en = await (await bulk({ ids: ['u1', 'u2'], action: 'enable' })).json();
        expect(en.summary.ok).toBe(2);
        expect(h.setDisabled).toHaveBeenCalledWith('u2', false);
        expect(h.revokeAll).not.toHaveBeenCalled();
        const rv = await (await bulk({ ids: ['u1', 'admin1'], action: 'revokeSessions' })).json();
        expect(rv.summary.ok).toBe(2);
        expect(h.revokeAll).toHaveBeenCalledTimes(2);
    });

    it('un fallo de un usuario no detiene al resto', async () => {
        h.setDisabled.mockResolvedValueOnce(false);
        const body = await (await bulk({ ids: ['u1', 'u2'], action: 'enable' })).json();
        expect(body.results).toEqual([{ id: 'u1', result: 'failed' }, { id: 'u2', result: 'ok' }]);
    });
});

describe('GET /api/admin/users/export', () => {
    it('CSV con columnas en lista blanca, mismos filtros, formulas neutralizadas y auditoria solo con conteos', async () => {
        const { GET } = await import('./export/route');
        h.total = 2;
        h.rows = [
            { id: 'u1', name: '=HYPERLINK("http://evil")', email: 'a@x.test', hasAvatar: true, createdAt: new Date('2025-01-01T00:00:00Z'), disabled: false, lastLoginAt: null, isAdmin: false, mfaEnabled: false, googleLinked: false, storageBytes: 10 },
            { id: 'u2', name: '+SUM(A1)', email: '@b@x.test', hasAvatar: false, createdAt: new Date('2025-01-02T00:00:00Z'), disabled: true, lastLoginAt: new Date('2025-01-03T00:00:00Z'), isAdmin: true, mfaEnabled: true, googleLinked: true, storageBytes: 0 },
        ];
        const res = await GET(req('/api/admin/users/export?status=disabled&q=ann'));
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/csv');
        expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="users-\d{4}-\d{2}-\d{2}\.csv"/);
        const text = (await res.text()).replace(/^﻿/, '');
        const [header, ...lines] = text.trim().split('\r\n');
        expect(header).toBe('id,name,email,createdAt,disabled,isAdmin,mfaEnabled,googleLinked,lastLoginAt,storageBytes');
        expect(lines).toHaveLength(2);
        expect(text).toContain(`'=HYPERLINK`);
        expect(text).toContain(`'+SUM(A1)`);
        expect(text).toContain(`'@b@x.test`);
        expect(text).not.toMatch(/password|token|avatar|hash/i);
        const { sql, params } = mainSelect();
        expect(sql).toContain('ILIKE $1');
        expect(params[0]).toBe('%ann%');
        expect(params.slice(-2)).toEqual([10000, 0]);
        expect(h.audit).toHaveLength(1);
        expect(h.audit[0].event).toBe('admin.users.exported');
        expect(h.audit[0].data).toMatchObject({ count: 2, total: 2 });
        expect(JSON.stringify(h.audit)).not.toContain('HYPERLINK');
    });
});

describe('cuentas vinculadas', () => {
    it('GET: nunca devuelve tokens, consulta solo booleanos/fechas, enmascara el id y deriva integraciones', async () => {
        const { GET } = await import('../accounts/route');
        h.total = 1;
        h.providers = ['google', 'zoom'];
        h.accountRows = [{
            id: 'a1', userId: 'u1', userEmail: 'ann@x.test', userName: 'Ann', provider: 'google', providerAccountId: '1234567890123',
            scope: 'openid https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/contacts.readonly', expiresAt: 1_900_000_000,
            hasRefresh: true, status: 'valid',
            // Si por error la consulta devolviera tokens, no deben llegar a la respuesta:
            access_token: 'SECRET_ACCESS', refresh_token: 'SECRET_REFRESH', id_token: 'SECRET_ID',
        }];
        const res = await GET(req('/api/admin/accounts?provider=google&status=valid&q=ann&page=1&pageSize=1000'));
        const text = await res.text();
        expect(text).not.toMatch(/SECRET|access_token|refresh_token|id_token/);
        const body = JSON.parse(text);
        expect(body.accounts[0]).toMatchObject({
            id: 'a1', provider: 'google', providerAccountId: '123…23', status: 'valid', hasRefreshToken: true, integrations: ['calendar', 'contacts'],
        });
        expect(body.accounts[0].scopes).toContain('openid');
        expect(body.providers).toEqual(['google', 'zoom']);
        expect(body.page).toMatchObject({ pageSize: 100, total: 1 });

        const sel = h.calls.find((c) => c.sql.includes('"userEmail"'))!;
        expect(sel.sql).not.toContain('id_token');
        // Toda mencion de un token esta dentro de una comprobacion booleana (COALESCE(...) = '' / IS NOT NULL / <> ''), nunca como columna.
        const bare = sel.sql
            .replace(/COALESCE\(a\."(access|refresh)_token", ''\)/g, '')
            .replace(/a\."refresh_token" (IS NOT NULL|<>)/g, '');
        expect(bare).not.toMatch(/(access|refresh)_token/);
        expect(sel.sql).toContain(`(a."refresh_token" IS NOT NULL AND a."refresh_token" <> '') AS "hasRefresh"`);
        expect(sel.params).toEqual(expect.arrayContaining(['%ann%', 'google', 'valid']));
        expect(sel.sql).not.toContain('ann');
    });

    it('filtros invalidos = 400', async () => {
        const { GET } = await import('../accounts/route');
        expect((await GET(req('/api/admin/accounts?status=broken'))).status).toBe(400);
        expect((await GET(req("/api/admin/accounts?provider=goo';--"))).status).toBe(400);
    });

    it('desvincular: borra, audita proveedor y usuario sin tokens; 404 si no existe', async () => {
        const { DELETE } = await import('../accounts/[id]/route');
        expect((await DELETE(req('/x', { method: 'DELETE' }), ctxOf({ id: 'nope' }))).status).toBe(404);
        h.accountBrief = { id: 'a1', userId: 'u1', provider: 'google', hasRefresh: true };
        const res = await DELETE(req('/x', { method: 'DELETE' }), ctxOf({ id: 'a1' }));
        expect(res.status).toBe(200);
        expect(h.calls.at(-1)!.sql).toContain('DELETE FROM "Account"');
        expect(h.calls.at(-1)!.params).toEqual(['a1']);
        expect(auditEvents()).toEqual(['admin.accounts.unlinked']);
        expect(h.audit[0].data).toMatchObject({ provider: 'google', targetUserId: 'u1', accountId: 'a1' });
        expect(JSON.stringify(h.audit)).not.toMatch(/token/i);
    });

    it('pedir reconexion: anula tokens (por defecto), modo suave solo el access token, audita', async () => {
        const { POST } = await import('../accounts/[id]/reconnect/route');
        expect((await POST(req('/x', { method: 'POST', body: {} }), ctxOf({ id: 'nope' }))).status).toBe(404);
        expect((await POST(req('/x', { method: 'POST', body: { mode: 'nuke' } }), ctxOf({ id: 'a1' }))).status).toBe(400);

        h.accountBrief = { id: 'a1', userId: 'u1', provider: 'google', hasRefresh: true };
        expect((await POST(req('/x', { method: 'POST', body: {} }), ctxOf({ id: 'a1' }))).status).toBe(200);
        expect(h.calls.at(-1)!.sql).toContain(`"access_token" = NULL, "refresh_token" = NULL`);
        expect((await POST(req('/x', { method: 'POST', body: { mode: 'refresh' } }), ctxOf({ id: 'a1' }))).status).toBe(200);
        expect(h.calls.at(-1)!.sql).toContain(`"access_token" = NULL, "expires_at" = 0`);
        expect(h.calls.at(-1)!.sql).not.toContain('refresh_token');
        expect(auditEvents()).toEqual(['admin.accounts.reconnect_requested', 'admin.accounts.reconnect_requested']);

        h.accountBrief = { id: 'a2', userId: 'u1', provider: 'zoom', hasRefresh: false };
        expect((await POST(req('/x', { method: 'POST', body: { mode: 'refresh' } }), ctxOf({ id: 'a2' }))).status).toBe(409);
    });
});
