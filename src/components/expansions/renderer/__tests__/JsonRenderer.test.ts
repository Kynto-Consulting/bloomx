// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const executeExtensionAction = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock('@/lib/expansions/api', () => ({
    executeExtensionAction: (...args: any[]) => executeExtensionAction(...args),
    fetchExpansions: vi.fn(async () => []),
}));
vi.mock('@/components/ui/SafeIframe', () => ({ SafeIframe: () => null }));
vi.mock('@/components/expansions/ExtensionLoader', () => ({ ExtensionLoader: () => null }));

import { JsonRenderer } from '../JsonRenderer';
import { toast } from 'sonner';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function render(component: any, context: any = { extensionId: 'core-test' }) {
    await act(async () => {
        root.render(React.createElement(JsonRenderer, { component, context }));
    });
}

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const text = () => container.textContent || '';
// Textos integrados del kit: espanol por defecto (la app los localiza); los alias cubren ambos idiomas.
const ALIASES: Record<string, string[]> = { Submit: ['Submit', 'Enviar'], Back: ['Back', 'Atras'] };
const button = (label: string) => Array.from(container.querySelectorAll('button')).find((b) => (ALIASES[label] ?? [label]).some((alias) => b.textContent?.includes(alias) || b.getAttribute('aria-label') === alias)) as HTMLButtonElement;
const click = async (el: Element) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); await flush(); };
const type = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    await act(async () => {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    });
};

beforeEach(() => {
    executeExtensionAction.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => { });
    vi.spyOn(console, 'error').mockImplementation(() => { });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
});

describe('JsonRenderer: CALL_BACKEND con formData (Notion / HubSpot / Trello)', () => {
    const notionLikeForm = {
        type: 'FORM',
        props: {
            onSubmit: { action: 'CALL_BACKEND', function: 'savePage', onSuccess: { action: 'TOAST', message: 'Saved' } },
            fields: [{ name: 'subject', label: 'Page Title', defaultValue: '${context.subject}' }],
        },
    };

    it('sin args explicitos envia los campos del formulario como params', async () => {
        executeExtensionAction.mockResolvedValue({ success: true, result: { ok: true } });
        await render(notionLikeForm, { extensionId: 'core-notion', subject: 'Asunto original', overlays: {}, onClose: () => { } });

        await click(button('Submit'));

        expect(executeExtensionAction).toHaveBeenCalledTimes(1);
        const [extensionId, fn, params, sentContext] = executeExtensionAction.mock.calls[0];
        expect(extensionId).toBe('core-notion');
        expect(fn).toBe('savePage');
        expect(params.subject).toBe('Asunto original');
        // el contexto que viaja no lleva funciones ni overlays
        expect(sentContext.subject).toBe('Asunto original');
        expect(sentContext.overlays).toBeUndefined();
        expect(sentContext.onClose).toBeUndefined();
        expect(toast).toHaveBeenCalledWith('Saved');
    });

    it('lo tecleado llega al backend y los args explicitos ganan sobre formData', async () => {
        executeExtensionAction.mockResolvedValue({ success: true, result: {} });
        await render({
            type: 'FORM',
            props: {
                onSubmit: { action: 'CALL_BACKEND', function: 'createCard', args: { listId: 'L1', name: '${formData.name}' } },
                fields: [{ name: 'name', label: 'Title' }, { name: 'desc', label: 'Desc', type: 'textarea' }],
            },
        });

        await type(container.querySelector('input[name="name"]') as HTMLInputElement, 'Mi tarjeta');
        await type(container.querySelector('textarea[name="desc"]') as HTMLTextAreaElement, 'Detalle');
        await click(button('Submit'));

        const params = executeExtensionAction.mock.calls[0][2];
        expect(params).toMatchObject({ listId: 'L1', name: 'Mi tarjeta', desc: 'Detalle' });
    });

    it('lo tecleado no se pierde cuando otro componente hace SET_STATE', async () => {
        executeExtensionAction.mockResolvedValue({ success: true, result: {} });
        await render({
            type: 'COLUMN',
            children: [
                { type: 'BUTTON', props: { label: 'Poke', onClick: { action: 'SET_STATE', key: 'n', value: 1 } } },
                { type: 'FORM', props: { onSubmit: { action: 'CALL_BACKEND', function: 'f' }, fields: [{ name: 'a', defaultValue: '${state.n}' }] } },
            ],
        });
        const input = () => container.querySelector('input[name="a"]') as HTMLInputElement;
        await type(input(), 'tecleado');
        await click(button('Poke'));
        expect(input().value).toBe('tecleado');
    });
});

describe('JsonRenderer: WIZARD y NEXT_STEP (Trello)', () => {
    const wizard = {
        type: 'WIZARD',
        props: {
            steps: [
                { title: 'Select Board', content: [{ type: 'BUTTON', props: { label: 'Pick', onClick: { actions: [{ action: 'SET_STATE', key: 'board', value: 'B1' }, { action: 'NEXT_STEP' }] } } }] },
                { title: 'Select List', content: [{ type: 'TEXT', props: { content: 'board=${state.board}' } }] },
            ],
        },
    };

    it('NEXT_STEP avanza el asistente y el estado compartido llega al siguiente paso', async () => {
        await render(wizard);
        expect(text()).toContain('Select Board');
        await click(button('Pick'));
        expect(text()).toContain('Select List');
        expect(text()).toContain('board=B1');
        await click(button('Back'));
        expect(text()).toContain('Select Board');
    });

    it('NEXT_STEP tras un CALL_BACKEND conserva el valor del SELECT (onSuccess hereda value)', async () => {
        executeExtensionAction.mockResolvedValue({ success: true, result: [{ id: 'l1', name: 'Todo' }] });
        await render({
            type: 'WIZARD',
            props: {
                steps: [
                    {
                        title: 'Board',
                        content: [{
                            type: 'SELECT',
                            props: {
                                label: 'Board',
                                options: [{ id: 'b1', name: 'Uno' }],
                                valueKey: 'id',
                                labelKey: 'name',
                                onChange: {
                                    action: 'CALL_BACKEND', function: 'getLists', args: { boardId: '${value}' },
                                    onSuccess: { actions: [{ action: 'SET_STATE', key: 'lists', value: '${result}' }, { action: 'SET_STATE', key: 'picked', value: '${value}' }, { action: 'NEXT_STEP' }] },
                                },
                            },
                        }],
                    },
                    { title: 'Lists', content: [{ type: 'TEXT', props: { content: 'picked=${state.picked} n=${state.lists | length}' } }] },
                ],
            },
        });
        const select = container.querySelector('select') as HTMLSelectElement;
        await act(async () => {
            select.value = '0'; // SelectField usa el indice de la opcion como valor del <option>
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await flush();
        expect(executeExtensionAction.mock.calls[0][2]).toEqual({ boardId: 'b1' });
        expect(text()).toContain('picked=b1 n=1');
    });
});

describe('JsonRenderer: GRID de Giphy sin TypeError', () => {
    it('children como string ("${state.gifs}") ya no lanza', async () => {
        await render({ type: 'GRID', props: { columns: 3, gap: 2, children: '${state.gifs}' } });
        expect(container.querySelector('.grid')).not.toBeNull();
    });

    it('GRID + FOR_EACH pinta las imagenes devueltas por el backend con plantilla por item', async () => {
        executeExtensionAction.mockResolvedValue({
            success: true,
            result: { data: [
                { id: '1', title: 'uno', images: { fixed_height_small: { url: 'https://media.giphy.com/a.gif' }, original: { url: 'https://media.giphy.com/A.gif' } } },
                { id: '2', title: 'dos', images: { fixed_height_small: { url: 'javascript:alert(1)' }, original: { url: 'https://media.giphy.com/B.gif' } } },
            ] },
        });
        const insertBody = vi.fn();
        await render({
            type: 'MODAL',
            props: {
                title: 'GIFs',
                onLoad: { action: 'CALL_BACKEND', function: 'trending', onSuccess: { action: 'SET_STATE', key: 'gifs', value: '${result.data}' } },
                children: [
                    {
                        type: 'GRID', props: { columns: 3, gap: 2 }, children: [{
                            type: 'FOR_EACH',
                            props: {
                                items: '${state.gifs}', as: 'item',
                                template: { type: 'IMAGE_BUTTON', props: { src: '${item.images.fixed_height_small.url}', alt: '${item.title}', onClick: { action: 'INSERT_CONTENT', content: '<img src="${item.images.original.url}" alt="${item.title}" />' } } },
                            },
                        }],
                    },
                ],
            },
        }, { extensionId: 'core-giphy', insertBody });
        await flush();

        const imgs = container.querySelectorAll('img');
        expect(imgs).toHaveLength(1); // el src javascript: se descarta
        expect(imgs[0].getAttribute('src')).toBe('https://media.giphy.com/a.gif');
        expect(imgs[0].getAttribute('alt')).toBe('uno');
        expect(imgs[0].getAttribute('referrerpolicy')).toBe('no-referrer');
        expect(imgs[0].getAttribute('loading')).toBe('lazy');
        expect(imgs[0].getAttribute('decoding')).toBe('async');

        await click(imgs[0].closest('button')!);
        expect(insertBody).toHaveBeenCalledWith('<img src="https://media.giphy.com/A.gif" alt="uno" />');
    });
});

describe('JsonRenderer: expresiones con &&, ||, comparadores y filtros', () => {
    it('CONDITIONAL evalua && (sealer/appointments) sin eval', async () => {
        const conditional = (sealers: any) => ({
            type: 'CONDITIONAL',
            props: {
                condition: '${context.sealers != null && context.sealers.length > 0}',
                true: [{ type: 'TEXT', props: { content: 'HAY' } }],
                false: [{ type: 'TEXT', props: { content: 'NO HAY' } }],
            },
        });
        await render(conditional([]), { extensionId: 'x', sealers: [] });
        expect(text()).toBe('NO HAY');
        await render(conditional([1]), { extensionId: 'x', sealers: [{ name: 'a' }] });
        expect(text()).toBe('HAY');
    });

    it('LIST resuelve la plantilla POR ITEM (antes salia vacia)', async () => {
        await render({
            type: 'LIST',
            props: { items: '${context.rows}', itemTemplate: { type: 'TEXT', props: { content: 'fila ${item.name}' } } },
        }, { extensionId: 'x', rows: [{ name: 'a' }, { name: 'b' }] });
        expect(text()).toBe('fila afila b');
    });

    it('filtro truncate y || en texto', async () => {
        await render({ type: 'TEXT', props: { content: "${context.body | truncate:4} ${context.missing || 'fallback'}" } }, { extensionId: 'x', body: 'abcdefgh' });
        expect(text()).toBe('abcd... fallback');
    });
});

describe('JsonRenderer: OPEN_URL, seguridad de URLs y acciones duplicadas', () => {
    it('OPEN_URL abre UNA sola pestana con noopener', async () => {
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        await render({ type: 'BUTTON', props: { label: 'Go', onClick: { action: 'OPEN_URL', url: 'https://example.com/a' } } });
        await click(button('Go'));
        expect(open).toHaveBeenCalledTimes(1);
        expect(open).toHaveBeenCalledWith('https://example.com/a', '_blank', 'noopener,noreferrer');
    });

    it('OPEN_URL bloquea javascript: y LINK no genera href peligroso', async () => {
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        await render({
            type: 'COLUMN',
            children: [
                { type: 'BUTTON', props: { label: 'Evil', onClick: { action: 'OPEN_URL', url: 'javascript:alert(1)' } } },
                { type: 'LINK', props: { label: 'link', url: 'javascript:alert(1)' } },
                { type: 'LINK', props: { label: 'ok', url: 'https://example.com' } },
            ],
        });
        await click(button('Evil'));
        expect(open).not.toHaveBeenCalled();
        const anchors = Array.from(container.querySelectorAll('a'));
        expect(anchors).toHaveLength(1);
        expect(anchors[0].getAttribute('href')).toBe('https://example.com');
        expect(anchors[0].getAttribute('rel')).toContain('noopener');
    });

    it('COPY_TO_CLIPBOARD muestra un solo toast', async () => {
        Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => { }) } });
        await render({ type: 'BUTTON', props: { label: 'Copy', onClick: { action: 'COPY_TO_CLIPBOARD', text: 'x' } } });
        await click(button('Copy'));
        expect((toast as any).success).toHaveBeenCalledTimes(1);
    });
});

describe('JsonRenderer: componentes con estado (hooks fuera del switch)', () => {
    it('ACCORDION, TABS y SET_VAR funcionan y no violan las reglas de hooks al cambiar de tipo', async () => {
        await render({
            type: 'COLUMN',
            children: [
                { type: 'SET_VAR', props: { name: 'v', value: 'seteado' } },
                { type: 'TEXT', props: { content: 'v=${state.v}' } },
                { type: 'ACCORDION', props: { sections: [{ title: 'Sec', content: [{ type: 'TEXT', props: { content: 'interior' } }] }] } },
                { type: 'TABS', props: { tabs: [{ label: 'T1', content: [{ type: 'TEXT', props: { content: 'c1' } }] }] } },
            ],
        });
        await flush();
        expect(text()).toContain('v=seteado');
        // el contenido plegado sigue montado (no pierde estado) pero oculto
        const hiddenPanel = () => Array.from(container.querySelectorAll('[hidden]')).some((el) => el.textContent?.includes('interior'));
        expect(hiddenPanel()).toBe(true);
        await click(button('Sec'));
        expect(hiddenPanel()).toBe(false);
        expect(text()).toContain('interior');

        // re-render con un tipo distinto en la misma raiz: no debe lanzar "rendered more hooks"
        await render({ type: 'TEXT', props: { content: 'otro' } });
        expect(text()).toBe('otro');
    });

    it('un componente sin type se ignora sin romper', async () => {
        await render({ type: 'COLUMN', children: [{} as any, { type: 'TEXT', props: { content: 'ok' } }] });
        expect(text()).toBe('ok');
    });
});
