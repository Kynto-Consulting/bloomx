// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }) }));

import { SlashMenu } from '../SlashMenu';
import { Editor } from '../Editor';
import { I18nProvider } from '@/components/I18nProvider';
import type { SlashCommand } from '@/lib/slash-commands';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom no implementa estas APIs de layout
(Element.prototype as any).scrollIntoView = () => { };
(Range.prototype as any).getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () { } });
(Range.prototype as any).getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() { } });
(document as any).elementFromPoint = () => null;

let container: HTMLDivElement;
let root: Root;
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const wrap = (child: React.ReactElement, locale: 'es' | 'en' = 'es') => React.createElement(I18nProvider, { locale, children: child });

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});

const commands: SlashCommand[] = [
    { key: 'shrug', description: 'Insert shrug', extensionName: 'Slash Commands' },
    { key: 'smile', description: 'Insert smile', arguments: 'name' },
];

describe('SlashMenu', () => {
    it('listbox accesible: opciones con aria-selected y seleccion sin robar el foco', async () => {
        const onSelect = vi.fn();
        await act(async () => {
            root.render(wrap(React.createElement(SlashMenu, { id: 'm1', commands, activeIndex: 1, x: 10, y: 10, onSelect })));
        });
        const listbox = document.querySelector('[role="listbox"]')!;
        expect(listbox.id).toBe('m1-listbox');
        expect(listbox.getAttribute('aria-label')).toBe('Comandos con barra');
        const options = Array.from(document.querySelectorAll('[role="option"]'));
        expect(options.map((o) => o.getAttribute('aria-selected'))).toEqual(['false', 'true']);
        expect(options[0].id).toBe('m1-option-0');
        expect(options[0].textContent).toContain('shrug');
        expect(options[0].textContent).toContain('de Slash Commands');
        expect(options[1].textContent).toContain('name');
        expect(document.querySelector('[role="status"]')!.textContent).toBe('2 comando(s) disponible(s)');

        const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        await act(async () => { options[0].dispatchEvent(down); });
        expect(down.defaultPrevented).toBe(true); // el editor conserva el foco
        expect(onSelect).toHaveBeenCalledWith(commands[0]);
    });

    it('sin resultados muestra el mensaje (en el idioma activo)', async () => {
        await act(async () => {
            root.render(wrap(React.createElement(SlashMenu, { id: 'm2', commands: [], activeIndex: 0, x: 0, y: 0, onSelect: vi.fn() }), 'en'));
        });
        expect(document.querySelector('[role="listbox"]')).toBeNull();
        expect(container.textContent).toContain('No commands');
    });
});

describe('Editor + slash commands (TipTap en jsdom)', () => {
    const setup = async (execute: (a: string) => void, extra: SlashCommand[] = []) => {
        const list: SlashCommand[] = [
            { key: 'shrug', description: 'Insert shrug', execute },
            { key: 'smile', description: 'Insert smile', execute: vi.fn() },
            ...extra,
        ];
        await act(async () => {
            root.render(wrap(React.createElement(Editor, { value: '', onChange: vi.fn(), slashCommands: list })));
        });
        await flush();
        const dom = container.querySelector('.ProseMirror') as HTMLElement & { editor: any };
        expect(dom?.editor).toBeTruthy();
        return dom;
    };
    const type = async (dom: any, text: string) => {
        await act(async () => { dom.editor.chain().focus().insertContent(text).run(); });
        await flush();
    };
    const key = async (dom: HTMLElement, k: string) => {
        await act(async () => { dom.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); });
        await flush();
    };
    const options = () => Array.from(document.querySelectorAll('[role="option"]')).map((o) => o.textContent || '');

    it('al escribir "/" abre el menu; filtra, navega con flechas, ejecuta con Enter y borra el texto', async () => {
        const execute = vi.fn();
        const dom = await setup(execute);

        await type(dom, '/');
        expect(options()).toHaveLength(2);
        expect(dom.getAttribute('aria-controls')).toContain('listbox');

        await type(dom, 's');
        await type(dom, 'h');
        expect(options()).toHaveLength(1);
        expect(options()[0]).toContain('shrug');

        await key(dom, 'Enter');
        expect(execute).toHaveBeenCalledWith('');
        expect(dom.textContent).toBe('');
        expect(document.querySelector('[role="listbox"]')).toBeNull();
    });

    it('ArrowDown cambia la opcion activa y Enter ejecuta esa; Escape cierra sin ejecutar', async () => {
        const first = vi.fn();
        const second = vi.fn();
        const dom = await setup(first);
        // reemplaza el segundo comando por uno con espia propio
        await act(async () => {
            root.render(wrap(React.createElement(Editor, { value: '', onChange: vi.fn(), slashCommands: [
                { key: 'shrug', description: 'a', execute: first },
                { key: 'smile', description: 'b', execute: second },
            ] })));
        });
        await flush();

        await type(dom, '/s');
        await key(dom, 'ArrowDown');
        const active = document.querySelector('[role="option"][aria-selected="true"]')!;
        expect(active.textContent).toContain('smile');
        expect(dom.getAttribute('aria-activedescendant')).toBe(active.id);

        await key(dom, 'Escape');
        expect(document.querySelector('[role="listbox"]')).toBeNull();
        expect(first).not.toHaveBeenCalled();
        expect(second).not.toHaveBeenCalled();

        await type(dom, 'm');
        await key(dom, 'Enter');
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('comando con argumentos: "/shrug hola" pasa "hola" a execute', async () => {
        const execute = vi.fn();
        const dom = await setup(execute);
        await type(dom, '/shrug hola mundo');
        await key(dom, 'Enter');
        expect(execute).toHaveBeenCalledWith('hola mundo');
        expect(dom.textContent).toBe('');
    });

    it('texto normal con barra no abre el menu ni roba Enter ("1 / 2", "and/or")', async () => {
        const dom = await setup(vi.fn());
        await type(dom, '1 / 2');
        expect(document.querySelector('[role="listbox"]')).toBeNull();
        await type(dom, ' and/or');
        expect(document.querySelector('[role="listbox"]')).toBeNull();
    });

    it('Tab completa la clave y sin comandos instalados el menu nunca aparece', async () => {
        const dom = await setup(vi.fn());
        await type(dom, '/sm');
        await key(dom, 'Tab');
        expect(dom.textContent).toBe('/smile ');

        await act(async () => {
            root.render(wrap(React.createElement(Editor, { value: '', onChange: vi.fn(), slashCommands: [] })));
        });
        await flush();
        await type(dom, ' /x');
        expect(document.querySelector('[data-slash-menu]')).toBeNull();
    });
});
