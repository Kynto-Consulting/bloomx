// Logica pura de la VISTA de la bandeja: remitente/avatar, adjuntos, filtros rapidos, orden, encabezados por fecha
// y seleccion masiva. Complementa a mail-list.ts (datos/hilos). Sin React ni DOM.
import type { EmailGroup, ListEmail } from '@/lib/mail-list';

const time = (e: { createdAt: string }) => new Date(e.createdAt).getTime() || 0;

// ---------------------------------------------------------------------------
// Remitente: nombre, iniciales y color de avatar
// ---------------------------------------------------------------------------

/** Direccion de un campo From ("Ana <ana@x.com>" -> "ana@x.com"). */
export function senderAddress(from: string | null | undefined): string {
    const raw = String(from || '').trim();
    const m = raw.match(/<([^>]+)>/);
    return (m?.[1] || raw).trim().toLowerCase();
}

/** Nombre visible de un From: el nombre si existe; si no, la parte local de la direccion. */
export function senderName(from: string | null | undefined): string {
    const raw = String(from || '').trim();
    if (!raw) return '';
    const m = raw.match(/^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/);
    const name = (m?.[1] || '').trim();
    if (name) return name;
    const addr = senderAddress(raw);
    return addr.includes('@') ? addr.split('@')[0] : addr || raw;
}

/** Hasta dos iniciales en mayuscula; "?" si no hay nada utilizable. */
export function senderInitials(from: string | null | undefined): string {
    const name = senderName(from).replace(/[^\p{L}\p{N}\s._-]/gu, ' ').trim();
    if (!name) return '?';
    const words = name.split(/[\s._-]+/).filter(Boolean);
    if (words.length === 0) return '?';
    const first = Array.from(words[0])[0] || '';
    const second = words.length > 1 ? Array.from(words[words.length - 1])[0] || '' : '';
    return (first + second).toUpperCase() || '?';
}

/** Numero de colores (pares fondo/texto de los tokens de tema) disponibles para los avatares. */
export const AVATAR_TONES = 6;

/** Indice estable 0..AVATAR_TONES-1 derivado de la direccion (mismo remitente = mismo color). */
export function avatarTone(from: string | null | undefined): number {
    const key = senderAddress(from) || String(from || '');
    let hash = 5381;
    for (let i = 0; i < key.length; i++) hash = ((hash << 5) + hash + key.charCodeAt(i)) >>> 0;
    return hash % AVATAR_TONES;
}

// ---------------------------------------------------------------------------
// Adjuntos y participantes de un hilo
// ---------------------------------------------------------------------------

export interface AttachmentSummary { count: number; names: string[] }

/** Adjuntos unicos (por nombre de archivo) de un hilo: cantidad y nombres. */
export function attachmentSummary(emails: Array<{ [key: string]: any }>): AttachmentSummary {
    const names: string[] = [];
    const seen = new Set<string>();
    for (const e of emails) {
        const list = Array.isArray(e.attachments) ? (e.attachments as any[]) : [];
        for (const a of list) {
            const name = String(a?.filename || '').trim();
            const key = name.toLowerCase() || `#${names.length}`;
            if (seen.has(key)) continue;
            seen.add(key);
            names.push(name);
        }
    }
    return { count: names.length, names };
}

/** Participantes del hilo (nombres distintos de los remitentes, mas recientes primero). */
export function threadParticipants(emails: ListEmail[], max = 3): { names: string[]; extra: number } {
    const sorted = [...emails].sort((a, b) => time(b) - time(a));
    const seen = new Set<string>();
    const names: string[] = [];
    for (const e of sorted) {
        const key = senderAddress(e.from) || String(e.from || '');
        if (!key || seen.has(key)) continue;
        seen.add(key);
        names.push(senderName(e.from) || key);
    }
    return { names: names.slice(0, max), extra: Math.max(0, names.length - max) };
}

// ---------------------------------------------------------------------------
// Filtros rapidos y orden
// ---------------------------------------------------------------------------

export type QuickFilter = 'all' | 'unread' | 'starred' | 'attachments' | 'fromMe';
export const QUICK_FILTERS: readonly QuickFilter[] = ['all', 'unread', 'starred', 'attachments', 'fromMe'];

/** Conjunto en minusculas de las direcciones propias (cuenta activa + cuentas conectadas). */
export function ownAddressSet(addresses: Array<string | null | undefined>): Set<string> {
    const set = new Set<string>();
    for (const a of addresses) {
        const v = senderAddress(a);
        if (v.includes('@')) set.add(v);
    }
    return set;
}

export function isFromMe(email: Pick<ListEmail, 'from'>, own: Set<string>): boolean {
    return own.has(senderAddress(email.from));
}

/** Un hilo cumple el filtro si ALGUN mensaje lo cumple. */
export function groupMatchesFilter<T extends ListEmail>(group: EmailGroup<T>, filter: QuickFilter, own: Set<string>): boolean {
    switch (filter) {
        case 'unread': return group.allEmails.some((e) => !e.read);
        case 'starred': return group.allEmails.some((e) => Boolean(e.starred));
        case 'attachments': return attachmentSummary(group.allEmails).count > 0;
        case 'fromMe': return group.allEmails.some((e) => isFromMe(e, own));
        default: return true;
    }
}

export function filterGroups<T extends ListEmail>(groups: EmailGroup<T>[], filter: QuickFilter, own: Set<string>): EmailGroup<T>[] {
    return filter === 'all' ? groups : groups.filter((g) => groupMatchesFilter(g, filter, own));
}

export function quickFilterCounts<T extends ListEmail>(groups: EmailGroup<T>[], own: Set<string>): Record<QuickFilter, number> {
    const counts: Record<QuickFilter, number> = { all: groups.length, unread: 0, starred: 0, attachments: 0, fromMe: 0 };
    for (const g of groups) {
        if (groupMatchesFilter(g, 'unread', own)) counts.unread++;
        if (groupMatchesFilter(g, 'starred', own)) counts.starred++;
        if (groupMatchesFilter(g, 'attachments', own)) counts.attachments++;
        if (groupMatchesFilter(g, 'fromMe', own)) counts.fromMe++;
    }
    return counts;
}

export type MailSortKey = 'newest' | 'oldest' | 'sender';

/**
 * Hilos en el orden en que el SERVIDOR entrego sus mensajes (orden y filtros ya aplicados en la consulta): cada hilo ocupa la
 * posicion de su primer mensaje. Es lo que usa la lista de una carpeta paginada; `sortGroups` queda para listas completas
 * en memoria (borradores) y para mezclar varias cuentas.
 */
export function orderGroupsLike<T extends ListEmail>(groups: EmailGroup<T>[], emails: Array<{ id: string }>): EmailGroup<T>[] {
    const position = new Map<string, number>();
    emails.forEach((e, i) => { if (!position.has(e.id)) position.set(e.id, i); });
    const rank = (g: EmailGroup<T>) => Math.min(...g.allEmails.map((e) => position.get(e.id) ?? Number.MAX_SAFE_INTEGER));
    return [...groups].sort((a, b) => rank(a) - rank(b));
}

/** Ordena los hilos ya agrupados (sin mutar). Empates: el mas reciente primero. */
export function sortGroups<T extends ListEmail>(groups: EmailGroup<T>[], sort: MailSortKey): EmailGroup<T>[] {
    const list = [...groups];
    if (sort === 'oldest') return list.sort((a, b) => time(a.latestEmail) - time(b.latestEmail));
    if (sort === 'sender') {
        const key = (g: EmailGroup<T>) => senderName(g.latestEmail.from || (g.latestEmail as any).to || '').toLocaleLowerCase();
        return list.sort((a, b) => key(a).localeCompare(key(b)) || time(b.latestEmail) - time(a.latestEmail));
    }
    return list.sort((a, b) => time(b.latestEmail) - time(a.latestEmail));
}

// ---------------------------------------------------------------------------
// Encabezados por fecha
// ---------------------------------------------------------------------------

export type DateBucket = 'upcoming' | 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'older';

const DAY_MS = 86_400_000;

function startOfDay(d: Date): number {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Cubeta de fecha en hora local: futuro, hoy, ayer, esta semana (lunes a domingo), este mes o mas antiguo. */
export function dateBucket(date: string | number | Date, now: number | Date = Date.now()): DateBucket {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return 'older';
    const n = new Date(now);
    const today = startOfDay(n);
    const day = startOfDay(d);
    if (day > today) return 'upcoming';
    if (day === today) return 'today';
    if (Math.round((today - day) / DAY_MS) === 1) return 'yesterday';
    const weekday = (n.getDay() + 6) % 7; // lunes = 0
    if (day >= today - weekday * DAY_MS) return 'thisWeek';
    if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth()) return 'thisMonth';
    return 'older';
}

export interface MailSection<G> { bucket: DateBucket; groups: G[] }

/** Agrupa (sin reordenar) los hilos consecutivos por cubeta de fecha de su mensaje mas reciente. */
export function sectionsByDate<T extends ListEmail>(groups: EmailGroup<T>[], now: number | Date = Date.now()): MailSection<EmailGroup<T>>[] {
    const sections: MailSection<EmailGroup<T>>[] = [];
    for (const g of groups) {
        const bucket = dateBucket(g.latestEmail.createdAt, now);
        const last = sections[sections.length - 1];
        if (last && last.bucket === bucket) last.groups.push(g);
        else sections.push({ bucket, groups: [g] });
    }
    return sections;
}

export type FlatListItem<G> =
    | { kind: 'header'; id: string; bucket: DateBucket; count: number }
    | { kind: 'row'; id: string; group: G; rowIndex: number };

/** Lista plana (encabezados + filas) para renderizar y virtualizar. `rowIndex` = posicion entre las filas (sin encabezados). */
export function flattenSections<G extends { id: string }>(sections: MailSection<G>[]): FlatListItem<G>[] {
    const out: FlatListItem<G>[] = [];
    let rowIndex = 0;
    sections.forEach((s, i) => {
        out.push({ kind: 'header', id: `hdr:${s.bucket}:${i}`, bucket: s.bucket, count: s.groups.length });
        for (const group of s.groups) out.push({ kind: 'row', id: group.id, group, rowIndex: rowIndex++ });
    });
    return out;
}

/** Lista plana sin encabezados. */
export function flattenRows<G extends { id: string }>(groups: G[]): FlatListItem<G>[] {
    return groups.map((group, rowIndex) => ({ kind: 'row' as const, id: group.id, group, rowIndex }));
}

/** Indices (en la lista plana) de los encabezados: son los elementos "pegajosos". */
export function headerIndexes(items: Array<{ kind: string }>): number[] {
    const out: number[] = [];
    items.forEach((it, i) => { if (it.kind === 'header') out.push(i); });
    return out;
}

// ---------------------------------------------------------------------------
// Seleccion masiva
// ---------------------------------------------------------------------------

export interface SelectionSummary {
    /** Todas las filas cargadas estan seleccionadas. */
    allLoadedSelected: boolean;
    /** Se puede ofrecer "seleccionar toda la carpeta" (hay mas correos de los cargados). */
    canSelectWholeFolder: boolean;
    /** Cuantos se seleccionarian: el total real del alcance (sin tope; el servidor actua sobre todo el alcance). */
    wholeFolderCount: number;
}

export function selectionSummary(selected: Set<string>, loadedIds: string[], total: number | null, hasMore: boolean): SelectionSummary {
    const allLoadedSelected = loadedIds.length > 0 && loadedIds.every((id) => selected.has(id));
    const knownTotal = typeof total === 'number' && total > loadedIds.length ? total : loadedIds.length;
    return {
        allLoadedSelected,
        canSelectWholeFolder: allLoadedSelected && hasMore && knownTotal > loadedIds.length,
        wholeFolderCount: knownTotal,
    };
}

// ---------------------------------------------------------------------------
// Eventos de la lista (mailBus) y foco tras quitar filas
// ---------------------------------------------------------------------------

export type ListBusEvent<T extends ListEmail = ListEmail> =
    | { type: 'remove'; ids: string[] }
    | { type: 'patch'; items: Array<{ id: string; updates: Record<string, unknown> }> }
    | { type: 'upsert'; emails: T[] };

/**
 * Aplica un evento optimista a la lista. `remove` quita por id; `patch` cambia campos de los que ya estan; `upsert` combina (por id) los que ya estan y repone los que
 * faltan (deshacer / reversion) salvo que la vista sea de UNA carpeta y el correo pertenezca a otra.
 */
export function reduceListEvent<T extends ListEmail>(
    emails: T[],
    event: ListBusEvent<T>,
    opts: { viewFolder: string; restrictToFolder: boolean },
): T[] {
    if (event.type === 'remove') {
        const gone = new Set(event.ids);
        return emails.filter((e) => !gone.has(e.id));
    }
    if (event.type === 'patch') {
        const byId = new Map(event.items.map((i) => [i.id, i.updates]));
        let changed = false;
        const next = emails.map((e) => {
            const u = byId.get(e.id);
            if (!u) return e;
            changed = true;
            return { ...e, ...u } as T;
        });
        return changed ? next : emails;
    }
    const present = new Set(emails.map((e) => e.id));
    const incoming = event.emails.filter((e) => {
        if (present.has(e.id)) return true;
        if (!opts.restrictToFolder) return true;
        return ((typeof e.folder === 'string' && e.folder) || opts.viewFolder) === opts.viewFolder;
    });
    if (incoming.length === 0) return emails;
    const byId = new Map(incoming.map((e) => [e.id, e]));
    const replaced = emails.map((e) => { const inc = byId.get(e.id); return inc ? ({ ...e, ...inc } as T) : e; });
    const added = incoming.filter((e) => !present.has(e.id));
    return added.length === 0 ? replaced : [...replaced, ...added].sort((a, b) => time(b) - time(a));
}

/**
 * Fila a la que pasa el foco cuando se quitan filas: la siguiente que siga existiendo; si no, la anterior.
 * null si no queda ninguna o el foco no estaba en una fila quitada.
 */
export function focusAfterRemoval(ids: string[], removed: Set<string>, focusedId: string | null): string | null {
    if (!focusedId || !removed.has(focusedId)) return null;
    const index = ids.indexOf(focusedId);
    if (index < 0) return null;
    for (let i = index + 1; i < ids.length; i++) if (!removed.has(ids[i])) return ids[i];
    for (let i = index - 1; i >= 0; i--) if (!removed.has(ids[i])) return ids[i];
    return null;
}
