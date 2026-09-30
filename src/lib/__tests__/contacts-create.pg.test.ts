import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { assertLocalPg, createUser, uid } from './helpers/pg';
import { prisma } from '../prisma';

// Solo la sesion se simula; Prisma y Postgres son reales.
let currentUserId = '';
vi.mock('../session', () => ({ getCurrentUser: vi.fn(async () => (currentUserId ? { id: currentUserId, email: 'x@pg.test' } : null)) }));

import { POST } from '../../app/api/contacts/route';
import { PUT } from '../../app/api/contacts/[id]/route';

beforeAll(() => { assertLocalPg(); });
afterAll(async () => { await prisma.$disconnect(); });

const post = (body: unknown) => POST(new NextRequest('http://localhost/api/contacts', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));

describe('POST /api/contacts: crear no es upsert', () => {
    it('crea (201) y con un correo existente da 409 con el contacto existente SIN modificarlo', async () => {
        const u = await createUser(prisma);
        currentUserId = u.id;
        const email = `${uid('c')}@ejemplo.test`;

        const created = await post({ email: email.toUpperCase(), name: 'Ana', notes: 'nota original' });
        expect(created.status).toBe(201);
        const c = await created.json();
        expect(c.email).toBe(email); // normalizado

        const dup = await post({ email, name: 'Otro nombre', notes: 'pisada' });
        expect(dup.status).toBe(409);
        const body = await dup.json();
        expect(body.code).toBe('CONTACT_EXISTS');
        expect(body.existing).toMatchObject({ id: c.id, email, name: 'Ana', notes: 'nota original' });

        const stored = await prisma.contact.findUnique({ where: { id: c.id } });
        expect(stored).toMatchObject({ name: 'Ana', notes: 'nota original' }); // nada de upsert silencioso
        expect(await prisma.contact.count({ where: { userId: u.id, email } })).toBe(1);
    });

    it('carrera: dos creaciones simultaneas -> una 201 y otra 409 con el existente (nunca 500)', async () => {
        const u = await createUser(prisma);
        currentUserId = u.id;
        const email = `${uid('r')}@ejemplo.test`;
        const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => post({ email, name: `n${i}` })));
        const statuses = rs.map((r) => r.status).sort();
        expect(statuses.filter((s) => s === 201)).toHaveLength(1);
        expect(statuses.filter((s) => s === 409)).toHaveLength(5);
        for (const r of rs.filter((x) => x.status === 409)) expect((await r.json()).existing.email).toBe(email);
    });

    it('otro usuario puede tener el mismo correo (unicidad por usuario)', async () => {
        const a = await createUser(prisma);
        const b = await createUser(prisma);
        const email = `${uid('s')}@ejemplo.test`;
        currentUserId = a.id;
        expect((await post({ email })).status).toBe(201);
        currentUserId = b.id;
        expect((await post({ email })).status).toBe(201);
    });

    it('validacion y sesion: 400 con correo invalido, 401 sin sesion', async () => {
        const u = await createUser(prisma);
        currentUserId = u.id;
        expect((await post({ email: 'no-es-correo' })).status).toBe(400);
        currentUserId = '';
        expect((await post({ email: 'a@x.test' })).status).toBe(401);
    });

    it('PUT sigue actualizando el contacto existente (flujo "editar el existente")', async () => {
        const u = await createUser(prisma);
        currentUserId = u.id;
        const email = `${uid('p')}@ejemplo.test`;
        const c = await (await post({ email, name: 'Ana' })).json();
        const res = await PUT(
            new NextRequest(`http://localhost/api/contacts/${c.id}`, { method: 'PUT', body: JSON.stringify({ name: 'Ana Maria', email, notes: 'ok' }), headers: { 'content-type': 'application/json' } }),
            { params: Promise.resolve({ id: c.id }) },
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ id: c.id, name: 'Ana Maria', notes: 'ok' });
    });
});
