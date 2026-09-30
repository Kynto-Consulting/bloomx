// Operaciones sobre envios PROGRAMADOS en Resend: cancelar y reprogramar.
// El SDK de Resend 2.x no trae `emails.cancel` ni `emails.update`, asi que se usa la API REST (misma base que el SDK:
// RESEND_BASE_URL, que en E2E apunta al Resend falso). Si alguna version futura del SDK trae `cancel`, se usa primero.
export type ResendFailureKind =
    /** El envio ya salio (o ya no es un envio programado): no se puede cancelar ni cambiar. */
    | 'already_sent'
    /** Resend no conoce ese id (p. ej. correo creado sin id remoto): no hay nada que cancelar alli. */
    | 'not_found'
    | 'invalid'
    | 'unavailable';

export type ResendOutcome = { ok: true } | { ok: false; kind: ResendFailureKind; status: number; message: string };

const TIMEOUT_MS = 15_000;

function classify(status: number): ResendFailureKind {
    if (status === 404) return 'not_found';
    if (status === 409 || status === 422) return 'already_sent';
    if (status === 400) return 'invalid';
    return 'unavailable';
}

async function request(method: 'POST' | 'PATCH', path: string, body?: unknown): Promise<ResendOutcome> {
    const base = process.env.RESEND_BASE_URL || 'https://api.resend.com';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(`${base}${path}`, {
            method,
            headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY || ''}`, 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: controller.signal,
        });
        if (res.ok) return { ok: true };
        const payload = await res.json().catch(() => null) as { message?: unknown } | null;
        return { ok: false, kind: classify(res.status), status: res.status, message: String(payload?.message ?? `HTTP ${res.status}`).slice(0, 200) };
    } catch (error) {
        return { ok: false, kind: 'unavailable', status: 0, message: error instanceof Error ? error.message.slice(0, 200) : 'network error' };
    } finally {
        clearTimeout(timer);
    }
}

/** Cancela un envio programado en Resend. */
export async function cancelScheduledSend(messageId: string): Promise<ResendOutcome> {
    let sdk: any = null;
    try { sdk = (await import('@/lib/resend')).resend?.emails; } catch { sdk = null; } // sin RESEND_API_KEY el SDK lanza al crearse
    if (sdk && typeof sdk.cancel === 'function') {
        try {
            const r = await sdk.cancel(messageId);
            const err = r?.error;
            if (!err) return { ok: true };
            const status = Number(err.statusCode ?? 0);
            return { ok: false, kind: classify(status), status, message: String(err.message ?? 'cancel failed').slice(0, 200) };
        } catch (error) {
            return { ok: false, kind: 'unavailable', status: 0, message: error instanceof Error ? error.message.slice(0, 200) : 'cancel failed' };
        }
    }
    return request('POST', `/emails/${encodeURIComponent(messageId)}/cancel`);
}

/** Cambia la hora de un envio programado (PATCH /emails/{id} con scheduled_at). */
export async function rescheduleSend(messageId: string, when: Date): Promise<ResendOutcome> {
    return request('PATCH', `/emails/${encodeURIComponent(messageId)}`, { scheduled_at: when.toISOString() });
}

/** Mensaje HTTP + codigo de error para el cliente a partir del fallo de Resend. */
export function failureToHttp(f: Extract<ResendOutcome, { ok: false }>): { status: number; code: string; error: string } {
    switch (f.kind) {
        case 'already_sent': return { status: 409, code: 'ALREADY_SENT', error: 'The email was already sent and can no longer be changed.' };
        case 'invalid': return { status: 400, code: 'INVALID_SCHEDULE', error: 'The provider rejected that date.' };
        case 'not_found': return { status: 404, code: 'NOT_FOUND', error: 'Scheduled send not found at the provider.' };
        default: return { status: 502, code: 'PROVIDER_UNAVAILABLE', error: 'The mail provider is unavailable. Try again in a moment.' };
    }
}

// ---------------------------------------------------------------------------
// Envio inmediato por REST con Idempotency-Key (el SDK 2.x no permite cabeceras propias)
// ---------------------------------------------------------------------------

export interface RestSendPayload {
    from: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    html?: string;
    text?: string;
    reply_to?: string[];
    attachments?: Array<{ filename: string; content: string }>;
    scheduled_at?: string;
}

export type RestSendOutcome =
    | { ok: true; id: string }
    /** definitive = el proveedor RECHAZO el mensaje (no salio). false = ambiguo (red, 5xx, 429...): puede haber salido. */
    | { ok: false; definitive: boolean; status: number; message: string };

/** Rechazos que garantizan que el mensaje NO se creo. */
function isDefinitiveRejection(status: number, name: string): boolean {
    if (status === 409) return name !== 'concurrent_idempotent_requests';
    return [400, 401, 403, 404, 405, 422].includes(status);
}

/** POST /emails con `Idempotency-Key`: repetir con la misma clave devuelve el envio original (nunca crea otro). */
export async function sendEmailRest(payload: RestSendPayload, idempotencyKey: string): Promise<RestSendOutcome> {
    const base = process.env.RESEND_BASE_URL || 'https://api.resend.com';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
        const res = await fetch(`${base}/emails`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.RESEND_API_KEY || ''}`,
                'Content-Type': 'application/json',
                'Idempotency-Key': idempotencyKey.slice(0, 256),
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
        const body = (await res.json().catch(() => null)) as { id?: unknown; message?: unknown; name?: unknown } | null;
        if (res.ok) return { ok: true, id: typeof body?.id === 'string' && body.id ? body.id : `sent-${idempotencyKey}`.slice(0, 200) };
        return {
            ok: false,
            definitive: isDefinitiveRejection(res.status, String(body?.name ?? '')),
            status: res.status,
            message: String(body?.message ?? `HTTP ${res.status}`).slice(0, 200),
        };
    } catch (error) {
        return { ok: false, definitive: false, status: 0, message: error instanceof Error ? error.message.slice(0, 200) : 'network error' };
    } finally {
        clearTimeout(timer);
    }
}
