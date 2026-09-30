import crypto from 'node:crypto';

/**
 * Autenticacion servidor-a-servidor INTERNA de UNA instancia del frontend (webhooks/resend -> process-attachments,
 * api/internal/*, cadenas de cron). Cada instancia tiene su propio NEXTAUTH_SECRET, asi que la clave interna se DERIVA
 * de el con HKDF-SHA256 (info 'bloomx-internal-v1'): no hay que configurar INTERNAL_SECRET en ningun sitio y ningun
 * secreto se comparte con el backend ni con otras instancias.
 *
 * Compatibilidad: si INTERNAL_SECRET esta definido tambien se ACEPTA (y se usa al enviar), para despliegues que ya lo
 * tenian repartido entre procesos. Nunca hay 403/503 por falta de INTERNAL_SECRET si existe NEXTAUTH_SECRET.
 * Solo depende de node:crypto (sin imports del proyecto): probable con vitest sin mocks.
 */

export const INTERNAL_HKDF_INFO = 'bloomx-internal-v1';

type Env = Record<string, string | undefined>;

/** Clave interna derivada (hex de 32 bytes) o null si la instancia no tiene NEXTAUTH_SECRET. */
export function deriveInternalKey(env: Env = process.env): string | null {
    const ikm = env.NEXTAUTH_SECRET;
    if (!ikm) return null;
    const okm = crypto.hkdfSync('sha256', Buffer.from(ikm, 'utf8'), Buffer.alloc(0), Buffer.from(INTERNAL_HKDF_INFO, 'utf8'), 32);
    return Buffer.from(okm).toString('hex');
}

/** Secretos aceptados: el derivado y, solo si esta definido, INTERNAL_SECRET (compat). */
export function acceptedInternalSecrets(env: Env = process.env): string[] {
    const list: string[] = [];
    const derived = deriveInternalKey(env);
    if (derived) list.push(derived);
    if (env.INTERNAL_SECRET) list.push(env.INTERNAL_SECRET);
    return list;
}

/** Valor a enviar en `x-internal-secret` desde esta misma instancia (INTERNAL_SECRET si esta definido, si no el derivado). */
export function internalSecretToSend(env: Env = process.env): string {
    return env.INTERNAL_SECRET || deriveInternalKey(env) || '';
}

function timingSafeEqualStr(a: string, b: string): boolean {
    const ha = crypto.createHash('sha256').update(a).digest();
    const hb = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(ha, hb);
}

export type InternalAuthResult = { ok: true; via: 'derived' | 'env' | 'dev-open' } | { ok: false };

/**
 * Valida la cabecera `x-internal-secret`. Sin ningun secreto disponible (ni NEXTAUTH_SECRET ni INTERNAL_SECRET):
 * cerrado en produccion, abierto en desarrollo (como antes).
 */
export function verifyInternalRequest(headers: { get(name: string): string | null }, env: Env = process.env): InternalAuthResult {
    const derived = deriveInternalKey(env);
    if (!derived && !env.INTERNAL_SECRET) {
        return env.NODE_ENV === 'production' ? { ok: false } : { ok: true, via: 'dev-open' };
    }
    const provided = headers.get('x-internal-secret') || '';
    if (!provided) return { ok: false };
    if (derived && timingSafeEqualStr(provided, derived)) return { ok: true, via: 'derived' };
    if (env.INTERNAL_SECRET && timingSafeEqualStr(provided, env.INTERNAL_SECRET)) return { ok: true, via: 'env' };
    return { ok: false };
}
