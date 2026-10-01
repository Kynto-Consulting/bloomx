import { adminRoute, audit, notFound } from '@/lib/admin/http';
import { assertFreshMfa } from '@/lib/admin/stepup';
import { approveProviderHosts, getProvider } from '@/lib/oauth/providers';

/**
 * POST: el admin APRUEBA los hosts actuales de un proveedor OAuth NO integrado (estado pending_approval / needs_reapproval -> ready si ya tiene
 * client id). Nivel 3 + step-up, auditado con los hosts aprobados. Sin esta aprobacion ningun proveedor declarado por una extension se usa,
 * aunque sea un cliente publico PKCE. Si los hosts cambiaron respecto a la aprobacion anterior, se descartan los secretos guardados.
 */
export const POST = adminRoute<{ id: string }>({ scope: 'oauth.approve', write: true }, async (ctx, { id }) => {
    await assertFreshMfa(ctx);
    const provider = await getProvider(id);
    if (!provider) throw notFound('provider_not_found');
    const ok = await approveProviderHosts(provider, ctx.actor.id ?? ctx.actor.email ?? null);
    if (!ok) throw notFound('storage_unavailable');
    audit(ctx, 'oauth.provider_approved', { provider: provider.id, extensionId: provider.extensionId, approvedHosts: provider.endpointHosts });
    return { success: true, approvedHosts: provider.endpointHosts };
});
