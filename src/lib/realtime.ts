/**
 * Utilidades puras del canal SSE (servidor y cliente). Sin dependencias de Next/Prisma para poder
 * probarlas con vitest.
 */

export type PollBackoffOptions = {
    /** Intervalo tras un cambio (o al conectar). */
    minMs: number;
    /** Techo cuando no hay actividad. */
    maxMs: number;
    factor: number;
};

export const DEFAULT_POLL_BACKOFF: PollBackoffOptions = { minMs: 5_000, maxMs: 30_000, factor: 1.6 };

/** Siguiente espera del sondeo a BD: vuelve al minimo si hubo cambios; si no, crece hasta el techo. */
export function nextPollDelay(currentMs: number, hadChanges: boolean, opts: PollBackoffOptions = DEFAULT_POLL_BACKOFF): number {
    if (hadChanges) return opts.minMs;
    const grown = Math.round(Math.max(currentMs, opts.minMs) * opts.factor);
    return Math.min(opts.maxMs, grown);
}

/** Espera de reconexion del cliente: exponencial con tope y jitter opcional (0..1, inyectable para tests). */
export function reconnectDelay(attempt: number, opts: { baseMs?: number; maxMs?: number; jitter?: number } = {}): number {
    const base = opts.baseMs ?? 1_000;
    const max = opts.maxMs ?? 60_000;
    const exp = Math.min(max, base * 2 ** Math.max(0, Math.min(attempt, 16)));
    const jitter = opts.jitter ?? 0;
    // Jitter "equal": mitad fija + mitad aleatoria, evita reconexiones sincronizadas.
    return Math.round(exp * (1 - 0.5 * jitter));
}

/** Limitador de conexiones simultaneas por clave (usuario). Best-effort por instancia. */
export class ConnectionLimiter {
    private readonly counts = new Map<string, number>();
    constructor(private readonly max: number) {}

    tryAcquire(key: string): boolean {
        const current = this.counts.get(key) ?? 0;
        if (current >= this.max) return false;
        this.counts.set(key, current + 1);
        return true;
    }

    release(key: string): void {
        const current = this.counts.get(key) ?? 0;
        if (current <= 1) this.counts.delete(key);
        else this.counts.set(key, current - 1);
    }

    count(key: string): number {
        return this.counts.get(key) ?? 0;
    }
}

/**
 * Interpreta el cursor de reanudacion (cabecera Last-Event-ID o `?lastEventId=`). El id de evento es la
 * marca de tiempo ISO del ultimo correo notificado. Devuelve null si no es valido o esta en el futuro lejano.
 */
export function parseResumeCursor(raw: string | null | undefined, now: Date = new Date()): Date | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(trimmed)) return null;
    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) return null;
    if (date.getTime() > now.getTime() + 60_000) return null;
    return date;
}

export function formatSseEvent(event: { id?: string; event?: string; data: unknown; retry?: number }): string {
    const lines: string[] = [];
    if (event.retry !== undefined) lines.push(`retry: ${Math.max(0, Math.floor(event.retry))}`);
    if (event.id) lines.push(`id: ${event.id.replace(/[\r\n]/g, '')}`);
    if (event.event) lines.push(`event: ${event.event.replace(/[\r\n]/g, '')}`);
    lines.push(`data: ${typeof event.data === 'string' ? event.data : JSON.stringify(event.data)}`);
    return `${lines.join('\n')}\n\n`;
}
