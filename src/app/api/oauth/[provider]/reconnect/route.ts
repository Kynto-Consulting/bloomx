import { NextRequest, NextResponse } from 'next/server';
import { startOAuth } from '@/lib/oauth/flow';
import { getCurrentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** GET /api/oauth/[provider]/reconnect?returnTo=/ruta : vuelve a pedir consentimiento (requiere sesion). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
    const { provider } = await ctx.params;
    if (!(await getCurrentUser().catch(() => null))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    return startOAuth(req, provider, { mode: 'reconnect' });
}
