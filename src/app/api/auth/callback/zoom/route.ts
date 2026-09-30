import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { clearOAuthStateCookie, verifyOAuthState } from '@/lib/oauth-state';
import { auditLog, getClientIp, isSafeRelativePath } from '@/lib/security';
import { apiBase } from '@/lib/conferencing/api-bases';
import { invalidateStatusCache } from '@/lib/conferencing/status';

export const runtime = 'nodejs';

/** Destino tras vincular: `returnTo` (ruta interna guardada al iniciar) o la pantalla principal. */
function destination(req: NextRequest, status: 'zoom_ok' | 'zoom_error' | 'invalid_state'): URL {
    const raw = req.cookies.get('bloomx_oauth_return_zoom')?.value;
    const path = isSafeRelativePath(raw) ? (raw as string) : '/';
    const url = new URL(path, req.url);
    url.searchParams.set('conferencing', status);
    return url;
}

function done(req: NextRequest, status: 'zoom_ok' | 'zoom_error' | 'invalid_state') {
    const res = NextResponse.redirect(destination(req, status));
    clearOAuthStateCookie(res, 'zoom');
    res.cookies.set('bloomx_oauth_return_zoom', '', { path: '/api/auth/callback/zoom', maxAge: 0 });
    return res;
}

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const clientId = process.env.ZOOM_CLIENT_ID;
    const clientSecret = process.env.ZOOM_CLIENT_SECRET;
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback/zoom`;

    if (!code || !clientId || !clientSecret) {
        return NextResponse.json({ error: 'Missing parameters or configuration' }, { status: 400 });
    }

    // 1. Sesion y `state` (anti-CSRF) ANTES de canjear el codigo. La integracion se vincula a un usuario ya autenticado.
    const user = await getCurrentUser();
    if (!user) {
        return NextResponse.redirect(new URL('/login?error=LoginRequired', req.url));
    }
    const st = verifyOAuthState(req, 'zoom', user.id);
    if (!st.ok) {
        auditLog('auth.oauth.state_mismatch', { provider: 'zoom', reason: st.reason, userId: user.id, ip: getClientIp(req) });
        return done(req, 'invalid_state');
    }

    // 2. Exchange Code for Token
    let tokens: any;
    try {
        const tokenRes = await fetch(`${apiBase('ZOOM_OAUTH_BASE')}/oauth/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
            },
            body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
            signal: AbortSignal.timeout(10_000),
        });
        tokens = await tokenRes.json().catch(() => ({}));
        if (!tokenRes.ok || !tokens?.access_token) return done(req, 'zoom_error');
    } catch {
        return done(req, 'zoom_error');
    }

    // 3. Identidad de la cuenta Zoom (informativa): id real si Zoom responde; si no, el id del usuario como antes.
    let zoomUserId = '';
    try {
        const me = await fetch(`${apiBase('ZOOM_API_BASE')}/users/me`, {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
            signal: AbortSignal.timeout(8_000),
        });
        const profile: any = await me.json().catch(() => ({}));
        if (me.ok && typeof profile?.id === 'string' && /^[\w-]{3,64}$/.test(profile.id)) zoomUserId = profile.id;
    } catch {
        // sin perfil: se usa el id del usuario
    }

    // 4. Guardar tokens (cifrados en reposo por la capa de acceso: lib/account-tokens.ts). Una sola cuenta Zoom por usuario:
    //    se actualiza la existente (incluidas las creadas con el id del usuario como providerAccountId) en vez de duplicarla.
    const data = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: Math.floor(Date.now() / 1000 + Number(tokens.expires_in || 3600)),
        token_type: tokens.token_type,
        scope: tokens.scope,
    };
    const existing = await prisma.account.findFirst({ where: { userId: user.id, provider: 'zoom' }, select: { id: true } });
    if (existing) {
        await prisma.account.update({ where: { id: existing.id }, data });
    } else {
        await prisma.account.create({
            data: { userId: user.id, type: 'oauth', provider: 'zoom', providerAccountId: zoomUserId || user.id, ...data },
        });
    }

    invalidateStatusCache({ userId: user.id, domain: (process.env.TOP_DOMAIN || req.headers.get('host') || '').split(':')[0].toLowerCase() });
    auditLog('auth.oauth.linked', { provider: 'zoom', userId: user.id, ip: getClientIp(req) });
    return done(req, 'zoom_ok');
}
