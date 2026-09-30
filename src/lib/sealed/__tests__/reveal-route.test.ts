import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const consumeMock = vi.fn();
const getMetaMock = vi.fn();
vi.mock('../store', () => ({
    defaultDeps: vi.fn(async () => ({})),
    consume: (...a: unknown[]) => consumeMock(...a),
    getMeta: (...a: unknown[]) => getMetaMock(...a),
}));

import { GET, POST } from '../../../app/api/secure-message/[id]/route';

const ID = '11111111-1111-4111-8111-111111111111';
const ctx = { params: Promise.resolve({ id: ID }) };
let n = 0;
const req = (method: 'GET' | 'POST', headers: Record<string, string> = {}) =>
    new NextRequest(`http://localhost/api/secure-message/${ID}`, { method, headers: { 'x-forwarded-for': `10.0.${Math.floor(++n / 250)}.${n % 250}`, ...headers } });

beforeEach(() => { consumeMock.mockReset(); getMetaMock.mockReset(); });

describe('/api/secure-message/[id]: GET no consume, POST exige el reveal explicito', () => {
    it('GET (prefetch/escaner) devuelve metadatos y NUNCA cuenta una vista', async () => {
        getMetaMock.mockResolvedValue({ format: 'sealed', hasPassword: false, sender: 'a@x.com', createdAt: 'x', expiresAt: 'y', remainingViews: 1 });
        for (let i = 0; i < 5; i++) expect((await GET(req('GET'), ctx)).status).toBe(200);
        expect(consumeMock).not.toHaveBeenCalled();
    });

    it('POST sin la cabecera X-Sealed-Reveal (formulario/img de terceros, escaner) da 400 y no consume', async () => {
        const res = await POST(req('POST'), ctx);
        expect(res.status).toBe(400);
        expect(consumeMock).not.toHaveBeenCalled();
    });

    it('POST con la cabecera consume una vez y entrega el sobre', async () => {
        consumeMock.mockResolvedValue({ format: 'sealed', envelope: { v: 1 }, sender: 'a', createdAt: 'x', expiresAt: 'y', remainingViews: 0 });
        const res = await POST(req('POST', { 'x-sealed-reveal': '1' }), ctx);
        expect(res.status).toBe(200);
        expect(consumeMock).toHaveBeenCalledTimes(1);
        expect((await res.json()).remainingViews).toBe(0);
    });

    it('agotado/caducado responde 404 igual que inexistente', async () => {
        consumeMock.mockResolvedValue(null);
        expect((await POST(req('POST', { 'x-sealed-reveal': '1' }), ctx)).status).toBe(404);
    });
});
