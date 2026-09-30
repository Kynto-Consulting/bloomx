'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MoreHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/I18nProvider';
import { SCOPE_ACTIONS, getCommonActions, type MailActionId } from '@/lib/mail-actions';
import { ACTION_META } from './action-meta';
import { ActionMenu, type MenuItemDef } from './ActionMenu';
import { IconButton } from './ui';

export type BulkMenuKind = 'move' | 'label' | 'snooze' | 'reschedule';

interface Props {
    /** `header`: sustituye la cabecera de la lista (escritorio). `bottom`: barra inferior (movil). */
    variant: 'header' | 'bottom';
    count: number;
    allSelected: boolean;
    /** Carpetas de los correos seleccionados (decide las acciones disponibles). */
    folders: string[];
    allRead: boolean;
    allStarred: boolean;
    /** Acciones que dependen de una sola carpeta deben ocultarse en modo "toda la carpeta"? No: se confirman aparte. */
    onSelectAll: () => void;
    onClear: () => void;
    onAction: (action: MailActionId) => void;
    onMenu: (kind: BulkMenuKind, anchor: HTMLElement) => void;
    /** Seleccion de "toda la carpeta" (filtro incluido): solo las acciones que el servidor aplica por alcance. */
    wholeFolder?: boolean;
    /** Total real de la seleccion de toda la carpeta (conteo exacto del servidor). */
    wholeCount?: number;
    /** Cuantas acciones se muestran como icono; el resto va a "Mas". */
    maxVisible?: number;
    className?: string;
}

/** Barra contextual de acciones masivas: contador (aria-live), seleccionar todos y las acciones validas para la carpeta. */
export function BulkBar({ variant, count, allSelected, folders, allRead, allStarred, onSelectAll, onClear, onAction, onMenu, wholeFolder, wholeCount, maxVisible, className }: Props) {
    const { t } = useI18n();
    const [moreOpen, setMoreOpen] = useState(false);
    const moreRef = useRef<HTMLButtonElement | null>(null);
    const barRef = useRef<HTMLDivElement | null>(null);
    // En paneles estrechos caben menos iconos: el resto pasa a "Mas" (la barra nunca se desborda ni tapa el contador).
    const [width, setWidth] = useState(0);
    useEffect(() => {
        const el = barRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const update = () => setWidth(el.clientWidth);
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const actions = useMemo(() => {
        const all = getCommonActions(folders, { allRead, allStarred });
        return wholeFolder ? all.filter((a) => SCOPE_ACTIONS.includes(a)) : all;
    }, [folders, allRead, allStarred, wholeFolder]);
    // Cabecera: contador + casilla + limpiar ocupan ~190 px; cada accion 34 px (minimo 2 + "Mas").
    const fit = width > 0 && variant === 'header' ? Math.max(2, Math.floor((width - 190) / 34)) : actions.length;
    const limit = maxVisible ?? (variant === 'bottom' ? 4 : Math.min(actions.length, fit));
    const visible = actions.length > limit ? actions.slice(0, limit - 1) : actions;
    const overflow = actions.length > limit ? actions.slice(limit - 1) : [];

    const run = (action: MailActionId, anchor?: HTMLElement | null) => {
        if (action === 'move' || action === 'label' || action === 'snooze' || action === 'reschedule') {
            const el = anchor ?? moreRef.current;
            if (el) onMenu(action, el);
        } else {
            onAction(action);
        }
    };

    const moreItems: MenuItemDef[] = overflow.map((action) => {
        const meta = ACTION_META[action];
        const Icon = meta.icon;
        return {
            id: action,
            label: t(meta.labelKey),
            icon: <Icon className="h-4 w-4" />,
            destructive: meta.destructive,
            // Los menus de mover/etiquetar/posponer se anclan al boton "Mas" (el menu de "Mas" se cierra antes).
            onSelect: () => { const anchor = moreRef.current; setTimeout(() => run(action, anchor), 0); },
        };
    });

    const iconClass = variant === 'bottom' ? 'h-5 w-5' : 'h-4 w-4';

    return (
        <div
            ref={barRef}
            role="toolbar"
            aria-label={t('emailList.bulk.toolbar')}
            data-bulk-bar={variant}
            className={cn(
                variant === 'bottom'
                    ? 'flex h-14 items-center justify-between gap-1 rounded-xl border border-border bg-popover px-2 text-popover-foreground shadow-lg'
                    : 'flex w-full items-center gap-2',
                className,
            )}
        >
            <div className="flex min-w-0 shrink items-center gap-2">
                {variant === 'header' && (
                    <input
                        type="checkbox"
                        aria-label={t('emailList.selectAll')}
                        className="h-4 w-4 rounded border-input accent-primary"
                        checked={allSelected}
                        onChange={onSelectAll}
                    />
                )}
                {variant === 'bottom' && (
                    <IconButton label={t('emailList.bulk.clear')} onClick={onClear}><X className="h-5 w-5" aria-hidden="true" /></IconButton>
                )}
                <span className="truncate whitespace-nowrap text-sm font-medium" role="status" aria-live="polite">{wholeFolder && wholeCount ? t('emailList.selectedWhole', { n: wholeCount }) : t('emailList.selectedCount', { n: count })}</span>
            </div>
            <div className={cn('flex shrink-0 items-center gap-0.5', variant === 'header' && 'ml-auto')}>
                {visible.map((action) => {
                    const meta = ACTION_META[action];
                    const Icon = meta.icon;
                    const menu = action === 'move' || action === 'label' || action === 'snooze' || action === 'reschedule';
                    return (
                        <IconButton
                            key={action}
                            label={t(meta.labelKey)}
                            destructive={meta.destructive}
                            data-bulk-action={action}
                            aria-haspopup={menu ? 'menu' : undefined}
                            onClick={(e) => run(action, e.currentTarget)}
                        >
                            <Icon className={iconClass} aria-hidden="true" />
                        </IconButton>
                    );
                })}
                {overflow.length > 0 && (
                    <>
                        <IconButton ref={moreRef} label={t('emailList.bulk.more')} aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
                            <MoreHorizontal className={iconClass} aria-hidden="true" />
                        </IconButton>
                        <ActionMenu open={moreOpen} onClose={() => setMoreOpen(false)} anchorRef={moreRef} label={t('emailList.bulk.more')} items={moreItems} />
                    </>
                )}
                {variant === 'header' && (
                    <IconButton label={t('emailList.bulk.clear')} onClick={onClear} className="ml-1"><X className="h-4 w-4" aria-hidden="true" /></IconButton>
                )}
            </div>
        </div>
    );
}

interface BannerProps {
    loadedCount: number;
    wholeCount: number;
    canSelectWhole: boolean;
    wholeSelected: boolean;
    loading: boolean;
    onSelectWhole: () => void;
    onClear: () => void;
}

/** Aviso bajo la cabecera: "Se seleccionaron las N cargadas. Seleccionar las M de toda la carpeta". */
export function SelectionBanner({ loadedCount, wholeCount, canSelectWhole, wholeSelected, loading, onSelectWhole, onClear }: BannerProps) {
    const { t } = useI18n();
    if (!canSelectWhole && !wholeSelected) return null;
    return (
        <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-muted px-4 py-2 text-xs text-foreground">
            {wholeSelected ? (
                <>
                    <span>{t('emailList.selection.whole', { n: wholeCount })}</span>
                    <button type="button" onClick={onClear} className="font-medium text-link underline hover:text-link-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('emailList.selection.clear')}</button>
                </>
            ) : (
                <>
                    <span>{t('emailList.selection.loaded', { n: loadedCount })}</span>
                    <button
                        type="button"
                        disabled={loading}
                        onClick={onSelectWhole}
                        className="font-medium text-link underline hover:text-link-hover disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        {loading ? t('common.loading') : t('emailList.selection.selectWhole', { n: wholeCount })}
                    </button>
                </>
            )}
        </div>
    );
}
