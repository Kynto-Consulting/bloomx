'use client';

/**
 * Kit: componentes de PAGINA COMPLETA (PageHeader, SplitPane, KpiCard, Timeline, Tree, Stepper).
 * Mismas reglas que el resto del kit: el color sale de tokens.ts (parejas con contraste garantizado), todo el contenido es DATO de terceros y se pinta
 * como texto React (nunca HTML), las URLs pasan por safe-url.ts y los unicos `style` en linea son dimensiones (variable de ancho del divisor).
 */
import * as React from 'react';
import { GAPS } from '@/lib/expansions/ui-schema';
import { useI18n } from '@/components/I18nProvider';
import { KitIcon } from './Icon';
import { useKitStrings } from './strings';
import { Badge, Skeleton } from './Feedback';
import { Link } from './Typography';
import { Sparkline } from './Charts';
import {
    FOCUS_RING_CLASS, GAP_CLASS, ROW_HOVER_CLASS, ROW_SELECTED_CLASS, SURFACE_CLASS, TONE_BG, TONE_BORDER, TONE_SOLID, TONE_TEXT, buttonClasses, pick, toTone,
    type Tone,
} from './tokens';

const txt = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '');
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (node: React.ReactNode): boolean => node !== undefined && node !== null && node !== false && node !== '';

// ------------------------------------------------------------------ PageHeader
export interface PageHeaderCrumb { label?: string; url?: string; onPress?: () => void }
export interface PageHeaderProps {
    title?: string;
    description?: string;
    icon?: string;
    breadcrumbs?: PageHeaderCrumb[];
    status?: { label?: string; tone?: Tone };
    actions?: React.ReactNode;
    loading?: boolean;
    error?: string;
    onRetry?: () => void;
}
const MAX_CRUMBS = 6;

export function PageHeader(props: PageHeaderProps) {
    const strings = useKitStrings();
    const title = txt(props.title);
    const description = txt(props.description);
    const error = txt(props.error);
    const crumbs = (Array.isArray(props.breadcrumbs) ? props.breadcrumbs : []).filter((c): c is PageHeaderCrumb => isRecord(c) && txt(c.label) !== '').slice(0, MAX_CRUMBS);
    const status = isRecord(props.status) && txt(props.status.label) ? props.status : null;
    const loading = props.loading === true;
    return (
        <header className="flex w-full min-w-0 flex-col gap-3" aria-busy={loading || undefined}>
            {crumbs.length > 0 && (
                <nav aria-label={strings.breadcrumbs}>
                    <ol className="m-0 flex list-none flex-wrap items-center gap-1 p-0 text-sm text-muted-foreground">
                        {crumbs.map((crumb, i) => {
                            const last = i === crumbs.length - 1;
                            const label = txt(crumb.label);
                            return (
                                <li key={i} className="flex min-w-0 items-center gap-1">
                                    {last && !crumb.url && !crumb.onPress
                                        ? <span aria-current="page" className="truncate font-medium text-foreground">{label}</span>
                                        : <Link label={label} url={crumb.url} tone="neutral" onPress={crumb.onPress} />}
                                    {!last && <KitIcon name="ChevronRight" size="xs" className="text-muted-foreground" />}
                                </li>
                            );
                        })}
                    </ol>
                </nav>
            )}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                    {props.icon ? <KitIcon name={txt(props.icon)} size="xl" className="mt-1 text-muted-foreground" /> : null}
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                        {loading ? (
                            <>
                                <span className="sr-only" role="status">{strings.loading}</span>
                                <Skeleton variant="text" lines={2} />
                            </>
                        ) : (
                            <>
                                <div className="flex flex-wrap items-center gap-2">
                                    <h1 className="m-0 min-w-0 break-words text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
                                    {status && <Badge label={txt(status.label)} tone={toTone(status.tone)} />}
                                </div>
                                {description && <p className="m-0 max-w-3xl break-words text-sm text-muted-foreground">{description}</p>}
                            </>
                        )}
                    </div>
                </div>
                {has(props.actions) && <div className="flex flex-wrap items-center gap-2">{props.actions}</div>}
            </div>
            {error && (
                <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/50 bg-card p-3 text-sm text-card-foreground">
                    <KitIcon name="CircleAlert" size="md" className="text-destructive" />
                    <span className="min-w-0 flex-1 break-words">{error}</span>
                    {typeof props.onRetry === 'function' && (
                        <button type="button" onClick={() => props.onRetry?.()} className={buttonClasses({ variant: 'outline', size: 'sm' })}>{strings.retry}</button>
                    )}
                </div>
            )}
        </header>
    );
}

// ------------------------------------------------------------------ SplitPane
const RATIOS = ['1:3', '1:2', '1:1', '2:1', '3:1'] as const;
const RATIO_PCT: Record<(typeof RATIOS)[number], number> = { '1:3': 25, '1:2': 33, '1:1': 50, '2:1': 67, '3:1': 75 };
export const SPLIT_MIN = 20;
export const SPLIT_MAX = 80;
export const SPLIT_STEP = 5;
export interface SplitPaneProps {
    start?: React.ReactNode;
    end?: React.ReactNode;
    ratio?: (typeof RATIOS)[number];
    resizable?: boolean;
    gap?: (typeof GAPS)[number];
    sticky?: boolean;
    startLabel?: string;
    endLabel?: string;
}

export function SplitPane(props: SplitPaneProps) {
    const strings = useKitStrings();
    const ratio = pick(props.ratio, RATIOS, '1:2');
    const gap = pick<number>(props.gap, GAPS, 4);
    const resizable = props.resizable === true;
    const [pct, setPct] = React.useState(RATIO_PCT[ratio]);
    React.useEffect(() => { setPct(RATIO_PCT[ratio]); }, [ratio]);
    const rootRef = React.useRef<HTMLDivElement>(null);
    const dragging = React.useRef(false);
    const clamp = (n: number) => Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, Math.round(n)));

    const moveTo = (clientX: number) => {
        const rect = rootRef.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0) return;
        setPct(clamp(((clientX - rect.left) / rect.width) * 100));
    };
    const onKeyDown = (e: React.KeyboardEvent) => {
        // Escritorio: el divisor es vertical y las flechas izquierda/derecha lo mueven (en lectura derecha-izquierda se invierten).
        const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
        let next: number | null = null;
        if (e.key === 'ArrowLeft') next = pct + (rtl ? SPLIT_STEP : -SPLIT_STEP);
        else if (e.key === 'ArrowRight') next = pct + (rtl ? -SPLIT_STEP : SPLIT_STEP);
        else if (e.key === 'Home') next = SPLIT_MIN;
        else if (e.key === 'End') next = SPLIT_MAX;
        if (next === null) return;
        e.preventDefault();
        setPct(clamp(next));
    };
    const pane = (node: React.ReactNode, label: string, cls: string) => (label ? <section aria-label={label} className={`min-w-0 ${cls}`}>{node}</section> : <div className={`min-w-0 ${cls}`}>{node}</div>);
    const style = { '--split-start': `${pct}%` } as React.CSSProperties;
    const startCls = `${props.sticky === true ? 'md:sticky md:top-4 md:self-start' : ''} ${resizable ? 'md:pe-2' : ''}`.trim();
    return (
        <div
            ref={rootRef}
            style={style}
            data-split={pct}
            className={`grid w-full grid-cols-1 ${resizable ? 'gap-y-4 md:gap-0 md:grid-cols-[var(--split-start)_0.5rem_minmax(0,1fr)]' : `${GAP_CLASS[gap]} md:grid-cols-[var(--split-start)_minmax(0,1fr)]`}`}
        >
            {pane(props.start, txt(props.startLabel), startCls)}
            {resizable && (
                <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={strings.resizePanes}
                    aria-valuemin={SPLIT_MIN}
                    aria-valuemax={SPLIT_MAX}
                    aria-valuenow={pct}
                    tabIndex={0}
                    onKeyDown={onKeyDown}
                    onPointerDown={(e) => { dragging.current = true; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); }}
                    onPointerMove={(e) => { if (dragging.current) moveTo(e.clientX); }}
                    onPointerUp={(e) => { dragging.current = false; (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId); }}
                    className={`hidden cursor-col-resize touch-none items-stretch justify-center md:flex ${FOCUS_RING_CLASS}`}
                >
                    <span aria-hidden="true" className="w-px bg-border" />
                </div>
            )}
            {pane(props.end, txt(props.endLabel), resizable ? 'md:ps-2' : '')}
        </div>
    );
}

// ------------------------------------------------------------------ KpiCard
const TRENDS = ['up', 'down', 'flat'] as const;
export interface KpiCardProps {
    label?: string;
    value?: string | number;
    unit?: string;
    delta?: string | number;
    trend?: (typeof TRENDS)[number];
    invertTrend?: boolean;
    description?: string;
    icon?: string;
    tone?: Tone;
    sparkline?: number[];
    loading?: boolean;
    error?: string;
    onPress?: () => void;
}
const TREND_ICON: Record<(typeof TRENDS)[number], string> = { up: 'TrendingUp', down: 'TrendingDown', flat: 'Minus' };

export function KpiCard(props: KpiCardProps) {
    const strings = useKitStrings();
    const tone = toTone(props.tone);
    const trend = pick(props.trend, TRENDS, 'flat');
    // Bueno/malo: sube = bueno salvo `invertTrend` (p. ej. spam, rebotes). Sin direccion no hay juicio.
    const good = trend === 'flat' ? null : (trend === 'up') !== (props.invertTrend === true);
    const trendClass = good === null ? 'text-muted-foreground' : good ? 'text-success' : 'text-destructive';
    const delta = txt(props.delta);
    const description = txt(props.description);
    const label = txt(props.label);
    const error = txt(props.error);
    const spark = (Array.isArray(props.sparkline) ? props.sparkline : []).filter((n): n is number => typeof n === 'number' && Number.isFinite(n)).slice(-60);
    const press = typeof props.onPress === 'function';
    const trendWord = trend === 'up' ? strings.trendUp : trend === 'down' ? strings.trendDown : strings.trendFlat;

    const body = (
        <>
            <span className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                <span className="min-w-0 truncate">{label}</span>
                {props.icon ? <KitIcon name={txt(props.icon)} size="md" /> : null}
            </span>
            {props.loading === true ? (
                <>
                    <span className="sr-only" role="status">{strings.loading}</span>
                    <Skeleton variant="text" lines={2} />
                </>
            ) : error ? (
                <span role="alert" className="flex items-center gap-2 text-sm text-destructive"><KitIcon name="CircleAlert" size="sm" />{error}</span>
            ) : (
                <>
                    <span className={`text-2xl font-semibold tracking-tight ${TONE_TEXT[tone]}`}>
                        {txt(props.value)}
                        {txt(props.unit) && <span className="ms-1 text-sm font-normal text-muted-foreground">{txt(props.unit)}</span>}
                    </span>
                    {delta && (
                        <span className={`flex items-center gap-1 text-sm font-medium ${trendClass}`}>
                            <KitIcon name={TREND_ICON[trend]} size="sm" />
                            <span className="sr-only">{trendWord}: </span>
                            <span>{delta}</span>
                        </span>
                    )}
                    {description && <span className="text-xs text-muted-foreground">{description}</span>}
                    {spark.length > 1 && <span className="mt-1 block"><Sparkline values={spark} tone={tone === 'neutral' ? 'primary' : tone} height="sm" label={label} /></span>}
                </>
            )}
        </>
    );
    const base = `${SURFACE_CLASS} flex min-w-0 flex-col gap-1 p-4`;
    if (press && props.loading !== true) {
        return <button type="button" onClick={() => props.onPress?.()} className={`${base} w-full text-start ${ROW_HOVER_CLASS} ${FOCUS_RING_CLASS}`}>{body}</button>;
    }
    return <div role="group" aria-label={label || undefined} aria-busy={props.loading === true || undefined} className={base}>{body}</div>;
}

// ------------------------------------------------------------------ Timeline
export interface TimelineItem { title?: string; description?: string; time?: string; icon?: string; tone?: Tone; onPress?: () => void }
export interface TimelineProps { items?: TimelineItem[]; emptyText?: string; loading?: boolean }
const MAX_TIMELINE = 200;

function formatWhen(value: string, intlLocale: string): { text: string; iso?: string } {
    if (!value) return { text: '' };
    // Solo se formatea lo que parece una fecha ISO; el resto ("Jueves", "hace 2 h") se muestra tal cual.
    if (/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}.*)?$/.test(value.trim())) {
        const d = new Date(value);
        if (!Number.isNaN(d.getTime())) {
            const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
            try {
                return { text: new Intl.DateTimeFormat(intlLocale, dateOnly ? { dateStyle: 'medium', timeZone: 'UTC' } : { dateStyle: 'medium', timeStyle: 'short' }).format(d), iso: d.toISOString() };
            } catch { return { text: value }; }
        }
    }
    return { text: value };
}

export function Timeline(props: TimelineProps) {
    const strings = useKitStrings();
    const { intlLocale } = useI18n();
    if (props.loading === true) return <div aria-busy="true"><span className="sr-only" role="status">{strings.loading}</span><Skeleton variant="text" lines={4} /></div>;
    const items = (Array.isArray(props.items) ? props.items : []).filter((i): i is TimelineItem => isRecord(i) && txt(i.title) !== '').slice(0, MAX_TIMELINE);
    if (items.length === 0) return <p className="text-sm text-muted-foreground">{txt(props.emptyText) || strings.empty}</p>;
    return (
        <ol className="m-0 flex list-none flex-col p-0">
            {items.map((item, i) => {
                const tone = toTone(item.tone);
                const when = formatWhen(txt(item.time), intlLocale);
                const title = txt(item.title);
                const press = typeof item.onPress === 'function';
                return (
                    <li key={i} className="group relative flex gap-3 pb-6 last:pb-0">
                        <span aria-hidden="true" className="absolute start-4 top-8 bottom-0 w-px -translate-x-1/2 bg-border group-last:hidden" />
                        <span className={`z-10 inline-flex size-8 shrink-0 items-center justify-center rounded-full border bg-card ${TONE_BORDER[tone]} ${TONE_TEXT[tone]}`}>
                            <KitIcon name={txt(item.icon) || 'Circle'} size="sm" />
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1">
                            {press
                                ? <button type="button" onClick={() => item.onPress?.()} className={`w-fit max-w-full rounded-sm text-start text-sm font-medium text-foreground hover:underline ${FOCUS_RING_CLASS}`}>{title}</button>
                                : <p className="m-0 break-words text-sm font-medium text-foreground">{title}</p>}
                            {when.text && (when.iso ? <time dateTime={when.iso} className="text-xs text-muted-foreground">{when.text}</time> : <span className="text-xs text-muted-foreground">{when.text}</span>)}
                            {txt(item.description) && <p className="m-0 break-words text-sm text-muted-foreground">{txt(item.description)}</p>}
                        </div>
                    </li>
                );
            })}
        </ol>
    );
}

// ------------------------------------------------------------------ Tree
export interface TreeNodeData { id: string; label: string; description?: string; icon?: string; badge?: string; children: TreeNodeData[] }
export const TREE_MAX_NODES = 500;
export const TREE_MAX_DEPTH = 8;

/** Normaliza un arbol de datos de terceros: ids unicos, textos, tope de nodos (500) y de niveles (8). Nunca lanza. */
export function normalizeTree(items: unknown): TreeNodeData[] {
    const seen = new Set<string>();
    let count = 0;
    const walk = (list: unknown, depth: number, parentPath: string): TreeNodeData[] => {
        if (!Array.isArray(list) || depth >= TREE_MAX_DEPTH) return [];
        const out: TreeNodeData[] = [];
        for (let i = 0; i < list.length; i += 1) {
            if (count >= TREE_MAX_NODES) break;
            const raw = list[i];
            if (!isRecord(raw)) continue;
            const label = txt(raw.label) || txt(raw.id);
            if (!label) continue;
            let id = txt(raw.id) || `${parentPath}${i}`;
            if (seen.has(id)) id = `${id}#${count}`;
            seen.add(id);
            count += 1;
            const node: TreeNodeData = { id, label, children: [] };
            if (txt(raw.description)) node.description = txt(raw.description);
            if (txt(raw.icon)) node.icon = txt(raw.icon);
            if (txt(raw.badge)) node.badge = txt(raw.badge);
            node.children = walk(raw.children, depth + 1, `${id}/`);
            out.push(node);
        }
        return out;
    };
    return walk(items, 0, '');
}

export interface TreeProps {
    items?: unknown;
    label?: string;
    /** Id elegido (controlado). Sin este prop la seleccion es interna. */
    selected?: string;
    defaultExpanded?: number;
    onSelect?: (id: string, item: { id: string; label: string }) => void;
    emptyText?: string;
    loading?: boolean;
}

export function Tree(props: TreeProps) {
    const strings = useKitStrings();
    const nodes = React.useMemo(() => normalizeTree(props.items), [props.items]);
    const initialDepth = typeof props.defaultExpanded === 'number' && Number.isFinite(props.defaultExpanded) ? Math.min(TREE_MAX_DEPTH, Math.max(0, Math.floor(props.defaultExpanded))) : 1;
    const index = React.useMemo(() => {
        const map = new Map<string, { node: TreeNodeData; parent: string | null; depth: number }>();
        const walk = (list: TreeNodeData[], parent: string | null, depth: number) => { for (const n of list) { map.set(n.id, { node: n, parent, depth }); walk(n.children, n.id, depth + 1); } };
        walk(nodes, null, 0);
        return map;
    }, [nodes]);
    const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
    const initialised = React.useRef<TreeNodeData[] | null>(null);
    React.useEffect(() => {
        if (initialised.current === nodes) return;
        initialised.current = nodes;
        const open = new Set<string>();
        for (const [id, info] of index) if (info.node.children.length > 0 && info.depth < initialDepth) open.add(id);
        setExpanded(open);
    }, [nodes, index, initialDepth]);
    const [innerSelected, setInnerSelected] = React.useState<string | null>(null);
    const selected = props.selected !== undefined ? props.selected : innerSelected;
    const [focusId, setFocusId] = React.useState<string | null>(null);
    const rootRef = React.useRef<HTMLUListElement>(null);

    const visible = React.useMemo(() => {
        const out: string[] = [];
        const walk = (list: TreeNodeData[]) => { for (const n of list) { out.push(n.id); if (n.children.length > 0 && expanded.has(n.id)) walk(n.children); } };
        walk(nodes);
        return out;
    }, [nodes, expanded]);
    const tabId = focusId && visible.includes(focusId) ? focusId : (selected && visible.includes(selected) ? selected : visible[0] ?? null);

    const focusNode = (id: string | null) => {
        if (!id) return;
        setFocusId(id);
        const el = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-tree-id]') ?? []).find((n) => n.getAttribute('data-tree-id') === id);
        el?.focus();
    };
    const toggle = (id: string, open?: boolean) => setExpanded((cur) => {
        const next = new Set(cur);
        const want = open ?? !next.has(id);
        if (want) next.add(id); else next.delete(id);
        return next;
    });
    const select = (id: string) => {
        const info = index.get(id);
        if (!info) return;
        if (props.selected === undefined) setInnerSelected(id);
        props.onSelect?.(id, { id, label: info.node.label });
    };
    const onKeyDown = (e: React.KeyboardEvent) => {
        const li = (e.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
        const id = li?.getAttribute('data-tree-id');
        if (!id || (e.target as HTMLElement) !== li) return;
        const info = index.get(id);
        if (!info) return;
        const pos = visible.indexOf(id);
        const hasKids = info.node.children.length > 0;
        let handled = true;
        switch (e.key) {
            case 'ArrowDown': focusNode(visible[Math.min(visible.length - 1, pos + 1)]); break;
            case 'ArrowUp': focusNode(visible[Math.max(0, pos - 1)]); break;
            case 'Home': focusNode(visible[0]); break;
            case 'End': focusNode(visible[visible.length - 1]); break;
            case 'ArrowRight':
                if (hasKids && !expanded.has(id)) toggle(id, true);
                else if (hasKids) focusNode(info.node.children[0].id);
                break;
            case 'ArrowLeft':
                if (hasKids && expanded.has(id)) toggle(id, false);
                else if (info.parent) focusNode(info.parent);
                break;
            case 'Enter': case ' ': case 'Spacebar':
                select(id);
                if (hasKids) toggle(id);
                break;
            default: handled = false;
        }
        if (handled) e.preventDefault();
    };

    if (props.loading === true) return <div aria-busy="true"><span className="sr-only" role="status">{strings.loading}</span><Skeleton variant="text" lines={5} /></div>;
    if (nodes.length === 0) return <p className="text-sm text-muted-foreground">{txt(props.emptyText) || strings.empty}</p>;

    const renderList = (list: TreeNodeData[], level: number, root: boolean): React.ReactNode => (
        <ul role={root ? 'tree' : 'group'} aria-label={root ? (txt(props.label) || strings.treeLabel) : undefined} ref={root ? rootRef : undefined} onKeyDown={root ? onKeyDown : undefined} className="m-0 flex list-none flex-col p-0">
            {list.map((node) => {
                const hasKids = node.children.length > 0;
                const open = hasKids && expanded.has(node.id);
                const isSel = selected === node.id;
                return (
                    <li
                        key={node.id}
                        role="treeitem"
                        data-tree-id={node.id}
                        aria-level={level}
                        aria-expanded={hasKids ? open : undefined}
                        aria-selected={isSel}
                        tabIndex={tabId === node.id ? 0 : -1}
                        onFocus={(e) => { if (e.target === e.currentTarget) setFocusId(node.id); }}
                        className={`rounded-md outline-none ${FOCUS_RING_CLASS}`}
                    >
                        <div
                            onClick={(e) => { e.stopPropagation(); focusNode(node.id); select(node.id); if (hasKids) toggle(node.id); }}
                            style={{ paddingInlineStart: `${(level - 1) * 1}rem` }}
                            className={`flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm ${isSel ? ROW_SELECTED_CLASS : `text-foreground ${ROW_HOVER_CLASS}`}`}
                        >
                            <span className="inline-flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
                                {hasKids ? <KitIcon name={open ? 'ChevronDown' : 'ChevronRight'} size="sm" /> : null}
                            </span>
                            {node.icon ? <KitIcon name={node.icon} size="sm" className={isSel ? '' : 'text-muted-foreground'} /> : null}
                            <span className="min-w-0 flex-1 truncate">{node.label}</span>
                            {node.badge && <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${isSel ? 'bg-card text-card-foreground' : 'bg-chip text-chip-foreground'}`}>{node.badge}</span>}
                        </div>
                        {hasKids && open && renderList(node.children, level + 1, false)}
                    </li>
                );
            })}
        </ul>
    );
    return <div className="w-full min-w-0">{renderList(nodes, 1, true)}</div>;
}

// ------------------------------------------------------------------ Stepper
const STEP_STATUSES = ['complete', 'current', 'upcoming', 'error'] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];
export interface StepperStep { title?: string; description?: string; status?: StepStatus }
export interface StepperProps {
    steps?: StepperStep[];
    current?: number;
    orientation?: 'horizontal' | 'vertical';
    onSelect?: (index: number) => void;
}
const MAX_STEPS = 20;
const STEP_BADGE: Record<StepStatus, string> = {
    complete: TONE_SOLID.primary,
    current: 'border-2 border-primary bg-card text-primary',
    upcoming: 'bg-muted text-muted-foreground',
    error: TONE_SOLID.danger,
};

export function Stepper(props: StepperProps) {
    const strings = useKitStrings();
    const steps = (Array.isArray(props.steps) ? props.steps : []).filter((s): s is StepperStep => isRecord(s) && txt(s.title) !== '').slice(0, MAX_STEPS);
    if (steps.length === 0) return null;
    const cur = typeof props.current === 'number' && Number.isFinite(props.current) ? Math.min(steps.length - 1, Math.max(0, Math.floor(props.current))) : 0;
    const vertical = props.orientation === 'vertical';
    const words: Record<StepStatus, string> = { complete: strings.stepComplete, current: strings.stepCurrent, upcoming: strings.stepUpcoming, error: strings.stepError };
    return (
        <ol aria-label={strings.stepsLabel} className={`m-0 flex list-none p-0 ${vertical ? 'flex-col gap-4' : 'flex-col gap-4 md:flex-row md:items-start md:gap-2'}`}>
            {steps.map((step, i) => {
                const status: StepStatus = pick<StepStatus>(step.status, STEP_STATUSES, i < cur ? 'complete' : i === cur ? 'current' : 'upcoming');
                const clickable = status === 'complete' && typeof props.onSelect === 'function';
                const marker = (
                    <span aria-hidden="true" className={`inline-flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${STEP_BADGE[status]}`}>
                        {status === 'complete' ? <KitIcon name="Check" size="sm" /> : status === 'error' ? <KitIcon name="X" size="sm" /> : i + 1}
                    </span>
                );
                const text = (
                    <span className="flex min-w-0 flex-col text-start">
                        <span className={`break-words text-sm ${status === 'current' ? 'font-semibold text-foreground' : status === 'upcoming' ? 'font-medium text-muted-foreground' : 'font-medium text-foreground'}`}>
                            {txt(step.title)}<span className="sr-only"> ({words[status]})</span>
                        </span>
                        {txt(step.description) && <span className="break-words text-xs text-muted-foreground">{txt(step.description)}</span>}
                    </span>
                );
                return (
                    <li key={i} aria-current={status === 'current' ? 'step' : undefined} className={`flex min-w-0 items-start gap-3 ${vertical ? '' : 'md:flex-1'}`}>
                        {clickable
                            ? <button type="button" onClick={() => props.onSelect?.(i)} className={`flex min-w-0 items-start gap-3 rounded-md ${FOCUS_RING_CLASS}`}>{marker}{text}</button>
                            : <>{marker}{text}</>}
                        {!vertical && i < steps.length - 1 && <span aria-hidden="true" className={`mt-4 hidden h-px flex-1 md:block ${i < cur ? TONE_BG.primary : 'bg-border'}`} />}
                    </li>
                );
            })}
        </ol>
    );
}

