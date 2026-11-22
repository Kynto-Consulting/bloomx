import { NextRequest, NextResponse } from 'next/server';
import { tokenFlow } from '@/lib/external-auth-flow';
import { defaultFlowDeps } from '@/lib/external-auth-deps';
import { getClientIp } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/token — endpoint 2 (parte 2): servidor a servidor. JSON o x-www-form-urlencoded con
 * client_id, client_secret, code, code_verifier, redirect_uri -> { sub, email, email_verified, name }.
 */
export async function POST(req: NextRequest) {
    const type = req.headers.get('content-type') || '';
    let body: Record<string, unknown> = {};
    try {
        body = type.includes('application/json') ? await req.json() : Object.fromEntries(new URLSearchParams(await req.text()));
    } catch {
        body = {};
    }
    const r = await tokenFlow(defaultFlowDeps(), body && typeof body === 'object' ? body : {}, getClientIp(req));
    return NextResponse.json(r.body, { status: r.status, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } });
}
