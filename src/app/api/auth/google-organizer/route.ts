import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { apiBase } from '@/lib/conferencing/api-bases';
import { createOAuthState, setOAuthStateCookie } from '@/lib/oauth-state';
import { isSafeRelativePath } from '@/lib/security';

export const runtime = 'nodejs';

const ORGANIZER_SCOPES = 'openid email https://www.googleapis.com/auth/calendar.events';
const ORGANIZER_PROVIDER = 'google-organizer';

/**
 * GET /api/auth/google-organizer?returnTo=/ruta  (SOLO admin de la instancia)
 * Inicia el consentimiento de Google para la CUENTA ORGANIZADORA de la instancia (modo `google-account` de Google Meet /
 * Calendar) con scopes minimos (calendar.events, openid, email). El callback guarda el refresh token cifrado en el
 * almacen de credenciales del dominio (backend). Requiere registrar
 * `{NEXT_PUBLIC_APP_URL}/api/auth/callback/google-organizer` como URI de redireccion autorizada en Google Cloud.
 */
export async function GET(req: NextRequest) {
    const guard = await requireAdmin(req);
    if (!guard.ok) return guard.response;

    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return NextResponse.json({ error: 'Google Client ID not configured' }, { status: 500 });

    const returnToRaw = req.nextUrl.searchParams.get('returnTo');
    const returnTo = isSafeRelativePath(returnToRaw) ? (returnToRaw as string) : '/';

    const oauth = createOAuthState(ORGANIZER_PROVIDER, guard.actor.id);
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback/${ORGANIZER_PROVIDER}`,
        response_type: 'code',
        scope: ORGANIZER_SCOPES,
        access_type: 'offline',
        prompt: 'consent',
        state: oauth.state,
    });
    const res = NextResponse.redirect(`${apiBase('GOOGLE_AUTH_URL')}?${params.toString()}`);
    setOAuthStateCookie(res, ORGANIZER_PROVIDER, oauth.nonce);
    // returnTo viaja en una cookie propia: el state solo lleva proveedor, nonce y usuario.
    res.cookies.set('bloomx_organizer_return', returnTo, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: `/api/auth/callback/${ORGANIZER_PROVIDER}`,
        maxAge: 600,
    });
    return res;
}
