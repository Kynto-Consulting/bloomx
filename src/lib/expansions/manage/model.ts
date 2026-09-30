/**
 * Modelo de vista (PURO) de la pagina /extensions: una fila por extension instalada con su estado para el usuario,
 * busqueda sin tildes, filtros por categoria/estado/etiqueta y contadores. Sin React ni fetch.
 */
import { getPreparedManifest } from '@/lib/expansions/prepare-manifest';
import { isMandatoryExtension, orderIds, type ExtensionPrefs } from '@/lib/expansions/client/prefs';
import type { ExtensionErrorEntry } from '@/lib/expansions/client/error-log';
import { safeImageSrc } from '@/lib/expansions/safe-url';
import { deriveCategory, mountPointsOf, tagsOf, type CategoryId } from './categories';
import { hasUpdate } from './semver';

export type StatusFilter = 'all' | 'active' | 'user-disabled' | 'org-disabled' | 'errors' | 'paid' | 'free';
export const STATUS_FILTERS: StatusFilter[] = ['all', 'active', 'user-disabled', 'org-disabled', 'errors', 'paid', 'free'];

/** Datos opcionales del catalogo (solo administradores): version mas reciente y precio. */
export interface CatalogInfo { version?: string | null; isPaid?: boolean; price?: string | number | null; currency?: string | null }

export interface ChangelogEntry { version: string; date: string; notes: string }

export interface ExtensionRow {
    id: string;
    name: string;
    description: string;
    version: string | null;
    catalogVersion: string | null;
    updateAvailable: boolean;
    /** false = manifest invalido: no se carga. */
    valid: boolean;
    invalidReasons: string[];
    /** manifest.status === 'disabled' */
    orgDisabled: boolean;
    /** activada para ESTE usuario (prefs); una obligatoria siempre lo esta */
    userEnabled: boolean;
    /** OBLIGATORIA para todos (manifest o politica del dominio): el usuario no puede desactivarla */
    mandatory: boolean;
    /** se monta de verdad: valida, no desactivada por la organizacion ni por el usuario */
    active: boolean;
    category: CategoryId;
    tags: string[];
    permissions: string[];
    mountPoints: string[];
    isPaid: boolean | null;
    price: string | null;
    currency: string | null;
    errorCount: number;
    hasErrors: boolean;
    screenshots: string[];
    changelog: ChangelogEntry[];
    /** Manifest ya preparado (UI migrado), o el original si es invalido. */
    template: any;
}

const isRecord = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Minusculas, sin tildes ni signos de combinacion, espacios colapsados. */
export function normalizeText(value: unknown): string {
    return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Capturas del manifest: solo URLs absolutas https (y validas para imagen). Max 6. */
export function safeScreenshots(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const raw of value) {
        const url = safeImageSrc(raw);
        if (!url || !/^https:\/\//i.test(url) || url.length > 2000) continue;
        out.push(url);
        if (out.length >= 6) break;
    }
    return out;
}

/** Historial `changelog: [{version, date, notes}]` acotado (20 entradas) y como texto plano. */
export function safeChangelog(value: unknown): ChangelogEntry[] {
    if (!Array.isArray(value)) return [];
    const out: ChangelogEntry[] = [];
    for (const raw of value) {
        if (!isRecord(raw)) continue;
        const version = str(raw.version, 40);
        if (!version) continue;
        const notes = Array.isArray(raw.notes) ? raw.notes.filter((n) => typeof n === 'string').join('\n') : typeof raw.notes === 'string' ? raw.notes : '';
        out.push({ version, date: str(raw.date, 40), notes: notes.trim().slice(0, 1000) });
        if (out.length >= 20) break;
    }
    return out;
}

export interface BuildRowsInput {
    extensions: readonly any[];
    prefs: ExtensionPrefs;
    errors?: readonly ExtensionErrorEntry[];
    catalog?: ReadonlyMap<string, CatalogInfo> | Record<string, CatalogInfo>;
}

function catalogFor(catalog: BuildRowsInput['catalog'], id: string): CatalogInfo | undefined {
    if (!catalog) return undefined;
    return catalog instanceof Map ? catalog.get(id) : (catalog as Record<string, CatalogInfo>)[id];
}

export function buildRows({ extensions, prefs, errors = [], catalog }: BuildRowsInput): ExtensionRow[] {
    const rows: ExtensionRow[] = [];
    const seen = new Set<string>();
    for (const extension of extensions) {
        const templateId = str(extension?.template?.id, 100);
        const id = templateId || str(extension?.id, 100);
        if (!id || seen.has(id)) continue;
        seen.add(id);

        const prepared = getPreparedManifest(id, extension?.template);
        const raw = isRecord(prepared.template) ? prepared.template : isRecord(extension?.template) ? extension.template : {};
        const info = catalogFor(catalog, id);

        const version = str(raw.version, 40) || str(extension?.settings?.meta?.installedVersion, 40) || str(extension?.version, 40) || null;
        const catalogVersion = str(info?.version, 40) || null;
        const orgDisabled = raw.status === 'disabled';
        const mandatory = isMandatoryExtension(extension) || raw.mandatory === true;
        const userEnabled = mandatory || !prefs.disabled.includes(id);
        const valid = prepared.ok;
        const errorCount = errors.filter((e) => e.extensionId === id).length;

        const paidFlag = typeof info?.isPaid === 'boolean' ? info.isPaid : typeof extension?.isPaid === 'boolean' ? extension.isPaid : null;
        const priceRaw = info?.price ?? extension?.price;
        const price = priceRaw === undefined || priceRaw === null || priceRaw === '' ? null : str(String(priceRaw), 20) || null;

        rows.push({
            id,
            name: str(raw.name, 120) || str(extension?.name, 120) || id,
            description: str(raw.description, 2000) || str(extension?.description, 2000),
            version,
            catalogVersion,
            updateAvailable: hasUpdate(version, catalogVersion),
            valid,
            invalidReasons: valid ? [] : prepared.errors.slice(0, 6).map((p) => (p.path && p.path !== '$' ? `${p.path}: ${p.message}` : p.message)),
            orgDisabled,
            userEnabled,
            mandatory,
            active: valid && !orgDisabled && userEnabled,
            category: valid ? deriveCategory(raw) : 'other',
            tags: valid ? tagsOf(raw) : [],
            permissions: valid && Array.isArray(raw.permissions) ? raw.permissions.filter((p: unknown): p is string => typeof p === 'string') : [],
            mountPoints: valid ? mountPointsOf(raw) : [],
            isPaid: paidFlag,
            price,
            currency: str(info?.currency ?? extension?.currency, 8) || null,
            errorCount,
            hasErrors: !valid || errorCount > 0,
            screenshots: valid ? safeScreenshots(raw.screenshots) : [],
            changelog: valid ? safeChangelog(raw.changelog) : [],
            template: valid ? prepared.template : extension?.template,
        });
    }
    return rows;
}

/** Orden efectivo: las validas segun las preferencias del usuario; las invalidas al final (no se montan). */
export function sortRows(rows: ExtensionRow[], prefs: ExtensionPrefs): ExtensionRow[] {
    const valid = rows.filter((r) => r.valid);
    const byId = new Map(valid.map((r) => [r.id, r]));
    const ordered = orderIds(valid.map((r) => r.id), prefs).map((id) => byId.get(id)!);
    return [...ordered, ...rows.filter((r) => !r.valid)];
}

/** Ids ordenables (validas) en el orden efectivo: es el `allIds` de `useExtensionPrefs().move`. */
export function orderableIds(rows: ExtensionRow[], prefs: ExtensionPrefs): string[] {
    return sortRows(rows, prefs).filter((r) => r.valid).map((r) => r.id);
}

export interface RowFilters { query?: string; category?: CategoryId | 'all'; status?: StatusFilter; tag?: string | null }

export function matchesQuery(row: ExtensionRow, query: string): boolean {
    const tokens = normalizeText(query).split(' ').filter(Boolean);
    if (tokens.length === 0) return true;
    const haystack = normalizeText([row.name, row.description, row.id, row.category, ...row.tags].join(' '));
    return tokens.every((token) => haystack.includes(token));
}

export function matchesStatus(row: ExtensionRow, status: StatusFilter): boolean {
    switch (status) {
        case 'active': return row.active;
        case 'user-disabled': return row.valid && !row.userEnabled;
        case 'org-disabled': return row.orgDisabled;
        case 'errors': return row.hasErrors;
        case 'paid': return row.isPaid === true;
        case 'free': return row.isPaid === false;
        default: return true;
    }
}

export function filterRows(rows: ExtensionRow[], filters: RowFilters): ExtensionRow[] {
    const { query = '', category = 'all', status = 'all', tag = null } = filters;
    const tagKey = tag ? normalizeText(tag) : '';
    return rows.filter((row) =>
        matchesQuery(row, query)
        && (category === 'all' || row.category === category)
        && (!tagKey || row.tags.some((t) => normalizeText(t) === tagKey))
        && matchesStatus(row, status));
}

/** Contadores por filtro de estado (sobre las filas ya filtradas por busqueda, categoria y etiqueta). */
export function statusCounts(rows: ExtensionRow[]): Record<StatusFilter, number> {
    const counts = {} as Record<StatusFilter, number>;
    for (const status of STATUS_FILTERS) counts[status] = rows.filter((r) => matchesStatus(r, status)).length;
    return counts;
}

/** Contadores por categoria (sobre las filas ya filtradas por busqueda, estado y etiqueta). */
export function categoryCounts(rows: ExtensionRow[]): Map<CategoryId, number> {
    const counts = new Map<CategoryId, number>();
    for (const row of rows) counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
    return counts;
}

/** Etiquetas presentes (con su numero), de mas a menos usadas. */
export function tagCounts(rows: ExtensionRow[]): Array<{ tag: string; count: number }> {
    const map = new Map<string, { tag: string; count: number }>();
    for (const row of rows) for (const tag of row.tags) {
        const key = normalizeText(tag);
        const entry = map.get(key);
        if (entry) entry.count += 1; else map.set(key, { tag, count: 1 });
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, 20);
}

/** "hace 5 min" / "5 minutes ago" con Intl (sin dependencias). */
export function formatRelativeTime(at: number, now: number, locale: 'es' | 'en' = 'es'): string {
    const seconds = Math.round((at - now) / 1000);
    const abs = Math.abs(seconds);
    const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [['day', 86400], ['hour', 3600], ['minute', 60]];
    try {
        const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
        for (const [unit, size] of units) if (abs >= size) return rtf.format(Math.trunc(seconds / size), unit);
        return rtf.format(Math.trunc(seconds), 'second');
    } catch {
        return new Date(at).toISOString();
    }
}
