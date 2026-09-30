import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { assertLocalPg, createUser, uid } from './helpers/pg';
import { prisma } from '../prisma';
import { insertRule } from '../rules/store';
import { isUniqueViolation } from '../inbound-recipients';

// Webhook de correo entrante (route real) contra Postgres: idempotencia, carrera P2002 y reglas reales.
const uploads = new Map<string, unknown>();
vi.mock('@/lib/storage', () => ({ uploadToStorage: vi.fn(async (k: string, b: unknown) => { uploads.set(k, b); }) }));
vi.mock('@/lib/resend', () => ({ resend: { emails: { send: vi.fn(async () => ({ data: { id: 'x' }, error: null })) } } }));
vi.mock('@/lib/notifications/web-push', () => ({ sendNewMessagePushNotification: vi.fn(async () => undefined) }));
vi.mock('@/lib/expansions/server-hooks', () => ({ runEmailReceivedHooks: vi.fn(async () => undefined) }));

beforeAll(() => {
    assertLocalPg();
    vi.stubEnv('WEBHOOK_SECRET', '');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    for (const m of ['log', 'error', 'warn'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});
afterAll(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await prisma.$disconnect(); });

async function deliver(data: Record<string, unknown>) {
    const { POST } = await import('../../app/api/webhooks/resend/route');
    const res = await POST(new NextRequest('http://localhost/api/webhooks/resend', {
        method: 'POST', body: JSON.stringify({ type: 'email.received', data }),
    }));
    return { status: res.status, body: await res.json() };
}

const payload = (over: Record<string, unknown>) => ({
    email_id: uid('em'), message_id: `<${uid('mid')}@ext.test>`, from: 'Externo <ext@ext.test>', subject: 'Hola', text: 'hola', html: '<p>hola</p>',
    headers: {}, ...over,
});

describe('webhook resend email.received contra Postgres', () => {
    it('entrega multi-destinatario (to + cc): una fila por usuario con messageId acotado por usuario', async () => {
        const a = await createUser(prisma);
        const b = await createUser(prisma);
        const c = await createUser(prisma);
        const p = payload({ to: [a.email, b.email], cc: [c.email] });
        expect((await deliver(p)).status).toBe(200);
        for (const u of [a, b, c]) {
            const rows = await prisma.email.findMany({ where: { userId: u.id } });
            expect(rows).toHaveLength(1);
            expect(rows[0].messageId).toBe(`${p.message_id}-${u.id}`);
            expect(rows[0]).toMatchObject({ folder: 'inbox', subject: 'Hola' });
        }
    });

    it('reintento secuencial del webhook: idempotente', async () => {
        const a = await createUser(prisma);
        const p = payload({ to: [a.email] });
        await deliver(p);
        const again = await deliver(p);
        expect(again.status).toBe(200);
        expect(await prisma.email.count({ where: { userId: a.id } })).toBe(1);
    });

    it('CARRERA: el mismo webhook entregado 4 veces a la vez deja una sola fila por usuario y ningun 5xx', async () => {
        const a = await createUser(prisma);
        const b = await createUser(prisma);
        const p = payload({
            to: [a.email, b.email],
            attachments: [{ filename: 'nota.txt', content_type: 'text/plain', content: 'contenido de prueba' }],
        });
        const results = await Promise.all(Array.from({ length: 4 }, () => deliver(p)));
        expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
        for (const u of [a, b]) {
            const rows = await prisma.email.findMany({ where: { userId: u.id }, include: { attachments: true } });
            expect(rows).toHaveLength(1);
            expect(rows[0].attachments).toHaveLength(1); // el intento perdedor no deja adjuntos huerfanos (create anidado atomico)
        }
        const orphanAtts = await prisma.attachment.count({ where: { emailId: null, filename: 'nota.txt' } });
        expect(orphanAtts).toBe(0);
    });

    it('un destinatario que ya lo tenia no bloquea la entrega al que falta (reintento parcial)', async () => {
        const a = await createUser(prisma);
        const b = await createUser(prisma);
        const p = payload({ to: [a.email] });
        await deliver(p);
        const both = { ...p, to: [a.email, b.email] };
        expect((await deliver(both)).status).toBe(200);
        expect(await prisma.email.count({ where: { userId: a.id } })).toBe(1);
        expect(await prisma.email.count({ where: { userId: b.id } })).toBe(1);
    });

    it('reglas reales del usuario (SQL crudo jsonb) se aplican al ingresar: leido + destacado + carpeta', async () => {
        const a = await createUser(prisma);
        const label = await prisma.label.create({ data: { name: 'Clientes', userId: a.id } });
        await insertRule(a.id, {
            name: 'r', enabled: true, priority: 1, stopProcessing: false,
            conditions: { match: 'all', items: [{ field: 'from', op: 'contains', value: 'ext@ext.test' }, { field: 'subject', op: 'contains', value: 'factura' }] },
            actions: [{ type: 'markRead' }, { type: 'star' }, { type: 'addLabel', labelId: label.id }, { type: 'archive' }],
        });
        await deliver(payload({ to: [a.email], subject: 'Su factura' }));
        await deliver(payload({ to: [a.email], subject: 'Otra cosa' }));
        const rows = await prisma.email.findMany({ where: { userId: a.id }, include: { labels: true }, orderBy: { subject: 'asc' } });
        const [otra, fact] = rows;
        expect(fact).toMatchObject({ subject: 'Su factura', read: true, starred: true, folder: 'archive' });
        expect(fact.labels.map((l) => l.id)).toEqual([label.id]);
        expect(otra).toMatchObject({ read: false, starred: false, folder: 'inbox' });
        // markRuleRun (void, sin await) termina registrando el correo procesado
        for (let i = 0; i < 40; i++) {
            const n = (await prisma.$queryRaw<any[]>`SELECT 1 FROM "RuleRun" WHERE "userId" = ${a.id}`).length;
            if (n === 2) break;
            await new Promise((r) => setTimeout(r, 25));
        }
        expect(await prisma.$queryRaw<any[]>`SELECT 1 FROM "RuleRun" WHERE "userId" = ${a.id}`).toHaveLength(2);
    });

    it('isUniqueViolation reconoce el error real de Prisma por messageId duplicado (P2002)', async () => {
        const a = await createUser(prisma);
        const m = uid('dup');
        const mk = () => prisma.email.create({ data: { userId: a.id, messageId: m, from: 'a@b.test', to: 'c@d.test', attachments: { create: [{ filename: 'x', mimeType: 'a/b', size: 1, key: 'k' }] } } });
        await mk();
        const err = await mk().catch((e) => e);
        expect(isUniqueViolation(err)).toBe(true);
        expect(await prisma.attachment.count({ where: { key: 'k', email: { userId: a.id } } })).toBe(1);
    });

    it('eventos de estado (email.delivered) crean EmailEvent jsonb y actualizan el estado del correo', async () => {
        const a = await createUser(prisma);
        const mid = uid('resend');
        const e = await prisma.email.create({ data: { userId: a.id, messageId: mid, from: 'a@b.test', to: 'c@d.test', folder: 'sent', status: 'sent' } });
        const { POST } = await import('../../app/api/webhooks/resend/route');
        const res = await POST(new NextRequest('http://localhost/api/webhooks/resend', {
            method: 'POST', body: JSON.stringify({ type: 'email.delivered', data: { email_id: mid, to: ['c@d.test'] } }),
        }));
        expect(res.status).toBe(200);
        expect((await prisma.email.findUnique({ where: { id: e.id } }))!.status).toBe('delivered');
        const ev = await prisma.emailEvent.findFirst({ where: { resendEmailId: mid } });
        expect(ev).toMatchObject({ type: 'email.delivered', emailId: e.id });
        expect((ev!.data as any).to).toEqual(['c@d.test']);
    });
});
