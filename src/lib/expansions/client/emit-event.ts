/**
 * Emision de eventos de ciclo de vida desde la UI (hoy solo COMPOSE_OPENED). Fire-and-forget: nunca bloquea la UI,
 * nunca lanza y deduplica en una ventana corta. El servidor decide la identidad (sesion) y valida los ids.
 */

export interface ComposeOpenedPayload {
    mode: 'new' | 'reply' | 'replyAll' | 'forward';
    inReplyToEmailId?: string;
    draftId?: string;
}

const recent = new Map<string, number>();
const DEDUPE_MS = 10_000;

export function emitComposeOpened(payload: ComposeOpenedPayload, now: number = Date.now()): boolean {
    try {
        if (typeof window === 'undefined' || typeof fetch !== 'function') return false;
        const key = `${payload.mode}:${payload.inReplyToEmailId || ''}:${payload.draftId || ''}`;
        const last = recent.get(key);
        if (last !== undefined && now - last < DEDUPE_MS) return false;
        recent.set(key, now);
        if (recent.size > 100) recent.clear();

        void fetch('/api/expansions/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event: 'COMPOSE_OPENED', context: payload }),
            keepalive: true,
        }).catch(() => undefined);
        return true;
    } catch {
        return false;
    }
}
