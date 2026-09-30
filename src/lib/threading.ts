// Hilos de conversacion: UNA sola definicion para la interfaz (mail-list.ts), el SQL (mail-list-sql.ts), la busqueda, la ingesta
// (webhook de Resend, process-attachments), la importacion (mail-transfer) y la respuesta (In-Reply-To / References).
//
// Modulo PURO (sin React, DOM, red ni Prisma). Esquema, resumido:
//
//  1. CABECERAS (RFC 5322 3.6.4). Cada mensaje aporta Message-ID, In-Reply-To y References. Se unen (union-find) el nodo del propio
//     mensaje con el de su In-Reply-To y con los de sus References: dos mensajes estan en el mismo hilo si una cadena de referencias
//     los conecta, aunque falten mensajes intermedios, lleguen desordenados o el asunto cambie a mitad de la conversacion.
//     Es el JWZ simplificado: los ciclos son inocuos (union-find), los ids basura/gigantes se descartan, cada mensaje aporta como
//     maximo MAX_REFS referencias (la raiz + las mas recientes) y ningun hilo crece por encima de MAX_THREAD_MESSAGES.
//  2. RESPALDO sin cabeceras utiles: asunto normalizado + interseccion de participantes (sin contar al propietario del buzon) dentro
//     de una ventana de FALLBACK_WINDOW_DAYS. Solo se aplica a mensajes sin Message-ID ni cabeceras de respuesta (importados de origenes
//     pobres) o a respuestas cuyo padre no conocemos (p. ej. el proveedor de envio sustituyo nuestro Message-ID). Un mensaje NUEVO con su
//     Message-ID y sin In-Reply-To es, por definicion, una conversacion nueva y NO se junta por asunto.
//  3. CLAVE (`threadKey`): 'm:<Message-ID de la raiz>' | 'e:<id interno>' | 'h:<clave heuristica heredada>'. Es funcion del CONJUNTO de
//     mensajes del hilo: llegue en el orden que llegue, el mismo hilo da la misma clave. Al llegar un mensaje que une dos hilos, la clave
//     se recalcula y los miembros con otra clave se actualizan (thread-store.ts, por SQL en lote).
//
// Los correos antiguos sin cabeceras guardadas tienen threadKey NULL y siguen agrupandose con la clave heuristica heredada
// (`legacyThreadKey` en JS, su espejo en mail-list-sql.ts).

// ---------------------------------------------------------------------------------------------------------------------
// Asuntos multilingues
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Prefijos de respuesta/reenvio/calendario que se quitan del asunto. El MISMO texto se usa como regex de JS y como regex de Postgres (ARE),
 * por eso solo usa la sintaxis comun: grupos `(?:...)`, clases `[ \t\r\n]` (nunca `\s`, cuya definicion difiere entre motores) y
 * alternativas. Cambiarlo aqui cambia UI y SQL a la vez (el test de espejo lo comprueba con 220 correos aleatorios).
 *
 * Respuesta: Re, Res (es/pt), AW (de), SV (sv/no/da), VS (fi), Antw (nl), R (it), Odp (pl), YNT (tr), 回复/答复/回覆 (zh).
 * Reenvio: Fwd, FW, RV (es), ENC (pt), WG (de), TR (fr), I (it), VB (nl), PD (pl), VL (fi), FS (no/da), 转发/轉發/轉寄 (zh).
 * Tambien "Re[2]:" / "Re(2):" y los dos puntos de ancho completo (：).
 */
export const SUBJECT_PREFIX_WORDS = [
    'invitaci[oó]n actualizada', 'invitaci[oó]n', 'invitation updated', 'invitation canceled', 'invitation cancelled', 'invitation',
    'accepted', 'declined', 'tentative', 'cancelado', 'canceled', 'cancelled', 'updated',
    'antw', 'odp', 'ynt', 'rif', 'fwd', 'res', 'enc', 'wg', 'tr', 'fw', 'rv', 'aw', 'sv', 'vs', 'vb', 'pd', 'vl', 'fs', 're', 'r', 'i',
    '回复', '答复', '回覆', '转发', '轉發', '轉寄',
];
export const SUBJECT_PREFIX_SOURCE = `^[ \\t\\r\\n]*(?:(?:${SUBJECT_PREFIX_WORDS.join('|')})(?:[ \\t]*[\\[(][0-9]{1,3}[\\])])?[ \\t\\r\\n]*[:：][ \\t\\r\\n]*)+`;
const SUBJECT_PREFIX_RE = new RegExp(SUBJECT_PREFIX_SOURCE, 'i');
/** Prefijos que indican RESPUESTA (no reenvio ni calendario): un asunto que empieza asi es una respuesta aunque falten cabeceras. */
const REPLY_WORDS = ['antw', 'odp', 'ynt', 'res', 'aw', 'sv', 'vs', 're', 'r', '回复', '答复', '回覆'];
const REPLY_HEAD_RE = new RegExp(`^(?:${REPLY_WORDS.join('|')})(?:[ \\t]*[\\[(][0-9]{1,3}[\\])])?[ \\t]*[:：]`, 'i');

const TRIM_RE = /^[ \t\r\n]+|[ \t\r\n]+$/g;
const trimWs = (s: string) => s.replace(TRIM_RE, '');

/** Asunto sin prefijos Re:/Fwd:/... (en cualquier idioma) ni marcas de calendario. Espejo exacto: mail-list-sql.ts (NORMALIZED_SUBJECT_LATERAL). */
export function normalizeSubject(subject: string | null | undefined): string {
    if (!subject) return '';
    return trimWs(String(subject).replace(SUBJECT_PREFIX_RE, ''));
}

/** true si el asunto empieza como una respuesta (Re:, AW:, SV:...). */
export function subjectLooksLikeReply(subject: string | null | undefined): boolean {
    return REPLY_HEAD_RE.test(trimWs(String(subject ?? '')));
}

/** Asunto util para agrupar: al menos 3 caracteres y no el marcador de "sin asunto". */
export function isGroupableSubject(normalized: string): boolean {
    return normalized.length >= 3 && normalized !== '(No Subject)';
}

// ---------------------------------------------------------------------------------------------------------------------
// Message-ID / In-Reply-To / References
// ---------------------------------------------------------------------------------------------------------------------

export const MAX_ID_LENGTH = 255;
/** Referencias que se guardan por mensaje: la raiz + las MAX_REFS mas recientes (el resto de la cadena se descarta). */
export const MAX_REFS = 50;
/** Mensajes maximos por hilo: una union que lo supere se ignora (listas/bucles de referencias envenenadas). */
export const MAX_THREAD_MESSAGES = 500;
/** Ventana del respaldo por asunto + participantes. */
export const FALLBACK_WINDOW_DAYS = 45;
export const FALLBACK_WINDOW_MS = FALLBACK_WINDOW_DAYS * 24 * 3600 * 1000;

const GARBAGE_IDS = new Set(['null', 'undefined', 'none', 'unknown', 'nil', 'localhost', 'nomessageid', 'no-message-id', 'n/a', 'na', 'invalid', 'id', 'mid', 'message-id']);

/**
 * Message-ID normalizado: sin <>, sin espacios, con el DOMINIO en minusculas (la parte local distingue mayusculas, RFC 5322 3.6.4).
 * null si es basura: vacio, > 255 caracteres, caracteres de control, valores vacios tipicos ("null", "<>"), un solo caracter repetido,
 * o sin "@" y demasiado corto para ser un identificador.
 */
export function normalizeMessageId(raw: unknown): string | null {
    if (raw === null || raw === undefined) return null;
    let s = String(raw);
    if (s.length > MAX_ID_LENGTH * 4) return null;
    const angle = s.match(/<([^<>]*)>/);
    if (angle) s = angle[1];
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(s.replace(/[\r\n\t]/g, ''))) return null;
    s = s.replace(/\s+/g, '');
    if (s.length < 3 || s.length > MAX_ID_LENGTH) return null;
    if (/[<>",;]/.test(s)) return null;
    const at = s.lastIndexOf('@');
    if (at === 0 || at === s.length - 1) return null;
    if (at > 0) s = `${s.slice(0, at)}@${s.slice(at + 1).toLowerCase()}`;
    else if (s.length < 8) return null; // sin dominio y corto: "1", "abc"...
    const local = at > 0 ? s.slice(0, at) : s;
    if (GARBAGE_IDS.has(local.toLowerCase()) && at < 0) return null;
    if (GARBAGE_IDS.has(s.toLowerCase())) return null;
    if (/^(.)\1{3,}$/.test(local)) return null; // "000000", "aaaa"
    return s;
}

/** Lista de Message-ID de una cabecera References/In-Reply-To (o array de valores): normalizados, sin repetir, en orden, con el tope. */
export function parseMessageIdList(value: string | string[] | null | undefined): string[] {
    const text = Array.isArray(value) ? value.join(' ') : String(value ?? '');
    if (!text.trim()) return [];
    const found: string[] = [];
    const angled = text.match(/<[^<>]*>/g);
    const tokens = angled && angled.length > 0 ? angled : text.split(/[\s,;]+/);
    const seen = new Set<string>();
    for (const t of tokens) {
        const id = normalizeMessageId(t);
        if (id && !seen.has(id)) { seen.add(id); found.push(id); }
    }
    return capRefs(found);
}

/** Tope de referencias: la raiz (primera) + las MAX_REFS mas recientes. */
export function capRefs(list: string[]): string[] {
    if (list.length <= MAX_REFS + 1) return list;
    return [list[0], ...list.slice(list.length - MAX_REFS)];
}

/** Forma almacenada de `Email.refs` (TEXT): ids separados por un espacio (un Message-ID normalizado nunca contiene espacios). */
export function serializeRefs(list: string[]): string | null {
    const capped = capRefs(list);
    return capped.length > 0 ? capped.join(' ') : null;
}

/** Prefijo de las pistas de conversacion dentro de `Email.refs` (p. ej. Thread-Index de Outlook): nunca es un Message-ID valido. */
export const HINT_PREFIX = '~';

export function parseStoredRefs(text: string | null | undefined): string[] {
    if (!text) return [];
    return capRefs(text.split(' ').filter((s) => s.length > 0 && !s.startsWith(HINT_PREFIX)));
}

export function parseStoredHints(text: string | null | undefined): string[] {
    if (!text) return [];
    return text.split(' ').filter((s) => s.startsWith(HINT_PREFIX));
}

export interface ThreadHeaders {
    /** Message-ID propio, normalizado. */
    messageId: string | null;
    /** Padre directo (el ultimo si In-Reply-To trae varios), normalizado. */
    inReplyTo: string | null;
    /** References normalizadas y con tope. Si faltan, se completa con In-Reply-To (RFC 5322: References puede omitirse). */
    refs: string[];
}

/** Cabeceras de hilo a partir de valores crudos (de un MIME, de las cabeceras del webhook o de un ParsedMail). */
export function threadHeadersFrom(input: { messageId?: unknown; inReplyTo?: unknown; references?: string | string[] | null }): ThreadHeaders {
    const messageId = normalizeMessageId(input.messageId);
    const replyList = parseMessageIdList(typeof input.inReplyTo === 'string' || Array.isArray(input.inReplyTo) ? (input.inReplyTo as string | string[]) : null);
    const inReplyTo = replyList.length > 0 ? replyList[replyList.length - 1] : null;
    let refs = parseMessageIdList(input.references ?? null);
    if (inReplyTo && !refs.includes(inReplyTo)) refs = capRefs([...refs, inReplyTo]);
    if (messageId) refs = refs.filter((r) => r !== messageId);
    return { messageId, inReplyTo: inReplyTo && inReplyTo !== messageId ? inReplyTo : null, refs };
}

/**
 * Cabeceras que debe llevar UNA RESPUESTA al mensaje `parent` (RFC 5322 3.6.4): In-Reply-To = Message-ID del padre; References = las del
 * padre + su Message-ID (con el tope). Sin Message-ID conocido del padre no se inventa nada.
 */
export function buildReplyHeaders(parent: { messageId?: string | null; refs?: string[] | string | null; inReplyTo?: string | null }): { inReplyTo: string; references: string } | null {
    const mid = normalizeMessageId(parent.messageId);
    if (!mid) return null;
    const parentRefs = Array.isArray(parent.refs) ? parent.refs : parseStoredRefs(parent.refs ?? null);
    const chain = parentRefs.length > 0 ? parentRefs : (normalizeMessageId(parent.inReplyTo) ? [normalizeMessageId(parent.inReplyTo)!] : []);
    const refs = capRefs([...chain.filter((r) => r !== mid), mid]);
    return { inReplyTo: mid, references: refs.map((r) => `<${r}>`).join(' ') };
}

/** `<id>` con angulos, listo para la cabecera. */
export function angle(id: string): string {
    return `<${id}>`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Direcciones y participantes
// ---------------------------------------------------------------------------------------------------------------------

/** Direcciones (minuscula) de una lista de destinatarios "Nombre <a@b>, c@d". */
export function addressesOf(value?: string | null): string[] {
    return String(value || '')
        .split(',')
        .map((entry) => String(entry || '').trim().toLowerCase())
        .map((entry) => (entry.match(/<([^>]+)>/)?.[1] || entry).trim().toLowerCase())
        .filter((entry) => entry.includes('@'));
}

/** Participantes de un mensaje (from + to + cc) sin las direcciones del propietario del buzon, en minuscula y sin repetir. */
export function participantsOf(fields: { from?: string | null; to?: string | null; cc?: string | null }, own: Iterable<string> = []): string[] {
    const ownSet = new Set(Array.from(own, (a) => String(a || '').trim().toLowerCase()));
    const all = [...addressesOf(fields.from), ...addressesOf(fields.to), ...addressesOf(fields.cc)];
    return Array.from(new Set(all.filter((a) => !ownSet.has(a))));
}

// ---------------------------------------------------------------------------------------------------------------------
// Clave heuristica heredada (correos sin cabeceras guardadas). Espejo SQL: mail-list-sql.ts (THREAD_KEY_SQL).
// ---------------------------------------------------------------------------------------------------------------------

export function recipientKeyOf(email: { to?: string | null; cleanTo?: string | null }): string {
    const normalized = addressesOf(email.cleanTo || email.to);
    if (normalized.length > 0) return normalized.join(', ');
    return String(email.cleanTo || email.to || '').trim().toLowerCase();
}

/** Clave heredada: 'h:<destinatarios>::<asunto normalizado>' o 'u:<id>' si el asunto no sirve para agrupar. */
export function legacyThreadKey(email: { id: string; subject?: string | null; to?: string | null; cleanTo?: string | null }): string {
    const normalized = normalizeSubject(email.subject || '');
    if (!isGroupableSubject(normalized)) return `u:${email.id}`;
    return `h:${recipientKeyOf(email)}::${normalized}`;
}

/** Clave de hilo efectiva de un correo: la guardada (threadKey) o, si es un correo antiguo sin ella, la heuristica heredada. */
export function effectiveThreadKey(email: { id: string; subject?: string | null; to?: string | null; cleanTo?: string | null; threadKey?: string | null }): string {
    return email.threadKey ? email.threadKey : legacyThreadKey(email);
}

// ---------------------------------------------------------------------------------------------------------------------
// Union-find de mensajes
// ---------------------------------------------------------------------------------------------------------------------

export interface ThreadMsg {
    /** Id interno (Email.id). */
    id: string;
    /** Message-ID propio normalizado. */
    mid?: string | null;
    inReplyTo?: string | null;
    refs?: string[];
    /** Fecha (ms). */
    date: number;
    subject?: string | null;
    /** Participantes sin el propietario del buzon (participantsOf). */
    participants?: string[];
    /** true = no aplicar el respaldo por asunto (listas, autorespuestas y notificaciones automaticas). */
    noFallback?: boolean;
    /** Pistas secundarias de conversacion (Thread-Index de Outlook): comparten hilo los mensajes con la misma pista. */
    hints?: string[];
    /** threadKey ya guardado: se respeta como vinculo entre mensajes que lo comparten (uniones previas por respaldo). */
    key?: string | null;
}

export type ThreadLink = 'headers' | 'fallback' | 'key' | 'none';

/** El respaldo solo aplica a mensajes sin Message-ID ni cabeceras de respuesta, o a respuestas cuyo padre no esta en el indice. */
export function messageNeedsFallback(msg: Pick<ThreadMsg, 'mid' | 'inReplyTo' | 'refs' | 'subject'>): boolean {
    if (msg.inReplyTo || (msg.refs?.length ?? 0) > 0) return true; // respuesta con padre desconocido (si se conociera, ya se habria unido por cabeceras)
    if (subjectLooksLikeReply(msg.subject)) return true;
    return !msg.mid; // sin Message-ID ni cabeceras: no sabemos nada mejor
}

/** Mensaje mas cercano en el tiempo con el mismo asunto normalizado y algun participante en comun (ventana de FALLBACK_WINDOW_DAYS). */
export function pickFallbackCandidate<T extends Pick<ThreadMsg, 'id' | 'date' | 'subject' | 'participants'>>(msg: Pick<ThreadMsg, 'id' | 'date' | 'subject' | 'participants'>, candidates: Iterable<T>): T | null {
    const norm = normalizeSubject(msg.subject).toLowerCase();
    if (!isGroupableSubject(norm)) return null;
    const mine = new Set(msg.participants ?? []);
    let best: T | null = null;
    let bestDelta = Infinity;
    for (const cand of candidates) {
        if (cand.id === msg.id) continue;
        if (normalizeSubject(cand.subject).toLowerCase() !== norm) continue;
        const delta = Math.abs(cand.date - msg.date);
        if (delta > FALLBACK_WINDOW_MS) continue;
        const theirs = cand.participants ?? [];
        const overlap = (mine.size === 0 && theirs.length === 0) || theirs.some((p) => mine.has(p));
        if (!overlap) continue;
        if (delta < bestDelta || (delta === bestDelta && best && cand.id < best.id)) { best = cand; bestDelta = delta; }
    }
    return best;
}

/** Indice incremental de hilos de UN buzon. `add` es idempotente por id. */
export class ThreadIndex {
    private parent = new Map<string, string>();
    private weight = new Map<string, number>();
    private members = new Map<string, string[]>();
    private msgs = new Map<string, ThreadMsg>();
    private nodeOf = new Map<string, string>();
    private keyAnchor = new Map<string, string>();
    private nodeDates = new Map<string, number>();
    /** Como se unio cada mensaje que se anadio (util para pruebas y diagnostico). */
    readonly links = new Map<string, ThreadLink>();

    private find(node: string): string {
        let root = node;
        for (let guard = 0; this.parent.get(root) !== root && guard < 100000; guard++) root = this.parent.get(root)!;
        let cur = node;
        while (cur !== root) { const next = this.parent.get(cur)!; this.parent.set(cur, root); cur = next; }
        return root;
    }

    private ensure(node: string): void {
        if (!this.parent.has(node)) { this.parent.set(node, node); this.weight.set(node, 0); this.members.set(node, []); }
    }

    private union(a: string, b: string): boolean {
        this.ensure(a); this.ensure(b);
        let ra = this.find(a); let rb = this.find(b);
        if (ra === rb) return true;
        if ((this.weight.get(ra) ?? 0) + (this.weight.get(rb) ?? 0) > MAX_THREAD_MESSAGES) return false; // hilo gigante: no se une
        if ((this.weight.get(ra) ?? 0) < (this.weight.get(rb) ?? 0)) { const t = ra; ra = rb; rb = t; }
        this.parent.set(rb, ra);
        this.weight.set(ra, (this.weight.get(ra) ?? 0) + (this.weight.get(rb) ?? 0));
        this.members.set(ra, this.members.get(ra)!.concat(this.members.get(rb)!));
        this.members.delete(rb); this.weight.delete(rb);
        return true;
    }

    private nodeFor(msg: ThreadMsg): string {
        return msg.mid ? `m:${msg.mid}` : `e:${msg.id}`;
    }

    has(id: string): boolean { return this.msgs.has(id); }
    get size(): number { return this.msgs.size; }
    get(id: string): ThreadMsg | undefined { return this.msgs.get(id); }

    /** Anade un mensaje (idempotente) y devuelve como quedo unido. */
    add(input: ThreadMsg): ThreadLink {
        if (this.msgs.has(input.id)) return this.links.get(input.id) ?? 'none';
        const msg: ThreadMsg = { ...input, mid: input.mid ?? null, refs: (input.refs ?? []).slice(0, MAX_REFS + 1) };
        this.msgs.set(msg.id, msg);
        const node = this.nodeFor(msg);
        this.nodeOf.set(msg.id, node);
        this.ensure(node);
        const root0 = this.find(node);
        this.weight.set(root0, (this.weight.get(root0) ?? 0) + 1);
        this.members.get(root0)!.push(msg.id);
        const prev = this.nodeDates.get(node);
        if (msg.mid && (prev === undefined || msg.date < prev)) this.nodeDates.set(node, msg.date);

        let link: ThreadLink = 'none';
        const joined = () => (this.weight.get(this.find(node)) ?? 0) > 1;

        // 1) cabeceras: padre directo primero y despues las referencias de la mas cercana a la raiz (asi un tope no rompe lo cercano)
        const ancestors: string[] = [];
        if (msg.inReplyTo && msg.inReplyTo !== msg.mid) ancestors.push(msg.inReplyTo);
        for (let i = (msg.refs?.length ?? 0) - 1; i >= 0; i--) {
            const r = msg.refs![i];
            if (r !== msg.mid && !ancestors.includes(r)) ancestors.push(r);
        }
        for (const a of ancestors) this.union(node, `m:${a}`);
        if (joined()) link = 'headers';

        for (const hint of msg.hints ?? []) this.union(node, `x:${hint}`);
        if (link === 'none' && joined()) link = 'headers';

        // 2) uniones previas guardadas (mensajes que comparten threadKey por un respaldo anterior)
        if (msg.key) {
            const anchor = this.keyAnchor.get(msg.key);
            if (anchor) { if (this.union(node, anchor) && link === 'none' && joined()) link = 'key'; }
            else this.keyAnchor.set(msg.key, node);
        }

        // 3) respaldo por asunto + participantes
        if (link === 'none' && !msg.noFallback && messageNeedsFallback(msg)) {
            const match = pickFallbackCandidate(msg, this.msgs.values());
            if (match && this.union(node, this.nodeOf.get(match.id)!)) link = 'fallback';
        }
        this.links.set(msg.id, link);
        return link;
    }

    /** Fecha estimada de un nodo: la del mensaje que lo es o, si es un ancestro no recibido, un instante antes del primer mensaje que lo cita. */
    private nodeDate(node: string, declarers: ThreadMsg[]): number {
        const known = this.nodeDates.get(node);
        if (known !== undefined) return known;
        let min = Infinity;
        for (const m of declarers) if (m.date < min) min = m.date;
        return min - 1;
    }

    /** Clave del hilo de un mensaje (funcion del conjunto de mensajes del hilo). */
    keyOf(id: string): string {
        const node = this.nodeOf.get(id);
        if (!node) throw new Error(`mensaje desconocido: ${id}`);
        return this.keyOfComponent(this.find(node));
    }

    private keyOfComponent(root: string): string {
        const ids = this.members.get(root) ?? [];
        const ms = ids.map((i) => this.msgs.get(i)!).filter(Boolean);
        // Clave heuristica heredada dentro del hilo: se conserva (los correos antiguos sin threadKey siguen ahi con la misma clave).
        const legacy = ms.map((m) => m.key).filter((k): k is string => Boolean(k) && k!.startsWith('h:')).sort();
        if (legacy.length > 0) return legacy[0];
        // Raiz declarada de cada mensaje: primera referencia > In-Reply-To > el propio mensaje.
        const declared = new Map<string, ThreadMsg[]>();
        for (const m of ms) {
            const d = m.refs && m.refs.length > 0 ? `m:${m.refs[0]}` : m.inReplyTo ? `m:${m.inReplyTo}` : this.nodeOf.get(m.id)!;
            (declared.get(d) ?? declared.set(d, []).get(d)!).push(m);
        }
        let bestNode = '';
        let bestDate = Infinity;
        for (const [node, decl] of declared) {
            // Una raiz declarada cuya union se rechazo (tope) o que es de otro hilo no puede dar nombre a este: colisionaria con el otro hilo
            if (!this.parent.has(node) || this.find(node) !== root) continue;
            const d = this.nodeDate(node, decl);
            if (d < bestDate || (d === bestDate && node < bestNode)) { bestDate = d; bestNode = node; }
        }
        return bestNode;
    }

    /** Hilos: clave -> ids de mensaje (ordenados por fecha y luego por id). */
    groups(): Map<string, string[]> {
        const out = new Map<string, string[]>();
        for (const [root, ids] of this.members) {
            if (ids.length === 0) continue;
            const key = this.keyOfComponent(root);
            const list = (out.get(key) ?? out.set(key, []).get(key)!);
            list.push(...ids);
        }
        for (const list of out.values()) list.sort((a, b) => (this.msgs.get(a)!.date - this.msgs.get(b)!.date) || (a < b ? -1 : a > b ? 1 : 0));
        return out;
    }
}

/** Agrupa una lista de mensajes (cualquier orden de llegada) y devuelve id -> threadKey. Equivale a anadirlos por fecha a un ThreadIndex. */
export function assignThreadKeys(msgs: ThreadMsg[]): { keys: Map<string, string>; groups: Map<string, string[]>; index: ThreadIndex } {
    const index = new ThreadIndex();
    // El orden cronologico hace estable el respaldo por asunto (un mensaje se compara con los anteriores).
    // Los que traen clave previa van primero: su vinculo anterior manda.
    const ordered = [...msgs].sort((a, b) => (a.date - b.date) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const m of ordered) index.add(m);
    const keys = new Map<string, string>();
    for (const m of msgs) keys.set(m.id, index.keyOf(m.id));
    return { keys, groups: index.groups(), index };
}

// ---------------------------------------------------------------------------------------------------------------------
// Asuntos salientes: un solo prefijo, en el idioma del original
// ---------------------------------------------------------------------------------------------------------------------

const REPLY_KEEP: Record<string, string> = { re: 'Re:', res: 'Res:', aw: 'AW:', sv: 'SV:', vs: 'VS:', antw: 'Antw:', odp: 'Odp:', ynt: 'YNT:' };
const FORWARD_KEEP: Record<string, string> = { fwd: 'Fwd:', fw: 'FW:', wg: 'WG:', tr: 'TR:', rv: 'RV:', enc: 'ENC:', vb: 'VB:', pd: 'PD:', vl: 'VL:', fs: 'FS:', i: 'I:' };
const CAL_WORDS = new Set(['invitaci[oó]n actualizada', 'invitaci[oó]n', 'invitation updated', 'invitation canceled', 'invitation cancelled', 'invitation', 'accepted', 'declined', 'tentative', 'cancelado', 'canceled', 'cancelled', 'updated']);
const RF_WORDS = SUBJECT_PREFIX_WORDS.filter((w) => !CAL_WORDS.has(w));
const RF_TAIL = '(?:[ \\t]*[\\[(][0-9]{1,3}[\\])])?[ \\t\\r\\n]*[:：]';
const RF_PREFIX_RE = new RegExp(`^(?:(?:${RF_WORDS.join('|')})${RF_TAIL}[ \\t\\r\\n]*)+`, 'i');
const LEAD_WORD_RE = new RegExp(`^[ \\t\\r\\n]*(${RF_WORDS.join('|')})${RF_TAIL}`, 'i');

/** Asunto sin la tira de prefijos de respuesta/reenvio (Re:, AW:, Fwd:...), pero conservando marcas de calendario ("Invitacion: ..."). */
export function stripReplyForwardPrefixes(subject: string | null | undefined): string {
    return trimWs(String(subject ?? '').replace(RF_PREFIX_RE, ''));
}

/** Primera palabra de prefijo del asunto (minuscula, sin "[2]"), o null. */
export function leadingPrefixWord(subject: string | null | undefined): string | null {
    const m = LEAD_WORD_RE.exec(String(subject ?? ''));
    return m ? m[1].toLowerCase() : null;
}

export type OutgoingMode = 'reply' | 'replyAll' | 'forward';

/** Prefijo canonico para una respuesta/reenvio a `originalSubject`: el del idioma del original si es uno conocido; si no, "Re:" / "Fwd:". */
export function outgoingPrefix(mode: OutgoingMode, originalSubject: string | null | undefined): string {
    const word = leadingPrefixWord(originalSubject);
    if (mode === 'forward') return (word && FORWARD_KEEP[word]) || 'Fwd:';
    return (word && REPLY_KEEP[word]) || 'Re:';
}

/** Asunto de la respuesta al mensaje `originalSubject`: un solo prefijo, sin acumular ("Re: Re:") ni mezclar idiomas. */
export function buildReplySubject(originalSubject: string | null | undefined): string {
    const base = stripReplyForwardPrefixes(originalSubject);
    const prefix = outgoingPrefix('reply', originalSubject);
    return base ? `${prefix} ${base}` : prefix;
}

export function buildForwardSubject(originalSubject: string | null | undefined): string {
    const base = stripReplyForwardPrefixes(originalSubject);
    const prefix = outgoingPrefix('forward', originalSubject);
    return base ? `${prefix} ${base}` : prefix;
}

/**
 * Asunto que realmente sale: si el redactor dejo una tira de prefijos (Re: Re: AW: ...) se colapsa a UN prefijo del idioma del original
 * (o el estandar). Si el usuario quito el prefijo a proposito, se respeta tal cual.
 */
export function normalizeOutgoingSubject(subject: string, mode: OutgoingMode, originalSubject: string | null | undefined): string {
    const s = trimWs(String(subject ?? ''));
    if (!RF_PREFIX_RE.test(s)) return s;
    const base = stripReplyForwardPrefixes(s);
    const prefix = outgoingPrefix(mode, originalSubject);
    return base ? `${prefix} ${base}` : prefix;
}
