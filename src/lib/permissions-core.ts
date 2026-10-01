/**
 * Niveles de permisos de la administracion (`permission_level`, entero 0..4). Modulo PURO (sin BD ni red): la escala, la
 * resolucion del nivel efectivo y las reglas de asignacion. El almacen y la auditoria viven en permissions.ts.
 *
 *   0 user        usuario normal, sin acceso al admin.
 *   1 support     solo lectura: usuarios, auditoria, estado del sistema, spam/reglas en lectura.
 *   2 operator    gestiona cuentas (crear/deshabilitar/reactivar, cuotas, sesiones) y listas de spam; sin configuracion ni seguridad.
 *   3 admin       configuracion de la instancia (marca, extensiones, retencion, politicas, transferencias); gestiona niveles 0-2.
 *   4 superadmin  todo: claves de firma, politicas criticas, acciones destructivas globales y niveles de otros (hasta 4).
 *
 * Nivel efectivo = max(nivel del entorno, nivel en BD):
 *   - ADMIN_EMAILS (semilla / rescate): esos correos son nivel 4 "fijado por entorno" y no se degradan desde la consola.
 *   - ADMIN_EMAILS_LOCKED=true: modo solo-entorno (la consola/CLI no gestiona niveles): 4 si esta en el entorno, 0 si no.
 *   - La manager DUENA del dominio de la instancia se trata como nivel 4 (ver admin-auth.ts).
 */

export type PermissionLevel = 0 | 1 | 2 | 3 | 4;
export const LEVELS: readonly PermissionLevel[] = [0, 1, 2, 3, 4];
export const LEVEL_NAMES: Record<PermissionLevel, string> = { 0: 'user', 1: 'support', 2: 'operator', 3: 'admin', 4: 'superadmin' };
export const MAX_LEVEL: PermissionLevel = 4;
/** Nivel minimo para entrar al admin (y para que el MFA sea obligatorio). */
export const MIN_ADMIN_ACCESS_LEVEL: PermissionLevel = 1;
/** Nivel que equivale al antiguo "administrador" (requireAdmin / isAdminEmail). */
export const ADMIN_LEVEL: PermissionLevel = 3;
/** Maximo de cuentas con nivel >= 3 (admin y superadmin) entre entorno y consola. */
export const MAX_PRIVILEGED_ACCOUNTS = 25;

export const isLevel = (v: unknown): v is PermissionLevel => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 4;
export const levelName = (l: number): string => LEVEL_NAMES[(isLevel(l) ? l : 0) as PermissionLevel];

export type LevelSource = 'env' | 'console' | 'manager' | 'none';
export interface EffectiveLevel { level: PermissionLevel; source: LevelSource }

export const normalizeEmail = (e: unknown): string => String(e ?? '').trim().toLowerCase();

export function envAdminEmails(env: NodeJS.ProcessEnv = process.env): string[] {
    return String(env.ADMIN_EMAILS || '').split(',').map(normalizeEmail).filter(Boolean);
}
export const isPermissionsLocked = (env: NodeJS.ProcessEnv = process.env): boolean => String(env.ADMIN_EMAILS_LOCKED || '').trim().toLowerCase() === 'true';

// ---------------------------------------------------------------------------------------------------------------------
// Instantanea en memoria de los niveles de BD (la rellena permissions.ts; TTL corto = los cambios aplican en <= 30 s)
// ---------------------------------------------------------------------------------------------------------------------
let snapshot = new Map<string, PermissionLevel>();
let loadedAt = 0;

export function setPermissionSnapshot(rows: Iterable<[string, PermissionLevel]>, at = Date.now()): void {
    snapshot = new Map(rows);
    loadedAt = at;
}
export const permissionSnapshotAge = (now = Date.now()): number => (loadedAt ? now - loadedAt : Number.POSITIVE_INFINITY);
export const peekPermissionSnapshot = (): ReadonlyMap<string, PermissionLevel> => snapshot;
export function __resetPermissionSnapshot(): void { snapshot = new Map(); loadedAt = 0; }

/** Nivel efectivo SINCRONO a partir de la instantanea actual (los puntos de entrada asincronos la refrescan antes). */
export function effectiveLevelSync(email: unknown, env: NodeJS.ProcessEnv = process.env): EffectiveLevel {
    const e = normalizeEmail(email);
    if (!e) return { level: 0, source: 'none' };
    const fromEnv = envAdminEmails(env).includes(e);
    if (fromEnv) return { level: 4, source: 'env' };
    if (isPermissionsLocked(env)) return { level: 0, source: 'none' };
    const db = snapshot.get(e);
    return db && db > 0 ? { level: db, source: 'console' } : { level: 0, source: 'none' };
}

/** Correos con nivel efectivo >= `min` (entorno + consola). */
export function emailsAtLeast(min: PermissionLevel, env: NodeJS.ProcessEnv = process.env): string[] {
    const set = new Set<string>(envAdminEmails(env));
    if (!isPermissionsLocked(env)) for (const [e, l] of snapshot) if (l >= min) set.add(e);
    return [...set].filter((e) => effectiveLevelSync(e, env).level >= min);
}

// ---------------------------------------------------------------------------------------------------------------------
// Reglas de asignacion
// ---------------------------------------------------------------------------------------------------------------------
export interface ChangeActor { email: string; level: PermissionLevel }
export interface ChangeInput {
    actor: ChangeActor;
    target: { email: string; level: EffectiveLevel; hasAccount: boolean; mfaEnabled: boolean };
    newLevel: number;
    locked: boolean;
    mfaEnforced: boolean;
    privilegedCount: number;
    confirmSuper?: boolean;
}
export type ChangeDenial =
    | 'permissions_locked' | 'invalid_level' | 'cannot_target_self' | 'fixed_by_env' | 'cannot_modify_peer_or_higher' | 'level_not_assignable'
    | 'account_required' | 'mfa_required_for_level' | 'privileged_limit' | 'confirm_super_required' | 'no_change' | 'insufficient_level';

/**
 * Reglas (todas deben cumplirse):
 *  - modo LOCKED: nada se gestiona por consola/CLI;
 *  - nadie se modifica a si mismo (ni auto-escala ni auto-degrada);
 *  - el entorno fija a sus correos en 4 (solo se cambia quitandolos de ADMIN_EMAILS);
 *  - el objetivo debe tener nivel ESTRICTAMENTE menor al del actor (salvo: un superadmin puede cambiar a otro superadmin de consola);
 *  - solo se asigna un nivel estrictamente menor al propio; el superadmin puede asignar 0..4 pero conceder 4 exige confirmacion explicita;
 *  - para dar nivel >= 1 debe existir la cuenta y tener MFA activo, o MFA obligatorio (se enrola en su primer acceso);
 *  - maximo de cuentas con nivel >= 3.
 */
export function checkPermissionChange(i: ChangeInput): ChangeDenial | null {
    if (i.locked) return 'permissions_locked';
    if (!isLevel(i.newLevel)) return 'invalid_level';
    if (i.actor.level < 3) return 'insufficient_level';
    if (normalizeEmail(i.actor.email) === normalizeEmail(i.target.email)) return 'cannot_target_self';
    if (i.target.level.source === 'env') return 'fixed_by_env';
    const cur = i.target.level.level;
    const peerSuper = i.actor.level === 4 && cur === 4; // un superadmin puede revocar/cambiar a otro superadmin de consola
    if (!peerSuper && cur >= i.actor.level) return 'cannot_modify_peer_or_higher';
    if (i.newLevel === cur) return 'no_change';
    const maxAssignable = i.actor.level === 4 ? 4 : i.actor.level - 1;
    if (i.newLevel > maxAssignable) return 'level_not_assignable';
    if (i.newLevel === 4 && i.confirmSuper !== true) return 'confirm_super_required';
    if (i.newLevel >= MIN_ADMIN_ACCESS_LEVEL) {
        if (!i.target.hasAccount) return 'account_required';
        if (!i.mfaEnforced && !i.target.mfaEnabled) return 'mfa_required_for_level';
    }
    if (i.newLevel >= ADMIN_LEVEL && cur < ADMIN_LEVEL && i.privilegedCount >= MAX_PRIVILEGED_ACCOUNTS) return 'privileged_limit';
    return null;
}

/** Estado HTTP de cada denegacion (para rutas y mensajes de comando). */
export const DENIAL_STATUS: Record<ChangeDenial, number> = {
    permissions_locked: 409, invalid_level: 400, cannot_target_self: 409, fixed_by_env: 409, cannot_modify_peer_or_higher: 403, level_not_assignable: 403,
    account_required: 409, mfa_required_for_level: 409, privileged_limit: 409, confirm_super_required: 400, no_change: 409, insufficient_level: 403,
};
