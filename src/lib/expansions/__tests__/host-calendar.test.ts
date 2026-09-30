import { describe, expect, it } from 'vitest';
import { calendarRequest, computeFreeSlots, handleCalendar, zonedWallTimeToUtc, type CalendarDb, type CalendarDeps, type CalendarRequest } from '../host-services/calendar';
import { BridgeError } from '../host-services/bridge-route';

// Doble en memoria que HONRA los filtros por userId: si el servicio olvidara acotar una consulta, el IDOR se delata.
type Cal = { id: string; userId: string; name: string; color: string; source: string; isReadOnly: boolean };
type Ev = {
    id: string; userId: string; calendarId: string; title: string; description: string | null; location: string | null;
    startsAt: Date; endsAt: Date; allDay: boolean; status: string; responseStatus: string | null; source: string;
    organizerEmail: string | null; externalId?: string | null; inviteUid?: string | null; attendees: any[];
};

function makeDb(seed: { cals: Cal[]; events: Ev[]; users?: Array<{ id: string; email: string; name: string | null }> }) {
    const cals = [...seed.cals];
    const events = new Map(seed.events.map((e) => [e.id, { ...e, attendees: [...e.attendees] }]));
    const users = seed.users ?? [{ id: 'u1', email: 'me@x.test', name: 'Me' }, { id: 'u2', email: 'other@x.test', name: 'Other' }];
    let seq = 0;
    const withRel = (e: Ev, include?: any) => ({ ...e, ...(include?.calendar ? { calendar: cals.find((c) => c.id === e.calendarId) } : {}) });
    const db: CalendarDb = {
        user: { findUnique: async ({ where }) => users.find((u) => u.id === where.id) ?? null },
        calendar: { findFirst: async ({ where }) => cals.find((c) => c.id === where.id && c.userId === where.userId) ?? null },
        calendarEvent: {
            findMany: async ({ where, take }) => {
                let rows = [...events.values()].filter((e) =>
                    e.userId === where.userId
                    && (!where.calendarId || e.calendarId === where.calendarId)
                    && (!where.status?.not || e.status !== where.status.not)
                    && e.endsAt > where.endsAt.gt && e.startsAt < where.startsAt.lt);
                rows.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
                if (take) rows = rows.slice(0, take);
                return rows;
            },
            findFirst: async ({ where, include }) => {
                const e = events.get(where.id);
                return e && e.userId === where.userId ? withRel(e, include) : null;
            },
            create: async ({ data }) => {
                const id = `ev${++seq}`;
                const { attendees, ...rest } = data;
                const row: Ev = { responseStatus: null, status: 'confirmed', ...rest, id, attendees: (attendees?.create ?? []).map((a: any) => ({ ...a })) };
                events.set(id, row);
                return row;
            },
            update: async ({ where, data }) => {
                const e = events.get(where.id)!;
                const { attendees, ...rest } = data;
                Object.assign(e, rest);
                if (attendees?.create) e.attendees.push(...attendees.create.map((a: any) => ({ ...a })));
                return e;
            },
            deleteMany: async ({ where }) => {
                const e = events.get(where.id);
                if (!e || e.userId !== where.userId) return { count: 0 };
                events.delete(where.id);
                return { count: 1 };
            },
        },
        calendarAttendee: {
            updateMany: async ({ where, data }) => {
                const e = events.get(where.eventId)!;
                for (const a of e.attendees) if (String(a.email).toLowerCase() === where.email.equals) Object.assign(a, data);
                return { count: 1 };
            },
        },
    };
    const deps: CalendarDeps = { db, ensureCalendars: async (userId) => cals.filter((c) => c.userId === userId) };
    return { deps, events, cals };
}

const cal = (over: Partial<Cal> = {}): Cal => ({ id: 'c1', userId: 'u1', name: 'My calendar', color: '#fff', source: 'local', isReadOnly: false, ...over });
const ev = (over: Partial<Ev> = {}): Ev => ({
    id: 'e1', userId: 'u1', calendarId: 'c1', title: 'Standup', description: null, location: null,
    startsAt: new Date('2026-06-01T15:00:00Z'), endsAt: new Date('2026-06-01T16:00:00Z'), allDay: false, status: 'confirmed',
    responseStatus: null, source: 'local', organizerEmail: 'me@x.test', externalId: 'g-secret', inviteUid: 'uid-secret',
    attendees: [{ email: 'me@x.test', name: 'Me', responseStatus: 'accepted', isOrganizer: true }], ...over,
});
const call = (deps: CalendarDeps, body: Record<string, unknown>, userId = 'u1') => {
    const parsed = calendarRequest.parse({ userId, extensionId: 'ext.one', ...body });
    return handleCalendar(deps, parsed as CalendarRequest) as Promise<any>;
};
const code = async (p: Promise<unknown>) => { try { await p; return 'no-error'; } catch (e) { return e instanceof BridgeError ? e.code : `other:${(e as Error).message}`; } };

describe('esquema estricto de calendario', () => {
    const base = { userId: 'u1', extensionId: 'ext.one' };
    it('rechaza claves desconocidas en el cuerpo y en args', () => {
        expect(calendarRequest.safeParse({ ...base, op: 'getEvent', args: { eventId: 'e1' }, extra: 1 }).success).toBe(false);
        expect(calendarRequest.safeParse({ ...base, op: 'getEvent', args: { eventId: 'e1', x: 1 } }).success).toBe(false);
        expect(calendarRequest.safeParse({ ...base, op: 'listCalendars', args: { foo: 1 } }).success).toBe(false);
    });
    it('rechaza op desconocida, fechas invalidas, limites y zona invalida', () => {
        expect(calendarRequest.safeParse({ ...base, op: 'nuke', args: {} }).success).toBe(false);
        expect(calendarRequest.safeParse({ ...base, op: 'listEvents', args: { from: 'ayer', to: '2026-06-01T00:00:00Z' } }).success).toBe(false);
        expect(calendarRequest.safeParse({ ...base, op: 'listEvents', args: { from: '2026-06-01T00:00:00Z', to: '2026-06-02T00:00:00Z', limit: 201 } }).success).toBe(false);
        expect(calendarRequest.safeParse({ ...base, op: 'findFreeSlots', args: { from: '2026-06-01T00:00:00Z', to: '2026-06-02T00:00:00Z', durationMinutes: 30, timeZone: 'Mars/Base' } }).success).toBe(false);
        expect(calendarRequest.safeParse({ ...base, op: 'findFreeSlots', args: { from: '2026-06-01T00:00:00Z', to: '2026-06-02T00:00:00Z', durationMinutes: 4 } }).success).toBe(false);
        expect(calendarRequest.safeParse({ ...base, op: 'updateEvent', args: { eventId: 'e1' } }).success).toBe(false);
        expect(calendarRequest.safeParse({ ...base, op: 'addInvite', args: { eventId: 'e1', attendees: [] } }).success).toBe(false);
    });
    it('aplica los valores por defecto del contrato', () => {
        const p = calendarRequest.parse({ ...base, op: 'findFreeSlots', args: { from: '2026-06-01T00:00:00Z', to: '2026-06-02T00:00:00Z', durationMinutes: 30 } });
        expect((p as any).args).toMatchObject({ limit: 10, timeZone: 'UTC', workdayStart: '09:00', workdayEnd: '18:00', stepMinutes: 15 });
    });
});

describe('propiedad (IDOR): un recurso ajeno es inexistente', () => {
    const fx = () => makeDb({ cals: [cal(), cal({ id: 'c2', userId: 'u2', name: 'Otro' })], events: [ev(), ev({ id: 'e2', userId: 'u2', calendarId: 'c2' })] });
    it('getEvent devuelve null para un evento de otro usuario', async () => {
        const { deps } = fx();
        expect((await call(deps, { op: 'getEvent', args: { eventId: 'e2' } })).event).toBeNull();
        expect((await call(deps, { op: 'getEvent', args: { eventId: 'e1' } })).event?.id).toBe('e1');
    });
    it.each([
        ['updateEvent', { eventId: 'e2', title: 'hack' }],
        ['deleteEvent', { eventId: 'e2' }],
        ['addInvite', { eventId: 'e2', attendees: [{ email: 'a@x.test' }] }],
        ['respondInvite', { eventId: 'e2', response: 'accepted' }],
    ])('%s sobre un evento ajeno => not_found y no lo toca', async (name, args) => {
        const { deps, events } = fx();
        expect(await code(call(deps, { op: name, args }))).toBe('not_found');
        expect(events.get('e2')!.title).toBe('Standup');
        expect(events.has('e2')).toBe(true);
    });
    it('createEvent en el calendario de otro usuario => not_found', async () => {
        const { deps } = fx();
        expect(await code(call(deps, { op: 'createEvent', args: { calendarId: 'c2', title: 'x', startsAt: '2026-06-02T10:00:00Z', endsAt: '2026-06-02T11:00:00Z' } }))).toBe('not_found');
    });
    it('listEvents y findFreeSlots solo ven eventos propios', async () => {
        const { deps } = fx();
        const r = await call(deps, { op: 'listEvents', args: { from: '2026-06-01T00:00:00Z', to: '2026-06-02T00:00:00Z' } });
        expect(r.events.map((e: any) => e.id)).toEqual(['e1']);
        const ajeno = makeDb({ cals: [cal()], events: [ev({ userId: 'u2' })] });
        const s = await call(ajeno.deps, { op: 'findFreeSlots', args: { from: '2026-06-01T14:00:00Z', to: '2026-06-01T17:00:00Z', durationMinutes: 60, workdayStart: '00:00', workdayEnd: '23:59' } });
        expect(s.slots.length).toBeGreaterThan(0); // el evento ajeno no ocupa
    });
    it('listCalendars no devuelve calendarios ajenos', async () => {
        const { deps } = fx();
        expect((await call(deps, { op: 'listCalendars', args: {} })).calendars.map((c: any) => c.id)).toEqual(['c1']);
    });
});

describe('salida y escrituras', () => {
    it('nunca expone externalId ni inviteUid y usa la forma Event del contrato', async () => {
        const { deps } = makeDb({ cals: [cal()], events: [ev({ conferenceUrl: 'https://meet.example/abc' } as any)] });
        const { event } = await call(deps, { op: 'getEvent', args: { eventId: 'e1' } });
        expect(Object.keys(event).sort()).toEqual(['allDay', 'attendees', 'calendarId', 'conferenceUrl', 'description', 'endsAt', 'id', 'location', 'organizerEmail', 'responseStatus', 'source', 'startsAt', 'status', 'title']);
        expect(JSON.stringify(event)).not.toMatch(/g-secret|uid-secret|externalId|inviteUid/);
        expect(event.conferenceUrl).toBe('https://meet.example/abc');
        expect(event.startsAt).toBe('2026-06-01T15:00:00.000Z');
    });
    it('conferenceUrl no https => null', async () => {
        const { deps } = makeDb({ cals: [cal()], events: [ev({ conferenceUrl: 'javascript:alert(1)' } as any)] });
        expect((await call(deps, { op: 'getEvent', args: { eventId: 'e1' } })).event.conferenceUrl).toBeNull();
    });
    it('createEvent usa el calendario local por defecto, agrega al organizador y deduplica invitados', async () => {
        const { deps, events } = makeDb({ cals: [cal({ id: 'h', source: 'holidays', isReadOnly: true }), cal()], events: [] });
        const r = await call(deps, { op: 'createEvent', args: { title: '  Reunion\n', startsAt: '2026-06-02T10:00:00Z', endsAt: '2026-06-02T11:00:00Z', attendees: [{ email: 'Ana@X.test', name: 'Ana <b>' }, { email: 'ana@x.test' }, { email: 'me@x.test' }] } });
        expect(r.event.calendarId).toBe('c1');
        expect(r.event.title).toBe('Reunion');
        expect(r.event.attendees.map((a: any) => a.email)).toEqual(['me@x.test', 'ana@x.test']);
        expect(r.event.attendees[1].responseStatus).toBe('needsAction');
        expect([...events.values()][0].userId).toBe('u1');
    });
    it('calendario de solo lectura => read_only (crear, editar, borrar)', async () => {
        const { deps } = makeDb({ cals: [cal({ isReadOnly: true })], events: [ev()] });
        expect(await code(call(deps, { op: 'createEvent', args: { calendarId: 'c1', title: 'x', startsAt: '2026-06-02T10:00:00Z', endsAt: '2026-06-02T11:00:00Z' } }))).toBe('read_only');
        expect(await code(call(deps, { op: 'updateEvent', args: { eventId: 'e1', title: 'y' } }))).toBe('read_only');
        expect(await code(call(deps, { op: 'deleteEvent', args: { eventId: 'e1' } }))).toBe('read_only');
    });
    it('rechaza fin <= inicio, correos invalidos y rangos excesivos', async () => {
        const { deps } = makeDb({ cals: [cal()], events: [ev()] });
        expect(await code(call(deps, { op: 'createEvent', args: { title: 'x', startsAt: '2026-06-02T11:00:00Z', endsAt: '2026-06-02T10:00:00Z' } }))).toBe('invalid_args');
        expect(await code(call(deps, { op: 'createEvent', args: { title: 'x', startsAt: '2026-06-02T10:00:00Z', endsAt: '2026-06-02T11:00:00Z', attendees: [{ email: 'no-es-correo' }] } }))).toBe('invalid_args');
        expect(await code(call(deps, { op: 'updateEvent', args: { eventId: 'e1', endsAt: '2026-06-01T10:00:00Z' } }))).toBe('invalid_args');
        expect(await code(call(deps, { op: 'listEvents', args: { from: '2026-01-01T00:00:00Z', to: '2026-06-01T00:00:00Z' } }))).toBe('invalid_args');
        expect(await code(call(deps, { op: 'findFreeSlots', args: { from: '2026-01-01T00:00:00Z', to: '2026-06-01T00:00:00Z', durationMinutes: 30 } }))).toBe('invalid_args');
    });
    it('listEvents marca truncated', async () => {
        const events = [1, 2, 3].map((n) => ev({ id: `e${n}`, startsAt: new Date(`2026-06-0${n}T10:00:00Z`), endsAt: new Date(`2026-06-0${n}T11:00:00Z`) }));
        const { deps } = makeDb({ cals: [cal()], events });
        const r = await call(deps, { op: 'listEvents', args: { from: '2026-06-01T00:00:00Z', to: '2026-06-10T00:00:00Z', limit: 2 } });
        expect(r.events).toHaveLength(2);
        expect(r.truncated).toBe(true);
    });
    it('updateEvent, deleteEvent, addInvite y respondInvite sobre un evento propio', async () => {
        const { deps, events } = makeDb({ cals: [cal()], events: [ev()] });
        expect((await call(deps, { op: 'updateEvent', args: { eventId: 'e1', title: 'Nuevo', location: '' } })).event).toMatchObject({ title: 'Nuevo', location: null });
        const inv = await call(deps, { op: 'addInvite', args: { eventId: 'e1', attendees: [{ email: 'b@x.test' }, { email: 'me@x.test' }] } });
        expect(inv.event.attendees.map((a: any) => a.email)).toEqual(['me@x.test', 'b@x.test']);
        const rsvp = await call(deps, { op: 'respondInvite', args: { eventId: 'e1', response: 'tentative' } });
        expect(rsvp.event.responseStatus).toBe('tentative');
        expect(rsvp.event.attendees.find((a: any) => a.email === 'me@x.test').responseStatus).toBe('tentative');
        expect(await call(deps, { op: 'deleteEvent', args: { eventId: 'e1' } })).toEqual({ deleted: true, eventId: 'e1' });
        expect(events.size).toBe(0);
    });
});

describe('findFreeSlots (computeFreeSlots)', () => {
    const utc = (s: string) => Date.parse(s);
    const base = { durationMinutes: 60, limit: 50, timeZone: 'UTC', workdayStart: '09:00', workdayEnd: '12:00', stepMinutes: 60, busy: [] as Array<{ start: number; end: number }> };

    it('reparte la jornada en pasos y respeta la duracion', () => {
        const s = computeFreeSlots({ ...base, from: utc('2026-06-01T00:00:00Z'), to: utc('2026-06-02T00:00:00Z') });
        expect(s.map((x) => x.start)).toEqual(['2026-06-01T09:00:00.000Z', '2026-06-01T10:00:00.000Z', '2026-06-01T11:00:00.000Z']);
        expect(s[2].end).toBe('2026-06-01T12:00:00.000Z');
    });
    it('resta eventos ocupados (incluye solapes parciales y allDay)', () => {
        const busy = [{ start: utc('2026-06-01T10:30:00Z'), end: utc('2026-06-01T11:15:00Z') }];
        const s = computeFreeSlots({ ...base, stepMinutes: 15, durationMinutes: 30, from: utc('2026-06-01T00:00:00Z'), to: utc('2026-06-02T00:00:00Z'), busy });
        const starts = s.map((x) => x.start.slice(11, 16));
        expect(starts).toEqual(['09:00', '09:15', '09:30', '09:45', '10:00', '11:15', '11:30']);
        const allDay = [{ start: utc('2026-06-01T00:00:00Z'), end: utc('2026-06-02T00:00:00Z') }];
        expect(computeFreeSlots({ ...base, from: utc('2026-06-01T00:00:00Z'), to: utc('2026-06-02T00:00:00Z'), busy: allDay })).toEqual([]);
    });
    it('respeta limit y recorta a [from, to]', () => {
        expect(computeFreeSlots({ ...base, limit: 2, from: utc('2026-06-01T00:00:00Z'), to: utc('2026-06-05T00:00:00Z') })).toHaveLength(2);
        const s = computeFreeSlots({ ...base, from: utc('2026-06-01T10:30:00Z'), to: utc('2026-06-01T12:00:00Z') });
        expect(s.map((x) => x.start.slice(11, 16))).toEqual(['11:00']); // la rejilla sigue alineada a la jornada
    });
    it('calcula la jornada en la zona horaria pedida (Lima, UTC-5, sin horario de verano)', () => {
        const s = computeFreeSlots({ ...base, timeZone: 'America/Lima', from: utc('2026-06-01T00:00:00Z'), to: utc('2026-06-02T12:00:00Z') });
        expect(s[0].start).toBe('2026-06-01T14:00:00.000Z');
        expect(s[0].end).toBe('2026-06-01T15:00:00.000Z');
    });
    it('respeta el cambio de horario (Nueva York: 9:00 EST el 7-mar, 9:00 EDT el 9-mar)', () => {
        expect(new Date(zonedWallTimeToUtc(2026, 3, 7, 9, 0, 'America/New_York')).toISOString()).toBe('2026-03-07T14:00:00.000Z');
        expect(new Date(zonedWallTimeToUtc(2026, 3, 9, 9, 0, 'America/New_York')).toISOString()).toBe('2026-03-09T13:00:00.000Z');
        const s = computeFreeSlots({ ...base, limit: 50, timeZone: 'America/New_York', from: utc('2026-03-09T00:00:00Z'), to: utc('2026-03-10T00:00:00Z') });
        expect(s[0].start).toBe('2026-03-09T13:00:00.000Z');
    });
    it('jornada invalida o duracion mayor que la jornada => sin huecos', () => {
        expect(computeFreeSlots({ ...base, workdayStart: '12:00', workdayEnd: '09:00', from: utc('2026-06-01T00:00:00Z'), to: utc('2026-06-02T00:00:00Z') })).toEqual([]);
        expect(computeFreeSlots({ ...base, durationMinutes: 240, from: utc('2026-06-01T00:00:00Z'), to: utc('2026-06-02T00:00:00Z') })).toEqual([]);
    });
    it('via servicio: ignora cancelados y rechazados, pero cuenta los confirmados y allDay', async () => {
        const day = (h: number) => new Date(Date.UTC(2026, 5, 1, h));
        const { deps } = makeDb({
            cals: [cal()],
            events: [
                ev({ id: 'a', startsAt: day(9), endsAt: day(10) }),
                ev({ id: 'b', status: 'cancelled', startsAt: day(10), endsAt: day(11) }),
                ev({ id: 'c', responseStatus: 'declined', startsAt: day(11), endsAt: day(12) }),
            ],
        });
        const r = await call(deps, { op: 'findFreeSlots', args: { from: '2026-06-01T00:00:00Z', to: '2026-06-02T00:00:00Z', durationMinutes: 60, stepMinutes: 60, workdayEnd: '12:00' } });
        expect(r.timeZone).toBe('UTC');
        expect(r.slots.map((s: any) => s.start.slice(11, 16))).toEqual(['10:00', '11:00']);
    });
});
