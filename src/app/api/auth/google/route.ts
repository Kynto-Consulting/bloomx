import { NextRequest } from 'next/server';
import { startOAuth } from '@/lib/oauth/flow';

export const dynamic = 'force-dynamic';

/**
 * ALIAS estable de /api/oauth/google/start (los redirect URIs ya registrados en Google Cloud no cambian). Es el mismo flujo del registro de
 * proveedores OAuth: PKCE S256, state opaco de un solo uso y nonce OIDC. Mensajes y destinos de error historicos conservados.
 */
export async function GET(req: NextRequest) {
    return startOAuth(req, 'google');
}
