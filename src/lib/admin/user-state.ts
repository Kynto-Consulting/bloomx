import { execute, query, tolerant, toIso } from './sql';

/**
 * Estado administrativo por usuario (tabla aditiva "UserAdminState", SQL crudo; DDL en lib/db/schema.ts).
 * Todas las funciones toleran que la tabla aun no exista: lectura => estado por defecto; escritura => `false`.
 */

export interface UserAdminState {
    disabled: boolean;
    disabledAt: string | null;
    mustChangePassword: boolean;
    lastLoginAt: string | null;
    lastLoginIp: string | null;
}

export const DEFAULT_USER_STATE: UserAdminState = { disabled: false, disabledAt: null, mustChangePassword: false, lastLoginAt: null, lastLoginIp: null };

export async function getUserState(userId: string): Promise<UserAdminState> {
    return tolerant(async () => {
        const rows = await query<{ disabled: boolean; disabledAt: Date | null; mustChangePassword: boolean; lastLoginAt: Date | null; lastLoginIp: string | null }>(
            'SELECT "disabled", "disabledAt", "mustChangePassword", "lastLoginAt", "lastLoginIp" FROM "UserAdminState" WHERE "userId" = $1',
            userId,
        );
        const r = rows[0];
        if (!r) return { ...DEFAULT_USER_STATE };
        return {
            disabled: !!r.disabled,
            disabledAt: toIso(r.disabledAt),
            mustChangePassword: !!r.mustChangePassword,
            lastLoginAt: toIso(r.lastLoginAt),
            lastLoginIp: r.lastLoginIp ?? null,
        };
    }, { ...DEFAULT_USER_STATE });
}

export async function isUserDisabled(userId: string): Promise<boolean> {
    return tolerant(async () => {
        const rows = await query<{ d: boolean }>('SELECT "disabled" AS d FROM "UserAdminState" WHERE "userId" = $1', userId);
        return !!rows[0]?.d;
    }, false);
}

/** Crea la fila si no existe y aplica un UPSERT de los campos indicados. Devuelve false si falta la tabla. */
async function upsert(userId: string, sets: { disabled?: boolean; mustChangePassword?: boolean }): Promise<boolean> {
    return tolerant(async () => {
        await execute(
            `INSERT INTO "UserAdminState" ("userId", "disabled", "disabledAt", "mustChangePassword", "updatedAt")
             VALUES ($1, COALESCE($2::boolean, FALSE), CASE WHEN $2::boolean IS TRUE THEN NOW() ELSE NULL END, COALESCE($3::boolean, FALSE), NOW())
             ON CONFLICT ("userId") DO UPDATE SET
               "disabled" = COALESCE($2::boolean, "UserAdminState"."disabled"),
               "disabledAt" = CASE WHEN $2::boolean IS TRUE THEN NOW() WHEN $2::boolean IS FALSE THEN NULL ELSE "UserAdminState"."disabledAt" END,
               "mustChangePassword" = COALESCE($3::boolean, "UserAdminState"."mustChangePassword"),
               "updatedAt" = NOW()`,
            userId,
            sets.disabled ?? null,
            sets.mustChangePassword ?? null,
        );
        return true;
    }, false);
}

export const setUserDisabled = (userId: string, disabled: boolean) => upsert(userId, { disabled });
export const setMustChangePassword = (userId: string, value: boolean) => upsert(userId, { mustChangePassword: value });

/** Registra el ultimo acceso (login correcto). Best-effort. */
export async function touchLastLogin(userId: string, ip?: string | null): Promise<void> {
    await tolerant(async () => {
        await execute(
            `INSERT INTO "UserAdminState" ("userId", "lastLoginAt", "lastLoginIp", "updatedAt") VALUES ($1, NOW(), $2, NOW())
             ON CONFLICT ("userId") DO UPDATE SET "lastLoginAt" = NOW(), "lastLoginIp" = $2, "updatedAt" = NOW()`,
            userId,
            ip ? String(ip).slice(0, 64) : null,
        );
    }, undefined);
}
