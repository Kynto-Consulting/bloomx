// @vitest-environment jsdom
/** Grupos Carpetas / Etiquetas de la barra lateral: agrupacion, vacio con boton, colapsar, menu "+" y ayuda. */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { click, installCleanup, mount, q, qa } from '@/components/expansions/kit/__tests__/harness';

vi.mock('@/components/I18nProvider', async () => {
    const { getTranslator } = await import('@/lib/i18n');
    return { useI18n: () => ({ locale: 'es', t: getTranslator('es').t }) };
});
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { SidebarLabelGroups, NewLabelMenu, LabelsHelp } from '../SidebarLabelGroups';
import type { LabelRef } from '@/lib/mail-list';

installCleanup();
const L = (id: string, name: string, extra: Partial<LabelRef> = {}): LabelRef => ({ id, name, color: '#123456', fullPath: name, parentId: null, behavior: 'tag', sortOrder: 0, count: 0, total: 0, ...extra });
const base = { onChanged: vi.fn(), getHref: (l: LabelRef) => `/?label=${l.fullPath}` };
beforeEach(() => { localStorage.clear(); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} }); vi.stubGlobal('CSS', { escape: (s: string) => s }); });

describe('SidebarLabelGroups', () => {
    it('separa carpetas y etiquetas; el hijo hereda el grupo de su raiz; contador por grupo', async () => {
        const labels = [
            L('t', 'DMarc', { count: 236, total: 265 }),
            L('f', 'Informes DMARC', { behavior: 'folder' }),
            L('c', 'Hija carpeta', { behavior: 'folder', parentId: 't', fullPath: 'DMarc/Hija carpeta' }),
        ];
        await mount(<SidebarLabelGroups labels={labels} onCreate={vi.fn()} {...base} />);
        const folders = q('[data-label-group="folder"]')!;
        const tags = q('[data-label-group="tag"]')!;
        expect(folders.querySelectorAll('[role="treeitem"]')).toHaveLength(1);
        expect(folders.querySelector('[data-label-id="f"]')).toBeTruthy();
        expect(tags.querySelector('[data-label-id="t"]')).toBeTruthy();
        expect(folders.querySelector('[data-label-id="c"]')).toBeNull();
        expect(folders.querySelector('button[aria-expanded]')!.textContent).toContain('1');
        expect(tags.querySelector('button[aria-expanded]')!.textContent).toContain('2');
    });
    it('contadores: aria-label "236 sin leer de 265" y total solo con hover', async () => {
        await mount(<SidebarLabelGroups labels={[L('t', 'DMarc', { count: 236, total: 265 })]} onCreate={vi.fn()} {...base} />);
        const row = q('[data-label-id="t"]')!;
        expect(row.getAttribute('aria-label')).toBe('DMarc, 236 sin leer de 265');
        expect(row.querySelector('[data-total]')!.className).toContain('group-hover:inline');
    });
    it('grupo vacio: texto y boton crear; colapsar con aria-expanded', async () => {
        const onCreate = vi.fn();
        await mount(<SidebarLabelGroups labels={[L('t', 'Solo etiqueta')]} onCreate={onCreate} {...base} />);
        const folders = q('[data-label-group="folder"]')!;
        const btn = qa('button', folders).find((b) => b.textContent === 'Crear carpeta')!;
        await click(btn);
        expect(onCreate).toHaveBeenCalledWith('folder');
        const head = q('[data-label-group="tag"] button[aria-expanded]')!;
        expect(head.getAttribute('aria-expanded')).toBe('true');
        await click(head);
        expect(head.getAttribute('aria-expanded')).toBe('false');
        expect(q('[data-label-group="tag"] [role="treeitem"]')).toBeNull();
    });
});

describe('NewLabelMenu y LabelsHelp', () => {
    it('menu + con descripciones y seleccion', async () => {
        const onPick = vi.fn();
        await mount(<NewLabelMenu onPick={onPick} />);
        await click(q('button[aria-haspopup="menu"]')!);
        const items = qa('[role="menuitem"]');
        expect(items).toHaveLength(2);
        expect(items[0].textContent).toContain('Nueva etiqueta');
        expect(items[1].textContent).toContain('Nueva carpeta');
        expect(items[1].textContent).toContain('sale de Entrada');
        await click(items[1]);
        expect(onPick).toHaveBeenCalledWith('folder');
    });
    it('ayuda: popover con enlace a la documentacion', async () => {
        await mount(<LabelsHelp />);
        await click(q('button[aria-haspopup="dialog"]')!);
        const dlg = document.querySelector('[role="dialog"]')!;
        expect(dlg.textContent).toContain('Carpeta');
        expect(dlg.querySelector('a')!.getAttribute('href')).toBe('/docs/features#folders-labels');
    });
});
