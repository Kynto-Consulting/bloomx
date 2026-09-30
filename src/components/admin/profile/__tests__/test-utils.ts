import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { vi } from 'vitest';
import { I18nProvider } from '@/components/I18nProvider';

/** Utilidades compartidas por los tests jsdom de "Mi perfil" (no es un test: sin sufijo .test). */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

export const fetchMock = vi.fn();
export type Handler = (init: RequestInit | undefined, url: URL) => { status?: number; body?: unknown };

/** fetch por ruta: claves "METHOD /ruta" (sin query). Registra las llamadas en `calls`. */
export const calls: Array<{ method: string; path: string; search: string; body: any }> = [];

export function routeFetch(handlers: Record<string, Handler>) {
    calls.length = 0;
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
        const url = new URL(String(input), 'http://localhost');
        const method = (init?.method || 'GET').toUpperCase();
        let body: any;
        try { body = init?.body ? JSON.parse(String(init.body)) : undefined; } catch { body = init?.body; }
        calls.push({ method, path: url.pathname, search: url.search, body });
        const h = handlers[`${method} ${url.pathname}`];
        const r = h ? h(init, url) : { status: 404, body: {} };
        const status = r.status ?? 200;
        return { ok: status >= 200 && status < 300, status, json: async () => r.body ?? {} };
    });
    vi.stubGlobal('fetch', fetchMock);
}

export const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

let container: HTMLDivElement;
let root: Root;

export function mountRoot() {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
}

export async function unmountRoot() {
    await act(async () => root.unmount());
    container.remove();
}

export async function render(element: React.ReactElement, locale: 'es' | 'en' = 'es', wrap?: (el: React.ReactElement) => React.ReactElement) {
    const inner = wrap ? wrap(element) : element;
    await act(async () => {
        root.render(
            React.createElement(I18nProvider, { locale, children: React.createElement(SWRConfig as any, { value: { provider: () => new Map(), dedupingInterval: 0 }, children: inner }) }),
        );
    });
    await flush();
}

export const textOf = () => document.body.textContent || '';

export async function click(el: Element | null | undefined) {
    if (!el) throw new Error('elemento no encontrado');
    await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
    await flush();
}

export async function setValue(el: HTMLInputElement | HTMLTextAreaElement | null | undefined, value: string) {
    if (!el) throw new Error('campo no encontrado');
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    await act(async () => {
        Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

export async function submit(form: Element | null | undefined) {
    if (!form) throw new Error('formulario no encontrado');
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();
}

/** Boton por texto exacto (o aria-label exacto), dentro de `scope` (por defecto todo el documento). */
export function button(text: string, scope: ParentNode = document): HTMLButtonElement | undefined {
    return Array.from(scope.querySelectorAll('button')).find(
        (b) => (b.getAttribute('aria-label') || b.textContent || '').trim() === text,
    ) as HTMLButtonElement | undefined;
}

export const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

export function radio(label: string): HTMLInputElement | null {
    const l = Array.from(document.querySelectorAll('label')).find((x) => (x.querySelector('.font-medium')?.textContent || '').trim() === label);
    return (l?.querySelector('input[type="radio"]') as HTMLInputElement) ?? null;
}

export function byLabelText(text: string): HTMLInputElement | HTMLTextAreaElement | null {
    const l = Array.from(document.querySelectorAll('label')).find((x) => (x.textContent || '').replace(/\s*\*\s*$/, '').trim() === text);
    if (!l) return null;
    const id = l.getAttribute('for');
    return id ? document.getElementById(id) as HTMLInputElement : null;
}
