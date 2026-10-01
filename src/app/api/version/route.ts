import { NextResponse } from 'next/server';
import { buildVersionPayload } from '@/lib/pwa/version-info';

export const dynamic = 'force-dynamic';

/** Identidad de build. Publico (sin sesion, ver middleware), ligero y nunca cacheable. */
export async function GET() {
    return NextResponse.json(buildVersionPayload(), { headers: { 'Cache-Control': 'no-store' } });
}
