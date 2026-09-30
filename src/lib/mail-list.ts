// Logica pura de la lista de correo (sin React ni DOM) para poder probarla con vitest.

export interface LabelRef {
    id: string;
    name: string;
    color?: string | null;
    count?: number;
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

export function normalizeSubject(subject: string): string {
    if (!subject) return '';
    return subject
        .replace(/^((re|fwd|rv|enc|invitaci[oó]n|invitaci[oó]n actualizada|accepted|declined|tentative|cancelado|canceled|updated): ?)+/gi, '')
        .trim();
}

export function extractRecipientEmails(value?: string | null): string[] {
    return String(value || '')
        .split(',')
        .map((entry) => String(entry || '').trim().toLowerCase())
        .map((entry) => {
            const bracketMatch = entry.match(/<([^>]+)>/);
            return (bracketMatch?.[1] || entry).trim().toLowerCase();
        })
        .filter((entry) => entry.includes('@'));
}

export function getRecipientThreadKey(email: Pick<ListEmail, 'to' | 'cleanTo'>): string {
    const normalized = extractRecipientEmails(email.cleanTo || email.to);
    if (normalized.length > 0) return normalized.join(', ');
    return String(email.cleanTo || email.to || '').trim().toLowerCase();
}

export interface EmailGroup<T extends ListEmail = ListEmail> {
    id: string;
    latestEmail: T;
    allEmails: T[];
    count: number;
}

const time = (e: { createdAt: string }) => new Date(e.createdAt).getTime() || 0;

export function groupEmailsByThread<T extends ListEmail>(emails: T[]): EmailGroup<T>[] {
    const groups: Record<string, T[]> = {};
    for (const email of emails) {
        const normalized = normalizeSubject(email.subject || '');
        if (!normalized || normalized.length < 3 || normalized === '(No Subject)') {
            groups[`__unique_${email.id}`] = [email];
            continue;
        }
        const key = `${getRecipientThreadKey(email)}::${normalized}`;
        (groups[key] ||= []).push(email);
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

export function buildQuickReply(
    email: { from: string; replyTo?: string | null; subject?: string | null; createdAt: string },
    contentHtml: string,
    formattedDate: string
) {
    const subject = email.subject || '';
    const header = `<div dir="ltr" class="gmail_attr">On ${formattedDate}, ${email.from} wrote:<br></div>`;
    const quote = `<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px #999 solid;padding-left:1ex">${contentHtml || ''}</blockquote>`;
    return {
        to: email.replyTo || email.from,
        subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
        body: `<p></p><br><div class="gmail_quote">${header}${quote}</div>`,
    };
}

/** Siguiente indice enfocado para j/k, acotado. */
export function nextFocusIndex(current: number, length: number, delta: 1 | -1): number {
    if (length <= 0) return -1;
    if (current < 0) return 0;
    return Math.min(Math.max(current + delta, 0), length - 1);
}
