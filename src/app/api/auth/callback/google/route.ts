import { NextRequest } from 'next/server';
import { finishOAuth } from '@/lib/oauth/flow';

export const dynamic = 'force-dynamic';

/** ALIAS estable de /api/oauth/google/callback: es el redirect_uri YA REGISTRADO en Google Cloud (no cambia). */
export async function GET(req: NextRequest) {
    return finishOAuth(req, 'google');
}
