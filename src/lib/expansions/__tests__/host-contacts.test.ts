import { describe, expect, it } from 'vitest';
import { contactsRequest, handleContacts, normalizeEmailForMerge, suggestMergeGroups, type ContactsDb, type ContactsDeps, type ContactsRequest } from '../host-services/contacts';
import { BridgeError } from '../host-services/bridge-route';

type Row = { id: string; userId: string; email: string; name: string | null; notes: string | null; source: string; externalId?: string | null; createdAt: Date };

function makeDeps(seed: Row[]) {
    const rows = new Map(seed.map((r) => [r.id, { ...r }]));
    let seq = 0;
    const match = (r: Row, where: any): boolean => {
        if (where.userId !== undefined && r.userId !== where.userId) return false;
        if (where.id !== undefined) {
            if (typeof where.id === 'string' && r.id !== where.id) return false;
            if (where.id?.in && !where.id.in.includes(r.id)) return false;
            if (where.id?.not && r.id === where.id.not) return false;
        }
        if (where.email !== undefined && typeof where.email === 'string' && r.email !== where.email) return false;
        if (where.OR) {
            const ok = where.OR.some((c: any) => {
                const [field, cond] = Object.entries(c)[0] as [keyof Row, any];
                return String(r[field] ?? '').toLowerCase().includes(String(cond.contains).toLowerCase());
            });
            if (!ok) return false;
        }
        return true;
    };
    const db: ContactsDb = {
        contact: {
            findMany: async ({ where, take, skip }) => [...rows.values()].filter((r) => match(r, where)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).slice(skip ?? 0, (skip ?? 0) + (take ?? 1e9)),
            findFirst: async ({ where }) => [...rows.values()].find((r) => match(r, where)) ?? null,
            count: async ({ where }) => [...rows.values()].filter((r) => match(r, where)).length,
            create: async ({ data }) => {
                if ([...rows.values()].some((r) => r.userId === data.userId && r.email === data.email)) throw Object.assign(new Error('dup'), { code: 'P2002' });
                const row = { id: `n${++seq}`, externalId: null, createdAt: new Date(), ...data };
                rows.set(row.id, row);
                return row;
            },
            update: async ({ where, data }) => Object.assign(rows.get(where.id)!, data),
            deleteMany: async ({ where }) => {
                let count = 0;
                for (const r of [...rows.values()]) if (match(r, where)) { rows.delete(r.id); count++; }
                return { count };
            },
        },
    };
    // Transaccion simulada: si falla, se restaura el estado previo.
    const deps: ContactsDeps = {
        db,
        transaction: async (fn) => {
            const snapshot = new Map([...rows].map(([k, v]) => [k, { ...v }]));
            try { return await fn(db); } catch (e) { rows.clear(); snapshot.forEach((v, k) => rows.set(k, v)); throw e; }
        },
    };
    return { deps, rows };
}

const row = (id: string, email: string, over: Partial<Row> = {}): Row => ({ id, userId: 'u1', email, name: null, notes: null, source: 'local', externalId: 'ext-secret', createdAt: new Date(2026, 0, Number(id.replace(/\D/g, '')) || 1), ...over });
const call = (deps: ContactsDeps, body: Record<string, unknown>, userId = 'u1') =>
    handleContacts(deps, contactsRequest.parse({ userId, extensionId: 'ext.one', ...body }) as ContactsRequest) as Promise<any>;
const code = async (p: Promise<unknown>) => { try { await p; return 'no-error'; } catch (e) { return e instanceof BridgeError ? e.code : `other:${(e as Error).message}`; } };

describe('esquema estricto de contactos', () => {
    const base = { userId: 'u1', extensionId: 'ext.one' };
    it('claves desconocidas => rechazo; get exige exactamente uno de contactId/email', () => {
        expect(contactsRequest.safeParse({ ...base, op: 'search', args: { q: 'a', x: 1 } }).success).toBe(false);
        expect(contactsRequest.safeParse({ ...base, op: 'get', args: { contactId: 'c1', email: 'a@x.test' } }).success).toBe(false);
        expect(contactsRequest.safeParse({ ...base, op: 'get', args: {} }).success).toBe(false);
        expect(contactsRequest.safeParse({ ...base, op: 'get', args: { email: 'a@x.test' } }).success).toBe(true);
    });
    it('limites: q 1..100, mergeIds 1..10 sin keepId ni duplicados, update sin cambios', () => {
        expect(contactsRequest.safeParse({ ...base, op: 'search', args: { q: '' } }).success).toBe(false);
        expect(contactsRequest.safeParse({ ...base, op: 'search', args: { q: 'a'.repeat(101) } }).success).toBe(false);
        expect(contactsRequest.safeParse({ ...base, op: 'list', args: { offset: 100001 } }).success).toBe(false);
        expect(contactsRequest.safeParse({ ...base, op: 'merge', args: { keepId: 'a', mergeIds: [] } }).success).toBe(false);
        expect(contactsRequest.safeParse({ ...base, op: 'merge', args: { keepId: 'a', mergeIds: ['a'] } }).success).toBe(false);
        expect(contactsRequest.safeParse({ ...base, op: 'merge', args: { keepId: 'a', mergeIds: ['b', 'b'] } }).success).toBe(false);
        expect(contactsRequest.safeParse({ ...base, op: 'merge', args: { keepId: 'a', mergeIds: Array.from({ length: 11 }, (_, i) => `m${i}`) } }).success).toBe(false);
        expect(contactsRequest.safeParse({ ...base, op: 'update', args: { contactId: 'a' } }).success).toBe(false);
    });
});

describe('propiedad (IDOR)', () => {
    const fx = () => makeDeps([row('c1', 'a@x.test', { name: 'Ana' }), row('c2', 'b@x.test', { userId: 'u2', name: 'Ana' }), row('c3', 'c@x.test')]);
    it('get por id y por correo de otro usuario => null', async () => {
        const { deps } = fx();
        expect((await call(deps, { op: 'get', args: { contactId: 'c2' } })).contact).toBeNull();
        expect((await call(deps, { op: 'get', args: { email: 'b@x.test' } })).contact).toBeNull();
        expect((await call(deps, { op: 'get', args: { email: 'A@X.test' } })).contact?.id).toBe('c1');
    });
    it('search/list/suggestMerges solo ven los del usuario', async () => {
        const { deps } = fx();
        expect((await call(deps, { op: 'search', args: { q: 'ana' } })).contacts.map((c: any) => c.id)).toEqual(['c1']);
        const l = await call(deps, { op: 'list', args: {} });
        expect(l.total).toBe(2);
        expect(l.contacts.map((c: any) => c.id).sort()).toEqual(['c1', 'c3']);
        expect((await call(deps, { op: 'suggestMerges', args: {} })).groups).toEqual([]); // el otro "Ana" es de u2
    });
    it('update de un contacto ajeno => not_found', async () => {
        const { deps, rows } = fx();
        expect(await code(call(deps, { op: 'update', args: { contactId: 'c2', name: 'x' } }))).toBe('not_found');
        expect(rows.get('c2')!.name).toBe('Ana');
    });
    it('merge con un id ajeno => not_found y NO borra nada', async () => {
        const { deps, rows } = fx();
        expect(await code(call(deps, { op: 'merge', args: { keepId: 'c1', mergeIds: ['c3', 'c2'] } }))).toBe('not_found');
        expect(rows.size).toBe(3);
        expect(await code(call(deps, { op: 'merge', args: { keepId: 'c2', mergeIds: ['c3'] } }))).toBe('not_found');
        expect(rows.size).toBe(3);
    });
});

describe('operaciones', () => {
    it('no expone externalId y entrega createdAt ISO', async () => {
        const { deps } = makeDeps([row('c1', 'a@x.test')]);
        const { contact } = await call(deps, { op: 'get', args: { contactId: 'c1' } });
        expect(Object.keys(contact).sort()).toEqual(['createdAt', 'email', 'id', 'name', 'notes', 'source']);
        expect(contact.createdAt).toBe(new Date(2026, 0, 1).toISOString());
    });
    it('list pagina con nextOffset', async () => {
        const { deps } = makeDeps([1, 2, 3].map((n) => row(`c${n}`, `p${n}@x.test`)));
        const a = await call(deps, { op: 'list', args: { limit: 2, offset: 0 } });
        expect(a).toMatchObject({ total: 3, nextOffset: 2 });
        const b = await call(deps, { op: 'list', args: { limit: 2, offset: 2 } });
        expect(b.nextOffset).toBeNull();
    });
    it('create valida el correo, normaliza y NO sobreescribe uno existente', async () => {
        const { deps } = makeDeps([row('c1', 'a@x.test', { name: 'Ana' })]);
        expect(await code(call(deps, { op: 'create', args: { email: 'no-correo' } }))).toBe('invalid_args');
        const nuevo = await call(deps, { op: 'create', args: { email: ' NEW@x.test ', name: 'Nuevo\nNombre' } });
        expect(nuevo).toMatchObject({ created: true, contact: { email: 'new@x.test', name: 'Nuevo Nombre', source: 'local' } });
        const dup = await call(deps, { op: 'create', args: { email: 'a@x.test', name: 'Otro' } });
        expect(dup).toMatchObject({ created: false, contact: { id: 'c1', name: 'Ana' } });
    });
    it('update: cadena vacia borra el valor; correo repetido => conflict', async () => {
        const { deps } = makeDeps([row('c1', 'a@x.test', { name: 'Ana', notes: 'n' }), row('c2', 'b@x.test')]);
        expect((await call(deps, { op: 'update', args: { contactId: 'c1', notes: '' } })).contact.notes).toBeNull();
        expect(await code(call(deps, { op: 'update', args: { contactId: 'c1', email: 'B@x.test' } }))).toBe('conflict');
        expect((await call(deps, { op: 'update', args: { contactId: 'c1', email: 'z@x.test' } })).contact.email).toBe('z@x.test');
        expect(await code(call(deps, { op: 'update', args: { contactId: 'c1', email: 'malo' } }))).toBe('invalid_args');
    });
    it('merge: concatena notas con tope, conserva nombre y borra los fusionados', async () => {
        const big = 'x'.repeat(4000);
        const { deps, rows } = makeDeps([row('c1', 'a@x.test', { notes: big }), row('c2', 'b@x.test', { name: 'Bea', notes: big.replace(/x/g, 'y') }), row('c3', 'c@x.test')]);
        const r = await call(deps, { op: 'merge', args: { keepId: 'c1', mergeIds: ['c2', 'c3'] } });
        expect(r.merged).toBe(2);
        expect(r.contact.name).toBe('Bea');
        expect(r.contact.notes.length).toBeLessThanOrEqual(5000);
        expect(r.contact.notes.startsWith('x')).toBe(true);
        expect([...rows.keys()]).toEqual(['c1']);
    });
});

describe('suggestMerges (puro)', () => {
    it('normaliza correos: mayusculas, +etiqueta, puntos de gmail y googlemail', () => {
        expect(normalizeEmailForMerge(' Jo.Hn+news@GoogleMail.com')).toBe('john@gmail.com');
        expect(normalizeEmailForMerge('a.b@corp.test')).toBe('a.b@corp.test');
        expect(normalizeEmailForMerge('a+x@corp.test')).toBe('a@corp.test');
    });
    it('agrupa por correo normalizado y por nombre, sin duplicar un grupo ya cubierto', () => {
        const rows = [
            row('c1', 'jo.hn@gmail.com', { name: 'John' }),
            row('c2', 'john+x@gmail.com', { name: 'John' }), // mismo correo normalizado Y mismo nombre: un solo grupo
            row('c3', 'ana@a.test', { name: 'Ana  Perez' }),
            row('c4', 'ana@b.test', { name: 'ana perez' }),
            row('c5', 'solo@a.test', { name: 'Solo' }),
        ];
        const groups = suggestMergeGroups(rows, 20);
        expect(groups.map((g) => [g.reason, g.contacts.map((c) => c.id)])).toEqual([
            ['same_email_normalized', ['c1', 'c2']],
            ['same_name', ['c3', 'c4']],
        ]);
        expect(suggestMergeGroups(rows, 1)).toHaveLength(1);
    });
    it('un grupo nunca supera 11 contactos (keep + 10 fusionables)', () => {
        const rows = Array.from({ length: 15 }, (_, i) => row(`c${i + 1}`, `dup+${i}@x.test`));
        expect(suggestMergeGroups(rows, 5)[0].contacts).toHaveLength(11);
    });
});
