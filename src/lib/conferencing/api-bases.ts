/**
 * Bases de las APIs de Google/Zoom que el HOST llama directamente (adaptadores de compatibilidad, refresco de tokens,
 * OAuth de la cuenta organizadora). En produccion son SIEMPRE las URL oficiales: una variable de entorno solo las
 * sustituye para pruebas/E2E locales, es decir con NODE_ENV != 'production' o si el destino es localhost/127.0.0.1/[::1].
 * Un servidor falso (scripts/fake-conferencing.mjs) se apoya en esto; en un despliegue real no se puede redirigir el
 * trafico con credenciales hacia un host arbitrario.
 */

type Env = Record<string, string | undefined>;

export const DEFAULT_BASES = {
    GOOGLE_API_BASE: 'https://www.googleapis.com',
    MEET_API_BASE: 'https://meet.googleapis.com',
    GOOGLE_TOKEN_URL: 'https://oauth2.googleapis.com/token',
    GOOGLE_AUTH_URL: 'https://accounts.google.com/o/oauth2/v2/auth',
    GOOGLE_USERINFO_URL: 'https://www.googleapis.com/oauth2/v2/userinfo',
    ZOOM_API_BASE: 'https://api.zoom.us/v2',
    ZOOM_OAUTH_BASE: 'https://zoom.us',
} as const;

export type ApiBaseName = keyof typeof DEFAULT_BASES;

function isLocalHost(hostname: string): boolean {
    const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost');
}

/** Base efectiva de una API (override solo para tests/localhost; nunca en produccion hacia hosts remotos). */
export function apiBase(name: ApiBaseName, env: Env = process.env): string {
    const def: string = DEFAULT_BASES[name];
    const raw = env[name];
    if (!raw || !raw.trim()) return def;
    let url: URL;
    try {
        url = new URL(raw.trim());
    } catch {
        return def;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return def;
    if (url.username || url.password) return def;
    const production = env.NODE_ENV === 'production';
    if (production && !isLocalHost(url.hostname)) return def;
    return url.href.replace(/\/+$/, '');
}
