import { catalogClientHeaders } from '@/lib/expansions/client/capabilities';
import { resolveBackendIconUrl } from '@/lib/expansions/icon-image';
import { sanitizeMarket } from '@/lib/admin/marketplace/market-meta';
import { HttpError } from '@/lib/admin/http';
import { backendUrl } from '@/lib/admin/extensions-instance';
import { sanitizeUpgrade } from '@/lib/admin/extensions-compat';
import { summarizeTemplate } from '@/lib/admin/extensions-manifest';
import type { CatalogExtension } from '@/lib/admin/extensions-view';

/**
 * Catalogo publico de extensiones (`{backend}/api/admin/extensions/public-list`) con timeout, tamano acotado, lista blanca
 * de campos y cache corta en memoria. El navegador nunca habla con el backend para el catalogo (sin CORS ni fugas):
 * el manifest se reduce a un resumen (sin componentes, URLs ni valores).
 */

const TTL_MS = 60_000;
const TIMEOUT_MS = 8_000;
const MAX_ITEMS = 300;
let cache: { at: number; items: CatalogExtension[] } | null = null;

export function __resetCatalogCache() {
    cache = null;
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

export function shapeCatalog(data: unknown): CatalogExtension[] {
    if (!Array.isArray(data)) return [];
    const out: CatalogExtension[] = [];
    for (const raw of data.slice(0, MAX_ITEMS)) {
        const id = text(raw?.id, 200);
        if (!id) continue;
        out.push({
            id,
            name: text(raw.name, 200) || id,
            description: text(raw.description, 1000),
            version: /^\d+\.\d+\.\d+/.test(text(raw.version, 40)) ? text(raw.version, 40) : null,
            authType: text(raw.authType, 30) || null,
            isPaid: raw.isPaid === true,
            price: text(String(raw.price ?? '0'), 20) || '0',
            currency: text(raw.currency, 8) || 'USD',
            template: summarizeTemplate(raw.template),
            latestVersion: /^\d+\.\d+\.\d+/.test(text(raw.latestVersion, 40)) ? text(raw.latestVersion, 40) : null,
            incompatible: raw.incompatible === true,
            deprecated: raw.deprecated === true,
            upgrade: sanitizeUpgrade(raw.upgrade),
            market: sanitizeMarket(raw.market, id),
            iconUrl: resolveBackendIconUrl(raw.iconUrl) ? text(raw.iconUrl, 200) : null,
        });
    }
    return out;
}

export async function fetchCatalog(opts: { fresh?: boolean } = {}): Promise<CatalogExtension[]> {
    if (!opts.fresh && cache && Date.now() - cache.at < TTL_MS) return cache.items;
    let res: Response;
    try {
        res = await fetch(`${backendUrl()}/api/admin/extensions/public-list`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS), headers: catalogClientHeaders() });
    } catch {
        throw new HttpError(502, 'backend_unavailable');
    }
    if (!res.ok) throw new HttpError(502, 'backend_unavailable');
    const items = shapeCatalog(await res.json().catch(() => null));
    cache = { at: Date.now(), items };
    return items;
}
