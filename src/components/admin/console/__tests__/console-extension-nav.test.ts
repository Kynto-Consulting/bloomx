// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let pathname = '/admin';
vi.mock('next/navigation', () => ({
    usePathname: () => pathname,
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => React.createElement('a', { href, ...rest }, children) }));

const metricsExtension = (extra: Record<string, any> = {}) => ({
    id: 'core-domain-metrics',
    version: '1.0.0',
    ...extra,
    template: {
        manifestVersion: '1.0', id: 'core-domain-metrics', name: 'Metricas', version: '1.0.0', permissions: [],
        requires: { clientApi: 8, capabilities: ['nav.entries.v1', 'ext.pages.auth.v1', 'ui.pages.v1'] },
        mounts: [{ point: 'PAGE', path: 'metrics', auth: 'admin', minLevel: 2, component: { type: 'PAGE_HEADER', props: { title: 'Metricas' } } }],
        navEntries: [{ id: 'metrics', section: 'admin', label: { es: 'Métricas del dominio', en: 'Domain metrics' }, icon: 'ChartColumn', target: 'page:metrics' }],
    },
});
let config: { allExtensions: any[]; viewerLevel: number | null } = { allExtensions: [], viewerLevel: null };
vi.mock('@/hooks/useDomainConfig', () => ({
    useDomainConfig: () => ({
        config: { id: 'dom1', name: 'mail.acme.test', displayName: 'Acme Mail', logo: null },
        extensions: config.allExtensions, allExtensions: config.allExtensions, viewerLevel: config.viewerLevel, isLoading: false,
    }),
}));

import { I18nProvider } from '@/components/I18nProvider';
import { ConsoleShell } from '../ConsoleShell';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
const h = React.createElement;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const json = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);

function stubFetch(level: number) {
    vi.stubGlobal('fetch', vi.fn(async (input: any) => {
        const url = String(input);
        if (url.includes('/api/admin/me')) return json(200, { me: { kind: 'user', id: 'u1', email: 'admin@acme.test', userId: 'u1', instanceDomain: 'mail.acme.test', permission_level: level } });
        if (url.includes('/api/admin/system')) return json(200, { status: 'ok', db: { ok: true, ms: 3 }, backend: { ok: true, ms: 40 }, rateLimit: 'memory', legacy: false });
        if (url.includes('/api/ext/')) return json(200, { count: 4 });
        return json(404, {});
    }));
}
async function mountShell(locale: 'es' | 'en' = 'es') {
    await act(async () => {
        root.render(h(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, h(I18nProvider, { locale, children: h(ConsoleShell, null, h('p', null, 'contenido')) })));
    });
    await flush();
    await flush();
}

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    pathname = '/admin';
    config = { allExtensions: [metricsExtension()], viewerLevel: 3 };
    window.localStorage.clear();
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});

describe('consola de administracion: entradas de menu de extensiones', () => {
    it('nivel suficiente: grupo "Extensiones" con el enlace dentro de la consola (/admin/x/<path>)', async () => {
        stubFetch(3);
        await mountShell();
        const group = q('aside [data-console-extension-nav]')!;
        expect(group).toBeTruthy();
        expect(group.textContent).toContain('Extensiones');
        const link = group.querySelector('a')!;
        expect(link.getAttribute('href')).toBe('/admin/x/metrics');
        expect(link.textContent).toContain('Métricas del dominio');
    });

    it('en ingles usa la etiqueta en ingles', async () => {
        stubFetch(3);
        await mountShell('en');
        expect(q('aside [data-console-extension-nav] a')!.textContent).toContain('Domain metrics');
        expect(q('aside [data-console-extension-nav]')!.textContent).toContain('Extensions');
    });

    it('nivel insuficiente (1 < minLevel 2 de la pagina): la entrada NO se pinta aunque el servidor la hubiera enviado', async () => {
        stubFetch(1);
        await mountShell();
        expect(q('[data-console-extension-nav]')).toBeNull();
        expect(document.body.textContent).not.toContain('Métricas del dominio');
    });

    it('sin nivel conocido (la puerta aun no respondio o fallo) falla cerrado', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => json(403, { error: 'Forbidden' })));
        await mountShell();
        expect(q('[data-console-extension-nav]')).toBeNull();
        expect(q('aside')).toBeNull();
    });

    it('extension bloqueada por la IA: entrada deshabilitada con el motivo y sin enlace', async () => {
        config = { allExtensions: [metricsExtension({ aiBlock: { blocked: true } })], viewerLevel: 3 };
        stubFetch(3);
        await mountShell();
        const group = q('aside [data-console-extension-nav]')!;
        expect(group.querySelector('a')).toBeNull();
        const disabled = group.querySelector('[aria-disabled="true"]')!;
        expect(disabled.getAttribute('title')).toBe('En pausa: la IA está desactivada');
        expect(disabled.textContent).toContain('En pausa: la IA está desactivada');
    });

    it('la pagina activa marca aria-current y aparece en el breadcrumb', async () => {
        pathname = '/admin/x/metrics';
        stubFetch(3);
        await mountShell();
        expect(q('aside [data-console-extension-nav] a')!.getAttribute('aria-current')).toBe('page');
        expect(q('nav[aria-label="Ruta de navegación"]')!.textContent).toContain('Métricas del dominio');
    });

    it('busqueda global (Ctrl/Cmd+K): encuentra la pagina de la extension y no la ofrece a un nivel insuficiente', async () => {
        stubFetch(3);
        await mountShell();
        await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true })); });
        await flush();
        const input = q<HTMLInputElement>('[role="dialog"] input[role="combobox"]')!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'metricas');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await flush();
        const options = Array.from(document.querySelectorAll('[role="option"]'));
        expect(options.some((o) => o.textContent?.includes('Métricas del dominio'))).toBe(true);
    });

    it('la insignia de una entrada admin se muestra solo si la ruta responde un numero', async () => {
        pathname = '/admin';
        config = { allExtensions: [{ ...metricsExtension(), template: { ...metricsExtension().template, api: { functions: { b: { handler: 'b' } } }, requires: { clientApi: 8, capabilities: ['nav.entries.v1', 'ext.pages.auth.v1', 'ui.pages.v1', 'ext.routes.v1', 'ext.routes.auth.v1'] }, backendRoutes: [{ path: '/badge', handler: 'b', method: 'GET', auth: 'admin', minLevel: 2 }], navEntries: [{ id: 'metrics', section: 'admin', label: 'Metricas', target: 'page:metrics', badge: { route: '/badge', refreshSeconds: 60 } }] } }], viewerLevel: 3 };
        stubFetch(3);
        await mountShell();
        const calls = (fetch as any).mock.calls.map((c: any[]) => String(c[0]));
        expect(calls).toContain('/api/ext/core-domain-metrics/badge');
        const link = q('aside [data-console-extension-nav] a')!;
        expect(link.textContent).toContain('4');
        expect(link.getAttribute('aria-label')).toBe('Metricas, 4 pendientes');
    });

    it('si la ruta de la insignia falla, la entrada sigue funcionando sin numero (y deja de consultarse tras 3 fallos)', async () => {
        config = { allExtensions: [{ ...metricsExtension(), template: { ...metricsExtension().template, api: { functions: { b: { handler: 'b' } } }, requires: { clientApi: 8, capabilities: ['nav.entries.v1', 'ext.pages.auth.v1', 'ui.pages.v1', 'ext.routes.v1', 'ext.routes.auth.v1'] }, backendRoutes: [{ path: '/badge', handler: 'b', method: 'GET', auth: 'admin', minLevel: 2 }], navEntries: [{ id: 'metrics', section: 'admin', label: 'Metricas', target: 'page:metrics', badge: { route: '/badge' } }] } }], viewerLevel: 3 };
        vi.stubGlobal('fetch', vi.fn(async (input: any) => {
            const url = String(input);
            if (url.includes('/api/admin/me')) return json(200, { me: { kind: 'user', id: 'u1', email: 'a@b.c', userId: 'u1', instanceDomain: 'x', permission_level: 3 } });
            if (url.includes('/api/ext/')) return json(500, { error: 'boom' });
            return json(200, { status: 'ok' });
        }));
        await mountShell();
        const link = q('aside [data-console-extension-nav] a')!;
        expect(link).toBeTruthy();
        expect(link.getAttribute('aria-label')).toBeNull();
        expect(link.querySelector('[aria-hidden="true"].rounded-full')).toBeNull();
    });
});
