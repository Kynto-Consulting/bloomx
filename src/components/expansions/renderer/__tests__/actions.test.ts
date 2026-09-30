/**
 * Motor de acciones (sin React): orden de ejecucion, estado con rutas, CALL_BACKEND con carga/error/reintento
 * automaticos, onSuccess/onError, resultKey, bloqueo de URLs/rutas inseguras y mensajes de error utiles.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { executeExtensionAction, toastFn } = vi.hoisted(() => ({
    executeExtensionAction: vi.fn(),
    toastFn: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() }) as any,
}));
vi.mock('sonner', () => ({ toast: toastFn }));
vi.mock('@/lib/expansions/api', () => ({ executeExtensionAction: (...args: any[]) => executeExtensionAction(...args) }));
vi.mock('@/lib/expansions/client/secure-storage', () => ({ secureRead: vi.fn(async () => 'guardado'), secureWrite: vi.fn(async () => undefined) }));

import { createActionRunner, loadingKeyOf, primaryLoadingKey, withRetry, type ActionEnv } from '../actions';
import { getPath, setPath } from '../state';
import { __resetExtensionErrors, getExtensionErrors } from '@/lib/expansions/client/error-log';

function makeEnv(overrides: Partial<ActionEnv> = {}) {
    let state: Record<string, any> = {};
    const env: ActionEnv = {
        context: { extensionId: 'core-test' },
        getState: () => state,
        setState: (key, value) => { state = setPath(state, key, value); },
        wizard: null,
        router: { push: vi.fn(), refresh: vi.fn() },
        userId: 'u1',
        showOverlay: vi.fn(),
        closeOverlay: vi.fn(),
        ...overrides,
    };
    return { env, run: createActionRunner(() => env), getState: () => state };
}

beforeEach(() => {
    executeExtensionAction.mockReset();
    Object.values(toastFn).forEach((fn: any) => fn?.mockClear?.());
    vi.spyOn(console, 'error').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
    globalThis.window = { ...(globalThis as any).window, location: { pathname: '/x', search: '', hash: '', href: '' }, open: vi.fn(), dispatchEvent: vi.fn(), localStorage: { getItem: () => null, setItem: () => { }, removeItem: () => { } } } as any;
    (globalThis as any).CustomEvent = class { constructor(public type: string, public init?: any) { } };
    __resetExtensionErrors();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('estado y orden', () => {
    it('ejecuta en orden y cada paso ve el SET_STATE anterior (rutas con puntos incluidas)', async () => {
        const { run, getState } = makeEnv();
        await run([
            { action: 'SET_STATE', key: 'form.email', value: 'a@b.c' },
            { action: 'SET_STATE', key: 'copy', value: '${state.form.email}' },
            { action: 'MERGE_STATE', key: 'form', value: { name: 'Ana' } },
        ]);
        expect(getState()).toEqual({ form: { email: 'a@b.c', name: 'Ana' }, copy: 'a@b.c' });
    });

    it('acepta {actions: [...]} y una sola accion; ignora elementos nulos', async () => {
        const { run, getState } = makeEnv();
        await run({ actions: [null, { action: 'SET_STATE', key: 'a', value: 1 }, { action: 'SET_STATE', key: 'b', value: 2 }] });
        expect(getState()).toEqual({ a: 1, b: 2 });
    });

    it('getPath/setPath: inmutable y a prueba de __proto__', () => {
        const base = { a: { b: 1 } };
        const next = setPath(base, 'a.c', 2);
        expect(base).toEqual({ a: { b: 1 } });
        expect(next).toEqual({ a: { b: 1, c: 2 } });
        expect(setPath({}, '__proto__.polluted', 1)).toEqual({});
        expect(({} as any).polluted).toBeUndefined();
        expect(getPath({ a: { b: 3 } }, 'a.b')).toBe(3);
        expect(getPath({}, 'constructor.name')).toBeUndefined();
    });

    it('MAP_ARRAY y FILTER_ARRAY trabajan con item', async () => {
        const { run, getState } = makeEnv();
        await run([
            { action: 'SET_STATE', key: 'nums', value: [1, 2, 3, 4] },
            { action: 'FILTER_ARRAY', source: 'nums', target: 'big', condition: '${item > 2}' },
            { action: 'MAP_ARRAY', source: 'big', target: 'labels', template: { text: 'n=${item}' } },
        ]);
        expect(getState().big).toEqual([3, 4]);
        expect(getState().labels).toEqual([{ text: 'n=3' }, { text: 'n=4' }]);
    });
});

describe('CALL_BACKEND', () => {
    it('carga/error automaticos: $loading mientras dura y resultKey + onSuccess con result', async () => {
        let release!: (v: any) => void;
        executeExtensionAction.mockReturnValue(new Promise((resolve) => { release = resolve; }));
        const { run, getState } = makeEnv();
        const pending = run({ action: 'CALL_BACKEND', function: 'save', resultKey: 'saved', onSuccess: { action: 'SET_STATE', key: 'echo', value: '${result.id}' } });
        await Promise.resolve();
        expect(getState().$loading.save).toBe(true);
        release({ success: true, result: { id: 7 } });
        const outcome = await pending;
        expect(outcome).toMatchObject({ ok: true, result: { id: 7 } });
        expect(getState().$loading.save).toBe(false);
        expect(getState().$error.save).toBeNull();
        expect(getState().saved).toEqual({ id: 7 });
        expect(getState().echo).toBe(7);
    });

    it('error: $error con el mensaje, toast y outcome no manejado; con onError se encadena (handled) sin toast', async () => {
        executeExtensionAction.mockResolvedValue({ success: false, error: 'Sin permiso' });
        const a = makeEnv();
        const out = await a.run({ action: 'CALL_BACKEND', function: 'save' });
        expect(out).toMatchObject({ ok: false, error: 'Sin permiso', handled: false });
        expect(a.getState().$error.save).toBe('Sin permiso');
        expect(a.getState().$loading.save).toBe(false);
        expect(toastFn.error).toHaveBeenCalledWith('Sin permiso');
        expect(getExtensionErrors('core-test')[0]).toMatchObject({ kind: 'action' });

        toastFn.error.mockClear();
        const b = makeEnv();
        const handled = await b.run({ action: 'CALL_BACKEND', function: 'save', onError: { action: 'SET_STATE', key: 'msg', value: '${error}' } });
        expect(handled).toMatchObject({ ok: false, handled: true });
        expect(b.getState().msg).toBe('Sin permiso');
        expect(toastFn.error).not.toHaveBeenCalled();

        const c = makeEnv();
        await c.run({ action: 'CALL_BACKEND', function: 'save', toastOnError: false });
        expect(toastFn.error).not.toHaveBeenCalled();
    });

    it('reintento declarativo con espera exponencial y exito al tercer intento', async () => {
        vi.useFakeTimers();
        executeExtensionAction
            .mockResolvedValueOnce({ success: false, error: 'a' })
            .mockRejectedValueOnce(new Error('b'))
            .mockResolvedValueOnce({ success: true, result: 'ok' });
        const { run } = makeEnv();
        const pending = run({ action: 'CALL_BACKEND', function: 'flaky', retry: { attempts: 3, delayMs: 100, backoff: 'exponential' } });
        await vi.advanceTimersByTimeAsync(100);
        expect(executeExtensionAction).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(200);
        expect(await pending).toMatchObject({ ok: true, result: 'ok' });
        expect(executeExtensionAction).toHaveBeenCalledTimes(3);
    });

    it('withRetry: tope de 5 intentos y relanza el ultimo error', async () => {
        vi.useFakeTimers();
        const fn = vi.fn(async () => { throw new Error('siempre'); });
        const pending = withRetry(fn, { attempts: 99, delayMs: 10, backoff: 'none' }).catch((e) => e.message);
        await vi.advanceTimersByTimeAsync(1000);
        expect(await pending).toBe('siempre');
        expect(fn).toHaveBeenCalledTimes(5);
    });

    it('formData del formulario se mezcla con args (los explicitos ganan); toBackendContext no filtra overlays/funciones', async () => {
        executeExtensionAction.mockResolvedValue({ success: true, result: {} });
        const { run } = makeEnv({ context: { extensionId: 'core-x', subject: 's', overlays: { o: {} }, insertBody: () => { } } });
        await run({ action: 'CALL_BACKEND', function: 'f', args: { b: 2, a: 'explicito' } }, null, { formData: { a: 'form', c: 3 } });
        const [ext, fn, params, ctx] = executeExtensionAction.mock.calls[0];
        expect([ext, fn]).toEqual(['core-x', 'f']);
        expect(params).toEqual({ a: 'explicito', b: 2, c: 3 });
        expect(ctx).toMatchObject({ subject: 's' });
        expect(ctx.overlays).toBeUndefined();
        expect(ctx.insertBody).toBeUndefined();
    });

    it('callBackend del entorno sustituye al backend real (playground)', async () => {
        const callBackend = vi.fn(async () => ({ success: true, result: 'simulado' }));
        const { run } = makeEnv({ callBackend });
        const out = await run({ action: 'CALL_BACKEND', function: 'f' });
        expect(out.result).toBe('simulado');
        expect(executeExtensionAction).not.toHaveBeenCalled();
    });

    it('sin function: mensaje util y nada se ejecuta', async () => {
        const { run } = makeEnv();
        const out = await run({ action: 'CALL_BACKEND' });
        expect(out.ok).toBe(false);
        expect(out.error).toMatch(/function/);
        expect(executeExtensionAction).not.toHaveBeenCalled();
    });

    it('claves de carga', () => {
        expect(loadingKeyOf({ action: 'CALL_BACKEND', function: 'a' })).toBe('a');
        expect(loadingKeyOf({ action: 'CALL_BACKEND', function: 'a', key: 'k' })).toBe('k');
        expect(loadingKeyOf({ action: 'CALL_API', url: '/api/x/y' })).toBe('api_x_y');
        expect(primaryLoadingKey([{ action: 'TOAST' }, { actions: [{ action: 'CALL_BACKEND', function: 'z' }] }])).toBe('z');
        expect(primaryLoadingKey({ action: 'TOAST' })).toBeNull();
    });
});

describe('seguridad y mensajes', () => {
    it('OPEN_URL y NAVIGATE bloquean destinos inseguros con mensaje', async () => {
        const { env, run } = makeEnv();
        expect((await run({ action: 'OPEN_URL', url: 'javascript:alert(1)' })).ok).toBe(false);
        expect((window as any).open).not.toHaveBeenCalled();
        expect((await run({ action: 'OPEN_URL', url: 'https://ok.example/a' })).ok).toBe(true);
        expect((window as any).open).toHaveBeenCalledWith('https://ok.example/a', '_blank', 'noopener,noreferrer');
        expect((await run({ action: 'NAVIGATE', path: '//evil.example' })).ok).toBe(false);
        expect((await run({ action: 'NAVIGATE', path: 'https://evil.example' })).ok).toBe(false);
        expect((await run({ action: 'NAVIGATE', path: '/calendar' })).ok).toBe(true);
        expect(env.router.push).toHaveBeenCalledTimes(1);
        expect(toastFn.error.mock.calls.map((c: any[]) => c[0]).join('|')).toMatch(/bloqueada/i);
    });

    it('CALL_API solo rutas del propio origen', async () => {
        const { run } = makeEnv();
        const out = await run({ action: 'CALL_API', url: 'https://evil.example/steal' });
        expect(out.ok).toBe(false);
        expect(out.error).toMatch(/bloqueada/i);
    });

    it('accion desconocida: aviso con sugerencia y registro para el autor; la cadena continua', async () => {
        const { run, getState } = makeEnv();
        const out = await run([{ action: 'CALL_BACKED', function: 'x' }, { action: 'SET_STATE', key: 'after', value: 1 }]);
        expect(out.ok).toBe(false);
        expect(out.error).toMatch(/CALL_BACKEND/);
        expect(getState().after).toBe(1);
        expect(getExtensionErrors('core-test')[0].message).toMatch(/desconocida/);
    });

    it('una excepcion dentro de una accion no rompe la cadena', async () => {
        const { run, getState } = makeEnv({ context: { extensionId: 'core-test', setSubject: () => { throw new Error('boom'); } } });
        const out = await run([{ action: 'SET_SUBJECT', subject: 'x' }, { action: 'SET_STATE', key: 'ok', value: true }]);
        expect(out).toMatchObject({ ok: false, error: 'boom' });
        expect(getState().ok).toBe(true);
    });

    it('OPEN_OVERLAY: overlay inexistente -> mensaje; existente -> showOverlay con tipo y ancho', async () => {
        const overlays = { a: { type: 'DRAWER', props: { title: 'Panel', width: 'lg' }, children: [] }, m: { component: 'MODAL', props: { title: 'Viejo', children: [] } } };
        const { env, run } = makeEnv({ context: { extensionId: 'core-test', overlays } });
        expect((await run({ action: 'OPEN_OVERLAY', targetId: 'nope' })).ok).toBe(false);
        expect(toastFn.error).toHaveBeenCalled();
        await run({ action: 'OPEN_OVERLAY', targetId: 'a' });
        await run({ action: 'OPEN_OVERLAY', targetId: 'm' });
        const calls = (env.showOverlay as any).mock.calls.map((c: any[]) => c[0]);
        expect(calls[0]).toMatchObject({ kind: 'drawer', width: 'lg', label: 'Panel' });
        expect(calls[1]).toMatchObject({ kind: 'modal', component: { type: 'MODAL' } });
    });

    it('overlays del action no se resuelven antes de tiempo (expresiones internas intactas)', async () => {
        const overlays = { o: { type: 'MODAL', props: { title: 'T' }, children: [{ type: 'TEXT', props: { content: '${state.later}' } }] } };
        const { env, run } = makeEnv({ context: { extensionId: 'core-test' } });
        await run({ action: 'OPEN_OVERLAY', targetId: 'o', extensionId: 'otra', overlays });
        const request = (env.showOverlay as any).mock.calls[0][0];
        expect(request.component.children[0].props.content).toBe('${state.later}');
        expect(request.context.extensionId).toBe('otra');
    });

    it('CONFIRM usa env.confirm y encadena onConfirm/onCancel', async () => {
        const yes = makeEnv({ confirm: async () => true });
        await yes.run({ action: 'CONFIRM', message: '?', onConfirm: { action: 'SET_STATE', key: 'r', value: 'si' }, onCancel: { action: 'SET_STATE', key: 'r', value: 'no' } });
        expect(yes.getState().r).toBe('si');
        const no = makeEnv({ confirm: async () => false });
        await no.run({ action: 'CONFIRM', message: '?', onConfirm: { action: 'SET_STATE', key: 'r', value: 'si' }, onCancel: { action: 'SET_STATE', key: 'r', value: 'no' } });
        expect(no.getState().r).toBe('no');
    });

    it('NEXT_STEP/PREV_STEP actuan sobre el wizard; SECURE_READ a estado', async () => {
        const wizard = { next: vi.fn(), prev: vi.fn() };
        const { run, getState } = makeEnv({ wizard });
        await run([{ action: 'NEXT_STEP' }, { action: 'PREV_STEP' }, { action: 'SECURE_READ', key: 'k', targetState: 'sec' }]);
        expect(wizard.next).toHaveBeenCalledTimes(1);
        expect(wizard.prev).toHaveBeenCalledTimes(1);
        expect(getState().sec).toBe('guardado');
    });

    it('SET_LOADING escribe en $loading', async () => {
        const { run, getState } = makeEnv();
        await run({ action: 'SET_LOADING', key: 'lista', value: true });
        expect(getState().$loading.lista).toBe(true);
    });

    it('cadenas absurdamente anidadas se cortan', async () => {
        let act: any = { action: 'SET_STATE', key: 'fin', value: 1 };
        for (let i = 0; i < 60; i++) act = { action: 'CONFIRM', message: 'x', onConfirm: act };
        const { run } = makeEnv({ confirm: async () => true });
        const out = await run(act);
        expect(out.ok).toBe(false);
        expect(out.error).toMatch(/anidadas/);
    });
});
