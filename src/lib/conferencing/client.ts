/**
 * Cliente (navegador) de la API de conferencias del host. Sin React.
 *
 *   GET    /api/calendar/conferencing/providers            -> { providers: ConferencingProviderStatus[] }
 *   POST   /api/calendar/conferencing/{provider}           -> { meeting: ConferencingMeeting }     (cabecera Idempotency-Key)
 *   DELETE /api/calendar/conferencing/{provider}?meetingId -> { ok: true }
 *   POST   /api/calendar/conferencing/{provider}/test      -> { ok: true, mode, detail? }          (solo admin)
 * Errores: HTTP 4xx/5xx con { error: { code, message, retryAfter? }, connect? }  -> se lanzan como ConferencingError.
 */
import {
    CONFERENCING_ERROR_CODES,
    ConferencingError,
    type ConferencingErrorCode,
    type ConferencingMeeting,
    type ConferencingProviderId,
    type ConferencingProviderStatus,
    type CreateMeetingInput,
} from './types';

const BASE = '/api/calendar/conferencing';

export function newIdempotencyKey(): string {
    const c = (globalThis as { crypto?: Crypto }).crypto;
    if (c?.randomUUID) return c.randomUUID();
    return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function toError(status: number, body: any): ConferencingError {
    const raw = body?.error;
    const code = typeof raw === 'object' && raw ? raw.code : undefined;
    const message = typeof raw === 'string' ? raw : typeof raw?.message === 'string' ? raw.message : undefined;
    const retryAfter = typeof raw === 'object' && raw && Number.isFinite(Number(raw.retryAfter)) ? Number(raw.retryAfter) : undefined;
    const known: ConferencingErrorCode = (CONFERENCING_ERROR_CODES as readonly string[]).includes(code)
        ? (code as ConferencingErrorCode)
        : status === 401
          ? 'unauthorized'
          : status === 429
            ? 'rate_limited'
            : 'provider_error';
    return new ConferencingError(known, message, { retryAfter });
}

async function parse(res: Response): Promise<any> {
    return res.json().catch(() => ({}));
}

export async function fetchProviders(init: { signal?: AbortSignal } = {}): Promise<ConferencingProviderStatus[]> {
    let res: Response;
    try {
        res = await fetch(`${BASE}/providers`, { cache: 'no-store', signal: init.signal });
    } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') throw e;
        throw new ConferencingError('provider_error', 'network');
    }
    const body = await parse(res);
    if (!res.ok) throw toError(res.status, body);
    return Array.isArray(body?.providers) ? (body.providers as ConferencingProviderStatus[]) : [];
}

export async function createMeeting(
    provider: ConferencingProviderId,
    input: CreateMeetingInput,
    opts: { idempotencyKey?: string; signal?: AbortSignal } = {},
): Promise<ConferencingMeeting> {
    let res: Response;
    try {
        res = await fetch(`${BASE}/${encodeURIComponent(provider)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': opts.idempotencyKey || newIdempotencyKey() },
            body: JSON.stringify(input),
            signal: opts.signal,
        });
    } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') throw e;
        throw new ConferencingError('provider_error', 'network');
    }
    const body = await parse(res);
    if (!res.ok || !body?.meeting?.joinUrl) throw toError(res.status, body);
    return body.meeting as ConferencingMeeting;
}

export async function deleteMeeting(provider: ConferencingProviderId, meetingId: string): Promise<void> {
    const res = await fetch(`${BASE}/${encodeURIComponent(provider)}?meetingId=${encodeURIComponent(meetingId)}`, { method: 'DELETE' });
    if (!res.ok) throw toError(res.status, await parse(res));
}

export async function testProviderConnection(provider: ConferencingProviderId): Promise<{ ok: true; mode?: string; detail?: string }> {
    const res = await fetch(`${BASE}/${encodeURIComponent(provider)}/test`, { method: 'POST' });
    const body = await parse(res);
    if (!res.ok) throw toError(res.status, body);
    return { ok: true, mode: body?.mode, detail: body?.detail };
}

/** Clave i18n (conferencing.errors.*) para un codigo de error. */
export function conferencingErrorKey(code: ConferencingErrorCode): string {
    return `conferencing.errors.${code}`;
}
