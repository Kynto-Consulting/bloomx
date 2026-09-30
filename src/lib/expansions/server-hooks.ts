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
 *  - CRON: `runCronHooks` ejecuta los intercepts CRON de ESTE dominio (firmado). El cron global de todos los dominios es
 *      del operador del backend (BACKEND_CRON_SECRET en el backend).
 *
 * Politica de fallo de EMAIL_PRE_SEND cuando el backend no responde (red, 5xx, sin configurar):
 *   por defecto se ENVIA igual (un backend caido no debe impedir escribir correos) y se deja un aviso en el log;
 *   con EXTENSION_HOOKS_FAIL_CLOSED=true NO se envia (recomendado si DLP es obligatorio).
 *   EXTENSION_HOOKS_DISABLED=true desactiva por completo la llamada.
 */

import { buildBackendHeaders, loadDomainPrivateKey } from '@/lib/backend-auth';

export type HookEvent = 'EMAIL_PRE_SEND' | 'EMAIL_RECEIVED' | 'CRON';

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
}

const DEFAULT_BACKEND = 'http://backend.bloomx.arubik.dev';
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

/** Llamada cruda al backend. Lanza si la respuesta no es 2xx o el cuerpo no es JSON. */
export async function callBackendHooks(event: HookEvent, context: Record<string, unknown>, transport: HookTransport = {}): Promise<any> {
    const fetchImpl = transport.fetchImpl || fetch;
    const backendUrl = (transport.backendUrl || process.env.NEXT_PUBLIC_BACKEND_URL || DEFAULT_BACKEND).replace(/\/+$/, '');

    if (transport.internal && !loadDomainPrivateKey()) throw new Error('domain signing key not configured');

    const url = `${backendUrl}/api/extension/hooks`;
    const rawBody = JSON.stringify({ event, context });
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
        const json = await callBackendHooks('EMAIL_PRE_SEND', buildPreSendContext(message), transport);
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
        const json = await callBackendHooks('EMAIL_RECEIVED', context, {
            ...transport,
            internal: true,
            host: transport.host || context.domain || process.env.TOP_DOMAIN || null,
            userId: transport.userId || context.userId,
        });
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
