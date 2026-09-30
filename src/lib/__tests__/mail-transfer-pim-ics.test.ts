import { describe, expect, it } from 'vitest';
import {
    buildCalendarIcs, decodeRecurrenceMarkers, encodeRecurrenceMarkers, expandRrule, expandRruleEx, ianaOffsetMs, localToUtc, parseIcsCalendar,
    resolveIana, type PimEvent,
} from '../mail-transfer/pim/ics-io';

const cal = (body: string, head = '') => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//x//y//EN\r\n${head}${body}END:VCALENDAR\r\n`;
const iso = (d: Date) => d.toISOString();

const base = (over: Partial<PimEvent> = {}): PimEvent => ({
    uid: 'e1', title: 'Evento', description: null, location: null,
    startsAt: new Date('2024-01-01T09:00:00Z'), endsAt: new Date('2024-01-01T10:00:00Z'), allDay: false, status: 'confirmed',
    organizerEmail: null, organizerName: null, attendees: [], rrule: null, recurrenceExtra: [], tzid: null, ...over,
});

describe('zonas horarias', () => {
    it('IANA con DST correcto (Europe/Madrid invierno y verano)', () => {
        const r = parseIcsCalendar(cal([
            'BEGIN:VEVENT', 'UID:a', 'DTSTART;TZID=Europe/Madrid:20240115T100000', 'DTEND;TZID=Europe/Madrid:20240115T110000', 'SUMMARY:Invierno', 'END:VEVENT',
            'BEGIN:VEVENT', 'UID:b', 'DTSTART;TZID=Europe/Madrid:20240715T100000', 'DTEND;TZID=Europe/Madrid:20240715T110000', 'SUMMARY:Verano', 'END:VEVENT',
        ].join('\r\n') + '\r\n'));
        expect(r.events.map((e) => iso(e.startsAt))).toEqual(['2024-01-15T09:00:00.000Z', '2024-07-15T08:00:00.000Z']);
        expect(r.events[0].tzid).toBe('Europe/Madrid');
        expect(r.warnings).toEqual([]);
    });

    it('cambio de hora: dia de transicion y hueco de primavera', () => {
        expect(ianaOffsetMs('Europe/Madrid', Date.UTC(2024, 2, 31, 0, 59))).toBe(3600_000);
        expect(ianaOffsetMs('Europe/Madrid', Date.UTC(2024, 2, 31, 1, 0))).toBe(7200_000);
        const off = (t: number) => ianaOffsetMs('Europe/Madrid', t);
        expect(iso(new Date(localToUtc(Date.UTC(2024, 2, 31, 1, 30), off)))).toBe('2024-03-31T00:30:00.000Z');
        expect(iso(new Date(localToUtc(Date.UTC(2024, 9, 27, 12, 0), off)))).toBe('2024-10-27T11:00:00.000Z');
        expect(iso(new Date(localToUtc(Date.UTC(2024, 2, 31, 2, 30), off)))).toBe('2024-03-31T01:30:00.000Z'); // hueco: avanza
    });

    it('Windows (Outlook) "Romance Standard Time" y nombres en minusculas', () => {
        expect(resolveIana('Romance Standard Time')).toBe('Europe/Paris');
        expect(resolveIana('pacific standard time')).toBe('America/Los_Angeles');
        expect(resolveIana('/freeassociation.sourceforge.net/Tzfile/Europe/Madrid')).toBe('Europe/Madrid');
        expect(resolveIana('Nada/Raro')).toBeNull();
        const r = parseIcsCalendar(cal('BEGIN:VEVENT\r\nUID:o\r\nDTSTART;TZID=Romance Standard Time:20240715T100000\r\nDTEND;TZID=Romance Standard Time:20240715T110000\r\nSUMMARY:O\r\nEND:VEVENT\r\n'));
        expect(iso(r.events[0].startsAt)).toBe('2024-07-15T08:00:00.000Z');
        expect(r.events[0].tzid).toBe('Europe/Paris');
    });

    it('TZID desconocido sin VTIMEZONE: UTC + warning', () => {
        const r = parseIcsCalendar(cal('BEGIN:VEVENT\r\nUID:u\r\nDTSTART;TZID=Marte/Olimpo:20240715T100000\r\nSUMMARY:M\r\nEND:VEVENT\r\n'));
        expect(iso(r.events[0].startsAt)).toBe('2024-07-15T10:00:00.000Z');
        expect(r.warnings).toEqual(['tzid_desconocido:Marte/Olimpo']);
    });

    it('VTIMEZONE propio (nombre no IANA) con reglas STANDARD/DAYLIGHT', () => {
        const vtz = [
            'BEGIN:VTIMEZONE', 'TZID:(UTC+01:00) Hora Custom', 'BEGIN:DAYLIGHT', 'DTSTART:19700329T020000', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200',
            'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT', 'BEGIN:STANDARD', 'DTSTART:19701025T030000', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100',
            'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD', 'END:VTIMEZONE',
        ].join('\r\n') + '\r\n';
        const ev = (d: string) => `BEGIN:VEVENT\r\nUID:${d}\r\nDTSTART;TZID="(UTC+01:00) Hora Custom":${d}T100000\r\nSUMMARY:x\r\nEND:VEVENT\r\n`;
        const r = parseIcsCalendar(cal(vtz + ev('20240115') + ev('20240715') + ev('20240330') + ev('20240331') + ev('20241027')));
        expect(r.warnings).toEqual([]);
        expect(r.events.map((e) => iso(e.startsAt))).toEqual([
            '2024-01-15T09:00:00.000Z', '2024-07-15T08:00:00.000Z', '2024-03-30T09:00:00.000Z', '2024-03-31T08:00:00.000Z', '2024-10-27T09:00:00.000Z',
        ]);
        expect(r.events[0].tzid).toBe('(UTC+01:00) Hora Custom');
        // sin IANA no se puede expandir con DST: se conserva como texto
        expect(expandRrule({ ...r.events[0], rrule: 'FREQ=DAILY;COUNT=2' })).toBeNull();
    });

    it('VTIMEZONE con X-LIC-LOCATION usa Intl', () => {
        const vtz = 'BEGIN:VTIMEZONE\r\nTZID:Custom\r\nX-LIC-LOCATION:America/New_York\r\nEND:VTIMEZONE\r\n';
        const r = parseIcsCalendar(cal(vtz + 'BEGIN:VEVENT\r\nUID:n\r\nDTSTART;TZID=Custom:20240715T100000\r\nSUMMARY:x\r\nEND:VEVENT\r\n'));
        expect(iso(r.events[0].startsAt)).toBe('2024-07-15T14:00:00.000Z');
        expect(r.events[0].tzid).toBe('America/New_York');
    });

    it('UTC (Z), flotante (con X-WR-TIMEZONE y sin ella) y DATE', () => {
        const ev = (l: string) => `BEGIN:VEVENT\r\nUID:${l.slice(0, 12)}\r\n${l}\r\nSUMMARY:x\r\nEND:VEVENT\r\n`;
        const a = parseIcsCalendar(cal(ev('DTSTART:20240715T100000Z')));
        expect(iso(a.events[0].startsAt)).toBe('2024-07-15T10:00:00.000Z');
        const b = parseIcsCalendar(cal(ev('DTSTART:20240715T100000')));
        expect(iso(b.events[0].startsAt)).toBe('2024-07-15T10:00:00.000Z');
        const c = parseIcsCalendar(cal(ev('DTSTART:20240715T100000'), 'X-WR-TIMEZONE:Europe/Madrid\r\n'));
        expect(iso(c.events[0].startsAt)).toBe('2024-07-15T08:00:00.000Z');
        const d = parseIcsCalendar(cal(ev('DTSTART:20240715T100000')), { defaultTimeZone: 'America/Mexico_City' });
        expect(iso(d.events[0].startsAt)).toBe('2024-07-15T16:00:00.000Z');
        const e = parseIcsCalendar(cal(ev('DTSTART;VALUE=DATE:20240715')));
        expect(e.events[0]).toMatchObject({ allDay: true, tzid: null });
        expect(iso(e.events[0].startsAt)).toBe('2024-07-15T00:00:00.000Z');
        expect(iso(e.events[0].endsAt)).toBe('2024-07-16T00:00:00.000Z');
    });
});

describe('parseIcsCalendar', () => {
    const GOOGLE = [
        'BEGIN:VCALENDAR', 'PRODID:-//Google Inc//Google Calendar 70.9054//EN', 'VERSION:2.0', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Trabajo, equipo', 'X-WR-TIMEZONE:Europe/Madrid',
        'BEGIN:VEVENT', 'DTSTART;TZID=Europe/Madrid:20240102T100000', 'DTEND;TZID=Europe/Madrid:20240102T110000', 'RRULE:FREQ=WEEKLY;UNTIL=20240301T085959Z;BYDAY=TU',
        'EXDATE;TZID=Europe/Madrid:20240109T100000', 'DTSTAMP:20240101T000000Z', 'UID:weekly1@google.com',
        'ORGANIZER;CN=Ana García:mailto:ana@example.test', 'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Ana García;X-NUM-GUESTS=0:mailto:ana@example.test',
        'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;CN=Luis;X-NUM-GUESTS=0:mailto:luis@example.test',
        'DESCRIPTION:Reunion semanal\\nTraer informe\\, por favor', 'LOCATION:Sala 1\\, planta 2', 'STATUS:CONFIRMED', 'SUMMARY:Standup',
        'X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij', 'END:VEVENT',
        'BEGIN:VEVENT', 'DTSTART;TZID=Europe/Madrid:20240116T120000', 'DTEND;TZID=Europe/Madrid:20240116T130000', 'RECURRENCE-ID;TZID=Europe/Madrid:20240116T100000',
        'UID:weekly1@google.com', 'SUMMARY:Standup (movido)', 'STATUS:TENTATIVE', 'END:VEVENT', 'END:VCALENDAR', '',
    ].join('\r\n');

    it('Google: nombre, recurrencia normalizada, EXDATE en UTC, asistentes, conferencia, excepcion', () => {
        const r = parseIcsCalendar(GOOGLE);
        expect(r.invalid).toBe(0);
        expect(r.calendarName).toBe('Trabajo, equipo');
        expect(r.events).toHaveLength(2);
        const [m, x] = r.events;
        expect(m).toMatchObject({
            uid: 'weekly1@google.com', title: 'Standup', description: 'Reunion semanal\nTraer informe, por favor', location: 'Sala 1, planta 2',
            allDay: false, status: 'confirmed', organizerEmail: 'ana@example.test', organizerName: 'Ana García', tzid: 'Europe/Madrid',
            rrule: 'FREQ=WEEKLY;UNTIL=20240301T085959Z;BYDAY=TU', recurrenceExtra: ['EXDATE:20240109T090000Z'],
            conferenceUrl: 'https://meet.google.com/abc-defg-hij',
        });
        expect(m.attendees).toEqual([
            { email: 'ana@example.test', name: 'Ana García', responseStatus: 'accepted', isOrganizer: true },
            { email: 'luis@example.test', name: 'Luis', responseStatus: 'needsAction', isOrganizer: false },
        ]);
        expect(m.recurrenceId ?? null).toBeNull();
        expect(x.status).toBe('tentative');
        expect(iso(x.recurrenceId!)).toBe('2024-01-16T09:00:00.000Z');
        expect(iso(x.startsAt)).toBe('2024-01-16T11:00:00.000Z');
    });

    it('DURATION en vez de DTEND, dia completo multi-dia y pliegue de lineas', () => {
        const r = parseIcsCalendar(cal([
            'BEGIN:VEVENT', 'UID:d1', 'DTSTART:20240301T100000Z', 'DURATION:PT1H30M', 'SUMMARY:Titulo muy largo que se',
            '  pliega en varias lineas', 'END:VEVENT',
            'BEGIN:VEVENT', 'UID:d2', 'DTSTART;VALUE=DATE:20240301', 'DTEND;VALUE=DATE:20240304', 'SUMMARY:Viaje', 'END:VEVENT',
            'BEGIN:VEVENT', 'UID:d3', 'DTSTART;VALUE=DATE:20240301', 'DURATION:P2D', 'SUMMARY:Dos dias', 'END:VEVENT',
            'BEGIN:VEVENT', 'UID:d4', 'DTSTART:20240301T100000Z', 'DURATION:P1W', 'SUMMARY:Semana', 'END:VEVENT',
        ].join('\r\n') + '\r\n'));
        expect(iso(r.events[0].endsAt)).toBe('2024-03-01T11:30:00.000Z');
        expect(r.events[0].title).toBe('Titulo muy largo que se pliega en varias lineas');
        expect(iso(r.events[1].endsAt)).toBe('2024-03-04T00:00:00.000Z');
        expect(iso(r.events[2].endsAt)).toBe('2024-03-03T00:00:00.000Z');
        expect(iso(r.events[3].endsAt)).toBe('2024-03-08T10:00:00.000Z');
    });

    it('Apple/Outlook: CANCELLED, sin UID (UID estable), acepta LF, BOM y Buffer', () => {
        const txt = '﻿BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nDTSTART:20240301T100000Z\nSUMMARY:Sin uid\nSTATUS:CANCELLED\nEND:VEVENT\nEND:VCALENDAR\n';
        const a = parseIcsCalendar(txt);
        const b = parseIcsCalendar(Buffer.from(txt));
        expect(a.events[0].status).toBe('cancelled');
        expect(a.events[0].uid).toMatch(/^[0-9a-f]{24}@import\.local$/);
        expect(b.events[0].uid).toBe(a.events[0].uid);
        expect(a.calendarName).toBeNull();
    });

    it('conserva RDATE, EXDATE de dia completo y descarta PERIOD', () => {
        const r = parseIcsCalendar(cal([
            'BEGIN:VEVENT', 'UID:r', 'DTSTART;VALUE=DATE:20240301', 'RRULE:FREQ=DAILY;COUNT=5', 'EXDATE;VALUE=DATE:20240302,20240303', 'RDATE;VALUE=DATE:20240310',
            'RDATE;VALUE=PERIOD:20240311T000000Z/PT1H', 'SUMMARY:x', 'END:VEVENT',
        ].join('\r\n') + '\r\n'));
        expect(r.events[0].recurrenceExtra).toEqual(['EXDATE;VALUE=DATE:20240302,20240303', 'RDATE;VALUE=DATE:20240310']);
        expect(r.warnings).toContain('rdate_periodo_omitido');
    });

    it('UNTIL local/fecha se normaliza a UTC', () => {
        const mk = (rr: string) => parseIcsCalendar(cal(`BEGIN:VEVENT\r\nUID:u\r\nDTSTART;TZID=Europe/Madrid:20240102T100000\r\nRRULE:${rr}\r\nSUMMARY:x\r\nEND:VEVENT\r\n`)).events[0].rrule;
        expect(mk('FREQ=DAILY;UNTIL=20240110T100000')).toBe('FREQ=DAILY;UNTIL=20240110T090000Z');
        expect(mk('freq=daily;until=20240110')).toBe('FREQ=DAILY;UNTIL=20240110T225959Z');
        expect(mk('BYDAY=MO')).toBeNull();
    });

    it('invalidos: sin DTSTART, fecha imposible; nunca lanza con basura', () => {
        const r = parseIcsCalendar(cal([
            'BEGIN:VEVENT', 'UID:x', 'SUMMARY:sin fecha', 'END:VEVENT',
            'BEGIN:VEVENT', 'UID:y', 'DTSTART:20240231T100000Z', 'SUMMARY:feb 31', 'END:VEVENT',
            'BEGIN:VEVENT', 'UID:z', 'DTSTART:20240301T100000Z', 'SUMMARY:ok', 'END:VEVENT',
            'BEGIN:VTODO', 'SUMMARY:tarea', 'END:VTODO',
        ].join('\r\n') + '\r\n'));
        expect(r.events).toHaveLength(1);
        expect(r.invalid).toBe(2);
        for (const junk of ['', 'hola', '\0\0\0', 'BEGIN:VEVENT\nDTSTART:zzz', 'END:VEVENT\nEND:VCALENDAR', 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nBEGIN:VEVENT\nEND:VCALENDAR']) {
            expect(() => parseIcsCalendar(junk)).not.toThrow();
        }
        expect(() => parseIcsCalendar(Buffer.from([0xff, 0xd8, 0x00, 0xc3]))).not.toThrow();
    });

    it('limites: eventos, asistentes, longitudes, bytes', () => {
        const ev = (i: number, att = 0) => `BEGIN:VEVENT\r\nUID:e${i}\r\nDTSTART:20240301T100000Z\r\nSUMMARY:${'t'.repeat(2000)}\r\n`
            + Array.from({ length: att }, (_, k) => `ATTENDEE:mailto:a${k}@example.test\r\n`).join('') + 'END:VEVENT\r\n';
        const r = parseIcsCalendar(cal(ev(1, 30) + ev(2) + ev(3)), { maxEvents: 2, maxAttendees: 5, maxTitle: 50 });
        expect(r.events).toHaveLength(2);
        expect(r.truncated).toBe(true);
        expect(r.events[0].attendees).toHaveLength(5);
        expect(r.events[0].title).toHaveLength(50);
        const cut = parseIcsCalendar(cal(ev(1) + ev(2) + ev(3)), { maxBytes: 5000 });
        expect(cut.truncated).toBe(true);
        expect(cut.events.length).toBeLessThan(3);
    });
});

describe('expandRrule', () => {
    const days = (ev: Partial<PimEvent>, opts?: Parameters<typeof expandRrule>[1]) => expandRrule(base(ev), opts)!.map((d) => d.toISOString().slice(0, 10));

    it('DAILY con INTERVAL y COUNT', () => {
        expect(days({ rrule: 'FREQ=DAILY;INTERVAL=2;COUNT=4' })).toEqual(['2024-01-01', '2024-01-03', '2024-01-05', '2024-01-07']);
    });

    it('WEEKLY con BYDAY, UNTIL inclusivo y EXDATE', () => {
        const r = days({ rrule: 'FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20240117T090000Z', recurrenceExtra: ['EXDATE:20240103T090000Z'] });
        expect(r).toEqual(['2024-01-01', '2024-01-08', '2024-01-10', '2024-01-15', '2024-01-17']);
    });

    it('WEEKLY INTERVAL=2 respeta WKST', () => {
        // 2024-01-07 es domingo. Con WKST=MO la semana del domingo es la del lunes 01; con WKST=SU empieza el 07.
        const sun = base({ startsAt: new Date('2024-01-07T09:00:00Z'), endsAt: new Date('2024-01-07T10:00:00Z'), rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO;COUNT=4;WKST=MO' });
        expect(expandRrule(sun)!.map((d) => d.toISOString().slice(0, 10))).toEqual(['2024-01-07', '2024-01-15', '2024-01-21', '2024-01-29']);
        const sun2 = { ...sun, rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO;COUNT=4;WKST=SU' };
        expect(expandRrule(sun2)!.map((d) => d.toISOString().slice(0, 10))).toEqual(['2024-01-07', '2024-01-08', '2024-01-21', '2024-01-22']);
    });

    it('MONTHLY: dia del mes, ultimo dia (-1), 31 salta meses cortos', () => {
        expect(days({ startsAt: new Date('2024-01-31T09:00:00Z'), rrule: 'FREQ=MONTHLY;COUNT=4' })).toEqual(['2024-01-31', '2024-03-31', '2024-05-31', '2024-07-31']);
        expect(days({ rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3' })).toEqual(['2024-01-01', '2024-01-31', '2024-02-29', '2024-03-31'].slice(0, 4));
        expect(days({ startsAt: new Date('2024-01-15T09:00:00Z'), rrule: 'FREQ=MONTHLY;BYMONTHDAY=1,15;COUNT=4' })).toEqual(['2024-01-15', '2024-02-01', '2024-02-15', '2024-03-01']);
    });

    it('MONTHLY con ordinal: 2MO, -1FR y BYSETPOS ultimo laborable', () => {
        expect(days({ rrule: 'FREQ=MONTHLY;BYDAY=2MO;COUNT=3' })).toEqual(['2024-01-01', '2024-01-08', '2024-02-12', '2024-03-11']);
        expect(days({ startsAt: new Date('2024-01-26T09:00:00Z'), rrule: 'FREQ=MONTHLY;BYDAY=-1FR;COUNT=3' })).toEqual(['2024-01-26', '2024-02-23', '2024-03-29']);
        expect(days({ startsAt: new Date('2024-01-31T09:00:00Z'), rrule: 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=3' })).toEqual(['2024-01-31', '2024-02-29', '2024-03-29']);
    });

    it('YEARLY: fecha, BYMONTH+BYDAY ordinal y 29 de febrero', () => {
        expect(days({ rrule: 'FREQ=YEARLY;COUNT=3' })).toEqual(['2024-01-01', '2025-01-01', '2026-01-01']);
        expect(days({ startsAt: new Date('2024-11-28T09:00:00Z'), rrule: 'FREQ=YEARLY;BYMONTH=11;BYDAY=4TH;COUNT=3' })).toEqual(['2024-11-28', '2025-11-27', '2026-11-26']);
        expect(days({ startsAt: new Date('2024-02-29T09:00:00Z'), rrule: 'FREQ=YEARLY;COUNT=3' }, { horizonYears: 10 })).toEqual(['2024-02-29', '2028-02-29', '2032-02-29']);
        expect(days({ rrule: 'FREQ=YEARLY;BYMONTH=1,6;COUNT=4' })).toEqual(['2024-01-01', '2024-06-01', '2025-01-01', '2025-06-01']);
    });

    it('hora local estable a traves del DST con TZID', () => {
        const ev = base({ startsAt: new Date('2024-03-26T09:00:00Z'), endsAt: new Date('2024-03-26T10:00:00Z'), tzid: 'Europe/Madrid', rrule: 'FREQ=WEEKLY;COUNT=3' });
        // 10:00 Madrid (CET) -> tras el 31/03 son las 08:00Z (CEST)
        expect(expandRrule(ev)!.map(iso)).toEqual(['2024-03-26T09:00:00.000Z', '2024-04-02T08:00:00.000Z', '2024-04-09T08:00:00.000Z']);
    });

    it('dia completo con EXDATE de fecha y RDATE', () => {
        const ev = base({ allDay: true, startsAt: new Date('2024-03-01T00:00:00Z'), endsAt: new Date('2024-03-02T00:00:00Z'), rrule: 'FREQ=DAILY;COUNT=4', recurrenceExtra: ['EXDATE;VALUE=DATE:20240302', 'RDATE;VALUE=DATE:20240310'] });
        expect(expandRrule(ev)!.map(iso)).toEqual(['2024-03-01T00:00:00.000Z', '2024-03-03T00:00:00.000Z', '2024-03-04T00:00:00.000Z', '2024-03-10T00:00:00.000Z']);
    });

    it('tope de ocurrencias y horizonte con bandera truncated', () => {
        const r = expandRruleEx(base({ rrule: 'FREQ=DAILY' }), { maxOccurrences: 10 })!;
        expect(r.dates).toHaveLength(10);
        expect(r.truncated).toBe(true);
        const h = expandRruleEx(base({ rrule: 'FREQ=WEEKLY' }), { maxOccurrences: 5000, horizonYears: 1 })!;
        expect(h.dates.length).toBeGreaterThanOrEqual(52);
        expect(h.dates.length).toBeLessThanOrEqual(54);
        expect(h.truncated).toBe(true);
        const c = expandRruleEx(base({ rrule: 'FREQ=DAILY;COUNT=3' }))!;
        expect(c.truncated).toBe(false);
    });

    it('sin RRULE devuelve solo el inicio; reglas no soportadas devuelven null', () => {
        expect(days({})).toEqual(['2024-01-01']);
        for (const rr of ['FREQ=HOURLY;COUNT=3', 'FREQ=MINUTELY', 'FREQ=YEARLY;BYYEARDAY=100', 'FREQ=YEARLY;BYWEEKNO=20', 'FREQ=DAILY;BYHOUR=9,10', 'FREQ=WEEKLY;BYDAY=2MO',
            'FREQ=YEARLY;BYDAY=2MO', 'FREQ=MONTHLY;COUNT=2;UNTIL=20250101', 'BASURA', 'FREQ=DAILY;INTERVAL=0', 'FREQ=MONTHLY;BYDAY=XX', 'RSCALE=HEBREW;FREQ=YEARLY', 'FREQ=DAILY;BYMONTHDAY=3']) {
            expect(expandRrule(base({ rrule: rr })), rr).toBeNull();
        }
        expect(expandRrule(base({ rrule: 'FREQ=DAILY;COUNT=2', tzid: 'Zona/Rara' }))).toBeNull();
    });
});

describe('marcadores de recurrencia', () => {
    it('round-trip y separacion de la descripcion visible', () => {
        const enc = encodeRecurrenceMarkers('Hola\nmundo', { rrule: 'FREQ=DAILY;COUNT=3', recurrenceExtra: ['EXDATE:20240102T090000Z'], tzid: 'Europe/Madrid', expandedUntil: '2024-01-03T09:00:00.000Z' });
        expect(enc).toBe('Hola\nmundo\n[bloomx:rrule] FREQ=DAILY;COUNT=3\n[bloomx:recur-extra] EXDATE:20240102T090000Z\n[bloomx:tz] Europe/Madrid\n[bloomx:expanded] 2024-01-03T09:00:00.000Z');
        expect(decodeRecurrenceMarkers(enc)).toEqual({ description: 'Hola\nmundo', rrule: 'FREQ=DAILY;COUNT=3', recurrenceExtra: ['EXDATE:20240102T090000Z'], tzid: 'Europe/Madrid', expandedUntil: '2024-01-03T09:00:00.000Z' });
        expect(encodeRecurrenceMarkers(null, { rrule: null, recurrenceExtra: [], tzid: null })).toBeNull();
        expect(decodeRecurrenceMarkers(null)).toEqual({ description: null, rrule: null, recurrenceExtra: [], tzid: null, expandedUntil: null });
        expect(decodeRecurrenceMarkers('solo texto')).toMatchObject({ description: 'solo texto', rrule: null });
    });
});

describe('buildCalendarIcs', () => {
    const now = new Date('2024-06-01T00:00:00Z');

    it('genera VCALENDAR valido: CRLF, pliegue, escapes, atendees y conferencia', () => {
        const out = buildCalendarIcs([base({
            title: 'Reunion, con; caracteres', description: 'l1\nl2 ' + 'x'.repeat(200), location: 'Sala 1', organizerEmail: 'ana@example.test', organizerName: 'Ana',
            attendees: [{ email: 'luis@example.test', name: 'Luis "El" Jefe', responseStatus: 'accepted', isOrganizer: false }, { email: 'no-email', name: null, responseStatus: null, isOrganizer: false }],
            conferenceUrl: 'https://meet.google.com/abc-defg-hij', status: 'tentative',
        })], 'Mi cal', { now });
        expect(out.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
        expect(out.endsWith('END:VCALENDAR\r\n')).toBe(true);
        expect(out).not.toMatch(/[^\r]\n/);
        for (const l of out.split('\r\n')) expect(Buffer.byteLength(l)).toBeLessThanOrEqual(75);
        expect(out).toContain('X-WR-CALNAME:Mi cal');
        expect(out).toContain('STATUS:TENTATIVE');
        expect(out).not.toContain('no-email');
        const back = parseIcsCalendar(out);
        expect(back.calendarName).toBe('Mi cal');
        expect(back.events[0]).toMatchObject({
            title: 'Reunion, con; caracteres', status: 'tentative', organizerEmail: 'ana@example.test', conferenceUrl: 'https://meet.google.com/abc-defg-hij',
        });
        expect(back.events[0].description).toBe('l1\nl2 ' + 'x'.repeat(200));
        expect(back.events[0].attendees).toEqual([{ email: 'luis@example.test', name: "Luis 'El' Jefe", responseStatus: 'accepted', isOrganizer: false }]);
    });

    it('round-trip de una serie con zona, EXDATE y excepcion; la expansion coincide', () => {
        const master = base({
            uid: 'serie', startsAt: new Date('2024-03-26T09:00:00Z'), endsAt: new Date('2024-03-26T10:00:00Z'), tzid: 'Europe/Madrid',
            rrule: 'FREQ=WEEKLY;COUNT=4', recurrenceExtra: ['EXDATE:20240402T080000Z'],
        });
        const exc = base({ uid: 'serie', title: 'Movido', startsAt: new Date('2024-04-09T10:00:00Z'), endsAt: new Date('2024-04-09T11:00:00Z'), recurrenceId: new Date('2024-04-09T08:00:00Z') });
        const out = buildCalendarIcs([master, exc], 'S', { now });
        expect(out).toContain('DTSTART;TZID=Europe/Madrid:20240326T100000');
        expect(out).toContain('RRULE:FREQ=WEEKLY;COUNT=4');
        const back = parseIcsCalendar(out);
        expect(back.warnings).toEqual([]);
        expect(back.events).toHaveLength(2);
        expect(back.events[0]).toMatchObject({ rrule: 'FREQ=WEEKLY;COUNT=4', tzid: 'Europe/Madrid', recurrenceExtra: ['EXDATE:20240402T080000Z'] });
        expect(iso(back.events[0].startsAt)).toBe(iso(master.startsAt));
        expect(expandRrule(back.events[0])!.map(iso)).toEqual(expandRrule(master)!.map(iso));
        expect(iso(back.events[1].recurrenceId!)).toBe('2024-04-09T08:00:00.000Z');
        expect(back.events[1].title).toBe('Movido');
    });

    it('dia completo y sanea inyecciones', () => {
        const out = buildCalendarIcs([base({
            allDay: true, startsAt: new Date('2024-03-01T00:00:00Z'), endsAt: new Date('2024-03-03T00:00:00Z'), title: 'X\r\nATTENDEE:mailto:evil@example.test',
            location: 'L\nEND:VEVENT', rrule: 'FREQ=DAILY\r\nATTENDEE:mailto:e@e.test', uid: 'a b\r\nc',
        })], 'n\r\nX-EVIL:1', { now });
        expect(out).toContain('DTSTART;VALUE=DATE:20240301');
        expect(out).toContain('DTEND;VALUE=DATE:20240303');
        const back = parseIcsCalendar(out);
        expect(back.events).toHaveLength(1);
        expect(back.events[0].attendees).toEqual([]);
        expect(back.events[0].rrule).toBeNull();
        expect(out.split('\r\n').filter((l) => l.startsWith('X-EVIL'))).toEqual([]);
    });

    it('lista vacia da un calendario valido', () => {
        const back = parseIcsCalendar(buildCalendarIcs([], 'Vacio', { now }));
        expect(back).toMatchObject({ events: [], invalid: 0, calendarName: 'Vacio' });
    });
});
