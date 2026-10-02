import { describe, expect, it } from 'vitest';
import { callExtension } from '../bridge';

// Regresion: el puente de conferencias (estado de Meet/Zoom/Teams y crear reunion) llamaba a /api/extension/execute SIN executionGrant.
// Con ext.grants.v1 el backend no entrega servicios del host (intermediario OAuth) sin concesion y las extensiones 2.x decian siempre "Conectar".
describe('callExtension: concesion de ejecucion', () => {
    const base = { domain: 'brand.test', userId: 'u1', email: 'u1@brand.test', extensionId: 'core-google-meet', action: 'status' };

    it('incluye executionGrant en el cuerpo cuando se emite', async () => {
        let sent: any = null;
        const fetchImpl = (async (_u: string, init: any) => { sent = JSON.parse(String(init.body)); return new Response(JSON.stringify({ success: true, result: { ok: 1 } }), { status: 200 }); }) as unknown as typeof fetch;
        const r = await callExtension({ ...base, fetchImpl, executionGrant: 'bxg1.test-grant' });
        expect(r.ok).toBe(true);
        expect(sent.executionGrant).toBe('bxg1.test-grant');
        expect(sent.extensionId).toBe('core-google-meet');
    });

    it('sin grant no inventa el campo (instancias sin clave de dominio siguen como antes)', async () => {
        let sent: any = null;
        const fetchImpl = (async (_u: string, init: any) => { sent = JSON.parse(String(init.body)); return new Response(JSON.stringify({ success: true, result: null }), { status: 200 }); }) as unknown as typeof fetch;
        await callExtension({ ...base, fetchImpl });
        expect('executionGrant' in sent).toBe(false);
        await callExtension({ ...base, fetchImpl, executionGrant: null });
        expect('executionGrant' in sent).toBe(false);
    });
});
