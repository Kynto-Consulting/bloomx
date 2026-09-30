/**
 * Documentacion VIVA generada desde el schema (UI_COMPONENTS / UI_ACTIONS): filas de tablas de props, categorias y
 * busqueda. Logica pura de la galeria de componentes.
 */
import { COMMON_PROPS, UI_ACTIONS, UI_COMPONENTS, type ActionSpec, type ComponentSpec, type PropSpec } from '../ui-schema';

export interface PropRow {
    name: string;
    type: string;
    def: string;
    doc: string;
    required: boolean;
}

const KIND_LABEL: Record<string, string> = {
    text: 'texto', string: 'texto', name: 'nombre', number: 'numero', boolean: 'booleano', icon: 'icono (Lucide)', url: 'URL segura',
    color: 'color (dato)', regex: 'regex', action: 'accion(es)', node: 'componente', nodes: 'componentes', any: 'cualquiera', array: 'arreglo',
    record: 'mapa', object: 'objeto',
};

const show = (value: unknown): string => (typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value) ?? String(value));

/** Tipo legible de una prop: enum -> `a | b | c`; numero con rango; arreglo/objeto con su forma. */
export function describePropType(spec: PropSpec, depth = 0): string {
    switch (spec.k) {
        case 'enum': return (spec.values ?? []).map((v) => show(v)).join(' | ');
        case 'number': {
            const range = spec.min !== undefined || spec.max !== undefined ? ` (${spec.min ?? '...'} a ${spec.max ?? '...'})` : '';
            return `${KIND_LABEL.number}${range}`;
        }
        case 'array': return spec.of ? `arreglo de ${describePropType(spec.of, depth + 1)}` : KIND_LABEL.array;
        case 'record': return spec.of ? `mapa de ${describePropType(spec.of, depth + 1)}` : KIND_LABEL.record;
        case 'object': {
            if (!spec.shape) return KIND_LABEL.object;
            if (depth >= 1) return KIND_LABEL.object;
            const fields = Object.entries(spec.shape).map(([key, value]) => `${key}: ${describePropType(value, depth + 1)}`);
            return `{ ${fields.join(', ')} }`;
        }
        default: return KIND_LABEL[spec.k] ?? spec.k;
    }
}

export function propRows(props: Record<string, PropSpec>): PropRow[] {
    return Object.entries(props).map(([name, spec]) => ({
        name,
        type: describePropType(spec),
        def: spec.def === undefined ? '' : show(spec.def),
        doc: spec.doc ?? '',
        required: Boolean(spec.required),
    }));
}

export function commonPropRows(): PropRow[] {
    return propRows(COMMON_PROPS);
}

export const CATEGORY_ORDER: ComponentSpec['category'][] = ['layout', 'typography', 'action', 'input', 'data', 'navigation', 'feedback', 'overlay', 'chart', 'logic'];

export interface CatalogEntry { type: string; spec: ComponentSpec }

/** Componentes agrupados por categoria (en el orden de CATEGORY_ORDER; dentro, el del catalogo). */
export function catalogByCategory(): Array<{ category: ComponentSpec['category']; entries: CatalogEntry[] }> {
    const groups = new Map<ComponentSpec['category'], CatalogEntry[]>();
    for (const [type, spec] of Object.entries(UI_COMPONENTS)) {
        const list = groups.get(spec.category) ?? [];
        list.push({ type, spec });
        groups.set(spec.category, list);
    }
    const known = CATEGORY_ORDER.filter((c) => groups.has(c));
    const rest = [...groups.keys()].filter((c) => !CATEGORY_ORDER.includes(c));
    return [...known, ...rest].map((category) => ({ category, entries: groups.get(category)! }));
}

const norm = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Filtra el catalogo por texto (nombre, descripcion, props y sus docs) y categoria ('all' = todas). */
export function filterCatalog(query: string, category: string): Array<{ category: ComponentSpec['category']; entries: CatalogEntry[] }> {
    const q = norm(query.trim());
    return catalogByCategory()
        .filter((group) => category === 'all' || group.category === category)
        .map((group) => ({
            category: group.category,
            entries: group.entries.filter(({ type, spec }) => {
                if (!q) return true;
                const haystack = [type, spec.doc, ...Object.entries(spec.props).map(([name, p]) => `${name} ${p.doc ?? ''}`)].join(' ');
                return norm(haystack).includes(q);
            }),
        }))
        .filter((group) => group.entries.length > 0);
}

export interface ActionRow { name: string; doc: string; required: string[]; fields: PropRow[] }

export function actionRows(): ActionRow[] {
    return Object.entries(UI_ACTIONS as Record<string, ActionSpec>).map(([name, spec]) => ({ name, doc: spec.doc, required: spec.required ?? [], fields: propRows(spec.props) }));
}
