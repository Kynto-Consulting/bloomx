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

import { SlashActionRunner, type SlashRun } from '../SlashActionRunner';
import { collectSlashCommands, collectOverlays } from '@/lib/slash-commands';
import { toast } from 'sonner';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

async function run(runDef: SlashRun, context: Record<string, any>) {
    await act(async () => {
        root.render(React.createElement(SlashActionRunner, { run: runDef, context }));
    });
    await flush();
}

const base = (action: unknown, overrides: Partial<SlashRun> = {}): SlashRun => ({
    nonce: 1,
    extensionId: 'core-test',
    action,
    overlays: {},
    args: '',
    ...overrides,
});

beforeEach(() => {
    executeExtensionAction.mockReset();
    (toast.error as any).mockReset?.();
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

describe('SlashActionRunner', () => {
    it('INSERT_CONTENT inserta el texto en el editor (como /shrug)', async () => {
        const insertBody = vi.fn();
        await run(base({ action: 'INSERT_CONTENT', content: '¯\\_(ツ)_/¯' }), { insertBody });
        expect(insertBody).toHaveBeenCalledTimes(1);
        expect(insertBody).toHaveBeenCalledWith('¯\\_(ツ)_/¯');
    });

    it('no repite la accion en re-renders; una ejecucion nueva (nonce) si se dispara', async () => {
        const insertBody = vi.fn();
        const run1 = base({ action: 'INSERT_CONTENT', content: 'x' });
        await run(run1, { insertBody });
        await run(run1, { insertBody, subject: 'cambio de contexto' });
        expect(insertBody).toHaveBeenCalledTimes(1);
        await run({ ...run1, nonce: 2 }, { insertBody });
        expect(insertBody).toHaveBeenCalledTimes(2);
    });

    it('CALL_BACKEND: envia el extensionId, la funcion y el contexto, y encadena onSuccess (/translate)', async () => {
        executeExtensionAction.mockResolvedValue({ success: true, result: { text: 'Hello' } });
        const insertBody = vi.fn();
        await run(
            base({
                action: 'CALL_BACKEND',
                function: 'translate',
                args: { content: '${context.emailContent}' },
                onSuccess: { action: 'INSERT_CONTENT', content: '${result.text}' },
            }, { extensionId: 'core-translator' }),
            { insertBody, emailContent: 'Hola' },
        );
        const [extensionId, fn, params] = executeExtensionAction.mock.calls[0];
        expect(extensionId).toBe('core-translator');
        expect(fn).toBe('translate');
        expect(params).toEqual({ content: 'Hola' });
        expect(insertBody).toHaveBeenCalledWith('Hello');
    });

    it('CALL_BACKEND fallido muestra el error y no inserta', async () => {
        executeExtensionAction.mockResolvedValue({ success: false, error: 'boom' });
        const insertBody = vi.fn();
        await run(base({ action: 'CALL_BACKEND', function: 'f', onSuccess: { action: 'INSERT_CONTENT', content: 'x' } }), { insertBody });
        expect(insertBody).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith('boom');
    });

    it('OPEN_OVERLAY abre el overlay de la extension y le pasa los argumentos del comando (/calendar Reunion)', async () => {
        const openOverlay = vi.fn();
        const commands = collectSlashCommands([{
            id: 'core-calendar',
            template: {
                id: 'core-calendar',
                name: 'Calendar',
                slashCommands: [{ key: 'calendar', description: 'd', arguments: 'Title', action: { action: 'OPEN_OVERLAY', targetId: 'calendar-modal', passArgs: true } }],
                mounts: [{ point: 'OVERLAY', id: 'calendar-modal', component: { type: 'MODAL', props: { title: 'Nuevo evento' } } }],
            },
        }]);
        const overlays = collectOverlays({ template: { mounts: [{ point: 'OVERLAY', id: 'calendar-modal', component: { type: 'MODAL', props: { title: 'Nuevo evento' } } }] } });
        await run(base(commands[0].action, { extensionId: 'core-calendar', overlays, args: 'Reunion' }), { openOverlay });
        expect(openOverlay).toHaveBeenCalledTimes(1);
        const overlayElement: any = openOverlay.mock.calls[0][0];
        expect(overlayElement.props.context.slashArgs).toBe('Reunion');
        expect(overlayElement.props.context.extensionId).toBe('core-calendar');
    });

    it('overlay inexistente avisa con un toast en vez de fallar en silencio', async () => {
        await run(base({ action: 'OPEN_OVERLAY', targetId: 'nope' }), { openOverlay: vi.fn() });
        expect(toast.error).toHaveBeenCalled();
    });

    it('sin ejecucion no renderiza nada', async () => {
        await act(async () => { root.render(React.createElement(SlashActionRunner, { run: null, context: {} })); });
        expect(container.innerHTML).toBe('');
    });
});
