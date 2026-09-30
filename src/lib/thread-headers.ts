// Cabeceras de hilo de un correo entrante: de las cabeceras del payload (Resend), de un registro cualquiera o del MIME crudo.
// Puro (sin red ni BD). Ver lib/threading.ts para el algoritmo y lib/thread-store.ts para la persistencia.
import { parseHeadersOnly } from '@/lib/mail-transfer/mime-parse';
import { HINT_PREFIX, capRefs, normalizeMessageId, parseMessageIdList, parseStoredHints, parseStoredRefs, threadHeadersFrom, type ThreadHeaders } from '@/lib/threading';

export interface InboundThreadInfo extends ThreadHeaders {
    /** Pistas secundarias de conversacion (Thread-Index de Outlook/Exchange), opacas, sin repetir. */
    hints: string[];
    /** Thread-Topic de Outlook (asunto de la conversacion), por si el Subject falta. */
    topic: string | null;
    /** List-Id: correo de una lista de distribucion. */
    listId: string | null;
    /** Auto-Submitted distinto de "no" (RFC 3834): notificaciones/autorespuestas. */
    autoSubmitted: boolean;
    /** Precedence: bulk | list | junk. */
    bulk: boolean;
}

type Bag = Record<string, unknown>;

function lowerBag(rec: Bag | null | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(rec ?? {})) {
        const key = k.toLowerCase();
        const text = Array.isArray(v) ? v.map((x) => String(x ?? '')).join(' ') : v === null || v === undefined ? '' : typeof v === 'object' ? '' : String(v);
        if (text && !(key in out)) out[key] = text;
    }
    return out;
}

/** Identificador de conversacion de Outlook/Exchange: los primeros 22 bytes del Thread-Index (MS-OXOMSG 2.2.1.3), como pista `~ci:<hex>`. */
export function conversationHintFromThreadIndex(value: string | null | undefined): string | null {
    const raw = String(value ?? '').replace(/\s+/g, '');
    if (!raw || raw.length > 400 || !/^[A-Za-z0-9+/=_-]+$/.test(raw)) return null;
    let bytes: Buffer;
    try { bytes = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64'); } catch { return null; }
    if (bytes.length < 22) return null;
    return `${HINT_PREFIX}ci:${bytes.subarray(0, 22).toString('hex')}`;
}

/** Cabeceras de hilo de un registro de cabeceras (objeto nombre -> valor, como el `headers` del webhook) mas un Message-ID aparte. */
export function threadInfoFromRecord(headers: Bag | null | undefined, extraMessageId?: unknown): InboundThreadInfo {
    const h = lowerBag(headers);
    const base = threadHeadersFrom({
        messageId: h['message-id'] ?? extraMessageId,
        inReplyTo: h['in-reply-to'] ?? null,
        references: h['references'] ?? null,
    });
    const hint = conversationHintFromThreadIndex(h['thread-index']);
    const auto = (h['auto-submitted'] || '').trim().toLowerCase();
    return {
        // Si el registro no trae Message-ID pero el payload si (Resend: data.message_id), se usa el del payload.
        ...(base.messageId ? base : { ...base, messageId: normalizeMessageId(extraMessageId) }),
        hints: hint ? [hint] : [],
        topic: h['thread-topic'] ? h['thread-topic'].trim().slice(0, 300) : null,
        listId: h['list-id'] ? h['list-id'].trim().slice(0, 300) : null,
        autoSubmitted: Boolean(auto) && auto !== 'no',
        bulk: /\b(bulk|list|junk)\b/i.test(h['precedence'] || ''),
    };
}

/** Cabeceras de hilo de un MIME crudo (solo lee la cabecera; tolera cabeceras plegadas y mensajes truncados). */
export function threadInfoFromRawMime(raw: Buffer): InboundThreadInfo {
    const parsed = parseHeadersOnly(raw);
    const rec: Bag = {};
    for (const [k, v] of Object.entries(parsed.headers)) rec[k] = v[0] ?? '';
    // References puede repetirse (algunos clientes emiten dos lineas): se unen todas.
    if (parsed.headers['references']) rec['references'] = parsed.headers['references'].join(' ');
    if (parsed.headers['in-reply-to']) rec['in-reply-to'] = parsed.headers['in-reply-to'].join(' ');
    return threadInfoFromRecord(rec, parsed.messageId);
}

/** Cabeceras de hilo de las cabeceras ya analizadas de un mensaje (`ParsedMail.headers`: nombre en minusculas -> valores). */
export function threadInfoFromParsedHeaders(headers: Record<string, string[]> | null | undefined): InboundThreadInfo {
    const rec: Bag = {};
    for (const [k, v] of Object.entries(headers ?? {})) rec[k] = Array.isArray(v) ? (k === 'references' || k === 'in-reply-to' ? v.join(' ') : v[0] ?? '') : String(v ?? '');
    return threadInfoFromRecord(rec);
}

/** Cabeceras de hilo del payload guardado (raw.json del webhook): `data.headers` + `data.message_id`. */
export function threadInfoFromWebhookPayload(payload: unknown): InboundThreadInfo | null {
    const root = (payload && typeof payload === 'object' ? payload : null) as Bag | null;
    if (!root) return null;
    const data = (root.data && typeof root.data === 'object' ? root.data : root) as Bag;
    const headers = (data.headers && typeof data.headers === 'object' ? data.headers : {}) as Bag;
    const info = threadInfoFromRecord(headers, data.message_id ?? data.messageId ?? headers['message-id'] ?? headers['Message-ID']);
    return info.messageId || info.inReplyTo || info.refs.length > 0 || info.hints.length > 0 ? info : null;
}

/** Referencias + pistas en el formato de `Email.refs` (pistas al FINAL: la raiz declarada sigue siendo la primera referencia real). */
export function packRefs(refs: string[], hints: string[]): string | null {
    const all = [...capRefs(refs), ...hints.filter((h) => h.startsWith(HINT_PREFIX))];
    return all.length > 0 ? all.join(' ') : null;
}

/** Inverso de packRefs. */
export function unpackRefs(text: string | null | undefined): { refs: string[]; hints: string[] } {
    return { refs: parseStoredRefs(text), hints: parseStoredHints(text) };
}

/** Message-ID(s) de una cabecera cualquiera, para pruebas y diagnostico. */
export function messageIdsIn(value: string | null | undefined): string[] {
    return parseMessageIdList(value ?? null);
}
