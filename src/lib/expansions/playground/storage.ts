/** Persistencia local (localStorage, siempre con try/catch) del borrador del playground y del envio galeria -> playground. */

export const DRAFT_KEY = 'bloomx:ext-playground:draft:v1';
export const PENDING_KEY = 'bloomx:ext-playground:open:v1';
export const THEME_KEY = 'bloomx:ext-tools:theme:v1';

export function safeGet(key: string): string | null {
    try { return typeof window === 'undefined' ? null : window.localStorage.getItem(key); } catch { return null; }
}
export function safeSet(key: string, value: string): boolean {
    try { if (typeof window === 'undefined') return false; window.localStorage.setItem(key, value); return true; } catch { return false; }
}
export function safeRemove(key: string): void {
    try { if (typeof window !== 'undefined') window.localStorage.removeItem(key); } catch { /* sin almacenamiento */ }
}

export type Viewport = 'mobile' | 'tablet' | 'desktop';
export const VIEWPORT_WIDTH: Record<Viewport, number | null> = { mobile: 375, tablet: 768, desktop: null };

export interface PlaygroundDraft {
    text?: string;
    context?: string;
    script?: string;
    theme?: string;
    viewport?: Viewport;
    strict?: boolean;
}

export function loadDraft(): PlaygroundDraft {
    const raw = safeGet(DRAFT_KEY);
    if (!raw) return {};
    try {
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
        const out: PlaygroundDraft = {};
        if (typeof data.text === 'string') out.text = data.text;
        if (typeof data.context === 'string') out.context = data.context;
        if (typeof data.script === 'string') out.script = data.script;
        if (typeof data.theme === 'string') out.theme = data.theme;
        if (data.viewport === 'mobile' || data.viewport === 'tablet' || data.viewport === 'desktop') out.viewport = data.viewport;
        if (typeof data.strict === 'boolean') out.strict = data.strict;
        return out;
    } catch { return {}; }
}

export function saveDraft(draft: PlaygroundDraft): boolean {
    try { return safeSet(DRAFT_KEY, JSON.stringify(draft)); } catch { return false; }
}

/** La galeria deja aqui el ejemplo que el usuario quiere abrir; el playground lo recoge (una sola vez) al montar. */
export function queueForPlayground(text: string): boolean {
    return safeSet(PENDING_KEY, text);
}
export function takePending(): string | null {
    const value = safeGet(PENDING_KEY);
    if (value !== null) safeRemove(PENDING_KEY);
    return value;
}
