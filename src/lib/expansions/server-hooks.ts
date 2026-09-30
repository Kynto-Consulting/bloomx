/**
 * Ejecutor (lado frontend-servidor) de los hooks de extensiones: habla con `POST {BACKEND}/api/extension/hooks`.
 *
 *  - EMAIL_PRE_SEND: se llama desde POST /api/emails justo antes de enviar. Con la sesion del usuario (JWT).
 *      El resultado { stop, message, warnings, modify } se aplica en la ruta: stop => 422 y NO se envia.
 *  - EMAIL_RECEIVED: para el ingest de correo entrante (webhook de Resend). Usa el secreto de servicio
 *      (EXTENSION_HOOKS_SECRET o INTERNAL_SECRET, el mismo valor en el backend). Sin bloqueo; nunca lanza.
 *  - CRON: lo llama un planificador (Vercel Cron / GitHub Actions) directamente contra el backend con
 *      x-internal-secret; este modulo ofrece `runCronHooks` por comodidad.
 *
 * Politica de fallo de EMAIL_PRE_SEND cuando el backend no responde (red, 5xx, sin configurar):
 *   por defecto se ENVIA igual (un backend caido no debe impedir escribir correos) y se deja un aviso en el log;
 *   con EXTENSION_HOOKS_FAIL_CLOSED=true NO se envia (recomendado si DLP es obligatorio).
 *   EXTENSION_HOOKS_DISABLED=true desactiva por completo la llamada.
 */

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
    /** JWT de sesion del usuario (Authorization: Bearer) */
    token?: string | null;
    /** Dominio del tenant (X-BloomX-Domain) */
    host?: string | null;
    userId?: string | null;
    email?: string | null;
    /** Usa el secreto de servicio en lugar del JWT (EMAIL_RECEIVED) */
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

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (transport.internal) {
        const secret = process.env.EXTENSION_HOOKS_SECRET || process.env.INTERNAL_SECRET;
        if (!secret) throw new Error('hooks secret not configured');
        headers['x-internal-secret'] = secret;
    } else {
        headers.Authorization = `Bearer ${transport.token || ''}`;
        if (transport.userId) headers['X-User-ID'] = transport.userId;
        if (transport.email) headers['X-User-Email'] = transport.email;
    }
    if (transport.host) headers['X-BloomX-Domain'] = transport.host.split(':')[0];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), transport.timeoutMs ?? 10_000);
    try {
        const response = await fetchImpl(`${backendUrl}/api/extension/hooks`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ event, context }),
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
    try {
        const json = await callBackendHooks('EMAIL_RECEIVED', context, { ...transport, internal: true, host: transport.host || context.domain || null });
        return { executed: Array.isArray(json?.results) ? json.results.length : 0 };
    } catch (error: any) {
        console.error('[EXTENSION_HOOKS] EMAIL_RECEIVED fallo:', String(error?.message || 'error').slice(0, 120));
        return null;
    }
}

/** CRON (schedule hourly|daily). Pensado para el planificador del operador. */
export async function runCronHooks(schedule: 'hourly' | 'daily', transport: HookTransport = {}): Promise<any> {
    const backendUrl = (transport.backendUrl || process.env.NEXT_PUBLIC_BACKEND_URL || DEFAULT_BACKEND).replace(/\/+$/, '');
    const secret = process.env.EXTENSION_HOOKS_SECRET || process.env.INTERNAL_SECRET;
    if (!secret) throw new Error('hooks secret not configured');
    const response = await (transport.fetchImpl || fetch)(`${backendUrl}/api/extension/hooks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
        body: JSON.stringify({ event: 'CRON', schedule }),
    });
    if (!response.ok) throw new Error(`hooks backend responded ${response.status}`);
    return response.json();
}

/** Adaptador para rutas de Next: obtiene JWT (cookie) y dominio de la peticion. */
export async function runEmailPreSendHooksForRequest(
    req: Request,
    user: { id: string; email?: string | null },
    message: PreSendMessage,
): Promise<PreSendResult> {
    const [{ cookies }, { COOKIE_NAME }] = await Promise.all([import('next/headers'), import('@/lib/jwt')]);
    const token = (await cookies()).get(COOKIE_NAME)?.value || null;
    const host = process.env.TOP_DOMAIN || req.headers.get('host') || '';
    return runEmailPreSendHooks(message, { token, host, userId: user.id, email: user.email });
}
