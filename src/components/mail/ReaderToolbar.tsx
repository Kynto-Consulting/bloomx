'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, Mail, MailOpen, MoreHorizontal, Printer, Star, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/I18nProvider';
import { getFolderActions, type MailActionId } from '@/lib/mail-actions';
import { ACTION_META } from './action-meta';
import { ActionMenu, type MenuItemDef } from './ActionMenu';
import { IconButton } from './ui';

export type ReaderMenuKind = 'move' | 'label' | 'snooze' | 'reschedule';

interface Props {
    variant: 'top' | 'bottom';
    folder: string;
    read: boolean;
    starred: boolean;
    hasPrev: boolean;
    hasNext: boolean;
    threadSize: number;
    allExpanded: boolean;
    onBack: () => void;
    onClose: () => void;
    onPrev: () => void;
    onNext: () => void;
    onAction: (action: MailActionId) => void;
    onMenu: (kind: ReaderMenuKind, anchor: HTMLElement) => void;
    onToggleStar: () => void;
    onToggleRead: () => void;
    onPrint: () => void;
    onToggleExpandAll: () => void;
    /** Extensiones (EMAIL_TOOLBAR) u otros controles extra. */
    extra?: ReactNode;
}

const MENU_ACTIONS: MailActionId[] = ['move', 'label', 'snooze', 'reschedule'];

/**
 * Barra del lector: volver/cerrar, anterior/siguiente (j/k), acciones segun la carpeta (archivar/desarchivar,
 * restaurar, eliminar, spam, posponer, etiquetar, mover), destacar, imprimir y "mas". `bottom` es la barra inferior movil.
 */
export function ReaderToolbar({
    variant, folder, read, starred, hasPrev, hasNext, threadSize, allExpanded, onBack, onClose, onPrev, onNext, onAction, onMenu,
    onToggleStar, onToggleRead, onPrint, onToggleExpandAll, extra,
}: Props) {
    const { t } = useI18n();
    const [moreOpen, setMoreOpen] = useState(false);
    const moreRef = useRef<HTMLButtonElement | null>(null);
    const barRef = useRef<HTMLDivElement | null>(null);
    // Ancho disponible: en paneles estrechos caben menos iconos y el resto pasa a "Mas" (siempre visible).
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

    // Leido/destacado van aparte (boton propio / "mas"): el resto son las acciones propias de la carpeta.
    const actions = useMemo(
        () => getFolderActions(folder).filter((a) => a !== 'markRead' && a !== 'star'),
        [folder],
    );
    // Fijos en la barra superior: cerrar, anterior/siguiente, destacar y "Mas" (~210 px) + 34 px por accion.
    const limit = variant === 'bottom' ? 4 : width > 0 ? Math.max(2, Math.min(7, Math.floor((width - 215) / 34))) : 6;
    const visible = actions.slice(0, limit);
    const overflow = actions.slice(limit);

    const run = (action: MailActionId, anchor: HTMLElement | null) => {
        if (MENU_ACTIONS.includes(action)) { if (anchor) onMenu(action as ReaderMenuKind, anchor); } else onAction(action);
    };

    const moreItems: MenuItemDef[] = [
        ...overflow.map((action): MenuItemDef => {
            const meta = ACTION_META[action];
            const Icon = meta.icon;
            return {
                id: action,
                label: t(meta.labelKey),
                icon: <Icon className="h-4 w-4" />,
                destructive: meta.destructive,
                onSelect: () => { const a = moreRef.current; setTimeout(() => run(action, a), 0); },
            };
        }),
        {
            id: 'toggle-read',
            label: read ? t('emailList.actions.markUnread') : t('emailList.actions.markRead'),
            icon: read ? <Mail className="h-4 w-4" /> : <MailOpen className="h-4 w-4" />,
            separatorBefore: overflow.length > 0,
            hint: 'U',
            onSelect: onToggleRead,
        },
        { id: 'print', label: t('mailView.toolbar.print'), icon: <Printer className="h-4 w-4" />, onSelect: onPrint },
        ...(threadSize > 1 ? [{
            id: 'expand-all',
            label: allExpanded ? t('mailView.thread.collapseAll') : t('mailView.thread.expandAll'),
            icon: allExpanded ? <ChevronsDownUp className="h-4 w-4" /> : <ChevronsUpDown className="h-4 w-4" />,
            onSelect: onToggleExpandAll,
        } as MenuItemDef] : []),
    ];

    const iconClass = variant === 'bottom' ? 'h-5 w-5' : 'h-4 w-4';

    const actionButtons = visible.map((action) => {
        const meta = ACTION_META[action];
        const Icon = meta.icon;
        const isMenu = MENU_ACTIONS.includes(action);
        return (
            <IconButton
                key={action}
                label={t(meta.labelKey)}
                destructive={meta.destructive}
                data-reader-action={action}
                aria-haspopup={isMenu ? 'menu' : undefined}
                onClick={(e) => run(action, e.currentTarget)}
            >
                <Icon className={iconClass} aria-hidden="true" />
            </IconButton>
        );
    });

    const moreButton = (
        <>
            <IconButton ref={moreRef} label={t('mailView.toolbar.more')} aria-haspopup="menu" aria-expanded={moreOpen} data-reader-action="more" onClick={() => setMoreOpen((v) => !v)}>
                <MoreHorizontal className={iconClass} aria-hidden="true" />
            </IconButton>
            <ActionMenu open={moreOpen} onClose={() => setMoreOpen(false)} anchorRef={moreRef} label={t('mailView.toolbar.more')} items={moreItems} />
        </>
    );

    if (variant === 'bottom') {
        return (
            <div role="toolbar" aria-label={t('mailView.toolbar.actions')} data-reader-bar="bottom" className="flex items-center justify-around border-t border-border bg-header px-2 py-1 text-header-foreground md:hidden">
                {actionButtons}
                {moreButton}
            </div>
        );
    }

    return (
        <div ref={barRef} role="toolbar" aria-label={t('mailView.toolbar.actions')} data-reader-bar="top" className="sticky top-0 z-10 flex items-center gap-1 border-b border-border bg-header p-2 text-header-foreground">
            <IconButton label={t('mailView.toolbar.back')} onClick={onBack} className="md:hidden"><ArrowLeft className="h-5 w-5" aria-hidden="true" /></IconButton>
            <IconButton label={t('mailView.toolbar.close')} onClick={onClose} className="hidden md:inline-flex"><X className="h-4 w-4" aria-hidden="true" /></IconButton>
            <div className="mx-1 hidden h-5 w-px bg-border md:block" aria-hidden="true" />

            <div className="flex items-center" role="group" aria-label={t('mailView.toolbar.navigate')}>
                <IconButton label={t('mailView.toolbar.prev')} disabled={!hasPrev} onClick={onPrev} data-reader-action="prev"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></IconButton>
                <IconButton label={t('mailView.toolbar.next')} disabled={!hasNext} onClick={onNext} data-reader-action="next"><ChevronRight className="h-4 w-4" aria-hidden="true" /></IconButton>
            </div>
            <div className="mx-1 hidden h-5 w-px bg-border md:block" aria-hidden="true" />

            <div className="hidden min-w-0 items-center md:flex">{actionButtons}</div>

            <div className="ml-auto flex shrink-0 items-center">
                {extra}
                <IconButton
                    label={starred ? t('emailList.row.unstar') : t('emailList.row.star')}
                    pressed={starred}
                    onClick={onToggleStar}
                    className={cn(starred && 'text-warning')}
                    data-reader-action="star"
                >
                    <Star className={cn('h-4 w-4', starred && 'fill-current')} aria-hidden="true" />
                </IconButton>
                <span className="hidden md:inline-flex">{moreButton}</span>
                <span className="md:hidden">
                    <IconButton label={t('mailView.toolbar.print')} onClick={onPrint}><Printer className="h-5 w-5" aria-hidden="true" /></IconButton>
                </span>
            </div>
        </div>
    );
}
