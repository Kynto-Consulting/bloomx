import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const requireAdmin = vi.fn();
const auditLog = vi.fn();
const rateLimitAsync = vi.fn();

vi.mock('@/lib/admin-auth', () => ({ requireAdmin: (...a: unknown[]) => requireAdmin(...a) }));
vi.mock('@/lib/security', () => ({
    auditLog: (...a: unknown[]) => auditLog(...a),
    rateLimitAsync: (...a: unknown[]) => rateLimitAsync(...a),
    getClientIp: () => '9.9.9.9',
}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { NextRequest, NextResponse } from 'next/server';
import { HttpError, adminRoute, audit, badRequest, parseBody, parseQuery } from '../http';
import { csvCell, toCsv, csvResponse } from '../csv';
import { decodeCursor, encodeCursor, pageMeta, parsePaging } from '../paging';
import { isMissingRelation, likeContains, num, pickOrder, tolerant } from '../sql';

const req = (url = 'http://localhost/api/admin/x', init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(url, init);
const okGuard = { ok: true, actor: { kind: 'manager', id: 'm1', email: 'owner@acme.com' } };

beforeEach(() => {
    requireAdmin.mockReset();
    auditLog.mockReset();
    rateLimitAsync.mockReset();
    rateLimitAsync.mockResolvedValue({ ok: true, retryAfter: 0, backend: 'memory' });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('adminRoute', () => {
    it('sin sesion / no admin: devuelve la respuesta del guardia y NO ejecuta el handler ni el rate limit', async () => {
        requireAdmin.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
        const handler = vi.fn();
        const res = await adminRoute({ scope: 't' }, handler)(req());
        expect(res.status).toBe(403);
        expect(handler).not.toHaveBeenCalled();
        expect(rateLimitAsync).not.toHaveBeenCalled();
    });

    it('admin valido: ejecuta, responde JSON con no-store y usa rate limit asincrono por admin+ambito', async () => {
        requireAdmin.mockResolvedValue(okGuard);
        const res = await adminRoute({ scope: 'users.read', limit: 7 }, async () => ({ hello: 'world' }))(req());
        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(await res.json()).toEqual({ hello: 'world' });
        expect(rateLimitAsync).toHaveBeenCalledWith('admin:users.read:m1', 7, 60_000);
    });

    it('las escrituras tienen un limite por defecto mas bajo que las lecturas', async () => {
        requireAdmin.mockResolvedValue(okGuard);
        await adminRoute({ scope: 'a', write: true }, async () => ({}))(req());
        await adminRoute({ scope: 'b' }, async () => ({}))(req());
        expect(rateLimitAsync.mock.calls[0][1]).toBeLessThan(rateLimitAsync.mock.calls[1][1]);
    });

    it('rate limit excedido -> 429 con Retry-After', async () => {
        requireAdmin.mockResolvedValue(okGuard);
        rateLimitAsync.mockResolvedValue({ ok: false, retryAfter: 42, backend: 'memory' });
        const res = await adminRoute({ scope: 't' }, async () => ({}))(req());
        expect(res.status).toBe(429);
        expect(res.headers.get('retry-after')).toBe('42');
    });

    it('HttpError conserva estado y codigo; un error inesperado da 500 generico sin detalles', async () => {
        requireAdmin.mockResolvedValue(okGuard);
        const nf = await adminRoute({ scope: 't' }, async () => { throw new HttpError(404, 'not_found'); })(req());
        expect(nf.status).toBe(404);
        expect((await nf.json()).code).toBe('not_found');

        const boom = await adminRoute({ scope: 't' }, async () => { throw new Error('password=hunter2 SELECT secret'); })(req());
        expect(boom.status).toBe(500);
        const body = JSON.stringify(await boom.json());
        expect(body).not.toContain('hunter2');
        expect(body).not.toContain('SELECT');
    });

    it('resuelve params dinamicos (Next 16: Promise)', async () => {
        requireAdmin.mockResolvedValue(okGuard);
        const res = await adminRoute<{ id: string }>({ scope: 't' }, async (_c, { id }) => ({ id }))(req(), { params: Promise.resolve({ id: 'u1' }) });
        expect(await res.json()).toEqual({ id: 'u1' });
    });
});

describe('parseBody / parseQuery', () => {
    const schema = z.object({ email: z.string().email(), n: z.coerce.number().int().min(1).max(5).optional() });

    it('valida y NO repite los valores recibidos en el error', async () => {
        const r = new Request('http://x', { method: 'POST', body: JSON.stringify({ email: 'super-secreto-no-email' }) });
        const err = await parseBody(r, schema).catch((e) => e);
        expect(err).toBeInstanceOf(HttpError);
        expect(err.status).toBe(400);
        expect(err.message).not.toContain('super-secreto');
        expect(err.message).toContain('email');
    });

    it('rechaza JSON invalido y cuerpos enormes', async () => {
        expect((await parseBody(new Request('http://x', { method: 'POST', body: '{no' }), schema).catch((e) => e)).code).toBe('invalid_json');
        const big = await parseBody(new Request('http://x', { method: 'POST', body: JSON.stringify({ email: 'a@b.co', pad: 'x'.repeat(70_000) }) }), schema).catch((e) => e);
        expect(big.status).toBe(413);
    });

    it('parseQuery toma la primera aparicion y aplica el esquema', () => {
        expect(parseQuery(new Request('http://x?email=a@b.co&n=3&n=9'), schema)).toEqual({ email: 'a@b.co', n: 3 });
        expect(() => parseQuery(new Request('http://x?email=a@b.co&n=99'), schema)).toThrow(HttpError);
    });

    it('badRequest crea un 400', () => expect(badRequest('x').status).toBe(400));
});

describe('audit()', () => {
    it('userId = usuario afectado, actor siempre registrado, prefijo admin.', () => {
        audit({ req: req(), actor: { kind: 'user', id: 'admin1', email: 'a@x.com' }, ip: '1.1.1.1' }, 'users.mfa_reset', { targetUserId: 'u9', extra: 1 });
        expect(auditLog).toHaveBeenCalledWith('admin.users.mfa_reset', expect.objectContaining({ userId: 'u9', targetUserId: 'u9', actorId: 'admin1', actorKind: 'user', ip: '1.1.1.1', extra: 1 }));
    });
    it('sin afectado, userId = actor', () => {
        audit({ req: req(), actor: { kind: 'manager', id: 'm1' }, ip: 'i' }, 'x');
        expect(auditLog.mock.calls[0][1]).toMatchObject({ userId: 'm1', actorKind: 'manager' });
    });
});

describe('csv', () => {
    it('comillas RFC 4180 y neutraliza inyeccion de formulas', () => {
        expect(csvCell('a,b')).toBe('"a,b"');
        expect(csvCell('di "hola"')).toBe('"di ""hola"""');
        expect(csvCell('linea\nnueva')).toBe('"linea\nnueva"');
        for (const evil of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tx']) expect(csvCell(evil).replace(/^"/, '')).toMatch(/^'/);
        expect(csvCell(-5)).toBe('-5');
        expect(csvCell(null)).toBe('');
        expect(csvCell(new Date('2026-01-02T03:04:05Z'))).toBe('2026-01-02T03:04:05.000Z');
    });
    it('toCsv solo emite las columnas pedidas (lista blanca)', () => {
        const out = toCsv([{ a: 1, b: 'x', secret: 'NO' }], [{ key: 'a', header: 'A' }, { key: 'b', header: 'B' }]);
        expect(out).toBe('A,B\r\n1,x\r\n');
        expect(out).not.toContain('NO');
    });
    it('csvResponse: cabeceras seguras y nombre saneado', async () => {
        const r = csvResponse('a\r\n', 'in/../vá lido.csv');
        expect(r.headers.get('content-type')).toContain('text/csv');
        expect(r.headers.get('content-disposition')).toBe('attachment; filename="in_.._v__lido.csv"');
        expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    });
});

describe('paging', () => {
    it('acota pageSize y page', () => {
        expect(parsePaging(new URLSearchParams('page=0&pageSize=9999'))).toEqual({ page: 1, pageSize: 100, offset: 0 });
        expect(parsePaging(new URLSearchParams('page=3&pageSize=10'))).toEqual({ page: 3, pageSize: 10, offset: 20 });
        expect(parsePaging(new URLSearchParams('page=99999999')).page).toBe(10_000);
        expect(parsePaging(new URLSearchParams('page=abc&pageSize=-4'))).toEqual({ page: 1, pageSize: 1, offset: 0 });
        expect(pageMeta({ page: 1, pageSize: 25, offset: 0 }, 51).pages).toBe(3);
        expect(pageMeta({ page: 1, pageSize: 25, offset: 0 }, 0).pages).toBe(1);
    });
    it('cursor ida y vuelta; rechaza basura', () => {
        const c = encodeCursor({ ts: '2026-01-01T00:00:00.000Z', id: 'abc' });
        expect(decodeCursor(c)).toEqual({ ts: '2026-01-01T00:00:00.000Z', id: 'abc' });
        expect(decodeCursor('%%%')).toBeNull();
        expect(decodeCursor(Buffer.from(JSON.stringify({ ts: 'no', id: 'x' })).toString('base64url'))).toBeNull();
        expect(decodeCursor('x'.repeat(600))).toBeNull();
    });
});

describe('sql helpers', () => {
    it('likeContains escapa comodines', () => expect(likeContains('50%_a\\b')).toBe('%50\\%\\_a\\\\b%'));
    it('pickOrder solo acepta la lista blanca', () => {
        const allowed = { createdAt: '"createdAt"', email: '"email"' };
        expect(pickOrder(allowed, 'email', 'createdAt')).toBe('"email"');
        expect(pickOrder(allowed, '"; DROP TABLE "User"; --', 'createdAt')).toBe('"createdAt"');
        expect(pickOrder(allowed, 'constructor', 'createdAt')).toBe('"createdAt"');
    });
    it('isMissingRelation / tolerant', async () => {
        expect(isMissingRelation({ code: '42P01' })).toBe(true);
        expect(isMissingRelation(new Error('relation "X" does not exist'))).toBe(true);
        expect(isMissingRelation(new Error('connection refused'))).toBe(false);
        expect(await tolerant(async () => { throw Object.assign(new Error('x'), { code: '42703' }); }, 'fb')).toBe('fb');
        await expect(tolerant(async () => { throw new Error('boom'); }, 'fb')).rejects.toThrow('boom');
    });
    it('num convierte bigint', () => { expect(num(BigInt(7))).toBe(7); expect(num(undefined)).toBe(0); expect(num('x')).toBe(0); });
});
