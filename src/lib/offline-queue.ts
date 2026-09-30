/**
 * Logica pura de la cola offline (sin React ni localStorage) para poder probarla con vitest.
 * La usa src/contexts/OfflineContext.tsx.
 */

export interface QueueItem {
    /** Id de la operacion. Tambien se envia como `Idempotency-Key`, asi un reintento no duplica el efecto. */
    id: string;
    url: string;
    method: string;
    body: unknown;
    timestamp: number;
    description: string;
    /** Cuenta (AccountManager.id) que origino la accion. null = cuenta de la cookie de sesion actual. */
    accountId: string | null;
    /** Correo de la cuenta origen; se usa si no hay accountId (p. ej. el remitente elegido al redactar). */
    accountEmail: string | null;
    /** Intentos ya realizados que fallaron con error recuperable. */
    attempts: number;
    /** No reintentar antes de este instante (epoch ms). */
    nextAttemptAt: number;
    /** Operaciones con la misma clave se consideran duplicadas. */
    dedupeKey: string;
}

export type Outcome = 'success' | 'retry' | 'drop';

export const MAX_ATTEMPTS = 8;
export const MAX_QUEUE_SIZE = 200;
const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 5 * 60_000;

/**
 * Clasifica la respuesta HTTP de una operacion encolada:
 *  - 2xx                       -> success (se elimina)
 *  - 401, 408, 425, 429, 5xx   -> retry (recuperable: sesion por renovar, limite, servidor caido)
 *  - resto de 4xx              -> drop (no reintentable: 400 validacion, 403, 404, 409, 410, 422...)
 *  - 3xx (p. ej. redireccion a /login) -> retry: no es una respuesta valida de la API
 */
export function classifyStatus(status: number): Outcome {
    if (status >= 200 && status < 300) return 'success';
    if (status === 401 || status === 408 || status === 425 || status === 429) return 'retry';
    if (status >= 400 && status < 500) return 'drop';
    return 'retry';
}

/** Espera exponencial: 2s, 4s, 8s ... con tope de 5 min. */
export function backoffMs(attempts: number): number {
    return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));
}

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** Clave por defecto: cuenta + metodo + url + cuerpo (orden de claves irrelevante). */
export function makeDedupeKey(input: { method: string; url: string; body: unknown; accountId?: string | null; accountEmail?: string | null }): string {
    const who = input.accountId || (input.accountEmail || '').toLowerCase() || '-';
    return `${who}|${input.method.toUpperCase()}|${input.url}|${stableStringify(input.body)}`;
}

export function createItem(
    input: {
        url: string;
        method: string;
        body: unknown;
        description: string;
        accountId?: string | null;
        accountEmail?: string | null;
        dedupeKey?: string;
        id?: string;
    },
    now: number,
    newId: () => string,
): QueueItem {
    const method = input.method.toUpperCase();
    const accountId = input.accountId ?? null;
    const accountEmail = input.accountEmail ?? null;
    return {
        id: input.id || newId(),
        url: input.url,
        method,
        body: input.body,
        timestamp: now,
        description: input.description,
        accountId,
        accountEmail,
        attempts: 0,
        nextAttemptAt: 0,
        dedupeKey: input.dedupeKey || makeDedupeKey({ method, url: input.url, body: input.body, accountId, accountEmail }),
    };
}

/** Agrega una operacion salvo que ya exista otra con el mismo id o la misma clave (deduplicacion). */
export function enqueue(queue: QueueItem[], item: QueueItem): { queue: QueueItem[]; added: boolean } {
    if (queue.some((q) => q.id === item.id || q.dedupeKey === item.dedupeKey)) {
        return { queue, added: false };
    }
    const next = [...queue, item];
    // Tope de tamano: descarta las mas antiguas (localStorage tiene cuota limitada).
    return { queue: next.length > MAX_QUEUE_SIZE ? next.slice(next.length - MAX_QUEUE_SIZE) : next, added: true };
}

/** Elementos que ya toca intentar, en el orden en que se encolaron. */
export function dueItems(queue: QueueItem[], now: number): QueueItem[] {
    return queue.filter((q) => q.nextAttemptAt <= now);
}

/** Instante del proximo reintento pendiente (null si la cola esta vacia). */
export function nextDueAt(queue: QueueItem[]): number | null {
    if (queue.length === 0) return null;
    return Math.min(...queue.map((q) => q.nextAttemptAt));
}

/** Aplica el resultado de un intento: success/drop eliminan; retry incrementa intentos y programa backoff. */
export function applyOutcome(queue: QueueItem[], id: string, outcome: Outcome, now: number): { queue: QueueItem[]; dropped: QueueItem | null } {
    const item = queue.find((q) => q.id === id);
    if (!item) return { queue, dropped: null };
    if (outcome === 'success') return { queue: queue.filter((q) => q.id !== id), dropped: null };
    if (outcome === 'drop') return { queue: queue.filter((q) => q.id !== id), dropped: item };

    const attempts = item.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
        return { queue: queue.filter((q) => q.id !== id), dropped: item };
    }
    return {
        queue: queue.map((q) => (q.id === id ? { ...q, attempts, nextAttemptAt: now + backoffMs(attempts) } : q)),
        dropped: null,
    };
}

/** Valida y migra lo leido de localStorage (formato antiguo sin cuenta/intentos incluido). */
export function normalizeStoredQueue(raw: unknown, newId: () => string, now: number): QueueItem[] {
    if (!Array.isArray(raw)) return [];
    const out: QueueItem[] = [];
    const seen = new Set<string>();
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as Record<string, unknown>;
        if (typeof e.url !== 'string' || !e.url.startsWith('/') || e.url.startsWith('//')) continue; // solo rutas propias
        const method = typeof e.method === 'string' ? e.method.toUpperCase() : '';
        if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) continue;
        const item = createItem(
            {
                id: typeof e.id === 'string' && e.id ? e.id : newId(),
                url: e.url,
                method,
                body: e.body,
                description: typeof e.description === 'string' ? e.description : method,
                accountId: typeof e.accountId === 'string' ? e.accountId : null,
                accountEmail: typeof e.accountEmail === 'string' ? e.accountEmail : null,
                dedupeKey: typeof e.dedupeKey === 'string' ? e.dedupeKey : undefined,
            },
            typeof e.timestamp === 'number' ? e.timestamp : now,
            newId,
        );
        item.attempts = typeof e.attempts === 'number' && e.attempts >= 0 ? Math.floor(e.attempts) : 0;
        item.nextAttemptAt = typeof e.nextAttemptAt === 'number' ? e.nextAttemptAt : 0;
        if (seen.has(item.id) || seen.has(`k:${item.dedupeKey}`)) continue;
        seen.add(item.id);
        seen.add(`k:${item.dedupeKey}`);
        out.push(item);
    }
    return out;
}
