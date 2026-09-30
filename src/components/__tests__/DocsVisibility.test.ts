// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
    docs: { visible: true, landingLink: true, footer: false, sidebar: true },
    isLoading: false,
    locale: 'es' as 'es' | 'en',
}));

vi.mock('next/navigation', () => ({ usePathname: () => '/docs' }));
vi.mock('@/hooks/useLandingConfig', () => ({
    useLandingConfig: () => ({ docs: state.docs, isLoading: state.isLoading, locale: state.locale, landing: {}, t: (k: string) => k, text: () => undefined }),
}));
vi.mock('@/hooks/useDomainConfig', () => ({
    useDomainConfig: () => ({ config: { name: 'acme', displayName: 'Acme', logo: null }, extensions: [], isLoading: false, isError: false }),
}));

import DocsLayout from '../../app/docs/layout';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    state.docs = { visible: true, landingLink: true, footer: false, sidebar: true };
    state.isLoading = false;
    state.locale = 'es';
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

const renderDocs = () => act(() => { root.render(React.createElement(DocsLayout, null, React.createElement('p', { id: 'docs-content' }, 'contenido'))); });

describe('docs por empresa (landing.docs.visible)', () => {
    it('visible (por defecto): se muestra el contenido y la navegacion de docs', () => {
        renderDocs();
        expect(container.querySelector('#docs-content')).toBeTruthy();
        expect(container.querySelector('nav')).toBeTruthy();
    });
    it('oculta: 404 amigable en el idioma de la empresa, sin navegacion, sin contenido y volviendo a /login', () => {
        state.docs = { visible: false, landingLink: false, footer: false, sidebar: false };
        renderDocs();
        expect(container.querySelector('#docs-content')).toBeNull();
        expect(container.querySelector('nav')).toBeNull();
        expect(container.textContent).toContain('404');
        expect(container.textContent).toContain('Documentación no disponible');
        const links = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
        expect(links).toEqual(['/login']);
        expect(links.some((h) => h?.startsWith('/docs'))).toBe(false);
    });
    it('oculta en ingles', () => {
        state.docs = { visible: false, landingLink: false, footer: false, sidebar: false };
        state.locale = 'en';
        renderDocs();
        expect(container.textContent).toContain('Documentation unavailable');
    });
    it('mientras carga la config no se muestra el contenido (evita parpadeo de docs ocultas)', () => {
        state.isLoading = true;
        renderDocs();
        expect(container.querySelector('#docs-content')).toBeNull();
        expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    });
});
