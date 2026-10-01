import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getClientIp, rateLimitAsync } from '@/lib/security';
import { unlinkUserProvider } from '@/lib/oauth/unlink';
import { invalidateStatusCache } from '@/lib/conferencing/status';
import { resolveDomain } from '@/lib/conferencing/http';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };

/** DELETE /api/oauth/[provider]/unlink : desvincula y REVOCA (RFC 7009) las cuentas del usuario con sesion para ese proveedor. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
    const { provider } = await ctx.params;
    const user = await getCurrentUser().catch(() => null);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
    if (!/^[a-z][a-z0-9-]{1,31}$/.test(provider)) return NextResponse.json({ error: 'unknown_provider' }, { status: 404, headers: NO_STORE });
    if (!(await rateLimitAsync(`oauth:unlink:${user.id}`, 20, 60_000)).ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: NO_STORE });
    const result = await unlinkUserProvider(user.id, provider, getClientIp(req));
    invalidateStatusCache({ userId: user.id, domain: resolveDomain(req) });
    return NextResponse.json({ success: true, unlinked: result.unlinked }, { headers: NO_STORE });
}
