// @vitest-environment jsdom
/**
 * Renderer + kit de punta a punta (jsdom): estado con bind bidireccional, formularios con validacion y estados,
 * carga automatica de botones, props hostiles ignoradas, overlays accesibles y TODO el catalogo del schema
 * renderizado en 3 paletas de empresa (claro y oscuro) sin clases crudas.
 */
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { executeExtensionAction, toastFn } = vi.hoisted(() => ({
    executeExtensionAction: vi.fn(),
    toastFn: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() }) as any,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: toastFn }));
vi.mock('@/lib/expansions/api', () => ({ executeExtensionAction: (...args: any[]) => executeExtensionAction(...args), fetchExpansions: vi.fn(async () => []) }));
vi.mock('@/components/ExtensionLoader', () => ({ ExtensionLoader: () => null }));
vi.mock('@/components/expansions/ExtensionLoader', () => ({ ExtensionLoader: () => null }));

import { JsonRenderer } from '../JsonRenderer';
import { UI_COMPONENTS, type PropSpec } from '@/lib/expansions/ui-schema';
import { PALETTES, BRAND_MODES, applyBrand, assertThemeSafe, click, flush, installCleanup, mount, q, qa, typeInto } from '../../kit/__tests__/harness';

const h = React.createElement;
const render = (component: any, context: any = { extensionId: 'core-test' }, extra: Record<string, any> = {}) => mount(h(JsonRenderer, { component, context, ...extra }));
const textOf = () => document.body.textContent || '';

installCleanup();
beforeEach(() => {
    executeExtensionAction.mockReset();
    Object.values(toastFn).forEach((fn: any) => fn?.mockClear?.());
    vi.spyOn(console, 'warn').mockImplementation(() => { });
    vi.spyOn(console, 'error').mockImplementation(() => { });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('props hostiles: el renderer NO acepta estilos crudos', () => {
    it('className, style, color, HTML y eventos DOM se ignoran (no llegan al DOM)', async () => {
        await render({
            type: 'STACK',
            props: { className: 'evil', style: { color: 'red' }, onclick: 'alert(1)' },
            children: [
                { type: 'TEXT', props: { content: 'hola', className: 'evil', style: { background: 'red' }, color: 'red', tone: 'rainbow' } },
                { type: 'BUTTON', props: { label: 'b', className: 'evil', style: 'x', html: '<b>x</b>', size: { a: 1 } } },
                { type: 'TEXT', props: { content: '<img src=x onerror=alert(1)><script>alert(1)</script>' } },
            ],
        });
        expect(document.querySelectorAll('[class*="evil"], [onclick], [onerror], [style*="red"]').length).toBe(0);
        expect(document.body.innerHTML).not.toMatch(/class="[^"]*(?:evil|text-red)/);
        expect(q('img')).toBeNull();
        expect(q('script')).toBeNull();
        expect(textOf()).toContain('<img src=x onerror=alert(1)>'); // se ve como TEXTO
        expect(qa('[style]').filter((el) => /color|background/.test(el.getAttribute('style') || ''))).toEqual([]);
    });

    it('MARKDOWN no inyecta HTML ni enlaces javascript:', async () => {
        await render({ type: 'MARKDOWN', props: { content: '**negrita** <b onclick=x>crudo</b> [ok](https://a.b/c) [mal](javascript:alert(1))' } });
        expect(q('strong')?.textContent).toBe('negrita');
        expect(q('b')).toBeNull();
        const hrefs = qa<HTMLAnchorElement>('a').map((a) => a.getAttribute('href'));
        expect(hrefs).toEqual(['https://a.b/c']);
    });

    it('un componente desconocido o un arbol roto no tumban a los demas', async () => {
        await render({ type: 'STACK', children: [{ type: 'NOPE' }, null as any, { type: 'TEXT', props: { content: 'sigue' } }] });
        expect(textOf()).toContain('sigue');
    });

    it('una excepcion de render queda contenida en un estado de error amable', async () => {
        const Boom = () => { throw new Error('boom'); };
        const { ExtensionErrorBoundary } = await import('../../kit/ExtensionError');
        await mount(h('div', null, h(ExtensionErrorBoundary as any, { extensionId: 'core-x' }, h(Boom)), h('p', null, 'resto de la app')));
        expect(q('[data-extension-error]')).not.toBeNull();
        expect(textOf()).toContain('resto de la app');
        expect(textOf()).toContain('core-x');
    });
});

describe('estado y binding bidireccional', () => {
    it('INPUT con bind: lo tecleado aparece en ${state.x}; el estado inicial llena el campo; onChange recibe value', async () => {
        await render({
            type: 'STACK',
            children: [
                { type: 'INPUT', props: { label: 'Busca', bind: 'form.q', onChange: { action: 'SET_STATE', key: 'typed', value: '${value}' } } },
                { type: 'TEXT', props: { content: 'q=${state.form.q} typed=${state.typed}' } },
            ],
        }, { extensionId: 'core-test' }, { initialState: { form: { q: 'inicial' } } });
        const input = q<HTMLInputElement>('input')!;
        expect(input.value).toBe('inicial');
        expect(textOf()).toContain('q=inicial');
        await typeInto(input, 'nuevo');
        expect(textOf()).toContain('q=nuevo typed=nuevo');
        expect(q<HTMLInputElement>('input')!.value).toBe('nuevo');
    });

    it('defaultValue con bind se aplica al estado al montar; checkbox/toggle/select/slider se enlazan', async () => {
        await render({
            type: 'STACK',
            children: [
                { type: 'CHECKBOX', props: { label: 'Acepto', bind: 'ok', defaultValue: true } },
                { type: 'TOGGLE', props: { label: 'Activo', bind: 'on' } },
                { type: 'SELECT', props: { label: 'Tipo', bind: 'tipo', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] } },
                { type: 'SLIDER', props: { label: 'Nivel', bind: 'n', min: 0, max: 10 } },
                { type: 'TEXT', props: { content: 'ok=${state.ok} on=${state.on} tipo=${state.tipo} n=${state.n}' } },
            ],
        });
        await flush();
        expect(textOf()).toContain('ok=true on= tipo= n=');
        await click(q('[role="switch"]'));
        await typeInto(q<HTMLSelectElement>('select'), '1');
        expect(textOf()).toContain('on=true tipo=b');
    });

    it('hidden oculta con expresion y onLoad corre una vez al montar', async () => {
        await render({
            type: 'STACK',
            props: { onLoad: { action: 'SET_STATE', key: 'loaded', value: 'si' } },
            children: [
                { type: 'TEXT', props: { content: 'visible ${state.loaded}' } },
                { type: 'TEXT', props: { content: 'secreto', hidden: '${state.loaded == "si"}' } },
            ],
        });
        await flush();
        expect(textOf()).toContain('visible si');
        expect(textOf()).not.toContain('secreto');
    });

    it('state inicial del manifest alimenta expresiones y FOR_EACH con empty', async () => {
        await render({
            type: 'STACK',
            children: [
                { type: 'FOR_EACH', props: { items: '${state.items}', template: { type: 'BADGE', props: { label: 'i=${item}' } }, empty: { type: 'TEXT', props: { content: 'vacio' } } } },
            ],
        }, { extensionId: 'x' }, { initialState: { items: [1, 2] } });
        expect(textOf()).toContain('i=1');
        expect(textOf()).toContain('i=2');
        await render({ type: 'FOR_EACH', props: { items: '${state.none}', template: { type: 'TEXT' }, empty: { type: 'TEXT', props: { content: 'vacio' } } } });
        expect(textOf()).toContain('vacio');
    });
});

describe('botones con carga automatica', () => {
    it('mientras CALL_BACKEND esta en curso el boton muestra carga y se bloquea (sin doble envio)', async () => {
        let release!: (v: any) => void;
        executeExtensionAction.mockReturnValue(new Promise((resolve) => { release = resolve; }));
        await render({ type: 'BUTTON', props: { label: 'Guardar', onClick: { action: 'CALL_BACKEND', function: 'save' } } });
        const button = () => q<HTMLButtonElement>('button')!;
        await click(button());
        expect(button().getAttribute('aria-busy')).toBe('true');
        expect(button().disabled).toBe(true);
        await click(button());
        expect(executeExtensionAction).toHaveBeenCalledTimes(1);
        await act(async () => { release({ success: true, result: {} }); });
        await flush();
        expect(button().disabled).toBe(false);
        expect(button().getAttribute('aria-busy')).not.toBe('true');
    });

    it('modo compacto de la barra del redactor: boton de icono con nombre accesible', async () => {
        await render({ type: 'BUTTON', props: { label: 'GIF', icon: 'Smile', onClick: { action: 'TOAST', message: 'x' } } }, { extensionId: 'x', toolbarButtonMode: 'compact' });
        const button = q<HTMLButtonElement>('button')!;
        expect(button.getAttribute('aria-label')).toBe('GIF');
        expect(button.textContent?.trim()).toBe('');
    });
});

describe('FORM: validacion declarativa y estados', () => {
    const form = (extra: Record<string, any> = {}, onSubmit: any = { action: 'CALL_BACKEND', function: 'send' }) => ({
        type: 'FORM',
        props: {
            submitLabel: 'Enviar ahora',
            onSubmit,
            fields: [
                { name: 'email', label: 'Correo', type: 'email', required: true, rules: { email: true, message: 'Correo no valido' } },
                { name: 'edad', label: 'Edad', type: 'number', rules: { min: 18, max: 99 } },
                { name: 'nombre', label: 'Nombre', required: true },
            ],
            ...extra,
        },
    });
    const submit = () => click(qa('button').find((b) => b.textContent?.includes('Enviar ahora'))!);

    it('no envia si hay errores: muestra el mensaje propio/generico con role=alert y foca el primer invalido', async () => {
        await render(form());
        await submit();
        expect(executeExtensionAction).not.toHaveBeenCalled();
        const alerts = qa('[role="alert"]').map((el) => el.textContent);
        expect(alerts.join('|')).toMatch(/obligatorio|required/i); // campo sin mensaje propio
        expect(alerts.join('|')).toContain('Correo no valido'); // rules.message sustituye al generico
        expect(q('input[name="email"]')!.getAttribute('aria-invalid')).toBe('true');
        await typeInto(q<HTMLInputElement>('input[name="email"]'), 'mal');
        await typeInto(q<HTMLInputElement>('input[name="edad"]'), '12');
        await submit();
        expect(textOf()).toContain('Correo no valido');
        expect(executeExtensionAction).not.toHaveBeenCalled();
        expect(q('input[name="edad"]')!.getAttribute('aria-invalid')).toBe('true');
    });

    it('con datos validos envia formData, muestra cargando y luego el mensaje de exito y limpia si resetOnSuccess', async () => {
        let release!: (v: any) => void;
        executeExtensionAction.mockReturnValue(new Promise((resolve) => { release = resolve; }));
        await render(form({ successMessage: 'Enviado!', resetOnSuccess: true }));
        await typeInto(q<HTMLInputElement>('input[name="email"]'), 'a@b.co');
        await typeInto(q<HTMLInputElement>('input[name="edad"]'), '30');
        await typeInto(q<HTMLInputElement>('input[name="nombre"]'), 'Ana');
        await submit();
        const button = qa<HTMLButtonElement>('button').find((b) => b.textContent?.includes('Enviar ahora'))!;
        expect(button.disabled).toBe(true);
        expect(executeExtensionAction.mock.calls[0][2]).toMatchObject({ email: 'a@b.co', edad: 30, nombre: 'Ana' });
        await act(async () => { release({ success: true, result: {} }); });
        await flush();
        expect(textOf()).toContain('Enviado!');
        expect(q<HTMLInputElement>('input[name="email"]')!.value).toBe('');
    });

    it('si el backend falla: error visible en el formulario (sin onError) y el formulario vuelve a estar activo', async () => {
        executeExtensionAction.mockResolvedValue({ success: false, error: 'Servicio caido' });
        await render(form());
        await typeInto(q<HTMLInputElement>('input[name="email"]'), 'a@b.co');
        await typeInto(q<HTMLInputElement>('input[name="nombre"]'), 'Ana');
        await submit();
        await flush();
        expect(qa('[role="alert"]').map((e) => e.textContent).join('|')).toContain('Servicio caido');
        expect(qa<HTMLButtonElement>('button').find((b) => b.textContent?.includes('Enviar ahora'))!.disabled).toBe(false);
    });

    it('con onError propio el formulario no duplica el aviso', async () => {
        executeExtensionAction.mockResolvedValue({ success: false, error: 'Servicio caido' });
        await render(form({}, { action: 'CALL_BACKEND', function: 'send', onError: { action: 'SET_STATE', key: 'e', value: 'mio' } }));
        await typeInto(q<HTMLInputElement>('input[name="email"]'), 'a@b.co');
        await typeInto(q<HTMLInputElement>('input[name="nombre"]'), 'Ana');
        await submit();
        await flush();
        expect(qa('[role="alert"]').map((e) => e.textContent).join('|')).not.toContain('Servicio caido');
    });

    it('campos hijos con name se registran en el formulario (validacion y formData)', async () => {
        executeExtensionAction.mockResolvedValue({ success: true, result: {} });
        await render({
            type: 'FORM',
            props: { submitLabel: 'Enviar ahora', onSubmit: { action: 'CALL_BACKEND', function: 'send' } },
            children: [{ type: 'INPUT', props: { name: 'titulo', label: 'Titulo', required: true } }, { type: 'TOGGLE', props: { name: 'pub', label: 'Publico' } }],
        });
        await submit();
        expect(executeExtensionAction).not.toHaveBeenCalled();
        await typeInto(q<HTMLInputElement>('input[name="titulo"]'), 'Hola');
        await click(q('[role="switch"]'));
        await submit();
        expect(executeExtensionAction.mock.calls[0][2]).toMatchObject({ titulo: 'Hola', pub: true });
    });
});

describe('overlays accesibles', () => {
    const overlays = { panel: { type: 'MODAL', props: { title: 'Mi panel', width: 'md' }, children: [{ type: 'TEXT', props: { content: 'contenido del panel' } }, { type: 'BUTTON', props: { label: 'Cerrar panel', onClick: { action: 'CLOSE_OVERLAY' } } }] } };

    it('OPEN_OVERLAY abre un dialogo con role=dialog, titulo y foco; CLOSE_OVERLAY y Escape lo cierran', async () => {
        await render({ type: 'BUTTON', props: { label: 'Abrir', onClick: { action: 'OPEN_OVERLAY', targetId: 'panel' } } }, { extensionId: 'core-test', overlays });
        await click(qa('button').find((b) => b.textContent === 'Abrir')!);
        await flush();
        const dialog = q('[role="dialog"]')!;
        expect(dialog).not.toBeNull();
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(dialog.textContent).toContain('Mi panel');
        expect(dialog.textContent).toContain('contenido del panel');
        await click(qa('button').find((b) => b.textContent === 'Cerrar panel')!);
        expect(q('[role="dialog"]')).toBeNull();
        await click(qa('button').find((b) => b.textContent === 'Abrir')!);
        await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
        expect(q('[role="dialog"]')).toBeNull();
    });

    it('MODAL con bind se abre/cierra desde el estado', async () => {
        await render({
            type: 'STACK',
            children: [
                { type: 'BUTTON', props: { label: 'Mostrar', onClick: { action: 'SET_STATE', key: 'show', value: true } } },
                { type: 'MODAL', props: { title: 'Propio', bind: 'show', onClose: { action: 'TOAST', message: 'cerrado' } }, children: [{ type: 'TEXT', props: { content: 'dentro' } }] },
            ],
        });
        expect(q('[role="dialog"]')).toBeNull();
        await click(qa('button').find((b) => b.textContent === 'Mostrar')!);
        expect(q('[role="dialog"]')!.textContent).toContain('dentro');
        await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
        expect(q('[role="dialog"]')).toBeNull();
        expect(toastFn).toHaveBeenCalledWith('cerrado');
    });

    it('CONFIRM muestra un dialogo accesible y sigue segun la respuesta', async () => {
        await render({ type: 'BUTTON', props: { label: 'Borrar', onClick: { action: 'CONFIRM', message: 'Seguro?', onConfirm: { action: 'SET_STATE', key: 'r', value: 'hecho' } } } });
        await click(q('button'));
        const dialog = q('[role="dialog"]')!;
        expect(dialog.textContent).toContain('Seguro?');
        const accept = qa('button', dialog).find((b) => /Aceptar|Accept/.test(b.textContent || ''))!;
        await click(accept);
        await flush();
        expect(q('[role="dialog"]')).toBeNull();
    });
});

// ------------------------------------------------------------------ catalogo completo
function fixtureValue(spec: PropSpec): unknown {
    switch (spec.k) {
        case 'text': case 'string': return 'Texto';
        case 'name': return 'clave';
        case 'number': return spec.min !== undefined ? Math.max(spec.min, 1) : 3;
        case 'boolean': return false;
        case 'enum': return spec.def ?? spec.values?.[0];
        case 'icon': return 'Mail';
        case 'url': return 'https://example.com/x';
        case 'color': return undefined;
        case 'regex': return '^a';
        case 'node': return { type: 'TEXT', props: { content: 'hijo' } };
        case 'nodes': return [{ type: 'TEXT', props: { content: 'hijo' } }];
        case 'array': return spec.of ? [fixtureValue(spec.of)] : [];
        case 'object': return Object.fromEntries(Object.entries(spec.shape ?? {}).filter(([, child]) => ['text', 'string', 'name', 'enum', 'number', 'icon', 'nodes', 'node'].includes(child.k)).map(([key, child]) => [key, fixtureValue(child)]));
        case 'record': return {};
        default: return undefined;
    }
}

function specNode(type: string): any {
    const spec = UI_COMPONENTS[type];
    const props: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(spec.props)) {
        if (prop.k === 'action' || prop.k === 'any') continue;
        if (['onLoad', 'hidden', 'open', 'bind', 'bindTo', 'onLoadWhen'].includes(key)) continue;
        props[key] = fixtureValue(prop);
    }
    if (type === 'TABLE') { props.columns = [{ key: 'a', label: 'A' }]; props.rows = [{ a: '1' }, { a: '2' }]; }
    if (type === 'BAR_CHART' || type === 'DONUT') props.data = [{ label: 'a', value: 2 }, { label: 'b', value: 3, tone: 'success' }];
    if (type === 'SPARKLINE') props.values = [1, 3, 2, 5];
    if (type === 'SELECT' || type === 'RADIO_GROUP') props.options = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }];
    if (type === 'TABS') props.tabs = [{ label: 'Uno', value: 'u', content: [{ type: 'TEXT', props: { content: 'contenido uno' } }] }];
    if (type === 'WIZARD') props.steps = [{ title: 'Paso 1', content: [{ type: 'TEXT', props: { content: 'p1' } }] }, { title: 'Paso 2', content: [] }];
    if (type === 'MENU') props.items = [{ label: 'Item', icon: 'Star' }];
    if (type === 'CONDITIONAL') { props.condition = true; props.true = [{ type: 'TEXT', props: { content: 'si' } }]; }
    if (type === 'FOR_EACH') { props.items = [1, 2]; props.template = { type: 'TEXT', props: { content: 'it' } }; }
    return { type, props, ...(spec.children ? { children: [{ type: 'TEXT', props: { content: 'hijo' } }] } : {}) };
}

describe('catalogo completo', () => {
    const types = Object.keys(UI_COMPONENTS).filter((type) => !['DEBUG', 'SET_VAR', 'CASE', 'DEFAULT', 'TAB_ITEM', 'ACCORDION_ITEM', 'REPEAT', 'SWITCH', 'CONDITION', 'HEADLESS', 'DRAWER', 'MODAL'].includes(type));

    it('cada componente renderiza sin lanzar y sin avisos de "desconocido"', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
        for (const type of types) {
            await render(specNode(type));
            expect(q('[data-extension-error]'), type).toBeNull();
            expect(document.body.innerHTML.length, type).toBeGreaterThan(0);
            document.body.innerHTML = '';
        }
        expect(warn.mock.calls.filter((call) => /desconocido/i.test(String(call[0])))).toEqual([]);
    });

    describe.each(PALETTES)('con la paleta "%s"', (palette) => {
        it.each(BRAND_MODES)('todos los componentes usan solo tokens que existen (%s)', async (mode) => {
            const css = applyBrand(palette, mode);
            // COLOR_PICKER muestra el hex del DATO elegido: su test de tema propio vive en kit/__tests__/Fields.test.tsx
            await render({ type: 'STACK', children: types.filter((t) => t !== 'COLOR_PICKER').map(specNode) });
            assertThemeSafe(document.body, css);
        });
    });
});
