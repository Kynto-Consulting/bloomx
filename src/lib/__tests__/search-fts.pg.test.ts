import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { assertLocalPg, createUser, createEmail } from './helpers/pg';
import { prisma } from '../prisma';
import { ftsEmailIds } from '../rules/search';

let currentUserId = '';
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => (currentUserId ? { id: currentUserId, email: 'x' } : null) }));
vi.mock('@/lib/resend', () => ({ resend: {} }));
vi.mock('@/lib/storage', () => ({ uploadToStorage: vi.fn(), getBufferFromStorage: vi.fn() }));

let me: { id: string; email: string };
let other: { id: string; email: string };
const ids: Record<string, string> = {};

beforeAll(async () => {
    assertLocalPg();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    me = await createUser(prisma);
    other = await createUser(prisma);
    currentUserId = me.id;
    const label = await prisma.label.create({ data: { name: 'Facturas 2026', userId: me.id } });
    const mk = async (k: string, over: Record<string, unknown>) => { ids[k] = (await createEmail(prisma, me.id, over)).id; };
    await mk('factura', { subject: 'Factura de octubre', from: 'Contabilidad <conta@empresa.test>', snippet: 'adjuntamos su factura pagada', to: me.email, labels: { connect: [{ id: label.id }] }, attachments: { create: [{ filename: 'f.pdf', mimeType: 'application/pdf', size: 1, key: 'k1' }] } });
    await mk('reunion', { subject: 'Reunion de equipo', from: 'jefe@empresa.test', snippet: 'agenda para el lunes', read: true, starred: true, to: me.email });
    await mk('spamfact', { subject: 'Factura falsa', from: 'x@spam.test', snippet: 'compra ya', folder: 'spam', to: me.email });
    await mk('octubre', { subject: 'Resumen', from: 'ventas@empresa.test', snippet: 'octubre fue un gran mes; factura pendiente', to: 'otro@dominio.test' });
    await createEmail(prisma, other.id, { subject: 'Factura ajena', snippet: 'factura secreta de otro usuario' });
});
afterAll(async () => { await prisma.$disconnect(); });

const get = async (qs: string) => {
    const { GET } = await import('../../app/api/emails/route');
    const res = await GET(new NextRequest(`http://localhost/api/emails?${qs}`));
    return { status: res.status, body: await res.json() };
};
const subjects = (b: any) => b.emails.map((e: any) => e.subject).sort();

describe('ftsEmailIds (to_tsvector / websearch_to_tsquery con $queryRawUnsafe)', () => {
    it('encuentra por asunto, remitente y snippet, y solo del usuario', async () => {
        const r = (await ftsEmailIds(prisma as any, me.id, 'factura'))!;
        expect(new Set(r)).toEqual(new Set([ids.factura, ids.spamfact, ids.octubre]));
        expect(await ftsEmailIds(prisma as any, other.id, 'factura')).toHaveLength(2 - 1);
        expect(new Set(await ftsEmailIds(prisma as any, me.id, 'contabilidad'))).toEqual(new Set([ids.factura]));
    });

    it('sintaxis websearch: frase, exclusion (-) y OR', async () => {
        expect(new Set(await ftsEmailIds(prisma as any, me.id, '"factura pendiente"'))).toEqual(new Set([ids.octubre]));
        expect(new Set(await ftsEmailIds(prisma as any, me.id, 'factura -pagada'))).toEqual(new Set([ids.spamfact, ids.octubre]));
        expect(new Set(await ftsEmailIds(prisma as any, me.id, 'reunion or contabilidad'))).toEqual(new Set([ids.reunion, ids.factura]));
    });

    it('entrada hostil no rompe la consulta (parametrizada) ni inyecta SQL', async () => {
        for (const q of ["'; DROP TABLE \"Email\"; --", '&|!()<>:*', '"sin cerrar', "o'brien", '\\', '%_']) {
            const r = await ftsEmailIds(prisma as any, me.id, q);
            expect(r === null || Array.isArray(r)).toBe(true);
        }
        expect(await prisma.email.count({ where: { userId: me.id } })).toBe(4);
    });

    it('sin resultados devuelve [] y vacio devuelve null (fallback)', async () => {
        expect(await ftsEmailIds(prisma as any, me.id, 'zzzinexistente')).toEqual([]);
        expect(await ftsEmailIds(prisma as any, me.id, '   ')).toBeNull();
    });
});

describe('GET /api/emails: busqueda + operadores contra Postgres', () => {
    it('sin sesion => 401', async () => {
        const prev = currentUserId;
        currentUserId = '';
        expect((await get('q=x')).status).toBe(401);
        currentUserId = prev;
    });

    it('texto libre (FTS) busca en todas las carpetas salvo spam/papelera', async () => {
        const { status, body } = await get('q=factura');
        expect(status).toBe(200);
        expect(subjects(body)).toEqual(['Factura de octubre', 'Resumen']);
        expect(body.total).toBe(2);
    });

    it('operadores: from:, subject:, to:, has:attachment, is:unread/read/starred, label:', async () => {
        expect(subjects((await get(`q=${encodeURIComponent('from:jefe')}`)).body)).toEqual(['Reunion de equipo']);
        expect(subjects((await get(`q=${encodeURIComponent('subject:reunion')}`)).body)).toEqual(['Reunion de equipo']);
        expect(subjects((await get(`q=${encodeURIComponent('to:otro@dominio.test')}`)).body)).toEqual(['Resumen']);
        expect(subjects((await get(`q=${encodeURIComponent('has:attachment')}`)).body)).toEqual(['Factura de octubre']);
        expect(subjects((await get(`q=${encodeURIComponent('is:read')}`)).body)).toEqual(['Reunion de equipo']);
        expect(subjects((await get(`q=${encodeURIComponent('is:starred')}`)).body)).toEqual(['Reunion de equipo']);
        expect(subjects((await get(`q=${encodeURIComponent('is:unread from:empresa')}`)).body)).toEqual(['Factura de octubre', 'Resumen']);
        expect(subjects((await get(`q=${encodeURIComponent('label:"facturas 2026"')}`)).body)).toEqual(['Factura de octubre']);
    });

    it('operadores + texto libre se combinan (AND) y aislamiento entre usuarios', async () => {
        const r = await get(`q=${encodeURIComponent('from:empresa factura')}`);
        expect(subjects(r.body)).toEqual(['Factura de octubre', 'Resumen']);
        const none = await get(`q=${encodeURIComponent('from:spam.test factura')}`);
        expect(none.body.emails).toHaveLength(0); // el correo de spam queda excluido de la busqueda global
        for (const e of r.body.emails) expect(e.userId).toBe(me.id);
    });

    it('texto sin coincidencia FTS cae al fallback contains (ILIKE) con fragmentos parciales', async () => {
        // "factur" no es un token entero (FTS simple) pero si una subcadena
        const r = await get('q=factur');
        expect(subjects(r.body)).toEqual(['Factura de octubre', 'Resumen']);
    });

    it('carpeta y paginacion sin q, y query hostil => 200', async () => {
        const inbox = await get('folder=inbox');
        expect(inbox.body.total).toBe(3);
        expect((await get('folder=spam')).body.total).toBe(1);
        expect((await get(`q=${encodeURIComponent("'\"; DELETE FROM \"Email\"; --")}`)).status).toBe(200);
        expect(await prisma.email.count({ where: { userId: me.id } })).toBe(4);
    });
});
