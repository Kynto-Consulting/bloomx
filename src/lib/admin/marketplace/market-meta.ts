/**
 * Metadatos de MARKETPLACE de una extension (PURO). Vienen del campo `market` del catalogo publico del backend (capacidad
 * market.catalog.v1) y se vuelven a sanear aqui (lista blanca, tamanos acotados, sin HTML ni URLs no https): el navegador nunca
 * confia en el backend ni en el manifest. Si el backend es antiguo (sin `market`) se deriva un respaldo del manifest/id.
 */
import { CATEGORY_IDS, DEFAULT_PUBLISHER, MANIFEST_LIMITS, PLATFORM_EXTENSION_PREFIX, PUBLISHER_ID_RE, isSafeScreenshotUrl, manifestIcon } from '@/lib/expansions/manifest-schema';

export type MarketCategory = (typeof CATEGORY_IDS)[number];
export const MARKET_CATEGORIES: readonly MarketCategory[] = CATEGORY_IDS as readonly MarketCategory[];

export interface MarketPublisher {
    id: string;
    name: string;
    icon: string | null;
    url: string | null;
    verified: boolean;
    official: boolean;
}

export interface MarketSuite {
    id: string;
    name: string;
    icon: string | null;
}

export interface MarketVersion {
    version: string;
    status: 'published' | 'deprecated';
    date: string | null;
    compatible: boolean;
    notes: string[];
    /** Notas es/en (aditivo: el backend lo envia cuando hay notas; clientes antiguos solo leen `notes`). */
    notesI18n?: { es: string; en: string };
}

export interface MarketMeta {
    publisher: MarketPublisher;
    suite: MarketSuite | null;
    categories: MarketCategory[];
    tags: string[];
    screenshots: string[];
    /** Dominios con la extension activa (agregado del backend, cacheado ~5 min). 0 si el backend no lo informa. */
    installCount: number;
    /** Historial publico de versiones (mas nueva primero). */
    history: MarketVersion[];
    /** true = el backend envio el bloque `market` (si no, es un respaldo derivado). */
    fromBackend: boolean;
}

const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]{1,40})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}/;
const HTML_RE = /[<>\u0000-\u001f]/;
const text = (v: unknown, max: number): string => (typeof v === 'string' && !HTML_RE.test(v) ? v.trim().slice(0, max) : '');
const icon = (v: unknown): string | null => manifestIcon({ icon: v });

const COMMUNITY: MarketPublisher = { id: 'community', name: 'Community', icon: null, url: null, verified: false, official: false };
const BLOOMX: MarketPublisher = { id: DEFAULT_PUBLISHER.id, name: DEFAULT_PUBLISHER.name, icon: 'lucide:Boxes', url: null, verified: true, official: true };

/** Editor por defecto de una extension segun su id: las `core-*` son de la plataforma (Bloomx, oficial). */
export function defaultPublisher(extensionId: string): MarketPublisher {
    return extensionId.startsWith(PLATFORM_EXTENSION_PREFIX) ? { ...BLOOMX } : { ...COMMUNITY };
}

function sanitizePublisher(raw: any, extensionId: string): MarketPublisher {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !PUBLISHER_ID_RE.test(raw.id) || !text(raw.name, 60)) return defaultPublisher(extensionId);
    const platform = extensionId.startsWith(PLATFORM_EXTENSION_PREFIX);
    // official/verified NO se creen tal cual: solo las extensiones de la plataforma con editor bloomx son oficiales.
    const official = platform && raw.id === DEFAULT_PUBLISHER.id && raw.official === true;
    return {
        id: raw.id,
        name: text(raw.name, 60),
        icon: icon(raw.icon) ?? (official ? BLOOMX.icon : null),
        url: isSafeScreenshotUrl(raw.url) ? raw.url : null,
        verified: official || (platform && raw.verified === true),
        official,
    };
}

function sanitizeSuite(raw: any, extensionId: string, publisherId: string): MarketSuite | null {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !PUBLISHER_ID_RE.test(raw.id) || !text(raw.name, 60)) return null;
    // Suite = marca: las no-core solo pueden usar la de su propio editor (nunca la oficial ni la de otro).
    if (!extensionId.startsWith(PLATFORM_EXTENSION_PREFIX) && (raw.id !== publisherId || raw.id === DEFAULT_PUBLISHER.id)) return null;
    return { id: raw.id, name: text(raw.name, 60), icon: icon(raw.icon) };
}

function sanitizeCategories(raw: unknown): MarketCategory[] {
    const list = Array.isArray(raw) ? raw.filter((c): c is MarketCategory => typeof c === 'string' && (MARKET_CATEGORIES as readonly string[]).includes(c)) : [];
    return Array.from(new Set(list)).slice(0, MANIFEST_LIMITS.maxCategories);
}

function notesI18n(raw: any): { es: string; en: string } | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const es = text(raw.es, MANIFEST_LIMITS.maxChangelogNotes);
    const en = text(raw.en, MANIFEST_LIMITS.maxChangelogNotes);
    return es || en ? { es: es || en, en: en || es } : undefined;
}

/** Notas de una version para el idioma de la interfaz (texto plano; React las escapa): {es,en} si existen, si no la lista antigua. */
export function versionNotes(h: Pick<MarketVersion, 'notes' | 'notesI18n'>, locale: string): string[] {
    const own = h.notesI18n ? (locale === 'en' ? h.notesI18n.en : h.notesI18n.es) : '';
    return own ? [own] : h.notes;
}

function sanitizeHistory(raw: unknown): MarketVersion[] {
    if (!Array.isArray(raw)) return [];
    const out: MarketVersion[] = [];
    for (const h of raw.slice(0, 20)) {
        if (!h || typeof h !== 'object' || typeof h.version !== 'string' || !VERSION_RE.test(h.version)) continue;
        out.push({
            version: h.version,
            status: h.status === 'deprecated' ? 'deprecated' : 'published',
            date: typeof h.date === 'string' && DATE_RE.test(h.date) ? h.date.slice(0, 10) : null,
            compatible: h.compatible !== false,
            ...(notesI18n(h.notesI18n) ? { notesI18n: notesI18n(h.notesI18n)! } : {}),
            notes: Array.isArray(h.notes) ? h.notes.map((n: unknown) => text(n, MANIFEST_LIMITS.maxChangelogNotes)).filter(Boolean).slice(0, 20) : [],
        });
    }
    return out;
}

/** Bloque `market` del backend -> forma acotada. null si no viene o no es un objeto. */
export function sanitizeMarket(raw: unknown, extensionId: string): MarketMeta | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const r = raw as any;
    const count = Number(r.installCount);
    const publisher = sanitizePublisher(r.publisher, extensionId);
    return {
        publisher,
        suite: sanitizeSuite(r.suite, extensionId, publisher.id),
        categories: sanitizeCategories(r.categories),
        tags: Array.isArray(r.tags) ? Array.from(new Set(r.tags.map((t: unknown) => text(t, MANIFEST_LIMITS.maxTag)).filter(Boolean))).slice(0, MANIFEST_LIMITS.maxTags) as string[] : [],
        screenshots: Array.isArray(r.screenshots) ? (r.screenshots.filter(isSafeScreenshotUrl) as string[]).slice(0, MANIFEST_LIMITS.maxScreenshots) : [],
        installCount: Number.isFinite(count) && count > 0 ? Math.min(Math.trunc(count), 1_000_000_000) : 0,
        history: sanitizeHistory(r.history),
        fromBackend: true,
    };
}

/** Metadatos de catalogo que ya trae el resumen del manifest (ManifestSummary.catalog); se sanean igual que los del backend. */
export type CatalogSummary = { publisher?: unknown; suite?: unknown; categories?: unknown; tags?: unknown };

/** Categorias antiguas de la pantalla (deriveCategory) -> categorias del marketplace. */
const LEGACY_TO_MARKET: Record<string, MarketCategory> = {
    mail: 'mail', calendar: 'calendar', contacts: 'contacts', ai: 'ai', integrations: 'integrations', productivity: 'automation', security: 'settings', other: 'other',
};

/**
 * Respaldo cuando el backend no envia `market` (backend antiguo o fila instalada que ya no esta en el catalogo): editor por id, categoria
 * derivada de la categoria clasica y los metadatos que el resumen del manifest (`template.catalog`) ya traiga.
 */
export function fallbackMarket(extensionId: string, legacyCategory: string, summary?: CatalogSummary | null): MarketMeta {
    const fromSummary = summary ? sanitizeMarket({ ...summary, installCount: 0 }, extensionId) : null;
    const categories = fromSummary?.categories.length ? fromSummary.categories : [LEGACY_TO_MARKET[legacyCategory] ?? 'other'];
    return {
        publisher: fromSummary?.publisher ?? defaultPublisher(extensionId),
        suite: fromSummary?.suite ?? null,
        categories,
        tags: fromSummary?.tags ?? [],
        screenshots: [],
        installCount: 0,
        history: [],
        fromBackend: false,
    };
}

/** Combina el bloque del backend con el respaldo (el backend manda; las categorias vacias se derivan de la categoria clasica). */
export function resolveMarket(raw: unknown, extensionId: string, legacyCategory: string, summary?: CatalogSummary | null): MarketMeta {
    const fromBackend = sanitizeMarket(raw, extensionId);
    const fb = fallbackMarket(extensionId, legacyCategory, summary);
    if (!fromBackend) return fb;
    return { ...fromBackend, categories: fromBackend.categories.length ? fromBackend.categories : fb.categories };
}
