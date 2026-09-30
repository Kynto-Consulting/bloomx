import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { apiBase } from '@/lib/conferencing/api-bases';
import { fetchAdminDomain, putCredentials } from '@/lib/conferencing/admin-backend';
import { clearOAuthStateCookie, verifyOAuthState } from '@/lib/oauth-state';
import { auditLog, getClientIp, isSafeRelativePath } from '@/lib/security';

export const runtime = 'nodejs';

const PROVIDER = 'google-organizer';
const NO_STORE = { 'Cache-Control': 'no-store' };

function back(req: NextRequest, returnTo: string, status: 'organizer_ok' | 'organizer_error'): NextResponse {
    const url = new URL(returnTo, req.nextUrl.origin);
    url.searchParams.set('conferencing', status);
    const res = NextResponse.redirect(url, { headers: NO_STORE });
    clearOAuthStateCookie(res, PROVIDER);
    res.cookies.set('bloomx_organizer_return', '', { path: `/api/auth/callback/${PROVIDER}`, maxAge: 0 });
    return res;
}

/**
 * GET /api/auth/callback/google-organizer  (SOLO admin de la instancia)
 * Canjea el codigo, lee el email de la cuenta y guarda en el almacen de credenciales del dominio (cifrado en el backend,
 * solo para el manager dueno) de core-google-meet y core-calendar:
 *   GOOGLE_AUTH_MODE=google-account, GOOGLE_ORGANIZER_REFRESH_TOKEN, GOOGLE_ORGANIZER_EMAIL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
 * El refresh token NUNCA se devuelve al navegador ni se registra.
 */
export async function GET(req: NextRequest) {
    const returnToCookie = req.cookies.get('bloomx_organizer_return')?.value;
    const returnTo = isSafeRelativePath(returnToCookie) ? (returnToCookie as string) : '/';

    const guard = await requireAdmin(req);
    if (!guard.ok) return guard.response;

    const st = verifyOAuthState(req, PROVIDER, guard.actor.id);
    if (!st.ok) {
        auditLog('auth.oauth.state_mismatch', { provider: PROVIDER, reason: st.reason, userId: guard.actor.id, ip: getClientIp(req) });
        return back(req, returnTo, 'organizer_error');
    }

    const code = req.nextUrl.searchParams.get('code');
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!code || !clientId || !clientSecret) return back(req, returnTo, 'organizer_error');

    try {
        const tokenRes = await fetch(apiBase('GOOGLE_TOKEN_URL'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback/${PROVIDER}`,
                grant_type: 'authorization_code',
            }),
            signal: AbortSignal.timeout(10_000),
        });
        const tokens: any = await tokenRes.json().catch(() => ({}));
        // Sin refresh_token no hay cuenta organizadora utilizable (Google solo lo entrega con prompt=consent + offline).
        if (!tokenRes.ok || tokens.error || !tokens.refresh_token) return back(req, returnTo, 'organizer_error');

        let email = '';
        try {
            const profile = await fetch(apiBase('GOOGLE_USERINFO_URL'), {
                headers: { Authorization: `Bearer ${tokens.access_token}` },
                signal: AbortSignal.timeout(8_000),
            });
            const p: any = await profile.json().catch(() => ({}));
            if (typeof p.email === 'string') email = p.email.slice(0, 254);
        } catch {
            // el email es solo informativo
        }

        const cookie = req.headers.get('cookie') || '';
        const info = await fetchAdminDomain(cookie);
        if (!info) return back(req, returnTo, 'organizer_error');

        const credentials: Record<string, string> = {
            GOOGLE_AUTH_MODE: 'google-account',
            GOOGLE_ORGANIZER_REFRESH_TOKEN: String(tokens.refresh_token),
            GOOGLE_CLIENT_ID: clientId,
            GOOGLE_CLIENT_SECRET: clientSecret,
            ...(email ? { GOOGLE_ORGANIZER_EMAIL: email } : {}),
        };
        let saved = 0;
        for (const id of ['core-google-meet', 'core-calendar'] as const) {
            const install = info.installs[id];
            if (install.installId && (await putCredentials(cookie, info.domainId, install.installId, credentials))) saved++;
        }
        auditLog('admin.conferencing.organizer_connected', {
            userId: guard.actor.id,
            ip: getClientIp(req),
            outcome: saved > 0 ? 'ok' : 'failed',
            extensions: saved,
        });
        return back(req, returnTo, saved > 0 ? 'organizer_ok' : 'organizer_error');
    } catch {
        return back(req, returnTo, 'organizer_error');
    }
}
