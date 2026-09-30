'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/I18nProvider';
import { EmptyState, LoadingState } from './ui';

/**
 * Tabla de datos de la consola. Controlada (orden y seleccion las decide la pagina, el orden normalmente lo aplica el servidor).
 * Accesibilidad: <caption> (visualmente oculta), th scope="col", aria-sort en la columna ordenada, boton de orden por
 * encabezado (Intro/Espacio), casilla por fila con nombre accesible, casilla "todas" con estado mixto, fila seleccionada
 * con aria-selected. En movil la tabla hace scroll horizontal y las columnas secundarias se ocultan (`hideBelow`).
 */

export interface Column<T> {
    id: string;
    header: string;
    cell: (row: T) => React.ReactNode;
    sortable?: boolean;
    className?: string;
    /** Oculta la columna por debajo de este ancho (se sigue viendo en el detalle). */
    hideBelow?: 'sm' | 'md' | 'lg';
    /** Celda que identifica la fila (se marca como <th scope="row">). */
    isRowHeader?: boolean;
}

export interface SortState {
    id: string;
    dir: 'asc' | 'desc';
}

export interface DataTableProps<T> {
    caption: string;
    columns: Column<T>[];
    rows: T[];
    getRowId: (row: T) => string;
    sort?: SortState | null;
    onSortChange?: (next: SortState) => void;
    selectable?: boolean;
    selected?: readonly string[];
    onSelectedChange?: (ids: string[]) => void;
    /** Nombre accesible de la fila (para la casilla y el boton de detalle). */
    rowLabel?: (row: T) => string;
    onRowActivate?: (row: T) => void;
    activeRowId?: string | null;
    loading?: boolean;
    empty?: React.ReactNode;
    className?: string;
    minWidth?: number;
}

const HIDE: Record<NonNullable<Column<unknown>['hideBelow']>, string> = {
    sm: 'hidden sm:table-cell',
    md: 'hidden md:table-cell',
    lg: 'hidden lg:table-cell',
};

export function DataTable<T>({
    caption, columns, rows, getRowId, sort, onSortChange, selectable, selected = [], onSelectedChange, rowLabel,
    onRowActivate, activeRowId, loading, empty, className, minWidth = 640,
}: DataTableProps<T>) {
    const { t } = useI18n();
    const selectedSet = React.useMemo(() => new Set(selected), [selected]);
    const pageIds = React.useMemo(() => rows.map(getRowId), [rows, getRowId]);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedSet.has(id));
    const someSelected = !allSelected && pageIds.some((id) => selectedSet.has(id));
    const headCheckRef = React.useRef<HTMLInputElement>(null);
    React.useEffect(() => {
        if (headCheckRef.current) headCheckRef.current.indeterminate = someSelected;
    }, [someSelected]);

    const toggleAll = () => {
        if (!onSelectedChange) return;
        if (allSelected) onSelectedChange(selected.filter((id) => !pageIds.includes(id)));
        else onSelectedChange(Array.from(new Set([...selected, ...pageIds])));
    };
    const toggleOne = (id: string) => {
        if (!onSelectedChange) return;
        onSelectedChange(selectedSet.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    };
    const cycleSort = (col: Column<T>) => {
        if (!onSortChange || !col.sortable) return;
        onSortChange({ id: col.id, dir: sort?.id === col.id && sort.dir === 'asc' ? 'desc' : 'asc' });
    };

    const colCount = columns.length + (selectable ? 1 : 0);

    return (
        <div className={cn('overflow-x-auto rounded-lg border border-border bg-card', className)}>
            <table className="w-full text-sm" style={{ minWidth }} aria-busy={loading || undefined}>
                <caption className="sr-only">{caption}</caption>
                <thead className="bg-muted/60 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <tr>
                        {selectable && (
                            <th scope="col" className="w-10 px-3 py-2.5">
                                <input
                                    ref={headCheckRef}
                                    type="checkbox"
                                    checked={allSelected}
                                    onChange={toggleAll}
                                    aria-label={t('admin.console.common.selectAll')}
                                    disabled={rows.length === 0}
                                    className="h-4 w-4 rounded border-input accent-primary"
                                />
                            </th>
                        )}
                        {columns.map((col) => {
                            const active = sort?.id === col.id;
                            const ariaSort = col.sortable ? (active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined;
                            return (
                                <th key={col.id} scope="col" aria-sort={ariaSort} className={cn('px-3 py-2.5', col.hideBelow && HIDE[col.hideBelow], col.className)}>
                                    {col.sortable && onSortChange ? (
                                        <button
                                            type="button"
                                            onClick={() => cycleSort(col)}
                                            aria-label={`${t('admin.console.common.sortBy', { column: col.header })}${active ? ` (${t(sort!.dir === 'asc' ? 'admin.console.common.sortedAsc' : 'admin.console.common.sortedDesc')})` : ''}`}
                                            className="-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 uppercase tracking-wide hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        >
                                            {col.header}
                                            {active ? (
                                                sort!.dir === 'asc' ? <ArrowUp className="h-3 w-3" aria-hidden="true" /> : <ArrowDown className="h-3 w-3" aria-hidden="true" />
                                            ) : (
                                                <ArrowUpDown className="h-3 w-3 opacity-50" aria-hidden="true" />
                                            )}
                                        </button>
                                    ) : (
                                        col.header
                                    )}
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                <tbody className={cn('divide-y divide-border/60', loading && rows.length > 0 && 'opacity-60')}>
                    {rows.map((row) => {
                        const id = getRowId(row);
                        const isSel = selectedSet.has(id);
                        const name = rowLabel?.(row) ?? id;
                        return (
                            <tr
                                key={id}
                                aria-selected={selectable ? isSel : undefined}
                                data-active={activeRowId === id ? 'true' : undefined}
                                onClick={onRowActivate ? (e) => {
                                    // No robar los clics de controles interactivos de la propia fila.
                                    if ((e.target as HTMLElement).closest('a,button,input,select,textarea,label,[role="menuitem"]')) return;
                                    onRowActivate(row);
                                } : undefined}
                                className={cn(
                                    'transition-colors hover:bg-row-hover',
                                    onRowActivate && 'cursor-pointer',
                                    (isSel || activeRowId === id) && 'bg-row-selected/40',
                                )}
                            >
                                {selectable && (
                                    <td className="w-10 px-3 py-3">
                                        <input
                                            type="checkbox"
                                            checked={isSel}
                                            onChange={() => toggleOne(id)}
                                            aria-label={t('admin.console.common.selectRow', { name })}
                                            className="h-4 w-4 rounded border-input accent-primary"
                                        />
                                    </td>
                                )}
                                {columns.map((col) => {
                                    const Cell = col.isRowHeader ? 'th' : 'td';
                                    return (
                                        <Cell
                                            key={col.id}
                                            scope={col.isRowHeader ? 'row' : undefined}
                                            className={cn('px-3 py-3 group-data-[density=compact]/console:py-1.5 text-left align-middle font-normal', col.hideBelow && HIDE[col.hideBelow], col.className)}
                                        >
                                            {col.cell(row)}
                                        </Cell>
                                    );
                                })}
                            </tr>
                        );
                    })}
                    {rows.length === 0 && (
                        <tr>
                            <td colSpan={colCount} className="p-0">
                                {loading ? <LoadingState /> : (empty ?? <EmptyState title={t('admin.console.common.emptyTitle')} />)}
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}

/** Boton con aspecto de enlace para abrir el detalle desde la celda principal (accesible por teclado). */
export function RowButton({ children, onClick, label, className }: { children: React.ReactNode; onClick: () => void; label?: string; className?: string }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            className={cn('max-w-full truncate rounded text-left font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
        >
            {children}
        </button>
    );
}
