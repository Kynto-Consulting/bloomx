import { UI_COMPONENTS, validateUi, type PropSpec } from '@/lib/expansions/ui-schema';
import { checkExpression } from '@/lib/expansions/expressions';
import { UI_EXAMPLES } from '@/lib/expansions/ui-examples';
import type { Locale } from '../types';

/**
 * Presets del simulador: los ejemplos del esquema (ui-examples.ts) + estados y variantes GENERADOS desde el esquema
 * (cargando, deshabilitado, solo lectura, error de validacion, variantes de tone/variant/size, acciones conectadas,
 * condicion `hidden`). Cada preset generado se valida con validateUi y se descarta si no pasa (nunca se ofrece JSON roto).
 */

type Node = Record<string, any>;
export type PresetKind = 'example' | 'state' | 'variant' | 'action' | 'condition';

export interface Preset {
    id: string;
    kind: PresetKind;
    title: Record<Locale, string>;
    node: Node;
    state?: Record<string, any>;
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

/** Componentes que solo existen dentro de otro (no se generan presets sueltos). */
const CHILD_ONLY = new Set(['LIST_ITEM', 'TAB_ITEM', 'ACCORDION_ITEM', 'CASE', 'DEFAULT']);
/** Superposiciones y logica: las variantes en copias no tienen sentido (varias abren el mismo dialogo / no se ven). */
const NO_VARIANTS = new Set(['overlay', 'logic']);
const VARIANT_PROPS = ['tone', 'variant', 'size', 'density', 'orientation', 'side', 'trend', 'align'];

/** Primer nodo del tipo dentro de los ejemplos (un TABLE dentro de un STACK sirve): la base de los presets generados. */
export function baseNode(type: string): Node | undefined {
    const find = (node: any): Node | undefined => {
        if (!node || typeof node !== 'object') return undefined;
        if (node.type === type) return node;
        for (const child of Array.isArray(node.children) ? node.children : []) { const hit = find(child); if (hit) return hit; }
        return undefined;
    };
    for (const example of UI_EXAMPLES[type] ?? []) { const hit = find(example.node); if (hit) return clone(hit); }
    return undefined;
}

const isValid = (node: Node): boolean => validateUi(node, { root: 'ui', checkExpression }).ok;

/** Cadena de acciones de demostracion: estado + aviso + backend simulado con ambos caminos (onSuccess/onError). */
export function demoActionChain(label: string, withValue: boolean): Node[] {
    const echo = withValue ? '${value}' : '';
    return [
        { action: 'SET_STATE', key: 'lastEvent', value: label },
        { action: 'TOAST', message: withValue ? `${label}: \${value}` : label, tone: 'info' },
        {
            action: 'CALL_BACKEND', function: 'demoCall', args: { event: label, value: echo }, resultKey: 'demoResult',
            onSuccess: { action: 'TOAST', message: 'CALL_BACKEND OK', tone: 'success' },
            onError: { action: 'TOAST', message: 'CALL_BACKEND error: ${error}', tone: 'danger' },
        },
    ];
}

function actionProps(props: Record<string, PropSpec>): string[] {
    return Object.entries(props).filter(([name, p]) => p.k === 'action' && name !== 'onLoad').map(([name]) => name);
}

const WITH_VALUE = new Set(['onChange', 'onSelect', 'onSubmit', 'onRowClick', 'onRemove']);

export function presetsFor(type: string): Preset[] {
    const spec = UI_COMPONENTS[type];
    if (!spec) return [];
    const out: Preset[] = [];
    (UI_EXAMPLES[type] ?? []).forEach((example, i) => {
        out.push({ id: `example-${i}`, kind: 'example', title: { es: example.title, en: example.title }, node: clone(example.node) });
    });
    if (CHILD_ONLY.has(type)) return out;
    const base = baseNode(type);
    if (!base) return out;
    const props = (): Record<string, any> => ({ ...(base.props ?? {}) });
    const push = (preset: Preset) => { if (isValid(preset.node)) out.push(preset); };

    // ---- estados
    for (const [flag, es, en] of [['loading', 'Estado: cargando', 'State: loading'], ['disabled', 'Estado: deshabilitado', 'State: disabled'], ['readOnly', 'Estado: solo lectura', 'State: read-only']] as const) {
        if (spec.props[flag]) push({ id: `state-${flag}`, kind: 'state', title: { es, en }, node: { ...clone(base), props: { ...props(), [flag]: true } } });
    }
    if (spec.props.rules && (type === 'INPUT' || type === 'TEXTAREA')) {
        push({
            id: 'state-error', kind: 'state', title: { es: 'Estado: error de validación', en: 'State: validation error' },
            node: { type: 'FORM', props: { validateOn: 'change', submitLabel: 'Enviar', fields: [{ name: 'campo', label: 'Campo (mínimo 5 caracteres)', type: type === 'INPUT' ? 'text' : 'textarea', required: true, rules: { minLength: 5, message: 'Escribe al menos 5 caracteres' } }], onSubmit: { action: 'TOAST', message: 'Enviado: ${formData.campo}', tone: 'success' } } },
        });
    }
    if (spec.props.tone && (spec.props.tone.values ?? []).includes('danger') && type !== 'BUTTON') {
        push({ id: 'state-danger', kind: 'state', title: { es: 'Estado: error (tone danger)', en: 'State: error (tone danger)' }, node: { ...clone(base), props: { ...props(), tone: 'danger' } } });
    }

    // ---- variantes (hasta 2 props enum de apariencia)
    if (!NO_VARIANTS.has(spec.category)) {
        const names = VARIANT_PROPS.filter((n) => spec.props[n]?.k === 'enum' && (spec.props[n].values ?? []).length > 1).slice(0, 2);
        const container = ['action', 'feedback', 'typography'].includes(spec.category) ? { type: 'ROW', props: { gap: 2, wrap: true, align: 'center' } } : { type: 'STACK', props: { gap: 3 } };
        for (const name of names) {
            const values = (spec.props[name].values ?? []).slice(0, 6);
            push({
                id: `variant-${name}`, kind: 'variant', title: { es: `Variantes de ${name}`, en: `${name} variants` },
                node: { ...container, children: values.map((v) => ({ ...clone(base), props: { ...props(), [name]: v } })) },
            });
        }
    }

    // ---- acciones conectadas (log + backend simulado)
    const direct = actionProps(spec.props).filter((n) => n !== 'onSuccess' && n !== 'onError');
    if (direct.length) {
        const next = props();
        for (const name of direct) next[name] = demoActionChain(`${type}.${name}`, WITH_VALUE.has(name));
        push({ id: 'action-direct', kind: 'action', title: { es: `Acciones: ${direct.join(', ')} → estado, aviso y backend simulado`, en: `Actions: ${direct.join(', ')} → state, toast and mock backend` }, node: { ...clone(base), props: next } });
    }
    // Acciones dentro de arreglos de objetos (MENU.items[].onClick, TABLE.actions[].onClick, ...)
    const nested: Record<string, any> = props();
    let touched = false;
    for (const [name, p] of Object.entries(spec.props)) {
        const shape = p.k === 'array' && p.of?.k === 'object' ? p.of.shape : undefined;
        const items = nested[name];
        if (!shape || !Array.isArray(items)) continue;
        const acts = Object.entries(shape).filter(([, s]) => s.k === 'action').map(([n]) => n);
        if (!acts.length) continue;
        nested[name] = items.map((item: any, i: number) => {
            if (!item || typeof item !== 'object' || item.separator) return item;
            const copy = { ...item };
            for (const a of acts) copy[a] = demoActionChain(`${type}.${name}[${i}].${a}`, a === 'onClick' && type === 'TABLE');
            return copy;
        });
        touched = true;
    }
    if (touched) push({ id: 'action-nested', kind: 'action', title: { es: 'Acciones de elementos (items, acciones de fila…)', en: 'Item actions (items, row actions…)' }, node: { ...clone(base), props: nested } });

    // ---- condicion `hidden`
    if (!['overlay', 'logic'].includes(spec.category)) {
        push({
            id: 'condition-hidden', kind: 'condition', title: { es: 'Condición: hidden con una expresión de state', en: 'Condition: hidden with a state expression' },
            state: { show: true },
            node: { type: 'STACK', props: { gap: 3 }, children: [{ type: 'TOGGLE', props: { label: 'Mostrar el componente (state.show)', bind: 'show' } }, { ...clone(base), props: { ...props(), hidden: '${!state.show}' } }] },
        });
    }
    return out;
}

export const PRESET_KIND_LABEL: Record<PresetKind, Record<Locale, string>> = {
    example: { es: 'Ejemplos', en: 'Examples' },
    state: { es: 'Estados', en: 'States' },
    variant: { es: 'Variantes', en: 'Variants' },
    action: { es: 'Acciones y eventos', en: 'Actions and events' },
    condition: { es: 'Condiciones', en: 'Conditions' },
};
