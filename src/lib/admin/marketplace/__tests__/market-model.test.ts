import { describe, expect, it } from 'vitest';
import { buildRows, type CatalogExtension, type InstalledExtension, type ExtensionRow } from '@/lib/admin/extensions-view';
import { fallbackMarket, resolveMarket, sanitizeMarket } from '../market-meta';
import {
    DEFAULT_MARKET_STATE, applyMarket, buildMarketQuery, categoryCounts, discoverSections, groupByPublisher, groupBySuite, hasActiveFilters, paginate,
    parseMarketUrl, planSuiteInstall, primaryState, relatedRows, requiresExplicitApproval, searchScore, suiteMates, withStar, type MarketState,
} from '../market-model';

const GOOGLE = { id: 'google', name: 'Google', icon: 'brand:google' };
const SECURITY = { id: 'security', name: 'Seguridad', icon: 'lucide:ShieldCheck' };
const BLOOMX = { id: 'bloomx', name: 'Bloomx', official: true, verified: true };

type Spec = {
    id: string; name: string; description?: string; paid?: boolean; deps?: Record<string, string>; perms?: string[]; suite?: typeof GOOGLE; categories?: string[]; tags?: string[];
    installs?: number; date?: string; publisher?: any; ai?: boolean; incompatible?: boolean; upgrade?: any; version?: string; category?: string;
};

const cat = (s: Spec): CatalogExtension => ({
    id: s.id, name: s.name, description: s.description ?? '', version: s.version ?? '1.0.0', authType: null, isPaid: !!s.paid, price: s.paid ? '5' : '0', currency: 'USD',
    template: {
        permissions: s.perms ?? [], ...(s.deps ? { dependencies: s.deps } : {}), ...(s.ai ? { ai: { features: ['composer'], required: true, purpose: { es: 'x', en: 'x' } } } : {}),
        category: s.category,
    } as any,
    incompatible: s.incompatible, upgrade: s.upgrade ?? null,
    market: sanitizeMarket({
        publisher: s.publisher ?? BLOOMX, suite: s.suite ?? null, categories: s.categories ?? ['other'], tags: s.tags ?? [], installCount: s.installs ?? 0,
        history: s.date ? [{ version: s.version ?? '1.0.0', status: 'published', date: s.date, compatible: true, notes: ['n'] }] : [],
    }, s.id),
});
const inst = (id: string, enabled = true): InstalledExtension => ({ extensionId: id, name: id, description: null, enabled, state: enabled ? 'enabled' : 'deactivated', installedVersion: '1.0.0', catalogVersion: '1.0.0', isPaid: false, ui: {}, hasCredentials: false, template: null });

const specs: Spec[] = [
    { id: 'core-googlelib', name: 'GoogleLib', suite: GOOGLE, categories: ['integrations'], tags: ['oauth'], installs: 9, date: '2026-09-01', perms: ['OAUTH_SHARED:google'] },
    { id: 'core-calendar', name: 'Google Calendar', description: 'Eventos y reuniones', suite: GOOGLE, categories: ['calendar'], tags: ['eventos'], deps: { 'core-googlelib': '^1.0.0' }, installs: 7, date: '2026-09-10', perms: ['CALENDAR_READ', 'CALENDAR_WRITE'] },
    { id: 'core-google-meet', name: 'Google Meet', suite: GOOGLE, categories: ['calendar', 'integrations'], deps: { 'core-googlelib': '^1.0.0' }, installs: 3, date: '2026-09-20' },
    { id: 'core-dlp', name: 'Prevención de fugas', suite: SECURITY, categories: ['mail', 'settings'], tags: ['seguridad', 'dlp'], installs: 12, perms: ['READ_EMAIL'], date: '2026-08-01' },
    { id: 'core-sealer', name: 'Sealer', suite: SECURITY, categories: ['mail'], installs: 1, perms: ['PUBLIC_ROUTE'] },
    { id: 'core-summarizer', name: 'Resumidor', categories: ['ai', 'mail'], tags: ['resumen'], installs: 5, ai: true, perms: ['AI_GENERATE'] },
    { id: 'acme-pro', name: 'Acme Pro', paid: true, publisher: { id: 'acme', name: 'Acme', official: true, verified: true }, categories: ['automation'], tags: ['resumen'], installs: 0 },
    { id: 'core-old', name: 'Vieja', categories: ['other'], incompatible: true, upgrade: { latestVersion: '2.0.0', requires: { clientApi: '>=11', capabilities: ['ext.routes.v1'] }, missingCaps: ['ext.routes.v1'], clientApiNeeded: null } },
];

const rows = (installed: string[] = []) => buildRows({ catalog: specs.map(cat), installed: installed.map((i) => inst(i)), locale: 'es' });
const st = (patch: Partial<MarketState> = {}): MarketState => ({ ...DEFAULT_MARKET_STATE, section: 'categories', ...patch });
const ctx = (...ids: string[]) => ({ starred: new Set(ids) });
const ids = (list: { id: string }[]) => list.map((r) => r.id);

describe('metadatos del marketplace (saneo y respaldo)', () => {
    it('un tercero no puede declararse oficial ni verificado', () => {
        const m = sanitizeMarket({ publisher: { id: 'bloomx', name: 'Bloomx', official: true, verified: true } }, 'acme-tool')!;
        expect(m.publisher.official).toBe(false);
        expect(m.publisher.verified).toBe(false);
        // y la fila de Acme de arriba (id sin core-) NO es oficial aunque lo declare
        expect(rows().find((r) => r.id === 'acme-pro')!.market.publisher.official).toBe(false);
        expect(rows().find((r) => r.id === 'core-dlp')!.market.publisher.official).toBe(true);
    });

    it('descarta HTML, capturas no https, categorias desconocidas y acota listas', () => {
        const m = sanitizeMarket({
            publisher: { id: 'ok-pub', name: '<b>x</b>' }, suite: { id: 'Bad Id', name: 'S' },
            categories: ['mail', 'nope', 'mail', 'ai', 'calendar', 'other'], tags: ['a', '<script>', 'a', ...Array.from({ length: 30 }, (_, i) => `t${i}`)],
            screenshots: ['http://x/a.png', 'https://x/a.png', 'javascript:alert(1)', ...Array.from({ length: 20 }, (_, i) => `https://x/${i}.png`)], installCount: -5,
        }, 'core-x')!;
        expect(m.publisher.id).toBe('bloomx');
        expect(m.suite).toBeNull();
        expect(m.categories).toEqual(['mail', 'ai', 'calendar']);
        expect(m.tags).not.toContain('<script>');
        expect(m.tags.length).toBeLessThanOrEqual(12);
        expect(m.screenshots.every((s) => s.startsWith('https://'))).toBe(true);
        expect(m.screenshots.length).toBeLessThanOrEqual(6);
        expect(m.installCount).toBe(0);
    });

    it('sin bloque market (backend antiguo) se deriva un respaldo del id y la categoria clasica', () => {
        const fb = fallbackMarket('core-x', 'calendar');
        expect(fb.publisher.official).toBe(true);
        expect(fb.categories).toEqual(['calendar']);
        expect(fb.fromBackend).toBe(false);
        expect(fallbackMarket('acme-x', 'productivity').publisher.id).toBe('community');
        expect(fallbackMarket('acme-x', 'productivity').categories).toEqual(['automation']);
        expect(resolveMarket(null, 'a-b', 'other').installCount).toBe(0);
    });
});

describe('busqueda, filtros y orden (funciones puras)', () => {
    it('busca por nombre, descripcion, etiqueta y editor, sin acentos y con todas las palabras', () => {
        const all = rows();
        expect(ids(applyMarket(all, st({ q: 'prevencion' }), ctx()))).toEqual(['core-dlp']);
        expect(ids(applyMarket(all, st({ q: 'reuniones' }), ctx()))).toEqual(['core-calendar']);
        expect(ids(applyMarket(all, st({ q: 'dlp' }), ctx()))).toEqual(['core-dlp']);
        expect(ids(applyMarket(all, st({ q: 'acme' }), ctx()))).toEqual(['acme-pro']);
        expect(ids(applyMarket(all, st({ q: 'google meet' }), ctx()))).toEqual(['core-google-meet']);
        expect(applyMarket(all, st({ q: 'zzz' }), ctx())).toEqual([]);
        expect(searchScore(all[0], '')).toBe(0);
    });

    it('la relevancia prefiere el nombre exacto/inicio y luego etiquetas sobre descripcion', () => {
        const all = rows();
        const out = ids(applyMarket(all, st({ q: 'resumen' }), ctx()));
        expect(out).toContain('core-summarizer');
        expect(out).toContain('acme-pro');
        expect(ids(applyMarket(all, st({ q: 'google' }), ctx()))[0]).toBe('core-googlelib'); // nombre que empieza por "Google" y mas instalada
    });

    it('filtros combinables: categoria, estado, origen, riesgo, IA y compatibilidad', () => {
        const all = rows(['core-dlp']);
        expect(ids(applyMarket(all, st({ cat: 'calendar' }), ctx())).sort()).toEqual(['core-calendar', 'core-google-meet']);
        expect(ids(applyMarket(all, st({ cat: 'calendar', status: 'available' }), ctx())).sort()).toEqual(['core-calendar', 'core-google-meet']);
        expect(ids(applyMarket(all, st({ status: 'installed' }), ctx()))).toEqual(['core-dlp']);
        expect(ids(applyMarket(all, st({ status: 'paid' }), ctx()))).toEqual(['acme-pro']);
        expect(ids(applyMarket(all, st({ status: 'free', origin: 'community' }), ctx()))).toEqual([]);
        expect(ids(applyMarket(all, st({ origin: 'community' }), ctx()))).toEqual(['acme-pro']);
        expect(ids(applyMarket(all, st({ ai: 'yes' }), ctx()))).toEqual(['core-summarizer']);
        expect(ids(applyMarket(all, st({ compat: 'yes' }), ctx()))).not.toContain('core-old');
        // riesgo maximo: "bajo" excluye READ_EMAIL (alto) y CALENDAR_WRITE (alto)
        const low = ids(applyMarket(all, st({ risk: 'low' }), ctx()));
        expect(low).not.toContain('core-dlp');
        expect(low).not.toContain('core-calendar');
        expect(low).toContain('core-google-meet');
        expect(ids(applyMarket(all, st({ cat: 'mail', ai: 'no', status: 'all', origin: 'official' }), ctx())).sort()).toEqual(['core-dlp', 'core-sealer']);
    });

    it('secciones: instaladas, favoritas, oficiales y comunidad', () => {
        const all = rows(['core-dlp', 'core-calendar']);
        expect(ids(applyMarket(all, st({ section: 'installed' }), ctx())).sort()).toEqual(['core-calendar', 'core-dlp']);
        expect(ids(applyMarket(all, st({ section: 'starred' }), ctx('core-sealer')))).toEqual(['core-sealer']);
        expect(ids(applyMarket(all, st({ section: 'community' }), ctx()))).toEqual(['acme-pro']);
        expect(ids(applyMarket(all, st({ section: 'official' }), ctx())).length).toBe(all.length - 1);
        expect(applyMarket(rows().filter((r) => r.market.publisher.official), st({ section: 'community' }), ctx())).toEqual([]);
    });

    it('orden: populares, recientes, nombre; las favoritas van primero (salvo por nombre)', () => {
        const all = rows();
        expect(ids(applyMarket(all, st({ sort: 'popular' }), ctx())).slice(0, 3)).toEqual(['core-dlp', 'core-googlelib', 'core-calendar']);
        expect(ids(applyMarket(all, st({ sort: 'recent' }), ctx())).slice(0, 3)).toEqual(['core-google-meet', 'core-calendar', 'core-googlelib']);
        expect(ids(applyMarket(all, st({ sort: 'popular' }), ctx('core-sealer')))[0]).toBe('core-sealer');
        const byName = applyMarket(all, st({ sort: 'name' }), ctx('core-sealer')).map((r) => r.name);
        expect(byName).toEqual([...byName].sort((a, b) => a.localeCompare(b)));
    });

    it('paginacion por bloques con tope', () => {
        const many = Array.from({ length: 60 }, (_, i) => i);
        expect(paginate(many, 1)).toMatchObject({ shown: 24, total: 60, hasMore: true });
        expect(paginate(many, 3)).toMatchObject({ shown: 60, hasMore: false });
        expect(paginate(many, 999).shown).toBe(60);
        expect(paginate([], 1)).toMatchObject({ shown: 0, hasMore: false });
    });
});

describe('suites, editores, descubrir y relacionadas', () => {
    it('agrupa por suite y por editor', () => {
        const all = rows(['core-calendar']);
        const suites = groupBySuite(all);
        expect(suites.map((s) => s.id)).toEqual(['google', 'security']);
        expect(suites[0]).toMatchObject({ name: 'Google', installed: 1 });
        expect(suites[0].rows).toHaveLength(3);
        const pubs = groupByPublisher(all);
        expect(pubs[0]).toMatchObject({ id: 'bloomx', official: true });
        expect(pubs.map((p) => p.id)).toEqual(['bloomx', 'acme']);
        expect(pubs[1]).toMatchObject({ official: false, verified: false });
        expect(categoryCounts(all).calendar).toBe(2);
    });

    it('«Otras de esta suite» excluye la propia y «Relacionadas» excluye las de la suite', () => {
        const all = rows();
        const meet = all.find((r) => r.id === 'core-google-meet')!;
        expect(ids(suiteMates(meet, all))).toEqual(['core-calendar', 'core-googlelib']);
        expect(ids(relatedRows(meet, all))).not.toContain('core-calendar');
        const dlp = all.find((r) => r.id === 'core-dlp')!;
        expect(ids(relatedRows(dlp, all))).toContain('core-summarizer'); // comparte categoria mail
    });

    it('Descubrir: destacadas oficiales, populares, novedades y recomendadas segun lo instalado', () => {
        const none = discoverSections(rows());
        expect(none.recommended).toEqual([]); // sin nada instalado no hay recomendacion
        expect(none.featured[0].id).toBe('core-dlp');
        expect(ids(none.popular)).toEqual(['core-dlp', 'core-googlelib', 'core-calendar', 'core-summarizer', 'core-google-meet', 'core-sealer']);
        expect(none.fresh[0].id).toBe('core-google-meet');
        const withInstalled = discoverSections(rows(['core-calendar']));
        // misma suite (Google) pesa mas: la dependencia GoogleLib y Meet encabezan
        expect(ids(withInstalled.recommended).slice(0, 2).sort()).toEqual(['core-google-meet', 'core-googlelib']);
        expect(ids(withInstalled.recommended)).not.toContain('core-calendar');
    });
});

describe('URL: ?q=&cat=&suite=&publisher=&view=', () => {
    const sp = (q: string) => new URLSearchParams(q);

    it('ida y vuelta y solo lo que difiere del valor por defecto', () => {
        const state = st({ section: 'categories', q: 'cal', cat: 'calendar', status: 'paid', view: 'list', sort: 'popular', page: 2, ext: 'core-dlp' });
        const qs = buildMarketQuery(state);
        expect(parseMarketUrl(sp(qs))).toEqual(state);
        expect(buildMarketQuery(DEFAULT_MARKET_STATE)).toBe('');
        expect(buildMarketQuery(st({ view: 'grid' }))).toBe('sec=categories');
    });

    it('URLs compartibles y antiguas: ?suite=, ?publisher=, ?cat= y ?q= abren su vista; lo invalido cae al valor por defecto', () => {
        expect(parseMarketUrl(sp('suite=google'))).toMatchObject({ section: 'suites', suite: 'google' });
        expect(parseMarketUrl(sp('publisher=bloomx'))).toMatchObject({ section: 'publisher', publisher: 'bloomx' });
        expect(parseMarketUrl(sp('cat=ai'))).toMatchObject({ section: 'categories', cat: 'ai' });
        expect(parseMarketUrl(sp('q=hola'))).toMatchObject({ section: 'categories', q: 'hola' });
        expect(parseMarketUrl(sp(''))).toEqual(DEFAULT_MARKET_STATE);
        const bad = parseMarketUrl(sp('sec=x&cat=<script>&view=zzz&sort=1&status=hack&page=-3&ext=../x&suite=a b&unknown=1'));
        expect(bad).toEqual(DEFAULT_MARKET_STATE);
        expect(parseMarketUrl(sp(`q=${'a'.repeat(500)}`)).q).toHaveLength(100);
    });

    it('conserva ?open= de la busqueda global', () => {
        expect(buildMarketQuery(st({ q: 'x' }), sp('open=core-dlp&zzz=1'))).toBe('open=core-dlp&sec=categories&q=x');
    });

    it('hasActiveFilters no cuenta la seccion ni la vista', () => {
        expect(hasActiveFilters(st({ view: 'list', sort: 'name' }))).toBe(false);
        expect(hasActiveFilters(st({ ai: 'yes' }))).toBe(true);
    });
});

describe('Instalar la suite (simulado): dependencias en orden, permisos y aprobaciones', () => {
    it('instala GoogleLib antes que sus dependientes, sin repetirla, y suma los permisos', () => {
        const all = rows();
        const plan = planSuiteInstall(all.filter((r) => r.market.suite?.id === 'google'), all);
        expect(plan.steps.map((s) => s.id)).toEqual(['core-googlelib', 'core-calendar', 'core-google-meet']);
        expect(plan.steps.every((s) => s.action === 'install')).toBe(true);
        expect(plan.steps.filter((s) => s.viaDependency)).toEqual([]);
        expect(plan.permissions.map((p) => p.permission)).toEqual(expect.arrayContaining(['OAUTH_SHARED:google', 'CALENDAR_READ', 'CALENDAR_WRITE']));
        expect(new Set(plan.permissions.map((p) => p.permission)).size).toBe(plan.permissions.length);
        expect(plan.permissions[0].risk).toBe('high');
        expect(plan.approvals).toEqual(['core-googlelib']); // cuenta compartida de proveedor => aprobacion explicita
        expect(plan.ok).toBe(true);
    });

    it('una dependencia fuera de la suite se instala igualmente y se marca como dependencia', () => {
        const all = rows();
        const plan = planSuiteInstall([all.find((r) => r.id === 'core-calendar')!], all);
        expect(plan.steps.map((s) => [s.id, s.viaDependency])).toEqual([['core-googlelib', true], ['core-calendar', false]]);
    });

    it('lo ya activo se omite, lo desactivado se activa y no se repite nada', () => {
        const all = buildRows({ catalog: specs.map(cat), installed: [inst('core-googlelib'), inst('core-calendar', false)], locale: 'es' });
        const plan = planSuiteInstall(all.filter((r) => r.market.suite?.id === 'google'), all);
        expect(plan.steps.map((s) => [s.id, s.action])).toEqual([['core-calendar', 'activate'], ['core-google-meet', 'install']]);
        expect(plan.skipped).toEqual([{ id: 'core-googlelib', name: 'GoogleLib', reason: 'installed' }]);
    });

    it('PUBLIC_ROUTE exige aprobacion explicita (Seguridad) y las de pago o incompatibles no se instalan, con su motivo', () => {
        const all = rows();
        const sec = planSuiteInstall(all.filter((r) => r.market.suite?.id === 'security'), all);
        expect(sec.approvals).toEqual(['core-sealer']);
        expect(requiresExplicitApproval(all.find((r) => r.id === 'core-sealer'))).toBe(true);
        expect(requiresExplicitApproval(all.find((r) => r.id === 'core-dlp'))).toBe(false);
        const odd = planSuiteInstall([all.find((r) => r.id === 'acme-pro')!, all.find((r) => r.id === 'core-old')!], all);
        expect(odd.steps).toEqual([]);
        expect(odd.ok).toBe(false);
        expect(odd.skipped.map((s) => s.reason).sort()).toEqual(['incompatible', 'paid']);
    });

    it('si una dependencia no esta en el catalogo, el miembro no se instala', () => {
        const orphan: Spec = { id: 'core-orphan', name: 'Huerfana', suite: GOOGLE, deps: { 'core-missing': '^1.0.0' } };
        const all = buildRows({ catalog: [...specs, orphan].map(cat), installed: [], locale: 'es' });
        const plan = planSuiteInstall([all.find((r) => r.id === 'core-orphan')!], all);
        expect(plan.steps).toEqual([]);
        expect(plan.skipped[0]).toMatchObject({ id: 'core-orphan', reason: 'not-in-catalog' });
    });
});

describe('boton principal contextual de la ficha', () => {
    it('instalar (con sus dependencias), comprar, requiere cliente/clave, actualizar, activar y pausada por IA', () => {
        const all = rows();
        const get = (id: string, list = all) => list.find((r) => r.id === id)!;
        expect(primaryState(get('core-calendar'), all)).toEqual({ kind: 'install', withDeps: ['core-googlelib'] });
        expect(primaryState(get('core-dlp'), all)).toEqual({ kind: 'install', withDeps: [] });
        expect(primaryState(get('acme-pro'), all)).toEqual({ kind: 'buy' });
        expect(primaryState(get('core-old'), all)).toEqual({ kind: 'requires-key' }); // ext.routes.v1 solo con clave de dominio
        const noKey = { ...get('core-old'), upgrade: { ...get('core-old').upgrade!, missingCaps: ['ui.pages.v1'] } };
        expect(primaryState(noKey, all)).toEqual({ kind: 'requires-client' });
        const lib = buildRows({ catalog: specs.filter((s) => s.id !== 'core-googlelib').map(cat), installed: [], locale: 'es' });
        expect(primaryState(get('core-calendar', lib), lib)).toEqual({ kind: 'requires-lib', libs: ['core-googlelib'] });
        const installed = rows(['core-dlp']);
        expect(primaryState(get('core-dlp', installed), installed)).toEqual({ kind: 'installed' });
        const off = buildRows({ catalog: specs.map(cat), installed: [inst('core-dlp', false)], locale: 'es' });
        expect(primaryState(get('core-dlp', off), off)).toEqual({ kind: 'enable' });
        const upd = buildRows({ catalog: specs.map((s) => cat(s.id === 'core-dlp' ? { ...s, version: '1.2.0' } : s)), installed: [inst('core-dlp')], locale: 'es' });
        expect(primaryState(get('core-dlp', upd), upd)).toEqual({ kind: 'update' });
        const ai = buildRows({ catalog: specs.map(cat), installed: [inst('core-summarizer')], locale: 'es', ai: { enabled: false, features: {}, extensions: {} } as any });
        expect(primaryState(get('core-summarizer', ai), ai)).toEqual({ kind: 'paused-ai' });
    });
});

describe('estrellas (actualizacion optimista)', () => {
    it('marcar y desmarcar es inmutable e idempotente', () => {
        const base = ['a'];
        expect(withStar(base, 'b', true)).toEqual(['a', 'b']);
        expect(withStar(['a', 'b'], 'b', true)).toEqual(['a', 'b']);
        expect(withStar(['a', 'b'], 'a', false)).toEqual(['b']);
        expect(withStar(base, 'zz', false)).toEqual(['a']);
        expect(base).toEqual(['a']);
    });
});

describe('suite no falsificable por terceros', () => {
    it('una no-core no entra en la suite oficial ni en la de otro editor; solo en la de su propio editor', () => {
        const forged = sanitizeMarket({ publisher: { id: 'evil', name: 'Evil' }, suite: { id: 'bloomx', name: 'Bloomx' } }, 'dev.evil.x')!;
        expect(forged.suite).toBeNull();
        const other = sanitizeMarket({ publisher: { id: 'evil', name: 'Evil' }, suite: { id: 'google', name: 'Google' } }, 'dev.evil.x')!;
        expect(other.suite).toBeNull();
        const own = sanitizeMarket({ publisher: { id: 'acme', name: 'Acme' }, suite: { id: 'acme', name: 'Acme Suite' } }, 'dev.acme.x')!;
        expect(own.suite?.id).toBe('acme');
        const core = sanitizeMarket({ publisher: BLOOMX, suite: { id: 'google', name: 'Google' } }, 'core-x')!;
        expect(core.suite?.id).toBe('google');
    });
    it('groupBySuite / suiteMates ignoran a una no-core con suite ajena aunque llegue ya construida', () => {
        const all = rows();
        const fake = { ...all.find((r) => r.id === 'core-calendar')!, id: 'dev.evil.x', market: { ...all[0].market, publisher: { ...all[0].market.publisher, id: 'evil', official: false }, suite: GOOGLE } } as ExtensionRow;
        const groups = groupBySuite([...all, fake]);
        expect(groups.find((g) => g.id === 'google')!.rows.some((r) => r.id === 'dev.evil.x')).toBe(false);
        expect(suiteMates(all.find((r) => r.id === 'core-calendar')!, [...all, fake]).some((r) => r.id === 'dev.evil.x')).toBe(false);
    });
});
