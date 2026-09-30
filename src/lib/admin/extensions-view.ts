/**
 * Modelo de vista (PURO) de la pantalla de extensiones: une el catalogo publico, lo instalado en el dominio y los errores
 * recientes en una fila por extension, y aplica busqueda/filtros. Sin React ni fetch.
 */
import { declaredCredentialKeys } from '@/lib/extension-credentials';
import type { ManifestHealth, ManifestProblem } from '@/lib/expansions/manage/health';
import { manifestTexts } from '@/lib/expansions/manifest-schema';
import { deriveCategory, hasUpdate, parseTemplate, summarizeTemplate, type ExtensionCategory, type ManifestSummary } from './extensions-manifest';

export interface CatalogExtension {
    id: string;
    name: string;
    description: string;
    version: string | null;
    authType: string | null;
    isPaid: boolean;
    price: string;
    currency: string;
    template: ManifestSummary | null;
}

export interface InstalledExtension {
    extensionId: string;
    name: string;
    description: string | null;
    enabled: boolean;
    state: 'enabled' | 'deactivated';
    installedVersion: string | null;
    catalogVersion: string | null;
    isPaid: boolean;
    ui: { order?: number };
    hasCredentials: boolean;
    /** Politica del dominio "obligatoria para todos" (settings.meta.mandatory). */
    mandatory?: boolean;
    /** El manifest declara `mandatory: true`: no se puede quitar desde el dominio. */
    mandatoryByManifest?: boolean;
    template: ManifestSummary | null;
}

export type ExtensionStatus = 'enabled' | 'disabled' | 'available';

export interface ExtensionRow {
    id: string;
    name: string;
    description: string;
    /** Icono declarado por el manifest (brand:<slug>, lucide:<Nombre>, initials:<XY> o un nombre Lucide). */
    icon: string | null;
    /** Version del catalogo (la mas reciente publicada). */
    version: string | null;
    installedVersion: string | null;
    updateAvailable: boolean;
    status: ExtensionStatus;
    installed: boolean;
    enabled: boolean;
    isPaid: boolean;
    price: string;
    currency: string;
    authType: string | null;
    category: ExtensionCategory;
    template: ManifestSummary | null;
    order: number | null;
    hasCredentials: boolean | null;
    /** Obligatoria para todos los usuarios (politica del dominio o manifest): nadie puede desactivarla para si mismo. */
    mandatory: boolean;
    /** Lo es por su manifest: el interruptor del admin no la puede quitar. */
    mandatoryByManifest: boolean;
    hasErrors: boolean;
    /** Salud del manifest cargado en este dominio (solo instaladas con plantilla completa): valid=false => no se carga. */
    manifestValid: boolean;
    /** Elementos (mounts...) descartados o pendientes de resolver, con ruta y motivo. */
    manifestProblems: ManifestProblem[];
    /** Tiene claves de credencial declaradas (ENV_READ) que el admin puede configurar. */
    hasCredentialKeys: boolean;
    /** Esta en el catalogo publico (si no, solo se puede desinstalar/desactivar). */
    inCatalog: boolean;
}

export interface BuildRowsInput {
    catalog: readonly CatalogExtension[];
    installed: readonly InstalledExtension[];
    /** ids con errores en las ultimas 24 h. */
    errorIds?: readonly string[];
    /** Salud del manifest por id de extension (de /api/config). */
    health?: ReadonlyMap<string, ManifestHealth>;
    /** Idioma de la interfaz: nombre y descripcion salen de manifest.i18n[locale] si existe. */
    locale?: string;
}

/** Una fila por id (catalogo + instaladas que ya no estan en el catalogo). */
export function buildRows({ catalog, installed, errorIds = [], health, locale }: BuildRowsInput): ExtensionRow[] {
    const errors = new Set(errorIds);
    const installedById = new Map(installed.map((i) => [i.extensionId, i]));
    const rows: ExtensionRow[] = [];
    const seen = new Set<string>();

    const make = (id: string, cat: CatalogExtension | undefined, inst: InstalledExtension | undefined): ExtensionRow => {
        const template = cat?.template ?? inst?.template ?? null;
        const version = cat?.version ?? inst?.catalogVersion ?? null;
        const installedVersion = inst?.installedVersion ?? null;
        const status: ExtensionStatus = inst ? (inst.enabled ? 'enabled' : 'disabled') : 'available';
        const texts = locale && template ? manifestTexts(template, locale) : { name: '', description: '' };
        // manifestTexts cae a template.name/description: solo se usa si hay una variante del idioma (i18n) para no pisar el nombre del catalogo.
        const localized = locale && template?.i18n ? texts : { name: '', description: '' };
        return {
            id,
            name: localized.name || cat?.name || inst?.name || id,
            description: localized.description || cat?.description || inst?.description || (template?.description ?? ''),
            icon: template?.icon ?? null,
            version,
            installedVersion,
            updateAvailable: !!inst && hasUpdate(installedVersion, version),
            status,
            installed: !!inst,
            enabled: inst?.enabled === true,
            isPaid: cat?.isPaid ?? inst?.isPaid ?? false,
            price: cat?.price ?? '0',
            currency: cat?.currency ?? 'USD',
            authType: cat?.authType ?? (template?.auth?.type ?? null),
            category: deriveCategory(template),
            template,
            order: typeof inst?.ui?.order === 'number' ? inst.ui.order : null,
            hasCredentials: inst ? inst.hasCredentials : null,
            mandatory: inst?.mandatory === true || inst?.mandatoryByManifest === true || template?.mandatory === true,
            mandatoryByManifest: inst?.mandatoryByManifest === true || template?.mandatory === true,
            hasErrors: errors.has(id) || (health?.get(id)?.valid === false) || (health?.get(id)?.problems.length ?? 0) > 0,
            manifestValid: health?.get(id)?.valid !== false,
            manifestProblems: health?.get(id)?.problems ?? [],
            hasCredentialKeys: declaredCredentialKeys(template).length > 0,
            inCatalog: !!cat,
        };
    };

    for (const cat of catalog) {
        if (seen.has(cat.id)) continue;
        seen.add(cat.id);
        rows.push(make(cat.id, cat, installedById.get(cat.id)));
    }
    for (const inst of installed) {
        if (seen.has(inst.extensionId)) continue;
        seen.add(inst.extensionId);
        rows.push(make(inst.extensionId, undefined, inst));
    }
    return rows;
}

export type StatusFilter = 'all' | 'installed' | 'available' | 'disabled' | 'errors' | 'paid';
export const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'installed', 'available', 'disabled', 'errors', 'paid'];

export interface ExtensionFilters {
    query: string;
    category: ExtensionCategory | 'all';
    status: StatusFilter;
}

export const DEFAULT_FILTERS: ExtensionFilters = { query: '', category: 'all', status: 'all' };

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function matchesStatus(row: ExtensionRow, status: StatusFilter): boolean {
    switch (status) {
        case 'installed': return row.installed;
        case 'available': return !row.installed;
        case 'disabled': return row.status === 'disabled';
        case 'errors': return row.hasErrors;
        case 'paid': return row.isPaid;
        default: return true;
    }
}

export function filterRows(rows: readonly ExtensionRow[], filters: ExtensionFilters): ExtensionRow[] {
    const q = norm(filters.query.trim());
    return rows.filter((row) => {
        if (filters.category !== 'all' && row.category !== filters.category) return false;
        if (!matchesStatus(row, filters.status)) return false;
        if (!q) return true;
        return norm(`${row.name} ${row.description} ${row.id}`).includes(q);
    });
}

export function countByStatus(rows: readonly ExtensionRow[]) {
    return {
        installed: rows.filter((r) => r.installed).length,
        enabled: rows.filter((r) => r.enabled).length,
        disabled: rows.filter((r) => r.status === 'disabled').length,
        updates: rows.filter((r) => r.updateAvailable).length,
        errors: rows.filter((r) => r.hasErrors).length,
    };
}

/**
 * Modo SOLO LECTURA (admin sin sesion de manager): las instaladas y habilitadas salen de /api/config
 * (`useDomainConfig().extensions`: { id, name, template, settings }). No hay desactivadas ni version instalada.
 */
export function installedFromConfig(extensions: readonly any[]): InstalledExtension[] {
    const out: InstalledExtension[] = [];
    for (const ext of extensions) {
        const id = typeof ext?.id === 'string' ? ext.id.trim() : '';
        if (!id) continue;
        const template = parseTemplate(ext.template);
        const order = ext?.settings?.ui?.order;
        out.push({
            extensionId: id,
            name: typeof ext.name === 'string' && ext.name ? ext.name : id,
            description: typeof template?.description === 'string' ? template.description : null,
            enabled: true,
            state: 'enabled',
            installedVersion: typeof ext?.settings?.meta?.installedVersion === 'string' ? ext.settings.meta.installedVersion : null,
            catalogVersion: typeof template?.version === 'string' ? template.version : null,
            isPaid: false,
            ui: typeof order === 'number' ? { order } : {},
            hasCredentials: false,
            mandatory: ext?.mandatory === true || ext?.settings?.meta?.mandatory === true,
            mandatoryByManifest: template?.mandatory === true,
            template: summarizeTemplate(template),
        });
    }
    return out;
}
