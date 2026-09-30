import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const checkSessionNotRevoked = vi.fn();
vi.mock('@/lib/session-revocation', () => ({ checkSessionNotRevoked: (...a: any[]) => checkSessionNotRevoked(...a) }));

import { POST } from './route';

const SECRET = 'internal-secret-for-tests';

function req(body: unknown, opts: { secret?: string; ts?: number; sig?: string; raw?: string } = {}) {
    const raw = opts.raw ?? JSON.stringify(body);
    const ts = opts.ts ?? Math.floor(Date.now() / 1000);
    const sig = opts.sig ?? crypto.createHmac('sha256', opts.secret ?? SECRET).update(`${ts}.${raw}`).digest('hex');
    return new Request('http://localhost/api/internal/session-check', {
        method: 'POST',
        headers: { 'x-bloomx-timestamp': String(ts), 'x-bloomx-signature': sig, 'content-type': 'application/json' },
        body: raw,
    }) as any;
}

let saved: string | undefined;
beforeEach(() => {
    saved = process.env.INTERNAL_SECRET;
    process.env.INTERNAL_SECRET = SECRET;
    delete process.env.EXTENSION_HOOKS_SECRET;
    checkSessionNotRevoked.mockReset();
});
afterEach(() => {
    if (saved === undefined) delete process.env.INTERNAL_SECRET;
    else process.env.INTERNAL_SECRET = saved;
});

describe('POST /api/internal/session-check', () => {
    it('sin secreto configurado responde 503 (fail-closed)', async () => {
        delete process.env.INTERNAL_SECRET;
        expect((await POST(req({ sub: 'u' }))).status).toBe(503);
    });

    it('rechaza firma incorrecta, secreto distinto, timestamp fuera de ventana y cuerpo alterado', async () => {
        const body = { sub: 'u1', jti: 'j1', tv: 0, iat: 1 };
        expect((await POST(req(body, { secret: 'otro' }))).status).toBe(401);
        expect((await POST(req(body, { ts: Math.floor(Date.now() / 1000) - 3600 }))).status).toBe(401);
        expect((await POST(req(body, { sig: 'zz' }))).status).toBe(401);
        const good = req(body);
        const tampered = new Request(good.url, { method: 'POST', headers: good.headers, body: JSON.stringify({ ...body, sub: 'u2' }) }) as any;
        expect((await POST(tampered)).status).toBe(401);
        expect(checkSessionNotRevoked).not.toHaveBeenCalled();
    });

    it('devuelve valid:true y pasa sub/jti/tv al comprobador', async () => {
        checkSessionNotRevoked.mockResolvedValue({ valid: true });
        const res = await POST(req({ sub: 'u1', jti: 'j1', tv: 3, iat: 100 }));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ valid: true });
        expect(checkSessionNotRevoked).toHaveBeenCalledWith({ sub: 'u1', jti: 'j1', tv: 3, iat: 100 });
    });

    it('devuelve valid:false con el motivo cuando esta revocada', async () => {
        checkSessionNotRevoked.mockResolvedValue({ valid: false, reason: 'revoked' });
        const res = await POST(req({ sub: 'u1', jti: 'j1', tv: 0, iat: 1 }));
        expect(await res.json()).toEqual({ valid: false, reason: 'revoked' });
    });

    it('un fallo de BD del frontend se traduce en 503 (el backend aplica su fail-open/closed)', async () => {
        checkSessionNotRevoked.mockResolvedValue({ valid: false, reason: 'error' });
        expect((await POST(req({ sub: 'u1', jti: 'j1' }))).status).toBe(503);
    });

    it('valida el cuerpo: sub obligatorio y jti string', async () => {
        expect((await POST(req({ jti: 'x' }))).status).toBe(400);
        expect((await POST(req({ sub: 'u', jti: 5 }))).status).toBe(400);
        expect((await POST(req({ sub: 'u' }, { raw: 'no json' }))).status).toBe(400);
    });
});
