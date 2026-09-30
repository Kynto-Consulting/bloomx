import { COOKIE_NAME as BASE_COOKIE_NAME, getSessionTtlSeconds } from "./jwt";

// Cookie de sesion: nombre, atributos, lectura dual (migracion a `__Host-`), renovacion y borrado.
// Modulo "edge-safe" (lo importa el middleware): sin next/headers, solo tipos estructurales.
//
// `__Host-` exige Secure + Path=/ + SIN Domain: el navegador rechaza la cookie si no se cumple, y ningun subdominio
// puede fijar/sobrescribir una cookie con ese prefijo (mitiga session fixation por subdominio).
//   - Produccion (HTTPS):  se escribe `__Host-next-auth.session-token`.
//   - Desarrollo / HTTP:   se mantiene `next-auth.session-token` (sin Secure el navegador descartaria `__Host-`).
// Migracion: durante SESSION_COOKIE_LEGACY_READ (activada por defecto) tambien se LEE la cookie antigua; al
// escribir/renovar se expira la antigua. Cuando las sesiones antiguas hayan caducado (max. 30 dias) basta con
// SESSION_COOKIE_LEGACY_READ=0.

export const HOST_PREFIX = "__Host-";
/** Nombre historico (y el usado en desarrollo). */
export const LEGACY_SESSION_COOKIE_NAME: string = BASE_COOKIE_NAME;

function envFlag(name: string, def: boolean): boolean {
    const v = process.env[name];
    if (v === undefined || v === "") return def;
    return !["0", "false", "off", "no"].includes(v.trim().toLowerCase());
}

/** `__Host-` solo cuando el despliegue es de produccion (HTTPS). SESSION_COOKIE_HOST_PREFIX=0 lo desactiva. */
export function useHostPrefix(): boolean {
    return process.env.NODE_ENV === "production" && envFlag("SESSION_COOKIE_HOST_PREFIX", true);
}

/** Nombre con el que se ESCRIBE la cookie de sesion. */
export function getSessionCookieName(): string {
    return useHostPrefix() ? HOST_PREFIX + LEGACY_SESSION_COOKIE_NAME : LEGACY_SESSION_COOKIE_NAME;
}

/** Si se sigue aceptando la cookie antigua sin prefijo (solo tiene sentido con prefijo activo). */
export function legacyReadEnabled(): boolean {
    return useHostPrefix() && envFlag("SESSION_COOKIE_LEGACY_READ", true);
}

export interface SessionCookieOptions {
    httpOnly: true;
    secure: boolean;
    sameSite: "lax";
    path: "/";
    maxAge: number;
}

/** Atributos (nunca `domain`). En produccion siempre Secure; con `__Host-` es obligatorio. */
export function sessionCookieOptions(maxAge: number = getSessionTtlSeconds()): SessionCookieOptions {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge,
    };
}

type ReadableStore = { get(name: string): { value: string } | undefined };
type WritableStore = { set(name: string, value: string, options: SessionCookieOptions): unknown };

export interface SessionCookieRead {
    token: string | null;
    /** `legacy` = viene de la cookie antigua: conviene migrarla con writeSessionCookie. */
    source: "current" | "legacy" | null;
}

/** Lectura dual: primero el nombre actual; si falta y la lectura antigua esta activa, el nombre antiguo. */
export function readSessionCookie(store: ReadableStore): SessionCookieRead {
    const current = store.get(getSessionCookieName())?.value;
    if (current) return { token: current, source: "current" };
    if (legacyReadEnabled()) {
        const legacy = store.get(LEGACY_SESSION_COOKIE_NAME)?.value;
        if (legacy) return { token: legacy, source: "legacy" };
    }
    return { token: null, source: null };
}

/** Comodidad: solo el token. */
export function getSessionCookieValue(store: ReadableStore): string | null {
    return readSessionCookie(store).token;
}

/** Expira la cookie antigua (mismos atributos que la original: Path=/, sin Domain). No hace nada si el nombre no cambia. */
export function expireLegacySessionCookie(store: WritableStore): void {
    if (getSessionCookieName() === LEGACY_SESSION_COOKIE_NAME) return;
    store.set(LEGACY_SESSION_COOKIE_NAME, "", sessionCookieOptions(0));
}

/** Escribe la cookie de sesion con el nombre actual y expira la antigua. */
export function writeSessionCookie(store: WritableStore, token: string, maxAge: number = getSessionTtlSeconds()): void {
    store.set(getSessionCookieName(), token, sessionCookieOptions(maxAge));
    expireLegacySessionCookie(store);
}

/** Logout: borra la cookie actual y la antigua. */
export function clearSessionCookies(store: WritableStore): void {
    store.set(getSessionCookieName(), "", sessionCookieOptions(0));
    expireLegacySessionCookie(store);
}
