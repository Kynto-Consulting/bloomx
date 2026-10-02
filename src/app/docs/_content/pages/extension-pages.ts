import type { Block, DocPageContent } from '../types';
import { NAV_LIMITS, NAV_SECTIONS } from '@/lib/expansions/nav-schema';

/**
 * Guia: pagina completa + entrada de navegacion. El manifest de ejemplo es un OBJETO exportado (GUIDE_MANIFEST) y se
 * imprime con JSON.stringify: un test (extension-pages.test.ts) lo valida con el MISMO validador que la aplicacion,
 * asi la guia no puede mostrar un manifest que el servidor rechazaria.
 */

type Lang = 'es' | 'en';

const T = (lang: Lang, es: string, en: string): string => (lang === 'es' ? es : en);

export function guideManifest(lang: Lang): Record<string, any> {
    const retry = { action: 'CALL_BACKEND', function: 'getStats', resultKey: 'stats' };
    return {
        manifestVersion: '1.0',
        id: 'my-metrics',
        version: '1.0.0',
        name: T(lang, 'Métricas', 'Metrics'),
        description: T(lang, 'Panel de métricas del dominio con entrada en la consola de administración.', 'Domain metrics dashboard with an entry in the administration console.'),
        icon: 'lucide:ChartColumn',
        requires: { clientApi: 2, capabilities: ['ui.kit.v2', 'ui.pages.v1', 'nav.entries.v1', 'ext.routes.v1', 'ext.routes.auth.v1', 'ext.pages.auth.v1'] },
        permissions: [],
        api: { runtime: 'nodejs', entry: 'server.js', functions: { getStats: { handler: 'getStats', timeout: 10000 }, getBadge: { handler: 'getBadge', timeout: 5000 } } },
        backendRoutes: [{ path: '/badge', handler: 'getBadge', method: 'GET', auth: 'admin', minLevel: 2 }],
        state: { stats: null },
        mounts: [{
            point: 'PAGE', path: 'metrics', auth: 'admin', minLevel: 2,
            component: {
                type: 'STACK', props: { gap: 4 },
                onLoad: retry,
                children: [
                    {
                        type: 'PAGE_HEADER',
                        props: {
                            title: T(lang, 'Métricas del dominio', 'Domain metrics'), description: T(lang, 'Actividad de los últimos 7 días', 'Activity over the last 7 days'), icon: 'ChartColumn',
                            breadcrumbs: [{ label: T(lang, 'Administración', 'Administration'), url: '/admin' }, { label: T(lang, 'Métricas', 'Metrics') }],
                            loading: '${state.$loading.getStats}', error: '${state.$error.getStats}', onRetry: retry,
                            actions: [{ type: 'BUTTON', props: { label: T(lang, 'Actualizar', 'Refresh'), icon: 'RefreshCw', variant: 'outline', onClick: retry } }],
                        },
                    },
                    {
                        type: 'GRID', props: { columns: 3, gap: 3 },
                        children: [
                            { type: 'KPI_CARD', props: { label: T(lang, 'Recibidos', 'Received'), value: '${state.stats.received}', delta: '${state.stats.receivedDelta}', trend: 'up', sparkline: '${state.stats.receivedSeries}', loading: '${state.$loading.getStats}' } },
                            { type: 'KPI_CARD', props: { label: 'Spam', value: '${state.stats.spam}', delta: '${state.stats.spamDelta}', trend: 'down', invertTrend: true, loading: '${state.$loading.getStats}' } },
                            { type: 'KPI_CARD', props: { label: T(lang, 'Usuarios activos', 'Active users'), value: '${state.stats.active}', icon: 'Users', loading: '${state.$loading.getStats}' } },
                        ],
                    },
                    {
                        type: 'CHART',
                        props: {
                            kind: 'line', title: T(lang, 'Correo por día', 'Mail per day'), labels: '${state.stats.days}',
                            series: [{ label: T(lang, 'Recibidos', 'Received'), data: '${state.stats.receivedSeries}' }, { label: T(lang, 'Enviados', 'Sent'), data: '${state.stats.sentSeries}', tone: 'success' }],
                        },
                    },
                    {
                        type: 'TABLE',
                        props: {
                            caption: T(lang, 'Mayores remitentes', 'Top senders'), rowKey: 'email', searchable: true, pageSize: 10, defaultSort: { key: 'count', dir: 'desc' },
                            data: '${state.stats.top}', error: '${state.$error.getStats}', onRetry: retry,
                            columns: [
                                { key: 'email', label: T(lang, 'Remitente', 'Sender'), sortable: true },
                                { key: 'count', label: T(lang, 'Mensajes', 'Messages'), sortable: true },
                                { key: 'verdict', label: T(lang, 'Veredicto', 'Verdict'), format: 'status', toneMap: { ok: 'success', spam: 'danger' } },
                            ],
                        },
                    },
                ],
            },
        }],
        navEntries: [{
            id: 'metrics', section: 'admin', label: { es: 'Métricas', en: 'Metrics' }, icon: 'ChartColumn', order: 50, target: 'page:metrics', minLevel: 2,
            badge: { route: '/badge', refreshSeconds: 120 },
        }],
    };
}

/** Manifest de la guia en espanol (lo valida extension-pages.test.ts). */
export const GUIDE_MANIFEST = guideManifest('es');

/** Fragmentos EXACTOS de los ejemplos reales de bloomx-extensions (un test comprueba que siguen apareciendo en su manifest.src.mjs). */
export const EXAMPLE_FRAGMENTS: Array<{ file: string; title: string; code: string }> = [
    { file: 'domain-metrics/manifest.src.mjs', title: 'core-domain-metrics: requires', code: `    requires: {
        clientApi: 8,
        capabilities: [
            'ext.pages.auth.v1',
            'ext.routes.auth.v1',
            'ext.routes.v1',
            'nav.entries.v1',
            'services.host.v1',
            'ui.kit.v2',
            'ui.pages.v1',
        ],
    },` },
    { file: 'domain-metrics/manifest.src.mjs', title: 'core-domain-metrics: permiso', code: `    permissions: ['READ_STATS'],` },
    { file: 'domain-metrics/manifest.src.mjs', title: 'core-domain-metrics: ruta de la insignia', code: `        { path: '/badge', handler: 'getBadge', method: 'GET', auth: 'admin', minLevel: 1, timeoutMs: 10000 },` },
    { file: 'domain-metrics/manifest.src.mjs', title: 'core-domain-metrics: PAGE_HEADER con carga, error y reintento', code: `                    loading,
                    error: failed,
                    onRetry: load(),` },
    { file: 'domain-metrics/manifest.src.mjs', title: 'core-domain-metrics: TABLE avanzada', code: `                        searchable: true,
                        searchPlaceholder: t('Buscar fecha (AAAA-MM-DD)', 'Search date (YYYY-MM-DD)'),
                        defaultSort: { key: 'date', dir: 'desc' },` },
    { file: 'domain-metrics/manifest.src.mjs', title: 'core-domain-metrics: navEntries', code: `    navEntries: [
        {
            id: 'domain-metrics',
            section: 'admin',
            label: t('Métricas del dominio', 'Domain metrics'),
            icon: 'lucide:ChartColumn',
            order: 40,
            target: 'page:metrics',
            minLevel: 1,
            badge: { route: '/badge', refreshSeconds: 120 },
        },
    ],` },
    { file: 'quick-notes/manifest.src.mjs', title: 'core-quick-notes: navEntries', code: `    navEntries: [
        {
            id: 'quick-notes',
            section: 'workspace',
            label: t('Notas rápidas', 'Quick notes'),
            icon: 'lucide:NotebookPen',
            order: 60,
            target: 'page:notes',
        },
    ],` },
];

const serverEs = `// server.js — sandbox del backend: sin require/process. Cada funcion recibe UN parametro ctx.
async function getStats(ctx) {
    // Aquí iría tu consulta real (ctx.services...). Devuelve solo datos JSON.
    return {
        received: 1284, receivedDelta: '+8 %', spam: 37, spamDelta: '-12 %', active: 54,
        days: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'],
        receivedSeries: [210, 190, 240, 220, 260, 80, 84], sentSeries: [90, 85, 110, 95, 120, 30, 28],
        top: [{ email: 'ana@example.com', count: 42, verdict: 'ok' }, { email: 'promo@example.net', count: 31, verdict: 'spam' }],
    };
}

// La insignia: un número (o { count }). Se vuelve a pedir cada refreshSeconds.
async function getBadge(ctx) {
    const stats = await getStats(ctx);
    return { count: stats.spam };
}

module.exports = { getStats, getBadge };`;

const serverEn = serverEs
    .replace('sandbox del backend: sin require/process. Cada funcion recibe UN parametro ctx.', 'backend sandbox: no require/process. Every function takes ONE ctx parameter.')
    .replace('Aquí iría tu consulta real (ctx.services...). Devuelve solo datos JSON.', 'Your real query goes here (ctx.services...). Return JSON data only.')
    .replace("['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']", "['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']")
    .replace('La insignia: un número (o { count }). Se vuelve a pedir cada refreshSeconds.', 'The badge: a number (or { count }). It is requested again every refreshSeconds.');

const sectionRows = (lang: Lang): string[][] => {
    const where: Record<string, string> = {
        main: T(lang, 'Barra lateral del correo, junto a las carpetas.', 'Mail sidebar, next to the folders.'),
        workspace: T(lang, 'Barra lateral del correo, en el espacio de trabajo.', 'Mail sidebar, in the workspace.'),
        tools: T(lang, 'Barra lateral del correo, sección nueva «Herramientas».', 'Mail sidebar, new "Tools" section.'),
        admin: T(lang, 'Menú «Extensiones» de la consola de administración y su búsqueda global (Ctrl/Cmd+K).', 'The "Extensions" menu of the administration console and its global search (Ctrl/Cmd+K).'),
    };
    const who: Record<string, string> = {
        main: T(lang, 'Cualquier sesión', 'Any session'), workspace: T(lang, 'Cualquier sesión', 'Any session'), tools: T(lang, 'Cualquier sesión', 'Any session'),
        admin: T(lang, 'Solo `auth: "admin"` (y `minLevel` si lo declaras)', 'Only `auth: "admin"` (and `minLevel` if declared)'),
    };
    return NAV_SECTIONS.map((s) => [`\`${s}\``, where[s], who[s]]);
};

const blocks = (lang: Lang): Block[] => {
    const manifest = JSON.stringify(guideManifest(lang), null, 2);
    const es = lang === 'es';
    const server = es ? serverEs : serverEn;
    return [
        { t: 'p', text: T(lang,
            'Una extensión puede tener una **página completa** (un mount `PAGE` con cabecera, indicadores, gráficos y tablas) y una **entrada de navegación** (`navEntries`) que la enlaza desde la barra lateral del correo o desde la consola de administración. Esta guía construye una de punta a punta: un panel de métricas solo para administradores.',
            'An extension can have a **full page** (a `PAGE` mount with a header, indicators, charts and tables) and a **navigation entry** (`navEntries`) that links it from the mail sidebar or the administration console. This guide builds one end to end: a metrics dashboard for administrators only.') },
        { t: 'callout', kind: 'note', title: T(lang, 'Qué existe y qué no', 'What exists and what does not'), text: T(lang,
            'Hay entradas en la barra del correo y en el menú de la consola de administración (con su búsqueda global Ctrl/Cmd+K). **No hay paleta de comandos en la aplicación principal**: fuera de la consola, una entrada solo aparece en la barra lateral.',
            'There are entries in the mail sidebar and in the administration console menu (with its Ctrl/Cmd+K global search). **There is no command palette in the main app**: outside the console, an entry only appears in the sidebar.') },
        { t: 'h2', id: 'steps', text: T(lang, 'Paso a paso', 'Step by step') },
        { t: 'ol', items: [
            T(lang, '**Declara las capacidades** en `requires.capabilities`: `ui.pages.v1` (componentes de página completa y la `TABLE` avanzada), `nav.entries.v1` (`navEntries`) y, si la página o la ruta usan `auth`/`minLevel`, `ext.pages.auth.v1` y `ext.routes.auth.v1` (más `ext.routes.v1` para `backendRoutes`). El validador te dice cuál falta.',
                'Declare the **capabilities** in `requires.capabilities`: `ui.pages.v1` (full-page components and the advanced `TABLE`), `nav.entries.v1` (`navEntries`) and, if the page or route use `auth`/`minLevel`, `ext.pages.auth.v1` and `ext.routes.auth.v1` (plus `ext.routes.v1` for `backendRoutes`). The validator tells you which one is missing.'),
            T(lang, '**Crea el mount `PAGE`** con un `path` (letras, números, `_` y `-`; hasta 4 segmentos) y su `auth`/`minLevel`. Su contenido es una UI declarativa normal: [`PAGE_HEADER`](/docs/extension-ui/page-header), [`KPI_CARD`](/docs/extension-ui/kpi-card), [`CHART`](/docs/extension-ui/chart) y [`TABLE`](/docs/extension-ui/table).',
                'Create the **`PAGE` mount** with a `path` (letters, digits, `_` and `-`; up to 4 segments) and its `auth`/`minLevel`. Its content is ordinary declarative UI: [`PAGE_HEADER`](/docs/extension-ui/page-header), [`KPI_CARD`](/docs/extension-ui/kpi-card), [`CHART`](/docs/extension-ui/chart) and [`TABLE`](/docs/extension-ui/table).'),
            T(lang, '**Carga los datos** con `onLoad` + `CALL_BACKEND` (`resultKey`). Lee `state.$loading.<función>` y `state.$error.<función>` para los estados de carga y error, y reutiliza la misma acción en `onRetry`.',
                '**Load the data** with `onLoad` + `CALL_BACKEND` (`resultKey`). Read `state.$loading.<function>` and `state.$error.<function>` for the loading and error states, and reuse the same action in `onRetry`.'),
            T(lang, '**(Opcional) Añade la ruta de la insignia** en `backendRoutes`: una ruta `GET` con `auth` `session` o `admin` que devuelve un número.',
                '**(Optional) Add the badge route** in `backendRoutes`: a `GET` route with `auth` `session` or `admin` that returns a number.'),
            T(lang, '**Añade `navEntries`** con `target: "page:<path>"`. La entrada hereda `auth`/`minLevel` de la página y el validador rechaza una entrada menos restrictiva.',
                '**Add `navEntries`** with `target: "page:<path>"`. The entry inherits `auth`/`minLevel` from the page and the validator rejects an entry that is less restrictive.'),
            T(lang, '**Valida y prueba**: `npm run validate` en `bloomx-extensions` y el [playground](/docs/extension-tools) (acepta el manifest completo y muestra las capacidades que exige).',
                '**Validate and test**: `npm run validate` in `bloomx-extensions` and the [playground](/docs/extension-tools) (it accepts the full manifest and shows the capabilities it requires).'),
        ] },
        { t: 'h2', id: 'manifest', text: T(lang, 'El manifest completo', 'The complete manifest') },
        { t: 'code', lang: 'json', title: 'manifest.json', code: manifest },
        { t: 'code', lang: 'js', title: 'server.js', code: server },
        { t: 'p', text: T(lang,
            'Este manifest se valida en las pruebas con el mismo validador que usa la aplicación. Los ejemplos reales siguen el mismo patrón y están en `bloomx-extensions`.',
            'This manifest is validated in the tests with the same validator the app uses. The real examples follow the same pattern and live in `bloomx-extensions`.') },
        { t: 'h2', id: 'real-examples', text: T(lang, 'Ejemplos reales del repositorio', 'Real repository examples') },
        { t: 'ul', items: [
            T(lang, '`core-domain-metrics` (`domain-metrics/`): panel de administración de solo lectura en `/admin/x/metrics` (también `/extensions/metrics`). Página `metrics` con `auth: "admin"` y `minLevel: 1`; entrada en la sección `admin` con insignia (`/badge`). Lee datos con `services.stats`, que exige el permiso `READ_STATS` y un usuario administrador.',
                '`core-domain-metrics` (`domain-metrics/`): read-only administration dashboard at `/admin/x/metrics` (also `/extensions/metrics`). Page `metrics` with `auth: "admin"` and `minLevel: 1`; entry in the `admin` section with a badge (`/badge`). It reads data through `services.stats`, which requires the `READ_STATS` permission and an administrator user.'),
            T(lang, '`core-quick-notes` (`quick-notes/`): CRUD de notas en `/extensions/notes`. Página `notes` con sesión normal; entrada en `workspace`, sin insignia. Tope de 50 notas por usuario.',
                '`core-quick-notes` (`quick-notes/`): notes CRUD at `/extensions/notes`. Page `notes` with a normal session; entry in `workspace`, no badge. Cap of 50 notes per user.'),
            T(lang, 'Cada uno tiene `manifest.src.mjs` (fuente con los helpers del SDK), `manifest.json` (generado) y `server.js`. Fragmentos exactos de los `manifest.src.mjs`:',
                'Each has a `manifest.src.mjs` (source with the SDK helpers), a generated `manifest.json` and a `server.js`. Exact fragments of the `manifest.src.mjs` files:'),
        ] },
        ...EXAMPLE_FRAGMENTS.map((fr): Block => ({ t: 'code', lang: 'js', title: `${fr.title} (${fr.file})`, code: fr.code })),
        { t: 'h2', id: 'sections', text: T(lang, 'Secciones', 'Sections') },
        { t: 'table', head: T(lang, 'Sección|Dónde aparece|Quién la ve', 'Section|Where it appears|Who sees it').split('|'), rows: sectionRows(lang) },
        { t: 'p', text: T(lang,
            'En `main` y `workspace` las entradas se añaden a las carpetas y al espacio de trabajo, y `tools` crea la sección «Herramientas». Se respetan las preferencias de orden y plegado del usuario. Dentro de una sección, el orden es `order` (menor primero, 0-1000, por defecto 100).',
            'In `main` and `workspace` the entries are added to the folders and the workspace, and `tools` creates the "Tools" section. The user\'s order and collapse preferences are respected. Inside a section the order is `order` (lowest first, 0-1000, default 100).') },
        { t: 'h2', id: 'entry-fields', text: T(lang, 'Campos de una entrada', 'Entry fields') },
        { t: 'table', head: T(lang, 'Campo|Descripción', 'Field|Description').split('|'), rows: [
            ['`id`', T(lang, 'Único dentro de la extensión: `[a-z0-9-]`, máximo 40.', 'Unique inside the extension: `[a-z0-9-]`, max 40.')],
            ['`section`', '`main` `workspace` `tools` `admin`'],
            ['`label`', T(lang, `Texto o \`{ "es": ..., "en": ... }\`, de 1 a ${NAV_LIMITS.maxLabel} caracteres, sin HTML ni saltos de línea.`, `Text or \`{ "es": ..., "en": ... }\`, 1 to ${NAV_LIMITS.maxLabel} characters, no HTML or line breaks.`)],
            ['`icon`', T(lang, 'Nombre Lucide, `lucide:<Nombre>`, `brand:<slug>` o `initials:<XY>`.', 'Lucide name, `lucide:<Name>`, `brand:<slug>` or `initials:<XY>`.')],
            ['`order`', T(lang, `Entero 0-${NAV_LIMITS.maxOrder}.`, `Integer 0-${NAV_LIMITS.maxOrder}.`)],
            ['`target`', T(lang, '`page:<path>` (o `/extensions/<path>`): el `path` de un mount `PAGE` de la propia extensión. No admite URLs externas ni páginas públicas (`auth: "none"`).', '`page:<path>` (or `/extensions/<path>`): the `path` of a `PAGE` mount of the extension itself. No external URLs or public pages (`auth: "none"`).')],
            ['`badge`', T(lang, '`{ route, refreshSeconds }`: ver más abajo.', '`{ route, refreshSeconds }`: see below.')],
            ['`auth` / `minLevel`', T(lang, 'Heredados de la página; solo pueden igualarla o endurecerla.', 'Inherited from the page; they can only match or tighten it.')],
            ['`mobile`', T(lang, '`false` la oculta en el menú móvil.', '`false` hides it in the mobile menu.')],
        ] },
        { t: 'h2', id: 'badge', text: T(lang, 'Insignia numérica', 'Numeric badge') },
        { t: 'ul', items: [
            T(lang, 'La ruta debe estar declarada en `backendRoutes`, admitir `GET` y tener `auth: "session"` o `"admin"` (la llama el navegador con la sesión del usuario). En una entrada de administración debe ser `"admin"`.',
                'The route must be declared in `backendRoutes`, accept `GET` and have `auth: "session"` or `"admin"` (the browser calls it with the user session). For an admin entry it must be `"admin"`.'),
            T(lang, `Devuelve un número o \`{ "count": n }\`. Se muestra hasta ${NAV_LIMITS.maxBadge} (a partir de ahí, «${NAV_LIMITS.maxBadge}+»); un valor no numérico o un error simplemente no muestra insignia.`,
                `It returns a number or \`{ "count": n }\`. It is shown up to ${NAV_LIMITS.maxBadge} (above that, "${NAV_LIMITS.maxBadge}+"); a non-numeric value or an error just shows no badge.`),
            T(lang, `\`refreshSeconds\` va de ${NAV_LIMITS.minRefreshSeconds} s a ${NAV_LIMITS.maxRefreshSeconds} s (1 h); por defecto ${NAV_LIMITS.defaultRefreshSeconds} s. El refresco está acotado a propósito: no uses la insignia para datos en tiempo real.`,
                `\`refreshSeconds\` ranges from ${NAV_LIMITS.minRefreshSeconds} s to ${NAV_LIMITS.maxRefreshSeconds} s (1 h); default ${NAV_LIMITS.defaultRefreshSeconds} s. The refresh is bounded on purpose: do not use the badge for real-time data.`),
            T(lang, 'Si la ruta exige un `minLevel` mayor que el de la entrada, el validador avisa: la insignia no aparecería para los niveles intermedios.',
                'If the route requires a higher `minLevel` than the entry, the validator warns: the badge would not appear for the levels in between.'),
        ] },
        { t: 'h2', id: 'security', text: T(lang, 'Seguridad: ocultar no es el control', 'Security: hiding is not the control') },
        { t: 'callout', kind: 'danger', title: T(lang, 'Regla', 'Rule'), text: T(lang,
            'Ocultar una entrada **no protege** la página. El control está en el servidor: la página conserva su `auth: "admin"`/`minLevel` (se comprueba en `/api/expansions/page-access`) y sus `CALL_BACKEND` y la ruta de la insignia se protegen por nivel.',
            'Hiding an entry does **not protect** the page. The control is on the server: the page keeps its `auth: "admin"`/`minLevel` (checked in `/api/expansions/page-access`) and its `CALL_BACKEND` calls and the badge route are protected by level.') },
        { t: 'ul', items: [
            T(lang, 'La configuración que recibe el navegador (`/api/config`) **ya no incluye** las entradas ni las páginas de administración que el nivel del usuario no alcanza.',
                'The configuration the browser receives (`/api/config`) **no longer includes** the admin entries and pages that the user\'s level does not reach.'),
            T(lang, 'Falla cerrado: la sección `admin` exige `auth: "admin"`; la entrada no puede ser más permisiva que su página (ni `auth` `session` sobre una página `admin`, ni un `minLevel` menor). El validador lo rechaza al publicar y al cargar.',
                'It fails closed: the `admin` section requires `auth: "admin"`; the entry cannot be more permissive than its page (neither `session` over an `admin` page nor a lower `minLevel`). The validator rejects it on publish and on load.'),
            T(lang, 'Las funciones de `api.functions` siguen validando sus argumentos y permisos: la página es solo la interfaz.',
                'The `api.functions` handlers still validate their arguments and permissions: the page is only the interface.'),
        ] },
        { t: 'h2', id: 'urls', text: T(lang, 'URLs finales', 'Final URLs') },
        { t: 'table', head: T(lang, 'Página|URL', 'Page|URL').split('|'), rows: [
            [T(lang, 'Cualquier mount `PAGE`', 'Any `PAGE` mount'), '`/extensions/<path>`'],
            [T(lang, 'Páginas de la sección `admin`, además, dentro de la consola', 'Pages of the `admin` section, also inside the console'), '`/admin/x/<path>`'],
            [T(lang, 'Ejemplo de esta guía', 'This guide\'s example'), '`/extensions/metrics` · `/admin/x/metrics`'],
        ] },
        { t: 'h2', id: 'states', text: T(lang, 'Estados de la entrada', 'Entry states') },
        { t: 'table', head: T(lang, 'Situación|Resultado', 'Situation|Result').split('|'), rows: [
            [T(lang, 'Extensión desactivada por el usuario', 'Extension disabled by the user'), T(lang, 'No aparece.', 'Not shown.')],
            [T(lang, 'No está en `/api/config` (desinstalada, pausada por dependencias o versión incompatible)', 'Not in `/api/config` (uninstalled, paused by dependencies or incompatible version)'), T(lang, 'No aparece.', 'Not shown.')],
            [T(lang, 'Bloqueada por IA o por una dependencia', 'Blocked by AI or by a dependency'), T(lang, 'Aparece **deshabilitada** con el motivo.', 'Shown **disabled** with the reason.')],
            [T(lang, 'Nivel insuficiente (admin)', 'Insufficient level (admin)'), T(lang, 'No llega al navegador.', 'Never reaches the browser.')],
        ] },
        { t: 'h2', id: 'mobile', text: T(lang, 'Móvil y accesibilidad', 'Mobile and accessibility') },
        { t: 'ul', items: [
            T(lang, 'El menú móvil es la misma barra lateral en un cajón; `mobile: false` oculta la entrada ahí (sigue en escritorio).',
                'The mobile menu is the same sidebar in a drawer; `mobile: false` hides the entry there (it stays on desktop).'),
            T(lang, 'Las entradas son enlaces reales con nombre accesible; la insignia se anuncia como parte del nombre y las deshabilitadas indican el motivo. Los componentes de página son accesibles por teclado: árbol WAI-ARIA, divisor redimensionable con flechas, tooltips de gráficos con foco y leyendas operables.',
                'Entries are real links with an accessible name; the badge is announced as part of the name and disabled ones give the reason. Page components are keyboard accessible: WAI-ARIA tree, arrow-resizable divider, focusable chart tooltips and operable legends.'),
            T(lang, 'Las páginas se adaptan: `SPLIT_PANE` se apila en pantallas estrechas y `PAGE_HEADER` baja las acciones debajo del título.',
                'Pages adapt: `SPLIT_PANE` stacks on narrow screens and `PAGE_HEADER` moves the actions below the title.'),
        ] },
        { t: 'h2', id: 'limits', text: T(lang, 'Límites y compatibilidad', 'Limits and compatibility') },
        { t: 'ul', items: [
            T(lang, `Máximo **${NAV_LIMITS.maxEntries}** entradas por extensión, etiquetas de hasta **${NAV_LIMITS.maxLabel}** caracteres, \`order\` hasta ${NAV_LIMITS.maxOrder}, insignia hasta ${NAV_LIMITS.maxBadge}+.`,
                `At most **${NAV_LIMITS.maxEntries}** entries per extension, labels up to **${NAV_LIMITS.maxLabel}** characters, \`order\` up to ${NAV_LIMITS.maxOrder}, badge up to ${NAV_LIMITS.maxBadge}+.`),
            T(lang, 'Una entrada solo enlaza páginas de **su propia extensión**; no hay enlaces externos ni entradas sin página.',
                'An entry only links pages of **its own extension**; there are no external links or entries without a page.'),
            T(lang, '**Compatibilidad**: los componentes de página y la `TABLE` avanzada exigen `ui.pages.v1`; `navEntries` exige `nav.entries.v1`. Los clientes antiguos **no reciben** versiones con estas capacidades: el backend sirve a cada instancia la versión más alta cuyos requisitos cumple, así que ven la versión anterior de la extensión (o ninguna).',
                '**Compatibility**: page components and the advanced `TABLE` require `ui.pages.v1`; `navEntries` requires `nav.entries.v1`. Old clients **do not receive** versions with these capabilities: the backend serves each instance the highest version whose requirements it meets, so they see the previous version of the extension (or none).'),
        ] },
        { t: 'p', text: T(lang,
            'Siguientes lecturas: el [kit de componentes](/docs/extension-ui) (incluida la sección de componentes de página completa), [Crear una extensión](/docs/create-extension) y [Extensiones](/docs/expansions).',
            'Further reading: the [component kit](/docs/extension-ui) (including the full-page components section), [Build an extension](/docs/create-extension) and [Extensions](/docs/expansions).') },
    ];
};

const page: DocPageContent = { es: blocks('es'), en: blocks('en') };

export default page;
