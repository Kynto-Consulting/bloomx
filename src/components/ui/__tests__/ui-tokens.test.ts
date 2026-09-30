// @vitest-environment jsdom
/**
 * ui/* con 3 paletas de empresa: los componentes base solo emiten clases de tokens (nunca paleta cruda) y todo
 * token que usan existe en la paleta activa. Tailwind no se compila en jsdom, asi que se comprueba (1) el marcado
 * y (2) que el CSS de la empresa (buildBrandCss) define cada variable --color-<token> que esas clases consumen.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BRAND_FIXTURES } from '@/lib/theme-fixtures';
import { buildBrandCss, buildBrandThemes } from '@/lib/brand-theme';
import { TOKEN_KEYS } from '@/lib/theme-config';
import { RAW_CLASS } from '@/lib/__tests__/helpers/raw-colors';
import { Button } from '../button';
import { Input } from '../input';
import { Card, CardContent, CardDescription, CardTitle } from '../card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../tabs';
import { Modal } from '../Modal';
import { ConfirmDialog } from '../ConfirmDialog';
import { Drawer } from '../Drawer';
import { TagInput } from '../TagInput';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const PALETTES = ['oscura corporativa', 'pastel', 'saturada (texto malo)'] as const;
const TOKEN_CLASS = new RegExp(String.raw`(?<![\w-])(?:[a-z-]+:)*(?:bg|text|border|ring|ring-offset|divide|outline|decoration|fill|stroke)-(${[...TOKEN_KEYS].sort((a, b) => b.length - a.length).join('|')})(?:/[0-9]+)?(?![\w-])`, 'g');

let container: HTMLDivElement;
let root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); document.head.querySelectorAll('style[data-test]').forEach((s) => s.remove()); document.documentElement.removeAttribute('data-theme'); });

async function mount(node: React.ReactElement) { await act(async () => { root.render(node); }); }
const noop = vi.fn();
const h = React.createElement;

function tree(): React.ReactElement {
    return h('div', null,
        (['default', 'secondary', 'destructive', 'outline', 'ghost', 'link'] as const).map((variant) =>
            h(Button, { key: variant, variant }, variant)),
        h(Button, { disabled: true }, 'off'),
        h(Input, { 'aria-invalid': true, placeholder: 'x' }),
        h(Card, null, h(CardTitle, null, 'T'), h(CardDescription, null, 'd'), h(CardContent, null, 'c')),
        h(Tabs, { defaultValue: 'a' }, h(TabsList, null, h(TabsTrigger, { value: 'a' }, 'A')), h(TabsContent, { value: 'a' }, 'x')),
        h(TagInput, { value: ['ok@x.com', 'mal'], onChange: noop }),
        h(Modal, { open: true, onClose: noop, ariaLabel: 'm', children: h('p', null, 'hola') }),
        h(ConfirmDialog, { open: true, title: 't', description: 'd', confirmLabel: 'ok', cancelLabel: 'no', destructive: true, onConfirm: noop, onCancel: noop }),
        h(Drawer, { open: true, onClose: noop, label: 'd', children: h('p', null, 'x') }),
    );
}

describe.each(PALETTES)('ui/* con la paleta "%s"', (name) => {
    const cfg = BRAND_FIXTURES[name];
    const themes = buildBrandThemes(cfg)!;

    it('la paleta define todos los tokens y el CSS los emite para claro y oscuro', () => {
        const css = buildBrandCss(cfg);
        for (const mode of ['brand-light', 'brand-dark']) {
            expect(css).toContain(`data-theme="${mode}"`);
        }
        for (const token of TOKEN_KEYS) {
            expect(themes.light.tokens[token], `${name}/light/${token}`).toBeTruthy();
            expect(themes.dark.tokens[token], `${name}/dark/${token}`).toBeTruthy();
            expect(css, `--color-${token}`).toContain(`--color-${token}:`);
        }
    });

    it('los componentes base renderizan solo tokens que existen en la paleta y ninguna paleta cruda', async () => {
        const style = document.createElement('style');
        style.setAttribute('data-test', '');
        style.textContent = buildBrandCss(cfg);
        document.head.appendChild(style);
        document.documentElement.setAttribute('data-theme', 'brand-dark');
        await mount(tree());
        const html = document.body.innerHTML;

        expect(html.match(RAW_CLASS) ?? []).toEqual([]);
        const used = new Set<string>();
        for (const m of html.matchAll(TOKEN_CLASS)) used.add(m[1]);
        // Las piezas clave estan presentes
        for (const t of ['primary', 'primary-foreground', 'secondary', 'destructive', 'input', 'ring', 'overlay', 'card', 'muted', 'border', 'link']) {
            expect(used.has(t), `token esperado en el marcado: ${t}`).toBe(true);
        }
        const css = style.textContent ?? '';
        for (const t of used) expect(css, `--color-${t} sin definir`).toContain(`--color-${t}:`);
    });

    it('cada variante de Button lleva su pareja fondo/texto del mismo token', async () => {
        await mount(h('div', null, h(Button, { variant: 'default' }, 'a'), h(Button, { variant: 'destructive' }, 'b'), h(Button, { variant: 'secondary' }, 'c')));
        const [a, b, c] = Array.from(container.querySelectorAll('button')).map((e) => e.className);
        expect(a).toMatch(/bg-primary[^/]/); expect(a).toContain('text-primary-foreground');
        expect(b).toContain('bg-destructive'); expect(b).toContain('text-destructive-foreground');
        expect(c).toContain('bg-secondary'); expect(c).toContain('text-secondary-foreground');
    });
});
