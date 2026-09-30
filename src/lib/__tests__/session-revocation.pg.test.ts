import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { assertLocalPg, createUser, uid } from './helpers/pg';
import { prisma } from '../prisma';
import {
    __resetRevocationCache, bumpTokenVersion, checkSessionNotRevoked, getTokenVersion, purgeExpiredRevocations, revokeSession,
} from '../session-revocation';

beforeAll(() => { assertLocalPg(); process.env.SESSION_REVOCATION_CACHE_MS = '0'; });
beforeEach(() => __resetRevocationCache());
afterAll(async () => { await prisma.$disconnect(); });

const nowSec = () => Math.floor(Date.now() / 1000);

describe('lib/session-revocation.ts contra Postgres', () => {
    it('tokenVersion: empieza en 0, bump devuelve RETURNING y usuarios inexistentes devuelven 0', async () => {
        const u = await createUser(prisma);
        expect(await getTokenVersion(u.id)).toBe(0);
        expect(await bumpTokenVersion(u.id)).toBe(1);
        expect(await bumpTokenVersion(u.id)).toBe(2);
        expect(await getTokenVersion(u.id)).toBe(2);
        expect(await getTokenVersion(uid('nadie'))).toBe(0);
        expect(await bumpTokenVersion(uid('nadie'))).toBe(0);
    });

    it('bumps concurrentes no pierden incrementos', async () => {
        const u = await createUser(prisma);
        await Promise.all(Array.from({ length: 10 }, () => bumpTokenVersion(u.id)));
        expect(await getTokenVersion(u.id)).toBe(10);
    });

    it('checkSessionNotRevoked: valida, revoca por jti, revoca global por tv y usuario inexistente', async () => {
        const u = await createUser(prisma);
        const jti = uid('jti');
        const payload = { sub: u.id, jti, tv: 0, iat: nowSec(), exp: nowSec() + 3600 };
        expect(await checkSessionNotRevoked(payload)).toEqual({ valid: true });

        expect(await revokeSession(jti, u.id, payload.exp)).toBe(true);
        expect(await revokeSession(jti, u.id, payload.exp)).toBe(true); // ON CONFLICT DO NOTHING
        expect(await checkSessionNotRevoked(payload)).toEqual({ valid: false, reason: 'revoked' });

        const other = { sub: u.id, jti: uid('jti'), tv: 0, iat: nowSec() };
        expect((await checkSessionNotRevoked(other)).valid).toBe(true);
        await bumpTokenVersion(u.id);
        expect(await checkSessionNotRevoked(other)).toEqual({ valid: false, reason: 'version_mismatch' });
        expect((await checkSessionNotRevoked({ ...other, jti: uid('jti'), tv: 1 })).valid).toBe(true);

        expect(await checkSessionNotRevoked({ sub: uid('fantasma'), jti: uid('jti'), tv: 0, iat: nowSec() })).toEqual({ valid: false, reason: 'user_missing' });
    });

    it('tokens heredados (sin jti) respetan tokenVersion', async () => {
        const u = await createUser(prisma);
        expect((await checkSessionNotRevoked({ sub: u.id, iat: nowSec() })).valid).toBe(true);
        await bumpTokenVersion(u.id);
        expect(await checkSessionNotRevoked({ sub: u.id, iat: nowSec() })).toEqual({ valid: false, reason: 'version_mismatch' });
    });

    it('purgeExpiredRevocations borra solo las caducadas (expiresAt como TIMESTAMPTZ)', async () => {
        const u = await createUser(prisma);
        const old = uid('old');
        const live = uid('live');
        await revokeSession(old, u.id, nowSec() - 3600);
        await revokeSession(live, u.id, nowSec() + 3600);
        expect(await purgeExpiredRevocations()).toBeGreaterThanOrEqual(1);
        const left = (await prisma.$queryRaw<any[]>`SELECT "jti" FROM "RevokedSession" WHERE "userId" = ${u.id}`).map((r) => r.jti);
        expect(left).toEqual([live]);
    });

    it('tolerancia a esquema sin migrar: sin tabla RevokedSession / sin columna tokenVersion (errores reales de Postgres)', async () => {
        const u = await createUser(prisma);
        // 1) falta la tabla RevokedSession
        await prisma.$executeRawUnsafe('ALTER TABLE "RevokedSession" RENAME TO "RevokedSession_off"');
        try {
            __resetRevocationCache();
            expect(await revokeSession(uid('j'), u.id)).toBe(false);
            expect(await purgeExpiredRevocations()).toBe(0);
            // la comprobacion combinada cae al camino por mecanismo: tv sigue funcionando
            expect((await checkSessionNotRevoked({ sub: u.id, jti: uid('j'), tv: 0, iat: nowSec() })).valid).toBe(true);
            await bumpTokenVersion(u.id);
            expect((await checkSessionNotRevoked({ sub: u.id, jti: uid('j'), tv: 0, iat: nowSec() })).reason).toBe('version_mismatch');
        } finally {
            await prisma.$executeRawUnsafe('ALTER TABLE "RevokedSession_off" RENAME TO "RevokedSession"');
        }
        // 2) falta la columna tokenVersion
        await prisma.$executeRawUnsafe('ALTER TABLE "User" RENAME COLUMN "tokenVersion" TO "tokenVersion_off"');
        try {
            __resetRevocationCache();
            expect(await getTokenVersion(u.id)).toBe(0);
            expect(await bumpTokenVersion(u.id)).toBeNull();
            const jti = uid('j');
            await revokeSession(jti, u.id);
            expect(await checkSessionNotRevoked({ sub: u.id, jti, tv: 0, iat: nowSec() })).toEqual({ valid: false, reason: 'revoked' });
            expect((await checkSessionNotRevoked({ sub: u.id, jti: uid('j'), tv: 0, iat: nowSec() })).valid).toBe(true);
        } finally {
            await prisma.$executeRawUnsafe('ALTER TABLE "User" RENAME COLUMN "tokenVersion_off" TO "tokenVersion"');
        }
    });
});
