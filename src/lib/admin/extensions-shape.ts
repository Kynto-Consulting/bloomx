import { summarizeTemplate } from '@/lib/admin/extensions-manifest';
import type { InstalledExtension } from '@/lib/admin/extensions-view';

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]{1,40})?$/;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : null);

/**
 * Reconstruye la lista de instaladas del backend con LISTA BLANCA: aunque el backend enviara authData, credenciales o
 * settings, no llegan al navegador. El manifest se reduce a su resumen.
 */
export function shapeInstalled(data: any): InstalledExtension[] {
    const list: any[] = Array.isArray(data?.extensions) ? data.extensions.slice(0, 300) : [];
    const out: InstalledExtension[] = [];
    for (const raw of list) {
        const id = str(raw?.extensionId, 200);
        if (!id || !ID_RE.test(id)) continue;
        const enabled = raw.enabled === true;
        out.push({
            extensionId: id,
            name: str(raw.name, 200) || id,
            description: str(raw.description, 1000),
            enabled,
            state: enabled ? 'enabled' : 'deactivated',
            installedVersion: VERSION_RE.test(String(raw.installedVersion)) ? String(raw.installedVersion) : null,
            catalogVersion: VERSION_RE.test(String(raw.catalogVersion)) ? String(raw.catalogVersion) : null,
            isPaid: raw.isPaid === true,
            ui: Number.isInteger(raw?.ui?.order) && raw.ui.order >= 0 && raw.ui.order <= 100_000 ? { order: raw.ui.order } : {},
            hasCredentials: raw.hasCredentials === true,
            mandatory: raw.mandatory === true,
            mandatoryByManifest: raw.mandatoryByManifest === true,
            template: summarizeTemplate(raw.template),
        });
    }
    return out;
}
