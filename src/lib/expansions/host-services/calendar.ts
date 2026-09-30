/**
 * Servicio de calendario del sandbox de extensiones (`services.calendar.*`), lado frontend.
 *
 * Garantias:
 *  - PROPIEDAD: TODA consulta/escritura filtra por `userId` (el que fijo el backend). Un id ajeno es indistinguible de uno
 *    inexistente (`not_found`).
 *  - Solo calendarios del usuario NO de solo lectura pueden escribirse (`read_only`).
 *  - Nunca se exponen externalId, syncToken, tokens de Google ni inviteUid.
 *  - Las escrituras NO envian correos de invitacion y NO disparan hooks de extensiones (anti-bucle): solo persisten.
 */
import { z } from 'zod';
import { normalizeEmailAddressAscii, sanitizeDisplayName, stripControlChars } from '@/lib/mail-validation';
import { BridgeError, op } from './bridge-route';

const DAY_MS = 86_400_000;
const MIN_MS = 60_000;

// ---------------------------------------------------------------------------------------------------------------
// Esquemas (estrictos)
// ---------------------------------------------------------------------------------------------------------------
export function isValidTimeZone(tz: string): boolean {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}

const iso = z.iso.datetime({ offset: true });
const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const timeZone = z.string().min(1).max(64).refine(isValidTimeZone, 'invalid timeZone');
const email = z.string().min(3).max(320);
const attendee = z.strictObject({ email, name: z.string().max(200).optional() });
const description = z.string().max(5000);
const location = z.string().max(300);

export const calendarRequest = z.discriminatedUnion('op', [
    op('listCalendars', z.strictObject({}).default({})),
    op('listEvents', z.strictObject({ from: iso, to: iso, limit: z.number().int().min(1).max(200).default(50), calendarId: id.optional() })),
    op('getEvent', z.strictObject({ eventId: id })),
    op('findFreeSlots', z.strictObject({
        from: iso, to: iso,
        durationMinutes: z.number().int().min(5).max(480),
        limit: z.number().int().min(1).max(50).default(10),
        timeZone: timeZone.default('UTC'),
        workdayStart: hhmm.default('09:00'),
        workdayEnd: hhmm.default('18:00'),
        stepMinutes: z.number().int().min(5).max(120).default(15),
        calendarId: id.optional(),
    })),
    op('createEvent', z.strictObject({
        calendarId: id.optional(),
        title: z.string().trim().min(1).max(200),
        description: description.optional(),
        location: location.optional(),
        startsAt: iso, endsAt: iso,
        allDay: z.boolean().optional(),
        attendees: z.array(attendee).max(50).optional(),
    })),
    op('updateEvent', z.strictObject({
        eventId: id,
        title: z.string().trim().min(1).max(200).optional(),
        description: description.optional(),
        location: location.optional(),
        startsAt: iso.optional(), endsAt: iso.optional(),
        allDay: z.boolean().optional(),
    }).refine((a) => Object.keys(a).some((k) => k !== 'eventId'), 'nothing to update')),
    op('deleteEvent', z.strictObject({ eventId: id })),
    op('addInvite', z.strictObject({ eventId: id, attendees: z.array(attendee).min(1).max(20) })),
    op('respondInvite', z.strictObject({ eventId: id, response: z.enum(['accepted', 'tentative', 'declined']) })),
]);
export type CalendarRequest = z.infer<typeof calendarRequest>;

// ---------------------------------------------------------------------------------------------------------------
// Dependencias inyectables (subconjunto de Prisma)
// ---------------------------------------------------------------------------------------------------------------
export interface CalendarDb {
    user: { findUnique: (args: any) => Promise<any> };
    calendar: { findFirst: (args: any) => Promise<any> };
    calendarEvent: {
        findMany: (args: any) => Promise<any[]>;
        findFirst: (args: any) => Promise<any>;
        create: (args: any) => Promise<any>;
        update: (args: any) => Promise<any>;
        deleteMany: (args: any) => Promise<{ count: number }>;
    };
    calendarAttendee: { updateMany: (args: any) => Promise<any> };
}

export interface CalendarDeps {
    db: CalendarDb;
    /** Calendarios del usuario, creando los predeterminados que falten. */
    ensureCalendars: (userId: string) => Promise<any[]>;
}

export async function defaultCalendarDeps(): Promise<CalendarDeps> {
    const [{ prisma }, { ensureDefaultCalendars }] = await Promise.all([import('@/lib/prisma'), import('@/lib/calendar/defaults')]);
    return { db: prisma as unknown as CalendarDb, ensureCalendars: ensureDefaultCalendars };
}

// ---------------------------------------------------------------------------------------------------------------
// Salida: solo campos permitidos
// ---------------------------------------------------------------------------------------------------------------
const INCLUDE = { attendees: true } as const;
const isoOf = (d: unknown) => (d instanceof Date ? d.toISOString() : new Date(String(d)).toISOString());

export function toEvent(row: any) {
    return {
        id: String(row.id),
        calendarId: String(row.calendarId),
        title: String(row.title ?? ''),
        description: row.description ?? null,
        location: row.location ?? null,
        startsAt: isoOf(row.startsAt),
        endsAt: isoOf(row.endsAt),
        allDay: !!row.allDay,
        status: String(row.status ?? 'confirmed'),
        responseStatus: row.responseStatus ?? null,
        source: String(row.source ?? 'local'),
        organizerEmail: row.organizerEmail ?? null,
        // Campo de otra funcionalidad (reuniones): se lee solo si la fila lo trae y es https.
        conferenceUrl: typeof row.conferenceUrl === 'string' && /^https:\/\//i.test(row.conferenceUrl) ? row.conferenceUrl : null,
        attendees: (Array.isArray(row.attendees) ? row.attendees : []).map((a: any) => ({
            email: String(a.email),
            name: a.name ?? null,
            responseStatus: a.responseStatus ?? null,
        })),
    };
}

const clean = (v: string) => stripControlChars(v);
// Descripcion/ubicacion admiten saltos de linea: solo se quitan los demas controles.
const cleanMultiline = (v: string) => v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, '').trim();

function parseAttendees(list: Array<{ email: string; name?: string }>, exclude: Set<string>) {
    const out: Array<{ email: string; name: string | null }> = [];
    const seen = new Set(exclude);
    for (const a of list) {
        const addr = normalizeEmailAddressAscii(String(a.email).trim().toLowerCase());
        if (!addr) throw new BridgeError('invalid_args');
        const key = addr.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ email: key, name: a.name ? sanitizeDisplayName(a.name) || null : null });
    }
    return out;
}

async function loadOwnedEvent(deps: CalendarDeps, userId: string, eventId: string) {
    const row = await deps.db.calendarEvent.findFirst({ where: { id: eventId, userId }, include: { attendees: true, calendar: true } });
    if (!row) throw new BridgeError('not_found');
    return row;
}

async function reloadEvent(deps: CalendarDeps, userId: string, eventId: string) {
    const row = await deps.db.calendarEvent.findFirst({ where: { id: eventId, userId }, include: INCLUDE });
    if (!row) throw new BridgeError('not_found');
    return toEvent(row);
}

function checkRange(from: string, to: string, maxDays: number) {
    const f = Date.parse(from), t = Date.parse(to);
    if (!(t > f) || t - f > maxDays * DAY_MS) throw new BridgeError('invalid_args');
    return { from: new Date(f), to: new Date(t) };
}

// ---------------------------------------------------------------------------------------------------------------
// Huecos libres (puro, sin dependencias)
// ---------------------------------------------------------------------------------------------------------------
export interface BusyInterval { start: number; end: number }

/** Desfase (ms) de `tz` respecto a UTC en el instante `utcMs` (local - UTC). */
function tzOffsetMs(utcMs: number, tz: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    }).formatToParts(new Date(utcMs));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Instante UTC (ms) de una hora local de pared en `tz` (resuelve cambios de horario con dos pasadas). */
export function zonedWallTimeToUtc(y: number, m: number, d: number, h: number, min: number, tz: string): number {
    const guess = Date.UTC(y, m - 1, d, h, min);
    const first = guess - tzOffsetMs(guess, tz);
    return guess - tzOffsetMs(first, tz);
}

function localYmd(utcMs: number, tz: string) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(utcMs));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    return { y: get('year'), m: get('month'), d: get('day') };
}

const toMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

export function computeFreeSlots(input: {
    from: number; to: number; durationMinutes: number; limit: number; timeZone: string;
    workdayStart: string; workdayEnd: string; stepMinutes: number; busy: BusyInterval[];
}): Array<{ start: string; end: string }> {
    const { from, to, durationMinutes, limit, timeZone: tz, stepMinutes, busy } = input;
    const startMin = toMinutes(input.workdayStart), endMin = toMinutes(input.workdayEnd);
    if (endMin <= startMin) return [];
    const dur = durationMinutes * MIN_MS, step = stepMinutes * MIN_MS;
    const sorted = [...busy].filter((b) => b.end > b.start).sort((a, b) => a.start - b.start);
    const slots: Array<{ start: string; end: string }> = [];

    const first = localYmd(from, tz);
    const last = localYmd(to, tz);
    const lastKey = Date.UTC(last.y, last.m - 1, last.d);
    for (let i = 0; i < 40; i++) {
        const dayUtc = Date.UTC(first.y, first.m - 1, first.d + i);
        if (dayUtc > lastKey) break;
        const day = new Date(dayUtc);
        const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate();
        const winStart = zonedWallTimeToUtc(y, m, d, Math.floor(startMin / 60), startMin % 60, tz);
        const winEnd = zonedWallTimeToUtc(y, m, d, Math.floor(endMin / 60), endMin % 60, tz);
        const lo = Math.max(winStart, from), hi = Math.min(winEnd, to);
        if (hi - lo < dur) continue;
        // Rejilla alineada al inicio de la jornada; el primer candidato es el primero >= lo.
        let cursor = winStart + Math.ceil((lo - winStart) / step) * step;
        while (cursor + dur <= hi) {
            const end = cursor + dur;
            const clash = sorted.find((b) => b.start < end && b.end > cursor);
            if (!clash) {
                slots.push({ start: new Date(cursor).toISOString(), end: new Date(end).toISOString() });
                if (slots.length >= limit) return slots;
                cursor += step;
            } else {
                // Salta al primer punto de la rejilla posterior al fin del evento que choca.
                cursor = Math.max(cursor + step, winStart + Math.ceil((clash.end - winStart) / step) * step);
            }
        }
    }
    return slots;
}

// ---------------------------------------------------------------------------------------------------------------
// Operaciones
// ---------------------------------------------------------------------------------------------------------------
export async function handleCalendar(deps: CalendarDeps, req: CalendarRequest): Promise<unknown> {
    const { userId } = req;
    const { db } = deps;

    switch (req.op) {
        case 'listCalendars': {
            const rows = await deps.ensureCalendars(userId);
            return {
                calendars: rows
                    .filter((c) => c.userId === undefined || c.userId === userId)
                    .map((c) => ({ id: String(c.id), name: String(c.name), color: String(c.color), source: String(c.source), isReadOnly: !!c.isReadOnly })),
            };
        }

        case 'listEvents': {
            const a = req.args;
            const { from, to } = checkRange(a.from, a.to, 92);
            const where: any = { userId, endsAt: { gt: from }, startsAt: { lt: to } };
            if (a.calendarId) where.calendarId = a.calendarId;
            const rows = await db.calendarEvent.findMany({ where, include: INCLUDE, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], take: a.limit + 1 });
            return { events: rows.slice(0, a.limit).map(toEvent), truncated: rows.length > a.limit };
        }

        case 'getEvent': {
            const row = await db.calendarEvent.findFirst({ where: { id: req.args.eventId, userId }, include: INCLUDE });
            return { event: row ? toEvent(row) : null };
        }

        case 'findFreeSlots': {
            const a = req.args;
            const { from, to } = checkRange(a.from, a.to, 31);
            if (toMinutes(a.workdayEnd) <= toMinutes(a.workdayStart)) throw new BridgeError('invalid_args');
            const where: any = { userId, status: { not: 'cancelled' }, endsAt: { gt: from }, startsAt: { lt: to } };
            if (a.calendarId) where.calendarId = a.calendarId;
            // allDay cuenta como ocupado; una invitacion rechazada no ocupa tiempo.
            const rows = await db.calendarEvent.findMany({ where, select: { startsAt: true, endsAt: true, responseStatus: true, status: true }, take: 5000 });
            const busy = rows
                .filter((r) => r.status !== 'cancelled' && r.responseStatus !== 'declined')
                .map((r) => ({ start: new Date(r.startsAt).getTime(), end: new Date(r.endsAt).getTime() }));
            const slots = computeFreeSlots({
                from: from.getTime(), to: to.getTime(), durationMinutes: a.durationMinutes, limit: a.limit, timeZone: a.timeZone,
                workdayStart: a.workdayStart, workdayEnd: a.workdayEnd, stepMinutes: a.stepMinutes, busy,
            });
            return { slots, timeZone: a.timeZone };
        }

        case 'createEvent': {
            const a = req.args;
            const startsAt = new Date(a.startsAt), endsAt = new Date(a.endsAt);
            if (!(endsAt > startsAt) || endsAt.getTime() - startsAt.getTime() > 366 * DAY_MS) throw new BridgeError('invalid_args');
            const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
            if (!user) throw new BridgeError('not_found');

            let calendar: any;
            if (a.calendarId) {
                calendar = await db.calendar.findFirst({ where: { id: a.calendarId, userId } });
            } else {
                const all = await deps.ensureCalendars(userId);
                calendar = all.find((c) => c.userId === userId && c.source === 'local' && !c.isReadOnly);
            }
            if (!calendar) throw new BridgeError('not_found');
            if (calendar.isReadOnly) throw new BridgeError('read_only');

            const ownerEmail = String(user.email || '').toLowerCase();
            const guests = parseAttendees(a.attendees ?? [], new Set(ownerEmail ? [ownerEmail] : []));
            const row = await db.calendarEvent.create({
                data: {
                    userId,
                    calendarId: calendar.id,
                    title: clean(a.title).slice(0, 200) || 'Untitled event',
                    description: a.description ? cleanMultiline(a.description) || null : null,
                    location: a.location ? clean(a.location) || null : null,
                    startsAt, endsAt,
                    allDay: !!a.allDay,
                    source: calendar.source === 'local' ? 'local' : calendar.source,
                    organizerEmail: user.email || null,
                    organizerName: user.name || user.email || null,
                    attendees: {
                        create: [
                            ...(user.email ? [{ email: user.email, name: user.name || user.email, responseStatus: 'accepted', isOrganizer: true }] : []),
                            ...guests.map((g) => ({ email: g.email, name: g.name, responseStatus: 'needsAction', isOrganizer: false })),
                        ],
                    },
                },
                include: INCLUDE,
            });
            return { event: toEvent(row) };
        }

        case 'updateEvent': {
            const a = req.args;
            const existing = await loadOwnedEvent(deps, userId, a.eventId);
            if (existing.calendar?.isReadOnly) throw new BridgeError('read_only');
            const startsAt = a.startsAt ? new Date(a.startsAt) : new Date(existing.startsAt);
            const endsAt = a.endsAt ? new Date(a.endsAt) : new Date(existing.endsAt);
            if (!(endsAt > startsAt) || endsAt.getTime() - startsAt.getTime() > 366 * DAY_MS) throw new BridgeError('invalid_args');
            const data: any = {};
            if (a.title !== undefined) data.title = clean(a.title).slice(0, 200) || existing.title;
            if (a.description !== undefined) data.description = cleanMultiline(a.description) || null;
            if (a.location !== undefined) data.location = clean(a.location) || null;
            if (a.startsAt) data.startsAt = startsAt;
            if (a.endsAt) data.endsAt = endsAt;
            if (a.allDay !== undefined) data.allDay = a.allDay;
            const row = await db.calendarEvent.update({ where: { id: existing.id }, data, include: INCLUDE });
            return { event: toEvent(row) };
        }

        case 'deleteEvent': {
            const existing = await loadOwnedEvent(deps, userId, req.args.eventId);
            if (existing.calendar?.isReadOnly) throw new BridgeError('read_only');
            // Igual que DELETE /api/calendar/events/[id] (borra; los asistentes caen en cascada), sin correo de cancelacion.
            await db.calendarEvent.deleteMany({ where: { id: existing.id, userId } });
            return { deleted: true, eventId: existing.id };
        }

        case 'addInvite': {
            const existing = await loadOwnedEvent(deps, userId, req.args.eventId);
            if (existing.calendar?.isReadOnly) throw new BridgeError('read_only');
            const current = new Set<string>((existing.attendees || []).map((x: any) => String(x.email).toLowerCase()));
            const fresh = parseAttendees(req.args.attendees, current);
            if (current.size + fresh.length > 100) throw new BridgeError('invalid_args');
            if (fresh.length > 0) {
                await db.calendarEvent.update({
                    where: { id: existing.id },
                    data: { attendees: { create: fresh.map((g) => ({ email: g.email, name: g.name, responseStatus: 'needsAction', isOrganizer: false })) } },
                });
            }
            return { event: await reloadEvent(deps, userId, existing.id) };
        }

        case 'respondInvite': {
            const existing = await loadOwnedEvent(deps, userId, req.args.eventId);
            if (existing.calendar?.isReadOnly) throw new BridgeError('read_only');
            const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
            const ownerEmail = String(user?.email || '').toLowerCase();
            await db.calendarEvent.update({ where: { id: existing.id }, data: { responseStatus: req.args.response } });
            if (ownerEmail) {
                await db.calendarAttendee.updateMany({
                    where: { eventId: existing.id, email: { equals: ownerEmail, mode: 'insensitive' } },
                    data: { responseStatus: req.args.response },
                });
            }
            return { event: await reloadEvent(deps, userId, existing.id) };
        }
    }
}
