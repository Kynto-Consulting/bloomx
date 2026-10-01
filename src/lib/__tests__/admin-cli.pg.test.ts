import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertLocalPg, createUser, uid } from './helpers/pg';
import { prisma } from '../prisma';
import { __defaultAuditSink, __setAuditSink } from '../audit';
import { __resetRateLimitState } from '../security';
import { issueReauthToken } from '../mail-transfer/auth';
import {
    DEFAULT_TTL_HOURS, MAX_ACTIVE_TOKENS_PER_ADMIN, MAX_TTL_HOURS, clampTtlHours, countActiveTokens, createCliToken, hashToken, listCliTokens,
    purgeCliTokens, revokeAllCliTokens, revokeCliToken, verifyCliToken,
} from '../admin-cli/tokens';
import { executeCommand, stepUpKey, type ExecAuth } from '../admin-cli/exec';
import { query } from '../admin/sql';

/**
 * Tokens de CLI y comandos REALES contra Postgres embebido: hash (nunca el valor en claro), caducidad, revocacion, limite por
 * administrador, y el puente a las rutas /api/admin (crear/listar/deshabilitar usuarios, auditoria de cada comando).
 */

beforeAll(() => {
    assertLocalPg();
    process.env.SESSION_REVOCATION_CACHE_MS = '0';
});
beforeEach(() => __resetRateLimitState());
afterAll(async () => { __setAuditSink(null); await prisma.$disconnect(); });

const adminId = () => uid('adm');
const exec = (sql: string, ...p: unknown[]) => prisma.$executeRawUnsafe(sql, ...p);

describe('tokens de CLI', () => {
    it('solo se guarda el SHA-256; el valor en claro no esta en ninguna columna', async () => {
        const id = adminId();
        const { token, record } = await createCliToken({ permissionLevel: 4, kind: 'user', adminId: id, adminEmail: 'a@pg.test', name: 'laptop', scopes: ['read', 'write'], ip: '10.0.0.1', domain: 'pg.test' });
        expect(token).toMatch(/^bxa_[A-Za-z0-9_-]{43}$/);
        const rows = await query<Record<string, unknown>>(`SELECT * FROM "AdminCliToken" WHERE "id" = $1`, record.id);
        expect(rows[0].tokenHash).toBe(hashToken(token));
        expect(JSON.stringify(rows[0])).not.toContain(token);
        expect(record.scopes).toEqual(['read', 'write']);
    });

    it('caducidad por defecto 12 h y tope de 30 d (nunca mas)', async () => {
        expect(clampTtlHours(undefined)).toBe(DEFAULT_TTL_HOURS);
        expect(clampTtlHours(100000)).toBe(MAX_TTL_HOURS);
        expect(() => clampTtlHours(-1)).toThrow();
        expect(() => clampTtlHours('abc')).toThrow();
        const id = adminId();
        const def = await createCliToken({ permissionLevel: 4, kind: 'user', adminId: id, name: 'def', scopes: ['read'] });
        const max = await createCliToken({ permissionLevel: 4, kind: 'user', adminId: id, name: 'max', scopes: ['read'], ttlHours: 99999 });
        const h = (iso: string | null) => (new Date(iso!).getTime() - Date.now()) / 3_600_000;
        expect(h(def.record.expiresAt)).toBeGreaterThan(11.9);
        expect(h(def.record.expiresAt)).toBeLessThanOrEqual(12.01); // tolerancia por redondeo de ms
        expect(h(max.record.expiresAt)).toBeLessThanOrEqual(720.01);
        expect(h(max.record.expiresAt)).toBeGreaterThan(719);
    });

    it('verifica, actualiza ultimo uso (IP/UA) y rechaza desconocido/mal formado', async () => {
        const id = adminId();
        const { token, record } = await createCliToken({ permissionLevel: 4, kind: 'user', adminId: id, name: 't', scopes: ['read'] });
        const ok = await verifyCliToken(token, { ip: '203.0.113.5', ua: 'cli/1' });
        expect(ok).toMatchObject({ ok: true });
        await new Promise((r) => setTimeout(r, 100));
        const row = (await listCliTokens(id))[0];
        expect(row.id).toBe(record.id);
        expect(row.lastUsedIp).toBe('203.0.113.5');
        expect(row.lastUsedUa).toBe('cli/1');
        expect(row.lastUsedAt).toBeTruthy();
        expect(await verifyCliToken(`bxa_${'x'.repeat(43)}`)).toEqual({ ok: false, reason: 'unknown' });
        expect(await verifyCliToken('Bearer nope')).toEqual({ ok: false, reason: 'malformed' });
        expect(await verifyCliToken(undefined)).toEqual({ ok: false, reason: 'malformed' });
        expect(await verifyCliToken(token.toUpperCase())).toMatchObject({ ok: false }); // sensible a mayusculas
    });

    it('un token caducado se rechaza', async () => {
        const id = adminId();
        const { token, record } = await createCliToken({ permissionLevel: 4, kind: 'user', adminId: id, name: 'old', scopes: ['read'] });
        await exec(`UPDATE "AdminCliToken" SET "expiresAt" = NOW() - INTERVAL '1 minute' WHERE "id" = $1`, record.id);
        expect(await verifyCliToken(token)).toMatchObject({ ok: false, reason: 'expired' });
        expect(await listCliTokens(id)).toHaveLength(0);
        expect(await listCliTokens(id, { includeInactive: true })).toHaveLength(1);
    });

    it('revocar: inmediato, por prefijo, solo del propio admin, y borra la sesion de manager guardada', async () => {
        const a = adminId();
        const b = adminId();
        const mine = await createCliToken({ permissionLevel: 4, kind: 'manager', adminId: a, name: 'm', scopes: ['read'], managerSession: 'backend-cookie-value' });
        expect((await verifyCliToken(mine.token))).toMatchObject({ ok: true, managerSession: 'backend-cookie-value' });
        const raw = await query<{ managerSessionEnc: string }>(`SELECT "managerSessionEnc" FROM "AdminCliToken" WHERE "id" = $1`, mine.record.id);
        expect(raw[0].managerSessionEnc).toBeTruthy();
        expect(raw[0].managerSessionEnc).not.toContain('backend-cookie-value'); // cifrada en reposo
        expect(await revokeCliToken(b, mine.record.id)).toBeNull(); // otro admin no puede
        expect(await revokeCliToken(a, 'zz')).toBeNull();
        expect((await revokeCliToken(a, mine.record.id.slice(0, 8)))?.revokedAt).toBeTruthy();
        expect(await verifyCliToken(mine.token)).toMatchObject({ ok: false, reason: 'revoked' });
        const after = await query<{ managerSessionEnc: string | null }>(`SELECT "managerSessionEnc" FROM "AdminCliToken" WHERE "id" = $1`, mine.record.id);
        expect(after[0].managerSessionEnc).toBeNull();
    });

    it('revocar todos (con excepcion) y purga de antiguos', async () => {
        const a = adminId();
        const t1 = await createCliToken({ permissionLevel: 4, kind: 'user', adminId: a, name: '1', scopes: ['read'] });
        const t2 = await createCliToken({ permissionLevel: 4, kind: 'user', adminId: a, name: '2', scopes: ['read'] });
        expect(await revokeAllCliTokens(a, t1.record.id)).toBe(1);
        expect((await verifyCliToken(t1.token)).ok).toBe(true);
        expect((await verifyCliToken(t2.token)).ok).toBe(false);
        await exec(`UPDATE "AdminCliToken" SET "revokedAt" = NOW() - INTERVAL '40 days' WHERE "id" = $1`, t2.record.id);
        expect(await purgeCliTokens()).toBeGreaterThanOrEqual(1);
    });

    it('limite de tokens activos por administrador', async () => {
        const a = adminId();
        for (let i = 0; i < MAX_ACTIVE_TOKENS_PER_ADMIN; i++) await createCliToken({ permissionLevel: 4, kind: 'user', adminId: a, name: `t${i}`, scopes: ['read'] });
        await expect(createCliToken({ permissionLevel: 4, kind: 'user', adminId: a, name: 'extra', scopes: ['read'] })).rejects.toMatchObject({ code: 'token_limit' });
        expect(await countActiveTokens(a)).toBe(MAX_ACTIVE_TOKENS_PER_ADMIN);
        await revokeAllCliTokens(a);
        await expect(createCliToken({ permissionLevel: 4, kind: 'user', adminId: a, name: 'ok', scopes: ['read'] })).resolves.toBeTruthy();
    });
});

describe('comandos reales sobre las rutas del admin (puente)', () => {
    const tag = `c${Math.random().toString(36).slice(2, 8)}`;
    let admin: { id: string; email: string };
    let auth: ExecAuth;
    const proof = () => issueReauthToken(stepUpKey(admin), 'mfa', null).token;
    const run = (line: string, extra: Record<string, unknown> = {}) => executeCommand({ line, ...extra }, auth);
    const secure = (line: string) => run(line, { confirm: true, stepUp: proof() });

    beforeAll(async () => {
        __setAuditSink(__defaultAuditSink);
        admin = await createUser(prisma, `root.${tag}@pg.test`);
        auth = { actor: { kind: 'user', id: admin.id, email: admin.email, level: 4, levelSource: 'env' }, session: { source: 'token', scopes: ['read', 'write', 'security'], tokenId: 'tok-e2e', tokenName: 'e2e' }, ip: '127.0.0.9', userAgent: 'vitest' };
    });

    it('whoami y system schema', async () => {
        const w = await run('whoami --json');
        expect(w.ok).toBe(true);
        expect(w.json).toMatchObject({ account: admin.email, scopes: 'read, write, security' });
        const s = await run('system schema');
        expect(s.ok).toBe(true);
        expect(s.text).toContain('missing');
        expect(s.text).toContain('schema ok'); // la BD de pruebas tiene todo el esquema, incluida AdminCliToken
    });

    it('users create (security: exige step-up) -> list -> show por correo -> disable -> enable', async () => {
        const email = `ana.${tag}@pg.test`;
        expect((await run(`users create ${email} --name Ana`)).needs).toBe('confirm');
        expect((await run(`users create ${email} --name Ana --yes`)).needs).toBe('stepup');
        const created = await secure(`users create ${email} --name Ana --json`);
        expect(created.ok, JSON.stringify(created.error)).toBe(true);
        const j = created.json as Record<string, unknown>;
        expect(String(j.temporaryPassword).length).toBeGreaterThanOrEqual(12); // se muestra UNA vez

        const dup = await secure(`users create ${email}`);
        expect(dup.ok).toBe(false);
        expect(dup.error?.code).toBe('user_exists');

        const list = await run(`users list --q ana.${tag} --json`);
        expect((list.json as any[]).map((r) => r.email)).toEqual([email]);
        const show = await run(`users show ${email} --json`);
        expect(show.ok).toBe(true);

        const off = await secure(`users disable ${email}`);
        expect(off.ok).toBe(true);
        const row = (await run(`users list --q ana.${tag} --json`)).json as any[];
        expect(row[0].status).toBe('disabled');
        expect((await run(`users enable ${email}`)).ok).toBe(true);
        expect(((await run(`users list --q ana.${tag} --json`)).json as any[])[0].status).toBe('active');
    });

    it('un usuario inexistente da error claro y nunca toca otro', async () => {
        const r = await run(`users show nadie.${tag}@pg.test`);
        expect(r.ok).toBe(false);
        expect(r.error?.code).toBe('user_not_found');
    });

    it('cada comando queda en la auditoria (consultable con `audit`), con el comando saneado y sin la contrasena', async () => {
        const email = `bob.${tag}@pg.test`;
        await secure(`users create ${email} --password "Tr0ub4dor&3-Correct-Horse" --name Bob`);
        await new Promise((r) => setTimeout(r, 400));
        const a = await run(`audit --event "admin.cli.*" --user ${admin.id} --json`);
        expect(a.ok, JSON.stringify(a.error)).toBe(true);
        const rows = a.json as Array<{ event: string; data: string }>;
        expect(rows.length).toBeGreaterThan(0);
        const blob = JSON.stringify(rows);
        expect(blob).not.toContain('Tr0ub4dor');
        expect(blob).toContain('admin.cli.exec');
        expect(rows.some((r) => /users create/.test(r.data) && /--password \*\*\*/.test(r.data))).toBe(true);
        // ... y la ruta real tambien audito su propia accion (admin.users.created)
        const created = await run(`audit --event admin.users.created --json`);
        expect((created.json as any[]).length).toBeGreaterThan(0);
    });

    it('tokens: crear (nunca excede el ambito de la sesion), listar sin mostrar el valor y revocar', async () => {
        const narrow: ExecAuth = { ...auth, session: { ...auth.session, scopes: ['read', 'write'] } };
        const exceed = await executeCommand({ line: 'tokens create --name x --scopes security --yes', confirm: true, stepUp: proof() }, narrow);
        expect(exceed.ok).toBe(false); // security no es alcanzable con ambito write (la puerta de ambito lo corta antes)
        const made = await secure('tokens create --name ci --scopes read --ttl 1 --json');
        expect(made.ok, JSON.stringify(made.error)).toBe(true);
        const tok = (made.json as any).token as string;
        expect(tok).toMatch(/^bxa_/);
        expect((await verifyCliToken(tok)).ok).toBe(true);
        const list = await run('tokens list --json');
        expect(JSON.stringify(list.json)).not.toContain(tok);
        const id = (made.json as any).id as string;
        expect((await secure(`tokens revoke ${id}`)).ok).toBe(true);
        expect((await verifyCliToken(tok)).ok).toBe(false);
    });

    it('permisos de rutas: un token solo-lectura no ejecuta users bulk ni retention run', async () => {
        const ro: ExecAuth = { ...auth, session: { ...auth.session, scopes: ['read'] } };
        expect((await executeCommand({ line: 'users bulk disable a --yes' }, ro)).error?.code).toBe('insufficient_scope');
        expect((await executeCommand({ line: 'retention run --apply --yes' }, ro)).error?.code).toBe('insufficient_scope');
        expect((await executeCommand({ line: 'retention show' }, ro)).ok).toBe(true);
    });
});
