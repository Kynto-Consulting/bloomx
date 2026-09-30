import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Red de seguridad: si por error se cargara el Prisma REAL, que apunte a un destino inalcanzable y nunca a la BD del .env.
vi.hoisted(() => {
    process.env.DATABASE_URL = 'postgresql://invalid:invalid@127.0.0.1:1/none';
});

// Almacen "UserMfa" simulado en memoria: interpreta el SQL crudo de lib/mfa.ts.
type Row = { userId: string; secretEnc: string; enabled: boolean; lastStep: bigint; recoveryHashes: string[] };
const store = new Map<string, Row>();
let tableExists = true;

const missing = () => Object.assign(new Error('relation "UserMfa" does not exist'), { code: '42P01' });

vi.mock('../prisma', () => ({
    prisma: {
        $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...v: any[]) => {
            if (!tableExists) throw missing(); // tabla ausente
            const sql = strings.join('?');
            if (sql.includes('FROM "UserMfa" WHERE "userId"')) {
                const r = store.get(v[0]);
                return r ? [{ ...r }] : [];
            }
            throw new Error('unexpected query ' + sql);
        }),
        $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...v: any[]) => {
            if (!tableExists) throw missing(); // tabla ausente
            const sql = strings.join('?');
            if (sql.includes('INSERT INTO "UserMfa"')) {
                const [userId, secretEnc] = v;
                const cur = store.get(userId);
                if (cur?.enabled) return 0; // ON CONFLICT ... WHERE enabled = FALSE
                store.set(userId, { userId, secretEnc, enabled: false, lastStep: BigInt(0), recoveryHashes: [] });
                return 1;
            }
            if (sql.includes('SET "enabled" = TRUE')) {
                const [step, hashesJson, userId] = v;
                const r = store.get(userId);
                if (!r || r.enabled) return 0;
                Object.assign(r, { enabled: true, lastStep: BigInt(step), recoveryHashes: JSON.parse(hashesJson) });
                return 1;
            }
            if (sql.includes('SET "lastStep" =') && sql.includes('"lastStep" <')) {
                const [step, userId] = v;
                const r = store.get(userId);
                if (!r || !r.enabled || !(r.lastStep < BigInt(step))) return 0;
                r.lastStep = BigInt(step);
                return 1;
            }
            if (sql.includes('jsonb_array_elements')) {
                const [hash, userId] = v;
                const r = store.get(userId);
                if (!r || !r.enabled || !r.recoveryHashes.includes(hash)) return 0;
                r.recoveryHashes = r.recoveryHashes.filter((h) => h !== hash);
                return 1;
            }
            if (sql.includes('UPDATE "UserMfa" SET "recoveryHashes"')) {
                const [hashesJson, userId] = v;
                store.get(userId)!.recoveryHashes = JSON.parse(hashesJson);
                return 1;
            }
            if (sql.includes('DELETE FROM "UserMfa"')) {
                store.delete(v[0]);
                return 1;
            }
            throw new Error('unexpected exec ' + sql);
        }),
    },
}));

import {
    beginEnrollment,
    confirmEnrollment,
    disableMfa,
    getMfaStatus,
    isAdminEmail,
    mfaRequiredFor,
    regenerateRecoveryCodes,
    verifyMfa,
} from '../mfa';
import { decrypt } from '../encryption';
import { totp } from '../totp';

const ENV_KEYS = ['ADMIN_EMAILS', 'MFA_ENFORCE_ADMIN', 'MFA_REQUIRED_ALL', 'DATA_ENCRYPTION_KEY', 'NEXTAUTH_SECRET'];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.DATA_ENCRYPTION_KEY = 'mfa-test-key';
    process.env.NEXTAUTH_SECRET = 'mfa-test-pepper';
    store.clear();
    tableExists = true;
});
afterEach(() => {
    vi.useRealTimers();
    for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
});

// Codigo TOTP valido "ahora" y para un paso concreto
const codeFor = (secret: string, stepOffset = 0) => totp(secret, Date.now() + stepOffset * 30_000);

async function enroll(userId = 'u1') {
    const { secret } = await beginEnrollment(userId, 'a@b.com', 'Bloomx');
    const res = await confirmEnrollment(userId, codeFor(secret));
    if (!res.ok) throw new Error('confirm failed');
    return { secret, recoveryCodes: res.recoveryCodes };
}

describe('politica: MFA obligatorio para administradores', () => {
    it('ADMIN_EMAILS marca admins (sin distinguir mayusculas) y exige MFA por defecto', () => {
        process.env.ADMIN_EMAILS = 'Root@Dom.com, otro@dom.com';
        expect(isAdminEmail('root@dom.com')).toBe(true);
        expect(isAdminEmail('user@dom.com')).toBe(false);
        expect(mfaRequiredFor('ROOT@dom.com')).toBe(true);
        expect(mfaRequiredFor('user@dom.com')).toBe(false);
    });
    it('MFA_ENFORCE_ADMIN=false lo relaja y MFA_REQUIRED_ALL=true lo exige a todos', () => {
        process.env.ADMIN_EMAILS = 'root@dom.com';
        process.env.MFA_ENFORCE_ADMIN = 'false';
        expect(mfaRequiredFor('root@dom.com')).toBe(false);
        process.env.MFA_REQUIRED_ALL = 'true';
        expect(mfaRequiredFor('cualquiera@dom.com')).toBe(true);
    });
    it('sin ADMIN_EMAILS nadie es admin', () => {
        expect(isAdminEmail('a@b.com')).toBe(false);
        expect(isAdminEmail('')).toBe(false);
    });
});

describe('enrolamiento', () => {
    it('el secreto se guarda cifrado (v3) y no activa MFA hasta confirmar', async () => {
        const { secret, otpauthUri } = await beginEnrollment('u1', 'a@b.com', 'Bloomx');
        expect(otpauthUri).toContain(`secret=${secret}`);
        const row = store.get('u1')!;
        expect(row.secretEnc).toMatch(/^v3:/);
        expect(row.secretEnc).not.toContain(secret);
        expect(decrypt(row.secretEnc)).toBe(secret);
        expect(await getMfaStatus('u1')).toMatchObject({ available: true, enabled: false, pendingEnrollment: true });
    });

    it('un codigo incorrecto no activa; el correcto activa y devuelve 10 codigos de recuperacion', async () => {
        const { secret } = await beginEnrollment('u1', 'a@b.com', 'Bloomx');
        expect((await confirmEnrollment('u1', '000000')).ok).toBe(false);
        expect((await getMfaStatus('u1')).enabled).toBe(false);
        const res = await confirmEnrollment('u1', codeFor(secret));
        expect(res.ok).toBe(true);
        if (res.ok) {
            expect(res.recoveryCodes).toHaveLength(10);
            expect(store.get('u1')!.recoveryHashes).toHaveLength(10);
            // los codigos NO se guardan en claro
            for (const c of res.recoveryCodes) expect(JSON.stringify(store.get('u1'), (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toContain(c);
        }
        expect(await getMfaStatus('u1')).toMatchObject({ enabled: true, recoveryCodesLeft: 10 });
    });

    it('no se puede reiniciar el enrolamiento con MFA ya activo', async () => {
        await enroll();
        await expect(beginEnrollment('u1', 'a@b.com', 'Bloomx')).rejects.toThrow('MFA_ALREADY_ENABLED');
    });

    it('reiniciar antes de confirmar invalida el secreto anterior', async () => {
        const first = await beginEnrollment('u1', 'a@b.com', 'Bloomx');
        const second = await beginEnrollment('u1', 'a@b.com', 'Bloomx');
        expect(second.secret).not.toBe(first.secret);
        expect((await confirmEnrollment('u1', codeFor(first.secret))).ok).toBe(false);
        expect((await confirmEnrollment('u1', codeFor(second.secret))).ok).toBe(true);
    });
});

describe('verificacion en el login', () => {
    it('acepta un codigo valido y rechaza uno incorrecto', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-29T12:00:10Z'));
        const { secret } = await enroll();
        vi.setSystemTime(new Date('2026-09-29T12:01:10Z')); // 2 pasos despues del de confirmacion
        expect(await verifyMfa('u1', { code: '123456' })).toEqual({ ok: false });
        expect(await verifyMfa('u1', { code: codeFor(secret) })).toEqual({ ok: true, method: 'totp' });
    });

    it('anti-replay: el mismo codigo (o uno anterior) no se acepta dos veces', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-29T12:00:10Z'));
        const { secret } = await enroll(); // confirma con el paso T
        // el codigo usado en el enrolamiento ya no vale
        expect(await verifyMfa('u1', { code: codeFor(secret) })).toEqual({ ok: false });
        vi.setSystemTime(new Date('2026-09-29T12:00:50Z')); // paso T+1
        const c = codeFor(secret);
        expect((await verifyMfa('u1', { code: c })).ok).toBe(true);
        expect((await verifyMfa('u1', { code: c })).ok).toBe(false); // replay
        expect((await verifyMfa('u1', { code: codeFor(secret, -1) })).ok).toBe(false); // paso anterior tras usar uno posterior
    });

    it('carrera: dos verificaciones simultaneas con el mismo codigo, solo una gana', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-29T12:00:10Z'));
        const { secret } = await enroll();
        vi.setSystemTime(new Date('2026-09-29T12:01:10Z'));
        const c = codeFor(secret);
        const results = await Promise.all([verifyMfa('u1', { code: c }), verifyMfa('u1', { code: c })]);
        expect(results.filter((r) => r.ok)).toHaveLength(1);
    });

    it('un usuario sin MFA activo no verifica nada', async () => {
        expect(await verifyMfa('nadie', { code: '123456' })).toEqual({ ok: false });
        const { secret } = await beginEnrollment('u2', 'x@y.com', 'Bloomx'); // pendiente, no activo
        expect(await verifyMfa('u2', { code: codeFor(secret) })).toEqual({ ok: false });
    });

    it('sin codigo ni recovery => falla', async () => {
        await enroll();
        expect(await verifyMfa('u1', {})).toEqual({ ok: false });
        expect(await verifyMfa('u1', { code: '' })).toEqual({ ok: false });
    });
});

describe('codigos de recuperacion', () => {
    it('cada codigo funciona una sola vez (acepta minusculas/espacios)', async () => {
        const { recoveryCodes } = await enroll();
        const code = recoveryCodes[3];
        const first = await verifyMfa('u1', { recoveryCode: code.toLowerCase().replace('-', ' ') });
        expect(first).toEqual({ ok: true, method: 'recovery', recoveryCodesLeft: 9 });
        expect((await verifyMfa('u1', { recoveryCode: code })).ok).toBe(false);
        expect((await verifyMfa('u1', { recoveryCode: recoveryCodes[4] })).ok).toBe(true);
        expect((await getMfaStatus('u1')).recoveryCodesLeft).toBe(8);
    });

    it('un codigo inventado no vale', async () => {
        await enroll();
        expect((await verifyMfa('u1', { recoveryCode: 'AAAAA-BBBBB' })).ok).toBe(false);
        expect((await verifyMfa('u1', { recoveryCode: 'x' })).ok).toBe(false);
    });

    it('regenerar invalida los anteriores', async () => {
        const { recoveryCodes } = await enroll();
        const fresh = (await regenerateRecoveryCodes('u1'))!;
        expect(fresh).toHaveLength(10);
        expect((await verifyMfa('u1', { recoveryCode: recoveryCodes[0] })).ok).toBe(false);
        expect((await verifyMfa('u1', { recoveryCode: fresh[0] })).ok).toBe(true);
        expect(await regenerateRecoveryCodes('sin-mfa')).toBeNull();
    });
});

describe('desactivar y tolerancia al DDL pendiente', () => {
    it('disableMfa elimina el registro', async () => {
        await enroll();
        await disableMfa('u1');
        expect(await getMfaStatus('u1')).toMatchObject({ enabled: false, pendingEnrollment: false });
    });

    it('sin la tabla UserMfa getMfaStatus indica available=false (el login decide: fail-closed solo para admins)', async () => {
        tableExists = false;
        expect(await getMfaStatus('u1')).toEqual({ available: false, enabled: false, pendingEnrollment: false, recoveryCodesLeft: 0 });
        await expect(verifyMfa('u1', { code: '123456' })).rejects.toThrow(/MFA store unavailable/);
    });
});
