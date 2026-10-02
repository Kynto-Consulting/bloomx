import type { Block, DocPageContent } from '../types';
import { iconBlocks } from '../icon-docs';
import { GAPS, TONES, UI_ACTIONS, UI_COMPONENTS, PAGE_UI_COMPONENTS, UI_LIMITS, type PropSpec } from '@/lib/expansions/ui-schema';
import { EN_DOC, KIT_CATEGORIES as CATEGORIES, kitHref } from '../ui-kit/kit';

/**
 * Kit de componentes de extensiones. Las tablas del catalogo se GENERAN desde ui-schema.ts: la documentacion no
 * puede quedar desfasada respecto al schema que valida y al renderer que pinta.
 */

function shortProp(name: string, spec: PropSpec): string {
    if (spec.k === 'enum' && spec.values) {
        const values = spec.values.length > 7 ? `${spec.values.slice(0, 6).join('|')}|…` : spec.values.join('|');
        return `${name}(${values})`;
    }
    if (spec.k === 'action') return `${name}*`;
    return name;
}

function catalogBlocks(locale: 'es' | 'en'): Block[] {
    const out: Block[] = [];
    for (const category of CATEGORIES) {
        const rows = Object.entries(UI_COMPONENTS)
            .filter(([, spec]) => spec.category === category.id)
            .map(([type, spec]) => [
                `[\`${type}\`](${kitHref(type)})`,
                locale === 'es' ? spec.doc : (EN_DOC[type] ?? spec.doc),
                Object.entries(spec.props).map(([name, prop]) => shortProp(name, prop)).map((p) => `\`${p}\``).join(' ') || '—',
            ]);
        if (rows.length === 0) continue;
        out.push({ t: 'h3', id: `cat-${category.id}`, text: category[locale] });
        out.push({
            t: 'table',
            head: locale === 'es' ? ['Componente', 'Qué es', 'Props (enums entre paréntesis; `*` = acción)'] : ['Component', 'What it is', 'Props (enums in brackets; `*` = action)'],
            rows,
        });
    }
    return out;
}

/** Componentes de pagina completa (PAGE_UI_COMPONENTS, capacidad ui.pages.v1): la lista sale del esquema; el texto es manual. */
function pageComponentBlocks(locale: 'es' | 'en'): Block[] {
    const es = locale === 'es';
    const rows = PAGE_UI_COMPONENTS.filter((t) => UI_COMPONENTS[t]).map((t) => [`[\`${t}\`](${kitHref(t)})`, es ? UI_COMPONENTS[t].doc : (EN_DOC[t] ?? UI_COMPONENTS[t].doc)]);
    return [
        { t: 'h2', id: 'page-components', text: es ? 'Componentes de página completa' : 'Full-page components' },
        { t: 'p', text: es
            ? 'Pensados para un mount `PAGE` (una página completa en `/extensions/<path>`). Cada uno tiene su página con vista previa y simulador con datos simulados (sin backend real). **Exigen la capacidad `ui.pages.v1`** en `requires.capabilities`; los clientes antiguos no reciben esas versiones.'
            : 'Designed for a `PAGE` mount (a full page at `/extensions/<path>`). Each has its own page with a preview and a simulator with mock data (no real backend). **They require the `ui.pages.v1` capability** in `requires.capabilities`; old clients do not receive those versions.' },
        { t: 'table', head: es ? ['Componente', 'Qué es'] : ['Component', 'What it is'], rows },
        { t: 'p', text: es
            ? 'La [`TABLE`](/docs/extension-ui/table) también ganó, con la misma capacidad: `searchable`, filtros por columna (`columns[].filter`), celdas `link` y `status` (`toneMap`, `hrefKey`), `bulkActions`, `defaultSort` y los estados `error` + `onRetry`.'
            : 'The [`TABLE`](/docs/extension-ui/table) also gained, with the same capability: `searchable`, column filters (`columns[].filter`), `link` and `status` cells (`toneMap`, `hrefKey`), `bulkActions`, `defaultSort` and the `error` + `onRetry` states.' },
        { t: 'callout', kind: 'note', title: es ? 'No se duplican' : 'Not duplicated', text: es
            ? 'Ya existían y se reutilizan: [`SECTION`](/docs/extension-ui/section) (plegable), [`TABS`](/docs/extension-ui/tabs), [`WIZARD`](/docs/extension-ui/wizard), [`DRAWER`](/docs/extension-ui/drawer), [`EMPTY`](/docs/extension-ui/empty) (alias `EMPTY_STATE`), [`PROGRESS`](/docs/extension-ui/progress), [`AVATAR`](/docs/extension-ui/avatar), [`BADGE`](/docs/extension-ui/badge), [`ALERT`](/docs/extension-ui/alert), [`CODE`](/docs/extension-ui/code) (alias `CODE_BLOCK`), [`MARKDOWN`](/docs/extension-ui/markdown) (seguro, sin HTML) y `DATA_TABLE` (alias de `TABLE`).'
            : 'These already existed and are reused: [`SECTION`](/docs/extension-ui/section) (collapsible), [`TABS`](/docs/extension-ui/tabs), [`WIZARD`](/docs/extension-ui/wizard), [`DRAWER`](/docs/extension-ui/drawer), [`EMPTY`](/docs/extension-ui/empty) (alias `EMPTY_STATE`), [`PROGRESS`](/docs/extension-ui/progress), [`AVATAR`](/docs/extension-ui/avatar), [`BADGE`](/docs/extension-ui/badge), [`ALERT`](/docs/extension-ui/alert), [`CODE`](/docs/extension-ui/code) (alias `CODE_BLOCK`), [`MARKDOWN`](/docs/extension-ui/markdown) (safe, no HTML) and `DATA_TABLE` (alias of `TABLE`).' },
        { t: 'p', text: es
            ? 'Para construir una página completa y enlazarla desde la navegación, sigue [Página completa y navegación](/docs/extension-pages).'
            : 'To build a full page and link it from the navigation, follow [Full page and navigation](/docs/extension-pages).' },
    ];
}

function actionRows(): string[][] {
    return Object.entries(UI_ACTIONS).map(([name, spec]) => [
        `\`${name}\``,
        (spec.required ?? []).map((r) => `\`${r}\``).join(' ') || '—',
        Object.keys(spec.props).filter((k) => !(spec.required ?? []).includes(k)).map((k) => `\`${k}\``).join(' ') || '—',
    ]);
}

const example = `{
  "type": "STACK",
  "props": { "gap": 3 },
  "children": [
    { "type": "HEADING", "props": { "level": 3, "content": "Nueva nota" } },
    { "type": "FORM", "props": {
        "submitLabel": "Guardar",
        "successMessage": "Guardado",
        "fields": [
          { "name": "title", "label": "Título", "required": true, "rules": { "maxLength": 80 } },
          { "name": "tags", "label": "Etiquetas", "type": "tags" }
        ],
        "onSubmit": { "action": "CALL_BACKEND", "function": "saveNote",
                      "retry": { "attempts": 3, "delayMs": 400 } } } },
    { "type": "ALERT", "props": { "tone": "danger", "message": "\${state.$error.saveNote}", "hidden": "\${!state.$error.saveNote}" } }
  ]
}`;

const exampleEn = example.replace('Nueva nota', 'New note').replace('Guardar', 'Save').replace('Guardado', 'Saved').replace('Título', 'Title').replace('Etiquetas', 'Tags');

const statefulExample = `{
  "state": { "query": "", "rows": [] },
  "mounts": [{ "point": "PAGE", "path": "notas", "component": {
    "type": "STACK", "children": [
      { "type": "INPUT", "props": { "label": "Buscar", "type": "search", "bind": "query" } },
      { "type": "BUTTON", "props": { "label": "Buscar",
          "onClick": { "action": "CALL_BACKEND", "function": "search", "args": { "q": "\${state.query}" },
                       "resultKey": "rows" } } },
      { "type": "TABLE", "props": { "rows": "\${state.rows}", "columns": [ { "key": "title", "label": "Título", "sortable": true } ],
                                     "loading": "\${state.$loading.search}", "pageSize": 10 } }
    ] } }]
}`;

const statefulExampleEn = statefulExample.replace('Buscar', 'Search').replace('Buscar', 'Search').replace('Título', 'Title');

const limits = `maxNodes ${UI_LIMITS.maxNodes} · maxDepth ${UI_LIMITS.maxDepth} · maxString ${UI_LIMITS.maxString} · maxArray ${UI_LIMITS.maxArray} · maxBytes ${UI_LIMITS.maxBytes}`;

const page: DocPageContent = {
    es: [
        { t: 'p', text: 'Las extensiones describen su interfaz como **JSON** (`{ "type", "props", "children" }`). BloomX lo dibuja con un **kit de componentes** propio que hereda, sin que la extensión haga nada, la **paleta, el radio, la tipografía y el modo claro/oscuro de la empresa**. Esta página es la referencia de componentes, tematización, estado, expresiones y acciones; las herramientas para escribirlos y probarlos están en [Herramientas de extensiones](/docs/extension-tools).' },
        { t: 'h2', id: 'components', text: 'Un componente, una página' },
        { t: 'p', text: 'Cada componente del kit tiene su **página propia** (`/docs/extension-ui/<componente>`, por ejemplo [`BUTTON`](/docs/extension-ui/button), [`FORM`](/docs/extension-ui/form) o [`TABLE`](/docs/extension-ui/table)) con la tabla de props generada del esquema, vista previa en vivo con el renderer real, un **simulador** (editor de props, validación, estado, contexto, backend simulado y registro de eventos) y un ejemplo tomado de un manifest real. El índice de abajo agrupa todos por categoría.' },
        { t: 'kit-index' },
        ...pageComponentBlocks('es'),
        { t: 'h2', id: 'theming', text: 'Reglas de tematización' },
        { t: 'p', text: 'Regla clave: **una extensión no elige colores ni estilos**. Solo usa propiedades semánticas y el renderer las traduce a los tokens del tema activo (`bg-primary`, `text-success`, `border-destructive`...), con el contraste exigido por el contrato de temas ([Temas empresariales](/docs/themes)).' },
        { t: 'table', head: ['Propiedad', 'Valores', 'Uso'], rows: [
            ['`tone`', TONES.map((t) => `\`${t}\``).join(' '), 'Intención: color de marca, éxito, aviso, peligro, información o neutro'],
            ['`variant`', '`solid` `soft` `outline` `ghost` `link` (botones) · `solid` `soft` `outline` (badges)', 'Aspecto de la superficie'],
            ['`size`', '`xs` `sm` `md` `lg` `xl`', 'Tamaño en escala (botones, iconos, avatares, campos)'],
            ['`density`', '`compact` `comfortable` `spacious`', 'Relleno de tarjetas y filas de tablas'],
            ['`align` / `justify`', '`start` `center` `end` `stretch` · `between` `around`', 'Alineación en layouts'],
            ['`gap` / `padding` / `spacing`', GAPS.map((g) => `\`${g}\``).join(' '), 'Escala de 4 px (0, 4, 8, 12, 16, 20, 24, 32, 40, 48 px)'],
            ['`width`', '`sm` `md` `lg` `xl` `full`', 'Ancho de modales y paneles'],
        ] },
        { t: 'callout', kind: 'danger', title: 'Lo que se rechaza', text: 'Cualquier `className`, `style`, `color`, `bg`, `border`, `shadow`, `html`, `dangerouslySetInnerHTML`, evento DOM (`onclick`...), `url()`, HTML en textos o color hex en una prop semántica. El validador lo marca como **error** con su ruta; en ejecución se **elimina con aviso** (nunca llega al DOM). [`COLOR_PICKER`](/docs/extension-ui/color-picker) solo maneja un hex como **dato** del usuario (etiquetas, agendas), nunca estiliza la interfaz.' },
        { t: 'ul', items: [
            '**Contraste garantizado**: cada par texto/fondo que pinta el kit está declarado y un test lo comprueba en los 8 temas genéricos y en las paletas de empresa de prueba (claro y oscuro). Las superficies "suaves" usan la pareja `card`/`card-foreground` con borde de la intención, no tintes translucidos que podrían bajar de 4.5:1.',
            '**Valores inválidos no rompen**: un `tone` desconocido, un `gap` fuera de escala o un texto donde se espera un número se corrigen al valor por defecto en ejecución y se avisan en el validador.',
            '**Accesible por defecto**: roles ARIA, nombres accesibles, foco visible, teclado (flechas, Enter, Espacio, Escape) y foco atrapado en diálogos.',
        ] },
        { t: 'h2', id: 'example', text: 'Un ejemplo completo' },
        { t: 'code', lang: 'json', title: 'Formulario con validación, reintento y error', code: example },
        { t: 'h2', id: 'catalog', text: 'Catálogo de componentes' },
        { t: 'p', text: 'Generado desde `ui-schema.ts`. Todas las props admiten expresiones `${...}` salvo las de tipo nodo o acción. Cada componente admite además `hidden` (expresión booleana), `onLoad`, `onLoadWhen` y `ariaLabel`. La [galería de componentes](/docs/extension-tools#gallery) los muestra en vivo con ejemplos copiables y en todos los temas.' },
        ...catalogBlocks('es'),
        { t: 'h2', id: 'state', text: 'Estado y binding' },
        { t: 'ul', items: [
            '`state` del manifest define el valor inicial; cada mount y cada overlay tiene su propio estado. Lee con `${state.a.b}` y escribe con `SET_STATE` (`key` admite rutas `"a.b"`).',
            '**Binding bidireccional**: `bind: "form.email"` en cualquier entrada lee y escribe `state.form.email`; `defaultValue` se aplica una vez si aún no hay valor; `onChange` recibe `value`.',
            'Dentro de un [`FORM`](/docs/extension-ui/form), las entradas con `name` se registran solas: validan al enviar y sus valores viajan en `formData`.',
            '**Carga y error automáticos**: `CALL_BACKEND`/`CALL_API` mantienen `state.$loading.<clave>` y `state.$error.<clave>` (la clave es `key` o el nombre de la función). Un [`BUTTON`](/docs/extension-ui/button) cuyo `onClick` llama al backend muestra solo su carga, se bloquea y evita el doble envío; un [`FORM`](/docs/extension-ui/form) muestra cargando, el error del backend y `successMessage`.',
        ] },
        { t: 'code', lang: 'json', title: 'Estado inicial, bind, resultKey y carga', code: statefulExample },
        { t: 'h2', id: 'expressions', text: 'Expresiones' },
        { t: 'p', text: "Las cadenas `${...}` se evalúan **sin `eval`** con un lenguaje pequeño (los argumentos de filtro son expresiones: los textos van **entre comillas**, como `pluck:'id'`; un identificador suelto es una variable): literales, `context.x`, `state.x`, variables del evento (`value`, `result`, `formData`, `row`, `error`, `item`), acceso `a.b`, `a?.b`, `a[0]`, operadores `+ - * / % == != < > <= >= && || ! ?:` y filtros con `|`. **No se pueden llamar funciones** ni salir del alcance dado." },
        { t: 'table', head: ['Filtros', 'Ejemplo'], rows: [
            ["`truncate:N` `upper` `lower` `trim` `capitalize` `replace:'a':'b'` `split:','`", '`${context.subject | truncate:40}`'],
            ["`length` `first` `last` `slice:a:b` `join:', '` `includes:x` `pluck:'clave'` `sum` `keys`", "`${state.rows | pluck:'id' | join:', '}`"],
            ['`round:N` `floor` `ceil` `abs` `number` `date` `datetime`', '`${result.total | round:2}`'],
            ["`default:'x'` `yesno:'si':'no'` `plural:'uno':'otros'` `not` `json`", "`${state.n | plural:'mensaje':'mensajes'}`"],
        ] },
        { t: 'p', text: '`||` devuelve el primer valor **no vacío** (el valor indefinido, `null` y la cadena vacía son vacíos; `0` y `false` no). Una expresión inválida produce vacío en ejecución y un **error con ruta y posición** en el validador (`checkExpression`).' },
        { t: 'h2', id: 'actions', text: 'Acciones' },
        { t: 'p', text: 'Una acción es `{ "action": "NOMBRE", ... }`, un arreglo o `{ "actions": [...] }`; se ejecutan **en orden** y cada paso ve el estado de los anteriores. `onSuccess` recibe `result`; `onError` recibe `error`. Sin `onError`, un fallo muestra un aviso con el motivo (`toastOnError: false` lo silencia) y se registra para el autor.' },
        { t: 'table', head: ['Acción', 'Obligatorios', 'Opcionales'], rows: actionRows() },
        { t: 'h3', id: 'call-backend', text: 'CALL_BACKEND: reintento y resultado' },
        { t: 'ul', items: [
            '`retry: { attempts: 1-5, delayMs: 0-10000, backoff: "none"|"linear"|"exponential" }` reintenta ante error de red o `success:false`.',
            '`resultKey` guarda el resultado en `state[resultKey]`; `args` gana sobre los campos del formulario que disparó la acción.',
            '`NAVIGATE` solo admite rutas internas (`/...`), `OPEN_URL` solo `https`/`http`/`mailto`/`tel`, `CALL_API` solo rutas del propio origen. El resto se bloquea con un aviso claro.',
            '`CONFIRM` abre un diálogo accesible y encadena `onConfirm` / `onCancel`.',
        ] },
        { t: 'h2', id: 'validation', text: 'Validación y errores' },
        { t: 'ul', items: [
            'Antes de pintar, `ExtensionLoader` valida el manifest y el UI. Un mount con errores se sustituye por un **estado de error amable** (el resto de la extensión y de la aplicación siguen funcionando) y el problema se **registra para el autor**: lo ves en [/extensions](/docs/extension-tools#manage) (errores de ejecución por extensión) y en la consola.',
            'Los errores llevan la ruta exacta: `mounts[0].component.children[2].props.tone: Valor no permitido "sucsess"; permitidos: neutral, primary, ... (¿quisiste decir success?)`.',
            `Límites duros por UI: ${limits}.`,
            'Formularios: `rules` admite `required`, `minLength`, `maxLength`, `min`, `max`, `minItems`, `maxItems`, `pattern`, `email`, `url` y `message` (sustituye al texto genérico). `validateOn`: `submit`, `blur` (por defecto) o `change`. Los patrones con cuantificadores anidados se rechazan.',
        ] },
        { t: 'h2', id: 'legacy', text: 'Formato antiguo y migración' },
        { t: 'p', text: 'Los manifests existentes siguen funcionando: `migrateLegacyUi` los adapta al cargar y avisa de lo obsoleto (sin tocar el manifest). Conviene migrarlos con el botón **Migrar** del playground o con el validador.' },
        { t: 'table', head: ['Antes', 'Ahora'], rows: [
            ['`COLUMN`, `FLEX`, `BOX`, `BLOCK`', '`STACK` / `ROW` con `gap`, `align`, `justify`'],
            ['`SEPARATOR`, `EMPTY_STATE`, `DATA_TABLE`, `CODE_BLOCK`, `FILE_UPLOAD`, `CODE_EDITOR`', '`DIVIDER`, `EMPTY`, `TABLE`, `CODE`, `FILE_INPUT`, `TEXTAREA` (con `mono`)'],
            ['`BUTTON` `variant: "primary"|"secondary"|"destructive"`', '`tone` + `variant` (`solid` `soft` `outline` `ghost` `link`)'],
            ['`BUTTON` con `menuOptions`', '[`MENU`](/docs/extension-ui/menu) con `items`'],
            ['`TEXT variant: "error"|"success"|"h4"|"body"`', '`ALERT tone` · `HEADING` · `TEXT variant: "quote"`'],
            ['`ALERT variant`, `BADGE variant`', '`tone` (+ `variant` de superficie)'],
            ['`bindTo`, `INPUT multiline`', '`bind`, `TEXTAREA`'],
            ['`TABS`/`ACCORDION` con hijos `TAB_ITEM`/`ACCORDION_ITEM`', '`tabs` / `sections` con `content`'],
            ['`className`, `style`, `color`, `bg`...', 'Se eliminan con aviso: usa `tone`, `variant`, `size`, `gap`'],
            ['`IFRAME` (HTML en una prop)', 'Ya no se admite: usa `MARKDOWN` o componentes'],
        ] },
        ...iconBlocks(true),
        { t: 'callout', kind: 'note', title: 'Límites', text: 'El HTML sigue siendo texto: [`MARKDOWN`](/docs/extension-ui/markdown) solo admite un subconjunto (negrita, cursiva, código, listas, encabezados, enlaces seguros). Los gráficos son SVG propios sin ejes complejos ni animaciones. [`CONTACT_PICKER`](/docs/extension-ui/contact-picker) usa la libreta del usuario (`/api/contacts/suggestions`). El backend compartido valida el manifest pero **aún no** valida el UI al publicar: la comprobación de UI la hacen el validador CLI y el frontend al cargar.' },
    ],
    en: [
        { t: 'p', text: 'Extensions describe their interface as **JSON** (`{ "type", "props", "children" }`). BloomX draws it with its own **component kit**, which inherits — with nothing for the extension to do — the company **palette, radius, typography and light/dark mode**. This page is the reference for components, theming, state, expressions and actions; the tools to write and test them are in [Extension tools](/docs/extension-tools).' },
        { t: 'h2', id: 'components', text: 'One component, one page' },
        { t: 'p', text: 'Every kit component has its **own page** (`/docs/extension-ui/<component>`, for example [`BUTTON`](/docs/extension-ui/button), [`FORM`](/docs/extension-ui/form) or [`TABLE`](/docs/extension-ui/table)) with the props table generated from the schema, a live preview using the real renderer, a **simulator** (props editor, validation, state, context, simulated backend and event log) and an example taken from a real manifest. The index below groups them all by category.' },
        { t: 'kit-index' },
        ...pageComponentBlocks('en'),
        { t: 'h2', id: 'theming', text: 'Theming rules' },
        { t: 'p', text: 'Key rule: **an extension does not choose colours or styles**. It only uses semantic properties and the renderer maps them to the active theme tokens (`bg-primary`, `text-success`, `border-destructive`...) with the contrast required by the theme contract ([Enterprise themes](/docs/themes)).' },
        { t: 'table', head: ['Property', 'Values', 'Use'], rows: [
            ['`tone`', TONES.map((t) => `\`${t}\``).join(' '), 'Intent: brand colour, success, warning, danger, information or neutral'],
            ['`variant`', '`solid` `soft` `outline` `ghost` `link` (buttons) · `solid` `soft` `outline` (badges)', 'Surface look'],
            ['`size`', '`xs` `sm` `md` `lg` `xl`', 'Scale size (buttons, icons, avatars, fields)'],
            ['`density`', '`compact` `comfortable` `spacious`', 'Padding of cards and table rows'],
            ['`align` / `justify`', '`start` `center` `end` `stretch` · `between` `around`', 'Alignment in layouts'],
            ['`gap` / `padding` / `spacing`', GAPS.map((g) => `\`${g}\``).join(' '), '4 px scale (0, 4, 8, 12, 16, 20, 24, 32, 40, 48 px)'],
            ['`width`', '`sm` `md` `lg` `xl` `full`', 'Width of modals and panels'],
        ] },
        { t: 'callout', kind: 'danger', title: 'What is rejected', text: 'Any `className`, `style`, `color`, `bg`, `border`, `shadow`, `html`, `dangerouslySetInnerHTML`, DOM event (`onclick`...), `url()`, HTML in text or a hex colour in a semantic prop. The validator flags it as an **error** with its path; at runtime it is **dropped with a warning** (it never reaches the DOM). [`COLOR_PICKER`](/docs/extension-ui/color-picker) only handles a hex as user **data** (labels, calendars); it never styles the interface.' },
        { t: 'ul', items: [
            '**Guaranteed contrast**: every text/background pair the kit paints is declared and a test checks it on the 8 generic themes and on the test company palettes (light and dark). "Soft" surfaces use the `card`/`card-foreground` pair with an intent-coloured border, not translucent tints that could fall below 4.5:1.',
            '**Invalid values do not break anything**: an unknown `tone`, an out-of-scale `gap` or text where a number is expected fall back to the default at runtime and are reported by the validator.',
            '**Accessible by default**: ARIA roles, accessible names, visible focus, keyboard (arrows, Enter, Space, Escape) and trapped focus in dialogs.',
        ] },
        { t: 'h2', id: 'example', text: 'A complete example' },
        { t: 'code', lang: 'json', title: 'Form with validation, retry and error', code: exampleEn },
        { t: 'h2', id: 'catalog', text: 'Component catalogue' },
        { t: 'p', text: 'Generated from `ui-schema.ts`. Every prop accepts `${...}` expressions except node and action props. Every component also accepts `hidden` (boolean expression), `onLoad`, `onLoadWhen` and `ariaLabel`. The [component gallery](/docs/extension-tools#gallery) shows them live with copyable examples and in every theme.' },
        ...catalogBlocks('en'),
        { t: 'h2', id: 'state', text: 'State and binding' },
        { t: 'ul', items: [
            'The manifest `state` defines the initial value; each mount and each overlay has its own state. Read with `${state.a.b}` and write with `SET_STATE` (`key` accepts `"a.b"` paths).',
            '**Two-way binding**: `bind: "form.email"` on any input reads and writes `state.form.email`; `defaultValue` is applied once if there is no value yet; `onChange` receives `value`.',
            'Inside a [`FORM`](/docs/extension-ui/form), inputs with a `name` register themselves: they validate on submit and their values travel in `formData`.',
            '**Automatic loading and error**: `CALL_BACKEND`/`CALL_API` maintain `state.$loading.<key>` and `state.$error.<key>` (the key is `key` or the function name). A [`BUTTON`](/docs/extension-ui/button) whose `onClick` calls the backend shows only its own loading, locks and prevents double submit; a [`FORM`](/docs/extension-ui/form) shows loading, the backend error and `successMessage`.',
        ] },
        { t: 'code', lang: 'json', title: 'Initial state, bind, resultKey and loading', code: statefulExampleEn },
        { t: 'h2', id: 'expressions', text: 'Expressions' },
        { t: 'p', text: "`${...}` strings are evaluated **without `eval`** with a small language (filter arguments are expressions: text goes **in quotes**, like `pluck:'id'`; a bare identifier is a variable): literals, `context.x`, `state.x`, event variables (`value`, `result`, `formData`, `row`, `error`, `item`), access `a.b`, `a?.b`, `a[0]`, operators `+ - * / % == != < > <= >= && || ! ?:` and `|` filters. **Functions cannot be called** and nothing outside the given scope is reachable." },
        { t: 'table', head: ['Filters', 'Example'], rows: [
            ["`truncate:N` `upper` `lower` `trim` `capitalize` `replace:'a':'b'` `split:','`", '`${context.subject | truncate:40}`'],
            ["`length` `first` `last` `slice:a:b` `join:', '` `includes:x` `pluck:'key'` `sum` `keys`", "`${state.rows | pluck:'id' | join:', '}`"],
            ['`round:N` `floor` `ceil` `abs` `number` `date` `datetime`', '`${result.total | round:2}`'],
            ["`default:'x'` `yesno:'yes':'no'` `plural:'one':'many'` `not` `json`", "`${state.n | plural:'message':'messages'}`"],
        ] },
        { t: 'p', text: '`||` returns the first **non-empty** value (the undefined value, `null` and the empty string are empty; `0` and `false` are not). An invalid expression yields empty at runtime and an **error with path and position** in the validator (`checkExpression`).' },
        { t: 'h2', id: 'actions', text: 'Actions' },
        { t: 'p', text: 'An action is `{ "action": "NAME", ... }`, an array or `{ "actions": [...] }`; they run **in order** and each step sees the state left by the previous ones. `onSuccess` receives `result`; `onError` receives `error`. Without `onError`, a failure shows a notice with the reason (`toastOnError: false` silences it) and is logged for the author.' },
        { t: 'table', head: ['Action', 'Required', 'Optional'], rows: actionRows() },
        { t: 'h3', id: 'call-backend', text: 'CALL_BACKEND: retry and result' },
        { t: 'ul', items: [
            '`retry: { attempts: 1-5, delayMs: 0-10000, backoff: "none"|"linear"|"exponential" }` retries on network error or `success:false`.',
            '`resultKey` stores the result in `state[resultKey]`; `args` wins over the fields of the form that triggered the action.',
            '`NAVIGATE` only accepts internal paths (`/...`), `OPEN_URL` only `https`/`http`/`mailto`/`tel`, `CALL_API` only same-origin paths. Everything else is blocked with a clear notice.',
            '`CONFIRM` opens an accessible dialog and chains `onConfirm` / `onCancel`.',
        ] },
        { t: 'h2', id: 'validation', text: 'Validation and errors' },
        { t: 'ul', items: [
            'Before painting, `ExtensionLoader` validates the manifest and the UI. A mount with errors is replaced by a **friendly error state** (the rest of the extension and of the app keep working) and the problem is **logged for the author**: you see it in [/extensions](/docs/extension-tools#manage) (runtime errors per extension) and in the console.',
            'Errors carry the exact path: `mounts[0].component.children[2].props.tone: Value not allowed "sucsess"; allowed: neutral, primary, ... (did you mean success?)`.',
            `Hard limits per UI: ${limits}.`,
            'Forms: `rules` accepts `required`, `minLength`, `maxLength`, `min`, `max`, `minItems`, `maxItems`, `pattern`, `email`, `url` and `message` (replaces the generic text). `validateOn`: `submit`, `blur` (default) or `change`. Patterns with nested quantifiers are rejected.',
        ] },
        { t: 'h2', id: 'legacy', text: 'Legacy format and migration' },
        { t: 'p', text: 'Existing manifests keep working: `migrateLegacyUi` adapts them on load and warns about what is obsolete (without touching the manifest). Migrate them with the playground **Migrate** button or with the validator.' },
        { t: 'table', head: ['Before', 'Now'], rows: [
            ['`COLUMN`, `FLEX`, `BOX`, `BLOCK`', '`STACK` / `ROW` with `gap`, `align`, `justify`'],
            ['`SEPARATOR`, `EMPTY_STATE`, `DATA_TABLE`, `CODE_BLOCK`, `FILE_UPLOAD`, `CODE_EDITOR`', '`DIVIDER`, `EMPTY`, `TABLE`, `CODE`, `FILE_INPUT`, `TEXTAREA` (with `mono`)'],
            ['`BUTTON` `variant: "primary"|"secondary"|"destructive"`', '`tone` + `variant` (`solid` `soft` `outline` `ghost` `link`)'],
            ['`BUTTON` with `menuOptions`', '[`MENU`](/docs/extension-ui/menu) with `items`'],
            ['`TEXT variant: "error"|"success"|"h4"|"body"`', '`ALERT tone` · `HEADING` · `TEXT variant: "quote"`'],
            ['`ALERT variant`, `BADGE variant`', '`tone` (+ surface `variant`)'],
            ['`bindTo`, `INPUT multiline`', '`bind`, `TEXTAREA`'],
            ['`TABS`/`ACCORDION` with `TAB_ITEM`/`ACCORDION_ITEM` children', '`tabs` / `sections` with `content`'],
            ['`className`, `style`, `color`, `bg`...', 'Dropped with a warning: use `tone`, `variant`, `size`, `gap`'],
            ['`IFRAME` (HTML in a prop)', 'No longer supported: use `MARKDOWN` or components'],
        ] },
        ...iconBlocks(false),
        { t: 'callout', kind: 'note', title: 'Limits', text: 'HTML is still text: [`MARKDOWN`](/docs/extension-ui/markdown) only supports a subset (bold, italic, code, lists, headings, safe links). Charts are own SVG with no complex axes or animations. [`CONTACT_PICKER`](/docs/extension-ui/contact-picker) uses the user address book (`/api/contacts/suggestions`). The shared backend validates the manifest but **does not yet** validate the UI when publishing: the UI check is done by the CLI validator and by the frontend on load.' },
    ],
};

export default page;
