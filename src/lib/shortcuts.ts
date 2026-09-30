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

// ---------------------------------------------------------------------------
// Registro unico de atajos de la bandeja: lo usan el manejador de teclado Y el overlay de ayuda (?),
// asi la lista que ve el usuario es siempre la real.
// ---------------------------------------------------------------------------

export type ShortcutId =
    | 'compose' | 'search' | 'next' | 'prev' | 'open' | 'select' | 'reply' | 'replyAll' | 'forward'
    | 'archive' | 'delete' | 'spam' | 'undo' | 'move' | 'label' | 'star' | 'toggleRead' | 'snooze'
    | 'refresh' | 'help' | 'escape';

export type ShortcutGroup = 'navigate' | 'act' | 'compose';

export interface ShortcutDef {
    id: ShortcutId;
    /** Teclas (resueltas por resolveShortcutKey: minusculas). La primera es la que se muestra. */
    keys: string[];
    /** Como se muestra cada tecla en el overlay. */
    display: string[];
    group: ShortcutGroup;
    /** Clave i18n (emailList.shortcuts.<id>). */
    labelKey: string;
}

const def = (id: ShortcutId, keys: string[], group: ShortcutGroup, display = keys.map((k) => k.toUpperCase())): ShortcutDef => ({
    id, keys, display, group, labelKey: `emailList.shortcuts.${id}`,
});

export const SHORTCUT_DEFS: readonly ShortcutDef[] = [
    def('compose', ['c'], 'compose'),
    def('search', ['/'], 'navigate', ['/']),
    def('next', ['j'], 'navigate'),
    def('prev', ['k'], 'navigate'),
    def('open', ['enter', 'o'], 'navigate', ['Enter', 'O']),
    def('select', ['x'], 'navigate'),
    def('refresh', ['g'], 'navigate'),
    def('reply', ['r'], 'compose'),
    def('replyAll', ['a'], 'compose'),
    def('forward', ['f'], 'compose'),
    def('archive', ['e'], 'act'),
    def('delete', ['#', 'delete', 'backspace'], 'act', ['#', 'Del', 'Backspace']),
    def('spam', ['!'], 'act', ['!']),
    def('undo', ['z'], 'act'),
    def('move', ['v'], 'act'),
    def('label', ['l'], 'act'),
    def('star', ['s'], 'act'),
    def('toggleRead', ['u'], 'act'),
    def('snooze', ['b'], 'act'),
    def('help', ['?'], 'navigate', ['?']),
    def('escape', ['escape'], 'navigate', ['Esc']),
];

/** Convierte { id -> manejador } en { tecla -> manejador } segun SHORTCUT_DEFS (ids sin manejador se omiten). */
export function buildShortcutMap<H>(handlers: Partial<Record<ShortcutId, H>>): Record<string, H> {
    const map: Record<string, H> = {};
    for (const d of SHORTCUT_DEFS) {
        const h = handlers[d.id];
        if (!h) continue;
        for (const k of d.keys) map[k] = h;
    }
    return map;
}
