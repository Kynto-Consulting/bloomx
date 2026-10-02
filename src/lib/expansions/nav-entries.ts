/**
 * Entradas de navegacion de extensiones (`navEntries`) listas para pintar: barra lateral del correo, menu movil y consola de administracion.
 * PURO (sin React ni red): decide que entradas existen, para quien y en que estado. El esquema y la lectura tolerante viven en nav-schema.ts
 * (copia identica en los 3 repos); aqui solo esta lo que depende del frontend (preferencias del usuario, pausas, idioma).
 *
 * Una entrada:
 *   - NO aparece si la extension no esta en /api/config (desinstalada, pausada por dependencias en el backend, version incompatible con este cliente),
 *     esta apagada en su manifest (`status: disabled`) o el usuario la desactivo (salvo las obligatorias);
 *   - aparece DESHABILITADA con motivo si la extension esta instalada pero bloqueada ahora mismo (IA apagada, dependencia que falta);
 *   - se oculta si el usuario no alcanza su `auth`/`minLevel` (el servidor ya no envia las de administracion que su nivel no alcanza: esto es la 2.a barrera).
 */
import { getPreparedManifest } from './prepare-manifest';
import { splitPausedConfigExtensions } from './dependency-filter';
import { navEntryVisible, navLabel, readNavEntries, stripAdminNavEntries as stripAdminNavFromManifest, type NavSection, type NormalizedNavEntry } from './nav-schema';

export type NavDisabledReason = 'ai' | 'dependency';

export interface NavItemView {
    /** `<extensionId>:<entryId>`: estable y unico. */
    key: string;
    extensionId: string;
    entryId: string;
    section: NavSection;
    label: string;
    icon: string | null;
    order: number;
    /** Destino de la navegacion (null mientras la entrada esta deshabilitada). */
    href: string | null;
    /** Pagina del mount PAGE (para la consola de admin, que sirve la pagina en /admin/x/<path>). */
    pagePath: string;
    mobile: boolean;
    badge: NormalizedNavEntry['badge'];
    auth: NormalizedNavEntry['auth'];
    minLevel: number;
    disabled: { reason: NavDisabledReason; text: string } | null;
}

export interface NavWho { signedIn: boolean; level: number | null }

export interface CollectNavOptions {
    who: NavWho;
    lang: string;
    /** Preferencia del usuario: false = extension desactivada por el (se ignora en las obligatorias). */
    isEnabled?: (extensionId: string) => boolean;
    isMandatory?: (extension: any) => boolean;
    section?: NavSection;
    /** Solo entradas con `mobile !== false` (menu movil). */
    mobileOnly?: boolean;
    /** Textos del motivo de deshabilitado. */
    reasons?: Record<NavDisabledReason, string>;
}

const DEFAULT_REASONS: Record<NavDisabledReason, string> = {
    ai: 'En pausa: la IA esta desactivada',
    dependency: 'En pausa: falta una extension de la que depende',
};

/** Href de la entrada: las de administracion se sirven dentro de la consola (`/admin/x/<path>`); el resto en `/extensions/<path>`. */
export function navHref(entry: Pick<NormalizedNavEntry, 'section' | 'pagePath' | 'href'>): string {
    return entry.section === 'admin' ? `/admin/x/${entry.pagePath}` : entry.href;
}

/**
 * Entradas visibles para `who`, ordenadas por `order` y luego por extension. `extensions` debe ser la lista COMPLETA de /api/config (incluidas las bloqueadas
 * por la IA: salen deshabilitadas con motivo en lugar de desaparecer).
 */
export function collectNavItems(extensions: readonly any[], options: CollectNavOptions): NavItemView[] {
    const reasons = options.reasons ?? DEFAULT_REASONS;
    const list = Array.isArray(extensions) ? extensions : [];
    const paused = new Set(splitPausedConfigExtensions(list.filter((e) => e && typeof e === 'object')).paused.map((p) => p.id));
    const out: NavItemView[] = [];
    for (const ext of list) {
        const id = typeof ext?.id === 'string' ? ext.id : '';
        if (!id || !ext.template || typeof ext.template !== 'object') continue;
        const mandatory = options.isMandatory ? options.isMandatory(ext) : false;
        if (!mandatory && options.isEnabled && !options.isEnabled(id)) continue;
        const prepared = getPreparedManifest(id, ext.template);
        if (!prepared.ok || prepared.template?.status === 'disabled') continue;
        const blocked: NavDisabledReason | null = ext.aiBlock?.blocked === true ? 'ai' : paused.has(id) ? 'dependency' : null;
        for (const entry of readNavEntries(prepared.template)) {
            if (options.section && entry.section !== options.section) continue;
            if (options.mobileOnly && !entry.mobile) continue;
            if (!navEntryVisible(entry, options.who)) continue;
            out.push({
                key: `${id}:${entry.id}`,
                extensionId: id,
                entryId: entry.id,
                section: entry.section,
                label: navLabel(entry.label, options.lang) || entry.id,
                icon: entry.icon,
                order: entry.order,
                href: blocked ? null : navHref(entry),
                pagePath: entry.pagePath,
                mobile: entry.mobile,
                badge: blocked ? null : entry.badge,
                auth: entry.auth,
                minLevel: entry.minLevel,
                disabled: blocked ? { reason: blocked, text: reasons[blocked] } : null,
            });
        }
    }
    return out.sort((a, b) => a.order - b.order || a.extensionId.localeCompare(b.extensionId) || a.entryId.localeCompare(b.entryId));
}

/** Texto de una insignia: 0 no se muestra; mas de `max` => "max+". */
export function formatBadge(count: unknown, max = 999): string | null {
    if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return null;
    const n = Math.floor(count);
    return n > max ? `${max}+` : String(n);
}

/** Numero de una respuesta de insignia: un numero suelto o `{ count }` / `{ value }`. null si no hay un entero >= 0 valido. */
export function parseBadgeValue(body: unknown): number | null {
    const raw = typeof body === 'number' ? body : body && typeof body === 'object' ? ((body as any).count ?? (body as any).value ?? (body as any).data?.count) : undefined;
    return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : null;
}

/**
 * Defensa en el SERVIDOR (lo usa /api/config): quita de la plantilla de cada extension las entradas de administracion que `level` no alcanza, de modo que el
 * navegador no recibe ni el texto de lo que no puede abrir. Debe ejecutarse ANTES de stripAdminMounts (necesita ver el mount para saber que una pagina es admin).
 * `template` puede ser objeto o texto JSON. Devuelve el mismo arreglo si no hay nada que quitar.
 */
export function stripAdminNavEntries<T extends { template?: unknown }>(extensions: T[], level: number | null): T[] {
    let changed = false;
    const out = extensions.map((ext) => {
        let template: any = ext.template;
        const wasString = typeof template === 'string';
        if (wasString) { try { template = JSON.parse(template); } catch { return ext; } }
        if (!template || typeof template !== 'object' || !Array.isArray(template.navEntries)) return ext;
        const next = stripAdminNavFromManifest(template, level);
        if (next === template) return ext;
        changed = true;
        return { ...ext, template: wasString ? JSON.stringify(next) : next };
    });
    return changed ? out : extensions;
}
