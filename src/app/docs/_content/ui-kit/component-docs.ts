import { COMMON_PROPS, UI_ACTIONS, UI_COMPONENTS, type PropSpec } from '@/lib/expansions/ui-schema';
import { UI_EXAMPLES } from '@/lib/expansions/ui-examples';
import { kindLabel } from '@/lib/expansions/playground/schema-docs';
import type { Locale } from '../types';
import USAGES from '../ui-usages.json';

/**
 * Documentacion de un componente DERIVADA del esquema (ui-schema.ts): tabla de props, estructuras anidadas,
 * eventos/acciones que acepta, estado y contexto que usa, acciones relacionadas y uso en manifests reales.
 * Nada se escribe a mano: si cambia un `S.*` del esquema, cambia la tabla (lo comprueba ui-kit.test.ts).
 */

export interface PropDocRow {
    /** Ruta de la prop: `label`, `items[].onClick`, `columns[].format`. */
    name: string;
    kind: PropSpec['k'];
    /** Etiqueta del tipo (texto, numero, enum, arreglo de objeto...). */
    type: string;
    required: boolean;
    /** Valores permitidos: enum, rango numerico o campos de un objeto. Vacio si no aplica. */
    values: string[];
    /** Valor por defecto (JSON) o ''. */
    def: string;
    doc: string;
    isAction: boolean;
}

const show = (value: unknown): string => JSON.stringify(value) ?? String(value);

function allowedValues(spec: PropSpec): string[] {
    if (spec.k === 'enum') return (spec.values ?? []).map((v) => show(v));
    if (spec.k === 'number' && (spec.min !== undefined || spec.max !== undefined)) return [`${spec.min ?? '-∞'} … ${spec.max ?? '∞'}`];
    if (spec.k === 'boolean') return ['true', 'false'];
    return [];
}

function rowOf(name: string, spec: PropSpec, locale: Locale): PropDocRow {
    return {
        name,
        kind: spec.k,
        type: kindLabel(spec, locale),
        required: Boolean(spec.required),
        values: allowedValues(spec),
        def: spec.def === undefined ? '' : show(spec.def),
        doc: spec.doc ?? '',
        isAction: spec.k === 'action',
    };
}

/** Estructura de un objeto (o de los elementos de un arreglo/mapa de objetos). */
function shapeOf(spec: PropSpec): Record<string, PropSpec> | undefined {
    if (spec.k === 'object') return spec.shape;
    if ((spec.k === 'array' || spec.k === 'record') && spec.of) return shapeOf(spec.of);
    return undefined;
}

/** Filas de las props del primer nivel. */
export function propDocRows(props: Record<string, PropSpec>, locale: Locale): PropDocRow[] {
    return Object.entries(props).map(([name, spec]) => rowOf(name, spec, locale));
}

export interface NestedDoc { path: string; rows: PropDocRow[] }

/** Estructuras anidadas (columns[], items[], fields[].options[]...) con sus propias filas, aplanadas por ruta. */
export function nestedDocs(props: Record<string, PropSpec>, locale: Locale, prefix = '', depth = 0): NestedDoc[] {
    const out: NestedDoc[] = [];
    for (const [name, spec] of Object.entries(props)) {
        const shape = shapeOf(spec);
        if (!shape || depth >= 3) continue;
        const path = `${prefix}${name}${spec.k === 'array' ? '[]' : spec.k === 'record' ? '{}' : ''}`;
        out.push({ path, rows: propDocRows(shape, locale).map((r) => ({ ...r, name: `${path}.${r.name}` })) });
        out.push(...nestedDocs(shape, locale, `${path}.`, depth + 1));
    }
    return out;
}

export interface EventDoc {
    /** Ruta de la prop de accion (`onClick`, `items[].onClick`). */
    path: string;
    doc: string;
    /** Variables que recibe la accion (`value`, `row`, `formData`...) segun la descripcion del esquema. */
    payload: string[];
}

/** Extrae de "(recibe `value`)" las variables disponibles en `${...}` dentro de esa accion. */
export function payloadOf(doc: string): string[] {
    const m = /(?:recibe|receives)\s+((?:`[^`]+`[\s,y/o]*)+)/i.exec(doc);
    if (!m) return [];
    return [...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1]);
}

function collectEvents(props: Record<string, PropSpec>, prefix: string, out: EventDoc[], depth: number) {
    for (const [name, spec] of Object.entries(props)) {
        if (spec.k === 'action') out.push({ path: `${prefix}${name}`, doc: spec.doc ?? '', payload: payloadOf(spec.doc ?? '') });
        const shape = shapeOf(spec);
        if (shape && depth < 3) collectEvents(shape, `${prefix}${name}${spec.k === 'array' ? '[]' : ''}.`, out, depth + 1);
    }
}

/** Props de tipo accion del componente (onClick, onChange, onSubmit, onSelect...), incluidas las anidadas. */
export function eventDocs(type: string): EventDoc[] {
    const spec = UI_COMPONENTS[type];
    if (!spec) return [];
    const out: EventDoc[] = [];
    collectEvents(spec.props, '', out, 0);
    // Comunes a todo componente (onLoad).
    for (const [name, p] of Object.entries(COMMON_PROPS)) if (p.k === 'action' && !spec.props[name]) out.push({ path: name, doc: p.doc ?? '', payload: [] });
    return out;
}

export interface StateUse { name: string; how: Record<Locale, string> }

/**
 * Estado y contexto que usa el componente. Se deduce del esquema: props `bind`/`bindTo`, props que leen `state` segun su
 * descripcion, `loading`/`disabled` (acepta `${state.$loading.x}`), `hidden`/`onLoadWhen` (condiciones) y `toolbar`.
 */
export function stateUsage(type: string): StateUse[] {
    const spec = UI_COMPONENTS[type];
    if (!spec) return [];
    const out: StateUse[] = [];
    const has = (n: string) => n in spec.props;
    if (has('bind')) out.push({ name: 'bind', how: { es: 'Enlace bidireccional: lee y escribe `state.<clave>` (admite rutas "a.b"). Ver `value`/`defaultValue`.', en: 'Two-way binding: reads and writes `state.<key>` ("a.b" paths allowed). See `value`/`defaultValue`.' } });
    if (has('bindTo')) out.push({ name: 'bindTo', how: { es: 'Obsoleto: usa `bind`.', en: 'Deprecated: use `bind`.' } });
    for (const [name, p] of Object.entries(spec.props)) {
        if (name === 'bind' || name === 'bindTo') continue;
        if (/`state`|state\[/.test(p.doc ?? '')) out.push({ name, how: { es: `Lee o escribe una clave de \`state\`: ${p.doc}`, en: `Reads or writes a \`state\` key: ${p.doc}` } });
    }
    if (has('loading')) out.push({ name: 'loading', how: { es: 'Acepta `${state.$loading.<clave>}`: CALL_BACKEND/CALL_API mantienen esa marca solos.', en: 'Accepts `${state.$loading.<key>}`: CALL_BACKEND/CALL_API maintain that flag automatically.' } });
    if (has('disabled')) out.push({ name: 'disabled', how: { es: 'Admite una expresión (`${state.x}`) para deshabilitar según el estado.', en: 'Accepts an expression (`${state.x}`) to disable based on state.' } });
    if (spec.category === 'input' || has('value')) out.push({ name: 'value / defaultValue', how: { es: 'Valor controlado por expresión (`${state.x}`) o valor inicial único.', en: 'Value driven by an expression (`${state.x}`) or a one-time initial value.' } });
    if (has('items') || has('data') || has('rows') || has('suggestions') || has('options')) out.push({ name: 'items / data / rows / options', how: { es: 'Los datos suelen venir de `${state.<clave>}` (rellenada por `resultKey` de CALL_BACKEND) o de `${context.*}`.', en: 'Data usually comes from `${state.<key>}` (filled by CALL_BACKEND `resultKey`) or `${context.*}`.' } });
    if (has('toolbar') || has('showLabel')) out.push({ name: 'context.toolbarButtonMode', how: { es: 'En barras de acciones (EMAIL_TOOLBAR, COMPOSER_TOOLBAR...) la app lo fija a `compact` o `menu` y el botón se presenta como icono. `toolbar` ajusta fijado/orden.', en: 'In action bars (EMAIL_TOOLBAR, COMPOSER_TOOLBAR...) the app sets it to `compact` or `menu` and the button is shown as an icon. `toolbar` adjusts pinning/order.' } });
    if (spec.category === 'logic') out.push({ name: 'condition / items / value', how: { es: 'Se evalúa con el estado y el contexto vigentes; cualquier cambio de `state` vuelve a evaluarlo.', en: 'Evaluated against the current state and context; any `state` change re-evaluates it.' } });
    out.push({ name: 'hidden / onLoadWhen', how: { es: 'Condiciones comunes: `hidden: "${!state.x}"` oculta el componente; `onLoadWhen` ejecuta `onLoad` al pasar a verdadera.', en: 'Common conditions: `hidden: "${!state.x}"` hides the component; `onLoadWhen` runs `onLoad` when it becomes true.' } });
    return out;
}

/** Acciones que RECIBE un componente (otras acciones lo controlan): se deducen de las descripciones de UI_ACTIONS. */
export function actionsReceived(type: string): string[] {
    const re = new RegExp(`(?<![A-Z_])${type}(?![A-Z_])`);
    const spec = UI_COMPONENTS[type];
    const out = Object.entries(UI_ACTIONS).filter(([, a]) => re.test(a.doc)).map(([n]) => n);
    // Un componente con `bind` booleano que abre/cierra (MODAL, DRAWER) se controla con SET_STATE y los overlays con OPEN/CLOSE_OVERLAY.
    if (spec?.props.bind && /booleana/.test(spec.props.bind.doc ?? '')) out.push('SET_STATE', 'OPEN_OVERLAY', 'CLOSE_OVERLAY');
    else if (spec?.props.bind || spec?.category === 'input') out.push('SET_STATE');
    if (spec?.props.loading || spec?.props.onClick) out.push('SET_LOADING');
    return [...new Set(out)];
}

/** Acciones usadas en los props de accion de los ejemplos del esquema (ui-examples.ts) y de los manifests reales. */
export function actionsUsed(type: string): string[] {
    const found = new Set<string>();
    const walk = (value: unknown, depth = 0) => {
        if (depth > 40 || value === null || typeof value !== 'object') return;
        if (Array.isArray(value)) { value.forEach((v) => walk(v, depth + 1)); return; }
        const rec = value as Record<string, unknown>;
        if (typeof rec.action === 'string' && rec.action in UI_ACTIONS) found.add(rec.action);
        for (const v of Object.values(rec)) walk(v, depth + 1);
    };
    for (const example of UI_EXAMPLES[type] ?? []) walk(example.node);
    const usage = usageOf(type);
    if (usage) walk(usage.node);
    return [...found];
}

export interface UsageEntry {
    /** Manifest que lo usa, relativo a bloomx-extensions (`zoom/manifest.json`). */
    file: string;
    extensionId: string;
    /** Punto de montaje del mount que lo contiene (si esta dentro de `mounts[]`) u `overlay:<id>`. */
    point: string;
    /** Ruta dentro del manifest (`mounts[0].component.children[2]`). */
    path: string;
    node: Record<string, any>;
    /** Resto de manifests que tambien lo usan. */
    alsoIn: string[];
}

export function usageOf(type: string): UsageEntry | undefined {
    return (USAGES as { components: Record<string, UsageEntry> }).components[type];
}

export const usagesSource = (): string => (USAGES as { source: string }).source;

/** Manifest minimo valido que monta un nodo en un punto (para "Copiar manifest snippet"). */
export function manifestSnippet(node: unknown, point: string, state?: Record<string, any>): string {
    const manifest: Record<string, any> = {
        manifestVersion: '1.0',
        id: 'my-extension',
        version: '1.0.0',
        name: 'My extension',
        permissions: [],
        ...(state && Object.keys(state).length ? { state } : {}),
        mounts: [{ point, component: node }],
    };
    return JSON.stringify(manifest, null, 2);
}
