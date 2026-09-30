import { useEffect, useRef } from 'react';
import { resolveShortcutKey, type ShortcutEventLike } from '@/lib/shortcuts';

type KeyHandler = (e: KeyboardEvent) => void;

interface ShortcutMap {
    [key: string]: KeyHandler;
}

interface ShortcutOptions {
    /** Permite `escape` aunque el foco este en un input. */
    allowEscapeInInputs?: boolean;
}

const MODAL_SELECTOR = '[role="dialog"], [role="alertdialog"], [aria-modal="true"]';

/**
 * Registra UN solo listener global (estable). Los handlers se leen desde una ref,
 * asi que pasar un objeto nuevo en cada render no re-registra el listener.
 * Se desactiva con un dialogo modal abierto y respeta inputs/select/contentEditable.
 */
export function useKeyboardShortcuts(shortcuts: ShortcutMap, options: ShortcutOptions = {}) {
    const shortcutsRef = useRef(shortcuts);
    shortcutsRef.current = shortcuts;
    const allowEscapeInInputs = Boolean(options.allowEscapeInInputs);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const key = resolveShortcutKey(e as unknown as ShortcutEventLike, {
                modalOpen: typeof document !== 'undefined' && Boolean(document.querySelector(MODAL_SELECTOR)),
                allowEscapeInInputs,
            });
            if (!key) return;

            const handler = Object.prototype.hasOwnProperty.call(shortcutsRef.current, key)
                ? shortcutsRef.current[key]
                : undefined;
            if (!handler) return;

            e.preventDefault();
            handler(e);
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [allowEscapeInInputs]);
}
