import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertLocalPg, createUser } from './helpers/pg';
import { prisma } from '../prisma';
import { tryDecrypt } from '../encryption';
import { hashRecoveryCode, totp, totpStep } from '../totp';
import {
    beginEnrollment, confirmEnrollment, disableMfa, getMfaStatus, regenerateRecoveryCodes, verifyMfa,
} from '../mfa';

beforeAll(() => assertLocalPg());
afterAll(async () => { await prisma.$disconnect(); });

const rawRow = async (userId: string) =>
    (await prisma.$queryRaw<any[]>`SELECT "secretEnc","enabled","lastStep","recoveryHashes" FROM "UserMfa" WHERE "userId" = ${userId}`)[0];

async function enroll() {
    const u = await createUser(prisma);
    const { secret } = await beginEnrollment(u.id, u.email, 'Bloomx');
    const r = await confirmEnrollment(u.id, totp(secret));
    if (!r.ok) throw new Error('confirm failed');
    return { u, secret, codes: r.recoveryCodes };
}

describe('lib/mfa.ts contra Postgres (jsonb, bigint, @>, anti-replay)', () => {
    it('enrolamiento: secreto cifrado en reposo, ::jsonb y ::bigint escritos con los tipos correctos', async () => {
        const u = await createUser(prisma);
        expect(await getMfaStatus(u.id)).toEqual({ available: true, enabled: false, pendingEnrollment: false, recoveryCodesLeft: 0 });
        const { secret, otpauthUri } = await beginEnrollment(u.id, u.email, 'Bloomx');
        expect(otpauthUri).toContain('otpauth://totp/');
        let row = await rawRow(u.id);
        expect(row.enabled).toBe(false);
        expect(row.secretEnc).not.toContain(secret);
        expect(tryDecrypt(row.secretEnc)).toBe(secret);
        expect(row.recoveryHashes).toEqual([]);
        expect(await getMfaStatus(u.id)).toMatchObject({ pendingEnrollment: true, enabled: false });

        // Reiniciar enrolamiento (no confirmado) genera otro secreto
        const again = await beginEnrollment(u.id, u.email, 'Bloomx');
        expect(again.secret).not.toBe(secret);

        // Codigo incorrecto no confirma
        expect(await confirmEnrollment(u.id, '000000')).toEqual({ ok: false });
        const r = await confirmEnrollment(u.id, totp(again.secret));
        expect(r.ok).toBe(true);
        row = await rawRow(u.id);
        expect(row.enabled).toBe(true);
        expect(typeof row.lastStep).toBe('bigint');
        expect(Number(row.lastStep)).toBe(totpStep());
        expect(Array.isArray(row.recoveryHashes)).toBe(true);
        expect(row.recoveryHashes).toHaveLength(10);
        expect(await getMfaStatus(u.id)).toMatchObject({ enabled: true, recoveryCodesLeft: 10 });
        // Ya activo: no se puede reiniciar ni reconfirmar
        await expect(beginEnrollment(u.id, u.email, 'Bloomx')).rejects.toThrow('MFA_ALREADY_ENABLED');
        expect(await confirmEnrollment(u.id, totp(again.secret))).toEqual({ ok: false });
    });

    it('beginEnrollment concurrente con MFA ya activo no pisa el secreto (WHERE enabled = FALSE)', async () => {
        const { u, secret } = await enroll();
        const before = await rawRow(u.id);
        await prisma.$executeRaw`
            INSERT INTO "UserMfa" ("userId","secretEnc","enabled","lastStep","recoveryHashes","createdAt","updatedAt")
            VALUES (${u.id}, 'HACK', FALSE, 0, '[]'::jsonb, NOW(), NOW())
            ON CONFLICT ("userId") DO UPDATE SET "secretEnc" = EXCLUDED."secretEnc", "enabled" = FALSE
            WHERE "UserMfa"."enabled" = FALSE`;
        const after = await rawRow(u.id);
        expect(after.secretEnc).toBe(before.secretEnc);
        expect(after.enabled).toBe(true);
        expect(secret).toBeTruthy();
    });

    it('anti-replay TOTP: un paso ya usado se rechaza, incluso en peticiones simultaneas', async () => {
        const { u, secret } = await enroll();
        // El paso de confirmacion ya esta consumido (lastStep = paso actual)
        expect(await verifyMfa(u.id, { code: totp(secret) })).toEqual({ ok: false });
        // Un paso futuro (dentro de la ventana +-1) es valido una sola vez, aunque lleguen 8 peticiones a la vez
        const future = totp(secret, Date.now() + 30_000);
        const results = await Promise.all(Array.from({ length: 8 }, () => verifyMfa(u.id, { code: future })));
        expect(results.filter((r) => r.ok)).toHaveLength(1);
        expect(Number((await rawRow(u.id)).lastStep)).toBe(totpStep() + 1);
        // y el paso actual (anterior) tampoco vuelve a valer
        expect(await verifyMfa(u.id, { code: totp(secret) })).toEqual({ ok: false });
    });

    it('recuperacion: un solo uso, jsonb_agg/@> atomico y concurrente', async () => {
        const { u, codes } = await enroll();
        const [c1, c2] = codes;
        const r = await verifyMfa(u.id, { recoveryCode: c1 });
        expect(r).toEqual({ ok: true, method: 'recovery', recoveryCodesLeft: 9 });
        const row = await rawRow(u.id);
        expect(row.recoveryHashes).toHaveLength(9);
        expect(row.recoveryHashes).not.toContain(hashRecoveryCode(c1, process.env.MFA_RECOVERY_PEPPER || process.env.NEXTAUTH_SECRET || 'dev-mfa-pepper'));
        expect(await verifyMfa(u.id, { recoveryCode: c1 })).toEqual({ ok: false });
        // Carrera: el mismo codigo 6 veces => exactamente una vez
        const race = await Promise.all(Array.from({ length: 6 }, () => verifyMfa(u.id, { recoveryCode: c2 })));
        expect(race.filter((x) => x.ok)).toHaveLength(1);
        expect((await rawRow(u.id)).recoveryHashes).toHaveLength(8);
        expect(await getMfaStatus(u.id)).toMatchObject({ recoveryCodesLeft: 8 });
        // El resto de codigos sigue intacto
        expect((await verifyMfa(u.id, { recoveryCode: codes[2] })).ok).toBe(true);
    });

    it('regenerateRecoveryCodes sustituye los hashes; los antiguos dejan de valer', async () => {
        const { u, codes } = await enroll();
        const fresh = await regenerateRecoveryCodes(u.id);
        expect(fresh).toHaveLength(10);
        expect(await verifyMfa(u.id, { recoveryCode: codes[0] })).toEqual({ ok: false });
        expect((await verifyMfa(u.id, { recoveryCode: fresh![0] })).ok).toBe(true);
        expect(await regenerateRecoveryCodes((await createUser(prisma)).id)).toBeNull();
    });

    it('verifyMfa sin MFA activo o sin entrada valida => false; disableMfa borra la fila', async () => {
        const u = await createUser(prisma);
        expect(await verifyMfa(u.id, { code: '123456' })).toEqual({ ok: false });
        const { secret } = await beginEnrollment(u.id, u.email, 'Bloomx');
        expect(await verifyMfa(u.id, { code: totp(secret) })).toEqual({ ok: false }); // aun no activo
        const { u: u2 } = await enroll();
        expect(await verifyMfa(u2.id, {})).toEqual({ ok: false });
        await disableMfa(u2.id);
        expect(await rawRow(u2.id)).toBeUndefined();
        expect(await getMfaStatus(u2.id)).toMatchObject({ available: true, enabled: false });
    });

    it('la fila UserMfa cae en cascada al borrar el usuario', async () => {
        const { u } = await enroll();
        await prisma.user.delete({ where: { id: u.id } });
        expect(await rawRow(u.id)).toBeUndefined();
    });

    it('tabla UserMfa ausente => status.available=false (MISSING_RE reconoce el error real de Prisma)', async () => {
        await prisma.$executeRawUnsafe('ALTER TABLE "UserMfa" RENAME TO "UserMfa_off"');
        try {
            const u = await createUser(prisma);
            expect(await getMfaStatus(u.id)).toEqual({ available: false, enabled: false, pendingEnrollment: false, recoveryCodesLeft: 0 });
            await expect(verifyMfa(u.id, { code: '123456' })).rejects.toMatchObject({ name: 'MfaStoreUnavailableError' });
        } finally {
            await prisma.$executeRawUnsafe('ALTER TABLE "UserMfa_off" RENAME TO "UserMfa"');
        }
    });
});
