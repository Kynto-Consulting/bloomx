import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { assertLocalPg, createEmail, createUser, uid } from './helpers/pg';
import { prisma } from '../prisma';

// Programados (reprogramar / enviar ahora / editar / eliminar) contra Postgres REAL con un Resend SIMULADO (fetch global):
// nunca se llama al Resend de verdad. `npm run test:pg`.

const STARTED_AT = new Date(Date.now() - 1000);
let sessionUser: { id: string; email: string; name: string } | null = null;
const fireHook = vi.fn();
const resendSend = vi.fn();
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => sessionUser }));
vi.mock('@/lib/resend', () => ({ resend: { emails: { send: (...a: unknown[]) => resendSend(...a), get: vi.fn(async () => ({ data: null })) } } }));
vi.mock('@/lib/storage', () => ({
    uploadToStorage: vi.fn(async () => undefined),
    getBufferFromStorage: vi.fn(async (key: string) => (key.startsWith('att/ok') ? Buffer.from('DATA') : null)),
    getFromStorage: vi.fn(async (key: string) => (key === 'sent/x/body.html' ? '<p>Hola <b>mundo</b></p>' : null)),
}));
vi.mock('@/lib/notifications/web-push', () => ({ sendNewMessagePushNotification: vi.fn(async () => undefined) }));
vi.mock('@/lib/expansions/server-hooks', () => ({
    runEmailPreSendHooksForRequest: async () => ({ stop: false, modify: {}, warnings: [] }),
    runEmailReceivedHooks: vi.fn(async () => undefined),
    buildEmailSentContext: (i: Record<string, unknown>) => ({ emailId: i.emailId }),
    fireLifecycleHook: (...a: unknown[]) => fireHook(...a),
}));

interface Call { method: string; url: string; body: any; auth: string | null; key: string | null }
const calls: Call[] = [];
let provider: (c: Call) => { status: number; json?: unknown } | 'throw' = () => ({ status: 200, json: {} });

let me: { id: string; email: string; name: string };
let other: { id: string };

beforeAll(async () => {
    assertLocalPg();
    vi.stubEnv('RESEND_BASE_URL', 'http://resend.test');
    vi.stubEnv('RESEND_API_KEY', 're_test_key');
    vi.stubEnv('WEBHOOK_SECRET', '');
    if (!process.env.DEBUG_PG) for (const m of ['log', 'error', 'warn'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        const c: Call = {
            method: String(init?.method ?? 'GET'), url: String(url),
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
            auth: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null,
            key: (init?.headers as Record<string, string> | undefined)?.['Idempotency-Key'] ?? null,
        };
        calls.push(c);
        const r = provider(c);
        if (r === 'throw') throw new Error('network down');
        return new Response(JSON.stringify(r.json ?? {}), { status: r.status });
    }));
    const u = await createUser(prisma);
    me = { id: u.id, email: u.email, name: 'Yo' };
    other = await createUser(prisma);
});
beforeEach(() => {
    sessionUser = me;
    calls.length = 0;
    provider = () => ({ status: 200, json: {} });
    fireHook.mockReset();
    resendSend.mockReset();
    resendSend.mockResolvedValue({ data: { id: `re_${uid('n')}` }, error: null });
});
// Los datos globales (usuarios, correos, eventos, borradores) que crea este archivo se borran al terminar: otras suites (metricas de admin)
// hacen agregados sobre toda la base y no deben verlos.
afterAll(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await 
    await prisma.$executeRawUnsafe('DELETE FROM "EmailEvent" WHERE "createdAt" >= $1', STARTED_AT);
    await prisma.$executeRawUnsafe('DELETE FROM "Draft" WHERE "createdAt" >= $1', STARTED_AT);
    await prisma.$executeRawUnsafe('DELETE FROM "User" WHERE "createdAt" >= $1', STARTED_AT);
    await prisma.$disconnect();
});

const inFuture = (ms: number) => new Date(Date.now() + ms);
const scheduled = (userId = me.id, over: Record<string, unknown> = {}) =>
    createEmail(prisma, userId, { folder: 'scheduled', status: 'scheduled', scheduledAt: inFuture(3_600_000), read: true, messageId: `re_${uid('s')}`, subject: 'Programado', ...over });

const schedule = async (id: string, body: unknown) => {
    const { POST } = await import('../../app/api/emails/[id]/schedule/route');
    const res = await POST(new NextRequest(`http://localhost/api/emails/${id}/schedule`, { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
    return { status: res.status, body: await res.json() };
};
const row = (id: string) => prisma.email.findUnique({ where: { id } });

describe('reprogramar', () => {
    it('actualiza Resend (PATCH scheduled_at) y despues nuestra BD; devuelve la hora anterior (para Deshacer)', async () => {
        const e = await scheduled();
        const newAt = inFuture(2 * 86_400_000);
        const r = await schedule(e.id, { action: 'reschedule', scheduledAt: newAt.toISOString() });
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({ success: true, scheduledAt: newAt.toISOString(), previousScheduledAt: e.scheduledAt!.toISOString() });
        expect(calls).toEqual([{ method: 'PATCH', url: `http://resend.test/emails/${e.messageId}`, body: { scheduled_at: newAt.toISOString() }, auth: 'Bearer re_test_key', key: null }]);
        expect((await row(e.id))!.scheduledAt!.toISOString()).toBe(newAt.toISOString());
        expect((await row(e.id))!.folder).toBe('scheduled');
    });

    it.each([
        ['ayer', () => inFuture(-86_400_000).toISOString(), 'DATE_TOO_SOON'],
        ['dentro de 10 s', () => inFuture(10_000).toISOString(), 'DATE_TOO_SOON'],
        ['dentro de 90 dias', () => inFuture(90 * 86_400_000).toISOString(), 'DATE_TOO_FAR'],
        ['texto', () => 'manana', 'INVALID_DATE'],
        ['vacio', () => '', 'INVALID_DATE'],
    ])('fecha invalida (%s): 400 con codigo y sin llamar al proveedor ni cambiar la BD', async (_n, when, code) => {
        const e = await scheduled();
        const r = await schedule(e.id, { action: 'reschedule', scheduledAt: when() });
        expect(r.status).toBe(400);
        expect(r.body.code).toBe(code);
        expect(calls).toEqual([]);
        expect((await row(e.id))!.scheduledAt!.toISOString()).toBe(e.scheduledAt!.toISOString());
    });

    it('si el envio YA salio (el proveedor responde 422): 409 ALREADY_SENT, BD sin cambiar la hora y sincronizada como enviado', async () => {
        const e = await scheduled();
        provider = () => ({ status: 422, json: { message: 'Only scheduled emails can be updated' } });
        const r = await schedule(e.id, { action: 'reschedule', scheduledAt: inFuture(2 * 86_400_000).toISOString() });
        expect(r.status).toBe(409);
        expect(r.body.code).toBe('ALREADY_SENT');
        const after = (await row(e.id))!;
        expect(after.folder).toBe('sent');
        expect(after.status).toBe('sent');
        expect(after.scheduledAt!.toISOString()).toBe(e.scheduledAt!.toISOString());
    });

    it('proveedor caido (500 o sin red): 502 y la BD queda igual', async () => {
        const e = await scheduled();
        for (const p of [() => ({ status: 500 }), () => 'throw' as const]) {
            provider = p;
            const r = await schedule(e.id, { action: 'reschedule', scheduledAt: inFuture(2 * 86_400_000).toISOString() });
            expect(r.status).toBe(502);
            expect(r.body.code).toBe('PROVIDER_UNAVAILABLE');
        }
        expect((await row(e.id))!.scheduledAt!.toISOString()).toBe(e.scheduledAt!.toISOString());
        expect((await row(e.id))!.folder).toBe('scheduled');
    });

    it('el proveedor no conoce ese id (404): se cambia solo la BD', async () => {
        const e = await scheduled();
        provider = () => ({ status: 404, json: { message: 'not found' } });
        const newAt = inFuture(2 * 86_400_000);
        expect((await schedule(e.id, { action: 'reschedule', scheduledAt: newAt.toISOString() })).status).toBe(200);
        expect((await row(e.id))!.scheduledAt!.toISOString()).toBe(newAt.toISOString());
    });
});

describe('enviar ahora (envio inmediato de verdad)', () => {
    const isSend = (c: Call) => c.method === 'POST' && c.url === 'http://resend.test/emails';
    const isCancel = (c: Call) => c.method === 'POST' && c.url.endsWith('/cancel');
    const okProvider = (newId = uid('re_new')) => (c: Call) => (isSend(c) ? { status: 200, json: { id: newId } } : { status: 200, json: {} });
    const withBody = (over: Record<string, unknown> = {}) => scheduled(me.id, {
        htmlKey: 'sent/x/body.html', to: 'dest@x.test', cc: 'copia@x.test', subject: 'Hola', from: 'Yo <yo@x.test>', ...over,
    });

    it('cancela el programado y envia YA el mismo mensaje con Idempotency-Key derivada del id; pasa a Enviados y dispara EMAIL_SENT una vez', async () => {
        const e = await withBody();
        provider = okProvider('re_new_1');
        const r = await schedule(e.id, { action: 'sendNow' });
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({ success: true, folder: 'sent', immediate: true });
        expect(calls.map((c) => `${c.method} ${c.url.replace('http://resend.test', '')}`)).toEqual([`POST /emails/${e.messageId}/cancel`, 'POST /emails']);
        const send = calls[1];
        expect(send.body).toMatchObject({ from: 'Yo <yo@x.test>', to: ['dest@x.test'], cc: ['copia@x.test'], subject: 'Hola', html: '<p>Hola <b>mundo</b></p>' });
        expect(send.body.scheduled_at).toBeUndefined(); // inmediato: sin fecha
        expect(send.key).toContain('sendnow-');
        expect(send.key).toContain(e.id.slice(0, 10));
        expect(send.auth).toBe('Bearer re_test_key');
        expect(resendSend).not.toHaveBeenCalled(); // el SDK no admite cabeceras: va por REST
        expect(await row(e.id)).toMatchObject({ folder: 'sent', status: 'sent', scheduledAt: null, messageId: 're_new_1' });
        expect(fireHook).toHaveBeenCalledTimes(1);
        expect(fireHook.mock.calls[0][0]).toBe('EMAIL_SENT');
    });

    it('reconstruye los adjuntos desde el almacenamiento (base64)', async () => {
        const e = await withBody({ attachments: { create: [{ filename: 'a.txt', mimeType: 'text/plain', size: 4, key: 'att/ok/a.txt' }] } });
        provider = okProvider();
        expect((await schedule(e.id, { action: 'sendNow' })).status).toBe(200);
        expect(calls[1].body.attachments).toEqual([{ filename: 'a.txt', content: Buffer.from('DATA').toString('base64') }]);
    });

    it('si el proveedor ya lo envio (cancelar da 422): 409 ALREADY_SENT, NO se envia otro, la fila se sincroniza y no hay evento', async () => {
        const e = await withBody();
        provider = (c) => (isCancel(c) ? { status: 422, json: { message: 'cannot cancel' } } : { status: 200, json: { id: 'no' } });
        const r = await schedule(e.id, { action: 'sendNow' });
        expect(r.status).toBe(409);
        expect(r.body.code).toBe('ALREADY_SENT');
        expect(calls.filter(isSend)).toHaveLength(0);
        expect(await row(e.id)).toMatchObject({ folder: 'sent', status: 'sent' });
        expect(fireHook).not.toHaveBeenCalled();
    });

    it('cancelar con el proveedor caido: 502, no se envia nada y la fila sigue programada', async () => {
        const e = await withBody();
        provider = (c) => (isCancel(c) ? { status: 500, json: {} } : { status: 200, json: { id: 'x' } });
        const r = await schedule(e.id, { action: 'sendNow' });
        expect(r.status).toBe(502);
        expect(r.body.code).toBe('PROVIDER_UNAVAILABLE');
        expect(calls.filter(isSend)).toHaveLength(0);
        expect(await row(e.id)).toMatchObject({ folder: 'scheduled', status: 'scheduled', messageId: e.messageId });
        // y se puede volver a intentar sin claves colgadas
        provider = okProvider('re_after');
        expect((await schedule(e.id, { action: 'sendNow' })).status).toBe(200);
    });

    it('el proveedor no conoce el id (404 al cancelar): se envia igualmente, una sola vez', async () => {
        const e = await withBody();
        provider = (c) => (isCancel(c) ? { status: 404, json: { message: 'not found' } } : { status: 200, json: { id: 're_404' } });
        expect((await schedule(e.id, { action: 'sendNow' })).status).toBe(200);
        expect(calls.filter(isSend)).toHaveLength(1);
    });

    it('el envio inmediato es RECHAZADO tras cancelar: se reprograma el mismo contenido a +2 min y se avisa (ni dos envios ni cero)', async () => {
        const e = await withBody();
        let sends = 0;
        provider = (c) => {
            if (!isSend(c)) return { status: 200, json: {} };
            sends++;
            return c.body.scheduled_at ? { status: 200, json: { id: 're_restored' } } : { status: 422, json: { name: 'validation_error', message: 'bad address' } };
        };
        const r = await schedule(e.id, { action: 'sendNow' });
        expect(r.status).toBe(502);
        expect(r.body.code).toBe('SEND_FAILED_RESCHEDULED');
        expect(sends).toBe(2); // el intento rechazado + la reprogramacion
        const restore = calls.filter(isSend)[1];
        const at = new Date(restore.body.scheduled_at).getTime();
        expect(at).toBeGreaterThan(Date.now() + 100_000);
        expect(at).toBeLessThan(Date.now() + 140_000);
        expect(restore.body).toMatchObject({ to: ['dest@x.test'], subject: 'Hola', html: '<p>Hola <b>mundo</b></p>' });
        expect(restore.key).not.toBe(calls.filter(isSend)[0].key);
        expect(new Date(r.body.scheduledAt).getTime()).toBe(at);
        expect(await row(e.id)).toMatchObject({ folder: 'scheduled', status: 'scheduled', messageId: 're_restored' });
        expect(fireHook).not.toHaveBeenCalled();
    });

    it('fallo AMBIGUO (red/5xx): se repite con la MISMA clave, no se reprograma (podria duplicar) y queda en `sending`; el reintento salta la cancelacion y no duplica', async () => {
        const e = await withBody();
        provider = (c) => (isSend(c) ? 'throw' : { status: 200, json: {} });
        const r = await schedule(e.id, { action: 'sendNow' });
        expect(r.status).toBe(502);
        expect(r.body.code).toBe('SEND_PENDING');
        const attempts = calls.filter(isSend);
        expect(attempts).toHaveLength(2);
        expect(attempts[0].key).toBe(attempts[1].key);
        expect(attempts.every((a) => !a.body.scheduled_at)).toBe(true);
        expect(await row(e.id)).toMatchObject({ folder: 'scheduled', status: 'sending', messageId: e.messageId });
        // reintento: el proveedor vuelve; NO se cancela otra vez y se usa la misma clave de idempotencia
        calls.length = 0;
        provider = okProvider('re_retry');
        const again = await schedule(e.id, { action: 'sendNow' });
        expect(again.status).toBe(200);
        expect(calls.filter(isCancel)).toHaveLength(0);
        expect(calls.filter(isSend)).toHaveLength(1);
        expect(calls.filter(isSend)[0].key).toBe(attempts[0].key);
        expect(await row(e.id)).toMatchObject({ folder: 'sent', status: 'sent', messageId: 're_retry' });
        expect(fireHook).toHaveBeenCalledTimes(1);
    });

    it('CONCURRENCIA: 5 llamadas a la vez -> exactamente 1 envio, 1 cancelacion y 1 evento', async () => {
        const e = await withBody();
        provider = okProvider('re_conc');
        const results = await Promise.all(Array.from({ length: 5 }, () => schedule(e.id, { action: 'sendNow' })));
        expect(calls.filter(isSend)).toHaveLength(1);
        expect(calls.filter(isCancel)).toHaveLength(1);
        expect(results.filter((r) => r.status === 200 && r.body.immediate === true)).toHaveLength(1);
        for (const r of results) expect([200, 409]).toContain(r.status);
        for (const r of results.filter((x) => x.status === 409)) expect(['SEND_IN_PROGRESS', 'NOT_SCHEDULED']).toContain(r.body.code);
        expect(fireHook).toHaveBeenCalledTimes(1);
        expect(await row(e.id)).toMatchObject({ folder: 'sent', messageId: 're_conc' });
        // y repetirlo despues no reenvia
        const again = await schedule(e.id, { action: 'sendNow' });
        expect(again.status).toBe(409);
        expect(calls.filter(isSend)).toHaveLength(1);
    });

    it('faltan datos para reconstruir (adjunto perdido): NO se cancela; ultimo recurso = adelantar el programado a +30 s y avisarlo', async () => {
        const e = await withBody({ attachments: { create: [{ filename: 'perdido.pdf', mimeType: 'application/pdf', size: 4, key: 'att/gone/x.pdf' }] } });
        const r = await schedule(e.id, { action: 'sendNow' });
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({ success: true, folder: 'sent', deferred: true });
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ method: 'PATCH', url: `http://resend.test/emails/${e.messageId}` });
        const at = new Date(calls[0].body.scheduled_at).getTime();
        expect(at).toBeGreaterThan(Date.now());
        expect(at).toBeLessThan(Date.now() + 60_000);
        expect(calls.filter(isCancel)).toHaveLength(0);
        expect(calls.filter(isSend)).toHaveLength(0);
    });

    it('reprogramar un envio en `sending` no esta permitido (409); eliminarlo lo manda a la papelera sin llamar a cancelar', async () => {
        const e = await withBody({ status: 'sending' });
        expect((await schedule(e.id, { action: 'reschedule', scheduledAt: inFuture(2 * 86_400_000).toISOString() })).body.code).toBe('SEND_PENDING');
        const d = await schedule(e.id, { action: 'delete' });
        expect(d.status).toBe(200);
        expect(calls).toEqual([]);
        expect((await row(e.id))!.folder).toBe('trash');
    });
});

describe('eliminar (cancelar + papelera)', () => {
    it('cancela en el proveedor y manda el correo a la papelera con su origen; Restaurar lo devuelve a la bandeja', async () => {
        const e = await scheduled();
        const r = await schedule(e.id, { action: 'delete' });
        expect(r.status).toBe(200);
        expect(calls).toEqual([{ method: 'POST', url: `http://resend.test/emails/${e.messageId}/cancel`, body: undefined, auth: 'Bearer re_test_key', key: null }]);
        expect(await row(e.id)).toMatchObject({ folder: 'trash', status: 'cancelled', scheduledAt: null, previousFolder: 'scheduled' });
        const { PATCH } = await import('../../app/api/emails/batch/route');
        const res = await PATCH(new NextRequest('http://localhost/api/emails/batch', { method: 'PATCH', body: JSON.stringify({ ids: [e.id], updates: { restore: true } }) }));
        expect((await res.json()).targets[e.id]).toBe('inbox');
    });

    it('si ya salio: 409 y no se elimina nada', async () => {
        const e = await scheduled();
        provider = () => ({ status: 422, json: { message: 'cannot cancel' } });
        const r = await schedule(e.id, { action: 'delete' });
        expect(r.status).toBe(409);
        expect((await row(e.id))!.folder).toBe('sent');
    });
});

describe('propiedad y validacion (IDOR)', () => {
    it('correo de OTRO usuario: 404 y ninguna llamada al proveedor', async () => {
        const e = await scheduled(other.id);
        for (const action of ['reschedule', 'sendNow', 'delete']) {
            const r = await schedule(e.id, { action, scheduledAt: inFuture(2 * 86_400_000).toISOString() });
            expect(r.status).toBe(404);
        }
        expect(calls).toEqual([]);
        expect(await row(e.id)).toMatchObject({ folder: 'scheduled', status: 'scheduled' });
    });

    it('correo que no esta programado: 409; accion desconocida: 400; sin sesion: 401; id inexistente: 404', async () => {
        const sent = await createEmail(prisma, me.id, { folder: 'sent', status: 'sent' });
        expect((await schedule(sent.id, { action: 'sendNow' })).body.code).toBe('NOT_SCHEDULED');
        const e = await scheduled();
        expect((await schedule(e.id, { action: 'explotar' })).status).toBe(400);
        expect((await schedule('no-existe', { action: 'sendNow' })).status).toBe(404);
        sessionUser = null;
        expect((await schedule(e.id, { action: 'sendNow' })).status).toBe(401);
        expect(calls).toEqual([]);
    });
});

describe('editar = cancelar + abrir como borrador (ruta cancel)', () => {
    const cancel = async (id: string) => {
        const { POST } = await import('../../app/api/emails/[id]/cancel/route');
        const res = await POST(new NextRequest(`http://localhost/api/emails/${id}/cancel`, { method: 'POST' }), { params: Promise.resolve({ id }) });
        return { status: res.status, body: await res.json() };
    };

    it('cancela en el proveedor, conserva destinatarios/cc/bcc/asunto/cuerpo/adjuntos en el borrador y borra el programado', async () => {
        const e = await scheduled(me.id, {
            to: 'a@x.test, b@x.test', cc: 'c@x.test', bcc: 'd@x.test', subject: 'Reunion', htmlKey: 'sent/x/body.html',
            attachments: { create: [{ filename: 'plan.pdf', mimeType: 'application/pdf', size: 1234, key: 'attachments/x/plan.pdf' }] },
        });
        const r = await cancel(e.id);
        expect(r.status).toBe(200);
        expect(calls[0]).toMatchObject({ method: 'POST', url: `http://resend.test/emails/${e.messageId}/cancel` });
        const draft = await prisma.draft.findUnique({ where: { id: r.body.draftId }, include: { attachments: true } });
        expect(draft).toMatchObject({ to: 'a@x.test, b@x.test', cc: 'c@x.test', bcc: 'd@x.test', subject: 'Reunion', body: '<p>Hola <b>mundo</b></p>' });
        expect(draft!.attachments.map((a) => [a.filename, a.size])).toEqual([['plan.pdf', 1234]]);
        expect(r.body.draft).toMatchObject({ id: draft!.id, cc: 'c@x.test', bcc: 'd@x.test', body: '<p>Hola <b>mundo</b></p>' });
        expect(await row(e.id)).toBeNull();
    });

    it('si el envio ya salio: 409, NO se crea borrador y la fila se sincroniza como enviada', async () => {
        const e = await scheduled();
        provider = () => ({ status: 422, json: { message: 'cannot cancel' } });
        const before = await prisma.draft.count();
        const r = await cancel(e.id);
        expect(r.status).toBe(409);
        expect(r.body.code).toBe('ALREADY_SENT');
        expect(await prisma.draft.count()).toBe(before);
        expect((await row(e.id))!.folder).toBe('sent');
    });

    it('proveedor caido: 502 y el programado sigue intacto (no queda borrador Y correo saliendo)', async () => {
        const e = await scheduled();
        provider = () => 'throw';
        const before = await prisma.draft.count();
        expect((await cancel(e.id)).status).toBe(502);
        expect(await prisma.draft.count()).toBe(before);
        expect((await row(e.id))!.folder).toBe('scheduled');
    });

    it('correo ajeno: 404; correo no programado: 409', async () => {
        expect((await cancel((await scheduled(other.id)).id)).status).toBe(404);
        const sent = await createEmail(prisma, me.id, { folder: 'sent', status: 'sent' });
        expect((await cancel(sent.id)).status).toBe(409);
    });
});

describe('POST /api/emails programado', () => {
    it('envia scheduled_at (formato REST de Resend) ademas de scheduledAt', async () => {
        const { POST } = await import('../../app/api/emails/route');
        const when = inFuture(3 * 3_600_000).toISOString();
        const res = await POST(new NextRequest('http://localhost/api/emails', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ to: 'dest@ext.test', subject: 'Luego', html: '<p>luego</p>', text: 'luego', scheduledAt: when }),
        }));
        expect(res.status).toBe(200);
        expect(resendSend.mock.calls[0][0]).toMatchObject({ scheduled_at: when, scheduledAt: when });
        const saved = await prisma.email.findFirst({ where: { userId: me.id, subject: 'Luego' } });
        expect(saved).toMatchObject({ folder: 'scheduled', status: 'scheduled' });
    });
});

describe('webhook del proveedor: el programado que sale deja de ser "programado" y dispara EMAIL_SENT una vez', () => {
    const status = async (type: string, emailId: string) => {
        const { POST } = await import('../../app/api/webhooks/resend/route');
        const res = await POST(new NextRequest('http://localhost/api/webhooks/resend', { method: 'POST', body: JSON.stringify({ type, data: { email_id: emailId } }) }));
        return res.status;
    };

    it('email.sent mueve a Enviados; el email.delivered posterior solo cambia el estado; el evento se dispara una sola vez', async () => {
        const e = await scheduled();
        expect(await status('email.sent', e.messageId)).toBe(200);
        expect(await row(e.id)).toMatchObject({ folder: 'sent', status: 'sent' });
        expect(await status('email.delivered', e.messageId)).toBe(200);
        expect(await status('email.sent', e.messageId)).toBe(200); // reintento del webhook
        expect(await row(e.id)).toMatchObject({ folder: 'sent' });
        expect(fireHook).toHaveBeenCalledTimes(1);
        expect(fireHook.mock.calls[0][0]).toBe('EMAIL_SENT');
    });

    it('un retraso de entrega no saca al programado de Programados; un correo ya enviado no dispara el evento', async () => {
        const e = await scheduled();
        await status('email.delivery_delayed', e.messageId);
        expect(await row(e.id)).toMatchObject({ folder: 'scheduled' });
        expect(fireHook).not.toHaveBeenCalled();
        const sent = await createEmail(prisma, me.id, { folder: 'sent', status: 'sent', messageId: `re_${uid('t')}` });
        await status('email.delivered', sent.messageId);
        expect(fireHook).not.toHaveBeenCalled();
        expect(await row(sent.id)).toMatchObject({ folder: 'sent', status: 'delivered' });
    });
});
