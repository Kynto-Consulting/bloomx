import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertLocalPg, createUser, uid } from './helpers/pg';
import { prisma } from '../prisma';
import { __defaultAuditSink, __setAuditSink } from '../audit';
import { __resetRateLimitState } from '../security';
import { issueReauthToken } from '../mail-transfer/auth';
import { __resetPermissionSnapshot, effectiveLevelSync, type PermissionLevel } from '../permissions-core';
import { getEffectiveLevel, refreshPermissions } from '../permissions';
import { callAdminRoute } from '../admin-cli/bridge';
import { executeCommand, stepUpKey, type ExecAuth } from '../admin-cli/exec';
import { authenticateCli } from '../admin-cli/auth';
import { createCliToken, verifyCliToken } from '../admin-cli/tokens';
import { query } from '../admin/sql';
import { __resetPrivilegedPolicyCache } from '../privileged-session';

/**
 * Niveles de permisos (permission_level 0..4) contra Postgres real y las rutas/comandos REALES: el admin por entorno sigue siendolo, una
 * concesion de consola da acceso y su revocacion lo quita, nadie se auto-escala ni modifica a un igual/superior, step-up con MFA, el entorno
 * fija a sus cuentas, modo LOCKED, tokens acotados por nivel, auditoria y 403 en rutas llamadas directamente.
 */

const tag = `p${Math.random().toString(36).slice(2, 8)}`;
const em = (n: string) => `${n}.${tag}@pg.test`;
const users: Record<string, { id: string; email: string }> = {};
const names = ['root', 'envboss', 'cto', 'adm', 'adm2', 'op', 'sup', 'norm', 'victim'];

beforeAll(async () => {
    assertLocalPg();
    process.env.SESSION_REVOCATION_CACHE_MS = '0';
    process.env.ADMIN_EMAILS = `${em('root')}, ${em('envboss')}`;
    delete process.env.ADMIN_EMAILS_LOCKED;
    delete process.env.MFA_ENFORCE_ADMIN;
    __setAuditSink(__defaultAuditSink);
    for (const n of names) users[n] = await createUser(prisma, em(n));
});
afterAll(async () => { __setAuditSink(null); await prisma.$disconnect(); });
beforeEach(async () => {
    __resetRateLimitState();
    __resetPermissionSnapshot();
    __resetPrivilegedPolicyCache();
    delete process.env.ADMIN_EMAILS_LOCKED;
    process.env.MFA_ENFORCE_ADMIN = 'true';
    await prisma.$executeRawUnsafe(`DELETE FROM "UserPermission" WHERE "email" LIKE $1`, `%.${tag}@pg.test`);
    await prisma.$executeRawUnsafe(`DELETE FROM "PrivilegedSession" WHERE "userId" = ANY($1::text[])`, Object.values(users).map((u) => u.id));
    await prisma.$executeRawUnsafe(`DELETE FROM "PrivilegedLock" WHERE "userId" = ANY($1::text[])`, Object.values(users).map((u) => u.id));
    await refreshPermissions({ force: true });
});

const proof = (n: string, method: 'mfa' | 'password' = 'mfa') => issueReauthToken(stepUpKey(users[n]), method, null).token;
async function as(n: string, scopes: ExecAuth['session']['scopes'] = ['read', 'write', 'security']): Promise<ExecAuth> {
    const eff = await getEffectiveLevel(users[n].email);
    return { actor: { kind: 'user', id: users[n].id, email: users[n].email, level: eff.level, levelSource: eff.source }, session: { source: 'web', scopes }, ip: '127.0.0.5', userAgent: 'vitest' };
}
const run = async (n: string, line: string, extra: { stepUp?: string | null } = {}) =>
    executeCommand({ line, confirm: true, stepUp: extra.stepUp === null ? undefined : extra.stepUp ?? proof(n) }, await as(n));
const setLevel = (actor: string, target: string, level: number, flags = '') => run(actor, `perms set ${users[target].email} ${level} ${flags}`);
const lvl = async (n: string) => (await getEffectiveLevel(users[n].email)).level;

describe('permission_level: entorno y consola', () => {
    it('un admin por ADMIN_EMAILS sigue siendolo (nivel 4 fijado por entorno) y nadie mas tiene nivel', async () => {
        expect(await getEffectiveLevel(users.root.email)).toEqual({ level: 4, source: 'env' });
        expect(await getEffectiveLevel(users.norm.email)).toEqual({ level: 0, source: 'none' });
    });

    it('una concesion de consola da acceso (y MFA obligatorio) y su revocacion lo quita', async () => {
        const g = await setLevel('root', 'op', 2);
        expect(g.ok, JSON.stringify(g.error)).toBe(true);
        expect(await getEffectiveLevel(users.op.email)).toEqual({ level: 2, source: 'console' });
        expect(effectiveLevelSync(users.op.email).level).toBe(2);
        // el operador ya puede gestionar cuentas...
        const list = await run('op', 'users list --json', { stepUp: null });
        expect(list.ok, JSON.stringify(list.error)).toBe(true);
        // ...y al revocarlo pierde todo acceso al instante (sus comandos y las rutas)
        const r = await setLevel('root', 'op', 0);
        expect(r.ok).toBe(true);
        expect(await lvl('op')).toBe(0);
        const denied = await executeCommand({ line: 'users list' }, await as('op'));
        expect(denied.error?.code).toBe('insufficient_level');
    });

    it('historial inmutable: quien, a quien, anterior -> nuevo, IP y origen', async () => {
        await setLevel('root', 'sup', 1);
        await setLevel('root', 'sup', 3);
        const rows = await query<any>(`SELECT "previousLevel","newLevel","changedBy","changedByLevel","ip","source" FROM "UserPermissionHistory" WHERE "email" = $1 ORDER BY "changedAt"`, users.sup.email);
        expect(rows.map((r) => `${r.previousLevel}>${r.newLevel}`)).toEqual(['0>1', '1>3']);
        expect(rows[0]).toMatchObject({ changedBy: users.root.email, changedByLevel: 4, ip: '127.0.0.5', source: 'cli' });
        const h = await run('root', `perms history --email ${users.sup.email} --json`, { stepUp: null });
        expect((h.json as any[]).length).toBe(2);
    });
});

describe('quien puede asignar que', () => {
    it('un admin (3) asigna 0-2 pero NO 3 ni 4; un operador (2) ni siquiera gestiona niveles', async () => {
        await setLevel('root', 'adm', 3);
        await setLevel('root', 'op', 2);
        expect((await setLevel('adm', 'sup', 2)).ok).toBe(true);
        expect((await setLevel('adm', 'norm', 3)).error?.code).toBe('level_not_assignable');
        expect((await setLevel('adm', 'norm', 4, '--confirm-super')).error?.code).toBe('level_not_assignable');
        expect((await setLevel('op', 'norm', 1)).error?.code).toBe('insufficient_level');
        expect(await lvl('norm')).toBe(0);
    });

    it('nadie modifica a alguien de nivel >= al suyo; un superadmin de consola si puede revocar a otro de consola, nunca al del entorno', async () => {
        await setLevel('root', 'adm', 3);
        await setLevel('root', 'adm2', 3);
        expect((await setLevel('adm', 'adm2', 1)).error?.code).toBe('cannot_modify_peer_or_higher');
        const c = await setLevel('root', 'cto', 4, '--confirm-super');
        expect(c.ok, JSON.stringify(c.error)).toBe(true);
        expect((await setLevel('adm', 'cto', 1)).error?.code).toBe('cannot_modify_peer_or_higher');
        expect((await setLevel('cto', 'envboss', 0)).error?.code).toBe('fixed_by_env');
        expect((await setLevel('root', 'envboss', 1)).error?.code).toBe('fixed_by_env');
        expect((await setLevel('root', 'cto', 2)).ok).toBe(true); // superadmin -> superadmin de consola
    });

    it('conceder el nivel 4 exige confirmacion explicita', async () => {
        expect((await setLevel('root', 'cto', 4)).error?.code).toBe('confirm_super_required');
        expect(await lvl('cto')).toBe(0);
        expect((await setLevel('root', 'cto', 4, '--confirm-super')).ok).toBe(true);
        expect(await lvl('cto')).toBe(4);
    });

    it('nadie se auto-escala ni se auto-degrada (ni el ultimo superadmin)', async () => {
        await setLevel('root', 'adm', 3);
        expect((await setLevel('adm', 'adm', 4, '--confirm-super')).error?.code).toBe('cannot_target_self');
        expect((await setLevel('adm', 'adm', 0)).error?.code).toBe('cannot_target_self');
        expect((await setLevel('root', 'root', 0)).error?.code).toBe('cannot_target_self');
        expect(await lvl('root')).toBe(4);
        await setLevel('root', 'cto', 4, '--confirm-super');
        expect((await setLevel('cto', 'cto', 0)).error?.code).toBe('cannot_target_self');
        // aun degradando a cto, root (entorno) conserva el acceso: la instancia nunca se queda sin superadmin
        await setLevel('root', 'cto', 0);
        expect(await lvl('root')).toBe(4);
    });

    it('la cuenta debe existir; la cuenta sin MFA solo recibe nivel si el MFA es obligatorio', async () => {
        const ghost = await run('root', `perms set ghost.${tag}@pg.test 1`);
        expect(ghost.error?.code).toBe('account_required');
        process.env.MFA_ENFORCE_ADMIN = 'false';
        const noMfa = await setLevel('root', 'sup', 1);
        expect(noMfa.error?.code).toBe('mfa_required_for_level');
        await prisma.$executeRawUnsafe(`INSERT INTO "UserMfa" ("userId","secretEnc","enabled") VALUES ($1,'enc',TRUE) ON CONFLICT ("userId") DO UPDATE SET "enabled" = TRUE`, users.sup.id);
        expect((await setLevel('root', 'sup', 1)).ok).toBe(true);
    });

    it('limite de 25 cuentas con nivel >= 3', async () => {
        const many: string[] = [];
        for (let i = 0; i < 24; i++) {
            const u = await createUser(prisma, em(`bulk${i}`));
            many.push(u.id);
            await prisma.$executeRawUnsafe(`INSERT INTO "UserPermission" ("email","userId","permission_level","grantedBy") VALUES ($1,$2,3,'test')`, u.email, u.id);
        }
        await refreshPermissions({ force: true });
        // 2 del entorno + 24 = 26 > 25: ya no se concede ninguno mas
        expect((await setLevel('root', 'adm', 3)).error?.code).toBe('privileged_limit');
        expect((await setLevel('root', 'sup', 2)).ok).toBe(true); // los niveles bajos no cuentan
        await prisma.$executeRawUnsafe(`DELETE FROM "UserPermission" WHERE "userId" = ANY($1::text[])`, many);
        await prisma.user.deleteMany({ where: { id: { in: many } } });
    });
});

describe('step-up y modo LOCKED', () => {
    it('sin step-up (o solo con contrasena) no se cambia ningun nivel', async () => {
        const none = await setLevel('root', 'op', 2).then(() => run('root', `perms set ${users.sup.email} 1`, { stepUp: null }));
        expect(none).toMatchObject({ ok: false, needs: 'stepup' });
        const pw = await run('root', `perms set ${users.sup.email} 1`, { stepUp: proof('root', 'password') });
        expect(pw).toMatchObject({ ok: false, needs: 'stepup', error: { code: 'mfa_stepup_required' } });
        expect(await lvl('sup')).toBe(0);
    });
    it('la ruta llamada directamente tambien exige step-up MFA (sin cookie de prueba: 403 reauth_required)', async () => {
        const actor = { kind: 'user' as const, id: users.root.id, email: users.root.email, level: 4 as PermissionLevel, levelSource: 'env' as const };
        const r = await callAdminRoute({ method: 'POST', path: '/permissions', body: { email: users.sup.email, permission_level: 1 } }, { actor, ip: '127.0.0.5' });
        expect(r.status).toBe(403);
        expect(r.data.code).toBe('reauth_required');
        const ok = await callAdminRoute({ method: 'POST', path: '/permissions', body: { email: users.sup.email, permission_level: 1 } }, { actor, ip: '127.0.0.5', reauthProof: proof('root') });
        expect(ok.status, JSON.stringify(ok.data)).toBe(200);
    });
    it('ADMIN_EMAILS_LOCKED=true: solo entorno; la gestion y las concesiones de consola dejan de valer', async () => {
        await setLevel('root', 'adm', 3);
        expect(await lvl('adm')).toBe(3);
        process.env.ADMIN_EMAILS_LOCKED = 'true';
        __resetPermissionSnapshot();
        expect(await lvl('adm')).toBe(0);
        expect(await lvl('root')).toBe(4);
        const r = await setLevel('root', 'sup', 1);
        expect(r.error?.code).toBe('permissions_locked');
        const list = await run('root', 'perms list --json', { stepUp: null });
        expect(list.ok).toBe(true);
        delete process.env.ADMIN_EMAILS_LOCKED;
        __resetPermissionSnapshot();
        expect(await lvl('adm')).toBe(3);
    });
});

describe('auditoria y rutas directas', () => {
    it('cada cambio y cada denegacion se audita (quien, a quien, nivel anterior -> nuevo, IP)', async () => {
        await setLevel('root', 'sup', 1);
        await setLevel('root', 'sup', 0);
        await setLevel('root', 'root', 1); // denegado
        await new Promise((r) => setTimeout(r, 400));
        const a = await run('root', `audit --event "admin.permissions.*" --json`, { stepUp: null });
        const rows = a.json as Array<{ event: string; data: string; ip: string }>;
        const changed = rows.filter((r) => r.event === 'admin.permissions.changed').map((r) => JSON.parse(r.data));
        expect(changed.length).toBeGreaterThanOrEqual(2);
        expect(changed.some((d) => d.from === 0 && d.to === 1)).toBe(true);
        expect(changed.every((d) => d.actorKind === 'user' && d.actorLevel === 4)).toBe(true);
        expect(rows.some((r) => r.event === 'admin.permissions.change_denied')).toBe(true);
        expect(JSON.stringify(rows)).not.toContain(users.sup.email); // correos enmascarados
    });

    it('las rutas rechazan con 403 aunque se llamen directamente: un usuario normal y cada nivel por debajo del suyo', async () => {
        const as_ = (level: PermissionLevel) => ({ actor: { kind: 'user' as const, id: users.norm.id, email: users.norm.email, level, levelSource: 'console' as const }, ip: '127.0.0.5' });
        const hit = async (level: PermissionLevel, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, query?: Record<string, string>) => (await callAdminRoute({ method, path, body, query }, as_(level))).status;
        expect(await hit(0, 'GET', '/users')).toBe(403);
        expect(await hit(1, 'GET', '/users')).toBe(200);
        expect(await hit(1, 'POST', '/users', { email: em('x1') })).toBe(403); // support no escribe
        expect(await hit(1, 'GET', '/permissions')).toBe(403);
        expect(await hit(2, 'GET', '/permissions')).toBe(403);
        expect(await hit(2, 'PUT', '/retention/settings', { spamDays: 10 })).toBe(403); // operator no configura
        expect(await hit(3, 'POST', '/retention/run', { dryRun: true })).toBe(403); // admin no purga
        expect(await hit(3, 'GET', '/domain-key', undefined, { domainId: 'x' })).toBe(403);
        expect(await hit(3, 'GET', '/permissions')).toBe(200);
        const created = await callAdminRoute({ method: 'POST', path: '/users', body: { email: em('op-made') } }, as_(2));
        expect(created.status, JSON.stringify(created.data)).toBe(201); // operator si crea cuentas
        expect(created.data.code).toBeUndefined();
        const body = (await callAdminRoute({ method: 'GET', path: '/users' }, as_(0))).data;
        expect(body.code).toBe('INSUFFICIENT_LEVEL');
    });

    it('un operador no puede tocar a un admin ni a un superadmin; si a un usuario normal', async () => {
        await setLevel('root', 'op', 2);
        await setLevel('root', 'adm', 3);
        const opAuth = await as('op');
        const dis = (u: string) => executeCommand({ line: `users disable ${users[u].email}`, confirm: true, stepUp: proof('op') }, opAuth);
        expect((await dis('adm')).error?.code).toBe('cannot_modify_peer_or_higher');
        expect((await dis('root')).error?.code).toBe('cannot_modify_peer_or_higher');
        expect((await dis('victim')).ok).toBe(true);
        const bulk = await executeCommand({ line: `users bulk enable ${users.victim.email} ${users.adm.email}`, confirm: true, stepUp: proof('op') }, opAuth);
        expect(bulk.ok).toBe(true);
        const res = (bulk.json ?? bulk.output) as unknown;
        expect(JSON.stringify(res)).toContain('forbidden_level');
    });
});

describe('tokens de CLI acotados por el nivel de la cuenta', () => {
    const req = (token: string) => new NextRequest('http://localhost/api/admin/cli/exec', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'user-agent': 'cli-test' } });

    it('el token hereda el nivel como TOPE: nunca mas que la cuenta, ni mas que el del token (aunque la cuenta suba)', async () => {
        await setLevel('root', 'sup', 1);
        const { token } = await createCliToken({ kind: 'user', adminId: users.sup.id, adminEmail: users.sup.email, name: 't', scopes: ['read'], permissionLevel: 1 });
        const a = await authenticateCli(req(token));
        expect(a.ok && a.auth.actor.level).toBe(1);
        await setLevel('root', 'sup', 3); // la cuenta sube, el token conserva su tope
        const b = await authenticateCli(req(token));
        expect(b.ok && b.auth.actor.level).toBe(1);
    });

    it('el ambito de un token depende del nivel (support solo read)', async () => {
        await expect(createCliToken({ kind: 'user', adminId: users.sup.id, name: 'w', scopes: ['write'], permissionLevel: 1 })).rejects.toMatchObject({ code: 'scope_exceeds_level' });
        await expect(createCliToken({ kind: 'user', adminId: users.sup.id, name: 'n', scopes: ['read'], permissionLevel: 0 as PermissionLevel })).rejects.toMatchObject({ code: 'level_required' });
    });

    it('bajar o quitar el nivel invalida sus tokens de CLI AL INSTANTE y la cuenta deja de autenticar', async () => {
        await setLevel('root', 'adm', 3);
        const { token } = await createCliToken({ kind: 'user', adminId: users.adm.id, adminEmail: users.adm.email, name: 'x', scopes: ['read', 'write'], permissionLevel: 3 });
        expect((await authenticateCli(req(token))).ok).toBe(true);
        await setLevel('root', 'adm', 2);
        expect(await verifyCliToken(token)).toMatchObject({ ok: false, reason: 'revoked' });
        const r = await authenticateCli(req(token));
        expect(!r.ok && r.response.status).toBe(401);
        // un token nuevo de una cuenta sin nivel: 403 not_admin
        await prisma.$executeRawUnsafe(`UPDATE "UserPermission" SET "permission_level" = 0 WHERE "email" = $1`, users.adm.email);
        await refreshPermissions({ force: true });
        const t2 = await createCliToken({ kind: 'user', adminId: users.adm.id, name: 'y', scopes: ['read'], permissionLevel: 1 });
        const r2 = await authenticateCli(req(t2.token));
        expect(!r2.ok && r2.response.status).toBe(403);
    });
});

describe('vistas: nivel en detalle de usuario, whoami y listado', () => {
    it('users show, whoami y perms list muestran permission_level y su origen', async () => {
        await setLevel('root', 'op', 2);
        const show = await run('root', `users show ${users.op.email} --json`, { stepUp: null });
        expect(JSON.stringify(show.json)).toContain('2 · operator (console)');
        const who = await run('root', 'whoami --json', { stepUp: null });
        expect((who.json as any).permission_level).toContain('4 · superadmin (env)');
        const list = await run('root', 'perms list --json', { stepUp: null });
        const rows = (list.json as any[])[0] as any[];
        const root = rows.find((r) => r.email === users.root.email);
        expect(root).toMatchObject({ permission_level: 4, source: 'env (fixed)' });
        expect(rows.find((r) => r.email === users.op.email)).toMatchObject({ permission_level: 2, source: 'console' });
    });
});

vi.setConfig({ testTimeout: 60_000 });
void uid;
