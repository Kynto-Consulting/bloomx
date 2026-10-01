import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { listProviderSummaries, loadProviders, providerScopeGroups } from '@/lib/oauth/providers';
import { grantedScopeSet } from '@/lib/oauth/tokens';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * GET /api/oauth/providers : proveedores registrados (con estado) y, si hay sesion, las cuentas del usuario por proveedor
 * (grupos de scopes concedidos, estado). NUNCA tokens ni secretos.
 */
export async function GET() {
    const user = await getCurrentUser().catch(() => null);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
    const [summaries, providers, accounts] = await Promise.all([
        listProviderSummaries(),
        loadProviders(),
        prisma.account.findMany({ where: { userId: user.id }, select: { id: true, provider: true, scope: true, access_token: true, refresh_token: true } }),
    ]);
    return NextResponse.json({
        providers: summaries.map((s) => ({ id: s.id, displayName: s.displayName, icon: s.icon, status: s.status, source: s.source })),
        accounts: accounts.map((a) => {
            const p = providers.get(a.provider);
            return {
                id: a.id, provider: a.provider,
                groups: p ? providerScopeGroups(p, Array.from(grantedScopeSet(a.scope))) : [],
                status: a.access_token || a.refresh_token ? 'active' : 'needs-reconnect',
            };
        }),
    }, { headers: NO_STORE });
}
