// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let searchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({ useSearchParams: () => searchParams }));
vi.mock('next/link', async () => {
    const R = await import('react');
    return { default: ({ href, children, ...rest }: any) => R.createElement('a', { href, ...rest }, children) };
});

import { AuditView } from '../audit/AuditView';
import { I18nProvider } from '@/components/I18nProvider';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

const ROWS = [
    { id: 'e2', ts: '2026-09-01T10:00:00.000Z', event: 'auth.login.failure', userId: 'user_1', ip: '203.0.x.x', data: { email: 'v***@example.com', reason: 'bad_password' } },
    { id: 'e1', ts: '2026-09-01T09:00:00.000Z', event: 'admin.users.disabled', userId: null, ip: null, data: { actorKind: 'manager' } },
];
const page = (over: Record<string, unknown> = {}) => ({
    available: true, items: ROWS, total: 60, totalCapped: false, page: 1, pageSize: 25, pages: 3, nextCursor: null,
    eventTypes: ['admin.users.disabled', 'auth.login.failure'], ...over,
});
const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body, blob: async () => new Blob(['x']), headers: { get: () => null } });
const flush = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const listCalls = () => fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/api/admin/audit?'));
const lastList = () => listCalls()[listCalls().length - 1];
const setValue = async (el: HTMLInputElement | HTMLSelectElement, value: string) => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    await act(async () => {
        Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
        el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    });
};
const click = async (el: Element | null | undefined) => {
    if (!el) throw new Error('elemento no encontrado');
    await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();
};
const byText = (sel: string, text: string) => Array.from(document.querySelectorAll(sel)).find((e) => (e.getAttribute('aria-label') || e.textContent || '').includes(text)) as HTMLElement | undefined;

async function mount(locale: 'es' | 'en' = 'es') {
    await act(async () => {
        root.render(React.createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } },
            React.createElement(I18nProvider, { locale, children: React.createElement(AuditView) })));
    });
    await flush();
}

beforeEach(() => {
    searchParams = new URLSearchParams();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => (String(url).startsWith('/api/admin/audit/export') ? json(200, null) : json(200, page())));
    vi.stubGlobal('fetch', fetchMock);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('AuditView', () => {
    it('muestra la tabla con fecha, evento (insignia), usuario e IP enmascarada', async () => {
        await mount();
        expect(document.querySelector('caption')?.textContent).toBe('Eventos de auditoría');
        const text = container.textContent || '';
        expect(text).toContain('auth.login.failure');
        expect(text).toContain('203.0.x.x');
        expect(container.querySelector('a[href="/admin/users?open=user_1"]')).toBeTruthy();
        expect(text).toContain('Mostrando 1–25 de 60');
        expect(listCalls()[0]).toBe('/api/admin/audit?page=1&pageSize=25');
    });

    it('acepta ?event= de la URL y lo envia como filtro', async () => {
        searchParams = new URLSearchParams('event=auth.login.failure');
        await mount();
        expect(lastList()).toContain('event=auth.login.failure');
        expect((container.querySelector('select') as HTMLSelectElement).value).toBe('auth.login.failure');
    });

    it('ignora un ?event= invalido', async () => {
        searchParams = new URLSearchParams('event=%3Cscript%3E');
        await mount();
        expect(lastList()).not.toContain('event=');
    });

    it('filtra por tipo, por familia y por usuario (con debounce) y vuelve a la pagina 1', async () => {
        await mount();
        await click(byText('button', 'Página siguiente'));
        expect(lastList()).toContain('page=2');
        const select = container.querySelector('select') as HTMLSelectElement;
        expect(Array.from(select.options).map((o) => o.value)).toEqual(expect.arrayContaining(['', 'auth.*', 'admin.*', 'auth.login.failure']));
        await setValue(select, 'auth.*');
        await flush();
        expect(lastList()).toContain('event=auth.*');
        expect(lastList()).toContain('page=1');
        await setValue(container.querySelector('#audit-user') as HTMLInputElement, 'user_1');
        await flush(450);
        expect(lastList()).toContain('user=user_1');
    });

    it('valida fechas: Desde > Hasta muestra un error accesible y no consulta; >366 dias tambien', async () => {
        await mount();
        await setValue(container.querySelector('#audit-from') as HTMLInputElement, '2026-09-10T10:00');
        await flush();
        const before = listCalls().length;
        await setValue(container.querySelector('#audit-to') as HTMLInputElement, '2026-09-01T10:00');
        await flush();
        const alert = container.querySelector('#audit-range-err');
        expect(alert?.getAttribute('role')).toBe('alert');
        expect(alert?.textContent).toContain('anterior');
        expect((container.querySelector('#audit-from') as HTMLInputElement).getAttribute('aria-invalid')).toBe('true');
        expect(listCalls().length).toBe(before);
        expect((byText('button', 'Exportar CSV') as HTMLButtonElement).disabled).toBe(true);

        await setValue(container.querySelector('#audit-from') as HTMLInputElement, '2024-01-01T10:00');
        await setValue(container.querySelector('#audit-to') as HTMLInputElement, '2026-09-01T10:00');
        await flush();
        expect(container.querySelector('#audit-range-err')?.textContent).toContain('366');

        await setValue(container.querySelector('#audit-from') as HTMLInputElement, '2026-08-01T10:00');
        await flush();
        expect(container.querySelector('#audit-range-err')).toBeNull();
        expect(lastList()).toMatch(/from=2026-08-01T.*&to=2026-09-01T/);
    });

    it('abre el drawer con el JSON enmascarado en <pre> con tokens de codigo y se cierra con Escape', async () => {
        await mount();
        const open = byText('button', 'Ver detalle del evento auth.login.failure');
        expect(open?.tagName).toBe('BUTTON');
        open!.focus();
        expect(document.activeElement).toBe(open);
        await click(open);
        const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
        expect(dialog).toBeTruthy();
        const pre = dialog.querySelector('pre') as HTMLElement;
        expect(pre.className).toContain('bg-code');
        expect(pre.className).toContain('text-code-foreground');
        expect(JSON.parse(pre.textContent || '')).toEqual(ROWS[0].data);
        expect(dialog.textContent).toContain('enmascarados');
        await act(async () => { dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
        await flush(600);
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it('exporta el CSV con los filtros activos', async () => {
        searchParams = new URLSearchParams('event=auth.*');
        const createObjectURL = vi.fn(() => 'blob:x');
        (URL as any).createObjectURL = createObjectURL;
        (URL as any).revokeObjectURL = vi.fn();
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
        await mount();
        await click(byText('button', 'Exportar CSV'));
        await flush();
        const exportCall = fetchMock.mock.calls.map((c) => String(c[0])).find((u) => u.startsWith('/api/admin/audit/export'));
        expect(exportCall).toBe('/api/admin/audit/export?event=auth.*');
        expect(createObjectURL).toHaveBeenCalled();
        expect(container.textContent).toContain('CSV descargado');
    });

    it('errores de exportacion se anuncian en la region aria-live', async () => {
        fetchMock.mockImplementation(async (url: string) => (String(url).startsWith('/api/admin/audit/export') ? json(429, { code: 'rate_limited' }) : json(200, page())));
        await mount();
        await click(byText('button', 'Exportar CSV'));
        await flush();
        expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain('Demasiados intentos');
    });

    it('estados: vacio con filtros, vacio sin eventos, tabla no disponible y error con reintento', async () => {
        fetchMock.mockImplementation(async () => json(200, page({ items: [], total: 0, pages: 1 })));
        await mount();
        expect(container.textContent).toContain('Todavía no hay eventos');
        await setValue(container.querySelector('select') as HTMLSelectElement, 'auth.*');
        await flush();
        expect(container.textContent).toContain('Ningún evento coincide');
        expect(byText('button', 'Limpiar filtros')).toBeTruthy();

        fetchMock.mockImplementation(async () => json(200, page({ available: false, items: [], total: 0 })));
        await click(byText('button', 'Actualizar'));
        await flush();
        expect(container.textContent).toContain('La auditoría no está disponible');
    });

    it('un error del servidor se muestra como alerta con boton Reintentar que vuelve a pedir', async () => {
        fetchMock.mockImplementation(async () => json(500, { code: 'internal' }));
        await mount();
        const alert = container.querySelector('[role="alert"]');
        expect(alert?.textContent).toContain('Error del servidor');
        const calls = listCalls().length;
        fetchMock.mockImplementation(async () => json(200, page()));
        await click(byText('button', 'Reintentar'));
        await flush();
        expect(listCalls().length).toBeGreaterThan(calls);
        expect(container.textContent).toContain('auth.login.failure');
    });

    it('en ingles traduce la interfaz', async () => {
        await mount('en');
        expect(container.textContent).toContain('Event type');
        expect(document.querySelector('caption')?.textContent).toBe('Audit events');
    });
});

