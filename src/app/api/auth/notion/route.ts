import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createOAuthState, setOAuthStateCookie } from '@/lib/oauth-state';

export async function GET(req: NextRequest) {
    const clientId = process.env.NOTION_CLIENT_ID;
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback/notion`;

    if (!clientId) {
        return NextResponse.json({ error: 'Missing NOTION_CLIENT_ID' }, { status: 500 });
    }

    const user = await getCurrentUser();
    if (!user) {
        return NextResponse.redirect(new URL('/login?error=LoginRequired', req.url));
    }

    const { state, nonce } = createOAuthState('notion', user.id);

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        owner: 'user',
        state,
    });

    const res = NextResponse.redirect(`https://api.notion.com/v1/oauth/authorize?${params.toString()}`);
    setOAuthStateCookie(res, 'notion', nonce);
    return res;
}
