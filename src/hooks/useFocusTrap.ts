'use client';

import { useEffect, type RefObject } from 'react';

const FOCUSABLE = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
    'textarea:not([disabled])', '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusables(root: HTMLElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.getClientRects().length > 0 && el.getAttribute('aria-hidden') !== 'true',
    );
}

/**
 * Atrapa el foco de teclado dentro de `ref` mientras `active` sea true (Tab / Shift+Tab hacen ciclo),
 * mueve el foco al contenedor al activarse y lo devuelve al elemento anterior al desactivarse/desmontar.
 * Para dialogos modales (Ajustes, composer maximizado). No gestiona Escape: hazlo en el dialogo.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, options: { restoreFocus?: boolean } = {}) {
    const { restoreFocus = true } = options;

    useEffect(() => {
        const root = ref.current;
        if (!active || !root) return;

        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        if (!root.contains(document.activeElement)) {
            const first = focusables(root)[0];
            (first ?? root).focus({ preventScroll: true });
        }

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Tab') return;
            const items = focusables(root);
            if (items.length === 0) { e.preventDefault(); root.focus(); return; }
            const first = items[0];
            const last = items[items.length - 1];
            const current = document.activeElement;
            if (e.shiftKey && (current === first || !root.contains(current))) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && (current === last || !root.contains(current))) {
                e.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', onKeyDown, true);
        return () => {
            document.removeEventListener('keydown', onKeyDown, true);
            if (restoreFocus && previous && document.contains(previous)) previous.focus({ preventScroll: true });
        };
    }, [ref, active, restoreFocus]);
}
