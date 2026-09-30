// Logica pura de la lista de correo (sin React ni DOM) para poder probarla con vitest.
import { ACCENT_FROM, ACCENT_TO } from '@/lib/db/mail-sql';
import { buildReplyQuote, buildReplySubject, type ReplyDeps } from '@/lib/reply-builder';
import { addressesOf, effectiveThreadKey, normalizeSubject as normalizeSubjectShared, recipientKeyOf } from '@/lib/threading';

export interface LabelRef {
    id: string;
    name: string;
    color?: string | null;
    /** No leidos (sin contar papelera ni spam). */
    count?: number;
    /** Total de correos con la etiqueta (sin contar papelera ni spam). */
    total?: number;
    /** Jerarquia y comportamiento (etiquetas anidadas: ver lib/labels/model.ts). Ausentes en etiquetas planas antiguas. */
    parentId?: string | null;
    behavior?: 'tag' | 'folder';
    /** Ruta completa ("Trabajo/Proyecto A"); `name` es solo el segmento. */
    fullPath?: string;
    icon?: string | null;
    sortOrder?: number;
    showInSidebar?: boolean;
    showUnread?: boolean;
}

export interface ListEmail {
    id: string;
    from: string;
    subject: string;
    createdAt: string;
    to?: string;
    cleanTo?: string | null;
    read?: boolean;
    starred?: boolean;
    snippet?: string;
    labels?: LabelRef[];
    [key: string]: any;
}

// ---------------------------------------------------------------------------
// Claves de cache
// ---------------------------------------------------------------------------

export const LABELS_CACHE_KEY = 'labels-all';
export const COUNTS_CACHE_KEY = 'stats-counts';
export const SETTINGS_CACHE_KEY = 'system:expansion-settings-full';

/** Clave unica de la lista: la usa EmailList y cualquier invalidacion. */
export function emailsCacheKey(mailboxSignature: string, contextKey: string): string {
    return `emails:${mailboxSignature || 'cookie'}:${contextKey}`;
}

/** Regex para invalidar todas las listas (y solo ellas). */
export const EMAIL_LISTS_PATTERN = /^emails:/;
/** Regex para invalidar listas + contadores en un solo aviso (evita doble refresco). */
export const EMAIL_LISTS_AND_COUNTS_PATTERN = /^(emails:|stats-counts$)/;

export function isEmailListKey(key?: string): boolean {
    return typeof key === 'string' && key.startsWith('emails:');
}

/**
 * La lista solo debe recargar cuando el aviso es global (sin clave, p.ej. invalidate con regex)
 * o cuando cambia una clave de lista. Abrir un correo (`email-<id>-...`) no la recarga.
 */
export function shouldListRefresh(key?: string): boolean {
    return key === undefined || isEmailListKey(key);
}

export function shouldListReloadSettings(key?: string): boolean {
    return key === undefined || key === SETTINGS_CACHE_KEY;
}

export function shouldSidebarRefresh(key?: string): boolean {
    return (
        key === undefined ||
        key === COUNTS_CACHE_KEY ||
        key === LABELS_CACHE_KEY ||
        key === SETTINGS_CACHE_KEY
    );
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** Deja solo labels validos (con id y nombre). Forma unica del cache 'labels-all'. */
export function normalizeLabelList(raw: unknown): LabelRef[] {
    const list = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object' && Array.isArray((raw as any).labels)
            ? (raw as any).labels
            : [];
    const seen = new Set<string>();
    const out: LabelRef[] = [];
    for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const id = typeof item.id === 'string' ? item.id : '';
        const name = typeof item.name === 'string' ? item.name : '';
        if (!id || !name || seen.has(id)) continue;
        seen.add(id);
        out.push({
            id,
            name,
            color: item.color ?? null,
            count: typeof item.count === 'number' ? item.count : 0,
            ...(typeof item.total === 'number' ? { total: item.total } : {}),
            ...(typeof item.parentId === 'string' ? { parentId: item.parentId } : {}),
            ...(item.behavior === 'folder' || item.behavior === 'tag' ? { behavior: item.behavior } : {}),
            ...(typeof item.fullPath === 'string' && item.fullPath ? { fullPath: item.fullPath } : {}),
            ...(typeof item.icon === 'string' ? { icon: item.icon } : {}),
            ...(typeof item.sortOrder === 'number' ? { sortOrder: item.sortOrder } : {}),
            ...(typeof item.showInSidebar === 'boolean' ? { showInSidebar: item.showInSidebar } : {}),
            ...(typeof item.showUnread === 'boolean' ? { showUnread: item.showUnread } : {}),
        });
    }
    return out;
}

/** Une la lista de labels (con id) con los conteos de /api/counts (por id, o por nombre en minuscula). */
export function mergeLabelCounts(labels: LabelRef[], countLabels: unknown): LabelRef[] {
    const counts = Array.isArray(countLabels) ? countLabels : [];
    const byId = new Map<string, number>();
    const byName = new Map<string, number>();
    for (const c of counts) {
        if (!c || typeof c !== 'object') continue;
        const n = typeof c.count === 'number' ? c.count : 0;
        if (typeof c.id === 'string') byId.set(c.id, n);
        if (typeof c.name === 'string') byName.set(c.name.toLowerCase(), n);
    }
    return labels.map((l) => ({
        ...l,
        count: byId.get(l.id) ?? byName.get(l.name.toLowerCase()) ?? l.count ?? 0,
    }));
}

export function unionLabels(emails: Array<Pick<ListEmail, 'labels'>>): LabelRef[] {
    const map = new Map<string, LabelRef>();
    for (const e of emails) {
        for (const l of e.labels || []) {
            if (l && typeof l === 'object' && l.id && !map.has(l.id)) map.set(l.id, l);
        }
    }
    return Array.from(map.values());
}

export type LabelToggleMode = 'add' | 'remove';

/**
 * PATCH /api/emails/[id] con toggleLabelId ALTERNA, asi que hay que decidir por correo:
 * - si algun correo seleccionado no tiene el label -> modo 'add' y solo se alterna en los que no lo tienen;
 * - si todos lo tienen -> modo 'remove' y se alterna en todos.
 */
export function planLabelToggles(
    emails: Array<Pick<ListEmail, 'id' | 'labels'>>,
    ids: string[],
    labelId: string
): { mode: LabelToggleMode; toggleIds: string[] } {
    const wanted = new Set(ids);
    const targets = emails.filter((e) => wanted.has(e.id));
    const has = (e: Pick<ListEmail, 'labels'>) => (e.labels || []).some((l) => l.id === labelId);
    const missing = targets.filter((e) => !has(e));
    if (missing.length > 0) return { mode: 'add', toggleIds: missing.map((e) => e.id) };
    return { mode: 'remove', toggleIds: targets.map((e) => e.id) };
}

export function applyLabelChange<T extends Pick<ListEmail, 'id' | 'labels'>>(
    emails: T[],
    ids: string[],
    label: LabelRef,
    mode: LabelToggleMode
): T[] {
    const wanted = new Set(ids);
    return emails.map((e) => {
        if (!wanted.has(e.id)) return e;
        const current = e.labels || [];
        const without = current.filter((l) => l.id !== label.id);
        return { ...e, labels: mode === 'add' ? [...without, { id: label.id, name: label.name, color: label.color ?? null }] : without };
    });
}

/** Estado de un label sobre la seleccion: 'all' | 'some' | 'none'. */
export function labelSelectionState(
    emails: Array<Pick<ListEmail, 'id' | 'labels'>>,
    ids: string[],
    labelId: string
): 'all' | 'some' | 'none' {
    const wanted = new Set(ids);
    const targets = emails.filter((e) => wanted.has(e.id));
    if (targets.length === 0) return 'none';
    const n = targets.filter((e) => (e.labels || []).some((l) => l.id === labelId)).length;
    return n === 0 ? 'none' : n === targets.length ? 'all' : 'some';
}

// ---------------------------------------------------------------------------
// Hilos / agrupacion
// ---------------------------------------------------------------------------

/** Asunto sin prefijos Re:/Fwd:/... en cualquier idioma. UNA sola definicion (lib/threading.ts), la misma que usa el SQL. */
export const normalizeSubject = (subject: string): string => normalizeSubjectShared(subject);

export function extractRecipientEmails(value?: string | null): string[] {
    return addressesOf(value);
}

export function getRecipientThreadKey(email: Pick<ListEmail, 'to' | 'cleanTo'>): string {
    return recipientKeyOf(email);
}

export interface EmailGroup<T extends ListEmail = ListEmail> {
    id: string;
    latestEmail: T;
    allEmails: T[];
    count: number;
}

const time = (e: { createdAt: string }) => new Date(e.createdAt).getTime() || 0;

/**
 * Agrupa en hilos. Clave = `threadKey` guardada (cabeceras Message-ID/In-Reply-To/References, lib/threading.ts) o, en correos antiguos
 * sin ella, la clave heuristica heredada (destinatarios + asunto normalizado). Espejo exacto en SQL: mail-list-sql.ts (THREAD_KEY_SQL).
 */
export function groupEmailsByThread<T extends ListEmail>(emails: T[]): EmailGroup<T>[] {
    const groups: Record<string, T[]> = {};
    for (const email of emails) {
        (groups[effectiveThreadKey(email)] ||= []).push(email);
    }
    const list = Object.values(groups).map((g) => {
        const sorted = [...g].sort((a, b) => time(b) - time(a));
        return { id: sorted[0].id, latestEmail: sorted[0], allEmails: sorted, count: sorted.length };
    });
    list.sort((a, b) => time(b.latestEmail) - time(a.latestEmail));
    return list;
}

// ---------------------------------------------------------------------------
// Fusion de listas / paginacion
// ---------------------------------------------------------------------------

export function getEmailMergeKey(email: ListEmail): string {
    const from = String(email.from || '').trim().toLowerCase();
    const recipients = extractRecipientEmails(email.cleanTo || email.to).join(',');
    const subject = String(email.subject || '').trim().toLowerCase();
    const snippet = String(email.snippet || '').trim().toLowerCase().slice(0, 160);
    const createdAt = String(email.createdAt || '').trim();
    return [from, recipients, subject, snippet, createdAt].join('|');
}

export function mergeEmailLists<T extends ListEmail>(...lists: T[][]): T[] {
    const byKey = new Map<string, T>();
    lists.flat().forEach((email) => byKey.set(getEmailMergeKey(email), email));
    return Array.from(byKey.values()).sort((a, b) => time(b) - time(a));
}

/** Orden de la lista que se pide al servidor (espejo de MailSortKey en mail-query). */
export type ListSort = 'newest' | 'oldest' | 'sender';

const FOLD = (() => {
    const map = new Map<string, string>();
    const from = Array.from(ACCENT_FROM);
    Array.from(ACCENT_TO).forEach((to, i) => map.set(from[i], to));
    return map;
})();

/**
 * Clave de orden por remitente: espejo en JS de `bloomx_sender_key` (SQL, db/mail-sql.ts): nombre visible (sin comillas ni <direccion>) o,
 * si no hay, la direccion; en minusculas y sin acentos. El servidor ordena por esta clave con colacion "C" (bytes).
 */
export function senderSortKey(from: string | null | undefined): string {
    const raw = String(from || '');
    const display = raw.replace(/<[^>]*>/g, '').replace(/^[\s"'<>]+|[\s"'<>]+$/g, '');
    const address = (raw.match(/<([^>]*)>/)?.[1] ?? '').trim();
    const base = display || address || raw.trim();
    return Array.from(base.toLowerCase()).map((ch) => FOLD.get(ch) ?? ch).join('');
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Comparador de correos equivalente al orden del servidor (solo para mezclar peticiones de sesiones distintas). */
export function compareEmailsBy(sort: ListSort): (a: ListEmail, b: ListEmail) => number {
    if (sort === 'oldest') return (a, b) => time(a) - time(b) || cmp(a.id, b.id);
    if (sort === 'sender') return (a, b) => cmp(senderSortKey(a.from), senderSortKey(b.from)) || time(b) - time(a) || cmp(b.id, a.id);
    return (a, b) => time(b) - time(a) || cmp(b.id, a.id);
}

// ---------------------------------------------------------------------------
// Varias cuentas: peticiones agrupadas
// ---------------------------------------------------------------------------

/** Una peticion al servidor: sesion por cookie (token null) o Bearer, y opcionalmente la UNION de buzones accesibles por esa sesion. */
export interface RequestGroup {
    key: string;
    token: string | null;
    mailboxes: string[] | null;
}

/**
 * Agrupa las cuentas a consultar. Las cuentas que la sesion actual puede leer (getAccessibleMailboxUserIds -> /api/mailboxes) van
 * en UNA peticion con `mailboxes=<ids>`: el servidor ordena, pagina y cuenta sobre la union. Las cuentas con sesion propia
 * (otro login) mantienen su peticion con su token. Sin cuentas: la sesion por cookie.
 */
export function planRequestGroups(
    targets: Array<{ id: string; email: string; token?: string | null }>,
    accessible: ReadonlySet<string> | null,
): RequestGroup[] {
    if (targets.length === 0) return [{ key: '__session', token: null, mailboxes: null }];
    const covered = accessible ? targets.filter((t) => accessible.has(t.id)) : [];
    const rest = accessible ? targets.filter((t) => !accessible.has(t.id)) : targets;
    const groups: RequestGroup[] = [];
    const single = (t: { id: string; email: string; token?: string | null }): RequestGroup => ({ key: String(t.email || t.id).trim().toLowerCase(), token: t.token ?? null, mailboxes: null });
    if (covered.length >= 2) {
        const ids = covered.map((t) => t.id).sort();
        groups.push({ key: `mb:${ids.join(',')}`, token: null, mailboxes: ids });
    } else {
        covered.forEach((t) => groups.push(single(t)));
    }
    rest.forEach((t) => groups.push(single(t)));
    return groups;
}

/** Anade una pagina del servidor a la lista conservando el orden recibido; descarta ids ya presentes (sin reordenar). */
export function appendServerPage<T extends ListEmail>(existing: T[], incoming: T[]): T[] {
    const seen = new Set(existing.map((e) => e.id));
    const fresh = incoming.filter((e) => { if (seen.has(e.id)) return false; seen.add(e.id); return true; });
    return fresh.length === 0 ? existing : [...existing, ...fresh];
}

/** Une paginas de VARIAS cuentas (cada una ya ordenada por el servidor) en un unico orden con el mismo criterio. */
export function mergeMailboxPages<T extends ListEmail>(sort: ListSort, ...lists: T[][]): T[] {
    const byId = new Map<string, T>();
    for (const e of lists.flat()) byId.set(e.id, e);
    return Array.from(byId.values()).sort(compareEmailsBy(sort));
}

/**
 * Refresco de la primera pagina sin perder las paginas ya cargadas por scroll.
 * - Si el servidor no tiene mas paginas que la recibida, la lista fresca reemplaza todo.
 * - Si hay mas, se conserva lo existente que sea mas antiguo que el ultimo correo fresco
 *   (y que no aparezca ya en la lista fresca).
 * Devuelve tambien si se conservo cola (para no reiniciar el estado de paginacion).
 */
export function mergeFirstPage<T extends ListEmail>(
    existing: T[],
    fresh: T[],
    serverHasMoreAfterFresh: boolean
): { emails: T[]; preservedTail: boolean } {
    if (!serverHasMoreAfterFresh || fresh.length === 0) {
        return { emails: fresh, preservedTail: false };
    }
    const freshIds = new Set(fresh.map((e) => e.id));
    const oldest = Math.min(...fresh.map(time));
    const tail = existing.filter((e) => !freshIds.has(e.id) && time(e) < oldest);
    if (tail.length === 0) return { emails: fresh, preservedTail: false };
    const merged = [...fresh, ...tail].sort((a, b) => time(b) - time(a));
    return { emails: merged, preservedTail: true };
}

// ---------------------------------------------------------------------------
// Acciones masivas (optimista + reversion)
// ---------------------------------------------------------------------------

export function applyOptimisticUpdate<T extends ListEmail>(emails: T[], ids: string[], updates: Record<string, any>): T[] {
    const wanted = new Set(ids);
    if (updates.folder) return emails.filter((e) => !wanted.has(e.id));
    return emails.map((e) => (wanted.has(e.id) ? { ...e, ...updates } : e));
}

/** Restaura los correos guardados (por id) sobre la lista actual, reponiendo los que se quitaron. */
export function restoreEmails<T extends ListEmail>(current: T[], snapshot: T[]): T[] {
    const snap = new Map(snapshot.map((e) => [e.id, e]));
    const out = current.map((e) => snap.get(e.id) ?? e);
    const present = new Set(current.map((e) => e.id));
    for (const e of snapshot) if (!present.has(e.id)) out.push(e);
    return out.sort((a, b) => time(b) - time(a));
}

/** En trash, "mover a trash" equivale a borrado permanente. En borradores, borrar tambien lo es. */
export function isPermanentDelete(folder: string, updates: Record<string, any>): boolean {
    return (folder === 'trash' || folder === 'drafts') && updates.folder === 'trash';
}

/** Decide que hacer con una respuesta HTTP de una accion masiva. */
export function classifyBulkResponse(status: number): 'ok' | 'revert' {
    return status >= 200 && status < 300 ? 'ok' : 'revert';
}

// ---------------------------------------------------------------------------
// Respuesta rapida desde la lista
// ---------------------------------------------------------------------------

/**
 * Respuesta rapida desde la lista. La cita (estructura Gmail/Outlook, saneada, con tope de tamano) la construye
 * lib/reply-builder.ts; aqui solo se adapta la firma historica.
 */
export function buildQuickReply(
    email: { from: string; replyTo?: string | null; subject?: string | null; createdAt: string },
    contentHtml: string,
    /** Fecha ya formateada; si va vacia se usa la fecha larga con zona segun `deps.locale`. */
    formattedDate: string,
    /** Texto de la cabecera de la cita en el idioma activo (recibe fecha y remitente ya formateados). */
    quoteHeader?: (date: string, from: string) => string,
    /** Sanitizador (DOMPurify en el cliente), locale, zona... ver ReplyDeps. */
    deps: Partial<ReplyDeps> = {},
) {
    const quote = buildReplyQuote(email, contentHtml || '', {
        ...deps,
        t: quoteHeader
            ? (key, params) => (key === 'emailList.quoteHeader' && params ? quoteHeader(String(params.date), String(params.from)) : (deps.t ? deps.t(key, params) : key))
            : deps.t,
        formatDate: formattedDate ? () => formattedDate : deps.formatDate,
    });
    return {
        to: email.replyTo || email.from,
        subject: buildReplySubject(email.subject),
        body: quote.body,
    };
}

/** Siguiente indice enfocado para j/k, acotado. */
export function nextFocusIndex(current: number, length: number, delta: 1 | -1): number {
    if (length <= 0) return -1;
    if (current < 0) return 0;
    return Math.min(Math.max(current + delta, 0), length - 1);
}
