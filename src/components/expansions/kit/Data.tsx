'use client';

/**
 * Kit de extensiones: datos (Table, List, ListItem) y FormShell.
 * Todo el color sale de tokens (tokens.ts); los props son semanticos y se sanean con `pick()`.
 */
import * as React from 'react';
import { DENSITIES, GAPS, TEXT_ALIGNS } from '@/lib/expansions/ui-schema';
import { useI18n } from '@/components/I18nProvider';
import { KitIcon } from './Icon';
import { useKitStrings } from './strings';
import {
    DENSITY_CELL_CLASS, FOCUS_RING_CLASS, GAP_CLASS, GRID_COLUMNS_CLASS, MAX_HEIGHT_CLASS, ROW_HOVER_CLASS, ROW_SELECTED_CLASS,
    SURFACE_CLASS, TEXT_ALIGN_CLASS, TONE_SOFT, TONE_TEXT, CHECK_CLASS, buttonClasses, pick, toTone,
    type Density, type Tone,
} from './tokens';

// ------------------------------------------------------------------ utilidades
/** Texto seguro de un valor arbitrario (nunca objetos React ni `[object Object]`). */
function safeText(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
    try {
        const json = JSON.stringify(value);
        if (!json) return '';
        return json.length > 80 ? `${json.slice(0, 77)}...` : json;
    } catch { return ''; }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const TABLE_FORMATS = ['text', 'number', 'date', 'datetime', 'boolean', 'badge', 'code'] as const;
const COLUMN_WIDTHS = ['xs', 'sm', 'md', 'lg'] as const;
const WIDTH_CLASS: Record<(typeof COLUMN_WIDTHS)[number], string> = { xs: 'w-20 min-w-20', sm: 'w-32 min-w-32', md: 'w-48 min-w-48', lg: 'w-80 min-w-80' };
const MAX_ROWS = 5000;
const SKELETON_ROWS = 5;

export interface TableColumn {
    key: string;
    label?: string;
    sortable?: boolean;
    align?: 'start' | 'center' | 'end';
    format?: 'text' | 'number' | 'date' | 'datetime' | 'boolean' | 'badge' | 'code';
    tone?: Tone;
    width?: 'xs' | 'sm' | 'md' | 'lg';
}
export interface TableAction {
    label: string;
    icon?: string;
    tone?: Tone;
    onPress?: (row: Record<string, unknown>) => void;
}
export interface TableProps {
    columns?: TableColumn[];
    rows?: unknown[];
    /** Alias de `rows`. */
    data?: unknown[];
    rowKey?: string;
    selectable?: 'none' | 'single' | 'multiple';
    /** Claves seleccionadas (controlado). Sin este prop la seleccion es interna. */
    selected?: string[];
    onSelectionChange?: (keys: string[]) => void;
    pageSize?: number;
    density?: Density;
    emptyText?: string;
    loading?: boolean;
    actions?: TableAction[];
    onRowPress?: (row: Record<string, unknown>) => void;
    caption?: string;
}

interface NormColumn { key: string; label: string; sortable: boolean; align: 'start' | 'center' | 'end'; format: (typeof TABLE_FORMATS)[number]; tone: Tone | undefined; width: (typeof COLUMN_WIDTHS)[number] | undefined }
interface NormRow { id: string; index: number; data: Record<string, unknown> }

function parseDate(value: unknown): Date | null {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    if (typeof value === 'string' && !value.trim()) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}
function parseNumber(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() !== '') { const n = Number(value); return Number.isFinite(n) ? n : null; }
    return null;
}
const isEmpty = (v: unknown) => v === null || v === undefined || v === '';

function compareValues(a: unknown, b: unknown, format: string, locale: string): number {
    const ea = isEmpty(a), eb = isEmpty(b);
    if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1; // vacios siempre al final (se corrige al invertir)
    if (format === 'date' || format === 'datetime') {
        const da = parseDate(a), db = parseDate(b);
        if (da && db) return da.getTime() - db.getTime();
    }
    if (format === 'boolean') return Number(Boolean(a)) - Number(Boolean(b));
    const na = parseNumber(a), nb = parseNumber(b);
    if (na !== null && nb !== null) return na - nb;
    try { return safeText(a).localeCompare(safeText(b), locale, { numeric: true, sensitivity: 'base' }); } catch { return safeText(a) < safeText(b) ? -1 : 1; }
}

const skeletonWidths = ['w-3/4', 'w-1/2', 'w-2/3', 'w-5/6', 'w-1/3'];

export function Table(props: TableProps) {
    const { columns, rows, data, rowKey, selected, onSelectionChange, onRowPress, actions } = props;
    const strings = useKitStrings();
    const { intlLocale, locale } = useI18n();
    const uid = React.useId();
    const en = locale === 'en';

    const density = pick<Density>(props.density, DENSITIES, 'comfortable');
    const selectable = pick(props.selectable, ['none', 'single', 'multiple'] as const, 'none');
    const pageSize = typeof props.pageSize === 'number' && Number.isFinite(props.pageSize) && props.pageSize > 0 ? Math.min(Math.floor(props.pageSize), 200) : 0;
    const cell = DENSITY_CELL_CLASS[density];
    const loading = props.loading === true;

    const cols = React.useMemo<NormColumn[]>(() => {
        const list = Array.isArray(columns) ? columns : [];
        return list.filter((c): c is TableColumn => isRecord(c) && typeof c.key === 'string' && c.key !== '').map((c) => ({
            key: c.key,
            label: typeof c.label === 'string' ? c.label : c.key,
            sortable: c.sortable === true,
            align: pick(c.align, TEXT_ALIGNS, 'start'),
            format: pick(c.format, TABLE_FORMATS, 'text'),
            tone: c.tone === undefined ? undefined : toTone(c.tone),
            width: c.width === undefined ? undefined : pick(c.width, COLUMN_WIDTHS, 'md'),
        }));
    }, [columns]);

    const { allRows, truncated } = React.useMemo(() => {
        const source = Array.isArray(rows) ? rows : Array.isArray(data) ? data : [];
        const limited = source.length > MAX_ROWS ? source.slice(0, MAX_ROWS) : source;
        const seen = new Set<string>();
        const list: NormRow[] = limited.map((raw, index) => {
            const d = isRecord(raw) ? raw : {};
            let id = rowKey && !isEmpty(d[rowKey]) ? safeText(d[rowKey]) : String(index);
            if (seen.has(id)) id = `${id}#${index}`;
            seen.add(id);
            return { id, index, data: d };
        });
        return { allRows: list, truncated: source.length > MAX_ROWS };
    }, [rows, data, rowKey]);

    // --- orden
    const [sort, setSort] = React.useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
    const sorted = React.useMemo(() => {
        if (!sort) return allRows;
        const col = cols.find((c) => c.key === sort.key);
        if (!col) return allRows;
        const mul = sort.dir === 'asc' ? 1 : -1;
        return [...allRows].sort((a, b) => {
            const ea = isEmpty(a.data[col.key]), eb = isEmpty(b.data[col.key]);
            if (ea !== eb) return ea ? 1 : -1; // vacios al final en ambos sentidos
            return mul * compareValues(a.data[col.key], b.data[col.key], col.format, intlLocale) || a.index - b.index;
        });
    }, [allRows, cols, sort, intlLocale]);
    const toggleSort = (key: string) => setSort((cur) => (!cur || cur.key !== key ? { key, dir: 'asc' } : cur.dir === 'asc' ? { key, dir: 'desc' } : null));

    // --- paginacion
    const [page, setPage] = React.useState(0);
    const totalPages = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
    const current = Math.min(page, totalPages - 1);
    const visible = pageSize ? sorted.slice(current * pageSize, (current + 1) * pageSize) : sorted;

    // --- seleccion
    const [innerSelected, setInnerSelected] = React.useState<string[]>([]);
    const selectedKeys = React.useMemo(() => new Set((Array.isArray(selected) ? selected : innerSelected).filter((k) => typeof k === 'string' || typeof k === 'number').map(String)), [selected, innerSelected]);
    const emit = (keys: string[]) => { if (!Array.isArray(selected)) setInnerSelected(keys); onSelectionChange?.(keys); };
    const toggleRow = (id: string) => {
        if (selectable === 'single') return emit([id]);
        const next = new Set(selectedKeys);
        if (next.has(id)) next.delete(id); else next.add(id);
        emit([...next]);
    };
    const pageIds = visible.map((r) => r.id);
    const selectedOnPage = pageIds.filter((id) => selectedKeys.has(id)).length;
    const allOnPage = pageIds.length > 0 && selectedOnPage === pageIds.length;
    const toggleAll = () => {
        const next = new Set(selectedKeys);
        if (allOnPage) pageIds.forEach((id) => next.delete(id)); else pageIds.forEach((id) => next.add(id));
        emit([...next]);
    };
    const allRef = React.useRef<HTMLInputElement>(null);
    React.useEffect(() => { if (allRef.current) allRef.current.indeterminate = selectedOnPage > 0 && !allOnPage; });

    const rowActions = Array.isArray(actions) ? actions.filter((a): a is TableAction => isRecord(a) && typeof a.label === 'string') : [];
    const pressable = typeof onRowPress === 'function';
    const colCount = cols.length + (selectable !== 'none' ? 1 : 0) + (rowActions.length ? 1 : 0);
    const yes = en ? 'Yes' : 'Si', no = 'No';

    const renderValue = (col: NormColumn, raw: unknown, selectedRow: boolean): React.ReactNode => {
        const text = safeText(raw);
        switch (col.format) {
            case 'number': {
                const n = parseNumber(raw);
                if (n === null) return text;
                try { return new Intl.NumberFormat(intlLocale).format(n); } catch { return text; }
            }
            case 'date':
            case 'datetime': {
                const d = parseDate(raw);
                if (!d) return text;
                const dateOnly = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim());
                try {
                    return new Intl.DateTimeFormat(intlLocale, col.format === 'date' || dateOnly ? { dateStyle: 'medium', ...(dateOnly ? { timeZone: 'UTC' } : {}) } : { dateStyle: 'medium', timeStyle: 'short' }).format(d);
                } catch { return text; }
            }
            case 'boolean': {
                if (isEmpty(raw)) return '';
                const v = raw === true || raw === 'true' || raw === 1;
                return (
                    <span className={`inline-flex items-center gap-1.5 ${v && !selectedRow ? 'text-success' : ''}`}>
                        <KitIcon name={v ? 'Check' : 'X'} size="sm" />{v ? yes : no}
                    </span>
                );
            }
            case 'badge':
                if (text === '') return '';
                return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONE_SOFT[col.tone ?? 'neutral']}`}>{text}</span>;
            case 'code':
                if (text === '') return '';
                return <code className="rounded bg-code px-1.5 py-0.5 font-mono text-xs text-code-foreground">{text}</code>;
            default:
                return text;
        }
    };

    const onRowKey = (e: React.KeyboardEvent<HTMLTableRowElement>, row: NormRow) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); onRowPress?.(row.data); }
    };
    const onRowClick = (e: React.MouseEvent<HTMLTableRowElement>, row: NormRow) => {
        if ((e.target as HTMLElement).closest('button, input, a, label')) return;
        onRowPress?.(row.data);
    };

    const ariaLabelRow = strings.selectRow;
    const rangeText = selectedKeys.size > 0 ? `${selectedKeys.size} ${strings.rowsSelected}` : '';

    return (
        <div className="flex w-full flex-col gap-2">
            <div className={`${SURFACE_CLASS} overflow-x-auto`}>
                <table className="w-full border-collapse text-sm" aria-busy={loading || undefined} aria-rowcount={loading ? undefined : sorted.length + 1}>
                    <caption className={props.caption ? 'px-4 py-2 text-left text-sm font-medium text-foreground' : 'sr-only'}>{props.caption || (en ? 'Data table' : 'Tabla de datos')}</caption>
                    <thead className="bg-muted text-muted-foreground">
                        <tr>
                            {selectable !== 'none' && (
                                <th scope="col" className={`${cell} w-10 text-left`}>
                                    {selectable === 'multiple'
                                        ? <input ref={allRef} type="checkbox" className={CHECK_CLASS} aria-label={strings.selectAll} checked={allOnPage} onChange={toggleAll} disabled={loading || pageIds.length === 0} />
                                        : <span className="sr-only">{strings.selectRow}</span>}
                                </th>
                            )}
                            {cols.map((col) => {
                                const dir = sort?.key === col.key ? sort.dir : null;
                                return (
                                    <th
                                        key={col.key} scope="col"
                                        aria-sort={col.sortable ? (dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none') : undefined}
                                        className={`${cell} font-semibold ${TEXT_ALIGN_CLASS[col.align]} ${col.width ? WIDTH_CLASS[col.width] : ''}`}
                                    >
                                        {col.sortable ? (
                                            <button
                                                type="button" onClick={() => toggleSort(col.key)}
                                                className={`inline-flex items-center gap-1 rounded font-semibold hover:text-foreground ${FOCUS_RING_CLASS}`}
                                                title={`${strings.sortBy} ${col.label}`}
                                            >
                                                {col.label}
                                                <KitIcon name={dir === 'asc' ? 'ArrowUp' : dir === 'desc' ? 'ArrowDown' : 'ArrowUpDown'} size="xs" />
                                            </button>
                                        ) : col.label}
                                    </th>
                                );
                            })}
                            {rowActions.length > 0 && <th scope="col" className={`${cell} w-px`}><span className="sr-only">{strings.moreActions}</span></th>}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border text-foreground">
                        {loading && Array.from({ length: SKELETON_ROWS }, (_, i) => (
                            <tr key={`sk${i}`} aria-hidden="true">
                                {Array.from({ length: Math.max(colCount, 1) }, (_, j) => (
                                    <td key={j} className={cell}><div className={`h-4 animate-pulse rounded bg-muted ${skeletonWidths[(i + j) % skeletonWidths.length]}`} /></td>
                                ))}
                            </tr>
                        ))}
                        {!loading && visible.length === 0 && (
                            <tr><td colSpan={Math.max(colCount, 1)} className={`${cell} py-8 text-center text-muted-foreground`}>{typeof props.emptyText === 'string' && props.emptyText ? props.emptyText : strings.empty}</td></tr>
                        )}
                        {!loading && visible.map((row, i) => {
                            const isSel = selectedKeys.has(row.id);
                            return (
                                <tr
                                    key={row.id}
                                    aria-selected={selectable !== 'none' ? isSel : undefined}
                                    aria-rowindex={(pageSize ? current * pageSize : 0) + i + 2}
                                    tabIndex={pressable ? 0 : undefined}
                                    onClick={pressable ? (e) => onRowClick(e, row) : undefined}
                                    onKeyDown={pressable ? (e) => onRowKey(e, row) : undefined}
                                    className={`${isSel ? ROW_SELECTED_CLASS : ROW_HOVER_CLASS} ${pressable ? `cursor-pointer ${FOCUS_RING_CLASS} focus-visible:ring-inset` : ''}`}
                                >
                                    {selectable !== 'none' && (
                                        <td className={`${cell} w-10`}>
                                            <input
                                                type={selectable === 'single' ? 'radio' : 'checkbox'} name={selectable === 'single' ? `${uid}-sel` : undefined}
                                                className={CHECK_CLASS} aria-label={ariaLabelRow} checked={isSel} onChange={() => toggleRow(row.id)}
                                            />
                                        </td>
                                    )}
                                    {cols.map((col) => (
                                        <td key={col.key} className={`${cell} ${TEXT_ALIGN_CLASS[col.align]} ${col.tone && col.format !== 'badge' && !isSel ? TONE_TEXT[col.tone] : ''}`}>
                                            {renderValue(col, row.data[col.key], isSel)}
                                        </td>
                                    ))}
                                    {rowActions.length > 0 && (
                                        <td className={`${cell} w-px whitespace-nowrap text-right`}>
                                            <div className="inline-flex items-center gap-1">
                                                {rowActions.map((action, k) => (
                                                    <button
                                                        key={k} type="button" aria-label={action.label} title={action.label}
                                                        className={buttonClasses({ variant: 'ghost', tone: toTone(action.tone), size: 'sm', icon: true })}
                                                        onClick={(e) => { e.stopPropagation(); action.onPress?.(row.data); }}
                                                    >
                                                        <KitIcon name={action.icon || 'Ellipsis'} size="sm" />
                                                    </button>
                                                ))}
                                            </div>
                                        </td>
                                    )}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {truncated && <p role="status" className="text-xs text-muted-foreground">{en ? `Showing the first ${MAX_ROWS} rows.` : `Mostrando las primeras ${MAX_ROWS} filas.`}</p>}
            {(pageSize > 0 || rangeText) && !loading && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                    <span>{rangeText}</span>
                    {pageSize > 0 && (
                        <div className="flex items-center gap-2">
                            <button type="button" className={buttonClasses({ variant: 'outline', size: 'sm' })} disabled={current <= 0} onClick={() => setPage(current - 1)}>
                                <KitIcon name="ChevronLeft" size="sm" /><span className="sr-only">{strings.previousPage}</span>
                            </button>
                            <span aria-live="polite">{strings.page} {current + 1} {strings.of} {totalPages}</span>
                            <button type="button" className={buttonClasses({ variant: 'outline', size: 'sm' })} disabled={current >= totalPages - 1} onClick={() => setPage(current + 1)}>
                                <KitIcon name="ChevronRight" size="sm" /><span className="sr-only">{strings.nextPage}</span>
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ------------------------------------------------------------------ List
export interface ListProps {
    children?: React.ReactNode;
    columns?: 1 | 2 | 3 | 4;
    gap?: (typeof GAPS)[number];
    variant?: 'plain' | 'divided' | 'cards';
    maxHeight?: 'sm' | 'md' | 'lg' | 'xl';
    empty?: React.ReactNode;
}

export function List(props: ListProps) {
    const strings = useKitStrings();
    const items = React.Children.toArray(props.children).filter((c) => c !== null && c !== undefined && typeof c !== 'boolean');
    const columns = pick<number>(Number(props.columns), [1, 2, 3, 4], 1);
    const variant = pick(props.variant, ['plain', 'divided', 'cards'] as const, 'plain');
    const gap = pick<number>(props.gap, GAPS, 2);
    const scroll = typeof props.maxHeight === 'string' && MAX_HEIGHT_CLASS[props.maxHeight] ? MAX_HEIGHT_CLASS[props.maxHeight] : '';

    if (items.length === 0) {
        return <div className="text-sm text-muted-foreground">{props.empty !== undefined && props.empty !== null ? props.empty : strings.empty}</div>;
    }
    const divided = variant === 'divided';
    const listClass = [
        'grid w-full', GRID_COLUMNS_CLASS[columns], divided && columns === 1 ? 'gap-0 divide-y divide-border' : GAP_CLASS[gap],
        divided ? 'rounded-lg border border-border bg-card text-card-foreground' : '', scroll,
    ].filter(Boolean).join(' ');
    return (
        <ul role="list" className={listClass} tabIndex={scroll ? 0 : undefined}>
            {items.map((child, i) => (
                <li key={(child as React.ReactElement).key ?? i} className={variant === 'cards' ? `${SURFACE_CLASS} overflow-hidden` : 'min-w-0'}>{child}</li>
            ))}
        </ul>
    );
}

export interface ListItemProps {
    title?: string;
    description?: string;
    meta?: string;
    icon?: string;
    tone?: Tone;
    selected?: boolean;
    onPress?: () => void;
    /** Acciones finales alineadas a la derecha. */
    children?: React.ReactNode;
}

export function ListItem(props: ListItemProps) {
    const tone = toTone(props.tone);
    const selected = props.selected === true;
    const pressable = typeof props.onPress === 'function';
    const title = safeText(props.title), description = safeText(props.description), meta = safeText(props.meta);
    const hasActions = React.Children.toArray(props.children).length > 0;

    const body = (
        <>
            {props.icon && <KitIcon name={props.icon} size="lg" className={selected ? '' : TONE_TEXT[tone]} />}
            <span className="flex min-w-0 flex-1 flex-col">
                {title && <span className="truncate text-sm font-medium">{title}</span>}
                {description && <span className={`text-sm ${selected ? 'text-row-selected-foreground' : 'text-muted-foreground'}`}>{description}</span>}
            </span>
            {meta && <span className={`shrink-0 text-xs ${selected ? 'text-row-selected-foreground' : 'text-muted-foreground'}`}>{meta}</span>}
        </>
    );
    const bodyClass = 'flex min-w-0 flex-1 items-center gap-3 p-3 text-left';
    return (
        <div className={`flex items-center gap-2 ${selected ? ROW_SELECTED_CLASS : 'text-foreground'}`}>
            {pressable ? (
                <button type="button" aria-current={selected || undefined} onClick={() => props.onPress?.()} className={`${bodyClass} ${ROW_HOVER_CLASS} ${FOCUS_RING_CLASS} focus-visible:ring-inset rounded-[inherit]`}>{body}</button>
            ) : <div className={bodyClass}>{body}</div>}
            {hasActions && <div className="flex shrink-0 items-center justify-end gap-2 pr-3">{props.children}</div>}
        </div>
    );
}

// ------------------------------------------------------------------ FormShell
export type FormStatus = 'idle' | 'loading' | 'error' | 'success';

export interface FormShellProps {
    children?: React.ReactNode;
    status?: FormStatus;
    errorMessage?: string;
    successMessage?: string;
    submitLabel?: string;
    cancelLabel?: string;
    onSubmit?: () => void;
    onCancel?: () => void;
    gap?: (typeof GAPS)[number];
}

export function FormShell(props: FormShellProps) {
    const strings = useKitStrings();
    const status = pick<FormStatus>(props.status, ['idle', 'loading', 'error', 'success'], 'idle');
    const gap = pick<number>(props.gap, GAPS, 4);
    const loading = status === 'loading';
    const str = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v : fallback);

    return (
        <form
            noValidate aria-busy={loading || undefined}
            className={`flex w-full flex-col ${GAP_CLASS[gap]}`}
            onSubmit={(e) => { e.preventDefault(); if (!loading) props.onSubmit?.(); }}
        >
            <div className={`flex flex-col ${GAP_CLASS[gap]}`}>{props.children}</div>
            {status === 'error' && (
                <div role="alert" className={`flex items-start gap-2 rounded-md p-3 text-sm ${TONE_SOFT.danger}`}>
                    <KitIcon name="CircleAlert" size="md" className="mt-0.5 text-destructive" /><span>{str(props.errorMessage, strings.error)}</span>
                </div>
            )}
            {status === 'success' && (
                <div role="status" aria-live="polite" className={`flex items-start gap-2 rounded-md p-3 text-sm ${TONE_SOFT.success}`}>
                    <KitIcon name="CircleCheck" size="md" className="mt-0.5 text-success" /><span>{str(props.successMessage, strings.saved)}</span>
                </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
                <button type="submit" disabled={loading} aria-busy={loading || undefined} className={buttonClasses({ variant: 'solid', tone: 'primary' })}>
                    {loading && <KitIcon name="LoaderCircle" size="sm" className="motion-safe:animate-spin" />}
                    {str(props.submitLabel, strings.submit)}
                </button>
                {typeof props.onCancel === 'function' && (
                    <button type="button" disabled={loading} onClick={() => props.onCancel?.()} className={buttonClasses({ variant: 'outline' })}>{str(props.cancelLabel, strings.cancel)}</button>
                )}
            </div>
        </form>
    );
}

