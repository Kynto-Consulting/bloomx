// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConferencingPicker, type PickerContext, type PickerMeeting } from '../ConferencingPicker';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const ZOOM = { id: 'zoom', name: 'Zoom', icon: 'zoom', configured: true, connected: true, mode: 'server-to-server', source: 'instance', origin: 'extension' };
const MEET_DISCONNECTED = {
    id: 'google-meet',
    name: 'Google Meet',
    icon: 'google-meet',
    configured: false,
    connected: false,
    mode: 'google-account',
    source: 'none',
    reason: 'not_connected',
    connect: { type: 'oauth', url: '/api/auth/google' },
    origin: 'extension',
};
const MEETING = { provider: 'zoom', joinUrl: 'https://us02web.zoom.us/j/123456789', meetingId: '123456789', providerName: 'Zoom', passcode: 'abc' };
const CTX: PickerContext = { title: 'Sync', startsAt: '2026-10-01T10:00:00.000Z', endsAt: '2026-10-01T11:00:00.000Z', timeZone: 'UTC', attendees: ['ana@x.com'] };

type Call = { url: string; method: string; headers: Record<string, string>; body: any };
let calls: Call[];
let createReplies: Array<{ status: number; body: unknown }>;
let providers: unknown[];
let container: HTMLDivElement;
let root: Root;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
    calls = [];
    createReplies = [];
    providers = [ZOOM, MEET_DISCONNECTED];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init: RequestInit = {}) => {
            const method = (init.method || 'GET').toUpperCase();
            calls.push({ url: String(url), method, headers: (init.headers as Record<string, string>) || {}, body: init.body ? JSON.parse(String(init.body)) : undefined });
            if (String(url).endsWith('/providers')) return json(200, { providers });
            if (method === 'POST') {
                const reply = createReplies.shift() ?? { status: 200, body: { meeting: MEETING } };
                return json(reply.status, reply.body);
            }
            if (method === 'DELETE') return json(200, { ok: true });
            return json(404, {});
        }),
    );
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});

function Harness(props: { initial?: PickerMeeting | null; context?: PickerContext; onChangeSpy?: (m: PickerMeeting | null) => void; [k: string]: unknown }) {
    const { initial = null, context = CTX, onChangeSpy, ...rest } = props;
    const [value, setValue] = useState<PickerMeeting | null>(initial);
    return React.createElement(ConferencingPicker, {
        value,
        context,
        onChange: (m: PickerMeeting | null) => {
            setValue(m);
            onChangeSpy?.(m);
        },
        ...rest,
    } as any);
}

async function mount(props: Parameters<typeof Harness>[0] = {}) {
    await act(async () => {
        root.render(React.createElement(Harness, props));
    });
    await flush();
    await flush();
}
async function rerender(props: Parameters<typeof Harness>[0]) {
    await act(async () => {
        root.render(React.createElement(Harness, props));
    });
    await flush();
}
const button = (text: string | RegExp) =>
    Array.from(container.querySelectorAll('button')).find((b) => (typeof text === 'string' ? (b.textContent || '').includes(text) || b.getAttribute('aria-label')?.includes(text) : text.test(b.textContent || '') || text.test(b.getAttribute('aria-label') || ''))) as HTMLButtonElement | undefined;
const click = async (el: Element | undefined) => {
    expect(el, 'elemento a pulsar').toBeTruthy();
    await act(async () => { (el as HTMLElement).click(); });
    await flush();
};
const createCalls = () => calls.filter((c) => c.method === 'POST');

describe('ConferencingPicker: carga y estados', () => {
    it('muestra "cargando" (role=status) y luego la lista con el estado de cada proveedor', async () => {
        let release: (r: Response) => void = () => undefined;
        (fetch as any).mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
        await act(async () => { root.render(React.createElement(Harness, {})); });
        const loading = container.querySelector('[role="status"]');
        expect(loading?.textContent).toMatch(/Cargando proveedores/);
        expect(loading?.querySelector('svg.animate-spin')).toBeTruthy();
        await act(async () => { release(json(200, { providers })); });
        await flush();
        await flush();
        expect(container.querySelector('[data-provider="zoom"]')?.getAttribute('data-state')).toBe('ready');
        expect(container.querySelector('[data-provider="google-meet"]')?.getAttribute('data-state')).toBe('connect');
        expect(container.textContent).toContain('Listo');
        expect(container.textContent).toContain('Sin conectar');
        // motivo legible del no configurado
        expect(container.textContent).toContain('Conecta tu cuenta para crear reuniones.');
        // radiogroup con etiqueta accesible
        expect(container.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe('Proveedor de videoconferencia');
    });

    it('proveedor conectado: vista previa del nombre y boton crear habilitado', async () => {
        await mount();
        expect(container.textContent).toContain('Se creará una reunión de Zoom');
        expect(button('Crear reunión')?.disabled).toBe(false);
    });

    it('error al cargar: alerta con Reintentar que vuelve a pedir los proveedores', async () => {
        (fetch as any).mockImplementationOnce(async (url: string) => {
            calls.push({ url: String(url), method: 'GET', headers: {}, body: undefined });
            return json(500, { error: { code: 'provider_error' } });
        });
        await mount();
        expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/No se pudieron cargar/);
        await click(button('Reintentar'));
        expect(calls.filter((c) => c.url.endsWith('/providers')).length).toBe(2);
        expect(container.querySelector('[data-provider="zoom"]')).toBeTruthy();
    });

    it('respeta `allowed`', async () => {
        await mount({ allowed: ['zoom'] });
        expect(container.querySelector('[data-provider="google-meet"]')).toBeNull();
        expect(container.querySelector('[data-provider="zoom"]')).toBeTruthy();
    });
});

describe('ConferencingPicker: conectar', () => {
    it('Conectar navega a la URL OAuth con returnTo interno', async () => {
        const onNavigate = vi.fn();
        await mount({ onNavigate, returnTo: '/calendar?view=week' });
        await click(button('Conectar Google Meet'));
        expect(onNavigate).toHaveBeenCalledWith('/api/auth/google?returnTo=%2Fcalendar%3Fview%3Dweek');
    });

    it('nunca navega a una URL de un host ajeno', async () => {
        providers = [{ ...MEET_DISCONNECTED, connect: { type: 'oauth', url: 'https://evil.example/steal' } }];
        const onNavigate = vi.fn();
        await mount({ onNavigate });
        await click(button('Conectar Google Meet'));
        expect(onNavigate).not.toHaveBeenCalled();
        expect(container.querySelector('[role="alert"]')).toBeTruthy();
    });

    it('conexion de tipo "settings" abre Ajustes -> Integraciones', async () => {
        providers = [{ ...MEET_DISCONNECTED, connect: { type: 'settings', section: 'integrations' } }];
        const onOpenSettings = vi.fn();
        const onNavigate = vi.fn();
        await mount({ onOpenSettings, onNavigate });
        await click(button('Conectar Google Meet'));
        expect(onOpenSettings).toHaveBeenCalledTimes(1);
        expect(onNavigate).not.toHaveBeenCalled();
    });

    it('token revocado en el estado del proveedor => boton Reconectar', async () => {
        providers = [{ ...ZOOM, configured: true, reason: 'token_revoked', connect: { type: 'oauth', url: '/api/auth/zoom' } }];
        await mount();
        expect(container.querySelector('[data-provider="zoom"]')?.getAttribute('data-state')).toBe('reconnect');
        expect(button('Reconectar Zoom')).toBeTruthy();
    });
});

describe('ConferencingPicker: crear', () => {
    it('crea la reunion con Idempotency-Key y el contexto, y llama a onChange', async () => {
        const spy = vi.fn();
        await mount({ onChangeSpy: spy });
        await click(button('Crear reunión'));
        const [post] = createCalls();
        expect(post.url).toBe('/api/calendar/conferencing/zoom');
        expect(post.headers['Idempotency-Key']).toMatch(/\S{8,}/);
        expect(post.body).toMatchObject({ topic: 'Sync', startsAt: CTX.startsAt, endsAt: CTX.endsAt, timeZone: 'UTC', attendees: ['ana@x.com'] });
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({ provider: 'zoom', joinUrl: MEETING.joinUrl }));
        // ahora se ve la tarjeta con el enlace y el nombre del proveedor
        expect(container.querySelector('[data-testid="meeting-card"]')?.textContent).toContain(MEETING.joinUrl);
        expect(container.querySelector('[data-testid="conferencing-live"]')?.textContent).toMatch(/Reunión de Zoom creada/);
    });

    it('mientras crea muestra spinner con texto y el boton queda deshabilitado', async () => {
        let release: (r: Response) => void = () => undefined;
        (fetch as any).mockImplementation(async (url: string, init: RequestInit = {}) => {
            calls.push({ url: String(url), method: (init.method || 'GET').toUpperCase(), headers: (init.headers as any) || {}, body: undefined });
            if (String(url).endsWith('/providers')) return json(200, { providers });
            return new Promise<Response>((resolve) => { release = resolve; });
        });
        await mount();
        await click(button('Crear reunión'));
        const busy = button('Creando reunión de Zoom');
        expect(busy?.disabled).toBe(true);
        expect(busy?.querySelector('svg.animate-spin')).toBeTruthy();
        await act(async () => { release(json(200, { meeting: MEETING })); });
        await flush();
        expect(container.querySelector('[data-testid="meeting-card"]')).toBeTruthy();
    });

    it('token_revoked => alerta con Reconectar (navega al OAuth)', async () => {
        createReplies = [{ status: 401, body: { error: { code: 'token_revoked', message: 'x' } } }];
        const onNavigate = vi.fn();
        await mount({ onNavigate, returnTo: '/cal' });
        await click(button('Crear reunión'));
        const alert = container.querySelector('[role="alert"]');
        expect(alert?.getAttribute('data-error-code')).toBe('token_revoked');
        expect(alert?.textContent).toMatch(/Reconecta tu cuenta/);
        await click(Array.from(alert!.querySelectorAll('button')).find((b) => /Reconectar/.test(b.textContent || '')));
        expect(onNavigate).toHaveBeenCalled();
    });

    it('not_connected => alerta con Conectar', async () => {
        createReplies = [{ status: 409, body: { error: { code: 'not_connected' } } }];
        await mount({ onNavigate: vi.fn() });
        await click(button('Crear reunión'));
        const alert = container.querySelector('[role="alert"]')!;
        expect(alert.getAttribute('data-error-code')).toBe('not_connected');
        expect(Array.from(alert.querySelectorAll('button')).some((b) => b.textContent === 'Conectar')).toBe(true);
    });

    it('rate_limited => espera N s con retryAfter y el reintento queda deshabilitado', async () => {
        createReplies = [{ status: 429, body: { error: { code: 'rate_limited', retryAfter: 7 } } }];
        await mount();
        await click(button('Crear reunión'));
        const alert = container.querySelector('[role="alert"]')!;
        expect(alert.textContent).toMatch(/en 7 s/);
        const retry = Array.from(alert.querySelectorAll('button')).find((b) => /Reintentar en 7 s/.test(b.textContent || '')) as HTMLButtonElement;
        expect(retry.disabled).toBe(true);
        expect(button('Crear reunión')?.disabled).toBe(true);
    });

    it('invalid_credentials => pide al administrador (sin boton de reintento)', async () => {
        createReplies = [{ status: 424, body: { error: { code: 'invalid_credentials' } } }];
        await mount();
        await click(button('Crear reunión'));
        const alert = container.querySelector('[role="alert"]')!;
        expect(alert.textContent).toMatch(/administrador/);
        expect(alert.querySelectorAll('button').length).toBe(0);
    });

    it('provider_error => Reintentar reutiliza LA MISMA Idempotency-Key', async () => {
        createReplies = [{ status: 502, body: { error: { code: 'provider_error' } } }];
        await mount();
        await click(button('Crear reunión'));
        const alert = container.querySelector('[role="alert"]')!;
        await click(Array.from(alert.querySelectorAll('button')).find((b) => b.textContent === 'Reintentar'));
        const posts = createCalls();
        expect(posts).toHaveLength(2);
        expect(posts[1].headers['Idempotency-Key']).toBe(posts[0].headers['Idempotency-Key']);
        expect(container.querySelector('[data-testid="meeting-card"]')).toBeTruthy();
    });

    it('si cambia el contexto la clave es nueva', async () => {
        createReplies = [{ status: 502, body: { error: { code: 'provider_error' } } }];
        await mount();
        await click(button('Crear reunión'));
        await rerender({ context: { ...CTX, title: 'Otro titulo' } });
        await click(button('Crear reunión'));
        const posts = createCalls();
        expect(posts).toHaveLength(2);
        expect(posts[1].headers['Idempotency-Key']).not.toBe(posts[0].headers['Idempotency-Key']);
    });
});

describe('ConferencingPicker: enlace propio', () => {
    const setInput = async (value: string) => {
        const input = container.querySelector('input[type="text"]') as HTMLInputElement;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    };
    const selectCustom = async () => {
        await mount({ allowCustom: true, allowed: ['custom'] });
    };

    it('enlace invalido: alerta y boton deshabilitado; no llama al servidor', async () => {
        await selectCustom();
        await setInput('http://zoom.us/j/1');
        expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/https/);
        expect(button('Usar enlace')?.disabled).toBe(true);
        expect(createCalls()).toHaveLength(0);
    });

    it('enlace de proveedor reconocido: se acepta sin credenciales', async () => {
        const spy = vi.fn();
        await mount({ allowCustom: true, allowed: ['custom'], onChangeSpy: spy });
        await setInput('https://zoom.us/j/123456');
        expect(container.textContent).toMatch(/Zoom reconocido/);
        await click(button('Usar enlace'));
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({ provider: 'custom', joinUrl: 'https://zoom.us/j/123456' }));
        expect(createCalls()).toHaveLength(0);
    });

    it('host no reconocido: avisa pero permite', async () => {
        const spy = vi.fn();
        await mount({ allowCustom: true, allowed: ['custom'], onChangeSpy: spy });
        await setInput('https://sala.example.com/abc');
        expect(container.querySelector('[role="status"].text-warning')?.textContent).toMatch(/No reconocemos el proveedor \(sala\.example\.com\)/);
        expect(button('Usar enlace')?.disabled).toBe(false);
        await click(button('Usar enlace'));
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({ provider: 'custom', joinUrl: 'https://sala.example.com/abc' }));
    });
});

describe('ConferencingPicker: reunion existente', () => {
    it('copiar: usa el portapapeles y avisa en la region aria-live', async () => {
        const writeText = vi.fn(async () => undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        await mount({ initial: MEETING as PickerMeeting });
        await click(button('Copiar enlace'));
        expect(writeText).toHaveBeenCalledWith(MEETING.joinUrl);
        expect(container.querySelector('[data-testid="conferencing-live"]')?.textContent).toBe('Enlace copiado');
        expect(button('Enlace copiado')).toBeTruthy();
    });

    it('copiar sin portapapeles: usa el respaldo y avisa si falla', async () => {
        Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
        (document as any).execCommand = vi.fn(() => false);
        await mount({ initial: MEETING as PickerMeeting });
        await click(button('Copiar enlace'));
        expect((document as any).execCommand).toHaveBeenCalledWith('copy');
        expect(container.querySelector('[data-testid="conferencing-live"]')?.textContent).toMatch(/No se pudo copiar/);
    });

    it('el enlace es un <a> seguro con rel noopener noreferrer', async () => {
        await mount({ initial: MEETING as PickerMeeting });
        const a = container.querySelector('[data-testid="meeting-card"] a') as HTMLAnchorElement;
        expect(a.getAttribute('rel')).toBe('noopener noreferrer');
        expect(a.getAttribute('target')).toBe('_blank');
        expect(a.getAttribute('href')).toBe(MEETING.joinUrl);
    });

    it('quitar: confirma en linea (sin window.confirm), cancela en el proveedor y limpia', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm');
        const spy = vi.fn();
        await mount({ initial: MEETING as PickerMeeting, onChangeSpy: spy });
        await click(button('Quitar'));
        expect(container.querySelector('[role="group"]')?.textContent).toMatch(/¿Quitar esta reunión\?/);
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
        await click(button('Sí, quitar'));
        const del = calls.find((c) => c.method === 'DELETE')!;
        expect(del.url).toBe('/api/calendar/conferencing/zoom?meetingId=123456789');
        expect(spy).toHaveBeenLastCalledWith(null);
        expect(confirmSpy).not.toHaveBeenCalled();
        expect(container.querySelector('[data-testid="meeting-card"]')).toBeNull();
    });

    it('quitar una reunion sin id de extension no llama a DELETE', async () => {
        const spy = vi.fn();
        await mount({ initial: { ...MEETING, meetingId: '' } as PickerMeeting, onChangeSpy: spy });
        await click(button('Quitar'));
        await click(button('Sí, quitar'));
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
        expect(spy).toHaveBeenLastCalledWith(null);
    });

    it('cancelar la confirmacion mantiene la reunion', async () => {
        await mount({ initial: MEETING as PickerMeeting });
        await click(button('Quitar'));
        await click(button('Cancelar'));
        expect(container.querySelector('[data-testid="meeting-card"]')).toBeTruthy();
    });

    it('quitar aunque el proveedor falle (mejor esfuerzo)', async () => {
        (fetch as any).mockImplementation(async (url: string, init: RequestInit = {}) => {
            const method = (init.method || 'GET').toUpperCase();
            calls.push({ url: String(url), method, headers: {}, body: undefined });
            if (String(url).endsWith('/providers')) return json(200, { providers });
            return json(502, { error: { code: 'provider_error' } });
        });
        const spy = vi.fn();
        await mount({ initial: MEETING as PickerMeeting, onChangeSpy: spy });
        await click(button('Quitar'));
        await click(button('Sí, quitar'));
        expect(spy).toHaveBeenLastCalledWith(null);
    });

    it('regenerar: cancela la anterior y crea otra con una clave nueva', async () => {
        const second = { ...MEETING, joinUrl: 'https://us02web.zoom.us/j/999', meetingId: '999' };
        createReplies = [{ status: 200, body: { meeting: second } }];
        const spy = vi.fn();
        await mount({ initial: MEETING as PickerMeeting, onChangeSpy: spy });
        await click(button('Regenerar'));
        expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('meetingId=123456789'))).toBe(true);
        expect(createCalls()).toHaveLength(1);
        expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ meetingId: '999' }));
    });

    it('deshabilitado: no ofrece quitar ni regenerar', async () => {
        await mount({ initial: MEETING as PickerMeeting, disabled: true });
        expect(button('Quitar')).toBeUndefined();
        expect(button('Regenerar')).toBeUndefined();
    });
});
