// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationsSettings } from '@/components/settings/IntegrationsSettings';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nSECRETSECRETSECRET\n-----END PRIVATE KEY-----\n';
const SA_JSON = JSON.stringify({ type: 'service_account', project_id: 'proj-1', client_email: 'bot@proj-1.iam.gserviceaccount.com', private_key: PRIVATE_KEY }, null, 2);

const PROVIDERS = [
    { id: 'zoom', name: 'Zoom', icon: 'zoom', configured: true, connected: true, mode: 'server-to-server', source: 'instance', origin: 'extension' },
    { id: 'google-meet', name: 'Google Meet', icon: 'google-meet', configured: true, connected: true, mode: 'google-account', source: 'user-oauth', account: 'yo@example.com', origin: 'extension' },
];
const ADMIN = {
    domainId: 'dom-1',
    isAdmin: true,
    extensions: {
        'core-zoom': { installed: true, keys: [{ name: 'ZOOM_CLIENT_ID', configured: true }] },
        'core-google-meet': { installed: true, keys: [] },
        'core-calendar': { installed: true, keys: [] },
    },
};

type Call = { url: string; method: string; body: any };
let calls: Call[];
let adminReply: { status: number; body: unknown };
let putReply: { status: number; body: unknown };
let testReply: { status: number; body: unknown };
let providers: unknown[];
let container: HTMLDivElement;
let root: Root;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
    calls = [];
    providers = PROVIDERS;
    adminReply = { status: 200, body: ADMIN };
    putReply = { status: 200, body: { success: true, keys: [] } };
    testReply = { status: 200, body: { ok: true, mode: 'server-to-server' } };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init: RequestInit = {}) => {
            const method = (init.method || 'GET').toUpperCase();
            const u = String(url);
            calls.push({ url: u, method, body: init.body ? JSON.parse(String(init.body)) : undefined });
            if (u.endsWith('/conferencing/providers')) return json(200, { providers });
            if (u === '/api/admin/conferencing') return json(adminReply.status, adminReply.body);
            if (u === '/api/admin/extensions/settings') return json(putReply.status, putReply.body);
            if (u.endsWith('/test')) return json(testReply.status, testReply.body);
            if (u === '/api/auth/unlink/google') return json(200, { success: true });
            return json(404, {});
        }),
    );
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});

async function mount(props: Record<string, unknown> = {}) {
    await act(async () => { root.render(React.createElement(IntegrationsSettings, props as any)); });
    await flush();
    await flush();
    await flush();
}
const btn = (scope: ParentNode, text: string | RegExp) =>
    Array.from(scope.querySelectorAll('button')).find((b) => (typeof text === 'string' ? (b.textContent || '').trim() === text || b.getAttribute('aria-label') === text : text.test(b.textContent || '') || text.test(b.getAttribute('aria-label') || ''))) as HTMLButtonElement | undefined;
const click = async (el: Element | undefined) => {
    expect(el, 'elemento a pulsar').toBeTruthy();
    await act(async () => { (el as HTMLElement).click(); });
    await flush();
};
const setValue = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
};
const field = (scope: ParentNode, label: RegExp) => {
    const l = Array.from(scope.querySelectorAll('label')).find((x) => label.test(x.textContent || ''));
    expect(l, `label ${label}`).toBeTruthy();
    return document.getElementById((l as HTMLLabelElement).htmlFor) as HTMLInputElement;
};
const pickMode = async (scope: ParentNode, mode: string) => {
    const radio = Array.from(scope.querySelectorAll('input[type="radio"]')).find((r) => (r as HTMLInputElement).value === mode);
    await click(radio);
};
const section = (id: string) => container.querySelector(`section[data-provider="${id}"]`) as HTMLElement;
const puts = () => calls.filter((c) => c.url === '/api/admin/extensions/settings' && c.method === 'PUT');

describe('IntegrationsSettings: estado por proveedor', () => {
    it('muestra estado, fuente activa, modo y cuenta de Zoom y Google Meet', async () => {
        await mount({ hideAdmin: true });
        const zoom = container.querySelector('article[data-provider="zoom"]')!;
        const meet = container.querySelector('article[data-provider="google-meet"]')!;
        expect(zoom.textContent).toContain('Listo');
        expect(zoom.textContent).toContain('Cuenta de la organización');
        expect(zoom.textContent).toContain('servidor a servidor');
        expect(zoom.textContent).toContain('Lo gestiona tu organización');
        expect(meet.textContent).toContain('Tu cuenta');
        expect(meet.textContent).toContain('yo@example.com');
        // fuera del bloque admin no se consulta /api/admin/conferencing
        expect(calls.some((c) => c.url === '/api/admin/conferencing')).toBe(false);
    });

    it('sin conectar: boton Conectar que navega al OAuth con returnTo', async () => {
        providers = [{ ...PROVIDERS[1], configured: false, connected: false, source: 'none', mode: null, account: null, reason: 'not_connected', connect: { type: 'oauth', url: '/api/auth/google' } }];
        const onNavigate = vi.fn();
        await mount({ hideAdmin: true, onNavigate });
        await click(btn(container, 'Conectar Google Meet'));
        expect(onNavigate).toHaveBeenCalledTimes(1);
        expect(onNavigate.mock.calls[0][0]).toMatch(/^\/api\/auth\/google\?returnTo=/);
    });

    it('Reconectar cuando el token fue revocado', async () => {
        providers = [{ ...PROVIDERS[0], reason: 'token_revoked', source: 'user-oauth', connect: { type: 'oauth', url: '/api/auth/zoom' } }];
        await mount({ hideAdmin: true });
        expect(btn(container, 'Reconectar Zoom')).toBeTruthy();
    });

    it('desconectar Google: confirma en linea y llama a DELETE /api/auth/unlink/google', async () => {
        await mount({ hideAdmin: true });
        await click(btn(container, 'Desconectar Google Meet'));
        expect(calls.some((c) => c.url === '/api/auth/unlink/google')).toBe(false);
        await click(btn(container, 'Sí, desconectar'));
        expect(calls.find((c) => c.url === '/api/auth/unlink/google')?.method).toBe('DELETE');
        // se vuelve a pedir el estado
        expect(calls.filter((c) => c.url.endsWith('/conferencing/providers')).length).toBe(2);
    });

    it('desconectar Zoom (cuenta propia): DELETE /api/auth/unlink/zoom; con credenciales de instancia no se ofrece', async () => {
        providers = [{ ...PROVIDERS[0], source: 'user-oauth', mode: 'user-oauth' }];
        await mount({ hideAdmin: true });
        await click(btn(container, 'Desconectar Zoom'));
        await click(btn(container, 'Sí, desconectar'));
        expect(calls.find((c) => c.url === '/api/auth/unlink/zoom')?.method).toBe('DELETE');
    });

    it('Zoom con credenciales de la instancia no ofrece desconectar (no es una cuenta del usuario)', async () => {
        providers = [{ ...PROVIDERS[0], source: 'instance', mode: 'server-to-server' }];
        await mount({ hideAdmin: true });
        expect(btn(container, /Desconectar/)).toBeUndefined();
    });
});

describe('IntegrationsSettings: bloque de administrador', () => {
    it('403 sin motivo de manager: no se muestra el bloque admin', async () => {
        adminReply = { status: 403, body: { error: 'Forbidden' } };
        await mount();
        expect(container.querySelector('#conferencing-admin-title')).toBeNull();
        expect(container.querySelector('[data-testid="conferencing-admin-form"]')).toBeNull();
    });

    it('403 manager_required: muestra el motivo (sin formulario de guardado)', async () => {
        adminReply = { status: 403, body: { error: 'x', code: 'manager_required' } };
        await mount();
        const alert = container.querySelector('#conferencing-admin-title')!.parentElement!.querySelector('[role="alert"]');
        expect(alert?.textContent).toMatch(/manager propietario del dominio/);
        expect(container.querySelector('[data-testid="conferencing-admin-form"]')).toBeNull();
    });

    it('admin: Zoom S2S con campos enmascarados; "configurado" sin mostrar el valor', async () => {
        await mount();
        const zoom = section('zoom');
        for (const re of [/ID de cuenta/, /Client ID/, /Client Secret/]) expect(field(zoom, re).type).toBe('password');
        expect(zoom.textContent).toContain('Configurado');
        expect(field(zoom, /Client ID/).value).toBe('');
        expect(field(zoom, /Client ID/).getAttribute('placeholder')).toMatch(/Configurado/);
    });

    it('guardar Zoom: PUT a core-zoom con el modo y solo lo escrito; luego avisa "guardadas"', async () => {
        await mount();
        const zoom = section('zoom');
        await setValue(field(zoom, /ID de cuenta/), 'ACC');
        await setValue(field(zoom, /Client Secret/), ' s3cret ');
        await click(btn(zoom, 'Guardar credenciales'));
        expect(puts()).toHaveLength(1);
        expect(puts()[0].body).toEqual({ domainId: 'dom-1', extensionId: 'core-zoom', credentials: { ZOOM_AUTH_MODE: 'server-to-server', ZOOM_ACCOUNT_ID: 'ACC', ZOOM_CLIENT_SECRET: 's3cret' } });
        expect(zoom.querySelector('[data-testid="admin-note"]')?.textContent).toMatch(/guardadas/);
        expect((field(zoom, /Client Secret/)).value).toBe('');
    });

    it('guardar sin sesion de manager (403): muestra el motivo y NO "guardado"', async () => {
        putReply = { status: 403, body: { error: 'Forbidden' } };
        await mount();
        const zoom = section('zoom');
        await setValue(field(zoom, /ID de cuenta/), 'ACC');
        await click(btn(zoom, 'Guardar credenciales'));
        const note = zoom.querySelector('[data-testid="admin-note"]')!;
        expect(note.getAttribute('role')).toBe('alert');
        expect(note.textContent).toMatch(/manager propietario del dominio/);
        expect(note.textContent).not.toMatch(/guardadas/);
    });

    it('borrar un valor configurado lo manda como null', async () => {
        await mount();
        const zoom = section('zoom');
        await click(btn(zoom, 'Borrar valor'));
        expect(zoom.textContent).toContain('Se borrará al guardar');
        await click(btn(zoom, 'Guardar credenciales'));
        expect(puts()[0].body.credentials).toEqual({ ZOOM_AUTH_MODE: 'server-to-server', ZOOM_CLIENT_ID: null });
    });

    it('Google: el JSON se valida en cliente, solo se muestra client_email y se escribe en AMBAS extensiones', async () => {
        await mount();
        const google = section('google-meet');
        await pickMode(google, 'service-account');
        const sa = field(google, /JSON de la cuenta de servicio/);
        expect(sa.type).toBe('password');
        await setValue(sa, SA_JSON);
        expect(google.textContent).toContain('bot@proj-1.iam.gserviceaccount.com');
        expect(google.textContent).toContain('proj-1');
        // nunca se pinta la clave privada
        expect(container.innerHTML).not.toContain('SECRETSECRETSECRET');
        await setValue(field(google, /Usuario a suplantar/), 'admin@empresa.com');
        await click(btn(google, 'Guardar credenciales'));
        expect(puts().map((c) => c.body.extensionId)).toEqual(['core-google-meet', 'core-calendar']);
        const creds = puts()[0].body.credentials;
        expect(creds.GOOGLE_AUTH_MODE).toBe('service-account');
        expect(creds.GOOGLE_IMPERSONATE_USER).toBe('admin@empresa.com');
        expect(JSON.parse(creds.GOOGLE_SERVICE_ACCOUNT_JSON).project_id).toBe('proj-1');
        expect(puts()[1].body.credentials).toEqual(creds);
    });

    it('Google: JSON invalido => error accesible y no se guarda', async () => {
        await mount();
        const google = section('google-meet');
        await pickMode(google, 'service-account');
        await setValue(field(google, /JSON de la cuenta de servicio/), JSON.stringify({ type: 'authorized_user' }));
        expect(google.querySelector('[role="alert"]')?.textContent).toMatch(/service_account/);
        await click(btn(google, 'Guardar credenciales'));
        expect(puts()).toHaveLength(0);
        expect(google.querySelector('[data-testid="admin-note"]')?.textContent).toMatch(/Corrige los campos/);
    });

    it('Google cuenta organizadora: boton "Conectar cuenta de Google" -> /api/auth/google-organizer', async () => {
        const onNavigate = vi.fn();
        await act(async () => { root.render(React.createElement(IntegrationsSettings, { onNavigate } as any)); });
        await flush(); await flush(); await flush();
        const google = section('google-meet');
        await pickMode(google, 'google-account');
        await click(btn(google, 'Conectar cuenta de Google'));
        expect(onNavigate).toHaveBeenCalledTimes(1);
        expect(onNavigate.mock.calls[0][0]).toMatch(/^\/api\/auth\/google-organizer\?returnTo=/);
    });

    it('Probar conexion: OK y error legible con el codigo tipado', async () => {
        await mount();
        const zoom = section('zoom');
        await click(btn(zoom, 'Probar conexión'));
        expect(calls.find((c) => c.url === '/api/calendar/conferencing/zoom/test')?.method).toBe('POST');
        expect(zoom.querySelector('[data-testid="admin-test-result"]')?.textContent).toMatch(/Conexión con Zoom correcta/);

        testReply = { status: 401, body: { error: { code: 'token_revoked' } } };
        await click(btn(zoom, 'Probar conexión'));
        const result = zoom.querySelector('[data-testid="admin-test-result"]')!;
        expect(result.getAttribute('role')).toBe('alert');
        expect(result.textContent).toContain('(token_revoked)');
    });

    it('Borrar credenciales: confirma en linea y manda todo a null', async () => {
        await mount();
        const zoom = section('zoom');
        await click(btn(zoom, 'Borrar credenciales'));
        expect(puts()).toHaveLength(0);
        await click(btn(zoom, 'Sí, borrar'));
        expect(puts()).toHaveLength(1);
        expect(Object.values(puts()[0].body.credentials).every((v) => v === null)).toBe(true);
        expect(puts()[0].body.credentials).toHaveProperty('ZOOM_AUTH_MODE', null);
    });

    it('extension no instalada: avisa y desactiva el guardado', async () => {
        adminReply = { status: 200, body: { ...ADMIN, extensions: { ...ADMIN.extensions, 'core-zoom': { installed: false, keys: [] } } } };
        await mount();
        const zoom = section('zoom');
        expect(zoom.textContent).toMatch(/no está instalada/);
        expect(btn(zoom, 'Guardar credenciales')?.disabled).toBe(true);
    });
});
