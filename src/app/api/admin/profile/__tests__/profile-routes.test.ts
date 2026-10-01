import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';

/**
 * Rutas /api/admin/profile*: perfil, cambio de contrasena y sesiones propias, con dobles (sin BD, red ni backend reales).
 */

type Actor = { kind: 'user'; id: string; email: string } | { kind: 'manager'; id?: string; email?: string };
let guard: { ok: true; actor: Actor } | { ok: false; response: NextResponse };
const userActor: Actor = { kind: 'user', id: 'u1', email: 'admin@empresa.com' };

const mocks = vi.hoisted(() => ({
    auditLog: vi.fn(),
    rateLimitAsync: vi.fn(async () => ({ ok: true, retryAfter: 0, backend: 'memory' })),
    findUnique: vi.fn(),
    update: vi.fn(),
    getSessionCookie: vi.fn(),
    getCurrentUser: vi.fn(),
    revokeAllSessions: vi.fn(async () => true),
    setSessionCookie: vi.fn(async () => 'TOKEN-SECRETO'),
    setMustChangePassword: vi.fn(async () => true),
    getUserState: vi.fn(),
    listActiveSessions: vi.fn(),
    findSessionOfUser: vi.fn(),
    revokeSession: vi.fn(async () => true),
    getMfaStatus: vi.fn(),
    mfaRequiredFor: vi.fn(() => true),
}));

vi.mock('@/lib/admin-auth', () => {
    const guardFn = vi.fn(async () => guard);
    // adminRoute usa requireLevel(n): en estas pruebas el nivel no se evalua (lo cubre admin-levels.test / admin-cli.pg.test)
    return { requireAdmin: guardFn, requireLevel: (_min: number, ...a: unknown[]) => (guardFn as (...x: unknown[]) => unknown)(...a) };
});
vi.mock('@/lib/security', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/security')>()),
    auditLog: mocks.auditLog,
    rateLimitAsync: mocks.rateLimitAsync,
    getClientIp: () => '9.9.9.9',
}));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.findUnique, update: mocks.update } } }));
vi.mock('@/lib/session', () => ({
    getSessionCookie: mocks.getSessionCookie,
    getCurrentUser: mocks.getCurrentUser,
    revokeAllSessions: mocks.revokeAllSessions,
    setSessionCookie: mocks.setSessionCookie,
}));
vi.mock('@/lib/admin/user-state', () => ({ setMustChangePassword: mocks.setMustChangePassword, getUserState: mocks.getUserState }));
vi.mock('@/lib/admin/session-registry', () => ({ listActiveSessions: mocks.listActiveSessions, findSessionOfUser: mocks.findSessionOfUser }));
vi.mock('@/lib/session-revocation', () => ({ revokeSession: mocks.revokeSession }));
vi.mock('@/lib/mfa', () => ({ getMfaStatus: mocks.getMfaStatus, mfaRequiredFor: mocks.mfaRequiredFor }));

import { GET as getProfile } from '../route';
import { PUT as putPassword } from '../password/route';
import { GET as getSessions, DELETE as deleteOthers } from '../sessions/route';
import { DELETE as deleteOne } from '../sessions/[jti]/route';

const req = (method: string, url: string, body?: unknown) =>
    new NextRequest(`http://localhost${url}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
const ctx = (params: { jti: string }) => ({ params: Promise.resolve(params) });

const CURRENT = 'Contrasena-Actual-123';
let currentHash = '';
beforeAll(async () => { currentHash = await bcrypt.hash(CURRENT, 4); });

beforeEach(() => {
    vi.clearAllMocks();
    guard = { ok: true, actor: userActor };
    mocks.rateLimitAsync.mockResolvedValue({ ok: true, retryAfter: 0, backend: 'memory' });
    mocks.findUnique.mockResolvedValue({ id: 'u1', email: 'admin@empresa.com', name: 'Ada', password: currentHash });
    mocks.getSessionCookie.mockResolvedValue({ jti: 'jti-actual', mfa: true });
    mocks.getCurrentUser.mockResolvedValue({ id: 'u1', email: 'admin@empresa.com', name: 'Ada', avatar: 'https://cdn.test/a.png' });
    mocks.getUserState.mockResolvedValue({ disabled: false, mustChangePassword: true, lastLoginAt: '2026-09-01T10:00:00.000Z', lastLoginIp: '1.2.3.4' });
    mocks.getMfaStatus.mockResolvedValue({ available: true, enabled: true, pendingEnrollment: false, recoveryCodesLeft: 7 });
    mocks.listActiveSessions.mockResolvedValue([]);
});

describe('acceso: 401 / 403', () => {
    const cases: Array<[string, () => Promise<Response>]> = [
        ['GET profile', () => getProfile(req('GET', '/api/admin/profile'))],
        ['PUT password', () => putPassword(req('PUT', '/api/admin/profile/password', { currentPassword: 'a', newPassword: 'b' }))],
        ['GET sessions', () => getSessions(req('GET', '/api/admin/profile/sessions'))],
        ['DELETE sessions', () => deleteOthers(req('DELETE', '/api/admin/profile/sessions'))],
        ['DELETE session', () => deleteOne(req('DELETE', '/api/admin/profile/sessions/x'), ctx({ jti: 'x' }))],
    ];
    for (const [name, call] of cases) {
        it(`${name}: sin sesion 401 y sin rol 403`, async () => {
            guard = { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
            expect((await call()).status).toBe(401);
            guard = { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
            expect((await call()).status).toBe(403);
            expect(mocks.revokeAllSessions).not.toHaveBeenCalled();
            expect(mocks.update).not.toHaveBeenCalled();
            expect(mocks.revokeSession).not.toHaveBeenCalled();
        });
    }
});

describe('GET /api/admin/profile', () => {
    it('usuario: perfil, MFA (con politica) y resumen de sesiones, sin secretos', async () => {
        mocks.listActiveSessions.mockResolvedValue([{ jti: 'a' }, { jti: 'b' }]);
        const res = await getProfile(req('GET', '/api/admin/profile'));
        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('no-store');
        const data = await res.json();
        expect(data.me).toMatchObject({ kind: 'user', email: 'admin@empresa.com', name: 'Ada', mustChangePassword: true, lastLoginAt: '2026-09-01T10:00:00.000Z' });
        expect(data.mfa).toEqual({ available: true, enabled: true, pendingEnrollment: false, recoveryCodesLeft: 7, required: true });
        expect(data.sessions).toEqual({ active: 2 });
        expect(typeof data.instanceSigning).toBe('boolean');
        expect(JSON.stringify(data)).not.toMatch(/"password"|secret|hash/i);
    });

    it('descarta avatares no seguros (javascript:, http)', async () => {
        mocks.getCurrentUser.mockResolvedValue({ id: 'u1', email: 'admin@empresa.com', name: null, avatar: 'javascript:alert(1)' });
        expect((await (await getProfile(req('GET', '/api/admin/profile'))).json()).me.avatar).toBeNull();
    });

    it('manager: solo identidad, sin MFA ni sesiones', async () => {
        guard = { ok: true, actor: { kind: 'manager', id: 'm1', email: 'gestor@empresa.com' } };
        const data = await (await getProfile(req('GET', '/api/admin/profile'))).json();
        expect(data.me).toMatchObject({ kind: 'manager', id: 'm1', email: 'gestor@empresa.com' });
        expect(data.mfa).toBeNull();
        expect(data.sessions).toBeNull();
        expect(mocks.getMfaStatus).not.toHaveBeenCalled();
    });
});

describe('PUT /api/admin/profile/password', () => {
    const put = (body: unknown) => putPassword(req('PUT', '/api/admin/profile/password', body));

    it('limite estricto 5 por 15 min y 429 al superarlo', async () => {
        await put({ currentPassword: 'x', newPassword: 'y' });
        expect(mocks.rateLimitAsync).toHaveBeenCalledWith('admin:profile.password:u1', 5, 15 * 60_000);
        mocks.rateLimitAsync.mockResolvedValue({ ok: false, retryAfter: 120, backend: 'memory' });
        const res = await put({ currentPassword: CURRENT, newPassword: 'Nueva-Contrasena-Larga-9' });
        expect(res.status).toBe(429);
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('manager: 409 (su contrasena vive en el backend)', async () => {
        guard = { ok: true, actor: { kind: 'manager', id: 'm1' } };
        const res = await put({ currentPassword: CURRENT, newPassword: 'Nueva-Contrasena-Larga-9' });
        expect(res.status).toBe(409);
        expect((await res.json()).code).toBe('not_available_for_manager');
    });

    it('cuerpo invalido -> 400 sin repetir valores', async () => {
        const res = await put({ currentPassword: 'SECRETO-ACTUAL' });
        expect(res.status).toBe(400);
        expect(JSON.stringify(await res.json())).not.toContain('SECRETO-ACTUAL');
    });

    it('contrasena actual incorrecta -> 400 y nada cambia', async () => {
        const res = await put({ currentPassword: 'No-Es-Esta-123456', newPassword: 'Nueva-Contrasena-Larga-9' });
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('incorrect_current_password');
        expect(mocks.update).not.toHaveBeenCalled();
        expect(mocks.revokeAllSessions).not.toHaveBeenCalled();
        expect(mocks.setSessionCookie).not.toHaveBeenCalled();
    });

    it('politica corta (<12) -> 400 password_too_short', async () => {
        const res = await put({ currentPassword: CURRENT, newPassword: 'Corta-1' });
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('password_too_short');
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('igual a la actual -> 400 password_unchanged', async () => {
        const res = await put({ currentPassword: CURRENT, newPassword: CURRENT });
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('password_unchanged');
    });

    it('exito: hash nuevo, revoca todas, reemite con mfa, limpia mustChange y audita sin valores', async () => {
        const NEW = 'Nueva-Contrasena-Larga-9';
        const res = await put({ currentPassword: CURRENT, newPassword: NEW });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ success: true });

        const call = mocks.update.mock.calls[0][0];
        expect(call.where).toEqual({ id: 'u1' });
        expect(call.data.password).not.toBe(NEW);
        expect(await bcrypt.compare(NEW, call.data.password)).toBe(true);

        expect(mocks.revokeAllSessions).toHaveBeenCalledWith('u1');
        expect(mocks.setSessionCookie).toHaveBeenCalledWith({ sub: 'u1', email: 'admin@empresa.com', name: 'Ada' }, { mfa: true });
        expect(mocks.setMustChangePassword).toHaveBeenCalledWith('u1', false);

        const events = mocks.auditLog.mock.calls.map((c) => c[0]);
        expect(events).toContain('admin.profile.password_changed');
        const dump = JSON.stringify(mocks.auditLog.mock.calls) + JSON.stringify(body);
        expect(dump).not.toContain(NEW);
        expect(dump).not.toContain(CURRENT);
        expect(dump).not.toContain(call.data.password);
        expect(dump).not.toContain('TOKEN-SECRETO');
    });

    it('conserva mfa=false si la sesion actual no lo tenia', async () => {
        mocks.getSessionCookie.mockResolvedValue({ jti: 'j', mfa: undefined });
        await put({ currentPassword: CURRENT, newPassword: 'Nueva-Contrasena-Larga-9' });
        expect(mocks.setSessionCookie).toHaveBeenCalledWith(expect.anything(), { mfa: false });
    });
});

describe('sesiones propias', () => {
    const row = (jti: string, extra: object = {}) => ({
        jti, userId: 'u1', tv: 0, mfa: true, ip: '1.1.1.1', userAgent: 'A'.repeat(300), createdAt: '2026-09-01T00:00:00.000Z', expiresAt: '2026-10-01T00:00:00.000Z', ...extra,
    });

    it('GET marca "esta sesion" por jti y recorta el agente', async () => {
        mocks.listActiveSessions.mockResolvedValue([row('jti-actual'), row('otra')]);
        const data = await (await getSessions(req('GET', '/api/admin/profile/sessions'))).json();
        expect(mocks.listActiveSessions).toHaveBeenCalledWith('u1');
        expect(data.sessions.map((s: any) => [s.jti, s.current])).toEqual([['jti-actual', true], ['otra', false]]);
        expect(data.sessions[0].userAgent.length).toBeLessThanOrEqual(120);
        expect(Object.keys(data.sessions[0]).sort()).toEqual(['createdAt', 'current', 'expiresAt', 'ip', 'jti', 'mfa', 'userAgent']);
    });

    it('DELETE [jti]: una sesion AJENA -> 404 y no se revoca', async () => {
        mocks.findSessionOfUser.mockResolvedValue(null);
        const res = await deleteOne(req('DELETE', '/api/admin/profile/sessions/de-otro'), ctx({ jti: 'de-otro' }));
        expect(res.status).toBe(404);
        expect(mocks.findSessionOfUser).toHaveBeenCalledWith('u1', 'de-otro');
        expect(mocks.revokeSession).not.toHaveBeenCalled();
    });

    it('DELETE [jti]: propia -> revoca con su caducidad y audita un identificador corto', async () => {
        mocks.findSessionOfUser.mockResolvedValue({ jti: 'propia-0123456789', expiresAt: new Date('2026-10-01T00:00:00.000Z') });
        const res = await deleteOne(req('DELETE', '/api/admin/profile/sessions/propia-0123456789'), ctx({ jti: 'propia-0123456789' }));
        expect(res.status).toBe(200);
        expect(mocks.revokeSession).toHaveBeenCalledWith('propia-0123456789', 'u1', Math.floor(Date.parse('2026-10-01T00:00:00.000Z') / 1000));
        const audited = mocks.auditLog.mock.calls.find((c) => c[0] === 'admin.profile.session_revoked');
        expect(audited?.[1].session).toBe('propia-0');
    });

    it('DELETE [jti]: la sesion actual -> 409 (para eso esta cerrar sesion)', async () => {
        mocks.findSessionOfUser.mockResolvedValue({ jti: 'jti-actual', expiresAt: new Date() });
        const res = await deleteOne(req('DELETE', '/api/admin/profile/sessions/jti-actual'), ctx({ jti: 'jti-actual' }));
        expect(res.status).toBe(409);
        expect(mocks.revokeSession).not.toHaveBeenCalled();
    });

    it('DELETE [jti]: identificador con caracteres raros -> 400 sin consultar', async () => {
        const res = await deleteOne(req('DELETE', '/api/admin/profile/sessions/x'), ctx({ jti: "a'; DROP TABLE" }));
        expect(res.status).toBe(400);
        expect(mocks.findSessionOfUser).not.toHaveBeenCalled();
    });

    it('DELETE todas las demas: sube tokenVersion y reemite la actual conservando mfa', async () => {
        mocks.listActiveSessions.mockResolvedValue([row('jti-actual'), row('b'), row('c')]);
        const res = await deleteOthers(req('DELETE', '/api/admin/profile/sessions'));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true, revoked: 2 });
        expect(mocks.revokeAllSessions).toHaveBeenCalledWith('u1');
        expect(mocks.setSessionCookie).toHaveBeenCalledWith({ sub: 'u1', email: 'admin@empresa.com', name: 'Ada' }, { mfa: true });
        const audited = mocks.auditLog.mock.calls.find((c) => c[0] === 'admin.profile.sessions_revoked_others');
        expect(audited?.[1].count).toBe(2);
    });

    it('manager: 409 en las tres rutas', async () => {
        guard = { ok: true, actor: { kind: 'manager', id: 'm1' } };
        expect((await getSessions(req('GET', '/api/admin/profile/sessions'))).status).toBe(409);
        expect((await deleteOthers(req('DELETE', '/api/admin/profile/sessions'))).status).toBe(409);
        expect((await deleteOne(req('DELETE', '/api/admin/profile/sessions/x'), ctx({ jti: 'x' }))).status).toBe(409);
    });
});
