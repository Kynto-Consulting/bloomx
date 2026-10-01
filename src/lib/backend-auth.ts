import { backendUrl } from '@/lib/backend-url';
import type crypto from 'node:crypto';
import {
    parseEd25519PrivateKey,
    parseEd25519PublicKey,
    signRequest,
    verifyBackendSignature,
    type NonceStore,
} from '@/lib/bloomx-signature';
import { clientVersionHeaders } from '@/lib/expansions/client/capabilities';

/**
 * Lado frontend del protocolo con el backend COMPARTIDO (bloomx-backend), sin secretos compartidos:
 *
 *  - SALIDA (frontend -> backend): si BLOOMX_DOMAIN_PRIVATE_KEY esta definida (Ed25519, PEM o base64) se firma cada
 *    peticion (X-BloomX-Signature/Timestamp/Nonce sobre metodo+ruta+sha256(cuerpo)+dominio+usuario). Si no, se sigue
 *    enviando el protocolo ANTIGUO por cabeceras (X-BloomX-Domain, X-User-ID, X-User-Email): el backend lo acepta en
 *    modo LEGADO con privilegios reducidos y responde `X-BloomX-Auth: legacy`. Nunca se reenvia el JWT de sesion.
 *  - ENTRADA (backend -> frontend, /api/internal/mail): se verifica la firma del backend con su clave PUBLICA
 *    (BLOOMX_BACKEND_PUBLIC_KEY o descubrimiento con cache en {NEXT_PUBLIC_BACKEND_URL}/.well-known/bloomx-backend-key.json).
 */


type Env = Record<string, string | undefined>;

export function backendBaseUrl(env: Env = process.env): string {
    return backendUrl(env);
}

let cachedPrivate: { raw: string | undefined; key: crypto.KeyObject | null } | null = null;

/** Clave privada de ESTA instancia (opcional). Invalida => null con aviso (se cae al modo legado, sin romper nada). */
export function loadDomainPrivateKey(env: Env = process.env): crypto.KeyObject | null {
    const raw = env.BLOOMX_DOMAIN_PRIVATE_KEY;
    if (cachedPrivate && cachedPrivate.raw === raw) return cachedPrivate.key;
    let key: crypto.KeyObject | null = null;
    if (raw && raw.trim()) {
        key = parseEd25519PrivateKey(raw);
        if (!key) console.warn('[BACKEND_AUTH] BLOOMX_DOMAIN_PRIVATE_KEY no es una clave Ed25519 valida: se usa el protocolo legado');
    }
    cachedPrivate = { raw, key };
    return key;
}

/** Origen https de esta instancia para el puente de correo (el backend solo lo acepta si es el dominio o un subdominio). */
function callbackOrigin(env: Env): string {
    try {
        const u = new URL(env.NEXT_PUBLIC_APP_URL || '');
        return u.protocol === 'https:' ? u.origin : '';
    } catch {
        return '';
    }
}

export interface BackendCallInit {
    method: string;
    /** URL completa a la que se llama en el backend (la ruta+query forman parte de la firma). */
    url: string;
    /** Cuerpo crudo EXACTO que se enviara ('' si no hay). */
    body?: string;
    /** Dominio del tenant (sin puerto). */
    domain: string;
    userId?: string | null;
    email?: string | null;
    env?: Env;
    nowMs?: number;
}

/**
 * Cabeceras de identidad hacia el backend. Con clave de dominio: firmadas. Sin clave: protocolo antiguo (legado).
 * No incluye Authorization ni ningun JWT de sesion.
 */
export function buildBackendHeaders(init: BackendCallInit): Record<string, string> {
    const env = init.env ?? process.env;
    const domain = init.domain.split(':')[0].toLowerCase();
    const headers: Record<string, string> = {};
    if (domain) headers['X-BloomX-Domain'] = domain;
    if (init.userId) headers['X-User-ID'] = init.userId;
    if (init.email) headers['X-User-Email'] = init.email;

    // Version del cliente (CLIENT_API_VERSION + capacidades): el backend sirve la version de cada extension que ESTE cliente entiende.
    // Con firma se incluye en el mensaje firmado (V2); en modo legado viaja igualmente como dato informativo.
    const version = clientVersionHeaders();
    Object.assign(headers, version);

    const key = loadDomainPrivateKey(env);
    if (!key) return headers;

    const callback = callbackOrigin(env);
    if (callback) headers['X-BloomX-Callback'] = callback;
    const u = new URL(init.url);
    return {
        ...headers,
        ...signRequest(key, {
            method: init.method,
            pathAndQuery: `${u.pathname}${u.search}`,
            body: init.body ?? '',
            domain,
            userId: init.userId ?? '',
            userEmail: init.email ?? '',
            callback,
            clientApi: version['X-BloomX-Client-Api'],
            clientCaps: version['X-BloomX-Client-Caps'],
            nowMs: init.nowMs,
        }),
    };
}

// ---------------------------------------------------------------------------
// Clave publica del backend (para verificar el puente services.mail)
// ---------------------------------------------------------------------------

const DISCOVERY_OK_MS = 5 * 60_000;
const DISCOVERY_FAIL_MS = 30_000;
let discovered: { key: crypto.KeyObject | null; until: number; base: string } | null = null;

export function __resetBackendKeyCache() {
    discovered = null;
}

/** Clave publica del backend: BLOOMX_BACKEND_PUBLIC_KEY (fija, recomendado) o descubrimiento con cache. null = no disponible. */
export async function getBackendPublicKey(env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<crypto.KeyObject | null> {
    if (env.BLOOMX_BACKEND_PUBLIC_KEY) {
        const pinned = parseEd25519PublicKey(env.BLOOMX_BACKEND_PUBLIC_KEY);
        if (!pinned) console.warn('[BACKEND_AUTH] BLOOMX_BACKEND_PUBLIC_KEY no es una clave Ed25519 valida');
        return pinned; // fijada: nunca se descubre otra
    }
    const base = backendBaseUrl(env);
    const now = Date.now();
    if (discovered && discovered.base === base && discovered.until > now) return discovered.key;
    let key: crypto.KeyObject | null = null;
    try {
        const res = await fetchImpl(`${base}/.well-known/bloomx-backend-key.json`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
            const doc: any = await res.json();
            key = parseEd25519PublicKey(doc?.publicKey);
        }
    } catch {
        key = null;
    }
    discovered = { key, until: now + (key ? DISCOVERY_OK_MS : DISCOVERY_FAIL_MS), base };
    return key;
}

/** Nombres con los que esta instancia se identifica como audiencia de las firmas del backend. */
export function ownDomains(env: Env = process.env): string[] {
    const out = new Set<string>();
    if (env.TOP_DOMAIN) out.add(env.TOP_DOMAIN.split(':')[0].toLowerCase());
    try {
        if (env.NEXT_PUBLIC_APP_URL) out.add(new URL(env.NEXT_PUBLIC_APP_URL).hostname.toLowerCase());
    } catch {
        /* sin URL publica */
    }
    return [...out];
}

export async function verifyBackendRequest(
    req: { method: string; url: string; headers: { get(name: string): string | null } },
    rawBody: string,
    opts: { env?: Env; fetchImpl?: typeof fetch; nonces?: NonceStore; nowMs?: number } = {},
): Promise<{ ok: true; userId: string | null } | { ok: false; reason: 'unavailable' | 'invalid' }> {
    const env = opts.env ?? process.env;
    const key = await getBackendPublicKey(env, opts.fetchImpl);
    if (!key) return { ok: false, reason: 'unavailable' };
    const result = verifyBackendSignature({
        method: req.method,
        url: req.url,
        headers: req.headers,
        rawBody,
        backendPublicKey: key,
        expectedDomains: ownDomains(env),
        nonces: opts.nonces,
        nowMs: opts.nowMs,
    });
    return result.ok ? result : { ok: false, reason: 'invalid' };
}
