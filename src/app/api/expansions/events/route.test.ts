import { describe, expect, it, vi } from 'vitest';

const fire = vi.fn();
async function setup(session: any = { id: 'u1', email: 'me@x.com' }) {
    vi.resetModules();
    fire.mockReset();
    vi.doMock('@/lib/session', () => ({ getCurrentUser: async () => session }));
    vi.doMock('@/lib/mailbox-access', () => ({ canAccessEmail: async (_s: string, owner: string) => owner === 'u1' }));
    vi.doMock('@/lib/draft-access', () => ({ resolveAuthorizedSenders: async () => new Set(['me@x.com']) }));
    vi.doMock('@/lib/prisma', () => ({
        prisma: {
            email: { findUnique: async ({ where }: any) => ({ mine: { id: 'mine', userId: 'u1' }, other: { id: 'other', userId: 'victim' } } as any)[where.id] ?? null },
            draft: { findFirst: async ({ where }: any) => (where.id === 'dmine' && where.from.in.includes('me@x.com') ? { id: 'dmine' } : null) },
        },
    }));
    const real = await vi.importActual<any>('@/lib/expansions/server-hooks');
    vi.doMock('@/lib/expansions/server-hooks', () => ({ ...real, fireLifecycleHook: fire }));
    const { NextRequest } = await import('next/server');
    const { POST } = await import('./route');
    const call = (body: unknown) => POST(new NextRequest('http://localhost/api/expansions/events', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }));
    return { call };
}

describe('POST /api/expansions/events', () => {
    it('sin sesion: 401', async () => {
        const { call } = await setup(null);
        expect((await call({ event: 'COMPOSE_OPENED', context: { mode: 'new' } })).status).toBe(401);
        expect(fire).not.toHaveBeenCalled();
    });

    it('evento no permitido, claves extra o JSON invalido: 400', async () => {
        const { call } = await setup();
        expect((await call({ event: 'EMAIL_SENT', context: { mode: 'new' } })).status).toBe(400);
        expect((await call({ event: 'COMPOSE_OPENED', context: { mode: 'new', userId: 'victim' } })).status).toBe(400);
        expect((await call({ event: 'COMPOSE_OPENED', context: { mode: 'raro' } })).status).toBe(400);
        expect((await call('no-json')).status).toBe(400);
        expect(fire).not.toHaveBeenCalled();
    });

    it('ids ajenos se descartan; propios se conservan; el userId es el de la sesion', async () => {
        const { call } = await setup();
        expect((await call({ event: 'COMPOSE_OPENED', context: { mode: 'reply', inReplyToEmailId: 'other', draftId: 'dother' } })).status).toBe(202);
        expect(fire).toHaveBeenLastCalledWith('COMPOSE_OPENED', 'u1', { mode: 'reply' });
        await call({ event: 'COMPOSE_OPENED', context: { mode: 'reply', inReplyToEmailId: 'mine', draftId: 'dmine' } });
        expect(fire).toHaveBeenLastCalledWith('COMPOSE_OPENED', 'u1', { mode: 'reply', inReplyToEmailId: 'mine', draftId: 'dmine' });
    });
});
