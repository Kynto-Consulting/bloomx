/**
 * Servicio de contactos del sandbox de extensiones (`services.contacts.*`), lado frontend.
 *
 * Garantias: TODA consulta/escritura filtra por `userId`; un id ajeno es `not_found` (sin oraculo). Nunca se expone
 * externalId. Valida con las mismas reglas que la API de usuario (parseContactInput). `suggestMerges` no escribe.
 * Las escrituras no disparan hooks de extensiones (anti-bucle).
 */
import { z } from 'zod';
import { MAX_NAME_LENGTH, MAX_NOTES_LENGTH, parseContactInput } from '@/lib/contacts';
import { normalizeEmailAddressAscii, stripControlChars } from '@/lib/mail-validation';
import { BridgeError, op } from './bridge-route';

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const emailStr = z.string().min(3).max(320);

export const contactsRequest = z.discriminatedUnion('op', [
    op('search', z.strictObject({ q: z.string().min(1).max(100), limit: z.number().int().min(1).max(50).default(20) })),
    op('get', z.union([z.strictObject({ contactId: id }), z.strictObject({ email: emailStr })])),
    op('list', z.strictObject({ limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).max(100000).default(0) }).default({ limit: 50, offset: 0 })),
    op('suggestMerges', z.strictObject({ limit: z.number().int().min(1).max(50).default(20) }).default({ limit: 20 })),
    op('create', z.strictObject({ email: emailStr, name: z.string().max(MAX_NAME_LENGTH).optional(), notes: z.string().max(MAX_NOTES_LENGTH).optional() })),
    op('update', z.strictObject({
        contactId: id,
        name: z.string().max(MAX_NAME_LENGTH).optional(),
        notes: z.string().max(MAX_NOTES_LENGTH).optional(),
        email: emailStr.optional(),
    }).refine((a) => a.name !== undefined || a.notes !== undefined || a.email !== undefined, 'nothing to update')),
    op('merge', z.strictObject({ keepId: id, mergeIds: z.array(id).min(1).max(10) })
        .refine((a) => !a.mergeIds.includes(a.keepId), 'keepId in mergeIds')
        .refine((a) => new Set(a.mergeIds).size === a.mergeIds.length, 'duplicate mergeIds')),
]);
export type ContactsRequest = z.infer<typeof contactsRequest>;

export interface ContactsDb {
    contact: {
        findMany: (args: any) => Promise<any[]>;
        findFirst: (args: any) => Promise<any>;
        count: (args: any) => Promise<number>;
        create: (args: any) => Promise<any>;
        update: (args: any) => Promise<any>;
        deleteMany: (args: any) => Promise<{ count: number }>;
    };
}

export interface ContactsDeps {
    db: ContactsDb;
    /** Ejecuta `fn` de forma atomica (merge). */
    transaction: <T>(fn: (db: ContactsDb) => Promise<T>) => Promise<T>;
}

export async function defaultContactsDeps(): Promise<ContactsDeps> {
    const { prisma } = await import('@/lib/prisma');
    return {
        db: prisma as unknown as ContactsDb,
        transaction: (fn) => prisma.$transaction((tx) => fn(tx as unknown as ContactsDb)),
    };
}

export interface ContactOut { id: string; email: string; name: string | null; notes: string | null; source: string; createdAt: string }

export function toContact(row: any): ContactOut {
    return {
        id: String(row.id),
        email: String(row.email),
        name: row.name ?? null,
        notes: row.notes ?? null,
        source: String(row.source ?? 'local'),
        createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt ?? ''),
    };
}

// ---------------------------------------------------------------------------------------------------------------
// Sugerencias de fusion (puro)
// ---------------------------------------------------------------------------------------------------------------
/** Normaliza un correo para detectar duplicados: minusculas, sin +etiqueta y, en Gmail, sin puntos. */
export function normalizeEmailForMerge(email: string): string {
    const v = String(email || '').trim().toLowerCase();
    const at = v.lastIndexOf('@');
    if (at < 1) return v;
    let local = v.slice(0, at);
    let domain = v.slice(at + 1);
    local = local.split('+')[0];
    if (domain === 'googlemail.com') domain = 'gmail.com';
    if (domain === 'gmail.com') local = local.replace(/\./g, '');
    return `${local}@${domain}`;
}

const normalizeName = (name: unknown) => String(name ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const MAX_GROUP_CONTACTS = 11; // keepId + hasta 10 mergeIds

export function suggestMergeGroups(rows: any[], limit: number): Array<{ reason: 'same_email_normalized' | 'same_name'; contacts: ContactOut[] }> {
    const groups: Array<{ reason: 'same_email_normalized' | 'same_name'; contacts: any[] }> = [];
    const byEmail = new Map<string, any[]>();
    for (const r of rows) {
        const k = normalizeEmailForMerge(r.email);
        if (!k) continue;
        (byEmail.get(k) ?? byEmail.set(k, []).get(k)!).push(r);
    }
    const emailSets = new Set<string>();
    for (const list of byEmail.values()) {
        if (list.length < 2) continue;
        groups.push({ reason: 'same_email_normalized', contacts: list });
        emailSets.add(list.map((c) => c.id).sort().join('|'));
    }
    const byName = new Map<string, any[]>();
    for (const r of rows) {
        const k = normalizeName(r.name);
        if (k.length < 2) continue;
        (byName.get(k) ?? byName.set(k, []).get(k)!).push(r);
    }
    for (const list of byName.values()) {
        if (list.length < 2) continue;
        if (emailSets.has(list.map((c) => c.id).sort().join('|'))) continue; // ya cubierto por el grupo de correo
        groups.push({ reason: 'same_name', contacts: list });
    }
    return groups.slice(0, limit).map((g) => ({ reason: g.reason, contacts: g.contacts.slice(0, MAX_GROUP_CONTACTS).map(toContact) }));
}

// ---------------------------------------------------------------------------------------------------------------
const SUGGEST_SCAN = 2000;

function isUniqueViolation(e: any) {
    return e?.code === 'P2002';
}

export async function handleContacts(deps: ContactsDeps, req: ContactsRequest): Promise<unknown> {
    const { userId } = req;
    const { db } = deps;

    switch (req.op) {
        case 'search': {
            const q = stripControlChars(req.args.q).slice(0, 100);
            if (!q) throw new BridgeError('invalid_args');
            const rows = await db.contact.findMany({
                where: { userId, OR: [{ email: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }] },
                orderBy: [{ name: 'asc' }, { email: 'asc' }],
                take: req.args.limit,
            });
            return { contacts: rows.map(toContact) };
        }

        case 'get': {
            const a = req.args;
            let row: any;
            if ('contactId' in a) {
                row = await db.contact.findFirst({ where: { id: a.contactId, userId } });
            } else {
                const email = normalizeEmailAddressAscii(a.email.trim().toLowerCase());
                if (!email) throw new BridgeError('invalid_args');
                row = await db.contact.findFirst({ where: { userId, email: email.toLowerCase() } });
            }
            return { contact: row ? toContact(row) : null };
        }

        case 'list': {
            const { limit, offset } = req.args;
            const where = { userId };
            const [rows, total] = await Promise.all([
                db.contact.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: offset, take: limit }),
                db.contact.count({ where }),
            ]);
            const next = offset + rows.length;
            return { contacts: rows.map(toContact), total, nextOffset: rows.length > 0 && next < total ? next : null };
        }

        case 'suggestMerges': {
            const rows = await db.contact.findMany({ where: { userId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: SUGGEST_SCAN });
            return { groups: suggestMergeGroups(rows, req.args.limit) };
        }

        case 'create': {
            const parsed = parseContactInput(req.args);
            if (!parsed.ok) throw new BridgeError('invalid_args');
            const { email, name, notes } = parsed.value;
            const findExisting = () => db.contact.findFirst({ where: { userId, email } });
            const existing = await findExisting();
            if (existing) return { contact: toContact(existing), created: false };
            try {
                const row = await db.contact.create({ data: { userId, email, name: name ?? null, notes: notes ?? null, source: 'local' } });
                return { contact: toContact(row), created: true };
            } catch (e) {
                if (!isUniqueViolation(e)) throw e;
                const again = await findExisting(); // carrera: otra peticion lo creo primero
                if (!again) throw e;
                return { contact: toContact(again), created: false };
            }
        }

        case 'update': {
            const a = req.args;
            const present: Record<string, unknown> = {};
            if (a.email !== undefined) present.email = a.email;
            if (a.name !== undefined) present.name = a.name;
            if (a.notes !== undefined) present.notes = a.notes;
            const parsed = parseContactInput(present, { partial: true });
            if (!parsed.ok) throw new BridgeError('invalid_args');
            const existing = await db.contact.findFirst({ where: { id: a.contactId, userId } });
            if (!existing) throw new BridgeError('not_found');
            const data = parsed.value;
            if (data.email && data.email !== existing.email) {
                const clash = await db.contact.findFirst({ where: { userId, email: data.email, id: { not: existing.id } } });
                if (clash) throw new BridgeError('conflict');
            }
            try {
                const row = await db.contact.update({ where: { id: existing.id }, data });
                return { contact: toContact(row) };
            } catch (e) {
                if (isUniqueViolation(e)) throw new BridgeError('conflict');
                throw e;
            }
        }

        case 'merge': {
            const { keepId, mergeIds } = req.args;
            return deps.transaction(async (tx) => {
                const rows = await tx.contact.findMany({ where: { userId, id: { in: [keepId, ...mergeIds] } } });
                const byId = new Map(rows.map((r) => [String(r.id), r]));
                const keep = byId.get(keepId);
                if (!keep || mergeIds.some((m) => !byId.has(m))) throw new BridgeError('not_found');
                const merged = mergeIds.map((m) => byId.get(m)!);
                const notes = [keep.notes, ...merged.map((m) => m.notes)]
                    .map((n) => String(n ?? '').trim())
                    .filter(Boolean)
                    .filter((n, i, all) => all.indexOf(n) === i)
                    .join('\n\n')
                    .slice(0, MAX_NOTES_LENGTH);
                const name = keep.name || merged.find((m) => m.name)?.name || null;
                const row = await tx.contact.update({ where: { id: keep.id }, data: { notes: notes || null, name } });
                const del = await tx.contact.deleteMany({ where: { userId, id: { in: mergeIds } } });
                return { contact: toContact(row), merged: del.count };
            });
        }
    }
}
