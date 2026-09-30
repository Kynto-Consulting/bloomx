import { randomBytes } from 'crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { safeEqual } from './security';

// Parametro `state` anti-CSRF para los OAuth de TERCEROS (Slack, HubSpot, Notion, Zoom...), mismo patron que Google:
// nonce aleatorio ligado al navegador por una cookie HttpOnly + `state` que lo repite (RFC 6749 10.12, NIST IA-2 / SC-23).
// Ademas el state lleva el proveedor y el usuario que inicio el flujo, para que un callback no se pueda usar
// para vincular una cuenta externa a otro usuario.

export const oauthStateCookieName = (provider: string) => `bloomx_oauth_state_${provider}`;
const callbackPath = (provider: string) => `/api/auth/callback/${provider}`;

export interface OAuthStatePayload {
    p: string; // proveedor
    n: string; // nonce
    u?: string; // userId que inicio el flujo
}

export function createOAuthState(provider: string, userId?: string): { state: string; nonce: string } {
    const nonce = randomBytes(24).toString('base64url');
    const payload: OAuthStatePayload = { p: provider, n: nonce, ...(userId ? { u: userId } : {}) };
    return { state: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url'), nonce };
}

/** Adjunta la cookie del nonce a la respuesta de redireccion hacia el proveedor. */
export function setOAuthStateCookie(res: NextResponse, provider: string, nonce: string) {
    res.cookies.set(oauthStateCookieName(provider), nonce, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: callbackPath(provider),
        maxAge: 600,
    });
}

export function clearOAuthStateCookie(res: NextResponse, provider: string) {
    res.cookies.set(oauthStateCookieName(provider), '', { path: callbackPath(provider), maxAge: 0 });
}

export function decodeOAuthState(state: string | null | undefined): OAuthStatePayload | null {
    if (!state || state.length > 1024) return null;
    try {
        const d = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
        if (typeof d?.p !== 'string' || typeof d?.n !== 'string') return null;
        return { p: d.p, n: d.n, u: typeof d.u === 'string' ? d.u : undefined };
    } catch {
        return null;
    }
}

/**
 * Valida el `state` del callback: proveedor correcto, nonce == cookie y (si se indica) usuario == el que inicio el flujo.
 * Comparacion en tiempo constante.
 */
export function verifyOAuthState(
    req: NextRequest,
    provider: string,
    currentUserId?: string
): { ok: boolean; reason?: string } {
    const decoded = decodeOAuthState(req.nextUrl.searchParams.get('state'));
    const cookieNonce = req.cookies.get(oauthStateCookieName(provider))?.value ?? null;
    if (!decoded || !cookieNonce) return { ok: false, reason: 'missing_state' };
    if (decoded.p !== provider) return { ok: false, reason: 'provider_mismatch' };
    if (!safeEqual(decoded.n, cookieNonce)) return { ok: false, reason: 'nonce_mismatch' };
    if (currentUserId && decoded.u && decoded.u !== currentUserId) return { ok: false, reason: 'user_mismatch' };
    return { ok: true };
}
