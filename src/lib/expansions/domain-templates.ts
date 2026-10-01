import { backendUrl } from '@/lib/backend-url';
const BACKEND_URL = () => (backendUrl()).replace(/\/+$/, '');
const TTL_MS = 15_000;
const cache = new Map<string, { at: number; templates: Map<string, any> }>();

/** Plantillas (manifests) de las extensiones del dominio, leidas del BACKEND (nunca del navegador). Cache corta por dominio. Lanza si no se pueden leer. */
export async function loadDomainTemplates(host: string): Promise<Map<string, any>> {
    const key = host.split(':')[0];
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.templates;
    const res = await fetch(`${BACKEND_URL()}/api/config?domain=${encodeURIComponent(key)}`, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error('config_unavailable');
    const cfg = await res.json();
    const templates = new Map<string, any>();
    for (const e of Array.isArray(cfg?.extensions) ? cfg.extensions : []) {
        try { templates.set(String(e.id), typeof e.template === 'string' ? JSON.parse(e.template) : e.template); } catch { /* manifest ilegible: se ignora */ }
    }
    cache.set(key, { at: Date.now(), templates });
    return templates;
}
export function __resetDomainTemplates(): void { cache.clear(); }
