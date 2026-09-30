/**
 * Extensiones que el USUARIO desactivo para si mismo, para enviarlas al backend en las peticiones FIRMADAS de hooks/execute.
 *
 * Fuente: `expansionSettings["system:extension-prefs"].disabled` (cifrado en BD, lo escribe la pagina /extensions via
 * /api/settings). Aqui se lee del servidor (nunca del navegador de la peticion en curso, que podria mentir) y se SANEA:
 * solo ids validos, sin duplicados y como maximo MAX_DISABLED_FOR_SERVER.
 *
 * Reglas de seguridad (las aplica el backend, ver hook-runner.ts filterDisabledInstallations):
 *  - las extensiones OBLIGATORIAS (`mandatory` en el manifest o politica del dominio) se ejecutan siempre aunque aparezcan aqui;
 *  - en dominios LEGADOS (sin firma) la lista no se envia y se ejecuta todo como antes.
 */

import { EXTENSION_PREFS_SETTINGS_KEY, normalizePrefs } from '@/lib/expansions/client/prefs';

export const MAX_DISABLED_FOR_SERVER = 200;
const CACHE_TTL_MS = 30_000;
const CACHE_MAX = 2000;
const LOOKUP_TIMEOUT_MS = 2_000;

/** Lista `disabled` de unas expansionSettings ya DESCIFRADAS (cualquier forma inesperada => vacia). */
export function disabledFromSettings(settings: unknown): string[] {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return [];
    const stored = (settings as Record<string, unknown>)[EXTENSION_PREFS_SETTINGS_KEY];
    return normalizePrefs(stored).disabled.slice(0, MAX_DISABLED_FOR_SERVER);
}

const cache = new Map<string, { at: number; ids: string[] }>();

/** Descarta la cache (al guardar las preferencias, o en tests). */
export function invalidateDisabledCache(userId?: string): void {
    if (userId) cache.delete(userId);
    else cache.clear();
}

/**
 * Preferencias del usuario en BD. Lanza si la BD falla (el llamador decide: no enviar la lista = se ejecutan todas, que es el
 * comportamiento de siempre). Cache de 30 s por usuario para no leer la BD en cada correo enviado/abierto.
 */
export async function loadDisabledExtensionsForUser(userId: string, now: number = Date.now()): Promise<string[]> {
    const hit = cache.get(userId);
    if (hit && now - hit.at < CACHE_TTL_MS) return hit.ids;

    const [{ prisma }, { decryptObject }] = await Promise.all([import('@/lib/prisma'), import('@/lib/encryption')]);
    const lookup = prisma.user.findUnique({ where: { id: userId }, select: { expansionSettings: true } });
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('user prefs lookup timeout')), LOOKUP_TIMEOUT_MS));
    const user = await Promise.race([lookup, timeout]);
    const ids = disabledFromSettings(decryptObject(user?.expansionSettings || {}));

    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(userId, { at: now, ids });
    return ids;
}
