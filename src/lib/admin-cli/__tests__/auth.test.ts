import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Autenticacion de /api/admin/cli/**: sin credenciales, usuario normal, token invalido/caducado/revocado, usuario que dejo de
 * ser admin, manager que dejo de ser dueno. Todo falla cerrado (401/403) y nunca se cae a la cookie con un Authorization raro.
 */

const state = {
    verify: vi.fn(),
    requireAdmin: vi.fn(),
    user: null as null | { id: string; email: string },
    userState: { disabled: false } as { disabled: boolean } | null,
    admins: 'boss@example.test',
    ownership: { ok: true, managerId: 'm1', email: 'mgr@example.test' } as any,
    instance: 'mail.example.test',
};

vi.mock('@/lib/admin-cli/tokens', async (orig) => ({ ...(await orig<any>()), verifyCliToken: (...a: unknown[]) => state.verify(...a) }));
vi.mock('@/lib/admin-auth', () => ({ requireLevel: (...a: unknown[]) => state.requireAdmin(...a), requireAdmin: (...a: unknown[]) => state.requireAdmin(...a), markTrustedAdminRequest: () => undefined }));
vi.mock('@/lib/permissions', () => ({ refreshPermissions: async () => undefined }));
vi.mock('@/lib/privileged-session', () => ({ enterPrivileged: async () => ({ ok: true }), isLocked: async () => false, getEnd: async () => null }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: async () => state.user } } }));
vi.mock('@/lib/admin/user-state', () => ({ getUserState: async () => state.userState }));
vi.mock('@/lib/backend-auth', () => ({ ownDomains: () => [state.instance] }));
vi.mock('@/lib/manager-auth', () => ({ verifyManagerCookieOwnsInstance: async () => state.ownership }));

import { authenticateCli } from '../auth';

const tok = `bxa_${'A'.repeat(43)}`;
const req = (headers: Record<string, string> = {}) => new NextRequest('http://localhost/api/admin/cli/exec', { method: 'POST', headers });
const record = (over: Record<string, unknown> = {}) => ({ id: 'tid-1', name: 'laptop', kind: 'user', adminId: 'u1', adminEmail: 'boss@example.test', scopes: ['read'], permissionLevel: 4, tokenClass: 'interactive', domain: 'mail.example.test', expiresAt: new Date(Date.now() + 1e6).toISOString(), ...over });
const status = async (r: Awaited<ReturnType<typeof authenticateCli>>) => (r.ok ? 200 : r.response.status);
const code = async (r: Awaited<ReturnType<typeof authenticateCli>>) => (r.ok ? null : (await r.response.json()).code);

beforeEach(() => {
    state.verify.mockReset();
    state.requireAdmin.mockReset();
    state.user = { id: 'u1', email: 'boss@example.test' };
    state.userState = { disabled: false };
    state.ownership = { ok: true, managerId: 'm1', email: 'mgr@example.test' };
    state.instance = 'mail.example.test';
    state.admins = 'boss@example.test';
    process.env.ADMIN_EMAILS = state.admins;
});

describe('consola web (cookie)', () => {
    it('sin cabecera X-Requested-With: 403 (defensa CSRF) y ni siquiera consulta la sesion', async () => {
        const r = await authenticateCli(req());
        expect(await status(r)).toBe(403);
        expect(await code(r)).toBe('console_header_required');
        expect(state.requireAdmin).not.toHaveBeenCalled();
    });
    it('sin sesion: 401; usuario normal (no admin) o sin MFA: 403', async () => {
        state.requireAdmin.mockResolvedValueOnce({ ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
        expect(await status(await authenticateCli(req({ 'x-requested-with': 'bloomx-console' })))).toBe(401);
        state.requireAdmin.mockResolvedValueOnce({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
        expect(await status(await authenticateCli(req({ 'x-requested-with': 'bloomx-console' })))).toBe(403);
    });
    it('admin valido: ambito completo y manager reenvia SU cookie', async () => {
        state.requireAdmin.mockResolvedValueOnce({ ok: true, actor: { kind: 'manager', id: 'm1', email: 'mgr@example.test' } });
        const r = await authenticateCli(new NextRequest('http://localhost/x', { method: 'POST', headers: { 'x-requested-with': 'bloomx-console', cookie: 'auth_session=abc' } }));
        expect(r.ok && r.auth.session.scopes).toEqual(['read', 'write', 'security']);
        expect(r.ok && r.auth.managerSession).toBe('abc');
    });
});

describe('token de CLI (Bearer)', () => {
    it('Authorization con formato raro: 401 y NO se cae a la cookie', async () => {
        for (const h of ['Basic abc', 'Bearer', 'Bearer a b', 'bxa_token']) expect(await status(await authenticateCli(req({ authorization: h, 'x-requested-with': 'bloomx-console' })))).toBe(401);
        expect(state.requireAdmin).not.toHaveBeenCalled();
    });
    it.each(['malformed', 'unknown', 'revoked', 'expired', 'unavailable'])('token %s: 401', async (reason) => {
        state.verify.mockResolvedValueOnce({ ok: false, reason });
        const r = await authenticateCli(req({ authorization: `Bearer ${tok}` }));
        expect(await status(r)).toBe(401);
        expect(await code(r)).toBe(reason === 'unavailable' ? 'service_unavailable' : `token_${reason}`);
    });
    it('token valido de usuario admin: actor y ambitos del token', async () => {
        state.verify.mockResolvedValueOnce({ ok: true, record: record({ scopes: ['read', 'write'] }), managerSession: null });
        const r = await authenticateCli(req({ authorization: `Bearer ${tok}` }));
        expect(r.ok && r.auth.actor).toMatchObject({ kind: 'user', id: 'u1', email: 'boss@example.test', level: 4, levelSource: 'env' });
        expect(r.ok && r.auth.session).toMatchObject({ source: 'token', scopes: ['read', 'write'], tokenId: 'tid-1' });
    });
    it('el usuario ya no es admin / esta deshabilitado / no existe: 403', async () => {
        state.admins = 'otro@example.test';
        process.env.ADMIN_EMAILS = state.admins;
        state.verify.mockResolvedValueOnce({ ok: true, record: record(), managerSession: null });
        expect(await status(await authenticateCli(req({ authorization: `Bearer ${tok}` })))).toBe(403);
        state.admins = 'boss@example.test';
        process.env.ADMIN_EMAILS = state.admins;
        state.userState = { disabled: true };
        state.verify.mockResolvedValueOnce({ ok: true, record: record(), managerSession: null });
        expect(await status(await authenticateCli(req({ authorization: `Bearer ${tok}` })))).toBe(403);
        state.userState = { disabled: false };
        state.user = null;
        state.verify.mockResolvedValueOnce({ ok: true, record: record(), managerSession: null });
        expect(await status(await authenticateCli(req({ authorization: `Bearer ${tok}` })))).toBe(403);
    });
    it('un fallo al leer el estado del usuario falla cerrado', async () => {
        state.userState = null;
        state.verify.mockResolvedValueOnce({ ok: true, record: record(), managerSession: null });
        expect(await status(await authenticateCli(req({ authorization: `Bearer ${tok}` })))).toBe(403);
    });
    it('token emitido para OTRO dominio: 403', async () => {
        state.verify.mockResolvedValueOnce({ ok: true, record: record({ domain: 'otra.example.test' }), managerSession: null });
        const r = await authenticateCli(req({ authorization: `Bearer ${tok}` }));
        expect(await status(r)).toBe(403);
        expect(await code(r)).toBe('domain_mismatch');
    });
    it('manager: sin cookie guardada o ya no es dueno => 401; backend caido => 403; dueno => ok', async () => {
        state.verify.mockResolvedValueOnce({ ok: true, record: record({ kind: 'manager' }), managerSession: null });
        expect(await status(await authenticateCli(req({ authorization: `Bearer ${tok}` })))).toBe(401);
        state.ownership = { ok: false, reason: 'not_owner' };
        state.verify.mockResolvedValueOnce({ ok: true, record: record({ kind: 'manager' }), managerSession: 'cookie' });
        expect(await status(await authenticateCli(req({ authorization: `Bearer ${tok}` })))).toBe(401);
        state.ownership = { ok: false, reason: 'backend_unavailable' };
        state.verify.mockResolvedValueOnce({ ok: true, record: record({ kind: 'manager' }), managerSession: 'cookie' });
        expect(await status(await authenticateCli(req({ authorization: `Bearer ${tok}` })))).toBe(403);
        state.ownership = { ok: true, managerId: 'm1', email: 'mgr@example.test' };
        state.verify.mockResolvedValueOnce({ ok: true, record: record({ kind: 'manager' }), managerSession: 'cookie' });
        const r = await authenticateCli(req({ authorization: `Bearer ${tok}` }));
        expect(r.ok && r.auth.actor.kind).toBe('manager');
        expect(r.ok && r.auth.managerSession).toBe('cookie');
    });
});
