/**
 * Contexto que el renderer entrega a las extensiones.
 *
 * - toBackendContext: subconjunto JSON seguro del `context` de React que viaja a /api/extension/execute. Quita
 *   funciones, `overlays`, ganchos internos y cualquier `auth`/`user`/`env` (los inyecta el servidor; el cliente no
 *   puede fijarlos), limita profundidad y tamano de strings.
 * - buildReadingContext: normaliza el contexto de un correo abierto (MailView pasa el objeto email) para que las
 *   extensiones de lectura (summarizer, translator, notion, trello, hubspot, smart-reply) reciban `emailContent`
 *   y `fromContact`, igual que en el composer.
 */

const DROP_KEYS = new Set([
    'overlays', 'toolbarButtonMode', 'auth', 'user', 'env', 'services', 'settings', 'extension', 'domain',
    'onClose', 'close', 'openOverlay', 'openPopover', 'uploadAttachment',
]);
const MAX_STRING = 200_000;
const MAX_DEPTH = 6;
const MAX_KEYS = 200;

function sanitize(value: any, depth: number, seen: WeakSet<object>): any {
    if (value === null || value === undefined) return value;
    const type = typeof value;
    if (type === 'function' || type === 'symbol') return undefined;
    if (type === 'string') return value.length > MAX_STRING ? value.slice(0, MAX_STRING) : value;
    if (type === 'number' || type === 'boolean') return value;
    if (type === 'bigint') return String(value);
    if (depth >= MAX_DEPTH) return undefined;
    if (typeof Node !== 'undefined' && value instanceof Node) return undefined;
    if (typeof Event !== 'undefined' && value instanceof Event) return undefined;
    if (seen.has(value)) return undefined; // referencia circular
    seen.add(value);

    if (Array.isArray(value)) {
        return value.slice(0, MAX_KEYS).map((item) => sanitize(item, depth + 1, seen)).filter((item) => item !== undefined);
    }
    if (value instanceof Date) return value.toISOString();

    const out: Record<string, any> = {};
    let count = 0;
    for (const key of Object.keys(value)) {
        if (count >= MAX_KEYS) break;
        if (depth === 0 && DROP_KEYS.has(key)) continue;
        const cleaned = sanitize(value[key], depth + 1, seen);
        if (cleaned !== undefined) {
            out[key] = cleaned;
            count++;
        }
    }
    return out;
}

export function toBackendContext(context: any): Record<string, any> {
    if (!context || typeof context !== 'object') return {};
    return sanitize(context, 0, new WeakSet()) || {};
}

// ---------------------------------------------------------------------------------------------------------------

export interface FromContact {
    email: string;
    name: string;
    firstName: string;
    lastName: string;
}

/** "Ana Perez <ana@x.com>" | "ana@x.com" | '"Perez, Ana" <ana@x.com>' -> contacto. */
export function parseFromContact(from: unknown): FromContact | null {
    const raw = String(from ?? '').trim();
    if (!raw) return null;

    const bracket = raw.match(/^(.*?)<\s*([^<>\s]+@[^<>\s]+)\s*>/);
    const email = (bracket ? bracket[2] : raw.match(/[^\s<>",;]+@[^\s<>",;]+/)?.[0] || '').toLowerCase();
    if (!email) return null;

    let name = (bracket ? bracket[1] : '').trim().replace(/^"+|"+$/g, '').trim();
    if (!name) name = email.split('@')[0];

    let firstName = name;
    let lastName = '';
    if (name.includes(',')) {
        const [last, first] = name.split(',').map((part) => part.trim());
        firstName = first || last;
        lastName = first ? last : '';
    } else {
        const parts = name.split(/\s+/);
        firstName = parts[0] || '';
        lastName = parts.slice(1).join(' ');
    }
    return { email, name, firstName, lastName };
}

function stripHtml(html: string): string {
    return html
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n\s*\n+/g, '\n\n')
        .trim();
}

/**
 * Si el contexto parece un correo abierto (tiene `from` en texto) y no trae emailContent, se completa:
 *   emailContent = texto del cuerpo (content/html/text) o, en su defecto, el snippet
 *   fromContact  = { email, name, firstName, lastName }
 * No modifica contextos del composer (que ya definen emailContent y sender).
 */
export function buildReadingContext(context: any): any {
    if (!context || typeof context !== 'object') return context;
    const isEmailObject = typeof context.from === 'string' && ('messageId' in context || 'folder' in context || 'snippet' in context || 'subject' in context);
    if (!isEmailObject) return context;

    const next: Record<string, any> = { ...context };
    if (typeof next.emailContent !== 'string') {
        const body = [next.content, next.html, next.text, next.body].find((value) => typeof value === 'string' && value.trim());
        next.emailContent = body ? stripHtml(String(body)) : String(next.snippet || '');
    }
    if (!next.fromContact) {
        const contact = parseFromContact(next.from);
        if (contact) next.fromContact = contact;
    }
    return next;
}

// Contexto por punto de montaje (ver mount-points.ts). Reexportado para que el renderer importe todo desde aqui.
export { buildMountContext, MOUNT_POINT_CONTEXT } from "./mount-points";
