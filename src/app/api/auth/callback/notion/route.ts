import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { clearOAuthStateCookie, verifyOAuthState } from '@/lib/oauth-state';
import { auditLog, getClientIp } from '@/lib/security';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const clientId = process.env.NOTION_CLIENT_ID;
    const clientSecret = process.env.NOTION_CLIENT_SECRET;
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback/notion`;

    if (!code || !clientId || !clientSecret) {
        return NextResponse.json({ error: 'Missing parameters or configuration' }, { status: 400 });
    }

    // Sesion y `state` (anti-CSRF) ANTES de canjear el codigo
    const user = await getCurrentUser();
    if (!user) {
        return NextResponse.redirect(new URL('/login?error=LoginRequired', req.url));
    }
    const st = verifyOAuthState(req, 'notion', user.id);
    if (!st.ok) {
        auditLog('auth.oauth.state_mismatch', { provider: 'notion', reason: st.reason, userId: user.id, ip: getClientIp(req) });
        const bad = NextResponse.redirect(new URL('/settings?error=InvalidState', req.url));
        clearOAuthStateCookie(bad, 'notion');
        return bad;
    }

    const tokenRes = await fetch('https://api.notion.com/v1/oauth/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
        },
        body: JSON.stringify({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri
        })
    });

    const data = await tokenRes.json();
    if (!tokenRes.ok) {
        const fail = NextResponse.redirect(new URL('/settings?error=OAuthFailed', req.url));
        clearOAuthStateCookie(fail, 'notion');
        return fail;
    }

    // Token cifrado en reposo por la capa de acceso (lib/account-tokens.ts)
    await prisma.account.upsert({
        where: {
            provider_providerAccountId: {
                provider: 'notion',
                providerAccountId: data.workspace_id || 'unknown'
            }
        },
        update: {
            access_token: data.access_token,
            // Notion access tokens don't expire usually
        },
        create: {
            userId: user.id,
            type: 'oauth',
            provider: 'notion',
            providerAccountId: data.workspace_id || 'unknown',
            access_token: data.access_token
        }
    });

    auditLog('auth.oauth.linked', { provider: 'notion', userId: user.id, ip: getClientIp(req) });
    const ok = NextResponse.redirect(new URL('/settings', req.url));
    clearOAuthStateCookie(ok, 'notion');
    return ok;
}
