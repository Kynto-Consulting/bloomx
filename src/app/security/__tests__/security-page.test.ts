// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({ default: ({ href, children }: any) => React.createElement('a', { href }, children) }));
vi.mock('@/components/MfaPanels', () => ({ MfaEnrollForm: () => React.createElement('div', null, 'enroll') }));

import SecurityPage from '../page';
import { I18nProvider } from '@/components/I18nProvider';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();
const assign = vi.fn();
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });
const mfaOff = { available: true, enabled: false, pendingEnrollment: false, recoveryCodesLeft: 0, required: false };

async function open(search = '', locale: 'es' | 'en' = 'es') {
    vi.stubGlobal('location', { search, href: `http://localhost/security${search}`, assign, pathname: '/security' });
    await act(async () => { root.render(React.createElement(I18nProvider, { locale, children: React.createElement(SecurityPage) })); });
    await flush();
}
const setValue = async (el: HTMLInputElement, v: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
});
const field = (label: string) => {
    const l = Array.from(document.querySelectorAll('label')).find((x) => x.textContent === label)!;
    return document.getElementById(l.getAttribute('for')!) as HTMLInputElement;
};
const submit = async () => { await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await flush(); };
const fill = async (cur: string, next: string, conf: string) => {
    await setValue(field('Contraseña actual'), cur);
    await setValue(field('Nueva contraseña'), next);
    await setValue(field('Repite la nueva contraseña'), conf);
};

beforeEach(() => {
    fetchMock.mockReset();
    assign.mockReset();
    fetchMock.mockImplementation(async (url: string) => (url === '/api/auth/mfa/status' ? reply(200, mfaOff) : reply(404, {})));
    vi.stubGlobal('fetch', fetchMock);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe('/security', () => {
    it('esta internacionalizada: espanol por defecto e ingles con locale en', async () => {
        await open('');
        expect(document.querySelector('h1')?.textContent).toBe('Seguridad de la cuenta');
        expect(document.body.textContent).toContain('Cambiar contraseña');
        expect(document.body.textContent).toContain('Mínimo 12 caracteres');
        expect(document.body.textContent).toContain('Cerrar sesión en todas partes');
        await act(async () => root.unmount());
        root = createRoot(container);
        await open('', 'en');
        expect(document.querySelector('h1')?.textContent).toBe('Account security');
        expect(document.body.textContent).toContain('Sign out everywhere');
        expect(document.body.textContent).not.toContain('admin.console.');
    });

    it('sin ?force=1 no muestra el aviso de cambio forzado', async () => {
        await open('');
        expect(document.body.textContent).not.toContain('Un administrador pidió');
    });

    it('con ?force=1 muestra el aviso claro y, al cambiarla bien, redirige a /', async () => {
        fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === '/api/auth/mfa/status') return reply(200, mfaOff);
            if (url === '/api/profile' && init?.method === 'PUT') return reply(200, { user: {} });
            return reply(404, {});
        });
        await open('?force=1');
        expect(document.querySelector('[role="alert"]')?.textContent).toContain('Un administrador pidió que cambies tu contraseña');
        await fill('Actual-123456789', 'Nueva-Larga-123456', 'Nueva-Larga-123456');
        await submit();
        const put = fetchMock.mock.calls.find(([u, i]) => u === '/api/profile' && i?.method === 'PUT')!;
        expect(JSON.parse(put[1].body)).toEqual({ currentPassword: 'Actual-123456789', newPassword: 'Nueva-Larga-123456' });
        expect(assign).toHaveBeenCalledWith('/');
    });

    it('sin force: cambia la contrasena, avisa y NO redirige', async () => {
        fetchMock.mockImplementation(async (url: string) => (url === '/api/auth/mfa/status' ? reply(200, mfaOff) : reply(200, { user: {} })));
        await open('');
        await fill('Actual-123456789', 'Nueva-Larga-123456', 'Nueva-Larga-123456');
        await submit();
        expect(document.querySelector('[role="status"]')?.textContent).toContain('Contraseña actualizada.');
        expect(assign).not.toHaveBeenCalled();
        expect(field('Contraseña actual').value).toBe('');
    });

    it('valida la politica 12+ y la coincidencia en el cliente (sin peticion)', async () => {
        await open('');
        await fill('Actual-123456789', 'corta', 'corta');
        await submit();
        expect(document.querySelector('[role="alert"]')?.textContent).toContain('al menos 12 caracteres');
        await fill('Actual-123456789', 'Nueva-Larga-123456', 'Distinta-Larga-12345');
        await submit();
        expect(document.querySelector('[role="alert"]')?.textContent).toContain('no coinciden');
        expect(fetchMock.mock.calls.some(([u]) => u === '/api/profile')).toBe(false);
    });

    it('contrasena actual incorrecta: mensaje traducido y sin redireccion', async () => {
        fetchMock.mockImplementation(async (url: string) => (url === '/api/auth/mfa/status' ? reply(200, mfaOff) : reply(400, { error: 'Incorrect current password' })));
        await open('?force=1');
        await fill('Mala-123456789', 'Nueva-Larga-123456', 'Nueva-Larga-123456');
        await submit();
        const alerts = Array.from(document.querySelectorAll('[role="alert"]')).map((a) => a.textContent);
        expect(alerts.some((a) => a?.includes('La contraseña actual no es correcta.'))).toBe(true);
        expect(assign).not.toHaveBeenCalled();
    });

    it('mantiene MFA y cerrar sesion en todas partes', async () => {
        await open('');
        expect(document.body.textContent).toContain('Verificación en dos pasos (TOTP)');
        expect(document.body.textContent).toContain('Recomendada para todas las cuentas.');
        const setup = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Activar')!;
        await act(async () => { setup.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
        expect(document.body.textContent).toContain('enroll');

        fetchMock.mockImplementation(async () => reply(200, {}));
        const out = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Cerrar sesión en todas partes')!;
        await act(async () => { out.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
        await flush();
        const logout = fetchMock.mock.calls.find(([u]) => u === '/api/auth/logout')!;
        expect(JSON.parse(logout[1].body)).toEqual({ all: true });
    });
});
