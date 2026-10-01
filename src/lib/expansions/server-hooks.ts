import { backendUrl as defaultBackendUrl } from '@/lib/backend-url';
/**
 * Ejecutor (lado frontend-servidor) de los hooks de extensiones: habla con `POST {BACKEND}/api/extension/hooks`.
 *
 * Autenticacion hacia el backend COMPARTIDO sin secretos: firma Ed25519 con BLOOMX_DOMAIN_PRIVATE_KEY si esta definida
 * (ver lib/backend-auth.ts); si no, protocolo antiguo por cabeceras (modo LEGADO del backend). Ya no se reenvia el JWT de
 * sesion ni existe x-internal-secret hacia el backend.
 *
 *  - EMAIL_PRE_SEND: se llama desde POST /api/emails justo antes de enviar (funciona en modo legado y firmado).
 *      El resultado { stop, message, warnings, modify } se aplica en la ruta: stop => 422 y NO se envia.
 *  - EMAIL_RECEIVED: para el ingest de correo entrante (webhook de Resend). Requiere dominio FIRMADO (el backend rechaza
 *      este evento en modo legado): sin BLOOMX_DOMAIN_PRIVATE_KEY se omite. Sin bloqueo; nunca lanza.
 *  - Eventos de ciclo de vida (EMAIL_OPENED, EMAIL_SENT, COMPOSE_OPENED, CALENDAR_EVENT_*, CONTACT_*, APPOINTMENT_BOOKED):
 *      `fireLifecycleHook`. Contexto MINIMO (buildXxxContext), no bloqueante, nunca lanza, no-op en modo legado.
 *  - CRON: `runCronHooks` ejecuta los intercepts CRON de ESTE dominio (firmado). El cron global de todos los dominios es
 *      del operador del backend (BACKEND_CRON_SECRET en el backend).
 *
 * Preferencias del usuario: en dominios FIRMADOS la peticion lleva ademas `disabledExtensions` (las que ESE usuario desactivo en
 *  /extensions, leidas de sus ajustes en el servidor, validadas y acotadas a 200). Va dentro del cuerpo firmado. El backend NO ejecuta esas
 *  extensiones para ese usuario, EXCEPTO las obligatorias (`mandatory` en el manifest o politica del dominio). En modo LEGADO (sin
 *  clave) no se envia y se ejecuta todo como antes. Si no se pueden leer las preferencias tampoco se envia (se ejecutan todas).
 *
 * Politica de fallo de EMAIL_PRE_SEND cuando el backend no responde (red, 5xx, sin configurar):
 *   por defecto se ENVIA igual (un backend caido no debe impedir escribir correos) y se deja un aviso en el log;
 *   con EXTENSION_HOOKS_FAIL_CLOSED=true NO se envia (recomendado si DLP es obligatorio).
 *   EXTENSION_HOOKS_DISABLED=true desactiva por completo la llamada.
 */

import { after } from 'next/server';
import { buildBackendHeaders, loadDomainPrivateKey } from '@/lib/backend-auth';
import { rateLimit } from '@/lib/security';
import { LIFECYCLE_EVENTS } from './manifest-schema';
import { MAX_DISABLED_FOR_SERVER, loadDisabledExtensionsForUser } from './user-disabled';

export type LifecycleEvent =
    | 'EMAIL_OPENED' | 'EMAIL_SENT' | 'COMPOSE_OPENED'
    | 'CALENDAR_EVENT_CREATED' | 'CALENDAR_EVENT_UPDATED' | 'CALENDAR_EVENT_CANCELLED'
    | 'CONTACT_SAVED' | 'CONTACT_DELETED' | 'APPOINTMENT_BOOKED';
export type HookEvent = 'EMAIL_PRE_SEND' | 'EMAIL_RECEIVED' | 'CRON' | LifecycleEvent;

export interface PreSendMessage {
    subject?: string | null;
    html?: string | null;
    text?: string | null;
    to?: string[];
    cc?: string[];
    bcc?: string[];
    from?: string | null;
    attachments?: Array<{ filename?: string | null }>;
}

export interface PreSendResult {
    /** true => el mensaje NO debe enviarse */
    stop: boolean;
    message?: string;
    warnings: string[];
    /** Reemplazos permitidos: solo asunto y cuerpo (nunca destinatarios ni remitente). */
    modify: { subject?: string; html?: string; text?: string };
    /** true si el backend no pudo evaluar los hooks (se aplico la politica de fallo) */
    unavailable?: boolean;
}

export interface HookTransport {
    fetchImpl?: typeof fetch;
    backendUrl?: string;
    /** @deprecated Ignorado: el JWT de sesion ya no se reenvia al backend. */
    token?: string | null;
    /** Dominio del tenant (X-BloomX-Domain) */
    host?: string | null;
    userId?: string | null;
    email?: string | null;
    /** Llamada de servicio (EMAIL_RECEIVED/CRON): exige clave de dominio (firma); nunca se degrada a legado. */
    internal?: boolean;
    timeoutMs?: number;
    /** Extensiones desactivadas por el usuario (ya leidas). Si es undefined y hay usuario, se leen de sus ajustes (withUserDisabled). */
    disabledExtensions?: string[];
    /** Lector de las preferencias del usuario (inyectable en pruebas). Por defecto: BD. */
    loadDisabled?: (userId: string) => Promise<string[]>;
}

const MAX_FIELD = 200_000;

function clip(value: unknown): string {
    return typeof value === 'string' ? value.slice(0, MAX_FIELD) : '';
}

/** Contexto que ven los handlers (DLP lee subject, emailContent, attachments[].filename). */
export function buildPreSendContext(message: PreSendMessage): Record<string, unknown> {
    const html = clip(message.html);
    const text = clip(message.text);
    return {
        subject: clip(message.subject).slice(0, 998),
        html,
        text,
        emailContent: [html, text].filter(Boolean).join('\n'),
        to: (message.to || []).slice(0, 200),
        cc: (message.cc || []).slice(0, 200),
        bcc: (message.bcc || []).slice(0, 200),
        from: clip(message.from).slice(0, 320),
        attachments: (message.attachments || []).slice(0, 50).map((attachment) => ({ filename: clip(attachment?.filename).slice(0, 255) })),
    };
}

/** Interpreta la respuesta JSON del backend. Lo desconocido se ignora; solo se aceptan strings en modify. */
export function interpretPreSendResponse(json: any): PreSendResult {
    const result: PreSendResult = { stop: false, warnings: [], modify: {} };
    if (!json || typeof json !== 'object') return result;

    if (json.stop === true) {
        result.stop = true;
        result.message = typeof json.message === 'string' && json.message ? json.message.slice(0, 500) : 'Message blocked by an extension policy';
    }
    if (Array.isArray(json.warnings)) {
        result.warnings = json.warnings.filter((item: unknown) => typeof item === 'string').slice(0, 10).map((item: string) => item.slice(0, 500));
    }
    if (json.modify && typeof json.modify === 'object') {
        for (const field of ['subject', 'html', 'text'] as const) {
            if (typeof json.modify[field] === 'string') result.modify[field] = json.modify[field];
        }
    }
    return result;
}

function envFlag(name: string): boolean {
    return String(process.env[name] || '').toLowerCase() === 'true';
}

const DISABLED_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

/** Lista `disabledExtensions` lista para el cuerpo firmado: solo ids validos, sin duplicados y acotada. */
export function sanitizeDisabledForRequest(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const out = new Set<string>();
    for (const item of raw) {
        if (typeof item === 'string' && DISABLED_ID_RE.test(item)) out.add(item);
        if (out.size >= MAX_DISABLED_FOR_SERVER) break;
    }
    return Array.from(out);
}

/**
 * Completa el transporte con las extensiones que el usuario desactivo. Solo en dominios FIRMADOS y con usuario; nunca lanza (si no se
 * pueden leer las preferencias se sigue sin lista: se ejecutan todas, como siempre).
 */
export async function withUserDisabled(transport: HookTransport): Promise<HookTransport> {
    if (transport.disabledExtensions !== undefined || !transport.userId || !loadDomainPrivateKey()) return transport;
    try {
        const ids = await (transport.loadDisabled ?? loadDisabledExtensionsForUser)(transport.userId);
        return { ...transport, disabledExtensions: sanitizeDisabledForRequest(ids) };
    } catch {
        return transport;
    }
}

/** Llamada cruda al backend. Lanza si la respuesta no es 2xx o el cuerpo no es JSON. */
export async function callBackendHooks(event: HookEvent, context: Record<string, unknown>, transport: HookTransport = {}): Promise<any> {
    const fetchImpl = transport.fetchImpl || fetch;
    const backendUrl = (transport.backendUrl || defaultBackendUrl()).replace(/\/+$/, '');

    if (transport.internal && !loadDomainPrivateKey()) throw new Error('domain signing key not configured');

    const url = `${backendUrl}/api/extension/hooks`;
    // La lista solo viaja en dominios FIRMADOS (dentro del cuerpo firmado), con usuario y fuera de CRON (que no tiene usuario).
    const disabled = event !== 'CRON' && transport.userId && loadDomainPrivateKey() ? sanitizeDisabledForRequest(transport.disabledExtensions) : [];
    const rawBody = JSON.stringify(disabled.length > 0 ? { event, context, disabledExtensions: disabled } : { event, context });
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...buildBackendHeaders({
            method: 'POST',
            url,
            body: rawBody,
            domain: transport.host || '',
            userId: transport.userId,
            email: transport.email,
        }),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), transport.timeoutMs ?? 10_000);
    try {
        const response = await fetchImpl(url, {
            method: 'POST',
            headers,
            body: rawBody,
            signal: controller.signal,
        });
        if (!response.ok) throw new Error(`hooks backend responded ${response.status}`);
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

/** EMAIL_PRE_SEND con la politica de fallo descrita arriba. Nunca lanza. */
export async function runEmailPreSendHooks(message: PreSendMessage, transport: HookTransport = {}): Promise<PreSendResult> {
    if (envFlag('EXTENSION_HOOKS_DISABLED')) return { stop: false, warnings: [], modify: {} };

    try {
        const json = await callBackendHooks('EMAIL_PRE_SEND', buildPreSendContext(message), await withUserDisabled(transport));
        return interpretPreSendResponse(json);
    } catch (error: any) {
        // Sin destinatarios ni contenido en el log (PII)
        console.error('[EXTENSION_HOOKS] EMAIL_PRE_SEND no disponible:', error?.name === 'AbortError' ? 'timeout' : String(error?.message || 'error').slice(0, 120));
        if (envFlag('EXTENSION_HOOKS_FAIL_CLOSED')) {
            return {
                stop: true,
                unavailable: true,
                message: 'Security checks are temporarily unavailable, so the message was not sent. Try again in a moment.',
                warnings: [],
                modify: {},
            };
        }
        return { stop: false, unavailable: true, warnings: [], modify: {} };
    }
}

/** EMAIL_RECEIVED: no bloquea y nunca lanza (el ingest de correo no puede depender de una extension). */
export async function runEmailReceivedHooks(
    context: { emailId: string; userId: string; domain?: string | null } & Record<string, unknown>,
    transport: HookTransport = {},
): Promise<{ executed: number } | null> {
    if (envFlag('EXTENSION_HOOKS_DISABLED')) return null;
    // El backend solo admite EMAIL_RECEIVED de un dominio firmado: sin clave se omite en silencio (modo legado).
    if (!loadDomainPrivateKey()) return null;
    try {
        // El dueño del buzon viaja como X-User-ID FIRMADO (el backend lo usa como trustedUserId).
        const json = await callBackendHooks('EMAIL_RECEIVED', context, await withUserDisabled({
            ...transport,
            internal: true,
            host: transport.host || context.domain || process.env.TOP_DOMAIN || null,
            userId: transport.userId || context.userId,
        }));
        return { executed: Array.isArray(json?.results) ? json.results.length : 0 };
    } catch (error: any) {
        console.error('[EXTENSION_HOOKS] EMAIL_RECEIVED fallo:', String(error?.message || 'error').slice(0, 120));
        return null;
    }
}

/** CRON (schedule hourly|daily) de ESTE dominio: requiere BLOOMX_DOMAIN_PRIVATE_KEY (firmado). */
export async function runCronHooks(schedule: 'hourly' | 'daily', transport: HookTransport = {}): Promise<any> {
    const host = transport.host || process.env.TOP_DOMAIN || null;
    if (!host) throw new Error('domain not configured');
    return callBackendHooks('CRON', { schedule } as Record<string, unknown>, { ...transport, internal: true, host });
}

/** Adaptador para rutas de Next: obtiene JWT (cookie) y dominio de la peticion. */
export async function runEmailPreSendHooksForRequest(
    req: Request,
    user: { id: string; email?: string | null },
    message: PreSendMessage,
): Promise<PreSendResult> {
    const host = process.env.TOP_DOMAIN || req.headers.get('host') || '';
    return runEmailPreSendHooks(message, { host, userId: user.id, email: user.email });
}

// ---------------------------------------------------------------------------------------------------------------
// Eventos de ciclo de vida (no bloqueantes, contexto minimo con lista blanca)
// ---------------------------------------------------------------------------------------------------------------

function str(value: unknown, max: number): string {
    return typeof value === 'string' ? value.slice(0, max) : '';
}
function iso(value: unknown): string {
    if (value === null || value === undefined || value === '') return '';
    const date = value instanceof Date ? value : new Date(value as any);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}
function count(value: unknown): number {
    if (Array.isArray(value)) return Math.min(value.length, 1000);
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 1000) : 0;
}
/** Extrae la direccion de "Nombre <a@x.com>" en minusculas (solo el correo, nunca el nombre). */
function addressOnly(value: unknown): string {
    const raw = str(value, 400);
    const bracket = raw.match(/<([^<>\s]+@[^<>\s]+)>/);
    const found = bracket ? bracket[1] : raw.match(/[^\s<>",;]+@[^\s<>",;]+/)?.[0] || '';
    return found.toLowerCase().slice(0, 320);
}

export function buildEmailOpenedContext(input: { emailId: unknown; folder?: unknown; from?: unknown; isRead?: unknown }): Record<string, unknown> {
    return { emailId: str(input.emailId, 100), folder: str(input.folder, 50), fromEmail: addressOnly(input.from), isRead: input.isRead === true };
}

export function buildEmailSentContext(input: { emailId: unknown; to?: unknown; cc?: unknown; bcc?: unknown; hasAttachments?: unknown; sentAt?: unknown }): Record<string, unknown> {
    return {
        emailId: str(input.emailId, 100),
        toCount: count(input.to),
        ccCount: count(input.cc),
        bccCount: count(input.bcc),
        hasAttachments: input.hasAttachments === true,
        sentAt: iso(input.sentAt) || new Date().toISOString(),
    };
}

export const COMPOSE_MODES = ['new', 'reply', 'replyAll', 'forward'] as const;
export function buildComposeOpenedContext(input: { mode?: unknown; inReplyToEmailId?: unknown; draftId?: unknown }): Record<string, unknown> {
    const mode = (COMPOSE_MODES as readonly string[]).includes(input.mode as string) ? (input.mode as string) : 'new';
    const out: Record<string, unknown> = { mode };
    const reply = str(input.inReplyToEmailId, 100);
    const draft = str(input.draftId, 100);
    if (reply) out.inReplyToEmailId = reply;
    if (draft) out.draftId = draft;
    return out;
}

export function buildCalendarEventContext(input: {
    eventId: unknown; calendarId?: unknown; startsAt?: unknown; endsAt?: unknown; allDay?: unknown; status?: unknown; attendees?: unknown; attendeeCount?: unknown; source?: unknown;
}): Record<string, unknown> {
    return {
        eventId: str(input.eventId, 100),
        calendarId: str(input.calendarId, 100),
        startsAt: iso(input.startsAt),
        endsAt: iso(input.endsAt),
        allDay: input.allDay === true,
        status: str(input.status, 30),
        attendeeCount: Array.isArray(input.attendees) ? count(input.attendees) : count(input.attendeeCount),
        source: str(input.source, 30),
    };
}

export function buildContactSavedContext(input: { contactId: unknown; email?: unknown; created?: unknown; source?: unknown }): Record<string, unknown> {
    return { contactId: str(input.contactId, 100), email: addressOnly(input.email), created: input.created === true, source: str(input.source, 30) };
}

export function buildContactDeletedContext(input: { contactId: unknown }): Record<string, unknown> {
    return { contactId: str(input.contactId, 100) };
}

export function buildAppointmentBookedContext(input: { bookingId: unknown; scheduleId?: unknown; startsAt?: unknown; endsAt?: unknown; guestEmail?: unknown; calendarEventId?: unknown }): Record<string, unknown> {
    const out: Record<string, unknown> = {
        bookingId: str(input.bookingId, 100),
        scheduleId: str(input.scheduleId, 100),
        startsAt: iso(input.startsAt),
        endsAt: iso(input.endsAt),
        guestEmail: addressOnly(input.guestEmail),
    };
    const eventId = str(input.calendarEventId, 100);
    if (eventId) out.calendarEventId = eventId;
    return out;
}

const LIFECYCLE_TIMEOUT_MS = 5_000;
const LIFECYCLE_RATE_PER_MIN = 60;

export interface LifecycleOptions extends HookTransport {
    /** Fuerza ejecucion sin after() (promesa suelta con catch); util en pruebas. */
    inline?: boolean;
}

/** Ejecuta el hook ya validado. Nunca lanza. */
async function runLifecycle(event: LifecycleEvent, userId: string, context: Record<string, unknown>, opts: LifecycleOptions): Promise<void> {
    try {
        const { inline: _inline, ...transport } = opts;
        await callBackendHooks(event, context, await withUserDisabled({
            ...transport,
            internal: true,
            host: transport.host || process.env.TOP_DOMAIN || null,
            userId,
            timeoutMs: transport.timeoutMs ?? LIFECYCLE_TIMEOUT_MS,
        }));
    } catch (error: any) {
        console.error(`[EXTENSION_HOOKS] ${event} fallo:`, error?.name === 'AbortError' ? 'timeout' : String(error?.message || 'error').slice(0, 120));
    }
}

/**
 * Dispara un evento de ciclo de vida. NO bloqueante y nunca lanza. No-op en modo legado (sin clave de dominio),
 * con EXTENSION_HOOKS_DISABLED, con evento desconocido o al superar 60 eventos/min por usuario+evento.
 * Usa after() de next/server dentro de una peticion; fuera de ella cae a una promesa suelta con catch.
 * Devuelve true si se programo la ejecucion.
 */
export function fireLifecycleHook(event: LifecycleEvent, userId: string | null | undefined, context: Record<string, unknown>, opts: LifecycleOptions = {}): boolean {
    try {
        if (envFlag('EXTENSION_HOOKS_DISABLED')) return false;
        if (!userId || !(LIFECYCLE_EVENTS as string[]).includes(event)) return false;
        if (!loadDomainPrivateKey()) return false;
        if (!rateLimit(`ext-hook:${event}:${userId}`, LIFECYCLE_RATE_PER_MIN, 60_000).ok) return false;

        const task = () => runLifecycle(event, userId, context, opts);
        if (!opts.inline) {
            try {
                after(task);
                return true;
            } catch {
                // fuera del ambito de una peticion: fallback
            }
        }
        void task().catch(() => undefined);
        return true;
    } catch {
        return false;
    }
}

/** Dedupe en memoria (por proceso) para eventos repetitivos, p.ej. EMAIL_OPENED por usuario+correo. */
const recentKeys = new Map<string, number>();
export function shouldFireOnce(key: string, windowMs = 60_000, now = Date.now()): boolean {
    const last = recentKeys.get(key);
    if (last !== undefined && now - last < windowMs) return false;
    recentKeys.set(key, now);
    if (recentKeys.size > 5000) {
        for (const [k, t] of recentKeys) if (now - t >= windowMs) recentKeys.delete(k);
        if (recentKeys.size > 5000) recentKeys.clear();
    }
    return true;
}
