import { encrypt, tryDecrypt } from "./encryption";
import { prisma } from "./prisma";
import { ADMIN_LEVEL, MIN_ADMIN_ACCESS_LEVEL, effectiveLevelSync, emailsAtLeast } from "./permissions-core";
import {
    buildOtpauthUri,
    generateRecoveryCodes,
    generateTotpSecret,
    hashRecoveryCode,
    normalizeRecoveryCode,
    verifyTotp,
} from "./totp";

// MFA TOTP (NIST 800-63B AAL2, CIS v8 6.3-6.5, ISO 27001:2022 A.8.5).
// - Secreto TOTP cifrado en reposo con encryption.ts (v3, AES-256-GCM).
// - Codigos de recuperacion: 10, un solo uso, guardados como HMAC-SHA256.
// - Anti-replay: un paso TOTP ya usado no se acepta de nuevo (UserMfa.lastStep, actualizacion atomica).
// - Persistencia en la tabla aditiva "UserMfa" via SQL crudo (no toca el modelo User de Prisma).
// - Obligatorio para administradores: ADMIN_EMAILS (lista separada por comas) + MFA_ENFORCE_ADMIN (por defecto true).
//   Opcional para todos: MFA_REQUIRED_ALL=true.

const MISSING_RE = /does not exist|42P01|42703/i;

export class MfaStoreUnavailableError extends Error {
    constructor() {
        super("MFA store unavailable (table UserMfa missing). Run db:ensure.");
        this.name = "MfaStoreUnavailableError";
    }
}

/**
 * Correos con ACCESO al admin (permission_level >= 1: entorno ADMIN_EMAILS + concesiones de consola). Es el conjunto al que se exige MFA.
 * La instantanea de BD la refrescan los puntos de entrada asincronos (permissions.refreshPermissions); aqui solo se lee.
 */
export function adminEmails(): string[] {
    return emailsAtLeast(MIN_ADMIN_ACCESS_LEVEL);
}

/** Equivale al antiguo "administrador": permission_level >= 3 (entorno = 4). Compatibilidad con los helpers anteriores. */
export function isAdminEmail(email: unknown): boolean {
    return effectiveLevelSync(email).level >= ADMIN_LEVEL;
}

/** El usuario DEBE tener MFA para iniciar sesion: cualquier cuenta con acceso al admin (nivel >= 1). */
export function mfaRequiredFor(email: unknown): boolean {
    if (process.env.MFA_REQUIRED_ALL === "true") return true;
    if (process.env.MFA_ENFORCE_ADMIN === "false") return false;
    return effectiveLevelSync(email).level >= MIN_ADMIN_ACCESS_LEVEL;
}

function pepper(): string {
    return process.env.MFA_RECOVERY_PEPPER || process.env.NEXTAUTH_SECRET || "dev-mfa-pepper";
}

async function db() {
    return prisma;
}

interface MfaRow {
    userId: string;
    secretEnc: string;
    enabled: boolean;
    lastStep: bigint | number | null;
    recoveryHashes: unknown;
}

async function loadRow(userId: string): Promise<MfaRow | null> {
    try {
        const prisma = await db();
        const rows = await prisma.$queryRaw<MfaRow[]>`
            SELECT "userId", "secretEnc", "enabled", "lastStep", "recoveryHashes" FROM "UserMfa" WHERE "userId" = ${userId}`;
        return rows?.[0] ?? null;
    } catch (e: any) {
        if (MISSING_RE.test(String(e?.message || e))) throw new MfaStoreUnavailableError();
        throw e;
    }
}

function hashesOf(row: MfaRow): string[] {
    const v = row.recoveryHashes;
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === "string") {
        try {
            const p = JSON.parse(v);
            return Array.isArray(p) ? p.map(String) : [];
        } catch {
            return [];
        }
    }
    return [];
}

export interface MfaStatus {
    /** false si la tabla aun no existe (despliegue sin migrar). */
    available: boolean;
    enabled: boolean;
    pendingEnrollment: boolean;
    recoveryCodesLeft: number;
}

export async function getMfaStatus(userId: string): Promise<MfaStatus> {
    try {
        const row = await loadRow(userId);
        if (!row) return { available: true, enabled: false, pendingEnrollment: false, recoveryCodesLeft: 0 };
        return {
            available: true,
            enabled: !!row.enabled,
            pendingEnrollment: !row.enabled,
            recoveryCodesLeft: row.enabled ? hashesOf(row).length : 0,
        };
    } catch (e) {
        if (e instanceof MfaStoreUnavailableError) {
            return { available: false, enabled: false, pendingEnrollment: false, recoveryCodesLeft: 0 };
        }
        throw e;
    }
}

/** Inicia (o reinicia, si aun no esta confirmado) el enrolamiento. Devuelve el secreto UNA vez para mostrarlo. */
export async function beginEnrollment(userId: string, accountLabel: string, issuer: string) {
    const existing = await loadRow(userId);
    if (existing?.enabled) throw new Error("MFA_ALREADY_ENABLED");
    const secret = generateTotpSecret();
    const secretEnc = encrypt(secret);
    const prisma = await db();
    await prisma.$executeRaw`
        INSERT INTO "UserMfa" ("userId", "secretEnc", "enabled", "lastStep", "recoveryHashes", "createdAt", "updatedAt")
        VALUES (${userId}, ${secretEnc}, FALSE, 0, '[]'::jsonb, NOW(), NOW())
        ON CONFLICT ("userId") DO UPDATE
        SET "secretEnc" = EXCLUDED."secretEnc", "enabled" = FALSE, "lastStep" = 0, "recoveryHashes" = '[]'::jsonb, "updatedAt" = NOW()
        WHERE "UserMfa"."enabled" = FALSE`;
    return {
        secret,
        otpauthUri: buildOtpauthUri({ secret, account: accountLabel, issuer }),
    };
}

/** Verifica el primer codigo, activa MFA y devuelve los codigos de recuperacion (solo se muestran ahora). */
export async function confirmEnrollment(userId: string, code: string): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false }> {
    const row = await loadRow(userId);
    if (!row || row.enabled) return { ok: false };
    const secret = tryDecrypt(row.secretEnc);
    if (!secret) return { ok: false };
    const step = verifyTotp(secret, code);
    if (step === null) return { ok: false };
    const codes = generateRecoveryCodes(10);
    const hashes = codes.map((c) => hashRecoveryCode(c, pepper()));
    const prisma = await db();
    const n = await prisma.$executeRaw`
        UPDATE "UserMfa" SET "enabled" = TRUE, "lastStep" = ${step}::bigint, "recoveryHashes" = ${JSON.stringify(hashes)}::jsonb,
               "confirmedAt" = NOW(), "updatedAt" = NOW()
        WHERE "userId" = ${userId} AND "enabled" = FALSE`;
    if (Number(n) < 1) return { ok: false };
    return { ok: true, recoveryCodes: codes };
}

export type MfaVerifyResult = { ok: true; method: "totp" | "recovery"; recoveryCodesLeft?: number } | { ok: false };

/** Verifica un codigo TOTP o de recuperacion de un usuario con MFA activo (con anti-replay). */
export async function verifyMfa(userId: string, input: { code?: unknown; recoveryCode?: unknown }): Promise<MfaVerifyResult> {
    const row = await loadRow(userId);
    if (!row || !row.enabled) return { ok: false };
    const prisma = await db();

    if (typeof input.code === "string" && input.code.trim()) {
        const secret = tryDecrypt(row.secretEnc);
        if (!secret) return { ok: false };
        const step = verifyTotp(secret, input.code);
        if (step === null) return { ok: false };
        // Atomico: solo avanza si el paso es mayor que el ultimo usado (bloquea replay y carreras)
        const n = await prisma.$executeRaw`
            UPDATE "UserMfa" SET "lastStep" = ${step}::bigint, "updatedAt" = NOW()
            WHERE "userId" = ${userId} AND "enabled" = TRUE AND "lastStep" < ${step}::bigint`;
        return Number(n) === 1 ? { ok: true, method: "totp" } : { ok: false };
    }

    if (typeof input.recoveryCode === "string" && normalizeRecoveryCode(input.recoveryCode).length >= 10) {
        const h = hashRecoveryCode(input.recoveryCode, pepper());
        const hashes = hashesOf(row);
        if (!hashes.includes(h)) return { ok: false };
        // Atomico: solo si el hash sigue presente; lo elimina (un solo uso)
        const n = await prisma.$executeRaw`
            UPDATE "UserMfa"
            SET "recoveryHashes" = COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements("recoveryHashes") e WHERE e <> to_jsonb(${h}::text)), '[]'::jsonb),
                "updatedAt" = NOW()
            WHERE "userId" = ${userId} AND "enabled" = TRUE AND "recoveryHashes" @> jsonb_build_array(${h}::text)`;
        return Number(n) === 1 ? { ok: true, method: "recovery", recoveryCodesLeft: hashes.length - 1 } : { ok: false };
    }
    return { ok: false };
}

export async function regenerateRecoveryCodes(userId: string): Promise<string[] | null> {
    const row = await loadRow(userId);
    if (!row?.enabled) return null;
    const codes = generateRecoveryCodes(10);
    const hashes = codes.map((c) => hashRecoveryCode(c, pepper()));
    const prisma = await db();
    await prisma.$executeRaw`
        UPDATE "UserMfa" SET "recoveryHashes" = ${JSON.stringify(hashes)}::jsonb, "updatedAt" = NOW() WHERE "userId" = ${userId}`;
    return codes;
}

export async function disableMfa(userId: string): Promise<void> {
    const prisma = await db();
    await prisma.$executeRaw`DELETE FROM "UserMfa" WHERE "userId" = ${userId}`;
}
