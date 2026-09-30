import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Red de seguridad: si por error se cargara el Prisma REAL, que apunte a un destino inalcanzable y nunca a la BD del .env.
vi.hoisted(() => {
    process.env.DATABASE_URL = 'postgresql://invalid:invalid@127.0.0.1:1/none';
});

// Prisma simulado en memoria: interpreta las consultas SQL crudas que usa session-revocation.ts.
const db = {
    tv: 0,
    revoked: new Set<string>(),
    userExists: true,
    hasTvColumn: true,
    hasRevTable: true,
    failHard: false,
    queries: 0,
};
const missing = (what: string) => Object.assign(new Error(`${what} does not exist`), { code: '42P01' });

vi.mock('../prisma', () => ({
    prisma: {
        $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
            db.queries++;
            if (db.failHard) throw new Error('connection refused');
            const sql = strings.join('?');
            if (sql.includes('EXISTS (SELECT 1 FROM "RevokedSession"')) {
                if (!db.hasTvColumn) throw missing('column "tokenVersion"');
                if (!db.hasRevTable) throw missing('relation "RevokedSession"');
                if (!db.userExists) return [];
                return [{ tv: db.tv, revoked: db.revoked.has(values[0]) }];
            }
            if (sql.includes('SELECT "tokenVersion" AS tv')) {
                if (!db.hasTvColumn) throw missing('column "tokenVersion"');
                return db.userExists ? [{ tv: db.tv }] : [];
            }
            if (sql.includes('FROM "RevokedSession" WHERE "jti"')) {
                if (!db.hasRevTable) throw missing('relation "RevokedSession"');
                return db.revoked.has(values[0]) ? [{ x: 1 }] : [];
            }
            if (sql.includes('UPDATE "User" SET "tokenVersion"')) {
                if (!db.hasTvColumn) throw missing('column "tokenVersion"');
                db.tv += 1;
                return [{ tv: db.tv }];
            }
            throw new Error(`unexpected query: ${sql}`);
        }),
        $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
            const sql = strings.join('?');
            if (sql.includes('INSERT INTO "RevokedSession"')) {
                if (!db.hasRevTable) throw missing('relation "RevokedSession"');
                db.revoked.add(values[0]);
                return 1;
            }
            if (sql.includes('DELETE FROM "RevokedSession"')) return 0;
            throw new Error(`unexpected exec: ${sql}`);
        }),
    },
}));

import {
    isSessionPayload,
    renewSessionIfNeeded,
    signJWT,
    signPendingJWT,
    signSessionJWT,
    verifyJWT,
    verifyPendingJWT,
} from '../jwt';
import {
    __resetRevocationCache,
    bumpTokenVersion,
    checkSessionNotRevoked,
    getTokenVersion,
    revokeSession,
} from '../session-revocation';

const ENV_KEYS = ['SESSION_TTL_SECONDS', 'SESSION_ABSOLUTE_MAX_SECONDS', 'SESSION_REVOCATION_CACHE_MS', 'SESSION_ALLOW_LEGACY_TOKENS', 'NEXTAUTH_SECRET'];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.NEXTAUTH_SECRET = 'test-secret-session';
    process.env.SESSION_REVOCATION_CACHE_MS = '0'; // sin cache salvo en el test dedicado
    Object.assign(db, { tv: 0, revoked: new Set<string>(), userExists: true, hasTvColumn: true, hasRevTable: true, failHard: false, queries: 0 });
    __resetRevocationCache();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
    for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
    vi.restoreAllMocks();
});

const nowSec = () => Math.floor(Date.now() / 1000);

async function issue(tv = 0, opts: { mfa?: boolean; at?: number } = {}) {
    const { token, jti } = await signSessionJWT({ sub: 'user-1', email: 'a@b.com', name: 'A' }, { tv, ...opts });
    const payload = (await verifyJWT(token))!;
    return { token, jti, payload };
}

describe('JWT de sesion: claims y separacion de tipos', () => {
    it('lleva jti, tv, at, use=session y vigencia por inactividad (24 h por defecto)', async () => {
        const { payload, jti } = await issue(3);
        expect(payload).toMatchObject({ sub: 'user-1', use: 'session', jti, tv: 3 });
        expect(typeof payload.at).toBe('number');
        expect(payload.exp! - payload.iat!).toBe(24 * 3600);
        expect(isSessionPayload(payload)).toBe(true);
    });

    it('SESSION_TTL_SECONDS acorta la sesion y el tope absoluto la recorta mas', async () => {
        process.env.SESSION_TTL_SECONDS = '600';
        expect((await issue()).payload.exp! - nowSec()).toBeLessThanOrEqual(600);
        process.env.SESSION_ABSOLUTE_MAX_SECONDS = '3600';
        const at = nowSec() - 3500; // quedan 100 s del tope absoluto
        const { payload } = await issue(0, { at });
        expect(payload.exp! - nowSec()).toBeLessThanOrEqual(100);
    });

    it('incluye mfa solo si se verifico el segundo factor', async () => {
        expect((await issue()).payload.mfa).toBeUndefined();
        expect((await issue(0, { mfa: true })).payload.mfa).toBe(true);
    });

    it('un token molt_access o de MFA pendiente NO vale como sesion', async () => {
        const molt = (await verifyJWT(await signJWT({ sub: 'user-1', type: 'molt_access' }, 3600)))!;
        expect(isSessionPayload(molt)).toBe(false);
        const pending = await signPendingJWT('mfa', { sub: 'user-1' });
        // firmado con clave derivada: ni siquiera verifica como JWT de sesion (bloomx-backend usa NEXTAUTH_SECRET a secas)
        expect(await verifyJWT(pending)).toBeNull();
        expect(isSessionPayload(await verifyJWT(pending))).toBe(false);
        expect(await verifyPendingJWT(pending, 'mfa')).not.toBeNull();
        // y una sesion no vale como paso MFA
        expect(await verifyPendingJWT((await issue()).token, 'mfa')).toBeNull();
    });

    it('rechaza firmas ajenas y alg=none', async () => {
        const { token } = await issue();
        const [h, p] = token.split('.');
        expect(await verifyJWT(`${h}.${p}.AAAA`)).toBeNull();
        const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${p}.`;
        expect(await verifyJWT(none)).toBeNull();
    });
});

describe('renovacion deslizante', () => {
    it('no renueva un token recien emitido', async () => {
        const { payload } = await issue();
        expect(await renewSessionIfNeeded(payload)).toBeNull();
    });

    it('renueva cuando queda menos de la mitad, conservando jti/tv/at/mfa', async () => {
        const at = nowSec() - 3600;
        const old = (await verifyJWT(await signJWT({ sub: 'user-1', use: 'session', jti: 'J1', tv: 2, at, mfa: true }, 100)))!;
        const renewed = await renewSessionIfNeeded(old);
        expect(renewed).not.toBeNull();
        const p = (await verifyJWT(renewed!.token))!;
        expect(p).toMatchObject({ sub: 'user-1', jti: 'J1', tv: 2, at, mfa: true, use: 'session' });
        expect(p.exp!).toBeGreaterThan(old.exp!);
    });

    it('respeta el tope absoluto: pasado el limite no se renueva', async () => {
        process.env.SESSION_ABSOLUTE_MAX_SECONDS = '3600';
        const old = (await verifyJWT(await signJWT({ sub: 'user-1', use: 'session', jti: 'J2', tv: 0, at: nowSec() - 4000 }, 100)))!;
        expect(await renewSessionIfNeeded(old)).toBeNull();
    });

    it('los tokens heredados (sin jti) no se renuevan', async () => {
        const legacy = (await verifyJWT(await signJWT({ sub: 'user-1' }, 100)))!;
        expect(await renewSessionIfNeeded(legacy)).toBeNull();
    });
});

describe('revocacion (jti y tokenVersion)', () => {
    it('sesion valida', async () => {
        const { payload } = await issue();
        expect(await checkSessionNotRevoked(payload as any)).toEqual({ valid: true });
    });

    it('logout: revocar el jti invalida SOLO esa sesion', async () => {
        const a = await issue();
        const b = await issue();
        expect(await revokeSession(a.jti, 'user-1', a.payload.exp)).toBe(true);
        expect(await checkSessionNotRevoked(a.payload as any)).toEqual({ valid: false, reason: 'revoked' });
        expect((await checkSessionNotRevoked(b.payload as any)).valid).toBe(true);
    });

    it('cambio de contrasena / cerrar todo: tokenVersion++ invalida los anteriores y no los nuevos', async () => {
        const before = await issue(await getTokenVersion('user-1'));
        expect(await bumpTokenVersion('user-1')).toBe(1);
        expect(await checkSessionNotRevoked(before.payload as any)).toEqual({ valid: false, reason: 'version_mismatch' });
        const after = await issue(await getTokenVersion('user-1'));
        expect(after.payload.tv).toBe(1);
        expect((await checkSessionNotRevoked(after.payload as any)).valid).toBe(true);
    });

    it('token heredado (sin jti): valido solo dentro de la vigencia por inactividad desde su iat', async () => {
        const fresh = (await verifyJWT(await signJWT({ sub: 'user-1' }, 3600)))!;
        expect((await checkSessionNotRevoked(fresh as any)).valid).toBe(true);
        const old = { sub: 'user-1', iat: nowSec() - 25 * 3600, exp: nowSec() + 1000 };
        expect(await checkSessionNotRevoked(old)).toEqual({ valid: false, reason: 'legacy_expired' });
        process.env.SESSION_ALLOW_LEGACY_TOKENS = 'false';
        expect(await checkSessionNotRevoked(fresh as any)).toEqual({ valid: false, reason: 'legacy_disabled' });
    });

    it('tokenVersion tambien invalida tokens heredados si se sube la version', async () => {
        const legacy = (await verifyJWT(await signJWT({ sub: 'user-1' }, 3600)))!;
        await bumpTokenVersion('user-1');
        expect((await checkSessionNotRevoked(legacy as any)).valid).toBe(false);
    });

    it('usuario inexistente => user_missing', async () => {
        db.userExists = false;
        const { payload } = await issue();
        expect(await checkSessionNotRevoked(payload as any)).toEqual({ valid: false, reason: 'user_missing' });
    });

    it('error real de BD => falla cerrado (error)', async () => {
        const { payload } = await issue();
        db.failHard = true;
        expect(await checkSessionNotRevoked(payload as any)).toEqual({ valid: false, reason: 'error' });
    });

    it('tolerante al DDL pendiente: sin tabla RevokedSession sigue funcionando con tokenVersion', async () => {
        const { payload } = await issue(0);
        db.hasRevTable = false;
        expect((await checkSessionNotRevoked(payload as any)).valid).toBe(true);
        db.tv = 5;
        __resetRevocationCache();
        expect((await checkSessionNotRevoked(payload as any)).reason).toBe('version_mismatch');
        expect(await revokeSession('x', 'user-1')).toBe(false); // sin tabla: no puede revocar, sin lanzar
    });

    it('tolerante al DDL pendiente: sin columna tokenVersion ni tabla, la sesion sigue siendo valida (sin revocacion)', async () => {
        const { payload } = await issue(0);
        db.hasTvColumn = false;
        db.hasRevTable = false;
        expect((await checkSessionNotRevoked(payload as any)).valid).toBe(true);
        expect(await getTokenVersion('user-1')).toBe(0);
        expect(await bumpTokenVersion('user-1')).toBeNull();
    });

    it('cache: una segunda comprobacion no vuelve a consultar la BD (y la revocacion local la invalida)', async () => {
        process.env.SESSION_REVOCATION_CACHE_MS = '5000';
        const { payload, jti } = await issue();
        await checkSessionNotRevoked(payload as any);
        const q = db.queries;
        await checkSessionNotRevoked(payload as any);
        expect(db.queries).toBe(q);
        await revokeSession(jti, 'user-1');
        expect((await checkSessionNotRevoked(payload as any)).valid).toBe(false);
    });
});
