import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { buildAuditWhere, checkRange, escapeLike, maskIp, sanitizeAuditData, auditFiltersSchema } from '../audit-store';

describe('maskIp', () => {
    it('IPv4 a.b.x.x, IPv6 primeros dos grupos, mapeada como IPv4', () => {
        expect(maskIp('203.0.113.77')).toBe('203.0.x.x');
        expect(maskIp('2001:db8:abcd:12::1')).toBe('2001:db8:x:x:x:x:x:x');
        expect(maskIp('::ffff:198.51.100.4')).toBe('198.51.x.x');
    });
    it('vacio => null; irreconocible => ***', () => {
        expect(maskIp(null)).toBeNull();
        expect(maskIp('')).toBeNull();
        expect(maskIp('unknown')).toBe('***');
    });
});

describe('sanitizeAuditData', () => {
    const raw = {
        email: 'john.doe@example.com',
        note: 'escribe a jane@corp.com por favor',
        password: 'hunter2',
        apiKey: 'sk-live-123',
        keyId: 'k1',
        clientIp: '203.0.113.77',
        ip: '198.51.100.9',
        long: 'x'.repeat(900),
        nested: { token: 'tok', mailTo: 'bob@x.io', deeper: { secret: 's', list: ['a@b.co', 'ok'] } },
    };
    const out = sanitizeAuditData(raw);
    const text = JSON.stringify(out);

    it('no deja pasar correos, IP completas ni claves', () => {
        for (const leak of ['john.doe@example.com', 'jane@corp.com', 'hunter2', 'sk-live-123', '203.0.113.77', '198.51.100.9', 'bob@x.io', 'a@b.co', '"tok"']) {
            expect(text).not.toContain(leak);
        }
        expect(out.clientIp).toBe('203.0.x.x');
        expect(out.ip).toBe('198.51.x.x');
        expect(out.keyId).toBe('k1');
        expect(String(out.note)).toContain('j***@corp.com');
    });
    it('recorta strings largos y acepta JSON como texto o valores raros', () => {
        expect(String(out.long).length).toBeLessThan(400);
        expect(sanitizeAuditData('{"a":"x@y.com"}')).toEqual({ a: 'x***@y.com' });
        expect(sanitizeAuditData(null)).toEqual({});
        expect(sanitizeAuditData(['a@b.co'])).toEqual({ items: ['a***@b.co'] });
    });
});

describe('buildAuditWhere', () => {
    it('todo va como parametro y el prefijo escapa comodines', () => {
        const w = buildAuditWhere({ event: 'auth.*', user: "u'1; DROP TABLE x", from: '2026-01-01T00:00:00.000Z', to: '2026-01-31', q: '50%_off' });
        expect(w.sql).not.toContain('DROP');
        expect(w.sql).toContain('LIKE $1');
        expect(w.params[0]).toBe('auth.%');
        expect(w.params).toContain("u'1; DROP TABLE x");
        expect(w.params).toContain('2026-01-31T23:59:59.999Z'); // "to" solo fecha incluye todo el dia
        expect(w.params[w.params.length - 1]).toBe('%50\\%\\_off%');
    });
    it('evento exacto usa igualdad; sin filtros no hay WHERE', () => {
        expect(buildAuditWhere({ event: 'auth.login.failure' })).toMatchObject({ sql: 'WHERE "event" = $1', params: ['auth.login.failure'] });
        expect(buildAuditWhere({})).toEqual({ sql: '', params: [] });
    });
    it('escapeLike', () => expect(escapeLike('a_b%c\\d')).toBe('a\\_b\\%c\\\\d'));
});

describe('checkRange / esquema', () => {
    it('from > to y mas de 366 dias', () => {
        expect(checkRange({ from: '2026-02-01', to: '2026-01-01' })).toBe('from_after_to');
        expect(checkRange({ from: '2024-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' })).toBe('range_too_large');
        expect(checkRange({ from: '2026-01-01T00:00:00Z', to: '2026-12-31T00:00:00Z' })).toBeNull();
        expect(checkRange({ from: '2026-01-01' })).toBeNull();
    });
    it('regex de evento: mayusculas, espacios y comodin en medio se rechazan', () => {
        expect(auditFiltersSchema.safeParse({ event: 'auth.login.*' }).success).toBe(true);
        for (const bad of ['AUTH', 'a b', 'a*b', "a'b", 'x'.repeat(81)]) expect(auditFiltersSchema.safeParse({ event: bad }).success).toBe(false);
    });
});
