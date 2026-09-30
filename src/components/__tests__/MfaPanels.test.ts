// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const OTPAUTH = 'otpauth://totp/Bloomx:ana%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Bloomx&algorithm=SHA1&digits=6&period=30';
const toDataURL = vi.fn(async (_text: string, _opts?: unknown) => 'data:image/png;base64,QVJRQ09ERQ==');

vi.mock('qrcode', () => ({ default: { toDataURL: (t: string, o?: unknown) => toDataURL(t, o) }, toDataURL: (t: string, o?: unknown) => toDataURL(t, o) }));

import { MfaEnrollForm } from '../MfaPanels';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

async function renderEnroll() {
    await act(async () => {
        root.render(React.createElement(MfaEnrollForm, { onDone: vi.fn() }));
    });
    await flush();
    await flush();
}

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    toDataURL.mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ secret: 'JBSWY3DPEHPK3PXP', otpauthUri: OTPAUTH }), { status: 200 })));
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});

describe('MfaEnrollForm QR', () => {
    it('genera el QR localmente con el otpauth:// y conserva clave manual y enlace', async () => {
        await renderEnroll();
        expect(toDataURL).toHaveBeenCalledTimes(1);
        expect(toDataURL.mock.calls[0][0]).toBe(OTPAUTH);

        const img = container.querySelector('img') as HTMLImageElement;
        expect(img).toBeTruthy();
        expect(img.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
        // accesible: alt descriptivo, con salida alternativa
        expect(img.getAttribute('alt')).toMatch(/QR code/i);
        expect(img.getAttribute('alt')).toMatch(/setup key/i);
        // fondo blanco fijo para que sea legible en tema oscuro
        expect(container.querySelector('[data-testid="mfa-qr"]')!.className).toContain('bg-white');

        // clave manual agrupada y enlace otpauth siguen presentes
        expect(container.querySelector('code')!.textContent).toBe('JBSW Y3DP EHPK 3PXP');
        expect((container.querySelector('a') as HTMLAnchorElement).getAttribute('href')).toBe(OTPAUTH);
    });

    it('no llama a servicios externos: solo la API de setup', async () => {
        await renderEnroll();
        const urls = (fetch as any).mock.calls.map((c: any[]) => String(c[0]));
        expect(urls).toEqual(['/api/auth/mfa/setup']);
    });

    it('si el QR falla se mantiene la clave manual y el enlace, sin imagen', async () => {
        toDataURL.mockRejectedValueOnce(new Error('canvas'));
        await renderEnroll();
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('code')!.textContent).toContain('JBSW');
        expect(container.querySelector('a')).toBeTruthy();
    });
});
