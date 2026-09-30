// @vitest-environment jsdom
/**
 * /extensions: "Actualizacion disponible" con boton Actualizar para el administrador dueno, y el aviso del manifest invalido/degradado
 * con la version en uso y la del catalogo ("Se esta usando la version 1.0.0; el catalogo tiene la 1.1.0: actualiza").
 */
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, installCleanup, mount, q, qa } from '@/components/expansions/kit/__tests__/harness';

const state = vi.hoisted(() => ({
    extensions: [] as any[],
    params: new URLSearchParams(),
    catalog: [] as any[],
    updateStatus: 200,
    updateBody: { success: true, updated: true, from: '1.0.0', to: '1.1.0' } as any,
}));

vi.mock('@/hooks/useDomainConfig', () => ({ useDomainConfig: () => ({ extensions: state.extensions, isLoading: false, isError: undefined, extensionsLoaded: true, config: { id: 'dom1' }, themeConfig: {} }) }));
vi.mock('@/components/SessionProvider', () => ({ useSession: () => ({ data: { user: { id: 'u1', email: 'yo@example.com' } }, status: 'authenticated' }) }));
vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
    useSearchParams: () => state.params,
    usePathname: () => '/extensions',
    notFound: () => { throw new Error('notFound'); },
}));

import { ManageExtensionsPage } from '../ManageExtensionsPage';
import { __resetExtensionErrors } from '@/lib/expansions/client/error-log';
import { EMPTY_PREFS, setPrefs } from '@/lib/expansions/client/prefs';

const FIX = path.resolve(__dirname, '../../../../lib/expansions/__tests__/fixtures/legacy');
const legacy = (name: string) => JSON.parse(fs.readFileSync(path.join(FIX, `${name}.json`), 'utf8'));
/** El boton lleva un texto solo-lector con el nombre: se busca por el inicio del texto visible. */
const updateButton = () => qa<HTMLButtonElement>('button').find((b) => b.textContent?.trim().startsWith('Actualizar')) ?? null;
const calls: Array<{ url: string; body: any }> = [];

function fetchMock() {
    return vi.fn(async (url: string, init?: any) => {
        const pathname = new URL(String(url), 'https://f.test').pathname;
        if (pathname === '/api/admin/extensions/catalog') return { ok: true, status: 200, json: async () => ({ extensions: state.catalog }) };
        if (pathname === '/api/admin/extensions/update') {
            calls.push({ url: pathname, body: JSON.parse(init.body) });
            return { ok: state.updateStatus < 300, status: state.updateStatus, json: async () => state.updateBody };
        }
        return { ok: false, status: 401, json: async () => ({}) };
    });
}

describe('/extensions: actualizar', () => {
    installCleanup();
    beforeEach(() => {
        localStorage.clear();
        __resetExtensionErrors();
        setPrefs(EMPTY_PREFS, { sync: false });
        calls.length = 0;
        state.extensions = [{ id: 'core-signature', template: legacy('signature') }];
        state.catalog = [{ id: 'core-signature', version: '1.1.0', isPaid: false }];
        state.params = new URLSearchParams('ext=core-signature');
        state.updateStatus = 200;
        state.updateBody = { success: true, updated: true, from: '1.0.0', to: '1.1.0' };
        vi.stubGlobal('fetch', fetchMock());
        vi.spyOn(console, 'warn').mockImplementation(() => { });
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

    it('signature 1.0.0 con catalogo 1.1.0: insignia "Actualizacion disponible", detalle con boton Actualizar y problemas por mount', async () => {
        await mount(<ManageExtensionsPage />);
        await flush();
        await flush();
        const card = q('[data-extension-id="core-signature"]')!;
        expect(card.textContent).toContain('Actualizacion disponible');
        // La extension NO se desactiva: sigue "Activa", no "Manifest invalido".
        expect(card.getAttribute('data-state')).toBe('active');
        const detail = q('[data-testid="extension-detail"]')!;
        expect(detail.textContent).toContain('la version 1.1.0 esta publicada y tienes la 1.0.0');
        expect(detail.textContent).toContain('Se está usando la versión 1.0.0; el catálogo tiene la 1.1.0: actualiza.');
        expect(detail.querySelector('[data-testid="manifest-problems"]')!.textContent).toContain('mounts[0].handler');
        expect(updateButton()).toBeTruthy();
    });

    it('Actualizar llama a /api/admin/extensions/update con dominio y extension, y avisa del resultado', async () => {
        await mount(<ManageExtensionsPage />);
        await flush();
        await flush();
        await click(updateButton()!);
        await flush();
        expect(calls).toEqual([{ url: '/api/admin/extensions/update', body: { domainId: 'dom1', extensionId: 'core-signature' } }]);
        expect(document.body.textContent).toContain('actualizada a la versión 1.1.0');
    });

    it('si el catalogo aun no es valido (EXTENSION_INVALID) explica que hay que republicar', async () => {
        state.updateStatus = 502;
        state.updateBody = { error: 'x', code: 'EXTENSION_INVALID' };
        await mount(<ManageExtensionsPage />);
        await flush();
        await flush();
        await click(updateButton()!);
        await flush();
        expect(document.body.textContent).toContain('hay que republicar la extensión (sync-extensions)');
    });

    it('sin catalogo (no es administrador) no hay boton Actualizar, pero la insignia de la version sigue a partir del catalogo si lo hay', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })));
        await mount(<ManageExtensionsPage />);
        await flush();
        await flush();
        expect(updateButton()).toBeNull();
    });

    it('un manifest realmente invalido muestra el motivo y la pista de actualizar', async () => {
        state.extensions = [{ id: 'rota', template: { id: 'rota', name: 'Rota', version: '1.0.0', mounts: 'no-es-lista' } }];
        state.catalog = [{ id: 'rota', version: '1.2.0', isPaid: false }];
        state.params = new URLSearchParams();
        await mount(<ManageExtensionsPage />);
        await flush();
        await flush();
        const card = q('[data-extension-id="rota"]')!;
        expect(card.getAttribute('data-state')).toBe('invalid');
        expect(card.textContent).toContain('Manifest invalido: esta extension no se carga');
        expect(card.textContent).toContain('Se está usando la versión 1.0.0; el catálogo tiene la 1.2.0: actualiza.');
    });

    it('extension con mounts descartados: nota "se descartaron N elemento(s)" en la tarjeta', async () => {
        state.extensions = [{ id: 'mixta', template: { id: 'mixta', name: 'Mixta', version: '1.0.0', mounts: [{ point: 'EMAIL_TOOLBAR', component: { type: 'BUTTON', props: { label: 'Bien' } } }, { point: 'NO_EXISTE', component: { type: 'BUTTON', props: { label: 'Mal' } } }] } }];
        state.catalog = [];
        state.params = new URLSearchParams();
        await mount(<ManageExtensionsPage />);
        await flush();
        await flush();
        expect(q('[data-extension-id="mixta"] [data-testid="degraded-note"]')!.textContent).toContain('Se descartaron 1 elemento(s)');
    });
});
