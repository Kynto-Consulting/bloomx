/**
 * Modelo PURO del marketplace de extensiones (sin React ni fetch): busqueda, filtros combinables, orden, paginacion, secciones de
 * "Descubrir", agrupacion por suite/editor, extensiones relacionadas, estado en la URL y plan de "Instalar la suite".
 * Lo comparten la UI y los tests.
 */
import { oauthApprovalKeys } from '@/lib/expansions/oauth-schema';
import { describePermissions, type PermissionRisk } from '@/lib/expansions/manifest-schema';
import { canInstall } from '@/lib/admin/extensions-compat';
import { overallRisk } from '@/lib/admin/extensions-manifest';
import { dependencyPlanFor, matchesStatus, type ExtensionRow, type StatusFilter } from '@/lib/admin/extensions-view';
import { MARKET_CATEGORIES, type MarketCategory } from './market-meta';

export type MarketSection = 'discover' | 'installed' | 'starred' | 'categories' | 'suites' | 'official' | 'community' | 'publisher';
export const MARKET_SECTIONS: readonly MarketSection[] = ['discover', 'installed', 'starred', 'categories', 'suites', 'official', 'community', 'publisher'];
export type SortKey = 'relevance' | 'popular' | 'recent' | 'name';
export const SORT_KEYS: readonly SortKey[] = ['relevance', 'popular', 'recent', 'name'];
export type ViewMode = 'grid' | 'list';
/** Estado: los de la pantalla clasica (todas, instaladas, disponibles, desactivadas, con errores, de pago) mas `free` (gratis). */
export type MarketStatus = StatusFilter | 'free';
export const MARKET_STATUSES: readonly MarketStatus[] = ['all', 'installed', 'available', 'disabled', 'errors', 'paid', 'free'];
export type OriginFilter = 'all' | 'official' | 'community';
export type RiskFilter = 'all' | 'low' | 'medium';
export type TriFilter = 'all' | 'yes' | 'no';

export interface MarketState {
    section: MarketSection;
    q: string;
    cat: MarketCategory | 'all';
    suite: string;
    publisher: string;
    status: MarketStatus;
    origin: OriginFilter;
    /** Riesgo MAXIMO de permisos: low = solo bajo; medium = bajo y medio. */
    risk: RiskFilter;
    ai: TriFilter;
    compat: 'all' | 'yes';
    sort: SortKey;
    view: ViewMode;
    /** Bloques de PAGE_SIZE elementos mostrados ("Mostrar mas"); 1 = primera pagina. */
    page: number;
    /** Extension abierta en la ficha (?ext=). */
    ext: string;
}

export const PAGE_SIZE = 24;
export const MAX_PAGES = 20;

export const DEFAULT_MARKET_STATE: MarketState = {
    section: 'discover', q: '', cat: 'all', suite: '', publisher: '', status: 'all', origin: 'all', risk: 'all', ai: 'all', compat: 'all',
    sort: 'relevance', view: 'grid', page: 1, ext: '',
};

export const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// ---------------------------------------------------------------------------------------------------------------------
// Busqueda
// ---------------------------------------------------------------------------------------------------------------------

/** Puntuacion de relevancia de una fila para una consulta; -1 = no coincide (todas las palabras deben aparecer en algun campo). */
export function searchScore(row: ExtensionRow, query: string): number {
    const tokens = norm(query).split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return 0;
    const name = norm(row.name);
    const id = norm(row.id);
    const tags = row.market.tags.map(norm);
    const who = norm(`${row.market.publisher.name} ${row.market.suite?.name ?? ''}`);
    const desc = norm(row.description);
    let total = 0;
    for (const token of tokens) {
        let best = -1;
        if (name === token) best = 100;
        else if (name.startsWith(token)) best = 60;
        else if (name.includes(token)) best = 40;
        else if (tags.some((t) => t === token)) best = 30;
        else if (id.includes(token) || tags.some((t) => t.includes(token))) best = 25;
        else if (who.includes(token)) best = 15;
        else if (desc.includes(token)) best = 5;
        if (best < 0) return -1;
        total += best;
    }
    return total;
}

// ---------------------------------------------------------------------------------------------------------------------
// Filtros y orden
// ---------------------------------------------------------------------------------------------------------------------

export interface MarketContext {
    starred: ReadonlySet<string>;
}

/** Predicado de la SECCION (barra lateral) sobre una fila. */
export function inSection(row: ExtensionRow, section: MarketSection, ctx: MarketContext): boolean {
    switch (section) {
        case 'installed': return row.installed;
        case 'starred': return ctx.starred.has(row.id);
        case 'official': return row.market.publisher.official;
        case 'community': return !row.market.publisher.official;
        default: return true;
    }
}

export function matchesFilters(row: ExtensionRow, st: MarketState, ctx: MarketContext): boolean {
    if (!inSection(row, st.section, ctx)) return false;
    if (st.cat !== 'all' && !row.market.categories.includes(st.cat)) return false;
    if (st.suite && row.market.suite?.id !== st.suite) return false;
    if (st.publisher && row.market.publisher.id !== st.publisher) return false;
    if (st.status === 'free' ? row.isPaid : !matchesStatus(row, st.status)) return false;
    if (st.origin === 'official' && !row.market.publisher.official) return false;
    if (st.origin === 'community' && row.market.publisher.official) return false;
    if (st.risk !== 'all') {
        const risk: PermissionRisk = overallRisk(row.template);
        if (risk === 'high' || (st.risk === 'low' && risk !== 'low')) return false;
    }
    if (st.ai === 'yes' && !row.requiresAi) return false;
    if (st.ai === 'no' && row.requiresAi) return false;
    if (st.compat === 'yes' && row.incompatible) return false;
    return true;
}

const newestDate = (row: ExtensionRow): string => row.market.history[0]?.date ?? '';

/** Aplica filtros + busqueda + orden. Las favoritas van primero dentro de cada orden (salvo "name"). */
export function applyMarket(rows: readonly ExtensionRow[], st: MarketState, ctx: MarketContext): ExtensionRow[] {
    const scored: Array<{ row: ExtensionRow; score: number }> = [];
    for (const row of rows) {
        if (!matchesFilters(row, st, ctx)) continue;
        const score = searchScore(row, st.q);
        if (score < 0) continue;
        scored.push({ row, score });
    }
    const byName = (a: ExtensionRow, b: ExtensionRow) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    const star = (r: ExtensionRow) => (ctx.starred.has(r.id) ? 0 : 1);
    scored.sort((a, b) => {
        if (st.sort === 'name') return byName(a.row, b.row);
        const s = star(a.row) - star(b.row);
        if (s !== 0) return s;
        if (st.sort === 'popular') return b.row.market.installCount - a.row.market.installCount || byName(a.row, b.row);
        if (st.sort === 'recent') return newestDate(b.row).localeCompare(newestDate(a.row)) || byName(a.row, b.row);
        // relevance: con consulta manda la puntuacion; sin ella, populares y luego nombre.
        if (st.q.trim()) return b.score - a.score || b.row.market.installCount - a.row.market.installCount || byName(a.row, b.row);
        return b.row.market.installCount - a.row.market.installCount || byName(a.row, b.row);
    });
    return scored.map((x) => x.row);
}

export function paginate<T>(items: readonly T[], page: number): { items: T[]; shown: number; total: number; hasMore: boolean } {
    const pages = Math.min(Math.max(1, Math.trunc(page) || 1), MAX_PAGES);
    const shown = Math.min(items.length, pages * PAGE_SIZE);
    return { items: items.slice(0, shown), shown, total: items.length, hasMore: shown < items.length };
}

// ---------------------------------------------------------------------------------------------------------------------
// Agrupaciones
// ---------------------------------------------------------------------------------------------------------------------

export interface SuiteGroup { id: string; name: string; icon: string | null; rows: ExtensionRow[]; installed: number }
export interface PublisherGroup { id: string; name: string; icon: string | null; url: string | null; official: boolean; verified: boolean; rows: ExtensionRow[] }

/** Defensa extra: una no-core solo cuenta en la suite de su propio editor, nunca en una oficial. */
function suiteTrusted(row: ExtensionRow): boolean {
    const s = row.market.suite;
    if (!s) return false;
    return row.id.startsWith('core-') || (s.id === row.market.publisher.id && !row.market.publisher.official);
}

export function groupBySuite(rows: readonly ExtensionRow[]): SuiteGroup[] {
    const map = new Map<string, SuiteGroup>();
    for (const row of rows) {
        const s = row.market.suite;
        if (!s || !suiteTrusted(row)) continue;
        const g = map.get(s.id) ?? { id: s.id, name: s.name, icon: s.icon, rows: [], installed: 0 };
        g.rows.push(row);
        if (row.installed) g.installed += 1;
        if (!g.icon && s.icon) g.icon = s.icon;
        map.set(s.id, g);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function groupByPublisher(rows: readonly ExtensionRow[]): PublisherGroup[] {
    const map = new Map<string, PublisherGroup>();
    for (const row of rows) {
        const p = row.market.publisher;
        const g = map.get(p.id) ?? { id: p.id, name: p.name, icon: p.icon, url: p.url, official: p.official, verified: p.verified, rows: [] };
        g.rows.push(row);
        map.set(p.id, g);
    }
    return Array.from(map.values()).sort((a, b) => Number(b.official) - Number(a.official) || a.name.localeCompare(b.name));
}

export function categoryCounts(rows: readonly ExtensionRow[]): Record<MarketCategory, number> {
    const out = Object.fromEntries(MARKET_CATEGORIES.map((c) => [c, 0])) as Record<MarketCategory, number>;
    for (const row of rows) for (const c of row.market.categories) out[c] += 1;
    return out;
}

/** Otras extensiones de la misma suite (sin la propia). */
export function suiteMates(row: ExtensionRow, rows: readonly ExtensionRow[]): ExtensionRow[] {
    const id = suiteTrusted(row) ? row.market.suite?.id : undefined;
    if (!id) return [];
    return rows.filter((r) => r.id !== row.id && suiteTrusted(r) && r.market.suite?.id === id).sort((a, b) => a.name.localeCompare(b.name));
}

/** Relacionadas: comparten categoria o etiquetas (no son de la misma suite: esas van aparte). Maximo `limit`. */
export function relatedRows(row: ExtensionRow, rows: readonly ExtensionRow[], limit = 4): ExtensionRow[] {
    const suiteId = row.market.suite?.id;
    const scored: Array<{ r: ExtensionRow; s: number }> = [];
    for (const r of rows) {
        if (r.id === row.id || (suiteId && r.market.suite?.id === suiteId)) continue;
        const cats = r.market.categories.filter((c) => row.market.categories.includes(c)).length;
        const tags = r.market.tags.filter((t) => row.market.tags.includes(t)).length;
        const s = cats * 2 + tags;
        if (s > 0) scored.push({ r, s });
    }
    return scored.sort((a, b) => b.s - a.s || b.r.market.installCount - a.r.market.installCount || a.r.name.localeCompare(b.r.name)).slice(0, limit).map((x) => x.r);
}

// ---------------------------------------------------------------------------------------------------------------------
// Descubrir
// ---------------------------------------------------------------------------------------------------------------------

export interface DiscoverSections { featured: ExtensionRow[]; fresh: ExtensionRow[]; popular: ExtensionRow[]; recommended: ExtensionRow[] }

/**
 * Secciones de "Descubrir". Destacados: oficiales mas instaladas (o por nombre si aun no hay datos). Nuevos: ultima version publicada mas
 * reciente. Populares: mas instalaciones (>0). Recomendados: no instaladas parecidas a lo que ya tiene el dominio (misma suite pesa mas que
 * la misma categoria o etiquetas) o que son dependencia de algo instalado.
 */
export function discoverSections(rows: readonly ExtensionRow[], limit = 6): DiscoverSections {
    const byName = (a: ExtensionRow, b: ExtensionRow) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    const featured = rows.filter((r) => r.market.publisher.official && !r.mandatory).sort((a, b) => b.market.installCount - a.market.installCount || byName(a, b)).slice(0, limit);
    const fresh = rows.filter((r) => newestDate(r)).sort((a, b) => newestDate(b).localeCompare(newestDate(a)) || byName(a, b)).slice(0, limit);
    const popular = rows.filter((r) => r.market.installCount > 0).sort((a, b) => b.market.installCount - a.market.installCount || byName(a, b)).slice(0, limit);

    const installed = rows.filter((r) => r.installed);
    const suites = new Set(installed.map((r) => r.market.suite?.id).filter((x): x is string => !!x));
    const cats = new Set(installed.flatMap((r) => r.market.categories));
    const tags = new Set(installed.flatMap((r) => r.market.tags));
    const wanted = new Set(installed.flatMap((r) => Object.keys(r.dependencies)));
    const recommended = rows
        .filter((r) => !r.installed)
        .map((r) => ({
            r,
            s: (r.market.suite && suites.has(r.market.suite.id) ? 3 : 0) + r.market.categories.filter((c) => cats.has(c)).length + r.market.tags.filter((t) => tags.has(t)).length * 0.5 + (wanted.has(r.id) ? 4 : 0),
        }))
        .filter((x) => x.s > 0 && installed.length > 0)
        .sort((a, b) => b.s - a.s || byName(a.r, b.r))
        .slice(0, limit)
        .map((x) => x.r);
    return { featured, fresh, popular, recommended };
}

// ---------------------------------------------------------------------------------------------------------------------
// Estrellas (optimista)
// ---------------------------------------------------------------------------------------------------------------------

/** Lista de favoritas tras marcar/desmarcar (inmutable, sin duplicados). Es la misma funcion que usa la actualizacion optimista. */
export function withStar(stars: readonly string[], id: string, starred: boolean): string[] {
    const without = stars.filter((s) => s !== id);
    return starred ? [...without, id] : without;
}

// ---------------------------------------------------------------------------------------------------------------------
// Estado en la URL (?q=&cat=&suite=&publisher=&view=...). Los parametros desconocidos se ignoran; los invalidos caen al valor por defecto.
// ---------------------------------------------------------------------------------------------------------------------

const ID_PARAM_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const oneOf = <T extends string>(value: string | null | undefined, allowed: readonly T[], fallback: T): T => (value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback);

export function parseMarketUrl(params: { get(name: string): string | null }): MarketState {
    const d = DEFAULT_MARKET_STATE;
    const cat = params.get('cat');
    const suite = params.get('suite') ?? '';
    const publisher = params.get('publisher') ?? '';
    const page = Number(params.get('page'));
    let section = oneOf(params.get('sec'), MARKET_SECTIONS, d.section);
    // Compatibilidad: ?suite= / ?publisher= abren su pagina aunque no venga ?sec=; con consulta o filtros se muestra la lista, no "Descubrir".
    if (!params.get('sec')) {
        if (publisher) section = 'publisher';
        else if (suite) section = 'suites';
        else if (cat && (MARKET_CATEGORIES as readonly string[]).includes(cat)) section = 'categories';
        else if ((params.get('q') ?? '').trim()) section = 'categories';
    }
    return {
        section,
        q: (params.get('q') ?? '').slice(0, 100),
        cat: cat && (MARKET_CATEGORIES as readonly string[]).includes(cat) ? (cat as MarketCategory) : 'all',
        suite: ID_PARAM_RE.test(suite) ? suite : '',
        publisher: ID_PARAM_RE.test(publisher) ? publisher : '',
        status: oneOf(params.get('status'), MARKET_STATUSES, d.status),
        origin: oneOf(params.get('origin'), ['all', 'official', 'community'] as const, d.origin),
        risk: oneOf(params.get('risk'), ['all', 'low', 'medium'] as const, d.risk),
        ai: oneOf(params.get('ai'), ['all', 'yes', 'no'] as const, d.ai),
        compat: oneOf(params.get('compat'), ['all', 'yes'] as const, d.compat),
        sort: oneOf(params.get('sort'), SORT_KEYS, d.sort),
        view: oneOf(params.get('view'), ['grid', 'list'] as const, d.view),
        page: Number.isInteger(page) && page >= 1 ? Math.min(page, MAX_PAGES) : 1,
        ext: ID_PARAM_RE.test(params.get('ext') ?? '') ? (params.get('ext') as string) : '',
    };
}

/** Query string (sin "?") solo con lo que difiere del estado por defecto. Conserva `keep` (p. ej. ?open= de la busqueda global). */
export function buildMarketQuery(st: MarketState, keep?: URLSearchParams | null): string {
    const sp = new URLSearchParams();
    if (keep) for (const [k, v] of keep.entries()) if (k === 'open') sp.set(k, v);
    const d = DEFAULT_MARKET_STATE;
    const put = (k: string, v: string, dv: string) => { if (v && v !== dv) sp.set(k, v); };
    put('sec', st.section, d.section);
    put('q', st.q.trim(), '');
    put('cat', st.cat, 'all');
    put('suite', st.suite, '');
    put('publisher', st.publisher, '');
    put('status', st.status, 'all');
    put('origin', st.origin, 'all');
    put('risk', st.risk, 'all');
    put('ai', st.ai, 'all');
    put('compat', st.compat, 'all');
    put('sort', st.sort, 'relevance');
    put('view', st.view, 'grid');
    if (st.page > 1) sp.set('page', String(st.page));
    put('ext', st.ext, '');
    return sp.toString();
}

/** Hay algun filtro (distinto de seccion) activo: para "Limpiar filtros" y para decidir lista vs Descubrir. */
export function hasActiveFilters(st: MarketState): boolean {
    const d = DEFAULT_MARKET_STATE;
    return !!st.q.trim() || st.cat !== d.cat || st.status !== d.status || st.origin !== d.origin || st.risk !== d.risk || st.ai !== d.ai || st.compat !== d.compat;
}

// ---------------------------------------------------------------------------------------------------------------------
// Instalar la suite
// ---------------------------------------------------------------------------------------------------------------------

/** Permisos que exigen aprobacion EXPLICITA del administrador: rutas publicas, cuentas compartidas de proveedor y OAUTH_ACCOUNT de alto riesgo. */
export function requiresExplicitApproval(row: Pick<ExtensionRow, 'template'> | null | undefined): boolean {
    const perms = row?.template?.permissions ?? [];
    return perms.includes('PUBLIC_ROUTE') || oauthApprovalKeys(perms).length > 0;
}

export type SkipReason = 'installed' | 'paid' | 'incompatible' | 'ai' | 'not-in-catalog' | 'cycle';
export interface SuiteStep { id: string; name: string; action: 'install' | 'activate'; viaDependency: boolean }
export interface SuitePlan {
    /** Orden de instalacion: dependencias primero. Solo lo que realmente hay que instalar o activar. */
    steps: SuiteStep[];
    /** Miembros (o dependencias) que no se pueden instalar o ya estan, con el motivo. */
    skipped: Array<{ id: string; name: string; reason: SkipReason }>;
    /** Permisos de TODO lo que se va a instalar, de mayor a menor riesgo, sin repetir. */
    permissions: ReturnType<typeof describePermissions>;
    /** Extensiones del plan que exigen aprobacion explicita (PUBLIC_ROUTE / cuentas compartidas). */
    approvals: string[];
    /** Hay algo que instalar y nada bloquea el plan. */
    ok: boolean;
}

const RISK_ORDER: Record<PermissionRisk, number> = { high: 0, medium: 1, low: 2 };

/**
 * Plan de "Instalar la suite": instala cada miembro que falte (o activa los desactivados) con sus dependencias en orden, sin repetir.
 * Una extension de pago, incompatible con el cliente, pausada por IA o cuya dependencia no esta en el catalogo NO se instala: queda en `skipped`
 * con el motivo (la UI lo muestra antes de confirmar). Simulacion pura: no instala nada.
 */
export function planSuiteInstall(members: readonly ExtensionRow[], allRows: readonly ExtensionRow[]): SuitePlan {
    const byId = new Map(allRows.map((r) => [r.id, r]));
    const steps: SuiteStep[] = [];
    const skipped: SuitePlan['skipped'] = [];
    const stepIds = new Set<string>();
    const skipIds = new Set<string>();
    const memberIds = new Set(members.map((m) => m.id));
    const skip = (row: { id: string; name: string }, reason: SkipReason) => {
        if (skipIds.has(row.id)) return;
        skipIds.add(row.id);
        skipped.push({ id: row.id, name: row.name, reason });
    };
    const blocked = (row: ExtensionRow): SkipReason | null => {
        if (row.isPaid && !row.installed) return 'paid';
        if (row.aiBlock.blocked && !row.installed) return 'ai';
        if (!canInstall(row) && !row.installed) return 'incompatible';
        return null;
    };

    for (const member of members) {
        if (member.installed && member.enabled) { skip(member, 'installed'); continue; }
        const reason = blocked(member);
        if (reason) { skip(member, reason); continue; }
        const plan = dependencyPlanFor(member, allRows);
        const depBlock = plan.errors.length > 0;
        if (depBlock) { skip(member, plan.errors.some((e) => e.reason === 'cycle') ? 'cycle' : 'not-in-catalog'); continue; }
        // Dependencias bloqueadas (de pago, incompatibles...) impiden instalar el miembro.
        const badDep = plan.dependencies.map((d) => byId.get(d.id)).find((r) => r && blocked(r));
        if (badDep) { skip(member, blocked(badDep) as SkipReason); continue; }
        for (const id of plan.order) {
            if (stepIds.has(id)) continue;
            const row = byId.get(id);
            if (!row) continue;
            stepIds.add(id);
            steps.push({ id, name: row.name, action: row.installed ? 'activate' : 'install', viaDependency: !memberIds.has(id) });
        }
    }

    const rowsInPlan = steps.map((s) => byId.get(s.id)).filter((r): r is ExtensionRow => !!r);
    const seen = new Set<string>();
    const permissions = rowsInPlan
        .flatMap((r) => describePermissions(r.template?.permissions))
        .filter((p) => (seen.has(p.permission) ? false : (seen.add(p.permission), true)))
        .sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk]);
    return {
        steps,
        skipped,
        permissions,
        approvals: rowsInPlan.filter(requiresExplicitApproval).map((r) => r.id),
        ok: steps.length > 0,
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// Boton principal contextual de la ficha
// ---------------------------------------------------------------------------------------------------------------------

export type PrimaryState =
    | { kind: 'update' }
    | { kind: 'enable' }
    | { kind: 'install'; withDeps: string[] }
    | { kind: 'buy' }
    | { kind: 'requires-lib'; libs: string[] }
    | { kind: 'requires-client' }
    | { kind: 'requires-key' }
    | { kind: 'paused-ai' }
    | { kind: 'installed' };

/** Capacidades que solo se anuncian con clave de dominio (copia de SIGNED_ONLY de capabilities.ts, comparada por nombre para no importar el cliente en el modelo puro). */
const KEY_CAPS = new Set(['ext.grants.v1', 'oauth.broker.v1', 'oauth.provider.v1', 'oauth.provider.v2', 'ext.routes.v1', 'ext.routes.auth.v1', 'lifecycle.events.v2']);

/** Estado del boton principal: que debe ofrecer la ficha segun instalacion, compatibilidad, dependencias, IA y precio. */
export function primaryState(row: ExtensionRow, allRows: readonly ExtensionRow[], signedOnlyCaps: ReadonlySet<string> = KEY_CAPS): PrimaryState {
    if (row.installed && row.aiBlock.blocked) return { kind: 'paused-ai' };
    const missing = row.upgrade?.missingCaps ?? [];
    const needsKey = missing.some((c) => signedOnlyCaps.has(c));
    if (row.installed) {
        if (row.updateAvailable) return needsKey && row.incompatible ? { kind: 'requires-key' } : { kind: 'update' };
        if (!row.enabled) return row.incompatible ? (needsKey ? { kind: 'requires-key' } : { kind: 'requires-client' }) : { kind: 'enable' };
        return { kind: 'installed' };
    }
    if (row.incompatible) return needsKey ? { kind: 'requires-key' } : { kind: 'requires-client' };
    const plan = dependencyPlanFor(row, allRows);
    if (plan.errors.length > 0) return { kind: 'requires-lib', libs: plan.errors.map((e) => e.dependency) };
    if (row.isPaid) return { kind: 'buy' };
    return { kind: 'install', withDeps: plan.dependencies.map((d) => d.id) };
}
