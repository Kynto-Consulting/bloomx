import { adminRoute } from '@/lib/admin/http';
import { appOrigin } from '@/lib/oauth/flow';
import { describeProvidersForAdmin, getRegistryTrust } from '@/lib/oauth/providers';

// GET: proveedores OAuth registrados (integrados y de extensiones) con su estado de configuracion. NUNCA devuelve secretos ni tokens.
export const GET = adminRoute({ scope: 'oauth.providers' }, async () => {
    const providers = await describeProvidersForAdmin(appOrigin());
    // registryTrust: verified (firma del backend comprobada), unverified (sin BLOOMX_BACKEND_PUBLIC_KEY: los proveedores de extensiones exigen aprobacion) o rejected.
    return { providers, registryTrust: getRegistryTrust() };
});
