import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLocalPg, createUser } from './helpers/pg';
import { prisma } from '../prisma';
import {
    exportCalendarIcs, exportContactsVcf, exportFiltersXml, exportFiltersXmlWithReport, importContacts, importEvents, importFilters,
    parseGmailFilters, parseIcsCalendar, parseVcf, decodeContactNotes, type PimContact,
} from '../mail-transfer/pim';
import { evaluateRules, type RuleEmail } from '../rules/engine';
import { loadRules, MAX_RULES_PER_USER } from '../rules/store';

const tag = `t${Math.random().toString(36).slice(2, 8)}`;
const addr = (n: string) => `${n}.${tag}@example.test`;

beforeAll(() => { assertLocalPg(); });
afterAll(async () => { await prisma.$disconnect(); });

const mk = (over: Partial<PimContact>): PimContact => ({
    uid: null, name: null, emails: [], phones: [], org: null, title: null, notes: null, addresses: [], birthday: null, urls: [], ...over,
});

describe('contactos', () => {
    it('importa, dedupe por correo en minusculas sin sobrescribir, notas con etiquetas y aislamiento', async () => {
        const a = await createUser(prisma, addr('ca'));
        const b = await createUser(prisma, addr('cb'));
        // contacto previo del usuario: NO se sobrescribe
        await prisma.contact.create({ data: { userId: a.id, email: addr('previo'), name: 'Nombre del usuario', notes: 'mis notas', source: 'local' } });

        const contacts = [
            mk({ uid: 'u1', name: 'Ana', emails: [addr('ana'), addr('ana2').toUpperCase()], phones: ['+34 600'], org: 'Acme', title: 'CEO', notes: 'Nota libre', addresses: ['Calle 1'], birthday: '1990-05-17', urls: ['https://a.test'] }),
            mk({ name: 'Previo', emails: [addr('previo')], phones: ['1'] }),
            mk({ name: 'Solo telefono', phones: ['123'] }),
            mk({ name: 'Repetido en el lote', emails: [addr('ana')] }),
        ];
        const r1 = await importContacts(a.id, contacts);
        expect(r1).toMatchObject({ created: 2, existing: 2, invalid: 1, noEmail: 1, limited: 0 });

        const rows = await prisma.contact.findMany({ where: { userId: a.id }, orderBy: { email: 'asc' } });
        expect(rows.map((x) => x.email)).toEqual([addr('ana'), addr('ana2'), addr('previo')].sort());
        const ana = rows.find((x) => x.email === addr('ana'))!;
        expect(ana).toMatchObject({ name: 'Ana', source: 'import', externalId: 'u1' });
        expect(ana.notes).toBe('Nota libre\n\nTeléfono: +34 600\nOrganización: Acme\nCargo: CEO\nDirección: Calle 1\nCumpleaños: 1990-05-17\nWeb: https://a.test');
        expect(decodeContactNotes(ana.notes)).toEqual({ notes: 'Nota libre', phones: ['+34 600'], org: 'Acme', title: 'CEO', addresses: ['Calle 1'], birthday: '1990-05-17', urls: ['https://a.test'] });
        const previo = rows.find((x) => x.email === addr('previo'))!;
        expect(previo).toMatchObject({ name: 'Nombre del usuario', notes: 'mis notas', source: 'local' });

        // reimportacion: nada nuevo
        const r2 = await importContacts(a.id, contacts);
        expect(r2).toMatchObject({ created: 0, invalid: 1 });
        expect(await prisma.contact.count({ where: { userId: a.id } })).toBe(3);
        // aislamiento
        expect(await prisma.contact.count({ where: { userId: b.id } })).toBe(0);
        const rb = await importContacts(b.id, [mk({ name: 'Ana B', emails: [addr('ana')] })]);
        expect(rb.created).toBe(1);
        expect((await prisma.contact.findFirst({ where: { userId: a.id, email: addr('ana') } }))!.name).toBe('Ana');
    });

    it('tope por buzon', async () => {
        const u = await createUser(prisma, addr('cl'));
        const many = Array.from({ length: 7 }, (_, i) => mk({ name: `C${i}`, emails: [`c${i}.${tag}@example.test`] }));
        const r = await importContacts(u.id, many, { maxContacts: 5 });
        expect(r).toMatchObject({ created: 5, limited: 2 });
        const again = await importContacts(u.id, many, { maxContacts: 5 });
        expect(again).toMatchObject({ created: 0, existing: 5, limited: 2 });
        expect(await prisma.contact.count({ where: { userId: u.id } })).toBe(5);
    });

    it('export -> import a otro usuario: agrupa correos de una persona y conserva los datos', async () => {
        const a = await createUser(prisma, addr('cx'));
        const b = await createUser(prisma, addr('cy'));
        expect(await exportContactsVcf(a.id)).toBeNull();
        await importContacts(a.id, [
            mk({ uid: 'p-1', name: 'María Pérez', emails: [addr('m1'), addr('m2')], phones: ['+34 611', '+34 622'], org: 'Acme, S.L.', title: 'CTO', notes: 'linea1\nlinea2', addresses: ['Sol 1, Madrid'], birthday: '--07-04', urls: ['https://m.test'] }),
            mk({ name: 'Sin uid', emails: [addr('s1')] }),
        ]);
        const buf = (await exportContactsVcf(a.id))!;
        const parsed = parseVcf(buf);
        expect(parsed.invalid).toBe(0);
        expect(parsed.contacts).toHaveLength(2);
        const maria = parsed.contacts.find((c) => c.uid === 'p-1')!;
        expect(maria).toEqual(mk({
            uid: 'p-1', name: 'María Pérez', emails: [addr('m1'), addr('m2')], phones: ['+34 611', '+34 622'], org: 'Acme, S.L.', title: 'CTO', notes: 'linea1\nlinea2',
            addresses: ['Sol 1, Madrid'], birthday: '--07-04', urls: ['https://m.test'],
        }));
        expect(parsed.contacts.find((c) => c.name === 'Sin uid')!.uid).toBeNull();

        const r = await importContacts(b.id, parsed.contacts);
        expect(r).toMatchObject({ created: 3, existing: 0, invalid: 0 });
        const buf2 = (await exportContactsVcf(b.id))!;
        expect(parseVcf(buf2).contacts.map((c) => [c.name, c.emails, c.phones, c.org]).sort()).toEqual(parsed.contacts.map((c) => [c.name, c.emails, c.phones, c.org]).sort());
    });
});

const ICS = (uidPrefix: string) => [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//t//t//EN', 'X-WR-CALNAME:Trabajo', 'X-WR-TIMEZONE:Europe/Madrid',
    'BEGIN:VEVENT', `UID:${uidPrefix}-single`, 'DTSTART;TZID=Europe/Madrid:20240115T100000', 'DTEND;TZID=Europe/Madrid:20240115T110000', 'SUMMARY:Reunion unica',
    'DESCRIPTION:Texto\\nmultilinea', 'LOCATION:Sala 1', 'ORGANIZER;CN=Ana:mailto:ana@example.test',
    'ATTENDEE;CN=Ana;PARTSTAT=ACCEPTED:mailto:ana@example.test', 'ATTENDEE;CN=Luis;PARTSTAT=TENTATIVE:mailto:luis@example.test', 'END:VEVENT',
    'BEGIN:VEVENT', `UID:${uidPrefix}-serie`, 'DTSTART;TZID=Europe/Madrid:20240326T100000', 'DTEND;TZID=Europe/Madrid:20240326T110000', 'RRULE:FREQ=WEEKLY;COUNT=5',
    'EXDATE;TZID=Europe/Madrid:20240409T100000', 'SUMMARY:Standup', 'DESCRIPTION:Diario', 'END:VEVENT',
    'BEGIN:VEVENT', `UID:${uidPrefix}-serie`, 'RECURRENCE-ID;TZID=Europe/Madrid:20240416T100000', 'DTSTART;TZID=Europe/Madrid:20240416T120000', 'DTEND;TZID=Europe/Madrid:20240416T130000',
    'SUMMARY:Standup (movido)', 'END:VEVENT',
    'BEGIN:VEVENT', `UID:${uidPrefix}-dia`, 'DTSTART;VALUE=DATE:20240501', 'DTEND;VALUE=DATE:20240503', 'SUMMARY:Viaje', 'END:VEVENT',
    'END:VCALENDAR', '',
].join('\r\n');

describe('calendario', () => {
    it('importa eventos, series (marcador + ocurrencias), excepciones; reimportar no duplica; aislado por usuario', async () => {
        const a = await createUser(prisma, addr('ea'));
        const b = await createUser(prisma, addr('eb'));
        const parsed = parseIcsCalendar(ICS(tag));
        expect(parsed.events).toHaveLength(4);

        const r1 = await importEvents(a.id, parsed.events, { calendarName: parsed.calendarName ?? undefined });
        // serie: 5 ocurrencias - 1 EXDATE = 4; una (16/04) es excepcion => maestro + 2 expandidas + 1 excepcion
        expect(r1).toMatchObject({ created: 4, existing: 0, invalid: 0, expandedFromRrule: 2, unexpandedRrule: 0, limited: 0 });
        const cal = await prisma.calendar.findMany({ where: { userId: a.id } });
        expect(cal).toHaveLength(1);
        expect(cal[0]).toMatchObject({ name: 'Trabajo', source: 'import' });

        const evs = await prisma.calendarEvent.findMany({ where: { userId: a.id }, include: { attendees: true }, orderBy: { startsAt: 'asc' } });
        expect(evs).toHaveLength(6);
        const single = evs.find((e) => e.inviteUid === `${tag}-single`)!;
        expect(single).toMatchObject({ title: 'Reunion unica', description: 'Texto\nmultilinea', location: 'Sala 1', organizerEmail: 'ana@example.test', source: 'import', externalId: `${tag}-single` });
        expect(single.startsAt.toISOString()).toBe('2024-01-15T09:00:00.000Z');
        expect(single.attendees.map((x) => [x.email, x.responseStatus, x.isOrganizer]).sort()).toEqual([['ana@example.test', 'accepted', true], ['luis@example.test', 'tentative', false]]);
        const master = evs.find((e) => e.inviteUid === `${tag}-serie`)!;
        expect(master.description).toBe('Diario\n[bloomx:rrule] FREQ=WEEKLY;COUNT=5\n[bloomx:recur-extra] EXDATE:20240409T080000Z\n[bloomx:tz] Europe/Madrid\n[bloomx:expanded] 2024-04-23T08:00:00.000Z');
        const occ = evs.filter((e) => e.externalId?.startsWith(`${tag}-serie#`));
        expect(occ.map((o) => [o.startsAt.toISOString(), o.title, o.inviteUid, o.description])).toEqual([
            ['2024-04-02T08:00:00.000Z', 'Standup', null, 'Diario'],
            ['2024-04-16T10:00:00.000Z', 'Standup (movido)', null, null],
            ['2024-04-23T08:00:00.000Z', 'Standup', null, 'Diario'],
        ]);
        expect(occ[1].externalId).toBe(`${tag}-serie#2024-04-16T08:00:00.000Z`);
        const dia = evs.find((e) => e.inviteUid === `${tag}-dia`)!;
        expect(dia).toMatchObject({ allDay: true });
        expect(dia.endsAt.toISOString()).toBe('2024-05-03T00:00:00.000Z');

        // idempotente
        const r2 = await importEvents(a.id, parsed.events, { calendarName: 'Trabajo' });
        expect(r2).toMatchObject({ created: 0, existing: 4, expandedFromRrule: 0 });
        expect(await prisma.calendarEvent.count({ where: { userId: a.id } })).toBe(6);
        expect(await prisma.calendar.count({ where: { userId: a.id } })).toBe(1);

        // aislamiento
        expect(await prisma.calendarEvent.count({ where: { userId: b.id } })).toBe(0);
        const rb = await importEvents(b.id, parsed.events, { calendarName: 'Trabajo' });
        expect(rb.created).toBe(4);
        expect(await prisma.calendarEvent.count({ where: { userId: a.id } })).toBe(6);
    });

    it('un evento ya existente por invitacion (inviteUid + inicio) no se duplica ni se toca', async () => {
        const u = await createUser(prisma, addr('ei'));
        const cal = await prisma.calendar.create({ data: { userId: u.id, name: 'Local', source: 'local' } });
        await prisma.calendarEvent.create({
            data: { userId: u.id, calendarId: cal.id, title: 'Titulo del usuario', startsAt: new Date('2024-01-15T09:00:00Z'), endsAt: new Date('2024-01-15T10:00:00Z'), inviteUid: `${tag}-single` },
        });
        const parsed = parseIcsCalendar(ICS(tag));
        const r = await importEvents(u.id, parsed.events.filter((e) => e.uid.endsWith('-single')));
        expect(r).toMatchObject({ created: 0, existing: 1 });
        expect((await prisma.calendarEvent.findMany({ where: { userId: u.id } })).map((e) => e.title)).toEqual(['Titulo del usuario']);
        expect((await prisma.calendar.findMany({ where: { userId: u.id } })).map((c) => c.name).sort()).toEqual(['Importado', 'Local']);
    });

    it('RRULE no soportada se conserva como texto; tope de eventos', async () => {
        const u = await createUser(prisma, addr('er'));
        const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:h1', 'DTSTART:20240101T100000Z', 'RRULE:FREQ=HOURLY;COUNT=3', 'SUMMARY:Horaria', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
        const r = await importEvents(u.id, parseIcsCalendar(ics).events);
        expect(r).toMatchObject({ created: 1, expandedFromRrule: 0, unexpandedRrule: 1 });
        expect((await prisma.calendarEvent.findFirst({ where: { userId: u.id } }))!.description).toBe('[bloomx:rrule] FREQ=HOURLY;COUNT=3');

        const v = await createUser(prisma, addr('ev'));
        const many = ['BEGIN:VCALENDAR', ...Array.from({ length: 6 }, (_, i) => `BEGIN:VEVENT\r\nUID:m${i}\r\nDTSTART:2024010${i + 1}T100000Z\r\nSUMMARY:E${i}\r\nEND:VEVENT`), 'END:VCALENDAR'].join('\r\n');
        const rl = await importEvents(v.id, parseIcsCalendar(many).events, { maxEvents: 4 });
        expect(rl).toMatchObject({ created: 4, limited: 2 });
    });

    it('export -> import a otro usuario: una sola RRULE, excepcion, EXDATE por ocurrencia borrada y mismas ocurrencias', async () => {
        const a = await createUser(prisma, addr('xa'));
        const b = await createUser(prisma, addr('xb'));
        expect(await exportCalendarIcs(a.id)).toBeNull();
        await importEvents(a.id, parseIcsCalendar(ICS(tag)).events, { calendarName: 'Trabajo' });
        // el usuario borra una ocurrencia concreta de la serie (23/04)
        await prisma.calendarEvent.deleteMany({ where: { userId: a.id, externalId: `${tag}-serie#2024-04-23T08:00:00.000Z` } });

        const buf = (await exportCalendarIcs(a.id, { now: new Date('2024-06-01T00:00:00Z') }))!;
        const text = buf.toString('utf8');
        expect(text.match(/^RRULE:/gm)).toHaveLength(1);
        expect(text.match(/^RECURRENCE-ID/gm)).toHaveLength(1);
        expect(text).not.toContain('bloomx:');
        expect(text).toContain('DTSTART;TZID=Europe/Madrid:20240326T100000');
        expect(text.match(/^EXDATE:.*$/gm)).toEqual(['EXDATE:20240409T080000Z', 'EXDATE:20240423T080000Z']);
        expect(text).toContain('X-WR-CALNAME:Trabajo');

        const back = parseIcsCalendar(buf);
        expect(back.invalid).toBe(0);
        expect(back.events).toHaveLength(4);
        await importEvents(b.id, back.events, { calendarName: back.calendarName ?? undefined });
        const shape = async (id: string) => (await prisma.calendarEvent.findMany({ where: { userId: id }, orderBy: [{ startsAt: 'asc' }, { title: 'asc' }] }))
            .map((e) => [e.startsAt.toISOString(), e.endsAt.toISOString(), e.title, e.allDay, e.externalId]);
        expect(await shape(b.id)).toEqual(await shape(a.id));
        // y un segundo ciclo exportar/reimportar sigue siendo estable
        const buf2 = (await exportCalendarIcs(b.id, { now: new Date('2024-06-01T00:00:00Z') }))!;
        expect(buf2.toString('utf8')).toBe(text);
    });
});

describe('filtros', () => {
    const xml = (entries: string[]) => `<?xml version='1.0' encoding='UTF-8'?><feed xmlns='http://www.w3.org/2005/Atom' xmlns:apps='http://schemas.google.com/apps/2006'>`
        + entries.map((e) => `<entry><category term='filter'></category>${e}</entry>`).join('') + '</feed>';
    const pr = (n: string, v: string) => `<apps:property name='${n}' value='${v}'/>`;

    it('importa reglas con etiquetas por nombre, dedupe, unmapped y aislamiento; las reglas funcionan en el motor', async () => {
        const a = await createUser(prisma, addr('fa'));
        const b = await createUser(prisma, addr('fb'));
        const existingLabel = await prisma.label.create({ data: { userId: a.id, name: `Noticias-${tag}` } });
        const filters = parseGmailFilters(xml([
            pr('from', `news@${tag}.test OR promo@${tag}.test`) + pr('label', `noticias-${tag}`) + pr('shouldArchive', 'true'),
            pr('from', `banco@${tag}.test`) + pr('hasAttachment', 'true') + pr('label', `Finanzas-${tag}`) + pr('shouldStar', 'true') + pr('forwardTo', 'ext@example.test'),
            pr('from', `x@${tag}.test`) + pr('doesNotHaveTheWord', 'spam') + pr('shouldTrash', 'true'),
            pr('shouldArchive', 'true'),
        ])).filters;

        const r1 = await importFilters(a.id, filters);
        expect(r1).toMatchObject({ created: 2, skippedExisting: 0, labelsCreated: 1, limited: 0 });
        expect(r1.unmapped.map((u) => u.reasons.join(' | ')).join('\n')).toMatch(/forwardTo/);
        expect(r1.unmapped.some((u) => u.reasons.join().includes('doesNotHaveTheWord'))).toBe(true);
        expect(r1.unmapped.some((u) => u.reasons.includes('sin condiciones mapeables'))).toBe(true);

        const rules = await loadRules(a.id);
        expect(rules).toHaveLength(2);
        const labels = await prisma.label.findMany({ where: { userId: a.id } });
        expect(labels).toHaveLength(2);
        const fin = labels.find((l) => l.name === `Finanzas-${tag}`)!;
        expect(rules[0].actions).toEqual([{ type: 'addLabel', labelId: existingLabel.id }, { type: 'archive' }]);
        expect(rules[1].actions).toEqual([{ type: 'addLabel', labelId: fin.id }, { type: 'star' }]);
        expect(JSON.stringify(rules)).not.toContain('ext@example');

        const em = (from: string, hasAttachment = false): RuleEmail => ({ from, to: '', subject: '', body: '', hasAttachment, labelIds: [] });
        expect(evaluateRules(em(`Promo <promo@${tag}.test>`), rules)).toMatchObject({ folder: 'archive', addLabelIds: [existingLabel.id] });
        expect(evaluateRules(em(`banco@${tag}.test`, true), rules)).toMatchObject({ star: true, addLabelIds: [fin.id] });
        expect(evaluateRules(em(`banco@${tag}.test`, false), rules).star).toBe(false);

        // idempotente
        const r2 = await importFilters(a.id, filters);
        expect(r2).toMatchObject({ created: 0, skippedExisting: 2, labelsCreated: 0 });
        expect(await loadRules(a.id)).toHaveLength(2);
        expect(await prisma.label.count({ where: { userId: a.id } })).toBe(2);
        // aislamiento
        expect(await loadRules(b.id)).toHaveLength(0);
        expect(await prisma.label.count({ where: { userId: b.id } })).toBe(0);
    });

    it('export -> import a otro usuario (mismas reglas y etiquetas por nombre)', async () => {
        const a = await createUser(prisma, addr('fx'));
        const b = await createUser(prisma, addr('fy'));
        expect(await exportFiltersXml(a.id)).toBeNull();
        const src = parseGmailFilters(xml([
            pr('from', `a@${tag}.test OR b@${tag}.test`) + pr('subject', 'factura') + pr('label', `L-${tag}`) + pr('shouldMarkAsRead', 'true'),
            pr('hasTheWord', 'oferta &quot;pago pendiente&quot;') + pr('shouldTrash', 'true'),
        ])).filters;
        await importFilters(a.id, src);
        const rep = await exportFiltersXmlWithReport(a.id);
        expect(rep.skipped).toEqual([]);
        const buf = (await exportFiltersXml(a.id))!;
        const back = parseGmailFilters(buf);
        expect(back.invalid).toBe(0);
        expect(back.filters).toHaveLength(2);
        const rb = await importFilters(b.id, back.filters);
        expect(rb).toMatchObject({ created: 2, labelsCreated: 1 });
        const norm = async (id: string) => {
            const names = new Map((await prisma.label.findMany({ where: { userId: id } })).map((l) => [l.id, l.name]));
            return (await loadRules(id)).map((r) => JSON.stringify([r.conditions, r.actions.map((x: any) => (x.type === 'addLabel' ? names.get(x.labelId) : x.type))]));
        };
        expect(await norm(b.id)).toEqual(await norm(a.id));
        // reimportar el export en el mismo usuario: dedupe
        expect(await importFilters(b.id, back.filters)).toMatchObject({ created: 0, skippedExisting: 2 });
    });

    it('respeta MAX_RULES_PER_USER', async () => {
        const u = await createUser(prisma, addr('fl'));
        const many = parseGmailFilters(xml(Array.from({ length: MAX_RULES_PER_USER + 3 }, (_, i) => pr('from', `r${i}@${tag}.test`) + pr('shouldStar', 'true')))).filters;
        const r = await importFilters(u.id, many);
        expect(r.created).toBe(MAX_RULES_PER_USER);
        expect(r.limited).toBe(3);
        expect(await loadRules(u.id)).toHaveLength(MAX_RULES_PER_USER);
    });
});
