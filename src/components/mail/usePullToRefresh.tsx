'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { Loader2, ArrowDown } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { PULL_IDLE, PULL_MAX, PULL_TRIGGER, pullDistance, pullEnd, pullMove, pullStart, type PullState } from '@/lib/mail-gestures';

// La logica del gesto vive en lib/mail-gestures (pura y probada). Se reexportan las constantes por compatibilidad.
export { PULL_MAX, PULL_TRIGGER, pullDistance };

/**
 * Pull-to-refresh tactil en un contenedor con scroll: solo arranca estando arriba del todo (scrollTop = 0) con un dedo y solo si el
 * gesto es claramente vertical hacia abajo. Un swipe horizontal, un gesto diagonal o un scroll normal no muestran el indicador;
 * cancelar el toque (touchcancel) NUNCA refresca. Devuelve la distancia actual y si esta refrescando; `indicator` es el elemento a
 * pintar encima de la lista. Los listeners son pasivos: no bloquean el scroll nativo (el contenedor usa overscroll-behavior: contain).
 */
export function usePullToRefresh(scrollRef: RefObject<HTMLElement | null>, onRefresh: () => Promise<void> | void, enabled: boolean) {
    const { t } = useI18n();
    const [pull, setPull] = useState(0);
    const [pulling, setPulling] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const stateRef = useRef<PullState>(PULL_IDLE);
    const busyRef = useRef(false);
    const onRefreshRef = useRef(onRefresh);
    onRefreshRef.current = onRefresh;

    useEffect(() => {
        const el = scrollRef.current;
        if (!el || !enabled) return;

        const apply = (next: PullState) => {
            stateRef.current = next;
            setPull(next.distance);
            setPulling(next.phase === 'pulling');
        };
        const reset = () => apply(PULL_IDLE);

        const onStart = (e: TouchEvent) => {
            if (busyRef.current) return;
            const t0 = e.touches[0];
            apply(t0 ? pullStart(el.scrollTop, e.touches.length, t0.clientX, t0.clientY) : PULL_IDLE);
        };
        const onMove = (e: TouchEvent) => {
            if (stateRef.current.phase === 'idle' || stateRef.current.phase === 'ignored') return;
            const t0 = e.touches[0];
            if (!t0) return;
            const next = pullMove(stateRef.current, t0.clientX, t0.clientY, el.scrollTop, e.touches.length);
            if (next !== stateRef.current) apply(next);
        };
        const onEnd = async () => {
            const { refresh } = pullEnd(stateRef.current);
            reset();
            if (!refresh || busyRef.current) return;
            busyRef.current = true;
            setRefreshing(true);
            try { await onRefreshRef.current(); } finally { busyRef.current = false; setRefreshing(false); }
        };
        // Cancelar el toque (el navegador se hizo cargo del scroll, llamada entrante...) descarta el gesto sin refrescar.
        const onCancel = () => reset();
        // Si la lista empieza a moverse mientras se sigue el gesto, ya no es "tirar".
        const onScroll = () => { if (el.scrollTop > 0 && stateRef.current.phase !== 'idle') reset(); };

        el.addEventListener('touchstart', onStart, { passive: true });
        el.addEventListener('touchmove', onMove, { passive: true });
        el.addEventListener('touchend', onEnd);
        el.addEventListener('touchcancel', onCancel);
        el.addEventListener('scroll', onScroll, { passive: true });
        return () => {
            el.removeEventListener('touchstart', onStart);
            el.removeEventListener('touchmove', onMove);
            el.removeEventListener('touchend', onEnd);
            el.removeEventListener('touchcancel', onCancel);
            el.removeEventListener('scroll', onScroll);
        };
    }, [scrollRef, enabled]);

    const visible = refreshing ? PULL_TRIGGER : pull;
    const indicator = enabled && visible > 0 ? (
        <div
            aria-hidden={!refreshing}
            role={refreshing ? 'status' : undefined}
            data-pull-indicator
            className={`pointer-events-none flex items-center justify-center overflow-hidden text-muted-foreground ${pulling ? '' : 'transition-[height] duration-150'}`}
            style={{ height: visible }}
        >
            {refreshing
                ? <><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /><span className="sr-only">{t('common.loading')}</span></>
                : <ArrowDown className="h-5 w-5 transition-transform" style={{ transform: `rotate(${pull >= PULL_TRIGGER ? 180 : 0}deg)` }} aria-hidden="true" />}
        </div>
    ) : null;

    return { pull, refreshing, indicator };
}
