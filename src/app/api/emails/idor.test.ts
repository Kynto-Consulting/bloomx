import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseBatchIds, parseEmailBatchUpdates, ALLOWED_EMAIL_FOLDERS } from '@/lib/batch-validation';

/**
 * IDOR y validacion en /api/emails/[id]/cancel, /[id]/snooze y /batch con dobles (sin BD, Resend ni red).
 * Buzones accesibles del usuario u1: ['u1', 'u1b'] (cuenta vinculada).
 */

const ME = { id: 'u1', email: 'me@brand.com' };
const MAILBOXES = ['u1', 'u1b'];
const emails: Record<string, any> = {
    mine: { id: 'mine', userId: 'u1', from: 'me@brand.com', to: 'x@y.com', subject: 's', snippet: 'sn', messageId: 'rm1', status: 'scheduled', folder: 'scheduled', attachments: [] },
    linked: { id: 'linked', userId: 'u1b', from: 'me@brand.com', to: 'x@y.com', subject: 's', snippet: 'sn', messageId: 'rm2', status: 'scheduled', folder: 'scheduled', attachments: [] },
    other: { id: 'other', userId: 'victim', from: 'victim@brand.com', to: 'x@y.com', subject: 'secreto', snippet: 'sn', messageId: 'rm3', status: 'scheduled', folder: 'scheduled', attachments: [] },
};

const log: { cancelled: string[]; drafts: any[]; deleted: any[]; updated: any[]; updateMany: any[]; snoozed: any[] } = { cancelled: [], drafts: [], deleted: [], updated: [], updateMany: [], snoozed: [] };

async function setup(session = true) {
    vi.resetModules();
    for (const k of Object.keys(log) as (keyof typeof log)[]) log[k] = [];
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.doMock('@/lib/session', () => ({ getCurrentUser: async () => (session ? ME : null) }));
    vi.doMock('@/lib/mailbox-access', () => ({
        getAccessibleMailboxUserIds: async () => MAILBOXES,
        canAccessEmail: async (_s: string, owner: string) => MAILBOXES.includes(owner),
    }));
    vi.doMock('resend', () => ({
        Resend: class {
            emails = {
                cancel: async (id: string) => { log.cancelled.push(id); },
                get: async () => ({ data: { html: '<p>x</p>' } }),
            };
        },
    }));
    vi.doMock('@/lib/retention', () => ({ deleteEmailsCompletely: async (ids: string[]) => ({ deleted: ids.length }) }));
    vi.doMock('@/lib/prisma', () => ({
        prisma: {
            email: {
                findUnique: async ({ where }: any) => emails[where.id] ?? null,
                deleteMany: async (a: any) => { log.deleted.push(a); return { count: 1 }; },
                update: async (a: any) => { log.snoozed.push(a); return { id: a.where.id, ...a.data }; },
                updateMany: async (a: any) => { log.updateMany.push(a); return { count: 1 }; },
                findMany: async () => [],
            },
            draft: { create: async (a: any) => { log.drafts.push(a); return { id: 'dr1' }; } },
        },
    }));
    const { NextRequest } = await import('next/server');
    const mk = (path: string, method: string, body?: unknown) =>
        new NextRequest(`http://localhost${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    return { mk };
}

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules(); });

describe('POST /api/emails/[id]/cancel (IDOR)', () => {
    const call = async (id: string, session = true) => {
        const { mk } = await setup(session);
        const route = await import('./[id]/cancel/route');
        return route.POST(mk(`/api/emails/${id}/cancel`, 'POST'), { params: Promise.resolve({ id }) });
    };

    it('sin sesion: 401', async () => {
        expect((await call('mine', false)).status).toBe(401);
    });

    it('correo programado de OTRO usuario: 404 y sin efectos (ni Resend, ni borrador, ni borrado)', async () => {
        const res = await call('other');
        expect(res.status).toBe(404);
        expect(log.cancelled).toEqual([]);
        expect(log.drafts).toEqual([]);
        expect(log.deleted).toEqual([]);
    });

    it('id inexistente: 404', async () => {
        expect((await call('nope')).status).toBe(404);
    });

    it('correo propio y de buzon vinculado: se cancela y pasa a borrador', async () => {
        for (const id of ['mine', 'linked']) {
            const res = await call(id);
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toMatchObject({ success: true, draftId: 'dr1' });
            expect(json.draft).toMatchObject({ id: 'dr1', to: 'x@y.com', subject: 's' }); // lo necesario para abrirlo en el redactor
            expect(log.deleted[0].where.id).toBe(id);
        }
    });
});

describe('POST /api/emails/[id]/snooze (IDOR)', () => {
    const call = async (id: string, body: unknown) => {
        const { mk } = await setup();
        const route = await import('./[id]/snooze/route');
        return route.POST(mk(`/api/emails/${id}/snooze`, 'POST', body), { params: Promise.resolve({ id }) });
    };
    it('correo ajeno: 404 sin modificar', async () => {
        expect((await call('other', { snoozeUntil: '2030-01-01T00:00:00Z' })).status).toBe(404);
        expect(log.snoozed).toEqual([]);
    });
    it('fecha invalida: 400', async () => {
        expect((await call('mine', { snoozeUntil: 'no-es-fecha' })).status).toBe(400);
        expect((await call('mine', { snoozeUntil: { a: 1 } })).status).toBe(400);
    });
    it('propio: ok', async () => {
        expect((await call('mine', { snoozeUntil: '2030-01-01T00:00:00Z' })).status).toBe(200);
        expect(log.snoozed[0].data.folder).toBe('snoozed');
    });
});

describe('/api/emails/batch', () => {
    const patch = async (body: unknown) => {
        const { mk } = await setup();
        const route = await import('./batch/route');
        return route.PATCH(mk('/api/emails/batch', 'PATCH', body));
    };
    const del = async (body: unknown) => {
        const { mk } = await setup();
        const route = await import('./batch/route');
        return route.DELETE(mk('/api/emails/batch', 'DELETE', body));
    };

    it('PATCH carpeta valida: ok y siempre limitado a buzones propios', async () => {
        const res = await patch({ ids: ['a', 'b', 'a'], updates: { folder: 'archive', read: true } });
        expect(res.status).toBe(200);
        expect(log.updateMany[0].where).toEqual({ id: { in: ['a', 'b'] }, userId: { in: MAILBOXES } });
        expect(log.updateMany[0].data).toEqual({ folder: 'archive', read: true });
    });

    it.each(['snoozed', 'Inbox', '../x', '', 'inbox; drop', 5, null, {}])('PATCH folder invalida %j: 400', async (folder) => {
        const res = await patch({ ids: ['a'], updates: { folder } });
        expect(res.status).toBe(400);
        expect(log.updateMany).toEqual([]);
    });

    it('PATCH read/starred no booleanos: 400; campos ajenos se ignoran', async () => {
        expect((await patch({ ids: ['a'], updates: { read: 'yes' } })).status).toBe(400);
        expect((await patch({ ids: ['a'], updates: { userId: 'victim' } })).status).toBe(400);
        const ok = await patch({ ids: ['a'], updates: { starred: true, userId: 'victim' } });
        expect(ok.status).toBe(200);
        expect(log.updateMany[0].data).toEqual({ starred: true });
    });

    it.each([
        ['vacio', []],
        ['no array', 'a'],
        ['no strings', [1, 2]],
        ['objetos', [{ $ne: 1 }]],
        ['string vacio', ['']],
        ['demasiado largo', ['x'.repeat(201)]],
        ['mas de 500', Array.from({ length: 501 }, (_, i) => `id${i}`)],
    ])('PATCH y DELETE con ids invalidos (%s): 400', async (_n, ids) => {
        expect((await patch({ ids, updates: { read: true } })).status).toBe(400);
        expect((await del({ ids })).status).toBe(400);
    });

    it('500 ids unicos: aceptado', async () => {
        const ids = Array.from({ length: 500 }, (_, i) => `id${i}`);
        expect((await patch({ ids, updates: { read: true } })).status).toBe(200);
    });

    it('cuerpo no JSON: 400', async () => {
        const { mk } = await setup();
        const route = await import('./batch/route');
        const { NextRequest } = await import('next/server');
        const r = await route.PATCH(new NextRequest('http://localhost/api/emails/batch', { method: 'PATCH', body: 'no json' }));
        expect(r.status).toBe(400);
        void mk;
    });
});

describe('batch-validation (puro)', () => {
    it('lista de carpetas permitidas', () => {
        expect([...ALLOWED_EMAIL_FOLDERS]).toEqual(['inbox', 'sent', 'drafts', 'scheduled', 'archive', 'trash', 'spam']);
    });
    it('parseBatchIds deduplica y respeta el maximo', () => {
        expect(parseBatchIds(['a', 'a', 'b'])).toEqual(['a', 'b']);
        expect(parseBatchIds(['a', 'b', 'c'], 2)).toBeNull();
    });
    it('parseEmailBatchUpdates', () => {
        expect(parseEmailBatchUpdates({ folder: 'trash' })).toEqual({ folder: 'trash' });
        expect(parseEmailBatchUpdates([])).toBeNull();
        expect(parseEmailBatchUpdates({})).toBeNull();
    });
});
