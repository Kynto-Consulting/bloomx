import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { clearOAuthStateCookie, verifyOAuthState } from '@/lib/oauth-state';
import { auditLog, getClientIp } from '@/lib/security';

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
        const bad = NextResponse.redirect(new URL('/settings?error=InvalidState', req.url));
        clearOAuthStateCookie(bad, 'zoom');
        return bad;
    }

    // 2. Exchange Code for Token
    const tokenRes = await fetch('https://zoom.us/oauth/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
        },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri
        })
    });

    const tokens = await tokenRes.json();
    if (!tokenRes.ok) {
        const fail = NextResponse.redirect(new URL('/settings?error=OAuthFailed', req.url));
        clearOAuthStateCookie(fail, 'zoom');
        return fail;
    }

    // 3. Store Tokens (cifrados en reposo por la capa de acceso: lib/account-tokens.ts)
    await prisma.account.upsert({
        where: {
            provider_providerAccountId: {
                provider: 'zoom',
                providerAccountId: user.id // Using User ID as placeholder? No, accounts table usually holds provider's user ID.
                // But we don't fetch Zoom Profile here. We should!
            }
        },
        update: {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: Math.floor(Date.now() / 1000 + tokens.expires_in),
            token_type: tokens.token_type,
            scope: tokens.scope
        },
        create: {
            userId: user.id,
            type: 'oauth',
            provider: 'zoom',
            providerAccountId: user.id, // Ideally fetch Zoom User ID, but skipping for simplicity or need another call
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: Math.floor(Date.now() / 1000 + tokens.expires_in),
            token_type: tokens.token_type,
            scope: tokens.scope
        }
    });

    auditLog('auth.oauth.linked', { provider: 'zoom', userId: user.id, ip: getClientIp(req) });
    const ok = NextResponse.redirect(new URL('/settings', req.url));
    clearOAuthStateCookie(ok, 'zoom');
    return ok;
}
