// @vitest-environment jsdom
/**
 * Componentes de correo bajo 3 paletas de empresa (oscura corporativa, pastel, saturada): el DOM renderizado no
 * contiene clases de paleta cruda y el iframe del correo deriva papel/texto/enlaces de los tokens del tema.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BRAND_FIXTURES } from '@/lib/theme-fixtures';
import { buildBrandThemes } from '@/lib/brand-theme';
import { contrast } from '@/lib/color';

const requests = [
    { id: 'r1', provider: 'google', reason: 'Renovar acceso', requestedBy: 'Calendario', scopes: [] },
    { id: 'r2', provider: 'slack', reason: 'Renovar acceso', scopes: [] },
    { id: 'r3', provider: 'otro', reason: 'Renovar acceso', scopes: [] },
];
vi.mock('@/contexts/ReAuthContext', () => ({ useReAuth: () => ({ requests, dismiss: vi.fn(), dismissAll: vi.fn() }) }));

const themeState = vi.hoisted(() => ({ scheme: 'light' as 'light' | 'dark' }));
vi.mock('@/components/ThemeProvider', () => ({ useTheme: () => ({ scheme: themeState.scheme, mailDarkMode: 'paper', resolvedTheme: { id: `brand-${themeState.scheme}` } }) }));

import { ReAuthBanner } from '../ReAuthBanner';
import { SafeIframe } from '../ui/SafeIframe';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const PALETTES = ['oscura corporativa', 'pastel', 'saturada (texto malo)'] as const;
const RAW = /(?<![\w-])(?:[a-z0-9]+:)*(?:bg|text|border|border-[trblxy]|ring|divide|from|to|via|fill|stroke|outline|placeholder|shadow)-(?:(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}|white|black)(?![\w-])/;

let container: HTMLDivElement;
let root: Root;

function applyTheme(name: (typeof PALETTES)[number], mode: 'light' | 'dark') {
    const themes = buildBrandThemes(BRAND_FIXTURES[name])!;
    const tokens = (mode === 'dark' ? themes.dark : themes.light).tokens as Record<string, string>;
    const el = document.documentElement;
    for (const [k, v] of Object.entries(tokens)) el.style.setProperty(`--color-${k}`, v);
    return tokens;
}
function clearTheme() {
    document.documentElement.removeAttribute('style');
}

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
    clearTheme();
});

describe.each(PALETTES)('paleta %s', (name) => {
    it.each(['light', 'dark'] as const)('ReAuthBanner (%s): sin clases crudas y con superficies de token', async (mode) => {
        applyTheme(name, mode);
        await act(async () => { root.render(React.createElement(ReAuthBanner)); });
        const html = container.innerHTML;
        expect(html).toContain('bg-card');
        expect(RAW.test(html)).toBe(false);
    });

    it.each(['light', 'dark'] as const)('SafeIframe (%s): papel derivado del tema con texto y enlace legibles', async (mode) => {
        const tokens = applyTheme(name, mode);
        themeState.scheme = mode;
        await act(async () => {
            root.render(React.createElement(SafeIframe, { html: '<p>Hola <a href="https://ejemplo.test">enlace</a></p>' }));
        });
        const iframe = container.querySelector('iframe')!;
        const doc = iframe.getAttribute('srcdoc') ?? '';
        const v = (n: string) => new RegExp(`--bx-${n}: (#[0-9a-f]{6});`).exec(doc)?.[1] as string;
        expect(v('paper')).toBeTruthy();
        expect(contrast(v('text'), v('paper'))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(v('link'), v('paper'))).toBeGreaterThanOrEqual(4.5);
        // No quedan colores fijos del correo base en el CSS propio (todo va por variables del tema)
        expect(doc).not.toMatch(/color: #1a1a1a|#2563eb|#f3f4f6|#fef3c7/);
        expect(doc).toContain('var(--bx-link)');
        // Sandbox y CSP intactos
        expect(iframe.getAttribute('sandbox')).toBe('allow-popups allow-popups-to-escape-sandbox allow-scripts');
        expect(doc).toContain("default-src 'none'");
        // En tema claro el papel es el fondo del tema
        if (mode === 'light') expect(v('paper')).toBe(tokens.background);
    });
});
