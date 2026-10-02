import { describe, expect, it } from 'vitest';
import { PAGE_UI_COMPONENTS, UI_COMPONENTS, pageUiReason, validateUi } from '../ui-schema';
import { checkExpression } from '../expressions';
import { validateManifest } from '../manifest-schema';
import {
    NAV_LIMITS, navEntryHref, navEntryVisible, navLabel, navTargetPagePath, readNavEntries, stripAdminNavEntries as stripManifest, validateNavEntries,
} from '../nav-schema';
import { collectNavItems, formatBadge, navHref, parseBadgeValue, stripAdminNavEntries } from '../nav-entries';
import { CAPABILITY_REGISTRY, LEGACY_CLIENT, evaluateRequires, makeClientIdentity, readRequires } from '../client-contract';
import { CLIENT_CAPABILITIES, CLIENT_IDENTITY, UNSIGNED_CLIENT_IDENTITY } from '../client/capabilities';

const check = (node: unknown) => validateUi(node, { checkExpression });
const paths = (r: ReturnType<typeof check>) => r.errors.map((e) => e.path);

// ---------------------------------------------------------------------------------------------------------------
describe('componentes de pagina: props invalidas rechazadas con ruta', () => {
    const cases: Array<[string, any, string]> = [
        ['PAGE_HEADER sin titulo', { type: 'PAGE_HEADER', props: {} }, 'ui.props.title'],
        ['PAGE_HEADER miga sin label', { type: 'PAGE_HEADER', props: { title: 'x', breadcrumbs: [{ url: '/' }] } }, 'ui.props.breadcrumbs[0].label'],
        ['PAGE_HEADER miga con URL javascript:', { type: 'PAGE_HEADER', props: { title: 'x', breadcrumbs: [{ label: 'a', url: 'javascript:alert(1)' }] } }, 'ui.props.breadcrumbs[0].url'],
        ['PAGE_HEADER estado con tono invalido', { type: 'PAGE_HEADER', props: { title: 'x', status: { label: 'a', tone: 'arcoiris' } } }, 'ui.props.status.tone'],
        ['PAGE_HEADER actions no son nodos', { type: 'PAGE_HEADER', props: { title: 'x', actions: 'Guardar' } }, 'ui.props.actions'],
        ['PAGE_HEADER HTML en el titulo', { type: 'PAGE_HEADER', props: { title: '<script>alert(1)</script>' } }, 'ui.props.title'],
        ['SPLIT_PANE ratio fuera de la lista', { type: 'SPLIT_PANE', props: { ratio: '9:1' } }, 'ui.props.ratio'],
        ['SPLIT_PANE panel con texto', { type: 'SPLIT_PANE', props: { startPane: 'hola' } }, 'ui.props.startPane'],
        ['KPI_CARD sin label', { type: 'KPI_CARD', props: { value: '1' } }, 'ui.props.label'],
        ['KPI_CARD trend invalido', { type: 'KPI_CARD', props: { label: 'x', trend: 'sideways' } }, 'ui.props.trend'],
        ['KPI_CARD sparkline con texto', { type: 'KPI_CARD', props: { label: 'x', sparkline: [1, 'a'] } }, 'ui.props.sparkline[1]'],
        ['KPI_CARD onClick no es accion', { type: 'KPI_CARD', props: { label: 'x', onClick: 'CALL_BACKEND' } }, 'ui.props.onClick'],
        ['CHART kind invalido', { type: 'CHART', props: { kind: 'radar' } }, 'ui.props.kind'],
        ['CHART serie sin nombre', { type: 'CHART', props: { series: [{ data: [1] }] } }, 'ui.props.series[0].label'],
        ['CHART tono de serie invalido', { type: 'CHART', props: { series: [{ label: 'a', tone: 'rojo' }] } }, 'ui.props.series[0].tone'],
        ['CHART valueFormat invalido', { type: 'CHART', props: { valueFormat: 'dolares' } }, 'ui.props.valueFormat'],
        ['CHART data con valor de texto', { type: 'CHART', props: { kind: 'pie', data: [{ label: 'a', value: 'x' }] } }, 'ui.props.data[0].value'],
        ['CHART color crudo', { type: 'CHART', props: { color: '#ff0000' } }, 'ui.props.color'],
        ['TIMELINE evento sin titulo', { type: 'TIMELINE', props: { items: [{ time: 'hoy' }] } }, 'ui.props.items[0].title'],
        ['TIMELINE tono invalido', { type: 'TIMELINE', props: { items: [{ title: 'a', tone: 'x' }] } }, 'ui.props.items[0].tone'],
        ['TREE defaultExpanded fuera de rango', { type: 'TREE', props: { defaultExpanded: 99 } }, 'ui.props.defaultExpanded'],
        ['TREE bind invalido', { type: 'TREE', props: { bind: 'a b' } }, 'ui.props.bind'],
        ['STEPPER paso sin titulo', { type: 'STEPPER', props: { steps: [{ description: 'x' }] } }, 'ui.props.steps[0].title'],
        ['STEPPER estado invalido', { type: 'STEPPER', props: { steps: [{ title: 'a', status: 'roto' }] } }, 'ui.props.steps[0].status'],
        ['STEPPER orientacion invalida', { type: 'STEPPER', props: { orientation: 'diagonal' } }, 'ui.props.orientation'],
        ['TABLE formato desconocido', { type: 'TABLE', props: { columns: [{ key: 'a', format: 'moneda' }] } }, 'ui.props.columns[0].format'],
        ['TABLE toneMap con tono invalido', { type: 'TABLE', props: { columns: [{ key: 'a', toneMap: { x: 'rosa' } }] } }, 'ui.props.columns[0].toneMap.x'],
        ['TABLE defaultSort sin key', { type: 'TABLE', props: { defaultSort: { dir: 'asc' } } }, 'ui.props.defaultSort.key'],
        ['TABLE defaultSort.dir invalido', { type: 'TABLE', props: { defaultSort: { key: 'a', dir: 'up' } } }, 'ui.props.defaultSort.dir'],
        ['TABLE bulkActions no es arreglo', { type: 'TABLE', props: { bulkActions: 'x' } }, 'ui.props.bulkActions'],
        ['TABLE bulk onClick no es accion', { type: 'TABLE', props: { bulkActions: [{ label: 'a', onClick: 'x' }] } }, 'ui.props.bulkActions[0].onClick'],
    ];
    for (const [name, node, path] of cases) {
        it(`${name} -> ${path}`, () => {
            const r = check(node);
            expect(paths(r), JSON.stringify(r.errors)).toContain(path);
        });
    }

    it('un arbol con todos los componentes nuevos y la tabla avanzada valida sin errores ni avisos', () => {
        const page = {
            type: 'STACK', props: { gap: 4 }, children: [
                { type: 'PAGE_HEADER', props: { title: { es: 'Metricas', en: 'Metrics' }, breadcrumbs: [{ label: 'Inicio', url: '/' }, { label: 'Metricas' }], status: { label: 'En vivo', tone: 'success' }, actions: [{ type: 'BUTTON', props: { label: 'Actualizar', onClick: { action: 'REFRESH' } } }], onRetry: { action: 'REFRESH' } } },
                { type: 'SPLIT_PANE', props: { ratio: '1:2', resizable: true, startPane: [{ type: 'TEXT', props: { content: 'a' } }], endPane: [{ type: 'TEXT', props: { content: 'b' } }] } },
                { type: 'KPI_CARD', props: { label: 'Spam', value: '${state.spam}', trend: 'down', invertTrend: true, sparkline: [1, 2, 3], onClick: { action: 'NAVIGATE', path: '/x' } } },
                { type: 'CHART', props: { kind: 'line', labels: '${state.days}', series: [{ label: { es: 'A', en: 'A' }, data: [1, 2, null] }], unit: 'u' } },
                { type: 'CHART', props: { kind: 'donut', data: [{ label: 'a', value: 1 }] } },
                { type: 'TIMELINE', props: { items: [{ title: 'a', time: '2026-01-01', onClick: { action: 'REFRESH' } }] } },
                { type: 'TREE', props: { items: [{ id: 'a', label: 'A', children: [{ id: 'b', label: 'B' }] }], bind: 'sel', onSelect: { action: 'REFRESH' } } },
                { type: 'STEPPER', props: { current: 1, steps: [{ title: 'A' }, { title: 'B', status: 'error' }], onSelect: { action: 'REFRESH' } } },
                { type: 'TABLE', props: { data: '${state.rows}', searchable: true, defaultSort: { key: 'a', dir: 'desc' }, error: '${state.err}', onRetry: { action: 'REFRESH' }, bulkActions: [{ label: 'x', onClick: { action: 'REFRESH' } }], columns: [{ key: 'a', format: 'link', hrefKey: 'u', filter: true }, { key: 'b', format: 'status', toneMap: { ok: 'success' } }] } },
            ],
        };
        const r = check(page);
        expect(r.errors, JSON.stringify(r.errors)).toEqual([]);
        expect(r.warnings, JSON.stringify(r.warnings)).toEqual([]);
    });

    it('respeta los limites del esquema: demasiados nodos, profundidad y tamano', () => {
        const flat = { type: 'STACK', children: Array.from({ length: 700 }, () => ({ type: 'KPI_CARD', props: { label: 'x' } })) };
        expect(check(flat).errors.some((e) => e.code === 'too-many' || e.code === 'too-many-nodes')).toBe(true);
        let deep: any = { type: 'KPI_CARD', props: { label: 'x' } };
        for (let i = 0; i < 40; i += 1) deep = { type: 'STACK', children: [deep] };
        expect(check(deep).errors.some((e) => e.code === 'too-deep')).toBe(true);
        const big = check({ type: 'CHART', props: { series: [{ label: 'a', data: Array.from({ length: 501 }, () => 1) }] } });
        expect(big.errors.some((e) => e.code === 'too-many')).toBe(true);
    });
});

// ---------------------------------------------------------------------------------------------------------------
describe('ui.pages.v1: deteccion y declaracion obligatoria', () => {
    it('pageUiReason: cada componente nuevo y las props nuevas de TABLE (tambien por el alias DATA_TABLE)', () => {
        for (const type of PAGE_UI_COMPONENTS) {
            expect(UI_COMPONENTS[type], type).toBeTruthy();
            expect(pageUiReason({ type, props: {} })).toBe(`componente ${type}`);
        }
        expect(pageUiReason({ type: 'TABLE', props: { searchable: true } })).toBe('TABLE.searchable');
        expect(pageUiReason({ type: 'DATA_TABLE', props: { bulkActions: [] } })).toBe('TABLE.bulkActions');
        expect(pageUiReason({ type: 'TABLE', props: { columns: [{ key: 'a', filter: true }] } })).toBe('TABLE.columns[].filter');
        expect(pageUiReason({ type: 'TABLE', props: { columns: [{ key: 'a', format: 'status' }] } })).toBe('TABLE.columns[].format=status');
        expect(pageUiReason({ type: 'TABLE', props: { columns: [{ key: 'a', format: 'badge' }], rowKey: 'id', pageSize: 5 } })).toBeNull();
        for (const v of [null, 'x', 3, [], { type: 5 }, { type: 'TEXT' }]) expect(pageUiReason(v)).toBeNull();
    });

    const base = { id: 'ext-pages', name: 'X', version: '1.0.0', permissions: [] };
    const page = (component: any) => ({ ...base, mounts: [{ point: 'PAGE', path: 'p', component }] });

    it('publicar (estricto): usar un componente de pagina sin ui.pages.v1 es un error con ruta; declarado, valida', () => {
        const comp = { type: 'PAGE_HEADER', props: { title: 'x' } };
        const bad = validateManifest(page(comp));
        expect(bad.ok).toBe(false);
        expect(bad.errors.map((e) => e.path)).toContain('requires.capabilities');
        expect(bad.errors[0].message).toContain('ui.pages.v1');
        const ok = validateManifest({ ...page(comp), requires: { clientApi: 8, capabilities: ['ui.pages.v1'] } });
        expect(ok.ok, JSON.stringify(ok.errors)).toBe(true);
    });

    it('carga (tolerante): solo un aviso, la extension ya publicada no se apaga', () => {
        const r = validateManifest(page({ type: 'CHART', props: {} }), { lenientMounts: true, lenientCatalog: true });
        expect(r.ok).toBe(true);
        expect(r.warnings.some((w) => /ui\.pages\.v1/.test(w.message))).toBe(true);
    });

    it('un manifest que NO usa los componentes nuevos no necesita la capacidad', () => {
        expect(validateManifest(page({ type: 'TABLE', props: { columns: [{ key: 'a', format: 'badge' }] } })).ok).toBe(true);
    });
});

// ---------------------------------------------------------------------------------------------------------------
describe('navEntries: validacion del manifest', () => {
    const caps = ['nav.entries.v1', 'ext.pages.auth.v1', 'ext.routes.v1', 'ext.routes.auth.v1', 'ui.pages.v1'];
    const manifest = (extra: Record<string, any> = {}) => ({
        id: 'ext-nav', name: 'X', version: '1.0.0', permissions: [], requires: { clientApi: 8, capabilities: caps },
        api: { functions: { badge: { handler: 'badge' }, getData: { handler: 'getData' } } },
        mounts: [
            { point: 'PAGE', path: 'notes', component: { type: 'PAGE_HEADER', props: { title: 'Notas' } } },
            { point: 'PAGE', path: 'metrics', auth: 'admin', minLevel: 2, component: { type: 'PAGE_HEADER', props: { title: 'Metricas' } } },
        ],
        backendRoutes: [
            { path: '/badge', handler: 'badge', method: 'GET', auth: 'session' },
            { path: '/admin-badge', handler: 'badge', method: 'GET', auth: 'admin', minLevel: 2 },
            { path: '/save', handler: 'getData', method: 'POST' },
        ],
        navEntries: [{ id: 'notes', section: 'workspace', label: { es: 'Notas', en: 'Notes' }, icon: 'StickyNote', order: 20, target: 'page:notes' }],
        ...extra,
    });
    const run = (m: any, options: Parameters<typeof validateManifest>[1] = {}) => validateManifest(m, options);
    const errs = (m: any) => run(m).errors.map((e) => `${e.path}|${e.message}`);
    const one = (entry: Record<string, any>, extra: Record<string, any> = {}) => manifest({ navEntries: [{ id: 'e', section: 'workspace', label: 'E', target: 'page:notes', ...entry }], ...extra });

    it('un manifest correcto valida (con las dos secciones y la insignia)', () => {
        const m = manifest({ navEntries: [
            { id: 'notes', section: 'workspace', label: { es: 'Notas', en: 'Notes' }, icon: 'StickyNote', order: 20, target: 'page:notes', badge: { route: '/badge', refreshSeconds: 60 }, mobile: false },
            { id: 'metrics', section: 'admin', label: 'Metricas', target: '/extensions/metrics', minLevel: 2, badge: { route: '/admin-badge' } },
            { id: 'tool', section: 'tools', label: 'Tool', icon: 'brand:zoom', target: 'page:notes' },
        ] });
        const r = run(m);
        expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    });

    const bad: Array<[string, any, string]> = [
        ['no es un arreglo', manifest({ navEntries: {} }), 'navEntries'],
        ['mas de 12 entradas', manifest({ navEntries: Array.from({ length: 13 }, (_, i) => ({ id: `e${i}`, section: 'tools', label: 'x', target: 'page:notes' })) }), 'navEntries'],
        ['sin capacidad nav.entries.v1', manifest({ requires: { clientApi: 8, capabilities: caps.filter((c) => c !== 'nav.entries.v1') } }), 'requires.capabilities'],
        ['entrada no es objeto', manifest({ navEntries: ['x'] }), 'navEntries[0]'],
        ['clave desconocida', one({ color: 'red' }), 'navEntries[0].color'],
        ['id invalido', one({ id: 'Con Espacios' }), 'navEntries[0].id'],
        ['seccion invalida', one({ section: 'footer' }), 'navEntries[0].section'],
        ['etiqueta con HTML', one({ label: '<b>x</b>' }), 'navEntries[0].label'],
        ['etiqueta demasiado larga', one({ label: 'x'.repeat(41) }), 'navEntries[0].label'],
        ['etiqueta por idioma con HTML', one({ label: { es: 'ok', en: '<img src=x>' } }), 'navEntries[0].label'],
        ['etiqueta ausente', one({ label: undefined }), 'navEntries[0].label'],
        ['icono invalido', one({ icon: 'http://x/y.png' }), 'navEntries[0].icon'],
        ['order fuera de rango', one({ order: 5000 }), 'navEntries[0].order'],
        ['order decimal', one({ order: 1.5 }), 'navEntries[0].order'],
        ['mobile no booleano', one({ mobile: 'si' }), 'navEntries[0].mobile'],
        ['sin target', one({ target: undefined }), 'navEntries[0].target'],
        ['target a una URL externa', one({ target: 'https://evil.example' }), 'navEntries[0].target'],
        ['target a /admin', one({ target: '/admin/users' }), 'navEntries[0].target'],
        ['target con ..', one({ target: 'page:../x' }), 'navEntries[0].target'],
        ['target a una pagina inexistente', one({ target: 'page:nope' }), 'navEntries[0].target'],
        ['auth none', one({ auth: 'none' }), 'navEntries[0].auth'],
        ['minLevel sin auth admin', one({ minLevel: 2 }), 'navEntries[0].minLevel'],
        ['seccion admin con auth session', one({ section: 'admin', auth: 'session', target: 'page:metrics' }), 'navEntries[0].auth'],
        ['entrada admin hacia una pagina que NO es admin', one({ section: 'admin', target: 'page:notes' }), 'navEntries[0].target'],
        ['entrada session hacia una pagina admin', one({ auth: 'session', target: 'page:metrics' }), 'navEntries[0].auth'],
        ['minLevel menor que el de la pagina', one({ section: 'admin', target: 'page:metrics', minLevel: 1 }), 'navEntries[0].minLevel'],
        ['minLevel fuera de 1..4', one({ section: 'admin', target: 'page:metrics', minLevel: 9 }), 'navEntries[0].minLevel'],
        ['insignia no objeto', one({ badge: '/badge' }), 'navEntries[0].badge'],
        ['insignia con ruta con parametros', one({ badge: { route: '/a/:id' } }), 'navEntries[0].badge.route'],
        ['insignia con ruta no declarada', one({ badge: { route: '/nope' } }), 'navEntries[0].badge.route'],
        ['insignia con ruta POST', one({ badge: { route: '/save' } }), 'navEntries[0].badge.route'],
        ['refresco demasiado frecuente', one({ badge: { route: '/badge', refreshSeconds: 5 } }), 'navEntries[0].badge.refreshSeconds'],
        ['refresco demasiado lento', one({ badge: { route: '/badge', refreshSeconds: 99999 } }), 'navEntries[0].badge.refreshSeconds'],
        ['insignia con clave desconocida', one({ badge: { route: '/badge', url: 'x' } }), 'navEntries[0].badge.url'],
        ['entrada admin con insignia de ruta session', one({ section: 'admin', target: 'page:metrics', minLevel: 2, badge: { route: '/badge' } }), 'navEntries[0].badge.route'],
        ['duplicada', manifest({ navEntries: [{ id: 'a', section: 'tools', label: 'x', target: 'page:notes' }, { id: 'a', section: 'tools', label: 'y', target: 'page:notes' }] }), 'navEntries[1].id'],
    ];
    for (const [name, m, path] of bad) {
        it(`rechaza: ${name} -> ${path}`, () => {
            const list = errs(m).map((e) => e.split('|')[0]);
            expect(list, JSON.stringify(errs(m))).toContain(path);
        });
    }

    it('carga tolerante: una entrada invalida no apaga la extension (aviso) y readNavEntries la descarta', () => {
        const m = one({ target: 'page:nope' });
        const r = run(m, { lenientMounts: true, lenientCatalog: true });
        expect(r.ok).toBe(true);
        expect(r.warnings.some((w) => w.path === 'navEntries[0].target')).toBe(true);
        expect(readNavEntries(m)).toEqual([]);
    });

    it('validateNavEntries sin capacidad pero lista vacia no exige nada', () => {
        const out: string[] = [];
        validateNavEntries([], (p, m) => out.push(`${p}:${m}`), () => undefined, { mounts: [], routes: [], capabilities: [] });
        expect(out).toEqual([]);
    });
});

// ---------------------------------------------------------------------------------------------------------------
describe('navEntries: lectura, destino y visibilidad', () => {
    const m = {
        id: 'ext-nav', requires: { capabilities: ['nav.entries.v1'] },
        mounts: [{ point: 'PAGE', path: 'notes' }, { point: 'PAGE', path: 'metrics', auth: 'admin', minLevel: 3 }, { point: 'PAGE', path: 'pub', auth: 'none' }],
        backendRoutes: [{ path: '/badge', handler: 'b', method: 'GET' }],
        navEntries: [
            { id: 'z', section: 'tools', label: 'Z', target: 'page:notes', order: 5 },
            { id: 'a', section: 'workspace', label: { es: 'Notas', en: 'Notes' }, target: 'page:notes', order: 5, badge: { route: '/badge' } },
            { id: 'adm', section: 'admin', label: 'Admin', target: 'page:metrics' },
            { id: 'inherit', section: 'workspace', label: 'Hereda', target: 'page:metrics', order: 1 },
            { id: 'low', section: 'admin', label: 'Bajo', target: 'page:metrics', minLevel: 1 },
            { id: 'pub', section: 'main', label: 'Publica', target: 'page:pub' },
            { id: 'ghost', section: 'main', label: 'Fantasma', target: 'page:nope' },
        ],
    };

    it('target: page:<path> y /extensions/<path> son equivalentes; lo demas es invalido', () => {
        expect(navTargetPagePath('page:notes')).toBe('notes');
        expect(navTargetPagePath('/extensions/a/b')).toBe('a/b');
        expect(navEntryHref('page:notes')).toBe('/extensions/notes');
        for (const t of ['notes', 'page:', 'page:../a', 'page:a//b', '/p/x', 'https://x.y', 'javascript:alert(1)', 'page:a/b/c/d/e', 5, null]) expect(navTargetPagePath(t)).toBeNull();
    });

    it('readNavEntries: orden estable, valores por defecto heredados de la pagina y descarte de lo inseguro', () => {
        const list = readNavEntries(m);
        expect(list.map((e) => e.id)).toEqual(['inherit', 'z', 'a', 'adm', 'low']);
        const byId = Object.fromEntries(list.map((e) => [e.id, e]));
        expect(byId.a).toMatchObject({ auth: 'session', minLevel: 0, href: '/extensions/notes', mobile: true, badge: { route: '/badge', refreshSeconds: 120 } });
        expect(byId.adm).toMatchObject({ auth: 'admin', minLevel: 3 });
        // la pagina exige 3: una entrada que dice 1 nunca se muestra a quien la pagina rechazaria
        expect(byId.low.minLevel).toBe(3);
        // aunque la entrada no diga nada, hereda lo admin de la pagina
        expect(byId.inherit).toMatchObject({ auth: 'admin', minLevel: 3 });
        expect(byId.pub).toBeUndefined();
        expect(byId.ghost).toBeUndefined();
    });

    it('sin la capacidad declarada no se lee ninguna entrada (clientes que no la entienden no deberian recibirlas)', () => {
        expect(readNavEntries({ ...m, requires: { capabilities: [] } })).toEqual([]);
        expect(readNavEntries(null)).toEqual([]);
        expect(readNavEntries({ navEntries: 'x' })).toEqual([]);
    });

    it('una entrada de administracion sobre una pagina que no es admin se descarta (falla cerrado)', () => {
        const hole = { ...m, navEntries: [{ id: 'x', section: 'admin', label: 'X', target: 'page:notes' }, { id: 'y', section: 'workspace', auth: 'admin', label: 'Y', target: 'page:notes' }] };
        expect(readNavEntries(hole)).toEqual([]);
    });

    it('navEntryVisible: sesion, admin y nivel', () => {
        const session = { auth: 'session' as const, minLevel: 0 };
        const admin2 = { auth: 'admin' as const, minLevel: 2 };
        expect(navEntryVisible(session, { signedIn: false, level: null })).toBe(false);
        expect(navEntryVisible(session, { signedIn: true, level: null })).toBe(true);
        expect(navEntryVisible(admin2, { signedIn: true, level: null })).toBe(false);
        expect(navEntryVisible(admin2, { signedIn: true, level: 1 })).toBe(false);
        expect(navEntryVisible(admin2, { signedIn: true, level: 2 })).toBe(true);
        expect(navEntryVisible(admin2, { signedIn: true, level: 4 })).toBe(true);
        expect(navEntryVisible({ auth: 'admin', minLevel: 0 }, { signedIn: true, level: 0 })).toBe(false);
    });

    it('navLabel: idioma exacto, base, en, es y respaldo', () => {
        expect(navLabel('Plano', 'fr')).toBe('Plano');
        expect(navLabel({ es: 'Notas', en: 'Notes' }, 'en')).toBe('Notes');
        expect(navLabel({ es: 'Notas', en: 'Notes' }, 'es-MX')).toBe('Notas');
        expect(navLabel({ es: 'Notas', en: 'Notes' }, 'fr')).toBe('Notes');
        expect(navLabel({ pt: 'Notas' }, 'fr')).toBe('Notas');
    });

    it('stripAdminNavEntries (servidor): quita las que el nivel no alcanza antes de enviar al navegador', () => {
        const levels = (level: number | null) => (stripManifest(m as any, level).navEntries as any[]).map((e) => e.id);
        expect(levels(null)).toEqual(['z', 'a', 'pub', 'ghost']);
        expect(levels(2)).toEqual(['z', 'a', 'pub', 'ghost']);
        expect(levels(3)).toEqual(['z', 'a', 'adm', 'inherit', 'low', 'pub', 'ghost']);
        expect(stripManifest(m as any, 4)).toBe(m);
        const exts = [{ id: 'e', template: JSON.stringify(m) }, { id: 'f', template: { navEntries: [{ id: 'q', section: 'admin', label: 'Q', target: 'page:p' }], mounts: [{ point: 'PAGE', path: 'p', auth: 'admin', minLevel: 4 }] } }, { id: 'g', template: { id: 'g' } }];
        const out = stripAdminNavEntries(exts, 1);
        expect(JSON.parse(out[0].template as string).navEntries.map((e: any) => e.id)).toEqual(['z', 'a', 'pub', 'ghost']);
        expect((out[1].template as any).navEntries).toEqual([]);
        expect(out[2]).toBe(exts[2]);
        expect(stripAdminNavEntries([exts[2]], 1)).toEqual([exts[2]]);
    });

    it('la insignia: formato y lectura de la respuesta de la ruta', () => {
        expect(formatBadge(0)).toBeNull();
        expect(formatBadge(-3)).toBeNull();
        expect(formatBadge(NaN)).toBeNull();
        expect(formatBadge('4')).toBeNull();
        expect(formatBadge(7.9)).toBe('7');
        expect(formatBadge(1500)).toBe('999+');
        expect(parseBadgeValue(5)).toBe(5);
        expect(parseBadgeValue({ count: 3 })).toBe(3);
        expect(parseBadgeValue({ value: 2 })).toBe(2);
        expect(parseBadgeValue({ data: { count: 9 } })).toBe(9);
        for (const v of [null, 'a', {}, { count: -1 }, { count: 'x' }, NaN, [] as any]) expect(parseBadgeValue(v)).toBeNull();
        expect(NAV_LIMITS.maxBadge).toBe(999);
    });
});

// ---------------------------------------------------------------------------------------------------------------
describe('collectNavItems: filtrado por nivel, auth y estado de la extension', () => {
    const template = (extra: Record<string, any> = {}) => ({
        manifestVersion: '1.0', id: 'ext-a', name: 'A', version: '1.0.0', permissions: [], requires: { clientApi: 8, capabilities: ['nav.entries.v1', 'ext.pages.auth.v1', 'ext.routes.v1', 'ext.routes.auth.v1', 'ui.pages.v1'] },
        api: { functions: { b: { handler: 'b' } } }, backendRoutes: [{ path: '/badge', handler: 'b', method: 'GET' }],
        mounts: [
            { point: 'PAGE', path: 'notes', component: { type: 'PAGE_HEADER', props: { title: 'N' } } },
            { point: 'PAGE', path: 'metrics', auth: 'admin', minLevel: 2, component: { type: 'PAGE_HEADER', props: { title: 'M' } } },
        ],
        navEntries: [
            { id: 'notes', section: 'workspace', label: { es: 'Notas', en: 'Notes' }, target: 'page:notes', order: 10, badge: { route: '/badge' } },
            { id: 'metrics', section: 'admin', label: 'Metricas', target: 'page:metrics', order: 20 },
            { id: 'tool', section: 'tools', label: 'Tool', target: 'page:notes', mobile: false },
        ],
        ...extra,
    });
    const ext = (extra: Record<string, any> = {}, tpl: Record<string, any> = {}) => ({ id: 'ext-a', version: '1.0.0', template: template(tpl), ...extra });
    const who = (level: number | null, signedIn = true) => ({ signedIn, level });
    const ids = (items: ReturnType<typeof collectNavItems>) => items.map((i) => i.entryId);

    it('sin sesion no hay nada; con sesion normal solo lo no admin; el admin ve segun su nivel', () => {
        expect(ids(collectNavItems([ext()], { who: who(null, false), lang: 'es' }))).toEqual([]);
        expect(ids(collectNavItems([ext()], { who: who(null), lang: 'es' }))).toEqual(['notes', 'tool']);
        expect(ids(collectNavItems([ext()], { who: who(1), lang: 'es' }))).toEqual(['notes', 'tool']);
        expect(ids(collectNavItems([ext()], { who: who(2), lang: 'es' }))).toEqual(['notes', 'metrics', 'tool']);
    });

    it('seccion y movil; etiqueta en el idioma del usuario; href de admin dentro de la consola', () => {
        const all = collectNavItems([ext()], { who: who(4), lang: 'en' });
        expect(all.find((i) => i.entryId === 'notes')).toMatchObject({ label: 'Notes', href: '/extensions/notes', key: 'ext-a:notes', badge: { route: '/badge', refreshSeconds: 120 } });
        expect(all.find((i) => i.entryId === 'metrics')).toMatchObject({ href: '/admin/x/metrics', section: 'admin', auth: 'admin', minLevel: 2 });
        expect(ids(collectNavItems([ext()], { who: who(4), lang: 'en', section: 'admin' }))).toEqual(['metrics']);
        expect(ids(collectNavItems([ext()], { who: who(4), lang: 'en', mobileOnly: true }))).toEqual(['notes', 'metrics']);
        expect(navHref({ section: 'admin', pagePath: 'x/y', href: '/extensions/x/y' })).toBe('/admin/x/x/y');
    });

    it('extension desactivada por el usuario o con status disabled: no aparece (salvo obligatoria)', () => {
        const opts = { who: who(4), lang: 'es' };
        expect(ids(collectNavItems([ext()], { ...opts, isEnabled: () => false }))).toEqual([]);
        expect(ids(collectNavItems([ext()], { ...opts, isEnabled: () => false, isMandatory: () => true })).length).toBe(3);
        expect(ids(collectNavItems([ext({}, { status: 'disabled' })], opts))).toEqual([]);
    });

    it('bloqueada por la IA: aparece DESHABILITADA con motivo, sin destino ni insignia', () => {
        const items = collectNavItems([ext({ aiBlock: { blocked: true } })], { who: who(2), lang: 'es', reasons: { ai: 'IA apagada', dependency: 'Falta dep' } });
        expect(items.length).toBe(3);
        for (const item of items) {
            expect(item.href).toBeNull();
            expect(item.badge).toBeNull();
            expect(item.disabled).toEqual({ reason: 'ai', text: 'IA apagada' });
        }
    });

    it('pausada por una dependencia que falta: deshabilitada con motivo (defensa en profundidad)', () => {
        const dependent = ext({ id: 'ext-a' }, { requires: { clientApi: 8, capabilities: ['nav.entries.v1', 'ext.pages.auth.v1', 'ext.routes.v1', 'ext.routes.auth.v1', 'ui.pages.v1', 'ext.dependencies.v1'], extensions: { 'ext-missing': '^1.0.0' } } });
        const items = collectNavItems([dependent], { who: who(2), lang: 'es', reasons: { ai: 'IA', dependency: 'Dependencia' } });
        expect(items.length).toBe(3);
        expect(items.every((i) => i.disabled?.reason === 'dependency' && i.href === null)).toBe(true);
    });

    it('extensiones ausentes de /api/config (desinstaladas, incompatibles) no aportan entradas; manifest invalido o sin capacidad tampoco', () => {
        expect(collectNavItems([], { who: who(4), lang: 'es' })).toEqual([]);
        expect(collectNavItems(null as any, { who: who(4), lang: 'es' })).toEqual([]);
        expect(collectNavItems([{ id: 'x' }, { id: 'y', template: 5 }, null] as any, { who: who(4), lang: 'es' })).toEqual([]);
        expect(collectNavItems([ext({}, { requires: { clientApi: 8, capabilities: [] } })], { who: who(4), lang: 'es' })).toEqual([]);
    });

    it('orden: por order y luego por extension/entrada', () => {
        const b = ext({ id: 'ext-b' }, { id: 'ext-b', navEntries: [{ id: 'first', section: 'workspace', label: 'F', target: 'page:notes', order: 10 }, { id: 'early', section: 'workspace', label: 'E', target: 'page:notes', order: 1 }] });
        expect(collectNavItems([ext(), b], { who: who(1), lang: 'es', section: 'workspace' }).map((i) => i.key)).toEqual(['ext-b:early', 'ext-a:notes', 'ext-b:first']);
    });
});

// ---------------------------------------------------------------------------------------------------------------
describe('compatibilidad: un cliente antiguo no recibe versiones con estas capacidades', () => {
    const requires = readRequires({ requires: { clientApi: 8, capabilities: ['ui.pages.v1', 'nav.entries.v1'] } });

    it('las capacidades estan registradas con since 8 y este cliente las implementa', () => {
        for (const id of ['ui.pages.v1', 'nav.entries.v1']) {
            expect(CAPABILITY_REGISTRY[id].since).toBe(8);
            expect(CLIENT_CAPABILITIES).toContain(id);
            expect(CLIENT_IDENTITY.capabilities).toContain(id);
        }
    });

    it('cliente legacy, clientApi 6 con todas sus capacidades y cliente sin clave: NO cumplen; el actual si', () => {
        expect(evaluateRequires(requires, LEGACY_CLIENT).ok).toBe(false);
        expect(evaluateRequires(requires, LEGACY_CLIENT).missingCaps).toEqual(['nav.entries.v1', 'ui.pages.v1']);
        const v6 = makeClientIdentity(6, Object.entries(CAPABILITY_REGISTRY).filter(([, i]) => i.since <= 6).map(([id]) => id));
        const r6 = evaluateRequires(requires, v6);
        expect(r6.ok).toBe(false);
        expect(r6.clientApiNeeded).toBe('>=8');
        expect(evaluateRequires(requires, UNSIGNED_CLIENT_IDENTITY).ok).toBe(false);
        expect(evaluateRequires(requires, CLIENT_IDENTITY).ok).toBe(true);
    });

    it('un cliente que anuncia clientApi 8 pero sin las capacidades tampoco las recibe (las capacidades mandan)', () => {
        const liar = makeClientIdentity(9, ['ui.kit.v2']);
        expect(evaluateRequires(requires, liar).ok).toBe(false);
    });
});
