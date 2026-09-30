import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { clearOAuthStateCookie, verifyOAuthState } from '@/lib/oauth-state';
import { auditLog, getClientIp } from '@/lib/security';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const clientId = process.env.SLACK_CLIENT_ID;
    const clientSecret = process.env.SLACK_CLIENT_SECRET;
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback/slack`;

    if (!code || !clientId || !clientSecret) {
        return NextResponse.json({ error: 'Missing parameters or configuration' }, { status: 400 });
    }

    // 1. Sesion y `state` (anti-CSRF) ANTES de canjear el codigo
    const user = await getCurrentUser();
    if (!user) {
        return NextResponse.redirect(new URL('/login?error=LoginRequired', req.url));
    }
    const st = verifyOAuthState(req, 'slack', user.id);
    if (!st.ok) {
        auditLog('auth.oauth.state_mismatch', { provider: 'slack', reason: st.reason, userId: user.id, ip: getClientIp(req) });
        const bad = NextResponse.redirect(new URL('/settings?error=InvalidState', req.url));
        clearOAuthStateCookie(bad, 'slack');
        return bad;
    }

    // 2. Exchange Code for Token
    const form = new URLSearchParams();
    form.append('client_id', clientId);
    form.append('client_secret', clientSecret);
    form.append('code', code);
    form.append('redirect_uri', redirectUri);

    const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form
    });

    const data = await tokenRes.json();
    if (!data.ok) {
        // No se reenvia la respuesta del proveedor al navegador
        const fail = NextResponse.redirect(new URL('/settings?error=OAuthFailed', req.url));
        clearOAuthStateCookie(fail, 'slack');
        return fail;
    }

    // 3. Store Tokens (se cifran en reposo en la capa de acceso: lib/account-tokens.ts)
    // Slack returns 'access_token' (bot) and optional 'authed_user' token
    // We primarily want the bot token for the expansion
    await prisma.account.upsert({
        where: {
            provider_providerAccountId: {
                provider: 'slack',
                providerAccountId: data.app_id || 'unknown' // Slack app ID or Bot ID? usually app_id or bot_user_id
            }
        },
        update: {
            access_token: data.access_token,
            refresh_token: data.refresh_token, // Slack access tokens don't expire unless rotation enabled
            token_type: data.token_type,
            scope: data.scope,
            expires_at: data.expires_in ? Math.floor(Date.now() / 1000 + data.expires_in) : null
        },
        create: {
            userId: user.id,
            type: 'oauth',
            provider: 'slack',
            providerAccountId: data.app_id || 'unknown',
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            token_type: data.token_type,
            scope: data.scope,
            expires_at: data.expires_in ? Math.floor(Date.now() / 1000 + data.expires_in) : null
        }
    });

    auditLog('auth.oauth.linked', { provider: 'slack', userId: user.id, ip: getClientIp(req) });
    const ok = NextResponse.redirect(new URL('/settings', req.url));
    clearOAuthStateCookie(ok, 'slack');
    return ok;
}
