// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

import { ExtensionCredentialsModal } from '../ExtensionCredentialsModal';
import { I18nProvider } from '@/components/I18nProvider';
import { toast } from 'sonner';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();
const onClose = vi.fn();

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const json = (status: number, body: any) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const setValue = async (el: HTMLInputElement, value: string) => {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    });
};
const click = async (el: Element | null | undefined) => {
    if (!el) throw new Error('elemento no encontrado');
    await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();
};
const byLabel = (text: string) =>
    Array.from(document.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') || b.textContent || '').includes(text)) as HTMLButtonElement | undefined;
const input = (name: string) => document.querySelector<HTMLInputElement>(`input[id$="-${name}"]`)!;

async function open(locale: 'es' | 'en' = 'es') {
    await act(async () => {
        root.render(
            React.createElement(I18nProvider, {
                locale,
                children: React.createElement(ExtensionCredentialsModal, {
                    open: true,
                    onClose,
                    domainId: 'dom_1',
                    extension: { id: 'core-notion', name: 'Notion' },
                }),
            }),
        );
    });
    await flush();
}

beforeEach(() => {
    fetchMock.mockReset();
    onClose.mockReset();
    (toast.success as any).mockReset?.();
    vi.stubGlobal('fetch', fetchMock);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});

describe('ExtensionCredentialsModal', () => {
    it('carga el estado, enmascara y nunca muestra un valor guardado', async () => {
        fetchMock.mockResolvedValueOnce(json(200, { keys: [{ name: 'NOTION_API_KEY', configured: true }, { name: 'NOTION_DATABASE_ID', configured: false }] }));
        await open();

        const url = String(fetchMock.mock.calls[0][0]);
        expect(url).toContain('/api/admin/extensions/settings?');
        expect(url).toContain('domainId=dom_1');
        expect(url).toContain('extensionId=core-notion');

        const dialog = document.querySelector('[role="dialog"]')!;
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
        expect(dialog.textContent).toContain('Credenciales de Notion');
        expect(dialog.textContent).toContain('NOTION_API_KEY');
        expect(dialog.textContent).toContain('Configurada');
        expect(dialog.textContent).toContain('Sin configurar');
        expect(input('NOTION_API_KEY').type).toBe('password');
        expect(input('NOTION_API_KEY').value).toBe('');
    });

    it('muestra/oculta solo el valor escrito y valida en vivo', async () => {
        fetchMock.mockResolvedValueOnce(json(200, { keys: [{ name: 'NOTION_API_KEY', configured: false }] }));
        await open();
        const field = input('NOTION_API_KEY');

        await click(byLabel('Mostrar el valor escrito de NOTION_API_KEY'));
        expect(input('NOTION_API_KEY').type).toBe('text');
        await click(byLabel('Ocultar el valor escrito'));
        expect(input('NOTION_API_KEY').type).toBe('password');

        await setValue(field, 'a\tb');
        expect(field.getAttribute('aria-invalid')).toBe('true');
        expect(document.querySelector('[role="alert"]')?.textContent).toContain('caracteres de control');

        await setValue(field, 'secret_ok');
        expect(field.getAttribute('aria-invalid')).toBeNull();
    });

    it('rota, borra y envia solo los cambios; luego limpia los campos y notifica', async () => {
        fetchMock
            .mockResolvedValueOnce(json(200, { keys: [{ name: 'NOTION_API_KEY', configured: true }, { name: 'NOTION_DATABASE_ID', configured: true }] }))
            .mockResolvedValueOnce(json(200, { success: true, keys: [{ name: 'NOTION_API_KEY', configured: true }, { name: 'NOTION_DATABASE_ID', configured: false }] }));
        await open();

        expect((document.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true); // sin cambios

        await setValue(input('NOTION_API_KEY'), '  secret_nueva  ');
        await click(byLabel('Eliminar NOTION_DATABASE_ID'));
        await click(document.querySelector('button[type="submit"]'));

        const [url, init] = fetchMock.mock.calls[1];
        expect(url).toBe('/api/admin/extensions/settings');
        expect(init.method).toBe('PUT');
        expect(JSON.parse(init.body)).toEqual({
            domainId: 'dom_1',
            extensionId: 'core-notion',
            credentials: { NOTION_API_KEY: 'secret_nueva', NOTION_DATABASE_ID: null },
        });
        expect(toast.success).toHaveBeenCalledWith('Credenciales guardadas');
        expect(input('NOTION_API_KEY').value).toBe('');
        expect(document.querySelector('[role="dialog"]')!.textContent).toContain('Sin configurar');
        expect(document.body.innerHTML).not.toContain('secret_nueva');
    });

    it('errores del servidor se muestran traducidos (403, en ingles)', async () => {
        fetchMock
            .mockResolvedValueOnce(json(200, { keys: [{ name: 'NOTION_API_KEY', configured: false }] }))
            .mockResolvedValueOnce(json(403, { error: 'Unauthorized domain access' }));
        await open('en');
        await setValue(input('NOTION_API_KEY'), 'x');
        await click(document.querySelector('button[type="submit"]'));
        expect(document.querySelector('[role="alert"]')?.textContent).toContain('You do not have permission to manage this domain.');
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('si falla la carga ofrece reintentar y no muestra campos', async () => {
        fetchMock
            .mockResolvedValueOnce(json(500, { error: 'x' }))
            .mockResolvedValueOnce(json(200, { keys: [{ name: 'GIPHY_API_KEY', configured: false }] }));
        await open();
        expect(document.querySelector('[role="alert"]')?.textContent).toContain('No se pudo cargar');
        expect(document.querySelector('input')).toBeNull();
        await click(byLabel('Reintentar'));
        expect(document.querySelector('input')).not.toBeNull();
    });

    it('extension sin ENV_READ: mensaje explicativo', async () => {
        fetchMock.mockResolvedValueOnce(json(200, { keys: [] }));
        await open();
        expect(document.querySelector('[role="dialog"]')!.textContent).toContain('no declara credenciales propias');
    });

    it('Escape cierra el dialogo', async () => {
        fetchMock.mockResolvedValueOnce(json(200, { keys: [] }));
        await open();
        await act(async () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        expect(onClose).toHaveBeenCalled();
    });
});
