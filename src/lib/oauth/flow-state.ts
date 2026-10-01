import { createHash, randomBytes } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { encrypt, tryDecrypt } from '@/lib/encryption';
import { safeEqual } from '@/lib/security';
import { generateCodeVerifier } from './pkce';
import { oauthStore } from './store';

/**
 * ESTADO DEL FLUJO OAUTH (RFC 6749 §10.12, RFC 9700 §4.7, OWASP ASVS V3):
 *  - `state` = 32 bytes aleatorios OPACOS (sin datos dentro: ni returnTo ni usuario).
 *  - Todo lo del flujo (verificador PKCE, nonce OIDC, usuario, modo, redirect_uri exacta, scopes, returnTo, caducidad) viaja en una cookie
 *    HttpOnly + SameSite=Lax CIFRADA (AES-256-GCM, clave de datos de la instancia): el navegador no puede leerla ni alterarla.
 *  - El callback exige que `sha256(state)` de la URL sea el de la cookie (ata el flujo a ESTE navegador: anti login-CSRF) y consume el state
 *    UNA sola vez en BD ("OAuthFlow"; atomico). Caduca a los 10 minutos.
 */

export const FLOW_TTL_MS = 10 * 60_000;
export const flowCookieName = (provider: string) => `bloomx_oauth_flow_${provider}`;

export type FlowMode = 'login' | 'link' | 'reconnect';

export interface FlowRecord {
    v: 1;
    stateHash: string;
    provider: string;
    mode: FlowMode;
    /** Usuario con sesion al iniciar (null = inicio de sesion). El callback exige el mismo. */
    userId: string | null;
    verifier: string | null;
    /** Nonce OIDC (va en la peticion de autorizacion y debe volver dentro del id_token). */
    nonce: string | null;
    redirectUri: string;
    returnTo: string;
    scopes: string[];
    exp: number;
}

export const sha256Hex = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function newFlow(input: { provider: string; mode: FlowMode; userId: string | null; usePkce: boolean; oidc: boolean; redirectUri: string; returnTo: string; scopes: string[]; now?: number }): { state: string; record: FlowRecord } {
    const state = randomToken(32);
    return {
        state,
        record: {
            v: 1,
            stateHash: sha256Hex(state),
            provider: input.provider,
            mode: input.mode,
            userId: input.userId,
            verifier: input.usePkce ? generateCodeVerifier() : null,
            nonce: input.oidc ? randomToken(24) : null,
            redirectUri: input.redirectUri,
            returnTo: input.returnTo,
            scopes: input.scopes,
            exp: (input.now ?? Date.now()) + FLOW_TTL_MS,
        },
    };
}

export function sealFlow(record: FlowRecord): string {
    return encrypt(JSON.stringify(record));
}

export function openFlow(sealed: string | undefined | null): FlowRecord | null {
    if (!sealed || sealed.length > 4096) return null;
    const plain = tryDecrypt(sealed);
    if (!plain) return null;
    try {
        const r = JSON.parse(plain) as FlowRecord;
        if (r?.v !== 1 || typeof r.stateHash !== 'string' || typeof r.provider !== 'string' || typeof r.exp !== 'number' || typeof r.redirectUri !== 'string') return null;
        return r;
    } catch {
        return null;
    }
}

const COOKIE_PATH = '/api';

export function setFlowCookie(res: NextResponse, provider: string, record: FlowRecord): void {
    res.cookies.set(flowCookieName(provider), sealFlow(record), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: COOKIE_PATH, maxAge: Math.floor(FLOW_TTL_MS / 1000) });
}
export function clearFlowCookie(res: NextResponse, provider: string): void {
    res.cookies.set(flowCookieName(provider), '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: COOKIE_PATH, maxAge: 0 });
    // Cookies de versiones anteriores del flujo de Google (nonce suelto): se retiran tambien.
    if (provider === 'google') res.cookies.set('bloomx_oauth_state', '', { path: '/api/auth/callback/google', maxAge: 0 });
}

export type FlowCheck =
    | { ok: true; record: FlowRecord; degraded: boolean }
    | { ok: false; reason: 'no_cookie' | 'bad_cookie' | 'state_mismatch' | 'provider_mismatch' | 'expired' | 'replayed' | 'unknown_state' | 'user_mismatch' | 'missing_state' | 'store_unavailable' };

const memoryConsumed = new Map<string, number>();
let warnedDegraded = false;

/**
 * Verifica y CONSUME el flujo del callback. Orden: cookie -> state (tiempo constante) -> proveedor -> caducidad -> usuario -> consumo unico.
 * `currentUserId` = usuario con sesion en el callback (debe ser el mismo que inicio el flujo; null si no hay sesion).
 */
export async function verifyAndConsumeFlow(req: NextRequest, provider: string, stateParam: string | null, currentUserId: string | null, now = Date.now()): Promise<FlowCheck> {
    if (!stateParam || stateParam.length > 200) return { ok: false, reason: 'missing_state' };
    const sealed = req.cookies.get(flowCookieName(provider))?.value;
    if (!sealed) return { ok: false, reason: 'no_cookie' };
    const record = openFlow(sealed);
    if (!record) return { ok: false, reason: 'bad_cookie' };
    if (!safeEqual(record.stateHash, sha256Hex(stateParam))) return { ok: false, reason: 'state_mismatch' };
    if (record.provider !== provider) return { ok: false, reason: 'provider_mismatch' };
    if (record.exp <= now) return { ok: false, reason: 'expired' };
    if ((record.userId ?? null) !== (currentUserId ?? null)) return { ok: false, reason: 'user_mismatch' };

    const consumed = await oauthStore().consumeFlow(record.stateHash);
    if (consumed === 'ok') return { ok: true, record, degraded: false };
    if (consumed === 'used') return { ok: false, reason: 'replayed' };
    if (consumed === 'expired') return { ok: false, reason: 'expired' };
    if (consumed === 'unknown') return { ok: false, reason: 'unknown_state' };
    // En PRODUCCION no se degrada: sin tabla OAuthFlow no hay "un solo uso" garantizado entre procesos/serverless, asi que se FALLA CERRADO.
    if (process.env.NODE_ENV === 'production') return { ok: false, reason: 'store_unavailable' };
    // 'unavailable' (tabla aun sin crear): en desarrollo/pruebas degrada a un solo uso por proceso + borrado de la cookie. Se avisa UNA vez.
    if (!warnedDegraded) { warnedDegraded = true; console.warn('[OAUTH] Tabla OAuthFlow ausente: state de un solo uso solo por proceso. Ejecuta db:ensure.'); }
    for (const [k, t] of memoryConsumed) if (t < now) memoryConsumed.delete(k);
    if (memoryConsumed.has(record.stateHash)) return { ok: false, reason: 'replayed' };
    memoryConsumed.set(record.stateHash, record.exp);
    return { ok: true, record, degraded: true };
}

export async function persistFlow(record: FlowRecord): Promise<boolean> {
    const store = oauthStore();
    void store.purgeFlows().catch(() => undefined);
    return store.insertFlow({ stateHash: record.stateHash, provider: record.provider, userId: record.userId, mode: record.mode, expiresAt: new Date(record.exp) });
}

export function __resetFlowMemory(): void {
    memoryConsumed.clear();
    warnedDegraded = false;
}
