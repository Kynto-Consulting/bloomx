/**
 * elixir-send.ts — piezas server-side del envio masivo de Elixir (sin dependencias de Next/Prisma,
 * para poder probarlas con vitest):
 *
 *  - `sendWithRetry`: backoff exponencial con jitter ante 429/5xx/red, respeta `Retry-After` y un `deadline`;
 *    si el reintento ya no cabe en el presupuesto de tiempo devuelve `defer` (la fila queda pendiente y el
 *    cliente la reintenta; la idempotencia evita duplicados).
 *  - `idempotencyKey`: clave estable por (campana, destinatario).
 *  - `createResendSender`: llamada REST directa a Resend con cabecera `Idempotency-Key` (el SDK 2.1.0 no la expone).
 *  - `htmlToText`, `appendUnsubscribeFooter`.
 */

import { createHash } from 'crypto';

export type SendOutcome =
    | { ok: true; id?: string }
    | { ok: false; message: string; statusCode?: number; name?: string; retryAfterMs?: number; network?: boolean };

export type SendFn = () => Promise<SendOutcome>;

export type RetryResult =
    | { kind: 'sent'; id?: string; attempts: number }
    | { kind: 'error'; message: string; attempts: number; retryable: boolean }
    | { kind: 'defer'; retryAfterMs: number; attempts: number; message: string };

export interface RetryOptions {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    /** Instante (epoch ms) a partir del cual no se debe dormir mas. */
    deadline?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    random?: () => number;
}

const RETRYABLE_NAMES = new Set([
    'rate_limit_exceeded', 'daily_quota_exceeded_retry', 'application_error', 'internal_server_error',
    'concurrent_idempotent_requests', 'service_unavailable',
]);

export function isRetryable(o: Extract<SendOutcome, { ok: false }>): boolean {
    if (o.network) return true;
    if (o.name && RETRYABLE_NAMES.has(o.name)) return true;
    const s = o.statusCode;
    if (s === undefined) return false;
    return s === 429 || s === 408 || (s === 409 && o.name === 'concurrent_idempotent_requests') || s >= 500;
}

/** Parsea `Retry-After` (segundos o fecha HTTP) a milisegundos. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
    if (!value) return undefined;
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return Math.round(n * 1000);
    const t = Date.parse(value);
    return Number.isNaN(t) ? undefined : Math.max(0, t - now);
}

export async function sendWithRetry(fn: SendFn, opts: RetryOptions = {}): Promise<RetryResult> {
    const {
        maxAttempts = 4, baseDelayMs = 1000, maxDelayMs = 15_000,
        sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms)),
        now = () => Date.now(), random = Math.random,
    } = opts;
    const deadline = opts.deadline ?? Infinity;
    let last = 'Error desconocido';
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let outcome: SendOutcome;
        try { outcome = await fn(); }
        catch (e) { outcome = { ok: false, message: (e as Error)?.message || 'Error de red', network: true }; }
        if (outcome.ok) return { kind: 'sent', id: outcome.id, attempts: attempt };
        last = outcome.message || last;
        const retryable = isRetryable(outcome);
        if (!retryable) return { kind: 'error', message: last, attempts: attempt, retryable: false };

        const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)) * (0.75 + random() * 0.5);
        const delay = Math.max(outcome.retryAfterMs ?? 0, backoff);
        const exhausted = attempt === maxAttempts;
        if (exhausted || now() + delay > deadline) {
            // Sin tiempo/intentos: no marcar como error definitivo; que el cliente reintente (idempotente).
            return { kind: 'defer', retryAfterMs: Math.ceil(delay), attempts: attempt, message: last };
        }
        await sleep(delay);
    }
    return { kind: 'defer', retryAfterMs: baseDelayMs, attempts: maxAttempts, message: last };
}

/** Clave de idempotencia estable por (campana, destinatario). Max 256 chars (Resend). */
export function idempotencyKey(campaignId: string, recipient: string): string {
    const h = createHash('sha256').update(`${campaignId}\u0000${recipient.trim().toLowerCase()}`).digest('hex').slice(0, 40);
    return `elixir-${campaignId.slice(0, 64)}-${h}`;
}

export interface ResendPayload {
    from: string;
    to: string[];
    subject: string;
    html: string;
    text?: string;
    cc?: string[];
    bcc?: string[];
    headers?: Record<string, string>;
    reply_to?: string;
    tags?: Array<{ name: string; value: string }>;
}

export function createResendSender(apiKey: string | undefined, fetchImpl: typeof fetch = fetch, baseUrl = 'https://api.resend.com') {
    return async function send(payload: ResendPayload, idemKey: string): Promise<SendOutcome> {
        if (!apiKey) return { ok: false, message: 'RESEND_API_KEY no configurada', statusCode: 500, name: 'missing_api_key' };
        let res: Response;
        try {
            res = await fetchImpl(`${baseUrl}/emails`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idemKey },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(20_000),
            });
        } catch (e) {
            return { ok: false, message: (e as Error)?.message || 'Error de red', network: true };
        }
        let body: unknown = null;
        try { body = await res.json(); } catch { /* cuerpo vacio */ }
        if (res.ok) return { ok: true, id: (body as { id?: string } | null)?.id };
        const b = (body ?? {}) as { message?: unknown; name?: unknown };
        return {
            ok: false,
            message: typeof b.message === 'string' && b.message ? b.message : `Resend respondió ${res.status}`,
            name: typeof b.name === 'string' ? b.name : undefined,
            statusCode: res.status,
            retryAfterMs: parseRetryAfter(res.headers.get('retry-after')),
        };
    };
}

// ── Contenido ────────────────────────────────────────────────────────────────

/** Version texto plano (multipart/alternative) del HTML: mejora entregabilidad. */
export function htmlToText(html: string): string {
    let s = html
        .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
            const label = inner.replace(/<[^>]*>/g, '').trim();
            return label && label !== href ? `${label} (${href})` : href;
        })
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|tr|li|table|blockquote)>/gi, '\n')
        .replace(/<li\b[^>]*>/gi, '- ')
        .replace(/<[^>]*>/g, '');
    s = s
        .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function escAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Anade el pie de baja (antes de </body> si existe). */
export function appendUnsubscribeFooter(html: string, url: string, lang: 'es' | 'en' = 'es'): string {
    const label = lang === 'es' ? 'Si no deseas recibir más correos, puedes darte de baja aquí.' : 'If you no longer wish to receive these emails, you can unsubscribe here.';
    const footer = `<div style="font-family:Arial,sans-serif;font-size:12px;color:#888;text-align:center;margin:24px 0 8px"><a href="${escAttr(url)}" style="color:#888;text-decoration:underline">${label}</a></div>`;
    const i = html.search(/<\/body\s*>/i);
    return i === -1 ? html + footer : html.slice(0, i) + footer + html.slice(i);
}

/** La plantilla ya incluye su propio enlace de baja. */
export function templateHasUnsubscribe(template: string): boolean {
    return /\bunsubscribe_url\b/.test(template);
}
