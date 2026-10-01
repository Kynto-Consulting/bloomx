import { adminRoute } from '@/lib/admin/http';
import { appOrigin } from '@/lib/oauth/flow';
import { describeProvidersForAdmin } from '@/lib/oauth/providers';
import { acceptsLegacyBackendSignature } from '@/lib/host-call-auth';

// GET: proveedores OAuth registrados (integrados y de extensiones) con su estado de configuracion. NUNCA devuelve secretos ni tokens.
export const GET = adminRoute({ scope: 'oauth.providers' }, async () => {
    const providers = await describeProvidersForAdmin(appOrigin());
    // legacyBackendSignature: true = esta instancia aun acepta la firma ANTIGUA del backend (clave global, deprecada). Apagar con BLOOMX_ACCEPT_BACKEND_SIGNATURE=false.
    return { providers, legacyBackendSignature: acceptsLegacyBackendSignature() };
});
