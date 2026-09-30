/**
 * apply.ts - capa de BD del importador/exportador PIM (contactos, calendarios, filtros de Gmail).
 *
 * Todo es IDEMPOTENTE (reimportar no duplica), esta AISLADO por userId y NO sobrescribe datos existentes del usuario.
 *
 * Decisiones:
 *  - Contact: una fila por correo (@@unique userId+email). `externalId` = UID de la tarjeta (o hash del primer correo) y
 *    agrupa las filas de una misma persona al exportar. Telefonos/organizacion/cargo/direcciones/cumpleanos/webs van en
 *    `notes` (ver contact-notes.ts). source = 'import'.
 *  - Calendar: {source:'import', name} por archivo. Evento maestro: inviteUid = externalId = UID (asi una invitacion posterior
 *    con el mismo UID lo actualiza) y dedupe por (inviteUid, startsAt) a nivel de usuario.
 *  - Recurrencia: el modelo no tiene campo, asi que la RRULE (y EXDATE/RDATE/TZID) se guarda como marcadores en las ULTIMAS
 *    lineas de `description` del maestro (`[bloomx:rrule] ...`) y ademas se expanden las ocurrencias como eventos concretos
 *    (externalId `${uid}#${isoInicio}`, inviteUid null, sin asistentes) hasta el tope. Las excepciones (RECURRENCE-ID) usan
 *    la misma clave que su ocurrencia y la sustituyen.
 *  - Filtros: mapGmailFilter -> etiquetas por nombre (se crean las que falten) -> insertRule; dedupe por nombre+condiciones.
 */
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { MAX_RULES_PER_USER, insertRule, loadRules } from '@/lib/rules/store';
import { normalizeConditions, validateRuleInput, type Action } from '@/lib/rules/engine';
import { MAX_LABEL_NAME } from '@/lib/rules/label-validation';
import { buildVcf, type PimContact } from './vcard';
import { decodeContactNotes, encodeContactNotes } from './contact-notes';
import {
    buildCalendarIcs, decodeRecurrenceMarkers, encodeRecurrenceMarkers, expandRruleEx,
    type PimAttendee, type PimEvent, type PimEventOut, type PimEventStatus, type PimResponse,
} from './ics-io';
import { buildGmailFiltersXmlEx, mapGmailFilter, type GmailFilter, type GmailMapContext } from './gmail-filters';

const intEnv = (name: string, def: number) => {
    const n = Number.parseInt(String(process.env[name] ?? ''), 10);
    return Number.isFinite(n) && n > 0 ? n : def;
};

/** Topes por buzon (configurables por entorno). */
export const pimLimits = () => ({
    maxContacts: intEnv('MAIL_TRANSFER_MAX_CONTACTS', 20_000),
    maxEvents: intEnv('MAIL_TRANSFER_MAX_EVENTS', 50_000),
});

const EXPORT_ROW_CAP = 200_000;
const CONTACT_SOURCE = 'import';
const CAL_SOURCE = 'import';
const EMAIL_OK = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{1,255}$/;

const chunk = <T,>(arr: T[], n: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
};
const isP2002 = (e: unknown) => (e as { code?: string })?.code === 'P2002';
const sha = (s: string) => createHash('sha1').update(s).digest('hex');

/** JSON con claves ordenadas (jsonb de Postgres no conserva el orden de las claves). */
function stableJson(v: unknown): string {
    if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
    if (v && typeof v === 'object') {
        return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
    }
    return JSON.stringify(v);
}

// ---------------------------------------------------------------------------
// Contactos
// ---------------------------------------------------------------------------

export interface ImportContactsResult {
    /** Filas Contact creadas (una por correo). */
    created: number;
    existing: number;
    invalid: number;
    /** Correos que no se guardaron por el tope de contactos del buzon. */
    limited: number;
    /** Contactos validos sin ningun correo (el modelo exige email): incluidos tambien en `invalid`. */
    noEmail: number;
}

export async function importContacts(userId: string, contacts: PimContact[], opts: { maxContacts?: number } = {}): Promise<ImportContactsResult> {
    const res: ImportContactsResult = { created: 0, existing: 0, invalid: 0, limited: 0, noEmail: 0 };
    const max = opts.maxContacts ?? pimLimits().maxContacts;

    interface Row { email: string; name: string | null; notes: string | null; externalId: string }
    const rows: Row[] = [];
    const seen = new Set<string>();
    for (const c of contacts) {
        const emails = [...new Set((c?.emails ?? []).map((e) => String(e).trim().toLowerCase()).filter((e) => e.length <= 254 && EMAIL_OK.test(e)))];
        if (!emails.length) { res.invalid++; res.noEmail++; continue; }
        const externalId = (c.uid && c.uid.trim() ? c.uid.trim().slice(0, 255) : `h_${sha(emails[0]).slice(0, 24)}`);
        const name = c.name ? c.name.trim().slice(0, 500) || null : null;
        const notes = encodeContactNotes(c);
        for (const email of emails) {
            if (seen.has(email)) { res.existing++; continue; }
            seen.add(email);
            rows.push({ email, name, notes, externalId });
        }
    }
    if (!rows.length) return res;

    const total = await prisma.contact.count({ where: { userId } });
    let room = Math.max(0, max - total);

    for (const part of chunk(rows, 500)) {
        const found = await prisma.contact.findMany({ where: { userId, email: { in: part.map((r) => r.email) } }, select: { email: true } });
        const have = new Set(found.map((f) => f.email.toLowerCase()));
        const fresh: Row[] = [];
        for (const r of part) {
            if (have.has(r.email)) res.existing++;
            else if (fresh.length >= room) res.limited++;
            else fresh.push(r);
        }
        if (!fresh.length) continue;
        const made = await prisma.contact.createMany({
            data: fresh.map((r) => ({ userId, email: r.email, name: r.name, notes: r.notes, source: CONTACT_SOURCE, externalId: r.externalId })),
            skipDuplicates: true,
        });
        res.created += made.count;
        res.existing += fresh.length - made.count; // carrera: otro proceso lo creo antes
        room = Math.max(0, room - made.count);
    }
    return res;
}

/** vCard 4.0 con todos los contactos del usuario (filas con el mismo externalId se agrupan). null si no hay. */
export async function exportContactsVcf(userId: string): Promise<Buffer | null> {
    const rows = await prisma.contact.findMany({
        where: { userId }, orderBy: [{ createdAt: 'asc' }, { email: 'asc' }], take: EXPORT_ROW_CAP,
        select: { email: true, name: true, notes: true, externalId: true },
    });
    if (!rows.length) return null;
    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
        const key = r.externalId ? `x:${r.externalId}` : `e:${r.email}`;
        const g = groups.get(key);
        if (g) g.push(r); else groups.set(key, [r]);
    }
    const out: PimContact[] = [];
    for (const [key, g] of groups) {
        const det = decodeContactNotes(g.find((r) => r.notes)?.notes ?? null);
        out.push({
            uid: key.startsWith('x:') && !/^h_[0-9a-f]{24}$/.test(key.slice(2)) ? key.slice(2) : null,
            name: g.find((r) => r.name)?.name ?? null,
            emails: g.map((r) => r.email),
            ...det,
        });
    }
    return Buffer.from(buildVcf(out), 'utf8');
}

// ---------------------------------------------------------------------------
// Calendario
// ---------------------------------------------------------------------------

export interface ImportEventsOptions {
    /** Nombre del calendario destino (por defecto 'Importado'). */
    calendarName?: string;
    maxOccurrences?: number;
    horizonYears?: number;
    maxEvents?: number;
}

export interface ImportEventsResult {
    /** Eventos maestros / sueltos / excepciones creados. */
    created: number;
    existing: number;
    invalid: number;
    /** Ocurrencias concretas creadas a partir de RRULE. */
    expandedFromRrule: number;
    /** Series cuya RRULE no se pudo expandir (solo texto en el marcador). */
    unexpandedRrule: number;
    /** Eventos que no se guardaron por el tope de eventos del buzon. */
    limited: number;
    calendarId: string | null;
}

const occKey = (uid: string, d: Date) => `${uid}#${d.toISOString()}`;
const RESP_OK = new Set(['accepted', 'declined', 'tentative', 'needsAction']);

async function ensureCalendar(userId: string, name: string): Promise<string> {
    const nm = name.trim().slice(0, 100) || 'Importado';
    const where = { userId, source: CAL_SOURCE, name: nm };
    const f = await prisma.calendar.findFirst({ where, select: { id: true } });
    if (f) return f.id;
    try {
        return (await prisma.calendar.create({ data: { ...where, isReadOnly: false }, select: { id: true } })).id;
    } catch (e) {
        if (!isP2002(e)) throw e;
        return (await prisma.calendar.findFirstOrThrow({ where, select: { id: true } })).id;
    }
}

export async function importEvents(userId: string, events: PimEvent[], opts: ImportEventsOptions = {}): Promise<ImportEventsResult> {
    const res: ImportEventsResult = { created: 0, existing: 0, invalid: 0, expandedFromRrule: 0, unexpandedRrule: 0, limited: 0, calendarId: null };
    const list: PimEvent[] = [];
    for (const ev of events ?? []) {
        if (!ev || !ev.uid || !(ev.startsAt instanceof Date) || !(ev.endsAt instanceof Date) || Number.isNaN(ev.startsAt.getTime()) || Number.isNaN(ev.endsAt.getTime())) { res.invalid++; continue; }
        list.push(ev);
    }
    if (!list.length) return res;

    const calendarId = await ensureCalendar(userId, opts.calendarName ?? 'Importado');
    res.calendarId = calendarId;
    const maxEvents = opts.maxEvents ?? pimLimits().maxEvents;
    let room = Math.max(0, maxEvents - (await prisma.calendarEvent.count({ where: { userId } })));

    // Maestros/sueltos primero; las excepciones se guardan con la clave de su ocurrencia
    const masters = list.filter((e) => !e.recurrenceId);
    const exceptions = list.filter((e) => e.recurrenceId);
    const exceptionKeys = new Set(exceptions.map((e) => occKey(e.uid, e.recurrenceId as Date)));

    // Claves ya existentes (usuario completo para inviteUid; calendario para externalId)
    const uids = [...new Set(list.map((e) => e.uid))];
    const haveMaster = new Set<string>(); // `${uid}|${ms}`
    const haveExt = new Set<string>();
    for (const part of chunk(uids, 200)) {
        const rows = await prisma.calendarEvent.findMany({
            where: { userId, OR: [{ inviteUid: { in: part } }, ...part.map((u) => ({ calendarId, externalId: { startsWith: `${u}#` } }))] },
            select: { inviteUid: true, externalId: true, startsAt: true, calendarId: true },
        });
        for (const r of rows) {
            if (r.inviteUid) haveMaster.add(`${r.inviteUid}|${r.startsAt.getTime()}`);
            if (r.externalId && r.calendarId === calendarId) haveExt.add(r.externalId);
        }
    }

    type EventData = {
        userId: string; calendarId: string; title: string; description: string | null; location: string | null; startsAt: Date; endsAt: Date; allDay: boolean;
        status: string; source: string; externalId: string; inviteUid: string | null; organizerEmail: string | null; organizerName: string | null; conferenceUrl: string | null;
    };
    const base = (ev: PimEvent, over: Partial<EventData>): EventData => ({
        userId, calendarId, title: ev.title.slice(0, 500) || '(sin titulo)', description: ev.description, location: ev.location, startsAt: ev.startsAt, endsAt: ev.endsAt,
        allDay: !!ev.allDay, status: ev.status, source: CAL_SOURCE, externalId: ev.uid, inviteUid: null, organizerEmail: ev.organizerEmail, organizerName: ev.organizerName,
        conferenceUrl: ev.conferenceUrl ?? null, ...over,
    });
    const attendeesOf = (ev: PimEvent) => (ev.attendees ?? []).slice(0, 500).map((a: PimAttendee) => ({
        email: a.email, name: a.name, responseStatus: a.responseStatus && RESP_OK.has(a.responseStatus) ? a.responseStatus : null, isOrganizer: !!a.isOrganizer,
    }));

    const createOne = async (data: EventData, attendees: ReturnType<typeof attendeesOf>): Promise<boolean> => {
        if (room <= 0) { res.limited++; return false; }
        await prisma.calendarEvent.create({ data: { ...data, ...(attendees.length ? { attendees: { create: attendees } } : {}) } });
        room--;
        return true;
    };

    // 1) Maestros y eventos sueltos (+ 2) ocurrencias concretas)
    for (const ev of masters) {
        const key = `${ev.uid}|${ev.startsAt.getTime()}`;
        const rr = ev.rrule ? ev.rrule : null;
        const ex = rr ? expandRruleEx(ev, { maxOccurrences: opts.maxOccurrences ?? 500, horizonYears: opts.horizonYears ?? 5 }) : null;
        if (rr && !ex) res.unexpandedRrule++;
        if (haveMaster.has(key)) res.existing++;
        else {
            const expandedUntil = ex && ex.dates.length > 1 ? ex.dates[ex.dates.length - 1].toISOString() : null;
            const desc = rr ? encodeRecurrenceMarkers(ev.description, { rrule: rr, recurrenceExtra: ev.recurrenceExtra ?? [], tzid: ev.tzid, expandedUntil }) : ev.description;
            if (await createOne(base(ev, { inviteUid: ev.uid.slice(0, 255), description: desc }), attendeesOf(ev))) {
                res.created++;
                haveMaster.add(key);
            }
        }
        if (!ex) continue;
        const dur = ev.endsAt.getTime() - ev.startsAt.getTime();
        const fresh: EventData[] = [];
        for (const d of ex.dates) {
            if (d.getTime() === ev.startsAt.getTime()) continue;
            const k = occKey(ev.uid, d);
            if (exceptionKeys.has(k) || haveExt.has(k)) continue;
            fresh.push(base(ev, { startsAt: d, endsAt: new Date(d.getTime() + dur), externalId: k, inviteUid: null }));
        }
        const allowed = fresh.slice(0, room);
        res.limited += fresh.length - allowed.length;
        for (const part of chunk(allowed, 500)) {
            const made = await prisma.calendarEvent.createMany({ data: part });
            res.expandedFromRrule += made.count;
            room -= made.count;
            for (const p of part) haveExt.add(p.externalId);
        }
    }

    // 3) Excepciones de series
    for (const ev of exceptions) {
        const k = occKey(ev.uid, ev.recurrenceId as Date);
        if (haveExt.has(k)) { res.existing++; continue; }
        if (await createOne(base(ev, { externalId: k, inviteUid: null }), attendeesOf(ev))) {
            res.created++;
            haveExt.add(k);
        }
    }
    return res;
}

const OCC_RE = /^(.+)#(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)$/;
const statusOf = (s: string | null): PimEventStatus => (s === 'cancelled' || s === 'tentative' ? s : 'confirmed');

/** ICS con TODOS los eventos del usuario (series como RRULE + excepciones, sin duplicar ocurrencias expandidas). null si no hay. */
export async function exportCalendarIcs(userId: string, opts: { name?: string; now?: Date } = {}): Promise<Buffer | null> {
    const rows = await prisma.calendarEvent.findMany({
        where: { userId }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], take: EXPORT_ROW_CAP,
        include: { attendees: true, calendar: { select: { name: true } } },
    });
    if (!rows.length) return null;

    type Row = (typeof rows)[number];
    const masters = new Map<string, { row: Row; dec: ReturnType<typeof decodeRecurrenceMarkers> }>(); // `${calendarId}|${uid}`
    for (const r of rows) {
        const dec = decodeRecurrenceMarkers(r.description);
        if (dec.rrule && r.externalId && !OCC_RE.test(r.externalId)) masters.set(`${r.calendarId}|${r.externalId}`, { row: r, dec });
    }
    const occRows = new Map<string, Row[]>();
    for (const r of rows) {
        const m = r.externalId ? OCC_RE.exec(r.externalId) : null;
        if (!m) continue;
        const key = `${r.calendarId}|${m[1]}`;
        if (masters.has(key)) (occRows.get(key) ?? occRows.set(key, []).get(key)!).push(r);
    }

    const toOut = (r: Row, over: Partial<PimEventOut> = {}): PimEventOut => ({
        uid: r.inviteUid || (r.externalId && !OCC_RE.test(r.externalId) ? r.externalId : `${r.id}@bloomx`),
        title: r.title, description: r.description, location: r.location, startsAt: r.startsAt, endsAt: r.endsAt, allDay: r.allDay, status: statusOf(r.status),
        organizerEmail: r.organizerEmail, organizerName: r.organizerName,
        attendees: r.attendees.map((a): PimAttendee => ({
            email: a.email, name: a.name, isOrganizer: a.isOrganizer,
            responseStatus: a.responseStatus && RESP_OK.has(a.responseStatus) ? (a.responseStatus as PimResponse) : null,
        })),
        conferenceUrl: r.conferenceUrl, ...over,
    });

    const out: PimEventOut[] = [];
    const emitted = new Set<string>();
    for (const r of rows) {
        const m = r.externalId ? OCC_RE.exec(r.externalId) : null;
        const mkey = m ? `${r.calendarId}|${m[1]}` : null;
        if (m && mkey && masters.has(mkey)) {
            // Ocurrencia de una serie conocida: solo se exporta si difiere de lo que generaria la RRULE (excepcion)
            const { row: mr, dec } = masters.get(mkey)!;
            const dur = mr.endsAt.getTime() - mr.startsAt.getTime();
            const rid = new Date(m[2]);
            const same = r.startsAt.getTime() === rid.getTime() && r.endsAt.getTime() - r.startsAt.getTime() === dur && r.title === mr.title
                && (r.description ?? null) === (dec.description ?? null) && (r.location ?? null) === (mr.location ?? null) && statusOf(r.status) === statusOf(mr.status);
            if (!same) out.push(toOut(r, { uid: mr.inviteUid || mr.externalId!, recurrenceId: rid, description: r.description }));
            continue;
        }
        if (emitted.has(r.id)) continue;
        emitted.add(r.id);
        const dec = decodeRecurrenceMarkers(r.description);
        if (dec.rrule && mkey === null) {
            // Serie: EXDATE para las ocurrencias borradas por el usuario (dentro del rango ya materializado)
            const extra = [...dec.recurrenceExtra];
            const key = `${r.calendarId}|${r.externalId}`;
            const occ = occRows.get(key) ?? [];
            if (occ.length || dec.expandedUntil) {
                const ev: PimEvent = { ...(toOut(r) as PimEvent), rrule: dec.rrule, recurrenceExtra: dec.recurrenceExtra, tzid: dec.tzid };
                const ex = expandRruleEx(ev, { maxOccurrences: 500, horizonYears: 5 });
                if (ex) {
                    const have = new Set(occ.map((o) => OCC_RE.exec(o.externalId!)![2]));
                    const lastRow = Math.max(...occ.map((o) => new Date(OCC_RE.exec(o.externalId!)![2]).getTime()));
                    const bound = dec.expandedUntil ? Math.max(lastRow, new Date(dec.expandedUntil).getTime() || 0) : lastRow;
                    const miss = ex.dates.filter((d) => d.getTime() > r.startsAt.getTime() && d.getTime() <= bound && !have.has(d.toISOString()));
                    if (miss.length) {
                        const f = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
                        extra.push(r.allDay ? `EXDATE;VALUE=DATE:${miss.map((d) => f(d).slice(0, 8)).join(',')}` : `EXDATE:${miss.map(f).join(',')}`);
                    }
                }
            }
            out.push(toOut(r, { uid: r.inviteUid || r.externalId!, description: dec.description, rrule: dec.rrule, recurrenceExtra: extra, tzid: dec.tzid }));
        } else if (m) {
            // Ocurrencia huerfana (maestro borrado): evento suelto con UID propio
            out.push(toOut(r, { uid: r.externalId! }));
        } else {
            out.push(toOut(r));
        }
    }
    const names = new Set(rows.map((r) => r.calendar?.name).filter(Boolean));
    const name = opts.name ?? (names.size === 1 ? [...names][0]! : 'BloomX');
    return Buffer.from(buildCalendarIcs(out, name, { now: opts.now }), 'utf8');
}

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

export interface ImportFiltersOptions extends Pick<GmailMapContext, 'partial' | 'maxSplit'> { }

export interface ImportFiltersResult {
    created: number;
    skippedExisting: number;
    /** Filtros (o partes) que no se pudieron crear o convertir, con los motivos. */
    unmapped: Array<{ name: string; reasons: string[] }>;
    labelsCreated: number;
    /** Reglas no creadas por el tope MAX_RULES_PER_USER. */
    limited: number;
}

export async function importFilters(userId: string, filters: GmailFilter[], opts: ImportFiltersOptions = {}): Promise<ImportFiltersResult> {
    const res: ImportFiltersResult = { created: 0, skippedExisting: 0, unmapped: [], labelsCreated: 0, limited: 0 };
    const existingRules = await loadRules(userId);
    const sigOf = (name: string, cond: unknown) => `${name.trim().toLowerCase()}|${stableJson(normalizeConditions(cond))}`;
    const known = new Set(existingRules.map((r) => sigOf(r.name, r.conditions)));
    let count = existingRules.length;
    let priority = existingRules.reduce((m, r) => Math.max(m, r.priority), -1) + 1;

    const labels = new Map<string, string>(); // nombre en minusculas -> id
    for (const l of await prisma.label.findMany({ where: { userId }, select: { id: true, name: true } })) labels.set(l.name.toLowerCase(), l.id);
    const labelId = async (name: string): Promise<string> => {
        const k = name.toLowerCase();
        const have = labels.get(k);
        if (have) return have;
        try {
            const l = await prisma.label.create({ data: { userId, name: name.slice(0, MAX_LABEL_NAME) }, select: { id: true } });
            labels.set(k, l.id);
            res.labelsCreated++;
            return l.id;
        } catch (e) {
            if (!isP2002(e)) throw e;
            const l = await prisma.label.findFirstOrThrow({ where: { userId, name: { equals: name, mode: 'insensitive' } }, select: { id: true } });
            labels.set(k, l.id);
            return l.id;
        }
    };

    for (let i = 0; i < filters.length; i++) {
        const f = filters[i];
        const m = mapGmailFilter(f, { index: i, partial: opts.partial, maxSplit: opts.maxSplit });
        const label = m.rule?.name ?? `Gmail filtro ${i + 1}`;
        if (m.unmapped.length || m.skipped) res.unmapped.push({ name: label, reasons: [...(m.skipped ? [m.skipped] : []), ...m.unmapped] });
        for (const draft of m.rules) {
            if (known.has(sigOf(draft.name, draft.conditions))) { res.skippedExisting++; continue; }
            if (count >= MAX_RULES_PER_USER) { res.limited++; res.unmapped.push({ name: draft.name, reasons: [`limite de ${MAX_RULES_PER_USER} reglas por usuario`] }); continue; }
            // Valida ANTES de crear etiquetas (con ids provisionales)
            const probe = draft.actions.map((a) => (a.type === 'addLabelByName' ? ({ type: 'addLabel', labelId: 'x' } as Action) : a));
            const v = validateRuleInput({ conditions: draft.conditions, actions: probe });
            if (!v.ok) { res.unmapped.push({ name: draft.name, reasons: [`regla invalida: ${v.error}`] }); continue; }
            const actions: Action[] = [];
            for (const a of draft.actions) actions.push(a.type === 'addLabelByName' ? { type: 'addLabel', labelId: await labelId(a.name) } : a);
            await insertRule(userId, { name: draft.name, enabled: true, priority: priority++, conditions: v.conditions, actions, stopProcessing: draft.stopProcessing });
            known.add(sigOf(draft.name, draft.conditions));
            count++;
            res.created++;
        }
    }
    return res;
}

export async function exportFiltersXmlWithReport(userId: string): Promise<{ xml: Buffer | null; skipped: Array<{ name: string; reason: string }> }> {
    const rules = await loadRules(userId);
    if (!rules.length) return { xml: null, skipped: [] };
    const labelNameById = new Map((await prisma.label.findMany({ where: { userId }, select: { id: true, name: true } })).map((l) => [l.id, l.name] as const));
    const r = buildGmailFiltersXmlEx(rules, labelNameById);
    return { xml: r.exported ? Buffer.from(r.xml, 'utf8') : null, skipped: r.skipped };
}

/** mailFilters.xml con las reglas del usuario; null si no hay reglas exportables. */
export async function exportFiltersXml(userId: string): Promise<Buffer | null> {
    return (await exportFiltersXmlWithReport(userId)).xml;
}
