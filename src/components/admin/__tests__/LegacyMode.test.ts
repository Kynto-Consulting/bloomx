// @vitest-environment jsdom
// Modo heredado en el panel: insignia de fuente por campo, "Mover a credenciales del dominio" y LegacyModeBanner.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

import { ExtensionCredentialsModal } from '../ExtensionCredentialsModal';
import { LegacyModeBanner } from '../LegacyModeBanner';
import { I18nProvider } from '@/components/I18nProvider';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const json = (status: number, body: any) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const click = async (el: Element | null | undefined) => {
    if (!el) throw new Error('elemento no encontrado');
    await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();
};
const button = (text: string) => Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes(text)) as HTMLButtonElement | undefined;

async function render(node: React.ReactElement, locale: 'es' | 'en' = 'es') {
    await act(async () => {
        root.render(React.createElement(I18nProvider, { locale, children: node }));
    });
    await flush();
}

const openModal = (locale: 'es' | 'en' = 'es') =>
    render(React.createElement(ExtensionCredentialsModal, { open: true, onClose: vi.fn(), domainId: 'dom_1', extension: { id: 'core-notion', name: 'Notion' } }), locale);

beforeEach(() => {
    fetchMock.mockReset();
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

describe('ExtensionCredentialsModal: fuente activa', () => {
    const keys = [
        { name: 'NOTION_API_KEY', configured: true, source: 'domain', movable: false },
        { name: 'NOTION_DATABASE_ID', configured: false, source: 'legacy', movable: true },
        { name: 'GIPHY_API_KEY', configured: false, source: 'server-env', movable: false },
        { name: 'TRELLO_KEY', configured: false, source: 'missing', movable: false },
    ];

    it('muestra una insignia por campo con la fuente y el texto del modo heredado', async () => {
        fetchMock.mockResolvedValueOnce(json(200, { keys }));
        await openModal();
        const dialog = document.querySelector('[role="dialog"]')!;
        expect(document.querySelector('[data-source="domain"]')?.textContent).toContain('Credenciales del dominio');
        expect(document.querySelector('[data-source="legacy"]')?.textContent).toContain('heredadas');
        expect(document.querySelector('[data-source="server-env"]')?.textContent).toContain('Usando credenciales del servidor (modo heredado)');
        expect(document.querySelector('[data-source="missing"]')?.textContent).toContain('Sin configurar');
        expect(dialog.textContent).toContain('Mover a credenciales del dominio');
        expect(dialog.textContent).toContain('no se pueden copiar');
    });

    it('en ingles y sin campo source (backend antiguo) se deduce de configured', async () => {
        fetchMock.mockResolvedValueOnce(json(200, { keys: [{ name: 'NOTION_API_KEY', configured: true }, { name: 'NOTION_DATABASE_ID', configured: false }] }));
        await openModal('en');
        expect(document.querySelector('[data-source="domain"]')?.textContent).toContain('Domain credentials');
        expect(document.querySelector('[data-source="missing"]')?.textContent).toContain('Not configured');
        expect(document.body.textContent).not.toContain('Move to domain credentials');
    });

    it('"Mover" hace POST migrate-legacy, refresca las fuentes y avisa; no envia ni recibe valores', async () => {
        fetchMock
            .mockResolvedValueOnce(json(200, { keys }))
            .mockResolvedValueOnce(json(200, {
                success: true,
                migrated: ['NOTION_DATABASE_ID'],
                serverEnv: ['GIPHY_API_KEY'],
                keys: keys.map((k) => (k.name === 'NOTION_DATABASE_ID' ? { ...k, configured: true, source: 'domain', movable: false } : k)),
            }));
        await openModal();
        await click(button('Mover a credenciales del dominio'));

        const [url, init] = fetchMock.mock.calls[1];
        expect(url).toBe('/api/admin/extensions/settings');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({ domainId: 'dom_1', extensionId: 'core-notion', action: 'migrate-legacy' });
        expect(document.body.textContent).toContain('Se movieron 1 credencial(es)');
        expect(document.querySelector('[data-source="legacy"]')).toBeNull();
        expect(button('Mover a credenciales del dominio')).toBeUndefined();
        // el aviso sobre el entorno global sigue porque esa no se puede copiar
        expect(document.body.textContent).toContain('no se pueden copiar');
    });

    it('error al mover: mensaje de error y sin cambios en la lista', async () => {
        fetchMock.mockResolvedValueOnce(json(200, { keys })).mockResolvedValueOnce(json(403, { error: 'x' }));
        await openModal();
        await click(button('Mover a credenciales del dominio'));
        expect(document.querySelector('[role="alert"]')?.textContent).toContain('permiso');
        expect(document.querySelector('[data-source="legacy"]')).not.toBeNull();
    });
});

describe('LegacyModeBanner', () => {
    it('sin clave registrada: aviso de modo heredado con enlace al registro', async () => {
        fetchMock.mockResolvedValueOnce(json(200, { registered: false, requireSignature: false, legacyMode: true }));
        await render(React.createElement(LegacyModeBanner, { domainId: 'dom_1' }));
        expect(String(fetchMock.mock.calls[0][0])).toContain('/api/admin/domain-key?domainId=dom_1');
        const alert = document.querySelector('[role="alert"]')!;
        expect(alert.textContent).toContain('Este dominio usa el modo heredado sin firma: registra tu clave de firma para activar la protección');
        expect(alert.querySelector('a')?.getAttribute('href')).toBe('/docs/api-backend#signing');
        expect(button('Exigir firma')).toBeUndefined();
    });

    it('en ingles', async () => {
        fetchMock.mockResolvedValueOnce(json(200, { registered: false, requireSignature: false, legacyMode: true }));
        await render(React.createElement(LegacyModeBanner, { domainId: 'dom_1' }), 'en');
        expect(document.querySelector('[role="alert"]')?.textContent).toContain('This domain uses legacy mode without a signature: register your signing key to enable protection');
    });

    it('con clave registrada ofrece activar requireSignature y lo envia', async () => {
        fetchMock
            .mockResolvedValueOnce(json(200, { registered: true, requireSignature: false, legacyMode: false }))
            .mockResolvedValueOnce(json(200, { success: true, requireSignature: true }));
        await render(React.createElement(LegacyModeBanner, { domainId: 'dom_1' }));
        await click(button('Exigir firma'));
        const [url, init] = fetchMock.mock.calls[1];
        expect(url).toBe('/api/admin/domain-key');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({ domainId: 'dom_1', requireSignature: true });
        expect(document.body.textContent).toContain('Firma exigida');
        expect(button('Desactivar exigencia de firma')).toBeDefined();
    });

    it('requireSignature ya activo: confirmacion; error de red o HTTP: no muestra nada bloqueante', async () => {
        fetchMock.mockResolvedValueOnce(json(200, { registered: true, requireSignature: true, legacyMode: false }));
        await render(React.createElement(LegacyModeBanner, { domainId: 'dom_1' }));
        expect(document.querySelector('[role="status"]')?.textContent).toContain('Firma exigida');
        await act(async () => root.unmount());
        root = createRoot(container);
        fetchMock.mockResolvedValueOnce(json(500, {}));
        await render(React.createElement(LegacyModeBanner, { domainId: 'dom_1' }));
        expect(container.textContent).toBe('');
    });

    it('un error al activar muestra alerta; sin domainId no consulta', async () => {
        fetchMock
            .mockResolvedValueOnce(json(200, { registered: true, requireSignature: false, legacyMode: false }))
            .mockResolvedValueOnce(json(409, { error: 'x' }));
        await render(React.createElement(LegacyModeBanner, { domainId: 'dom_1' }));
        await click(button('Exigir firma'));
        expect(document.querySelector('[role="alert"]')?.textContent).toContain('No se pudo cambiar');
        await act(async () => root.unmount());
        root = createRoot(container);
        fetchMock.mockReset();
        await render(React.createElement(LegacyModeBanner, {}));
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
