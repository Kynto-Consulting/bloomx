/**
 * Logica pura de la sincronizacion con Google Calendar / People (sin red ni BD).
 */

export type GoogleEventDate = { date?: string; dateTime?: string };

export type GoogleEventItem = {
    id: string;
    summary?: string;
    description?: string;
    location?: string;
    status?: string;
    start?: GoogleEventDate;
    end?: GoogleEventDate;
    organizer?: { email?: string; displayName?: string };
    attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string; organizer?: boolean }>;
    updated?: string;
};

export type GooglePersonItem = {
    resourceName?: string;
    names?: Array<{ displayName?: string }>;
    emailAddresses?: Array<{ value?: string }>;
    biographies?: Array<{ value?: string }>;
};

type Page<T> = { items: T[]; nextPageToken?: string };

/**
 * Recorre todas las paginas (nextPageToken). `maxPages` evita bucles infinitos y limita el tiempo total;
 * `truncated` avisa si quedaron paginas sin leer (no se debe borrar por ausencia con datos incompletos).
 */
export async function fetchAllPages<T>(
    fetchPage: (pageToken?: string) => Promise<Page<T>>,
    maxPages = 40,
): Promise<{ items: T[]; truncated: boolean; pages: number }> {
    const items: T[] = [];
    let token: string | undefined;
    let pages = 0;
    do {
        const page = await fetchPage(token);
        items.push(...page.items);
        token = page.nextPageToken || undefined;
        pages += 1;
        if (token && pages >= maxPages) return { items, truncated: true, pages };
    } while (token);
    return { items, truncated: false, pages };
}

export function chunk<T>(list: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
}

export function getGoogleEventDate(date?: GoogleEventDate): { value: Date; allDay: boolean } | null {
    if (!date?.date && !date?.dateTime) return null;
    if (date.dateTime) {
        const value = new Date(date.dateTime);
        return Number.isNaN(value.getTime()) ? null : { value, allDay: false };
    }
    const value = new Date(`${date.date}T00:00:00.000Z`);
    return Number.isNaN(value.getTime()) ? null : { value, allDay: true };
}

export type MappedEvent = {
    externalId: string;
    title: string;
    description: string | null;
    location: string | null;
    startsAt: Date;
    endsAt: Date;
    allDay: boolean;
    status: string;
    organizerEmail: string | null;
    organizerName: string | null;
    /** Marca de tiempo de Google (`updated`); sirve para omitir eventos sin cambios. */
    remoteUpdatedAt: Date | null;
    attendees: Array<{ email: string; name: string | null; responseStatus: string | null; isOrganizer: boolean }>;
};

/**
 * Separa lo devuelto por Google en eventos a guardar y ids cancelados/borrados (a eliminar en local).
 * Con `showDeleted=true` Google envia los cancelados, a menudo sin start/end.
 */
export function partitionGoogleEvents(items: GoogleEventItem[]): { upserts: MappedEvent[]; cancelledIds: string[] } {
    const upserts: MappedEvent[] = [];
    const cancelled = new Set<string>();

    for (const ev of items) {
        if (!ev?.id) continue;
        if (ev.status === 'cancelled') {
            cancelled.add(ev.id);
            continue;
        }
        const start = getGoogleEventDate(ev.start);
        const end = getGoogleEventDate(ev.end);
        if (!start || !end) continue;

        const updated = ev.updated ? new Date(ev.updated) : null;
        upserts.push({
            externalId: ev.id,
            title: ev.summary || 'Untitled event',
            description: ev.description || null,
            location: ev.location || null,
            startsAt: start.value,
            endsAt: end.value,
            allDay: start.allDay,
            status: ev.status || 'confirmed',
            organizerEmail: ev.organizer?.email || null,
            organizerName: ev.organizer?.displayName || ev.organizer?.email || null,
            remoteUpdatedAt: updated && !Number.isNaN(updated.getTime()) ? updated : null,
            attendees: (ev.attendees || [])
                .filter((a) => a.email)
                .map((a) => ({
                    email: String(a.email).toLowerCase(),
                    name: a.displayName || a.email || null,
                    responseStatus: a.responseStatus || null,
                    isOrganizer: Boolean(a.organizer),
                })),
        });
    }

    // Un id no puede estar a la vez cancelado y vigente (p. ej. reprogramado): prevalece el vigente.
    const liveIds = new Set(upserts.map((u) => u.externalId));
    return { upserts, cancelledIds: [...cancelled].filter((id) => !liveIds.has(id)) };
}

/** true si el evento local ya esta al dia respecto de Google (se omite el UPDATE). */
export function isEventUnchanged(existingLastSyncedAt: Date | null | undefined, remoteUpdatedAt: Date | null): boolean {
    if (!existingLastSyncedAt || !remoteUpdatedAt) return false;
    return existingLastSyncedAt.getTime() >= remoteUpdatedAt.getTime();
}

export type MappedContact = { email: string; name: string; notes: string | null; externalId: string | null };

/** Convierte personas de People API en contactos por correo principal (sin duplicados dentro del lote). */
export function mapGoogleContacts(people: GooglePersonItem[]): MappedContact[] {
    const byEmail = new Map<string, MappedContact>();
    for (const person of people) {
        const email = person.emailAddresses?.find((item) => item.value)?.value?.trim().toLowerCase();
        if (!email || !email.includes('@')) continue;
        if (byEmail.has(email)) continue;
        byEmail.set(email, {
            email,
            name: person.names?.[0]?.displayName || email,
            notes: person.biographies?.[0]?.value || null,
            externalId: person.resourceName || null,
        });
    }
    return [...byEmail.values()];
}
