import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Rutas /api/admin/mail/** con dobles (sin BD, red ni backend): 401/403, validacion, SQL parametrizado,
 * privacidad (sin asuntos/cuerpos), auditoria y secretos.
 */

const SECRET_INBOUND = 'whsec_INBOUND_SECRET_VALUE_1234567890';
const SECRET_EVENTS = 'whsec_EVENTS_SECRET_VALUE_0987654321';

interface Call { sql: string; params: unknown[] }
let calls: Call[];
let admin: 'ok' | 401 | 403;
let handler: (sql: string, params: unknown[]) => unknown[];
let auditLog: ReturnType<typeof vi.fn>;
let getDnsHealth: ReturnType<typeof vi.fn>;

async function setup() {
    vi.resetModules();
    calls = [];
    auditLog = vi.fn();
    getDnsHealth = vi.fn(async (domain: string) => ({ configured: true, domain, checkedAt: 'x', spf: null, dkim: null, dmarc: null, mx: null }));
    vi.doMock('@/lib/admin-auth', async () => {
        const { NextResponse } = await import('next/server');
        const requireAdmin = async () => admin === 'ok'
            ? { ok: true, actor: { kind: 'user', id: 'admin1', email: 'admin@acme.com' } }
            : { ok: false, response: NextResponse.json({ error: 'x' }, { status: admin }) };
        return { requireAdmin, requireLevel: async () => requireAdmin() };
    });
    vi.doMock('@/lib/security', () => ({
        auditLog,
        getClientIp: () => '9.9.9.9',
        rateLimitAsync: async () => ({ ok: true, retryAfter: 0 }),
    }));
    vi.doMock('@/lib/prisma', () => ({
        prisma: {
            $queryRawUnsafe: async (sql: string, ...params: unknown[]) => { calls.push({ sql, params }); return handler(sql, params); },
            $executeRawUnsafe: async () => 0,
        },
    }));
    vi.doMock('@/lib/admin/dns-health', async () => ({ ...(await vi.importActual<object>('@/lib/admin/dns-health')), getDnsHealth }));
    const { NextRequest } = await import('next/server');
    const mk = (p: string, method = 'GET', body?: unknown) =>
        new NextRequest(`http://localhost${p}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    return {
        mk,
        metrics: await import('../metrics/route'),
        suppressions: await import('../suppressions/route'),
        suppressionId: await import('../suppressions/[id]/route'),
        bulk: await import('../suppressions/bulk-delete/route'),
        webhooks: await import('../webhooks/route'),
        dns: await import('../dns/route'),
    };
}

beforeEach(() => {
    admin = 'ok';
    handler = () => [];
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('TOP_DOMAIN', 'mail.acme.com:3000');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    vi.stubEnv('WEBHOOK_SECRET', '');
    vi.stubEnv('RESEND_WEBHOOK_SECRET', '');
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules(); });

const PRIVATE_COLUMNS = /"subject"|"snippet"|"htmlKey"|"textKey"|"rawKey"|"filename"|"cc"|"bcc"|"replyTo"|"from"|"to"/;

describe('acceso', () => {
    it.each([401, 403] as const)('todas las rutas devuelven %i a quien no es admin', async (status) => {
        const m = await setup();
        admin = status;
        const res = [
            await m.metrics.GET(m.mk('/api/admin/mail/metrics')),
            await m.suppressions.GET(m.mk('/api/admin/mail/suppressions')),
            await m.suppressionId.DELETE(m.mk('/api/admin/mail/suppressions/x', 'DELETE'), { params: Promise.resolve({ id: 'x' }) }),
            await m.bulk.POST(m.mk('/api/admin/mail/suppressions/bulk-delete', 'POST', { ids: ['a'] })),
            await m.webhooks.GET(m.mk('/api/admin/mail/webhooks')),
            await m.dns.GET(m.mk('/api/admin/mail/dns')),
        ];
        expect(res.map((r) => r.status)).toEqual(Array(6).fill(status));
        expect(calls).toHaveLength(0);
        expect(auditLog).not.toHaveBeenCalled();
    });
});

describe('GET /metrics', () => {
    it('rango invalido -> 400 sin repetir el valor y sin tocar la BD', async () => {
        const m = await setup();
        const res = await m.metrics.GET(m.mk('/api/admin/mail/metrics?range=90d%27%3B--'));
        expect(res.status).toBe(400);
        expect(JSON.stringify(await res.json())).not.toContain('90d');
        expect(calls).toHaveLength(0);
    });

    it('rango por defecto 7d: serie rellena, parametros SQL sin interpolar, sin columnas privadas', async () => {
        const m = await setup();
        handler = (sql) => {
            if (sql.includes('FROM "Email" WHERE "createdAt"')) return [{ bucket: new Date().toISOString().slice(0, 10), sent: BigInt(3), received: BigInt(5), spam: BigInt(1) }];
            if (sql.includes('FROM "EmailEvent"')) return [{ bucket: new Date().toISOString().slice(0, 10), reason: 'bounce', n: BigInt(2) }, { bucket: new Date().toISOString().slice(0, 10), reason: 'complaint', n: BigInt(1) }];
            if (sql.includes('"folder" = \'scheduled\'')) return [{ pending: BigInt(2), overdue: BigInt(1), oldest: new Date('2030-01-01T00:00:00Z') }];
            if (sql.includes('COUNT(*) AS n\n                   FROM "Email" e')) return [{ id: 'u1', email: 'a@acme.com', n: BigInt(150) }];
            if (sql.includes('FILTER (WHERE e."folder"')) return [{ id: 'u1', email: 'a@acme.com', sent: BigInt(10), received: BigInt(20) }];
            return [];
        };
        const res = await m.metrics.GET(m.mk('/api/admin/mail/metrics'));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.range).toBe('7d');
        expect(body.series).toHaveLength(7);
        expect(body.totals).toMatchObject({ sent: 3, received: 5, spam: 1, bounces: 2, complaints: 1 });
        expect(body.blockedAttachments.available).toBe(true);
        expect(body.domain).toBe('mail.acme.com');
        expect(body.scheduled).toMatchObject({ pending: 2, overdue: 1 });
        expect(body.quota.limit).toBe(200);
        expect(body.quota.topLastHour[0]).toMatchObject({ email: 'a@acme.com', sentLastHour: 150, percent: 75 });
        expect(body.quota.topRange[0]).toMatchObject({ total: 30 });

        for (const c of calls) {
            expect(c.sql).not.toMatch(PRIVATE_COLUMNS);
            for (const p of c.params) expect(typeof p).toBe('string'); // solo fechas ISO
            expect(c.sql).not.toMatch(/\d{4}-\d{2}-\d{2}/); // nada de fechas pegadas en el SQL
        }
        // Privacidad: la respuesta no lleva ninguno de estos campos
        expect(JSON.stringify(body)).not.toMatch(/"(subject|snippet|html|body|text|filename|from|to|recipient)"/);
    });

    it('24h usa cubos por hora', async () => {
        const m = await setup();
        const body = await (await m.metrics.GET(m.mk('/api/admin/mail/metrics?range=24h'))).json();
        expect(body.granularity).toBe('hour');
        expect(body.series).toHaveLength(24);
    });

    it('sin tabla Attachment: blockedAttachments.available=false (no se inventan datos)', async () => {
        const m = await setup();
        handler = (sql) => {
            if (sql.includes('"Attachment"')) throw Object.assign(new Error('relation "Attachment" does not exist'), { code: '42P01' });
            return [];
        };
        const body = await (await m.metrics.GET(m.mk('/api/admin/mail/metrics'))).json();
        expect(body.blockedAttachments.available).toBe(false);
        expect(body.totals.blocked).toBe(0);
    });

    it('otros errores de BD -> 500 generico sin detalle', async () => {
        const m = await setup();
        handler = () => { throw new Error('password authentication failed for user secretuser'); };
        const res = await m.metrics.GET(m.mk('/api/admin/mail/metrics'));
        expect(res.status).toBe(500);
        expect(JSON.stringify(await res.json())).not.toContain('secretuser');
    });
});

describe('GET /suppressions', () => {
    it('filtros -> parametros, nunca interpolados; pagina acotada', async () => {
        const m = await setup();
        const evil = "x'; DROP TABLE \"User\"; --";
        handler = (sql) => sql.startsWith('SELECT COUNT') ? [{ n: BigInt(1) }] : [{ id: 'e1', recipient: 'r@x.com', reason: 'bounce', createdAt: new Date('2030-01-02T00:00:00Z'), senderEmail: 's@acme.com' }];
        const res = await m.suppressions.GET(m.mk(`/api/admin/mail/suppressions?q=${encodeURIComponent(evil)}&reason=bounce&page=2&pageSize=5000`));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({ page: 2, pageSize: 100, total: 1, items: [{ id: 'e1', recipient: 'r@x.com', reason: 'bounce', senderEmail: 's@acme.com' }] });
        for (const c of calls) {
            expect(c.sql).not.toContain('DROP TABLE');
            expect(c.sql).not.toContain(evil);
            expect(c.sql).not.toMatch(PRIVATE_COLUMNS);
        }
        const list = calls[1];
        expect(list.params).toEqual(['bounce', `%${evil.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, 100, 100]);
        expect(list.sql).toContain(`ev."data"->>'recipient'`);
        expect(list.sql).toContain('LIMIT $3 OFFSET $4');
        expect(JSON.stringify(body)).not.toMatch(/subject|snippet|html/);
    });

    it('motivo invalido -> 400', async () => {
        const m = await setup();
        expect((await m.suppressions.GET(m.mk('/api/admin/mail/suppressions?reason=nope'))).status).toBe(400);
    });
});

describe('DELETE /suppressions/[id]', () => {
    const del = (m: Awaited<ReturnType<typeof setup>>, id: string) =>
        m.suppressionId.DELETE(m.mk(`/api/admin/mail/suppressions/${id}`, 'DELETE'), { params: Promise.resolve({ id }) });

    it('borra, audita con el destinatario ENMASCARADO y el motivo', async () => {
        const m = await setup();
        handler = () => [{ id: 'e1', recipient: 'victima@example.com', reason: 'complaint', sender: 'u7' }];
        const res = await del(m, 'e1');
        expect(res.status).toBe(200);
        expect(calls[0].sql).toContain(`"type" = 'unsubscribe'`);
        expect(calls[0].params).toEqual([['e1']]);
        expect(auditLog).toHaveBeenCalledTimes(1);
        const [event, data] = auditLog.mock.calls[0];
        expect(event).toBe('admin.mail.suppression_removed');
        expect(data).toMatchObject({ recipientEmail: 'v***@example.com', reason: 'complaint', userId: 'admin1', actorId: 'admin1', suppressionId: 'e1' });
        expect(JSON.stringify(data)).not.toContain('victima');
    });

    it('404 si no existe o no es de tipo unsubscribe (no se audita)', async () => {
        const m = await setup();
        handler = () => [];
        const res = await del(m, 'nope');
        expect(res.status).toBe(404);
        expect(auditLog).not.toHaveBeenCalled();
    });

    it('id demasiado largo -> 400 sin tocar la BD', async () => {
        const m = await setup();
        expect((await del(m, 'x'.repeat(201))).status).toBe(400);
        expect(calls).toHaveLength(0);
    });
});

describe('POST /suppressions/bulk-delete', () => {
    it('acotado a 100 ids: 101 -> 400, vacio -> 400, cuerpo invalido -> 400', async () => {
        const m = await setup();
        const ids = (n: number) => Array.from({ length: n }, (_, i) => `id${i}`);
        expect((await m.bulk.POST(m.mk('/x', 'POST', { ids: ids(101) }))).status).toBe(400);
        expect((await m.bulk.POST(m.mk('/x', 'POST', { ids: [] }))).status).toBe(400);
        expect((await m.bulk.POST(m.mk('/x', 'POST', { ids: [1, 2] }))).status).toBe(400);
        expect((await m.bulk.POST(m.mk('/x', 'POST', { ids: ['x'.repeat(201)] }))).status).toBe(400);
        expect(calls).toHaveLength(0);
    });

    it('100 ids -> borra con un solo parametro array, audita una vez con destinatarios enmascarados', async () => {
        const m = await setup();
        const ids = Array.from({ length: 100 }, (_, i) => `id${i}`);
        handler = () => [
            { id: 'id0', recipient: 'ana@example.com', reason: 'bounce', sender: 'u1' },
            { id: 'id1', recipient: 'luis@example.com', reason: 'unsubscribe', sender: 'u1' },
        ];
        const res = await m.bulk.POST(m.mk('/x', 'POST', { ids: [...ids.slice(0, 99), 'id0'] })); // 100 entradas con un duplicado: se normaliza
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ removed: 2, requested: 99 });
        expect(calls).toHaveLength(1);
        expect(calls[0].params).toEqual([ids.slice(0, 99)]);
        expect(auditLog).toHaveBeenCalledTimes(1);
        const [event, data] = auditLog.mock.calls[0];
        expect(event).toBe('admin.mail.suppressions_bulk_removed');
        expect(data).toMatchObject({ count: 2, byReason: { bounce: 1, unsubscribe: 1 }, recipients: ['a***@example.com', 'l***@example.com'] });
        expect(JSON.stringify(data)).not.toMatch(/ana@|luis@/);
    });

    it('nada borrado -> no audita', async () => {
        const m = await setup();
        const res = await m.bulk.POST(m.mk('/x', 'POST', { ids: ['a'] }));
        expect(await res.json()).toMatchObject({ removed: 0 });
        expect(auditLog).not.toHaveBeenCalled();
    });
});

describe('GET /webhooks', () => {
    it('sin secretos configurados: firma opcional, rutas relativas, sin exponer nada', async () => {
        const m = await setup();
        const body = await (await m.webhooks.GET(m.mk('/api/admin/mail/webhooks'))).json();
        expect(body.inbound).toMatchObject({ path: '/api/webhooks/resend', url: null, signatureConfigured: false, lastReceivedAt: null });
        expect(body.events).toMatchObject({ path: '/api/webhooks/resend-events', signatureConfigured: false });
        expect(body.baseUrl).toBeNull();
    });

    it('con secretos: solo booleanos y fechas; ningun valor de secreto aparece en el JSON', async () => {
        vi.stubEnv('WEBHOOK_SECRET', SECRET_INBOUND);
        vi.stubEnv('RESEND_WEBHOOK_SECRET', SECRET_EVENTS);
        vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mail.acme.com/');
        const m = await setup();
        handler = (sql) => [{ at: sql.includes('"Email"') ? new Date('2030-03-01T10:00:00Z') : new Date('2030-03-02T10:00:00Z') }];
        const res = await m.webhooks.GET(m.mk('/api/admin/mail/webhooks'));
        const text = JSON.stringify(await res.clone().json());
        expect(text).not.toContain(SECRET_INBOUND);
        expect(text).not.toContain(SECRET_EVENTS);
        expect(text).not.toContain('whsec_');
        const body = await res.json();
        expect(body.inbound).toMatchObject({ url: 'https://mail.acme.com/api/webhooks/resend', signatureConfigured: true, lastReceivedAt: '2030-03-01T10:00:00.000Z' });
        expect(body.events).toMatchObject({ url: 'https://mail.acme.com/api/webhooks/resend-events', signatureConfigured: true, lastEventAt: '2030-03-02T10:00:00.000Z' });
        expect(calls.some((c) => c.sql.includes(`IN ('bounce','complaint')`))).toBe(true);
    });
});

describe('GET /dns', () => {
    it('selector invalido -> 400 y no consulta DNS', async () => {
        const m = await setup();
        for (const bad of ['a.b', '-x', 'a%20b', 'x'.repeat(64), '..%2F..']) {
            expect((await m.dns.GET(m.mk(`/api/admin/mail/dns?selector=${bad}`))).status).toBe(400);
        }
        expect(getDnsHealth).not.toHaveBeenCalled();
    });

    it('usa SOLO el dominio de la instancia, ignora un dominio del cliente; selector normalizado', async () => {
        const m = await setup();
        const res = await m.dns.GET(m.mk('/api/admin/mail/dns?domain=evil.com&host=evil.com&selector=Resend&fresh=1'));
        expect(res.status).toBe(200);
        expect(getDnsHealth).toHaveBeenCalledTimes(1);
        expect(getDnsHealth).toHaveBeenCalledWith('mail.acme.com', { selector: 'resend', fresh: true });
        expect((await res.json()).domain).toBe('mail.acme.com');
    });

    it('sin dominio configurado -> configured:false y sin consultas', async () => {
        vi.stubEnv('TOP_DOMAIN', '');
        const m = await setup();
        const body = await (await m.dns.GET(m.mk('/api/admin/mail/dns'))).json();
        expect(body).toMatchObject({ configured: false, domain: null });
        expect(getDnsHealth).not.toHaveBeenCalled();
    });
});

describe('MAX_SENDS_PER_HOUR', () => {
    it('coincide con el de POST /api/emails (misma variable y defecto)', () => {
        const route = readFileSync(path.resolve(__dirname, '../../../emails/route.ts'), 'utf8');
        const store = readFileSync(path.resolve(__dirname, '../../../../../lib/admin/mail-store.ts'), 'utf8');
        const re = /const MAX_SENDS_PER_HOUR = Number\.parseInt\(process\.env\.MAX_SENDS_PER_HOUR \|\| '(\d+)', 10\) \|\| (\d+);/;
        const a = re.exec(route);
        const b = re.exec(store);
        expect(a).not.toBeNull();
        expect(b).not.toBeNull();
        expect(b![1]).toBe(a![1]);
        expect(b![2]).toBe(a![2]);
    });
});
