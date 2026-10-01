import { NextRequest } from 'next/server';
import { finishOAuth } from '@/lib/oauth/flow';

export const dynamic = 'force-dynamic';

/** GET /api/oauth/[provider]/callback : redirect_uri del flujo generico. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
    const { provider } = await ctx.params;
    return finishOAuth(req, provider);
}
