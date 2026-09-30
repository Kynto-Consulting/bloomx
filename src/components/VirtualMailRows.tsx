'use client';

import { useEffect, useLayoutEffect, useRef, type MutableRefObject, type ReactNode, type RefObject } from 'react';
import { defaultRangeExtractor, useVirtualizer, type Rect, type Virtualizer } from '@tanstack/react-virtual';
import { anchoredScrollTop, pickAnchor, pinRange, shouldLoadMore, type ScrollAnchor } from '@/lib/virtual-list';

export interface VirtualMailRowsHandle {
    /** Desplaza (si hace falta) hasta que la fila sea visible; monta la fila aunque este lejos. */
    scrollToIndex: (index: number) => void;
}

interface Props {
    /** Contenedor con overflow-y que hace scroll (el mismo que escucha el scroll infinito). */
    scrollRef: RefObject<HTMLElement | null>;
    /** Ids estables de cada fila (clave de medicion y de ancla). */
    ids: string[];
    renderRow: (index: number) => ReactNode;
    /** Indice con foco de teclado: se mantiene montado aunque salga de la ventana. -1 = ninguno. */
    pinnedIndex: number;
    hasMore: boolean;
    onNearEnd: () => void;
    handleRef?: MutableRefObject<VirtualMailRowsHandle | null>;
    label: string;
    estimateSize?: number;
    overscan?: number;
    /** Solo para pruebas en jsdom (sin layout real). */
    initialRect?: Rect;
    observeElementRect?: (instance: Virtualizer<any, any>, cb: (rect: Rect) => void) => void | (() => void);
    /** Solo para pruebas: sin layout real (jsdom) getBoundingClientRect devuelve 0. */
    measureElement?: (element: HTMLDivElement, entry: ResizeObserverEntry | undefined, instance: Virtualizer<any, any>) => number;
    className?: string;
}

/**
 * Filas de correo virtualizadas (@tanstack/react-virtual). Solo monta las filas visibles + un colchon,
 * mantiene montada la fila enfocada, conserva el ancla de scroll cuando llegan correos por arriba y
 * avisa (onNearEnd) al acercarse al final para la paginacion.
 * Cada fila debe pintar su propio role="listitem" con aria-posinset/aria-setsize (ver listItemAria).
 */
export function VirtualMailRows({
    scrollRef, ids, renderRow, pinnedIndex, hasMore, onNearEnd, handleRef, label,
    estimateSize = 96, overscan = 8, initialRect, observeElementRect, measureElement, className,
}: Props) {
    const virtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
        count: ids.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => estimateSize,
        overscan,
        getItemKey: (index) => ids[index] ?? index,
        rangeExtractor: (range) => pinRange(defaultRangeExtractor(range), pinnedIndex, ids.length),
        ...(initialRect ? { initialRect } : {}),
        ...(observeElementRect ? { observeElementRect } : {}),
        ...(measureElement ? { measureElement } : {}),
    });

    useEffect(() => {
        if (!handleRef) return;
        handleRef.current = { scrollToIndex: (index) => virtualizer.scrollToIndex(index, { align: 'auto' }) };
        return () => { handleRef.current = null; };
    }, [handleRef, virtualizer]);

    const items = virtualizer.getVirtualItems();

    // --- Ancla de scroll: si llegan correos por arriba (o se quitan filas) la vista no salta ---
    const anchorRef = useRef<ScrollAnchor | null>(null);
    const captureAnchor = () => {
        const el = scrollRef.current;
        if (!el) return;
        anchorRef.current = pickAnchor(virtualizer.getVirtualItems(), ids, el.scrollTop);
    };
    const captureRef = useRef(captureAnchor);
    captureRef.current = captureAnchor;

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const onScroll = () => captureRef.current();
        el.addEventListener('scroll', onScroll, { passive: true });
        return () => el.removeEventListener('scroll', onScroll);
    }, [scrollRef]);

    // Antes de pintar: se usa el ancla capturada con la lista ANTERIOR (el efecto pasivo la renueva despues).
    useLayoutEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        // Forzar el recalculo de mediciones con los ids nuevos.
        virtualizer.getTotalSize();
        const target = anchoredScrollTop({
            ids,
            anchor: anchorRef.current,
            scrollTop: el.scrollTop,
            startOf: (index) => virtualizer.measurementsCache[index]?.start,
        });
        if (target !== null) el.scrollTop = target;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ids]);

    useEffect(() => { captureRef.current(); });

    // --- Paginacion: pedir mas al acercarse al final (aunque no haya evento de scroll) ---
    const lastIndex = items.length > 0 ? items[items.length - 1].index : -1;
    const nearEndRef = useRef(onNearEnd);
    nearEndRef.current = onNearEnd;
    useEffect(() => {
        if (shouldLoadMore(lastIndex, ids.length, hasMore)) nearEndRef.current();
    }, [lastIndex, ids.length, hasMore]);

    return (
        <div
            role="list"
            aria-label={label}
            className={className}
            style={{ position: 'relative', height: virtualizer.getTotalSize(), width: '100%' }}
        >
            {items.map((item) => (
                <div
                    key={item.key}
                    data-index={item.index}
                    ref={virtualizer.measureElement}
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${item.start}px)`,
                        paddingBottom: 6, // equivale al gap-1.5 de la lista sin virtualizar
                    }}
                >
                    {renderRow(item.index)}
                </div>
            ))}
        </div>
    );
}
