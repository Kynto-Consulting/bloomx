import { UI_ACTIONS, UI_COMPONENTS, type ComponentSpec } from '@/lib/expansions/ui-schema';
import type { Locale } from '../types';

/**
 * Kit de componentes de extensiones en la documentacion: rutas /docs/extension-ui/<componente>, categorias y
 * descripciones. TODO sale de UI_COMPONENTS (ui-schema.ts): anadir un componente al esquema crea su pagina y su
 * entrada de navegacion sin tocar nada mas (lo comprueba ui-kit.test.ts). Sin React: lo importan nav.ts y los tests.
 */

export const KIT_BASE = '/docs/extension-ui';

export const KIT_CATEGORIES: Array<{ id: string; es: string; en: string }> = [
    { id: 'layout', es: 'Estructura', en: 'Layout' },
    { id: 'typography', es: 'Texto', en: 'Text' },
    { id: 'action', es: 'Acciones', en: 'Actions' },
    { id: 'input', es: 'Entradas y formularios', en: 'Inputs and forms' },
    { id: 'data', es: 'Datos', en: 'Data' },
    { id: 'navigation', es: 'Navegación', en: 'Navigation' },
    { id: 'feedback', es: 'Estado y avisos', en: 'Status and alerts' },
    { id: 'overlay', es: 'Superpuestos', en: 'Overlays' },
    { id: 'chart', es: 'Gráficos', en: 'Charts' },
    { id: 'logic', es: 'Lógica', en: 'Logic' },
];

export const EN_DOC: Record<string, string> = {
    STACK: 'Vertical stack with a scale gap', ROW: 'Horizontal row', GRID: 'Equal-column grid, collapses on mobile', CARD: 'Card with optional title and accent', SECTION: 'Section with heading, optionally collapsible',
    DIVIDER: 'Separator line with optional label', SPACER: 'Empty space from the scale', TEXT: 'Plain text paragraph (never HTML)', HEADING: 'Semantic heading h1-h6', CODE: 'Inline or block code with copy button',
    LINK: 'Safe link (http, https, mailto, tel or internal path)', MARKDOWN: 'Safe Markdown (raw HTML is shown as text)', ICON: 'Decorative Lucide icon', BUTTON: 'Button: tone + variant, contrast guaranteed',
    ICON_BUTTON: 'Icon-only button (label required)', BUTTON_GROUP: 'Groups buttons', MENU: 'Button that opens an action menu (keyboard: arrows, Enter, Escape)', IMAGE_BUTTON: 'Clickable https image',
    SMART_REPLY_CHIPS: 'Row of clickable reply suggestions', INPUT: 'Single-line text field', TEXTAREA: 'Multi-line text', SELECT: 'Native dropdown', CHECKBOX: 'Checkbox', RADIO_GROUP: 'Mutually exclusive options',
    TOGGLE: 'On/off switch', SLIDER: 'Numeric slider', DATE_PICKER: 'Date (YYYY-MM-DD)', TIME_PICKER: 'Time (HH:MM)', COLOR_PICKER: 'Colour chooser for USER DATA only (never styles the UI)', FILE_INPUT: 'File selection with size limit',
    TAG_INPUT: 'List of tags/values', CONTACT_PICKER: 'Address-book contact picker', FORM: 'Form with declarative validation and automatic loading/error/success states', TABLE: 'Table with sorting, pagination, selection, search, column filters, link/status cells, bulk actions and error + Retry (DATA_TABLE is its alias)',
    LIST: 'List from an item template or LIST_ITEM children', LIST_ITEM: 'List item with title, description, icon and actions', TABS: 'Accessible tabs', TAB_ITEM: 'TABS panel (legacy children form)', ACCORDION: 'Collapsible sections',
    ACCORDION_ITEM: 'ACCORDION section (legacy children form)', WIZARD: 'Step-by-step wizard with progress', BADGE: 'Short status label', CHIP: 'Filter/value chip, optionally clickable or removable', AVATAR: 'Avatar with https image or initials',
    STAT: 'Highlighted metric with delta', PROGRESS: 'Progress bar', SKELETON: 'Loading placeholder', EMPTY: 'Empty state with message and action', ALERT: 'Inline alert', CALLOUT: 'Highlighted note', LOADING: 'Loading indicator',
    MODAL: 'OVERLAY frame (or your own dialog with open/bind)', DRAWER: 'Side panel', POPOVER: 'Floating content anchored to a trigger', TOOLTIP: 'Help on hover/focus', BAR_CHART: 'Simple bar chart (own SVG, theme colours)',
    SPARKLINE: 'Minimal trend line', DONUT: 'Proportion ring with legend', CONDITIONAL: 'Shows `true` or `false` by `condition`', CONDITION: 'Like CONDITIONAL with `if`/`else`', FOR_EACH: 'Repeats `template` per item', REPEAT: 'Repeats children N times or per item',
    PAGE_HEADER: 'Full-page header: breadcrumbs, title (h1), status, description and actions, with its own loading and error + Retry states', SPLIT_PANE: 'Two panes (list and detail): side by side on desktop, stacked on narrow screens; resizable by mouse or keyboard',
    KPI_CARD: 'Key indicator (KPI): highlighted value, delta, trend, sparkline, loading and error states; clickable with onClick', CHART: 'Line, bar, area, pie or donut chart with several series, toggleable legend and keyboard-accessible tooltips (own SVG, theme colours)',
    TIMELINE: 'Vertical timeline of events (date, title, description, icon and tone)', TREE: 'Accessible tree (WAI-ARIA tree: arrows, Home/End, Enter) of nodes {id, label, icon?, badge?, children?}', STEPPER: 'Step indicator for a process (done, current, pending, error); informational only, use WIZARD to show content per step',
    SWITCH: 'Picks a case by `value`', CASE: 'SWITCH case', DEFAULT: 'SWITCH default', SET_VAR: 'Sets a `state` variable (invisible)', HEADLESS: 'No UI: only runs `onLoad`', DEBUG: 'Development only: shows context and state',
};


export type KitCategoryId = ComponentSpec['category'];

/** BUTTON -> button, ICON_BUTTON -> icon-button. */
export const typeToSlug = (type: string): string => type.toLowerCase().replace(/_/g, '-');
export const kitHref = (type: string): string => `${KIT_BASE}/${typeToSlug(type)}`;

export const KIT_TYPES: string[] = Object.keys(UI_COMPONENTS);
const BY_SLUG = new Map(KIT_TYPES.map((t) => [typeToSlug(t), t]));
export const KIT_SLUGS: string[] = [...BY_SLUG.keys()];
export const slugToType = (slug: string): string | undefined => BY_SLUG.get(slug);

export function kitCategoryLabel(id: string, locale: Locale): string {
    return KIT_CATEGORIES.find((c) => c.id === id)?.[locale] ?? id;
}

export interface KitGroup { id: KitCategoryId; label: Record<Locale, string>; types: string[] }

/** Componentes agrupados por categoria (orden de KIT_CATEGORIES; dentro de cada una, el orden del esquema). */
export function kitGroups(): KitGroup[] {
    const groups: KitGroup[] = [];
    for (const category of KIT_CATEGORIES) {
        const types = KIT_TYPES.filter((t) => UI_COMPONENTS[t].category === category.id);
        if (types.length) groups.push({ id: category.id as KitCategoryId, label: { es: category.es, en: category.en }, types });
    }
    // Una categoria nueva del esquema sin etiqueta aqui no se pierde: sale con su id.
    for (const id of new Set(KIT_TYPES.map((t) => UI_COMPONENTS[t].category))) {
        if (!KIT_CATEGORIES.some((c) => c.id === id)) groups.push({ id, label: { es: id, en: id }, types: KIT_TYPES.filter((t) => UI_COMPONENTS[t].category === id) });
    }
    return groups;
}

/** Orden lineal de lectura (el de la navegacion lateral). */
export const KIT_ORDER: string[] = kitGroups().flatMap((g) => g.types);

export function kitNeighbours(type: string): { prev?: string; next?: string } {
    const i = KIT_ORDER.indexOf(type);
    return i < 0 ? {} : { prev: KIT_ORDER[i - 1], next: KIT_ORDER[i + 1] };
}

export const kitDescription = (type: string, locale: Locale): string => (locale === 'es' ? UI_COMPONENTS[type]?.doc : (EN_DOC[type] ?? UI_COMPONENTS[type]?.doc)) ?? '';

/** Nombres de accion (UI_ACTIONS) para enlazar: todos apuntan a la seccion de acciones de la pagina principal. */
export const ACTIONS_ANCHOR = `${KIT_BASE}#actions`;
export const ACTION_TYPES: string[] = Object.keys(UI_ACTIONS);
