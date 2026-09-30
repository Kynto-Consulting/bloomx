import { describe, it, expect } from 'vitest';
import {
    MAX_ATTEMPTS,
    applyOutcome,
    backoffMs,
    classifyStatus,
    createItem,
    dueItems,
    enqueue,
    makeDedupeKey,
    nextDueAt,
    normalizeStoredQueue,
} from '../offline-queue';

let counter = 0;
const newId = () => `id-${++counter}`;
const mk = (over: Partial<Parameters<typeof createItem>[0]> = {}, now = 1000) =>
    createItem({ url: '/api/emails/batch', method: 'patch', body: { ids: ['a'], updates: { read: true } }, description: 'x', ...over }, now, newId);

describe('classifyStatus', () => {
    it('descarta 4xx no reintentables y reintenta los recuperables', () => {
        expect(classifyStatus(200)).toBe('success');
        expect(classifyStatus(204)).toBe('success');
        for (const s of [400, 403, 404, 409, 410, 422]) expect(classifyStatus(s)).toBe('drop');
        for (const s of [401, 408, 425, 429, 500, 502, 503]) expect(classifyStatus(s)).toBe('retry');
        expect(classifyStatus(302)).toBe('retry');
    });
});

describe('backoffMs', () => {
    it('crece exponencialmente con tope', () => {
        expect(backoffMs(1)).toBe(2000);
        expect(backoffMs(2)).toBe(4000);
        expect(backoffMs(3)).toBe(8000);
        expect(backoffMs(50)).toBe(5 * 60_000);
    });
});

describe('deduplicacion', () => {
    it('la clave ignora el orden de las claves del cuerpo pero distingue cuentas', () => {
        const a = makeDedupeKey({ method: 'PATCH', url: '/x', body: { a: 1, b: [1, 2] }, accountId: 'acc1' });
        const b = makeDedupeKey({ method: 'patch', url: '/x', body: { b: [1, 2], a: 1 }, accountId: 'acc1' });
        const c = makeDedupeKey({ method: 'PATCH', url: '/x', body: { a: 1, b: [1, 2] }, accountId: 'acc2' });
        expect(a).toBe(b);
        expect(a).not.toBe(c);
    });

    it('enqueue no agrega duplicados por id ni por clave', () => {
        const first = mk();
        let { queue, added } = enqueue([], first);
        expect(added).toBe(true);
        ({ queue, added } = enqueue(queue, mk()));
        expect(added).toBe(false);
        ({ queue, added } = enqueue(queue, { ...mk({ body: { other: 1 } }), id: first.id }));
        expect(added).toBe(false);
        ({ queue, added } = enqueue(queue, mk({ body: { ids: ['b'] } })));
        expect(added).toBe(true);
        expect(queue).toHaveLength(2);
    });

    it('un envio con dedupeKey explicito no se encola dos veces', () => {
        const send = { url: '/api/emails', method: 'POST', body: { to: 'a@b.c' }, description: 'Send', dedupeKey: 'send:draft-1' };
        let { queue } = enqueue([], createItem(send, 1, newId));
        const again = enqueue(queue, createItem({ ...send, body: { to: 'a@b.c', subject: 'cambio' } }, 2, newId));
        expect(again.added).toBe(false);
    });
});

describe('applyOutcome / reintentos', () => {
    it('success y drop eliminan; drop informa el elemento', () => {
        const item = mk();
        expect(applyOutcome([item], item.id, 'success', 0)).toEqual({ queue: [], dropped: null });
        const r = applyOutcome([item], item.id, 'drop', 0);
        expect(r.queue).toEqual([]);
        expect(r.dropped?.id).toBe(item.id);
    });

    it('retry programa backoff y elimina tras MAX_ATTEMPTS', () => {
        let queue = [mk()];
        const id = queue[0].id;
        const now = 10_000;
        queue = applyOutcome(queue, id, 'retry', now).queue;
        expect(queue[0].attempts).toBe(1);
        expect(queue[0].nextAttemptAt).toBe(now + 2000);
        expect(dueItems(queue, now)).toHaveLength(0);
        expect(dueItems(queue, now + 2000)).toHaveLength(1);
        expect(nextDueAt(queue)).toBe(now + 2000);

        let dropped = null as ReturnType<typeof applyOutcome>['dropped'];
        for (let i = 1; i < MAX_ATTEMPTS; i++) {
            const r = applyOutcome(queue, id, 'retry', now);
            queue = r.queue;
            dropped = r.dropped;
        }
        expect(queue).toHaveLength(0);
        expect(dropped?.id).toBe(id);
    });
});

describe('normalizeStoredQueue', () => {
    it('migra el formato antiguo, descarta basura y urls externas, y deduplica', () => {
        const stored = [
            { id: 'a', url: '/api/emails/batch', method: 'DELETE', body: { ids: ['1'] }, timestamp: 5, description: 'old' },
            { id: 'a', url: '/api/emails/batch', method: 'DELETE', body: { ids: ['2'] }, timestamp: 6, description: 'mismo id' },
            { id: 'b', url: 'https://evil.example/x', method: 'POST', body: {} },
            { id: 'c', url: '//evil.example/x', method: 'POST', body: {} },
            { id: 'd', url: '/api/x', method: 'GET', body: {} },
            null,
            'texto',
        ];
        const q = normalizeStoredQueue(stored, newId, 99);
        expect(q).toHaveLength(1);
        expect(q[0]).toMatchObject({ id: 'a', attempts: 0, nextAttemptAt: 0, accountId: null, accountEmail: null });
        expect(normalizeStoredQueue('nope', newId, 0)).toEqual([]);
    });

    it('conserva la cuenta origen', () => {
        const q = normalizeStoredQueue([{ id: 'z', url: '/api/emails', method: 'POST', body: {}, accountId: 'acc-1', accountEmail: 'a@x.com' }], newId, 0);
        expect(q[0].accountId).toBe('acc-1');
        expect(q[0].accountEmail).toBe('a@x.com');
    });
});
