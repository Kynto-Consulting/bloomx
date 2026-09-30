import { describe, it, expect } from 'vitest';
import { buildSealedEmailBody, createSealedLink, isSealedViewUrl, validateSealOptions } from '../client';
import { openMessage, parseKeyFragment } from '../crypto';

const ID = '3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b';

describe('envio sellado (cliente)', () => {
    it('sube solo el sobre: la clave nunca viaja en la peticion y el enlace la lleva en el #fragmento', async () => {
        const requests: Array<{ url: string; body: string }> = [];
        const fake = (async (url: string, init: any) => {
            requests.push({ url, body: String(init.body) });
            return new Response(JSON.stringify({ success: true, id: ID, viewUrl: `https://app.example.com/secure/${ID}`, expiresAt: '2026-10-29T00:00:00.000Z' }), { status: 200 });
        }) as unknown as typeof fetch;

        const link = await createSealedLink({ subject: 'Asunto', html: '<p>cuerpo confidencial</p>' }, { maxViews: 3 }, fake);
        expect(link.url.startsWith(`https://app.example.com/secure/${ID}#k=`)).toBe(true);
        const key = parseKeyFragment(new URL(link.url).hash)!;
        expect(key).toBeTruthy();

        expect(requests).toHaveLength(1);
        expect(requests[0].url).toBe('/api/secure-message');
        expect(requests[0].body).not.toContain(key);
        expect(requests[0].body).not.toContain('confidencial');
        expect(JSON.parse(requests[0].body).maxViews).toBe(3);

        // Lo que recibio el servidor se descifra con la clave del enlace
        const envelope = JSON.parse(requests[0].body).envelope;
        expect(await openMessage(envelope, key)).toEqual({ subject: 'Asunto', html: '<p>cuerpo confidencial</p>' });
    });

    it('rechaza URLs de vista que no sean /secure/<uuid> (no se enlaza un destino arbitrario)', async () => {
        expect(isSealedViewUrl(`https://a.com/secure/${ID}`)).toBe(true);
        expect(isSealedViewUrl(`javascript:alert(1)`)).toBe(false);
        expect(isSealedViewUrl(`https://a.com/secure/${ID}?x=1`)).toBe(false);
        expect(isSealedViewUrl(`https://a.com/other/${ID}`)).toBe(false);
        expect(isSealedViewUrl(`https://a.com/secure/../${ID}`)).toBe(false);
        const evil = (async () => new Response(JSON.stringify({ viewUrl: 'https://evil.example/phish' }), { status: 200 })) as unknown as typeof fetch;
        await expect(createSealedLink({ subject: '', html: '<p>x</p>' }, {}, evil)).rejects.toThrow();
    });

    it('valida contrasena y vistas antes de cifrar', () => {
        expect(validateSealOptions({ password: 'corta' })).toMatch(/al menos 8/);
        expect(validateSealOptions({ password: 'larga-suficiente' })).toBeNull();
        expect(validateSealOptions({ maxViews: 0 })).toBeTruthy();
        expect(validateSealOptions({ maxViews: 1.5 })).toBeTruthy();
        expect(validateSealOptions({ maxViews: null })).toBeNull();
    });

    it('el cuerpo del correo lleva el enlace y escapa el HTML (sin XSS por la URL ni por avisos)', () => {
        const { html, text } = buildSealedEmailBody({
            url: `https://app.example.com/secure/${ID}#k=abc"><script>alert(1)</script>`,
            hasPassword: true, expiresAt: '2026-10-29T00:00:00.000Z', maxViews: 1,
        });
        expect(html).not.toContain('<script>');
        expect(html).toContain('&quot;&gt;&lt;script&gt;');
        expect(html).toContain('rel="noopener noreferrer nofollow"');
        expect(text).toContain(`/secure/${ID}`);
        expect(html).not.toContain('confidencial');
    });
});
