import { NextRequest, NextResponse } from 'next/server';
import { appOrigin } from '@/lib/oauth/flow';
import { authorizeFlow } from '@/lib/external-auth-flow';
import { defaultFlowDeps } from '@/lib/external-auth-deps';
import { getSessionCookie } from '@/lib/session';
import { getClientIp } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/authorize — endpoint 2 (parte 1): una app externa registrada pide identidad.
 * client_id, redirect_uri (exacto), state, code_challenge (S256). Sin sesion lleva al login y vuelve aqui;
 * con sesion emite un codigo de un solo uso (60 s) y redirige a redirect_uri?code&state.
 */
export async function GET(req: NextRequest) {
    const p = req.nextUrl.searchParams;
    const session = await getSessionCookie();
    const result = await authorizeFlow(
        defaultFlowDeps(),
        { client_id: p.get('client_id'), redirect_uri: p.get('redirect_uri'), state: p.get('state'), code_challenge: p.get('code_challenge'), code_challenge_method: p.get('code_challenge_method'), response_type: p.get('response_type') },
        typeof session?.sub === 'string' ? session.sub : null,
        getClientIp(req),
    );
    const noStore = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
    if (result.kind === 'error') return NextResponse.json({ error: result.error }, { status: result.status, headers: noStore });
    if (result.kind === 'login') {
        const origin = appOrigin() ?? req.nextUrl.origin;
        const next = `${req.nextUrl.pathname}${req.nextUrl.search}`;
        return NextResponse.redirect(`${origin}/login?next=${encodeURIComponent(next)}`, { headers: noStore });
    }
    return NextResponse.redirect(result.location, { headers: noStore });
}
