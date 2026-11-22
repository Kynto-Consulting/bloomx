import { NextRequest, NextResponse } from 'next/server';
import { appOrigin } from '@/lib/oauth/flow';
import { getExternalClients } from '@/lib/external-auth';
import { discoveryDocument } from '@/lib/external-auth-flow';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/external — endpoint 1: ¿esta instancia tiene activado "Entrar con Bloomx" para apps externas?
 * Publico y sin secretos: { enabled:false } o { enabled:true, authorizationEndpoint, tokenEndpoint, ... }.
 */
export async function GET(req: NextRequest) {
    const origin = appOrigin() ?? req.nextUrl.origin;
    return NextResponse.json(discoveryDocument(origin, getExternalClients()), { headers: { 'Cache-Control': 'no-store' } });
}
