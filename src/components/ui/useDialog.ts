'use client';

import { useEffect, useId, useRef } from 'react';

/**
 * Accesibilidad de dialogos modales (WAI-ARIA Authoring Practices):
 *  - al abrir mueve el foco al primer elemento util (o a `initialFocus`),
 *  - atrapa Tab / Shift+Tab dentro del panel,
 *  - Escape cierra (solo el dialogo superior si hay varios apilados),
 *  - al cerrar devuelve el foco al elemento que lo tenia,
 *  - bloquea el scroll del <body> mientras hay dialogos abiertos.
 *
 * Uso:
 *   const { ref, titleId } = useDialog(open, onClose);
 *   <div role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}> <h2 id={titleId}>...
 */

const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]',
].join(',');

export function getFocusable(root: HTMLElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute('inert') && el.getAttribute('aria-hidden') !== 'true' && (el.offsetParent !== null || el === document.activeElement),
    );
}

// Pila de dialogos abiertos: solo el ultimo reacciona a Escape / Tab.
const stack: symbol[] = [];
let lockCount = 0;
let prevOverflow = '';

function lockScroll() {
    if (lockCount++ === 0) {
        prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
    }
}
function unlockScroll() {
    if (--lockCount === 0) document.body.style.overflow = prevOverflow;
}

export interface UseDialogOptions {
    /** Devuelve el elemento que debe recibir el foco inicial. Por defecto, el primer focusable. */
    initialFocus?: () => HTMLElement | null | undefined;
    /** Desactiva el cierre con Escape (p. ej. mientras se guarda). */
    disableEscape?: boolean;
    /** No bloquear el scroll del body. */
    allowScroll?: boolean;
}

export function useDialog<T extends HTMLElement = HTMLDivElement>(
    open: boolean,
    onClose: () => void,
    options: UseDialogOptions = {},
) {
    const ref = useRef<T | null>(null);
    const titleId = useId();
    const descriptionId = useId();
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    const optsRef = useRef(options);
    optsRef.current = options;

    useEffect(() => {
        if (!open) return;
        const token = Symbol('dialog');
        stack.push(token);
        const previouslyFocused = document.activeElement as HTMLElement | null;
        if (!optsRef.current.allowScroll) lockScroll();

        // Foco inicial: inmediato si ya hay destino (evita que las teclas pulsadas justo tras abrir se pierdan en el
        // <body> y que dependa de requestAnimationFrame, que no corre en pestanas ocultas); si el contenido aun no
        // esta montado, se reintenta tras el primer pintado (y como ultimo recurso el propio panel).
        const focusInitial = (final: boolean) => {
            const root = ref.current;
            if (!root || root.contains(document.activeElement)) return;
            const target = optsRef.current.initialFocus?.() ?? getFocusable(root)[0] ?? (final ? root : null);
            target?.focus({ preventScroll: true });
        };
        focusInitial(false);
        const raf = window.requestAnimationFrame(() => focusInitial(true));

        const onKeyDown = (e: KeyboardEvent) => {
            if (stack[stack.length - 1] !== token) return;
            const root = ref.current;
            if (e.key === 'Escape' && !optsRef.current.disableEscape) {
                e.stopPropagation();
                onCloseRef.current();
                return;
            }
            if (e.key !== 'Tab' || !root) return;
            const items = getFocusable(root);
            if (items.length === 0) {
                e.preventDefault();
                root.focus();
                return;
            }
            const first = items[0];
            const last = items[items.length - 1];
            const active = document.activeElement as HTMLElement | null;
            if (e.shiftKey && (active === first || !root.contains(active))) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && (active === last || !root.contains(active))) {
                e.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', onKeyDown, true);

        return () => {
            window.cancelAnimationFrame(raf);
            document.removeEventListener('keydown', onKeyDown, true);
            const i = stack.indexOf(token);
            if (i >= 0) stack.splice(i, 1);
            if (!optsRef.current.allowScroll) unlockScroll();
            // Devuelve el foco solo si sigue en el documento.
            if (previouslyFocused && document.contains(previouslyFocused)) {
                previouslyFocused.focus({ preventScroll: true });
            }
        };
    }, [open]);

    return { ref, titleId, descriptionId };
}
