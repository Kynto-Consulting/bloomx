
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createOAuthState, setOAuthStateCookie } from '@/lib/oauth-state';
import { isSafeRelativePath } from '@/lib/security';
import { apiBase } from '@/lib/conferencing/api-bases';

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
    const { provider } = await params;
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback/${provider}`;

    let authUrl = '';
    let clientId = '';
    let scopes = '';
    let extraParams: Record<string, string> = {};

    switch (provider) {
        case 'slack':
            clientId = process.env.SLACK_CLIENT_ID || '';
            scopes = 'chat:write,commands,users:read';
            authUrl = 'https://slack.com/oauth/v2/authorize';
            extraParams = { user_scope: '' };
            break;
        case 'hubspot':
            clientId = process.env.HUBSPOT_CLIENT_ID || '';
            scopes = 'crm.objects.contacts.read crm.objects.contacts.write';
            authUrl = 'https://app.hubspot.com/oauth/authorize';
            break;
        case 'notion':
            clientId = process.env.NOTION_CLIENT_ID || '';
            scopes = ''; // Notion uses internal integrations often, but for public oauth it has no scopes param usually
            authUrl = 'https://api.notion.com/v1/oauth/authorize';
            extraParams = { response_type: 'code', owner: 'user' };
            break;
        case 'zoom':
            clientId = process.env.ZOOM_CLIENT_ID || '';
            authUrl = `${apiBase('ZOOM_OAUTH_BASE')}/oauth/authorize`;
            break;
        case 'trello':
            clientId = process.env.TRELLO_API_KEY || ''; // Trello uses API Key as Client ID
            scopes = 'read,write';
            authUrl = 'https://trello.com/1/authorize';
            extraParams = { expiration: 'never', name: 'BloomX' };
            break;
        default:
            return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 });
    }

    if (!clientId) {
        return NextResponse.json({ error: `Missing configuration for ${provider}` }, { status: 500 });
    }

    // Vincular una integracion requiere sesion: se exige ya al iniciar (no solo al volver del proveedor).
    const user = await getCurrentUser();
    if (!user) {
        return NextResponse.redirect(new URL('/login?error=LoginRequired', req.url));
    }

    // Common params
    const queryParams = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: scopes,
        ...extraParams
    });

    // `state` anti-CSRF (nonce en cookie HttpOnly, patron de Google). Trello no admite `state` en su flujo de token.
    const wantsState = provider !== 'trello';
    const oauth = wantsState ? createOAuthState(provider, user.id) : null;
    if (oauth) queryParams.set('state', oauth.state);

    const res = NextResponse.redirect(`${authUrl}?${queryParams.toString()}`);
    if (oauth) setOAuthStateCookie(res, provider, oauth.nonce);
    // Zoom: vuelve a la pantalla desde la que se conecto (`returnTo`, solo rutas internas) tras el consentimiento.
    if (provider === 'zoom') {
        const returnTo = req.nextUrl.searchParams.get('returnTo');
        if (isSafeRelativePath(returnTo)) {
            res.cookies.set('bloomx_oauth_return_zoom', returnTo, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                path: '/api/auth/callback/zoom',
                maxAge: 600,
            });
        }
    }
    return res;
}
