'use client';

import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useI18n } from '@/components/I18nProvider';
import { nextWidthForKey } from '@/lib/layout/sidebar-width';

interface Props {
    width: number;
    min: number;
    max: number;
    viewportWidth: number;
    /** Cambio en vivo (arrastre) o por teclado. `persist` = false mientras se arrastra. */
    onResize: (width: number, persist: boolean) => void;
    /** Doble clic / Enter. */
    onReset: () => void;
}

/**
 * Separador vertical redimensionable de la barra lateral (patron WAI-ARIA "window splitter"): arrastre con puntero (raton y
 * tactil), flechas (Mayus = paso x4), Home/End = minimo/maximo, Enter o doble clic = ancho por defecto. Area de agarre de 8 px
 * (16 px con puntero grueso) que se solapa con los vecinos, asi que no anade ancho al layout.
 */
export function SidebarResizer({ width, min, max, viewportWidth, onResize, onReset }: Props) {
    const { t } = useI18n();
    const ref = useRef<HTMLDivElement | null>(null);
    const drag = useRef<{ startX: number; startWidth: number; sign: 1 | -1; last: number } | null>(null);
    const [dragging, setDragging] = useState(false);

    const isRtl = () => (ref.current ? getComputedStyle(ref.current).direction === 'rtl' : false);

    const end = (persist: boolean) => {
        const d = drag.current;
        if (!d) return;
        drag.current = null;
        setDragging(false);
        document.body.style.removeProperty('cursor');
        document.body.style.removeProperty('user-select');
        if (persist) onResize(d.last, true);
    };

    const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
        if (e.button !== undefined && e.button !== 0) return;
        drag.current = { startX: e.clientX, startWidth: width, sign: isRtl() ? -1 : 1, last: width };
        try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* puntero ya liberado */ }
        setDragging(true);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        ref.current?.focus({ preventScroll: true });
    };
    const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
        const d = drag.current;
        if (!d) return;
        const next = Math.round(Math.min(max, Math.max(min, d.startWidth + (e.clientX - d.startX) * d.sign)));
        if (next === d.last) return;
        d.last = next;
        onResize(next, false);
    };
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        if (e.key === 'Enter') { e.preventDefault(); onReset(); return; }
        const next = nextWidthForKey(width, e.key, viewportWidth, { shift: e.shiftKey, rtl: isRtl() });
        if (next == null) return;
        e.preventDefault();
        if (next !== width) onResize(next, true);
    };

    return (
        <div
            ref={ref}
            role="separator"
            aria-orientation="vertical"
            aria-label={t('sidebar.resize')}
            aria-valuenow={width}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuetext={t('sidebar.resizeValue', { width })}
            tabIndex={0}
            data-sidebar-resizer=""
            data-dragging={dragging ? 'true' : 'false'}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => end(true)}
            onPointerCancel={() => end(false)}
            onLostPointerCapture={() => end(true)}
            onDoubleClick={onReset}
            onKeyDown={onKeyDown}
            className="group relative z-20 -mx-1 hidden w-2 shrink-0 cursor-col-resize touch-none select-none outline-none md:block [@media(pointer:coarse)]:-mx-2 [@media(pointer:coarse)]:w-4"
        >
            <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 start-1/2 w-px -translate-x-1/2 bg-sidebar-border transition-[width,background-color] group-hover:w-0.5 group-hover:bg-primary group-focus-visible:w-1 group-focus-visible:bg-ring group-data-[dragging=true]:w-0.5 group-data-[dragging=true]:bg-primary"
            />
        </div>
    );
}
