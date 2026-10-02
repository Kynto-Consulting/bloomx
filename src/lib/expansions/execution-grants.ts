import { issueExecutionGrant } from '@/lib/exec-grant';
import { loadDomainTemplates } from '@/lib/expansions/domain-templates';

/**
 * Emision de `executionGrant` (ext.grants.v1) para las ejecuciones que ESTA instancia pide al backend. Los permisos y la version salen del manifest
 * que sirve el backend a este cliente (loadDomainTemplates); si no se pueden leer, no se emite grant (los servicios del host quedan sin disponer).
 */

type Template = { id?: unknown; version?: unknown; permissions?: unknown; intercepts?: unknown; hooks?: unknown } | null | undefined;

export function grantForTemplate(host: string, fallbackId: string, template: Template, userId: string | null, event?: string): string | null {
    if (!template || typeof template.version !== 'string') return null;
    const ext = typeof template.id === 'string' && template.id ? template.id : fallbackId;
    return issueExecutionGrant({ domain: host, extensionId: ext, version: template.version, userId, permissions: template.permissions, event });
}

/** Grants por extension para un evento de hooks (solo las que lo interceptan; maximo 40). Nunca lanza. */
export async function grantsForHooks(host: string, event: string, userId: string | null): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    if (!userId) return out;
    try {
        const templates = await loadDomainTemplates(host);
        for (const [id, template] of templates) {
            const t = template as Template;
            const items = [...(Array.isArray(t?.intercepts) ? t!.intercepts : []), ...(Array.isArray(t?.hooks) ? t!.hooks : [])] as Array<{ point?: unknown }>;
            if (!items.some((i) => i && i.point === event)) continue;
            const grant = grantForTemplate(host, id, t, userId, event);
            if (grant) out[typeof t?.id === 'string' && t.id ? t.id : id] = grant;
            if (Object.keys(out).length >= 40) break;
        }
    } catch {
        /* sin grants: los servicios del host quedan sin disponer en esas extensiones */
    }
    return out;
}
