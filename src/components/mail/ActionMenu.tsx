'use client';

import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Check, Minus } from 'lucide-react';
import { Popover } from '@/components/ui/Popover';
import { cn } from '@/lib/utils';

export interface MenuItemDef {
    id: string;
    label: string;
    icon?: ReactNode;
    /** Elemento con casilla (role="menuitemcheckbox"): true / false / 'mixed'. */
    checkbox?: boolean;
    /** Opcion de un grupo exclusivo (role="menuitemradio"): usa `checked`. */
    radio?: boolean;
    checked?: boolean | 'mixed';
    /** Color de usuario (etiquetas): punto de color. */
    dot?: string | null;
    hint?: string;
    disabled?: boolean;
    destructive?: boolean;
    /** Titulo de grupo que se pinta justo antes del elemento. */
    groupLabel?: string;
    /** Linea separadora antes del elemento. */
    separatorBefore?: boolean;
    /** No cerrar el menu al elegir (p. ej. alternar varias etiquetas). */
    keepOpen?: boolean;
    onSelect: () => void;
}

interface Props {
    open: boolean;
    onClose: () => void;
    /** Boton que abre el menu: recibe el foco al cerrar y ancla la posicion. */
    anchorRef: RefObject<HTMLElement | null>;
    label: string;
    items: MenuItemDef[];
    heading?: string;
    /** Texto cuando no hay elementos. */
    emptyText?: string;
    loading?: boolean;
    loadingText?: string;
    width?: number;
    footer?: ReactNode;
}

/**
 * Menu desplegable accesible (role="menu"): foco al primer elemento al abrir, flechas/Inicio/Fin, Escape o Tab cierran
 * y devuelven el foco al boton. Captura las teclas para que los atajos de la bandeja no se disparen mientras esta abierto.
 */
export function ActionMenu({ open, onClose, anchorRef, label, items, heading, emptyText, loading, loadingText, width = 248, footer }: Props) {
    const menuRef = useRef<HTMLDivElement | null>(null);
    const wasOpen = useRef(false);

    useEffect(() => {
        if (open) {
            wasOpen.current = true;
            const id = requestAnimationFrame(() => {
                const first = menuRef.current?.querySelector<HTMLElement>('[data-menu-item]:not(:disabled)');
                (first ?? menuRef.current)?.focus({ preventScroll: true });
            });
            return () => cancelAnimationFrame(id);
        }
        if (wasOpen.current) {
            wasOpen.current = false;
            const anchor = anchorRef.current;
            if (anchor && document.contains(anchor)) anchor.focus({ preventScroll: true });
        }
    }, [open, anchorRef]);

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        // Nada de lo que se teclee aqui debe llegar a los atajos globales (e, #, z...).
        e.stopPropagation();
        const nodes = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[data-menu-item]:not(:disabled)') ?? []);
        const current = nodes.indexOf(document.activeElement as HTMLElement);
        const focusAt = (i: number) => nodes[(i + nodes.length) % nodes.length]?.focus();
        switch (e.key) {
            case 'Escape': e.preventDefault(); onClose(); break;
            case 'Tab': onClose(); break;
            case 'ArrowDown': e.preventDefault(); focusAt(current + 1); break;
            case 'ArrowUp': e.preventDefault(); focusAt(current < 0 ? -1 : current - 1); break;
            case 'Home': e.preventDefault(); focusAt(0); break;
            case 'End': e.preventDefault(); focusAt(nodes.length - 1); break;
            default: break;
        }
    };

    return (
        <Popover trigger={anchorRef} isOpen={open} onClose={onClose} width={width} header={false} className="rounded-xl p-1 shadow-2xl">
            <div
                ref={menuRef}
                role="menu"
                aria-label={label}
                tabIndex={-1}
                onKeyDown={onKeyDown}
                className="flex max-h-[min(70vh,26rem)] flex-col overflow-y-auto outline-none"
            >
                {heading && <div role="presentation" className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{heading}</div>}
                {loading && items.length === 0 && <div role="presentation" className="px-2.5 py-2 text-xs text-muted-foreground">{loadingText}</div>}
                {!loading && items.length === 0 && emptyText && <div role="presentation" className="px-2.5 py-2 text-xs text-muted-foreground">{emptyText}</div>}
                {items.map((item) => (
                    <div key={item.id} role="none">
                        {item.separatorBefore && <div role="separator" className="my-1 h-px bg-border" />}
                        {item.groupLabel && <div role="presentation" className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{item.groupLabel}</div>}
                        <button
                            type="button"
                            data-menu-item
                            data-menu-id={item.id}
                            role={item.checkbox ? 'menuitemcheckbox' : item.radio ? 'menuitemradio' : 'menuitem'}
                            aria-checked={item.checkbox || item.radio ? item.checked : undefined}
                            disabled={item.disabled}
                            tabIndex={-1}
                            onClick={() => {
                                item.onSelect();
                                if (!item.keepOpen) onClose();
                            }}
                            className={cn(
                                'flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm outline-none transition-colors',
                                '[@media(pointer:coarse)]:min-h-11',
                                'hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground disabled:opacity-50',
                                item.destructive && 'text-destructive hover:text-destructive focus-visible:text-destructive',
                            )}
                        >
                            {item.dot !== undefined && item.dot !== null ? (
                                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-border" style={{ backgroundColor: item.dot || undefined }} />
                            ) : item.icon ? (
                                <span aria-hidden="true" className="flex h-4 w-4 shrink-0 items-center justify-center">{item.icon}</span>
                            ) : null}
                            <span className="min-w-0 flex-1 truncate">{item.label}</span>
                            {item.hint && <kbd className="rounded border border-border bg-muted px-1 text-[10px] font-medium text-muted-foreground">{item.hint}</kbd>}
                            {(item.checkbox || item.radio) && item.checked === true && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
                            {item.checkbox && item.checked === 'mixed' && <Minus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                        </button>
                    </div>
                ))}
                {footer}
            </div>
        </Popover>
    );
}
