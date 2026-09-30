/**
 * Categorias de la pagina /extensions (PURO). Se usa `manifest.category` si existe (id o alias es/en conocido); si no,
 * se DERIVA de los puntos de montaje, hooks y permisos.
 */

import { CATEGORY_ALIASES, CATEGORY_IDS as SCHEMA_CATEGORY_IDS } from '../manifest-schema';

// Lista y alias DERIVADOS de manifest-schema (fuente unica: el schema valida `manifest.category` con la misma tabla).
export const CATEGORY_IDS = SCHEMA_CATEGORY_IDS as unknown as readonly ['mail', 'composer', 'calendar', 'contacts', 'automation', 'ai', 'integrations', 'settings', 'other'];
export type CategoryId = (typeof CATEGORY_IDS)[number];

const ALIASES = CATEGORY_ALIASES as Record<string, CategoryId>;

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

const isRecord = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Puntos de montaje unicos de un manifest (strings, en orden). */
export function mountPointsOf(template: unknown): string[] {
    if (!isRecord(template) || !Array.isArray(template.mounts)) return [];
    const seen = new Set<string>();
    for (const mount of template.mounts) if (isRecord(mount) && typeof mount.point === 'string') seen.add(mount.point);
    return Array.from(seen);
}

function interceptPoints(template: Record<string, any>): string[] {
    const list = [...(Array.isArray(template.intercepts) ? template.intercepts : []), ...(Array.isArray(template.hooks) ? template.hooks : [])];
    return list.map((i) => (isRecord(i) && typeof i.point === 'string' ? i.point : '')).filter(Boolean);
}

/** Categoria explicita valida (`manifest.category`), o null. */
export function explicitCategory(template: unknown): CategoryId | null {
    if (!isRecord(template) || typeof template.category !== 'string') return null;
    return ALIASES[strip(template.category)] ?? null;
}

export function deriveCategory(template: unknown): CategoryId {
    if (!isRecord(template)) return 'other';
    const explicit = explicitCategory(template);
    if (explicit) return explicit;

    const permissions: string[] = Array.isArray(template.permissions) ? template.permissions.filter((p): p is string => typeof p === 'string') : [];
    const points = mountPointsOf(template);
    const hooks = interceptPoints(template);
    const has = (re: RegExp) => permissions.some((p) => re.test(p));
    const onPoint = (re: RegExp) => points.some((p) => re.test(p));
    const onHook = (re: RegExp) => hooks.some((p) => re.test(p));

    if (has(/^CALENDAR_/) || onPoint(/^(CALENDAR_|EVENT_LOCATION)/) || onHook(/^CALENDAR_/)) return 'calendar';
    if (has(/^CONTACTS?_/) || onPoint(/^CONTACT/) || onHook(/^CONTACT_/)) return 'contacts';
    if (onPoint(/^(COMPOSER_|SLASH_COMMAND|BEFORE_SEND_HANDLER|ON_[A-Z_]+_CHANGE_HANDLER)/) || onHook(/^(EMAIL_PRE_SEND|COMPOSE_OPENED)$/)) return 'composer';
    if (has(/^(READ_EMAIL|MAIL_LABEL)$/) || onPoint(/^(EMAIL_|CONTEXT_MENU|SIDEBAR_)/) || onHook(/^EMAIL_/)) return 'mail';
    if (onHook(/^CRON$/) || hooks.length > 0) return 'automation';
    if (has(/^AI_GENERATE$/)) return 'ai';
    const authType = isRecord(template.auth) ? String(template.auth.type || '').toUpperCase() : '';
    if (has(/^(HTTP_REQUEST|OAUTH_READ|OAUTH_WRITE)$/) || (authType && authType !== 'NONE')) return 'integrations';
    if (onPoint(/^(SETTINGS_|CUSTOM_SETTINGS_TAB)/)) return 'settings';
    return 'other';
}

/** Etiquetas libres del manifest (`tags`): max 12, texto recortado (30), sin duplicados. */
export function tagsOf(template: unknown): string[] {
    if (!isRecord(template) || !Array.isArray(template.tags)) return [];
    const seen = new Map<string, string>();
    for (const raw of template.tags) {
        if (typeof raw !== 'string') continue;
        const tag = raw.trim().replace(/\s+/g, ' ').slice(0, 30);
        if (tag && !seen.has(strip(tag))) seen.set(strip(tag), tag);
        if (seen.size >= 12) break;
    }
    return Array.from(seen.values());
}
