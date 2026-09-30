import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createOAuthState, setOAuthStateCookie } from '@/lib/oauth-state';

export async function GET(req: NextRequest) {
    const clientId = process.env.HUBSPOT_CLIENT_ID;
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback/hubspot`;

    if (!clientId) {
        return NextResponse.json({ error: 'Missing HUBSPOT_CLIENT_ID' }, { status: 500 });
    }

    const user = await getCurrentUser();
    if (!user) {
        return NextResponse.redirect(new URL('/login?error=LoginRequired', req.url));
    }

    const scopes = 'crm.objects.contacts.read crm.objects.companies.read';
    const { state, nonce } = createOAuthState('hubspot', user.id);

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: scopes,
        response_type: 'code',
        state,
    });

    const res = NextResponse.redirect(`https://app.hubspot.com/oauth/authorize?${params.toString()}`);
    setOAuthStateCookie(res, 'hubspot', nonce);
    return res;
}
