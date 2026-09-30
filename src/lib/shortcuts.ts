// Logica pura para decidir si un evento de teclado debe disparar un atajo.

export interface ShortcutTargetLike {
    tagName?: string;
    isContentEditable?: boolean;
    getAttribute?: (name: string) => string | null;
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const ACTIVATABLE_TAGS = new Set(['BUTTON', 'A', 'SUMMARY']);

export function isEditableTarget(target: ShortcutTargetLike | null | undefined): boolean {
    if (!target) return false;
    const tag = String(target.tagName || '').toUpperCase();
    if (EDITABLE_TAGS.has(tag)) return true;
    if (target.isContentEditable) return true;
    const role = target.getAttribute?.('role');
    return role === 'textbox' || role === 'combobox' || role === 'searchbox';
}

/** Elementos que ya reaccionan a Enter/Espacio por si mismos: no hay que interceptarlos. */
export function isActivatableTarget(target: ShortcutTargetLike | null | undefined): boolean {
    if (!target) return false;
    const tag = String(target.tagName || '').toUpperCase();
    if (ACTIVATABLE_TAGS.has(tag)) return true;
    return target.getAttribute?.('role') === 'button';
}

export interface ShortcutEventLike {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    defaultPrevented?: boolean;
    isComposing?: boolean;
    target?: ShortcutTargetLike | null;
}

/**
 * Devuelve la tecla normalizada (minusculas) si el atajo debe procesarse, o null si no.
 * - Ignora campos editables, modificadores (Ctrl/Meta/Alt), IME y eventos ya manejados.
 * - `Escape` se procesa incluso dentro de inputs solo si `allowEscapeInInputs`.
 * - `modalOpen` desactiva todos los atajos (excepto nada): con un dialogo abierto no se borra correo.
 */
export function resolveShortcutKey(
    e: ShortcutEventLike,
    opts: { modalOpen?: boolean; allowEscapeInInputs?: boolean } = {}
): string | null {
    if (!e.key || e.defaultPrevented || e.isComposing) return null;
    if (e.ctrlKey || e.metaKey || e.altKey) return null;
    if (opts.modalOpen) return null;
    const key = e.key.toLowerCase();
    if (isEditableTarget(e.target)) {
        if (!(key === 'escape' && opts.allowEscapeInInputs)) return null;
    }
    if ((key === 'enter' || key === ' ') && isActivatableTarget(e.target)) return null;
    return key;
}
