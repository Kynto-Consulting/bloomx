import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireAdmin = vi.fn();
const auditLog = vi.fn();
const rateLimitAsync = vi.fn();
const queryRawUnsafe = vi.fn();

vi.mock('@/lib/admin-auth', () => {
    const guardFn = (...a: unknown[]) => requireAdmin(...a);
    // adminRoute usa requireLevel(n): en estas pruebas el nivel no se evalua (lo cubre admin-levels.test / admin-cli.pg.test)
    return { requireAdmin: guardFn, requireLevel: (_min: number, ...a: unknown[]) => (guardFn as (...x: unknown[]) => unknown)(...a) };
});
vi.mock('@/lib/security', () => ({
    auditLog: (...a: unknown[]) => auditLog(...a),
    rateLimitAsync: (...a: unknown[]) => rateLimitAsync(...a),
    getClientIp: () => '9.9.9.9',
}));
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRawUnsafe: (...a: unknown[]) => queryRawUnsafe(...a) } }));

import { GET as listRoute } from '../route';
import { GET as exportRoute } from '../export/route';
import { encodeCursor } from '@/lib/admin/paging';

const okGuard = { ok: true, actor: { kind: 'manager', id: 'm1', email: 'owner@acme.com' } };
const req = (qs = '', path = 'audit') => new NextRequest(`http://localhost/api/admin/${path}${qs}`);

const SEED_ROWS = [
    {
        id: 'e2', ts: new Date('2026-09-01T10:00:00Z'), event: 'auth.login.failure', userId: 'u1', ip: '203.0.113.77',
        data: { email: 'victim@example.com', note: 'mail to jane@corp.com', password: 'hunter2', apiKey: 'sk-live-1', clientIp: '198.51.100.9', nested: { token: 'tok-1', who: 'bob@x.io' } },
    },
    { id: 'e1', ts: new Date('2026-09-01T09:00:00Z'), event: 'auth.login.success', userId: null, ip: '2001:db8:abcd::1', data: {} },
];
const LEAKS = ['victim@example.com', 'jane@corp.com', 'hunter2', 'sk-live-1', '203.0.113.77', '198.51.100.9', 'tok-1', 'bob@x.io', '2001:db8:abcd::1'];

let listRows: unknown[] = SEED_ROWS;
function installDb() {
    queryRawUnsafe.mockImplementation(async (sql: string) => {
        if (sql.includes('COUNT(*)')) return [{ n: BigInt(listRows.length) }];
        if (sql.includes('DISTINCT')) return [{ event: 'auth.login.failure' }, { event: 'auth.login.success' }];
        return listRows;
    });
}
const calls = (needle: string) => queryRawUnsafe.mock.calls.filter((c) => String(c[0]).includes(needle));

beforeEach(() => {
    requireAdmin.mockReset();
    auditLog.mockReset();
    rateLimitAsync.mockReset();
    queryRawUnsafe.mockReset();
    requireAdmin.mockResolvedValue(okGuard);
    rateLimitAsync.mockResolvedValue({ ok: true, retryAfter: 0, backend: 'memory' });
    listRows = SEED_ROWS;
    installDb();
});

describe('GET /api/admin/audit: acceso', () => {
    it('sin sesion 401 y no-admin 403, sin tocar la BD', async () => {
        requireAdmin.mockResolvedValueOnce({ ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
        expect((await listRoute(req())).status).toBe(401);
        requireAdmin.mockResolvedValueOnce({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
        expect((await listRoute(req())).status).toBe(403);
        expect(queryRawUnsafe).not.toHaveBeenCalled();
    });
});

describe('GET /api/admin/audit: filtros y paginacion', () => {
    it('los filtros viajan como parametros SQL (nunca interpolados)', async () => {
        const res = await listRoute(req('?event=auth.*&user=u%271%3BDROP&from=2026-09-01T00:00:00.000Z&to=2026-09-30T00:00:00.000Z&q=log_in'));
        expect(res.status).toBe(200);
        const [sql, ...params] = calls('ORDER BY "ts" DESC, "id" DESC')[0];
        expect(String(sql)).not.toContain('DROP');
        expect(String(sql)).toContain(`"data"->>'actorId'`);
        expect(String(sql)).toContain(`"data"->>'targetUserId'`);
        expect(params).toEqual(expect.arrayContaining(['auth.%', "u'1;DROP", '2026-09-01T00:00:00.000Z', '2026-09-30T00:00:00.000Z', '%log\\_in%']));
        expect(res.headers.get('cache-control')).toBe('no-store');
    });

    it.each([
        ['?from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z', 'from_after_to'],
        ['?from=2024-01-01T00:00:00Z&to=2026-01-01T00:00:00Z', 'range_too_large'],
        ['?from=ayer', 'invalid_input'],
        ['?event=AUTH', 'invalid_input'],
        ['?event=a*b', 'invalid_input'],
        ['?cursor=no-es-un-cursor', 'invalid_cursor'],
    ])('rechaza %s con 400 %s', async (qs, code) => {
        const res = await listRoute(req(qs));
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe(code);
        expect(queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('pageSize y page quedan acotados', async () => {
        await listRoute(req('?pageSize=100000&page=99999999'));
        const params = calls('ORDER BY "ts"')[0].slice(1);
        expect(params[params.length - 2]).toBe(101); // 100 + 1 para saber si hay mas
        expect(params[params.length - 1]).toBe(9999 * 100); // offset maximo
    });

    it('con cursor usa comparacion de fila (ts, id) y no OFFSET; devuelve nextCursor si hay mas', async () => {
        listRows = [...SEED_ROWS, { ...SEED_ROWS[1], id: 'e0' }];
        const cursor = encodeCursor({ ts: '2026-09-02T00:00:00.000Z', id: 'zzz' });
        const res = await listRoute(req(`?pageSize=2&cursor=${cursor}`));
        const [sql, ...params] = calls('ORDER BY "ts"')[0];
        expect(String(sql)).toContain('("ts", "id") < ($1::timestamptz, $2)');
        expect(String(sql)).not.toContain('OFFSET');
        expect(params.slice(0, 2)).toEqual(['2026-09-02T00:00:00.000Z', 'zzz']);
        const body = await res.json();
        expect(body.items).toHaveLength(2);
        expect(body.nextCursor).toEqual(expect.any(String));
    });

    it('respuesta: total, tipos de evento, y ENMASCARADA (correos, IP, claves)', async () => {
        const res = await listRoute(req());
        const text = await res.text();
        const body = JSON.parse(text);
        expect(body).toMatchObject({ available: true, total: 2, page: 1, eventTypes: ['auth.login.failure', 'auth.login.success'] });
        for (const leak of LEAKS) expect(text).not.toContain(leak);
        expect(body.items[0]).toMatchObject({ id: 'e2', event: 'auth.login.failure', userId: 'u1', ip: '203.0.x.x' });
        expect(body.items[0].data.clientIp).toBe('198.51.x.x');
        expect(body.items[0].data).not.toHaveProperty('password');
        expect(body.items[1].ip).toBe('2001:db8:x:x:x:x:x:x');
    });

    it('sin tabla: available false y lista vacia (no 500)', async () => {
        queryRawUnsafe.mockRejectedValue(Object.assign(new Error('relation "AuditEvent" does not exist'), { code: '42P01' }));
        const res = await listRoute(req());
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ available: false, items: [], total: 0 });
    });
});

describe('GET /api/admin/audit/export', () => {
    it('CSV con columnas en lista blanca, enmascarado, anti-formulas y auditado', async () => {
        listRows = [
            { id: 'e9', ts: new Date('2026-09-01T10:00:00Z'), event: '=cmd|calc', userId: '+1234', ip: '203.0.113.77', data: { note: '@evil', email: 'victim@example.com', password: 'hunter2' } },
            SEED_ROWS[0],
        ];
        const res = await exportRoute(req('?event=auth.*', 'audit/export'));
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/csv');
        expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="audit-\d{4}-\d{2}-\d{2}\.csv"/);
        const csv = await res.text();
        expect(csv).toContain('timestamp,event,userId,ip,data');
        expect(csv).toContain("'=cmd|calc"); // formula neutralizada
        expect(csv).toContain("'+1234");
        for (const leak of [...LEAKS, 'hunter2']) expect(csv).not.toContain(leak);
        expect(String(calls('LIMIT 10000')[0][0])).toContain('LIMIT 10000');
        expect(auditLog).toHaveBeenCalledWith('admin.audit.exported', expect.objectContaining({ rows: 2, event: 'auth.*', actorId: 'm1' }));
    });

    it('valida el rango, exige admin y respeta el rate limit estricto', async () => {
        expect((await exportRoute(req('?from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z', 'audit/export'))).status).toBe(400);
        requireAdmin.mockResolvedValueOnce({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
        expect((await exportRoute(req('', 'audit/export'))).status).toBe(403);
        rateLimitAsync.mockResolvedValueOnce({ ok: false, retryAfter: 30, backend: 'memory' });
        const res = await exportRoute(req('', 'audit/export'));
        expect(res.status).toBe(429);
        expect(rateLimitAsync).toHaveBeenLastCalledWith('admin:audit.export:m1', 10, 600_000);
    });

    it('sin tabla exporta solo la cabecera', async () => {
        queryRawUnsafe.mockRejectedValue(Object.assign(new Error('does not exist'), { code: '42P01' }));
        const csv = await (await exportRoute(req('', 'audit/export'))).text();
        expect(csv.trim().replace(/^﻿/, '')).toBe('timestamp,event,userId,ip,data');
    });
});
