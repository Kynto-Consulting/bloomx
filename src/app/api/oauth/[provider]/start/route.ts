import { NextRequest } from 'next/server';
import { startOAuth } from '@/lib/oauth/flow';

export const dynamic = 'force-dynamic';

/** GET /api/oauth/[provider]/start?returnTo=/ruta&scopes=a+b  -> redirige al proveedor registrado (login con Google, vincular). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
    const { provider } = await ctx.params;
    return startOAuth(req, provider);
}
