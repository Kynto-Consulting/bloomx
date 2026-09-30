import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { ensureDefaultCalendars } from '@/lib/calendar/defaults';
import { getGoogleAccessToken } from '@/lib/google/account';
import { GoogleAuthError, classifyGoogleApiError, googleAuthErrorToResponse, isGoogleAuthError } from '@/lib/google/errors';
import {
    GoogleEventItem,
    GooglePersonItem,
    chunk,
    fetchAllPages,
    isEventUnchanged,
    mapGoogleContacts,
    partitionGoogleEvents,
} from '@/lib/google/sync-utils';

export const runtime = 'nodejs';
// La sincronizacion pagina y escribe en lote: puede tardar en calendarios grandes.
export const maxDuration = 60;

type GoogleCalendarListItem = {
    id: string;
    summary?: string;
    backgroundColor?: string;
    accessRole?: string;
    primary?: boolean;
};

const DB_CHUNK = 500;
const MAX_CALENDAR_PAGES = 10;
const MAX_EVENT_PAGES = 40; // 250 * 40 = 10 000 eventos por calendario
const MAX_CONTACT_PAGES = 30; // 1000 * 30

// Una sincronizacion por usuario a la vez (dentro de la instancia): evita duplicar trabajo y carreras.
const runningSyncs = new Set<string>();

async function fetchGoogleJson<T>(accessToken: string, url: string): Promise<T> {
    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
        cache: 'no-store',
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
        // Token invalido/revocado o scopes insuficientes -> reconexion (401), no un 500 generico.
        const authError = classifyGoogleApiError(response.status, data);
        if (authError) throw authError;
        throw new Error(data?.error?.message || 'Google API request failed');
    }

    return data as T;
}

/** Devuelve el calendario local que corresponde al de Google: primero por externalId, luego (legado) por nombre. */
async function upsertGoogleCalendar(userId: string, googleCalendar: GoogleCalendarListItem) {
    const name = (googleCalendar.summary || (googleCalendar.primary ? 'Google Calendar' : 'Untitled Calendar')).trim();
    const color = googleCalendar.backgroundColor || '#34a853';
    const isReadOnly = ['reader', 'freeBusyReader'].includes(String(googleCalendar.accessRole || ''));
    const common = { color, isReadOnly, externalId: googleCalendar.id, lastSyncedAt: new Date() };

    const byExternalId = await prisma.calendar.findFirst({
        where: { userId, source: 'google', externalId: googleCalendar.id },
    });
    const byName = await prisma.calendar.findUnique({
        where: { userId_source_name: { userId, source: 'google', name } },
    });

    // Otro calendario de Google distinto ya usa este nombre: desambiguar para no violar la unicidad.
    const nameTakenByOther = Boolean(byName && byName.externalId && byName.externalId !== googleCalendar.id);
    const uniqueName = nameTakenByOther ? `${name} (${googleCalendar.id.slice(0, 6)})` : name;

    if (byExternalId) {
        // Sigue el renombrado en Google en lugar de crear un duplicado.
        const canRename = !byName || byName.id === byExternalId.id;
        return prisma.calendar.update({
            where: { id: byExternalId.id },
            data: { ...common, ...(canRename ? { name: uniqueName } : {}) },
        });
    }

    if (byName && !nameTakenByOther) {
        // Calendario creado por una version anterior (sin externalId unico): adoptarlo.
        return prisma.calendar.update({ where: { id: byName.id }, data: common });
    }

    return prisma.calendar.create({
        data: { userId, name: uniqueName, source: 'google', ...common },
    });
}

async function syncCalendarEvents(userId: string, calendarId: string, googleCalendarId: string, accessToken: string) {
    const now = Date.now();
    const timeMinDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const timeMaxDate = new Date(now + 180 * 24 * 60 * 60 * 1000);
    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(googleCalendarId)}/events`;

    const { items: googleItems, truncated } = await fetchAllPages<GoogleEventItem>(async (pageToken) => {
        const params = new URLSearchParams({
            singleEvents: 'true',
            // showDeleted permite recibir los eventos cancelados para eliminarlos localmente.
            showDeleted: 'true',
            maxResults: '250',
            orderBy: 'startTime',
            timeMin: timeMinDate.toISOString(),
            timeMax: timeMaxDate.toISOString(),
        });
        if (pageToken) params.set('pageToken', pageToken);
        const data = await fetchGoogleJson<{ items?: GoogleEventItem[]; nextPageToken?: string }>(accessToken, `${base}?${params}`);
        return { items: data.items || [], nextPageToken: data.nextPageToken };
    }, MAX_EVENT_PAGES);

    const { upserts, cancelledIds } = partitionGoogleEvents(googleItems);

    // Eventos ya guardados de este calendario (una sola consulta, sin N+1).
    const existingRows: Array<{ id: string; externalId: string | null; lastSyncedAt: Date | null }> = [];
    for (const ids of chunk(upserts.map((u) => u.externalId), DB_CHUNK)) {
        existingRows.push(...(await prisma.calendarEvent.findMany({
            where: { userId, calendarId, externalId: { in: ids } },
            select: { id: true, externalId: true, lastSyncedAt: true },
        })));
    }
    const existingByExternalId = new Map(existingRows.map((row) => [row.externalId as string, row]));

    const toCreate = upserts.filter((u) => !existingByExternalId.has(u.externalId));
    const toUpdate = upserts.filter((u) => {
        const existing = existingByExternalId.get(u.externalId);
        return existing && !isEventUnchanged(existing.lastSyncedAt, u.remoteUpdatedAt);
    });

    const eventFields = (u: (typeof upserts)[number]) => ({
        title: u.title,
        description: u.description,
        location: u.location,
        startsAt: u.startsAt,
        endsAt: u.endsAt,
        allDay: u.allDay,
        status: u.status,
        source: 'google',
        externalId: u.externalId,
        organizerEmail: u.organizerEmail,
        organizerName: u.organizerName,
        lastSyncedAt: u.remoteUpdatedAt || new Date(),
    });

    // Nuevos: createMany de eventos + createMany de asistentes (ids generados aqui para enlazarlos).
    const newIds = new Map<string, string>();
    for (const batch of chunk(toCreate, DB_CHUNK)) {
        const rows = batch.map((u) => {
            const id = randomUUID();
            newIds.set(u.externalId, id);
            return { id, userId, calendarId, ...eventFields(u) };
        });
        await prisma.calendarEvent.createMany({ data: rows, skipDuplicates: true });
    }

    // Modificados: solo los que cambiaron en Google; en una transaccion por lote.
    for (const batch of chunk(toUpdate, 100)) {
        const ids = batch.map((u) => (existingByExternalId.get(u.externalId) as { id: string }).id);
        await prisma.$transaction([
            prisma.calendarAttendee.deleteMany({ where: { eventId: { in: ids } } }),
            ...batch.map((u) => prisma.calendarEvent.update({
                where: { id: (existingByExternalId.get(u.externalId) as { id: string }).id },
                data: eventFields(u),
            })),
        ]);
    }

    const attendeeRows = [...toCreate, ...toUpdate].flatMap((u) => {
        const eventId = newIds.get(u.externalId) || existingByExternalId.get(u.externalId)?.id;
        if (!eventId) return [];
        return u.attendees.map((a) => ({ eventId, email: a.email, name: a.name, responseStatus: a.responseStatus, isOrganizer: a.isOrganizer }));
    });
    for (const batch of chunk(attendeeRows, DB_CHUNK)) {
        await prisma.calendarAttendee.createMany({ data: batch });
    }

    // Cancelados / borrados en Google.
    let deleted = 0;
    for (const ids of chunk(cancelledIds, DB_CHUNK)) {
        const result = await prisma.calendarEvent.deleteMany({
            where: { userId, calendarId, source: 'google', externalId: { in: ids } },
        });
        deleted += result.count;
    }

    // Con la ventana completa leida, lo que sigue en local dentro de la ventana y Google ya no devuelve
    // (borrado definitivo, o movido fuera de la ventana) tambien se elimina. Solo si no hubo truncado.
    if (!truncated) {
        const liveIds = upserts.map((u) => u.externalId);
        const stale = await prisma.calendarEvent.findMany({
            where: {
                userId,
                calendarId,
                source: 'google',
                externalId: { not: null },
                startsAt: { gte: timeMinDate, lte: timeMaxDate },
            },
            select: { id: true, externalId: true },
        });
        const liveSet = new Set(liveIds);
        const staleIds = stale.filter((row) => row.externalId && !liveSet.has(row.externalId)).map((row) => row.id);
        for (const ids of chunk(staleIds, DB_CHUNK)) {
            deleted += (await prisma.calendarEvent.deleteMany({ where: { id: { in: ids } } })).count;
        }
    }

    return { created: toCreate.length, updated: toUpdate.length, deleted, truncated };
}

async function syncContacts(userId: string, accessToken: string) {
    const { items: people, truncated } = await fetchAllPages<GooglePersonItem>(async (pageToken) => {
        const params = new URLSearchParams({ personFields: 'names,emailAddresses,biographies', pageSize: '1000' });
        if (pageToken) params.set('pageToken', pageToken);
        const data = await fetchGoogleJson<{ connections?: GooglePersonItem[]; nextPageToken?: string }>(
            accessToken,
            `https://people.googleapis.com/v1/people/me/connections?${params}`,
        );
        return { items: data.connections || [], nextPageToken: data.nextPageToken };
    }, MAX_CONTACT_PAGES);

    const mapped = mapGoogleContacts(people);
    let created = 0;
    let updated = 0;

    for (const batch of chunk(mapped, DB_CHUNK)) {
        const existing = await prisma.contact.findMany({
            where: { userId, email: { in: batch.map((c) => c.email) } },
            select: { id: true, email: true, source: true, name: true, notes: true, externalId: true },
        });
        const existingByEmail = new Map(existing.map((c) => [c.email, c]));

        const toCreate = batch.filter((c) => !existingByEmail.has(c.email));
        if (toCreate.length > 0) {
            const result = await prisma.contact.createMany({
                data: toCreate.map((c) => ({ userId, email: c.email, name: c.name, notes: c.notes, externalId: c.externalId, source: 'google' })),
                skipDuplicates: true,
            });
            created += result.count;
        }

        // Solo se actualizan contactos que ya venian de Google y cambiaron: los locales conservan lo que
        // edito el usuario (nombre/notas) en lugar de ser sobrescritos por cada sincronizacion.
        const toUpdate = batch.filter((c) => {
            const row = existingByEmail.get(c.email);
            return row && row.source === 'google' && (row.name !== c.name || (row.notes ?? null) !== c.notes);
        });
        for (const c of toUpdate) {
            await prisma.contact.update({
                where: { userId_email: { userId, email: c.email } },
                data: { name: c.name, notes: c.notes, externalId: c.externalId },
            });
            updated += 1;
        }
    }

    return { synced: mapped.length, created, updated, truncated };
}

export async function POST() {
    const user = await getCurrentUser();
    if (!user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (runningSyncs.has(user.id)) {
        return NextResponse.json({ error: 'A Google sync is already running', code: 'SYNC_IN_PROGRESS' }, { status: 409 });
    }
    runningSyncs.add(user.id);

    try {
        await ensureDefaultCalendars(user.id);

        const { accessToken } = await getGoogleAccessToken(user.id);

        const { items: calendars, truncated: calendarsTruncated } = await fetchAllPages<GoogleCalendarListItem>(async (pageToken) => {
            const params = new URLSearchParams({ maxResults: '250' });
            if (pageToken) params.set('pageToken', pageToken);
            const data = await fetchGoogleJson<{ items?: GoogleCalendarListItem[]; nextPageToken?: string }>(
                accessToken,
                `https://www.googleapis.com/calendar/v3/users/me/calendarList?${params}`,
            );
            return { items: data.items || [], nextPageToken: data.nextPageToken };
        }, MAX_CALENDAR_PAGES);

        let syncedCalendars = 0;
        let syncedEvents = 0;
        let deletedEvents = 0;
        let partial = calendarsTruncated;

        for (const googleCalendar of calendars) {
            const calendar = await upsertGoogleCalendar(user.id, googleCalendar);
            syncedCalendars += 1;
            const result = await syncCalendarEvents(user.id, calendar.id, googleCalendar.id, accessToken);
            syncedEvents += result.created + result.updated;
            deletedEvents += result.deleted;
            if (result.truncated) partial = true;
        }

        const contacts = await syncContacts(user.id, accessToken);
        if (contacts.truncated) partial = true;

        return NextResponse.json({
            success: true,
            syncedCalendars,
            syncedEvents,
            deletedEvents,
            syncedContacts: contacts.synced,
            createdContacts: contacts.created,
            partial,
            syncedAt: new Date().toISOString(),
        });
    } catch (error: any) {
        if (isGoogleAuthError(error)) {
            // 401 (reconectar) o 409 (no vinculada) con un codigo estable y la URL para reconectar.
            const { status, body } = googleAuthErrorToResponse(error as GoogleAuthError, '/calendar');
            return NextResponse.json(body, { status });
        }
        console.error('Google sync failed:', error);
        return NextResponse.json({ error: error?.message || 'Failed to sync Google data' }, { status: 500 });
    } finally {
        runningSyncs.delete(user.id);
    }
}
