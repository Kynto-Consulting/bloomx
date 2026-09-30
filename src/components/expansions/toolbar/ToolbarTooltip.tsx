'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';

/** Retardo de aparicion con el raton (con foco de teclado es inmediato). */
export const TOOLTIP_DELAY_MS = 400;
/** Ancho maximo del tooltip (px): el texto largo ENVUELVE, no se corta con puntos suspensivos. */
export const TOOLTIP_MAX_WIDTH_PX = 280;
/** Margen minimo con el borde de la ventana y separacion con el boton (px). */
const EDGE_PX = 8;
const GAP_PX = 6;

/** Solo el foco de TECLADO abre el tooltip (un clic con el raton no). Navegadores sin :focus-visible -> siempre. */
function focusVisible(el: HTMLElement): boolean {
    try { return el.matches(':focus-visible'); } catch { return true; }
}

interface Props {
    /** Texto del tooltip (nombre de la accion). */
    label: string;
    /** Linea secundaria (descripcion). Envuelve en varias lineas. */
    hint?: string;
    /** Atajo de teclado si la accion lo tiene (se muestra como tecla). */
    shortcut?: string;
    /** Recibe `aria-describedby` cuando el tooltip esta visible y un `id` estable. */
    children: (aria: { 'aria-describedby'?: string }) => React.ReactElement;
}

/**
 * Posicion del tooltip respecto al boton: centrado bajo el, DESPLAZADO (shift) para no salirse por los lados y VOLTEADO (flip) sobre el
 * boton si abajo no cabe. Pura y exportada para probarla sin layout real.
 */
export function placeTooltip(anchor: { left: number; right: number; top: number; bottom: number }, tip: { width: number; height: number }, viewport: { width: number; height: number }): { left: number; top: number; placement: 'bottom' | 'top' } {
    const width = Math.min(tip.width, Math.max(0, viewport.width - EDGE_PX * 2));
    const centre = (anchor.left + anchor.right) / 2;
    const left = Math.min(Math.max(centre - width / 2, EDGE_PX), Math.max(EDGE_PX, viewport.width - width - EDGE_PX));
    const fitsBelow = anchor.bottom + GAP_PX + tip.height <= viewport.height - EDGE_PX;
    const fitsAbove = anchor.top - GAP_PX - tip.height >= EDGE_PX;
    if (fitsBelow || !fitsAbove) return { left, top: Math.max(EDGE_PX, Math.min(anchor.bottom + GAP_PX, viewport.height - tip.height - EDGE_PX)), placement: 'bottom' };
    return { left, top: anchor.top - GAP_PX - tip.height, placement: 'top' };
}

/**
 * Tooltip accesible para botones de solo icono: aparece a los 400 ms con el raton y AL INSTANTE con el foco de teclado; Escape lo
 * cierra; role="tooltip" enlazado con aria-describedby. Se pinta en un portal con posicion fija (ninguna barra con `overflow` lo
 * recorta), mide su tamano real para no salirse de la ventana (flip + shift), el texto envuelve hasta 280 px y NO bloquea el clic
 * (pointer-events-none). El nombre accesible del boton va aparte, en aria-label: el tooltip es complementario.
 */
export function ToolbarTooltip({ label, hint, shortcut, children }: Props) {
    const id = React.useId();
    const wrapRef = React.useRef<HTMLSpanElement | null>(null);
    const tipRef = React.useRef<HTMLSpanElement | null>(null);
    const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const [visible, setVisible] = React.useState(false);
    const [pos, setPos] = React.useState<{ left: number; top: number; placement: 'bottom' | 'top' } | null>(null);

    const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
    React.useEffect(() => clear, []);

    const show = (delay: number) => {
        clear();
        const go = () => { setPos(null); setVisible(true); };
        if (delay <= 0) go(); else timer.current = setTimeout(go, delay);
    };
    const hide = () => { clear(); setVisible(false); };

    // Se mide el tooltip YA pintado (oculto) y se coloca antes del primer pintado visible.
    React.useLayoutEffect(() => {
        if (!visible) return;
        const anchor = wrapRef.current?.getBoundingClientRect();
        const tip = tipRef.current?.getBoundingClientRect();
        if (!anchor || !tip) return;
        setPos(placeTooltip(anchor, { width: tip.width, height: tip.height }, { width: window.innerWidth, height: window.innerHeight }));
    }, [visible, label, hint, shortcut]);

    React.useEffect(() => {
        if (!visible) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setVisible(false); };
        document.addEventListener('keydown', onKey);
        window.addEventListener('scroll', hide, true);
        window.addEventListener('resize', hide);
        return () => { document.removeEventListener('keydown', onKey); window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide); };
    }, [visible]);

    return (
        <span
            ref={wrapRef}
            className="inline-flex"
            onMouseEnter={() => show(TOOLTIP_DELAY_MS)}
            onMouseLeave={hide}
            onMouseDown={hide}
            onFocus={(e) => { if (focusVisible(e.target as HTMLElement)) show(0); }}
            onBlur={hide}
        >
            {children({ 'aria-describedby': visible ? id : undefined })}
            {visible && typeof document !== 'undefined' && createPortal(
                <span
                    ref={tipRef}
                    id={id}
                    role="tooltip"
                    data-placement={pos?.placement}
                    style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, maxWidth: `min(${TOOLTIP_MAX_WIDTH_PX}px, calc(100vw - ${EDGE_PX * 2}px))`, visibility: pos ? 'visible' : 'hidden' }}
                    className="pointer-events-none fixed z-[200] w-max whitespace-normal break-words rounded-md border border-border bg-card px-2.5 py-1.5 text-sm leading-snug text-card-foreground shadow-lg"
                >
                    <span className="flex items-baseline justify-between gap-3">
                        <span className="block font-medium">{label}</span>
                        {shortcut && <kbd className="shrink-0 rounded border border-border bg-muted px-1 font-sans text-xs text-muted-foreground">{shortcut}</kbd>}
                    </span>
                    {hint && <span className="mt-0.5 block text-muted-foreground">{hint}</span>}
                </span>,
                document.body,
            )}
        </span>
    );
}
