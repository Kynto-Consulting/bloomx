import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertLocalPg, createEmail, createUser, uid } from './helpers/pg';
import { prisma } from '../prisma';
import { __resetRevocationCache, bumpTokenVersion, checkSessionNotRevoked, revokeSession } from '../session-revocation';
import { countActiveSessions, findSessionOfUser, listActiveSessions, purgeExpiredSessionRows } from '../admin/session-registry';
import { DEFAULT_USER_STATE, getUserState, isUserDisabled, setMustChangePassword, setUserDisabled, touchLastLogin } from '../admin/user-state';
import { getUserBasic, getUserStorage, listUserAccounts, listUsers } from '../admin/users-store';
import { deleteAccount, getAccountBrief, listAccounts, requestReconnect } from '../admin/accounts-store';

/**
 * Consola de administracion contra Postgres real: listUsers (filtros/orden/paginacion), estado admin, registro de sesiones,
 * rechazo de cuentas deshabilitadas y cuentas vinculadas (estado derivado sin exponer tokens).
 */

const tag = `t${Math.random().toString(36).slice(2, 8)}`;
const mail = (name: string) => `${name}.${tag}@pg.test`;
const nowSec = () => Math.floor(Date.now() / 1000);
const ALL = { limit: 100, offset: 0 };
const accTag = `acc.${tag}`;

beforeAll(() => {
    assertLocalPg();
    process.env.SESSION_REVOCATION_CACHE_MS = '0';
    process.env.ADMIN_EMAILS = `Boss.${tag}@PG.test, other@elsewhere.test`;
});
beforeEach(() => __resetRevocationCache());
afterAll(async () => { await prisma.$disconnect(); });

const exec = (sql: string, ...p: unknown[]) => prisma.$executeRawUnsafe(sql, ...p);
const setMfa = (userId: string, enabled: boolean) =>
    exec(`INSERT INTO "UserMfa" ("userId","secretEnc","enabled","lastStep","recoveryHashes","createdAt","updatedAt") VALUES ($1,'enc',$2,0,'[]'::jsonb,NOW(),NOW())`, userId, enabled);
const addAccount = (userId: string, over: Record<string, unknown> = {}) => {
    const v = { provider: 'google', providerAccountId: uid('pid'), refresh: 'rt-secret', access: 'at-secret', expires: nowSec() + 3600, scope: 'openid https://www.googleapis.com/auth/calendar', ...over };
    const id = uid('acc');
    return exec(
        `INSERT INTO "Account" ("id","userId","type","provider","providerAccountId","refresh_token","access_token","expires_at","scope") VALUES ($1,$2,'oauth',$3,$4,$5,$6,$7,$8)`,
        id, userId, v.provider, v.providerAccountId, v.refresh, v.access, v.expires, v.scope,
    ).then(() => id);
};
const addSession = (userId: string, over: Record<string, unknown> = {}) => {
    const v = { jti: uid('jti'), tv: 0, expires: new Date(Date.now() + 3_600_000), ...over } as { jti: string; tv: number; expires: Date };
    return exec(`INSERT INTO "UserSession" ("jti","userId","tv","mfa","ip","userAgent","createdAt","expiresAt") VALUES ($1,$2,$3,FALSE,'10.0.0.1','UA',NOW(),$4)`, v.jti, userId, v.tv, v.expires).then(() => v.jti);
};
const find = async (filters: Parameters<typeof listUsers>[0], paging = ALL) => listUsers({ q: tag, ...filters }, paging);
const emails = (rows: { email: string }[]) => rows.map((r) => r.email);

describe('listUsers contra Postgres', () => {
    let ann: any, bob: any, cy: any, dee: any, boss: any;

    beforeAll(async () => {
        ann = await createUser(prisma, mail('ann'));
        bob = await createUser(prisma, mail('bob'));
        cy = await createUser(prisma, mail('cy'));
        dee = await createUser(prisma, mail('dee'));
        boss = await createUser(prisma, mail('boss')); // en ADMIN_EMAILS con otra capitalizacion
        await prisma.user.update({ where: { id: ann.id }, data: { name: 'Ann Zeta', avatar: 'data:image/png;base64,AAAA' } });
        await prisma.user.update({ where: { id: bob.id }, data: { name: 'Bob Alfa' } });
        await setUserDisabled(bob.id, true);
        await touchLastLogin(ann.id, '10.1.1.1');
        await setMfa(ann.id, true);
        await setMfa(cy.id, false); // enrolamiento sin terminar: no cuenta como MFA activo
        await addAccount(ann.id);
        await addAccount(bob.id, { provider: 'zoom' });
        // almacenamiento: ann 3000 bytes en 2 adjuntos, bob 500
        const e1 = await createEmail(prisma, ann.id);
        const e2 = await createEmail(prisma, ann.id, { folder: 'sent' });
        const e3 = await createEmail(prisma, bob.id);
        for (const [emailId, size] of [[e1.id, 2000], [e2.id, 1000], [e3.id, 500]] as const) {
            await prisma.attachment.create({ data: { emailId, filename: 'f.bin', mimeType: 'application/octet-stream', size, key: uid('k') } });
        }
        await addSession(ann.id);
        await addSession(ann.id);
    });

    it('devuelve filas con estado, MFA, Google, almacenamiento y sesiones; nunca password', async () => {
        const { rows, total } = await find({ sort: 'email', dir: 'asc' });
        expect(total).toBe(5);
        expect(emails(rows)).toEqual([mail('ann'), mail('bob'), mail('boss'), mail('cy'), mail('dee')]);
        const a = rows[0];
        expect(a).toMatchObject({ name: 'Ann Zeta', avatar: true, disabled: false, isAdmin: false, mfaEnabled: true, googleLinked: true, storageBytes: 3000, sessions: 2 });
        expect(a.lastLoginAt).toEqual(expect.any(String));
        expect(rows[1]).toMatchObject({ disabled: true, googleLinked: false, storageBytes: 500, sessions: 0, avatar: false, lastLoginAt: null });
        expect(rows[3]).toMatchObject({ mfaEnabled: false });
        expect(JSON.stringify(rows)).not.toMatch(/password|secret|token/i);
        expect(Object.keys(a).sort()).toEqual(['avatar', 'createdAt', 'disabled', 'email', 'googleLinked', 'id', 'isAdmin', 'lastLoginAt', 'mfaEnabled', 'name', 'sessions', 'storageBytes'].sort());
    });

    it('rol admin = ADMIN_EMAILS (sin distinguir mayusculas); filtro role', async () => {
        const admins = await find({ role: 'admin' });
        expect(emails(admins.rows)).toEqual([mail('boss')]);
        expect(admins.rows[0].isAdmin).toBe(true);
        expect(admins.total).toBe(1);
        const users = await find({ role: 'user' });
        expect(users.total).toBe(4);
        expect(emails(users.rows)).not.toContain(mail('boss'));
    });

    it('filtros de estado, MFA y Google, y su combinacion', async () => {
        expect(emails((await find({ status: 'disabled' })).rows)).toEqual([mail('bob')]);
        expect((await find({ status: 'active' })).total).toBe(4);
        expect(emails((await find({ mfa: 'yes' })).rows)).toEqual([mail('ann')]);
        expect((await find({ mfa: 'no' })).total).toBe(4);
        expect(emails((await find({ google: 'yes' })).rows)).toEqual([mail('ann')]); // bob solo tiene zoom
        expect((await find({ google: 'no' })).total).toBe(4);
        expect(emails((await find({ status: 'active', mfa: 'no', google: 'no', role: 'user' }, ALL)).rows).sort()).toEqual([mail('cy'), mail('dee')]);
        expect((await find({ status: 'disabled', mfa: 'yes' })).total).toBe(0);
    });

    it('busqueda por correo o nombre; % y _ se escapan (no son comodines)', async () => {
        const tag2 = `s${Math.random().toString(36).slice(2, 8)}`;
        const special = await createUser(prisma, `a_b.${tag2}@pg.test`);
        await createUser(prisma, `axb.${tag2}@pg.test`);
        expect(emails((await listUsers({ q: `a_b.${tag2}` }, ALL)).rows)).toEqual([special.email]);
        expect((await listUsers({ q: `a%b.${tag2}` }, ALL)).total).toBe(0);
        expect(emails((await listUsers({ q: 'bob alfa' }, ALL)).rows).filter((e) => e.includes(tag))).toEqual([mail('bob')]);
        expect(emails((await listUsers({ q: `ZETA` }, ALL)).rows).filter((e) => e.includes(tag))).toEqual([mail('ann')]);
        // inyeccion: es un valor, no SQL
        expect((await listUsers({ q: `x'; DROP TABLE "User"; --` }, ALL)).total).toBe(0);
        expect((await listUsers({ q: tag }, ALL)).total).toBeGreaterThan(0);
    });

    it('orden por nombre, ultimo acceso (NULLS LAST en ambos sentidos) y almacenamiento', async () => {
        expect(emails((await find({ sort: 'storage', dir: 'desc' })).rows).slice(0, 2)).toEqual([mail('ann'), mail('bob')]);
        expect(emails((await find({ sort: 'storage', dir: 'asc' })).rows).slice(-2)).toEqual([mail('bob'), mail('ann')]);
        const byLogin = await find({ sort: 'lastLogin', dir: 'desc' });
        expect(byLogin.rows[0].email).toBe(mail('ann'));
        const byLoginAsc = await find({ sort: 'lastLogin', dir: 'asc' });
        expect(byLoginAsc.rows[0].email).toBe(mail('ann')); // los NULL van al final tambien en asc
        // los sin nombre ('') van primero en asc
        expect(emails((await find({ sort: 'name', dir: 'asc' })).rows).slice(-2)).toEqual([mail('ann'), mail('bob')]);
        expect((await find({ sort: 'name', dir: 'desc' })).rows[0].email).toBe(mail('bob'));
    });

    it('paginacion con total estable y sin solapes', async () => {
        const p1 = await find({ sort: 'email', dir: 'asc' }, { limit: 2, offset: 0 });
        const p2 = await find({ sort: 'email', dir: 'asc' }, { limit: 2, offset: 2 });
        const p3 = await find({ sort: 'email', dir: 'asc' }, { limit: 2, offset: 4 });
        expect([p1.total, p2.total, p3.total]).toEqual([5, 5, 5]);
        expect([p1.rows.length, p2.rows.length, p3.rows.length]).toEqual([2, 2, 1]);
        expect(new Set([...p1.rows, ...p2.rows, ...p3.rows].map((r) => r.id)).size).toBe(5);
        expect((await find({}, { limit: 10, offset: 500 })).rows).toEqual([]);
    });

    it('es tolerante a tablas ausentes: sin UserMfa / UserAdminState / Account el listado sigue funcionando', async () => {
        const rename = async (table: string, to: string) => exec(`ALTER TABLE "${table}" RENAME TO "${to}"`);
        for (const [table, check] of [
            ['UserMfa', async () => {
                const all = await find({ sort: 'email', dir: 'asc' });
                expect(all.rows.every((r) => r.mfaEnabled === false)).toBe(true);
                expect((await find({ mfa: 'yes' })).total).toBe(0);
                expect((await find({ mfa: 'no' })).total).toBe(5);
            }],
            ['UserAdminState', async () => {
                const all = await find({ sort: 'email', dir: 'asc' });
                expect(all.rows.every((r) => r.disabled === false && r.lastLoginAt === null)).toBe(true);
                expect((await find({ status: 'disabled' })).total).toBe(0);
                expect((await find({ status: 'active' })).total).toBe(5);
                expect((await find({ sort: 'lastLogin' })).total).toBe(5);
            }],
            ['Account', async () => {
                const all = await find({});
                expect(all.rows.every((r) => r.googleLinked === false)).toBe(true);
                expect((await find({ google: 'yes' })).total).toBe(0);
                expect((await find({ google: 'no' })).total).toBe(5);
            }],
        ] as const) {
            await rename(table, `${table}_away`);
            try {
                await check();
            } finally {
                await rename(`${table}_away`, table);
            }
        }
        expect((await find({ mfa: 'yes' })).total).toBe(1); // restaurado
    });

    it('almacenamiento y detalle: solo conteos por carpeta, cuentas sin tokens', async () => {
        expect(await getUserStorage(ann.id)).toEqual({
            attachmentBytes: 3000, attachmentCount: 2, emailCount: 2,
            folders: expect.arrayContaining([{ folder: 'inbox', count: 1 }, { folder: 'sent', count: 1 }]),
        });
        expect(await getUserStorage(dee.id)).toEqual({ attachmentBytes: 0, attachmentCount: 0, emailCount: 0, folders: [] });
        const accounts = await listUserAccounts(ann.id);
        expect(accounts).toHaveLength(1);
        expect(accounts[0]).toMatchObject({ provider: 'google', hasRefreshToken: true });
        expect(accounts[0].scopes).toContain('openid');
        expect(JSON.stringify(accounts)).not.toMatch(/secret|access_token|refresh_token/);
        expect(await getUserBasic(uid('nadie'))).toBeNull();
        expect(await getUserBasic(ann.id)).toMatchObject({ email: mail('ann'), avatar: true });
    });
});

describe('user-state', () => {
    it('por defecto, upserts que conservan los demas campos y lectura de deshabilitado', async () => {
        const u = await createUser(prisma);
        expect(await getUserState(u.id)).toEqual(DEFAULT_USER_STATE);
        expect(await isUserDisabled(u.id)).toBe(false);

        expect(await setMustChangePassword(u.id, true)).toBe(true);
        expect(await getUserState(u.id)).toMatchObject({ disabled: false, mustChangePassword: true });

        expect(await setUserDisabled(u.id, true)).toBe(true);
        let s = await getUserState(u.id);
        expect(s).toMatchObject({ disabled: true, mustChangePassword: true });
        expect(s.disabledAt).toEqual(expect.any(String));
        expect(await isUserDisabled(u.id)).toBe(true);

        await touchLastLogin(u.id, '192.0.2.1');
        s = await getUserState(u.id);
        expect(s).toMatchObject({ disabled: true, lastLoginIp: '192.0.2.1' });
        expect(s.lastLoginAt).toEqual(expect.any(String));

        await setUserDisabled(u.id, false);
        s = await getUserState(u.id);
        expect(s).toMatchObject({ disabled: false, disabledAt: null, mustChangePassword: true, lastLoginIp: '192.0.2.1' });
        await setMustChangePassword(u.id, false);
        expect((await getUserState(u.id)).mustChangePassword).toBe(false);
    });

    it('con la tabla ausente: lectura = por defecto, escritura = false, sin romper', async () => {
        const u = await createUser(prisma);
        await exec('ALTER TABLE "UserAdminState" RENAME TO "UserAdminState_away"');
        try {
            expect(await getUserState(u.id)).toEqual(DEFAULT_USER_STATE);
            expect(await isUserDisabled(u.id)).toBe(false);
            expect(await setUserDisabled(u.id, true)).toBe(false);
            expect(await setMustChangePassword(u.id, true)).toBe(false);
            await expect(touchLastLogin(u.id, '1.1.1.1')).resolves.toBeUndefined();
        } finally {
            await exec('ALTER TABLE "UserAdminState_away" RENAME TO "UserAdminState"');
        }
    });
});

describe('session-registry', () => {
    it('lista solo las activas: excluye revocadas por jti, caducadas y de tokenVersion viejo', async () => {
        const u = await createUser(prisma);
        const other = await createUser(prisma);
        const active = await addSession(u.id);
        const revoked = await addSession(u.id);
        const expired = await addSession(u.id, { expires: new Date(Date.now() - 1000) });
        const old = await addSession(u.id, { tv: 0 });
        const foreign = await addSession(other.id);
        await revokeSession(revoked, u.id, nowSec() + 3600);

        expect((await listActiveSessions(u.id)).map((s) => s.jti).sort()).toEqual([active, old].sort());
        expect(await countActiveSessions([u.id, other.id])).toEqual({ [u.id]: 2, [other.id]: 1 });

        // revocar todas: tokenVersion + 1 deja fuera a las de tv=0 ...
        await bumpTokenVersion(u.id);
        expect(await listActiveSessions(u.id)).toEqual([]);
        // ... y una sesion nueva con tv=1 si cuenta
        const fresh = await addSession(u.id, { tv: 1 });
        expect((await listActiveSessions(u.id)).map((s) => s.jti)).toEqual([fresh]);
        expect(expired).toBeTruthy();
        expect(foreign).toBeTruthy();
    });

    it('findSessionOfUser solo encuentra la sesion del propio usuario y el listado no expone el token', async () => {
        const a = await createUser(prisma);
        const b = await createUser(prisma);
        const jti = await addSession(a.id);
        expect((await findSessionOfUser(a.id, jti))?.jti).toBe(jti);
        expect(await findSessionOfUser(b.id, jti)).toBeNull();
        const [row] = await listActiveSessions(a.id);
        expect(Object.keys(row).sort()).toEqual(['createdAt', 'expiresAt', 'ip', 'jti', 'mfa', 'tv', 'userAgent', 'userId']);
        expect(await countActiveSessions([])).toEqual({});
    });

    it('purga solo las caducadas hace mas de un dia', async () => {
        const u = await createUser(prisma);
        const longGone = await addSession(u.id, { expires: new Date(Date.now() - 3 * 86_400_000) });
        const recent = await addSession(u.id, { expires: new Date(Date.now() - 1000) });
        expect(await purgeExpiredSessionRows()).toBeGreaterThanOrEqual(1);
        expect(await findSessionOfUser(u.id, longGone)).toBeNull();
        expect(await findSessionOfUser(u.id, recent)).not.toBeNull();
    });
});

describe('checkSessionNotRevoked con cuentas deshabilitadas', () => {
    it('rechaza sesiones (vigentes y nuevas) de un usuario deshabilitado y vuelve a aceptarlas al habilitar', async () => {
        const u = await createUser(prisma);
        const payload = { sub: u.id, jti: uid('jti'), tv: 0, iat: nowSec(), exp: nowSec() + 3600 };
        expect(await checkSessionNotRevoked(payload)).toEqual({ valid: true });

        await setUserDisabled(u.id, true);
        expect(await checkSessionNotRevoked(payload)).toEqual({ valid: false, reason: 'disabled' });
        expect(await checkSessionNotRevoked({ ...payload, jti: uid('jti') })).toEqual({ valid: false, reason: 'disabled' });

        await setUserDisabled(u.id, false);
        expect(await checkSessionNotRevoked(payload)).toEqual({ valid: true });
    });
});

describe('cuentas vinculadas (estado derivado, sin tokens)', () => {
    it('deriva valid / expired / revoked, filtra y nunca selecciona tokens', async () => {
        const u = await createUser(prisma, `acc.${tag}@pg.test`);
        const valid = await addAccount(u.id, { provider: 'google', scope: 'openid https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/contacts' });
        const validNoRefresh = await addAccount(u.id, { provider: 'zoom', refresh: null, expires: nowSec() + 600, scope: 'meeting:write' });
        const expired = await addAccount(u.id, { provider: 'hubspot', refresh: null, expires: nowSec() - 600 });
        const revoked = await addAccount(u.id, { provider: 'notion', refresh: null, access: null, expires: 0 });
        const emptyStrings = await addAccount(u.id, { provider: 'slack', refresh: '', access: '', expires: 0 });

        const all = await listAccounts({ q: accTag }, ALL);
        expect(all.total).toBe(5);
        const byId = Object.fromEntries(all.rows.map((r) => [r.id, r]));
        expect(byId[valid]).toMatchObject({ status: 'valid', hasRefreshToken: true, integrations: ['calendar', 'contacts'], userEmail: `acc.${tag}@pg.test` });
        expect(byId[validNoRefresh]).toMatchObject({ status: 'valid', hasRefreshToken: false, integrations: ['meetings'] });
        expect(byId[expired]).toMatchObject({ status: 'expired', hasRefreshToken: false });
        expect(byId[revoked]).toMatchObject({ status: 'revoked' });
        expect(byId[emptyStrings]).toMatchObject({ status: 'revoked', hasRefreshToken: false });
        expect(byId[valid].providerAccountId).toMatch(/^.{3}…..$/);
        expect(all.providers).toEqual(expect.arrayContaining(['google', 'zoom', 'hubspot']));
        expect(JSON.stringify(all.rows)).not.toMatch(/rt-secret|at-secret|access_token|refresh_token/);

        expect((await listAccounts({ q: accTag, status: 'expired' }, ALL)).rows.map((r) => r.id)).toEqual([expired]);
        expect((await listAccounts({ q: accTag, status: 'revoked' }, ALL)).total).toBe(2);
        expect((await listAccounts({ q: accTag, status: 'valid' }, ALL)).total).toBe(2);
        expect((await listAccounts({ q: accTag, provider: 'google' }, ALL)).rows.map((r) => r.id)).toEqual([valid]);
        expect((await listAccounts({ q: accTag }, { limit: 2, offset: 4 })).rows).toHaveLength(1);
    });

    it('pedir reconexion: anula tokens (o solo el de acceso) y el estado lo refleja; desvincular borra la fila', async () => {
        const u = await createUser(prisma);
        const gentle = await addAccount(u.id);
        expect(await requestReconnect(gentle, 'refresh')).toBe(true);
        let [row] = (await listAccounts({ q: u.email }, ALL)).rows;
        expect(row).toMatchObject({ id: gentle, status: 'valid', hasRefreshToken: true }); // sigue renovable
        expect(await requestReconnect(gentle, 'reconnect')).toBe(true);
        [row] = (await listAccounts({ q: u.email }, ALL)).rows;
        expect(row).toMatchObject({ status: 'revoked', hasRefreshToken: false });
        expect(await getAccountBrief(gentle)).toMatchObject({ userId: u.id, provider: 'google', hasRefresh: false });

        expect(await requestReconnect(uid('nadie'), 'reconnect')).toBe(false);
        expect(await deleteAccount(gentle)).toBe(true);
        expect(await deleteAccount(gentle)).toBe(false);
        expect(await getAccountBrief(gentle)).toBeNull();
    });
});
