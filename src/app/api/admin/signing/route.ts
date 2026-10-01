import { adminRoute } from '@/lib/admin/http';
import { fetchCatalog } from '@/lib/admin/extensions-catalog';
import { hasValidDomainKey } from '@/lib/domain-key';
import { CLIENT_API_VERSION, CLIENT_CAPABILITIES, SIGNED_ONLY_CAPABILITIES, currentClientIdentity } from '@/lib/expansions/client/capabilities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET: estado de firma de ESTA instancia (sin material privado). Sin BLOOMX_DOMAIN_PRIVATE_KEY valida la instancia anuncia solo las capacidades que funcionan
 * sin clave y recibe las versiones de extensiones de siempre; `pendingExtensions` = extensiones con una version mas nueva que requiere la clave.
 */
export const GET = adminRoute({ scope: 'signing.status', limit: 60 }, async () => {
    const signed = hasValidDomainKey();
    let pendingExtensions = 0;
    if (!signed) {
        try {
            const catalog = await fetchCatalog();
            pendingExtensions = catalog.filter((e) => e.incompatible || (e.version && e.latestVersion && e.latestVersion !== e.version)).length;
        } catch {
            pendingExtensions = 0;
        }
    }
    return { signed, announcedClientApi: currentClientIdentity().clientApi, announcedCapabilities: CLIENT_CAPABILITIES.filter((c) => currentClientIdentity().capabilities.includes(c)), fullClientApi: CLIENT_API_VERSION, signedOnlyCapabilities: SIGNED_ONLY_CAPABILITIES, pendingExtensions };
});
