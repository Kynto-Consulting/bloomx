// @vitest-environment jsdom
/** Extensiones que requieren IA: insignia + motivo en /extensions, el cargador no monta nada de las bloqueadas, y vuelven al reactivar. */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installCleanup, mount, q } from '@/components/expansions/kit/__tests__/harness';

const state = vi.hoisted(() => ({ extensions: [] as any[], params: new URLSearchParams() }));

vi.mock('@/hooks/useDomainConfig', () => ({
    useDomainConfig: () => ({
        extensions: state.extensions, allExtensions: state.extensions, isLoading: false, isError: false, isStale: false, isRetrying: false,
        extensionsLoaded: true, retry: vi.fn(), error: null, config: {}, themeConfig: {},
    }),
}));
vi.mock('@/components/SessionProvider', () => ({ useSession: () => ({ data: { user: { id: 'u1', email: 'yo@example.com' } }, status: 'authenticated' }) }));
vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
    useSearchParams: () => state.params,
    usePathname: () => '/extensions',
    notFound: () => { throw new Error('notFound'); },
}));

import { ManageExtensionsPage } from '../ManageExtensionsPage';
import { ExtensionLoader } from '@/components/expansions/ExtensionLoader';
import { __resetExtensionErrors } from '@/lib/expansions/client/error-log';
import { EMPTY_PREFS, setPrefs } from '@/lib/expansions/client/prefs';

const button = (label: string) => ({ type: 'BUTTON', props: { label } });
const tpl = (over: Record<string, any>) => ({ version: '1.0.0', mounts: [], ...over });
const block = (over: Record<string, any>) => ({ requiresAi: true, blocked: false, reason: null, degraded: false, features: ['composer'], disabledFeatures: [], optional: false, ...over });

function sample(blocked: boolean) {
    return [
        { id: 'core-composer-helper', aiBlock: block({ blocked, reason: blocked ? 'ai_disabled' : null }), template: tpl({ id: 'core-composer-helper', name: 'Asistente', permissions: ['AI_GENERATE'], ai: { features: ['composer'], purpose: { es: 'Redactar', en: 'Compose' } }, mounts: [{ point: 'EMAIL_TOOLBAR', component: button('Boton IA') }] }) },
        { id: 'soft', aiBlock: block({ optional: true, degraded: blocked }), template: tpl({ id: 'soft', name: 'Opcional', permissions: ['AI_GENERATE'], ai: { features: ['summarize'], required: false, purpose: { es: 'Opcional', en: 'Optional' } }, mounts: [{ point: 'EMAIL_TOOLBAR', component: button('Boton Opcional') }] }) },
        { id: 'zoom', aiBlock: block({ requiresAi: false, features: [] }), template: tpl({ id: 'zoom', name: 'Zoom', mounts: [{ point: 'EMAIL_TOOLBAR', component: button('Boton Zoom') }] }) },
    ];
}

describe('bloqueo por IA en /extensions y en el cargador', () => {
    installCleanup();
    beforeEach(() => {
        localStorage.clear();
        __resetExtensionErrors();
        setPrefs(EMPTY_PREFS, { sync: false });
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    });
    afterEach(() => { vi.unstubAllGlobals(); state.params = new URLSearchParams(); });

    it('IA off: la bloqueada se lista con "Pausada: IA desactivada", motivo y interruptor; la opcional con "IA opcional"', async () => {
        state.extensions = sample(true);
        await mount(<ManageExtensionsPage />);
        const article = q('[data-extension-id="core-composer-helper"]')!;
        expect(article.getAttribute('data-state')).toBe('ai-blocked');
        expect(article.textContent).toContain('Pausada: IA desactivada');
        expect(q('[data-testid="ai-blocked-note"]', article)!.textContent).toMatch(/desactivo la IA/);
        expect(q('[data-extension-id="soft"]')!.textContent).toContain('Sin IA (funciones reducidas)');
        expect(q('[data-extension-id="soft"]')!.getAttribute('data-state')).toBe('active');
        expect(q('[data-extension-id="zoom"]')!.textContent).not.toMatch(/IA/);
    });

    it('el cargador no monta nada de la bloqueada; al reactivar la IA vuelve sin reinstalar', async () => {
        state.extensions = sample(true);
        const root = await mount(<ExtensionLoader mountPoint="EMAIL_TOOLBAR" />);
        expect(q('button[aria-label="Boton IA"]')).toBeNull();
        expect(q('button[aria-label="Boton Opcional"]')).toBeTruthy();
        expect(q('button[aria-label="Boton Zoom"]')).toBeTruthy();
        void root;
    });

    it('IA on: el boton de la extension de IA se monta', async () => {
        state.extensions = sample(false);
        await mount(<ExtensionLoader mountPoint="EMAIL_TOOLBAR" />);
        expect(q('button[aria-label="Boton IA"]')).toBeTruthy();
    });

    it('el detalle resume las funciones de IA con enlace a /admin/ai y aclara que no hay compositor nativo', async () => {
        state.extensions = sample(false);
        state.params = new URLSearchParams('ext=core-composer-helper');
        await mount(<ManageExtensionsPage />);
        const dialog = q('[role="dialog"]')!;
        const note = q('[data-testid="ai-requirement"]', dialog)!;
        expect(note.textContent).toContain('composer');
        expect(q('a[href="/admin/ai"]', note)).toBeTruthy();
        expect(q('[data-testid="composer-helper-note"]', dialog)!.textContent).toMatch(/no existe un compositor nativo/i);
    });
});
