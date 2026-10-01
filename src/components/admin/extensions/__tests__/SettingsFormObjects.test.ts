// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsForm } from '../SettingsForm';
import { RunLogTable } from '../RunLogTable';
import { I18nProvider } from '@/components/I18nProvider';
import { normalizeSettingsSchema } from '@/lib/expansions/settings-schema';
import type { ExtensionRow } from '@/lib/admin/extensions-view';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();
const calls: { url: string; method: string; body: any }[] = [];
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const res = (status: number, body: any) => ({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(JSON.stringify(body)) });

const schema = normalizeSettingsSchema({
    fields: [{
        key: 'endpoints', type: 'objects', label: { es: 'Endpoints', en: 'Endpoints' }, maxItems: 5,
        itemFields: [
            { key: 'name', type: 'string', label: 'Nombre', required: true },
            { key: 'url', type: 'string', label: 'URL', format: 'url', required: true },
            { key: 'secret', type: 'string', secret: true, label: 'Secreto' },
        ],
        templates: [{ id: 'slack', label: 'Slack', value: { name: 'Slack', url: 'https://hooks.example.com/x' } }],
    }],
    actions: [
        { id: 'send-test', label: 'Enviar evento de prueba', handler: 'sendTest', scope: 'item', itemsKey: 'endpoints' },
        { id: 'apply-all', label: 'Aplicar ahora', handler: 'applyAll', scope: 'global', confirm: { es: 'Esto aplica los cambios.', en: 'This applies changes.' } },
    ],
    runLog: { limit: 20 },
});

const base = () => ({
    values: { endpoints: [{ id: 'ep-1', name: 'Principal', url: 'https://a.test' }] },
    sources: { endpoints: 'domain' },
    envLegacy: [], importable: [], secretsSet: ['endpoints.ep-1.secret'], secrets: [],
    runLog: [{ ts: '2026-01-01T00:00:00Z', event: 'EMAIL_SENT', target: 'ep-1', status: 'ok', code: 200, attempts: 1, latencyMs: 12 }],
    checklist: { done: 0, total: 0, items: [] }, meta: { updatedAt: null, updatedBy: null }, limits: { maxConfigBytes: 32768 },
});
let config: any;
let postStatus = 200;
let putStatus = 200;
let putBody: any = null;

const row = (): ExtensionRow => ({
    id: 'webhooks', name: 'Webhooks', description: '', icon: null, version: '1', installedVersion: '1', updateAvailable: false, status: 'enabled', installed: true, enabled: true,
    isPaid: false, price: '0', currency: 'USD', authType: null, category: 'integrations', template: { settingsSchema: schema }, order: 0, hasCredentials: false, mandatory: false,
    mandatoryByManifest: false, hasErrors: false, manifestValid: true, manifestProblems: [], hasCredentialKeys: false, inCatalog: true,
} as unknown as ExtensionRow);

function mount(node: React.ReactElement) {
    act(() => {
        root.render(React.createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, React.createElement(I18nProvider, { locale: 'es', children: node })));
    });
}
const form = (readOnly = false) => React.createElement(SettingsForm, { row: row(), domainId: 'dom1', readOnly, onGoCredentials: () => undefined });
const byText = (sel: string, text: string, scope: ParentNode = container) => Array.from(scope.querySelectorAll<HTMLElement>(sel)).find((e) => (e.textContent || '').includes(text));
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
    act(() => {
        Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

beforeEach(() => {
    calls.length = 0;
    config = base();
    postStatus = 200;
    putStatus = 200;
    putBody = null;
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init: any) => {
        const method = init?.method ?? 'GET';
        const body = init?.body ? JSON.parse(init.body) : undefined;
        calls.push({ url, method, body });
        if (method === 'GET') return res(200, config);
        if (method === 'PUT') {
            if (putStatus !== 200) return res(putStatus, putBody);
            if (body.values?.endpoints) config = { ...config, values: { ...config.values, endpoints: body.values.endpoints } };
            for (const [name, v] of Object.entries(body.secrets ?? {})) {
                config.secretsSet = v === null ? config.secretsSet.filter((n: string) => n !== name) : [...new Set([...config.secretsSet, name])];
            }
            return res(200, { success: true, ...config });
        }
        if (postStatus !== 200) return res(postStatus, { error: 'x' });
        config = { ...config, runLog: [{ ts: '2026-01-02T00:00:00Z', event: 'TEST', target: body.itemId, status: 'ok', code: 200 }, ...config.runLog] };
        return res(200, { ok: true, result: { status: 'ok', code: 204, latencyMs: 33, message: 'Entregado', report: ['linea 1', 'linea 2'] }, runLog: config.runLog });
    });
    vi.stubGlobal('fetch', fetchMock);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});

describe('SettingsForm: objects, secretos por elemento y acciones', () => {
    it('lista elementos colapsables con indicador de secreto configurado, sin exponer valores', async () => {
        mount(form());
        await flush();
        const card = container.querySelector('[data-testid="item-ep-1"]')!;
        expect(card.textContent).toContain('Principal');
        const toggle = card.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        await act(async () => { toggle.click(); });
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(card.querySelector('[data-testid="secret-ep-1.secret"]')!.textContent).toContain('Configurado');
        const pwd = card.querySelector<HTMLInputElement>('input[type="password"]')!;
        expect(pwd.value).toBe('');
        expect(pwd.autocomplete).toBe('new-password');
        expect(card.textContent).toContain('no se puede cambiar');
    });

    it('anade desde plantilla (queda sin guardar), valida y envia values + secrets en el mismo PUT', async () => {
        mount(form());
        await flush();
        await act(async () => { byText('button', 'Añadir desde plantilla: Slack')!.click(); });
        const cards = container.querySelectorAll('[data-testid^="item-"]');
        expect(cards.length).toBe(2);
        const fresh = cards[1] as HTMLElement;
        expect(fresh.textContent).toContain('Nuevo');
        expect(fresh.getAttribute('data-testid')).toMatch(/^item-slack-[a-z0-9]{4}$/);
        // el boton de acciones del elemento nuevo exige guardar antes
        expect(byText('button', 'Enviar evento de prueba', fresh)!.hasAttribute('disabled')).toBe(true);
        const url = fresh.querySelector<HTMLInputElement>('input[type="text"][id$=".url"]')!;
        type(url, 'http://inseguro.test');
        expect(url.getAttribute('aria-invalid')).toBe('true');
        expect(fresh.textContent).toContain('Formato no válido');
        expect((byText('button', 'Guardar') as HTMLButtonElement).disabled).toBe(true);
        type(url, 'https://ok.test');
        type(fresh.querySelector<HTMLInputElement>('input[type="password"]')!, 'whsec-UNICO');
        expect((byText('button', 'Guardar') as HTMLButtonElement).disabled).toBe(false);
        await act(async () => { (byText('button', 'Guardar') as HTMLButtonElement).click(); });
        await flush();
        const put = calls.find((c) => c.method === 'PUT')!;
        const ids = put.body.values.endpoints.map((e: any) => e.id);
        expect(ids[0]).toBe('ep-1');
        expect(put.body.values.endpoints[1]).toMatchObject({ name: 'Slack', url: 'https://ok.test' });
        expect(Object.keys(put.body.secrets)).toEqual([`endpoints.${ids[1]}.secret`]);
        expect(put.body.secrets[`endpoints.${ids[1]}.secret`]).toBe('whsec-UNICO');
        // tras guardar el valor del secreto ya no esta en el DOM y el elemento figura como configurado
        expect(container.innerHTML).not.toContain('whsec-UNICO');
    });

    it('cambiar solo un secreto envia unicamente secrets; Quitar envia null', async () => {
        mount(form());
        await flush();
        const card = container.querySelector('[data-testid="item-ep-1"]')!;
        type(card.querySelector<HTMLInputElement>('input[type="password"]')!, 'nuevo-secreto');
        await act(async () => { (byText('button', 'Guardar') as HTMLButtonElement).click(); });
        await flush();
        expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ domainId: 'dom1', extensionId: 'webhooks', secrets: { 'endpoints.ep-1.secret': 'nuevo-secreto' } });
        calls.length = 0;
        await act(async () => { byText('button', 'Quitar', container.querySelector('[data-testid="item-ep-1"]')!)!.click(); });
        await act(async () => { (byText('button', 'Guardar') as HTMLButtonElement).click(); });
        await flush();
        expect(calls.find((c) => c.method === 'PUT')!.body.secrets).toEqual({ 'endpoints.ep-1.secret': null });
    });

    it('eliminar pide confirmacion', async () => {
        mount(form());
        await flush();
        await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label^="Eliminar"]')!.click(); });
        expect(document.body.textContent).toContain('¿Eliminar el elemento?');
        expect(container.querySelectorAll('[data-testid^="item-"]').length).toBe(1);
        const confirm = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] button')).find((b) => b.textContent === 'Eliminar')!;
        await act(async () => { confirm.click(); });
        expect(container.querySelectorAll('[data-testid^="item-"]').length).toBe(0);
    });

    it('accion por elemento: ejecuta, muestra codigo/latencia/mensaje/informe y traduce el 429', async () => {
        mount(form());
        await flush();
        const card = () => container.querySelector('[data-testid="item-ep-1"]') as HTMLElement;
        await act(async () => { byText('button', 'Enviar evento de prueba', card())!.click(); });
        await flush();
        const post = calls.find((c) => c.method === 'POST')!;
        expect(post.body).toEqual({ domainId: 'dom1', extensionId: 'webhooks', action: 'run-action', actionId: 'send-test', itemId: 'ep-1' });
        const result = card().querySelector('[data-testid="action-result"]')!;
        expect(result.getAttribute('role')).toBe('status');
        expect(result.textContent).toContain('Código HTTP: 204');
        expect(result.textContent).toContain('Latencia: 33 ms');
        expect(result.textContent).toContain('Entregado');
        expect(result.textContent).toContain('linea 2');
        postStatus = 429;
        await act(async () => { byText('button', 'Enviar evento de prueba', card())!.click(); });
        await flush();
        expect(card().textContent).toContain('máximo 10 por minuto');
    });

    it('accion con confirm: pide confirmacion antes de ejecutar', async () => {
        mount(form());
        await flush();
        await act(async () => { byText('button', 'Aplicar ahora')!.click(); });
        expect(document.body.textContent).toContain('Esto aplica los cambios.');
        expect(calls.some((c) => c.method === 'POST')).toBe(false);
        const run = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] button')).find((b) => b.textContent === 'Ejecutar')!;
        await act(async () => { run.click(); });
        await flush();
        expect(calls.find((c) => c.method === 'POST')!.body.actionId).toBe('apply-all');
    });

    it('422 con code/params se traduce y se asocia al campo', async () => {
        mount(form());
        await flush();
        putStatus = 422;
        putBody = { error: 'Invalid', errors: [{ path: 'values.endpoints', message: 'es', code: 'itemField', params: { index: 1, field: 'url', sub: 'format', format: 'url' } }] };
        const card = container.querySelector('[data-testid="item-ep-1"]')!;
        type(card.querySelector<HTMLInputElement>('input[type="text"][id$=".name"]')!, 'Otro');
        await act(async () => { (byText('button', 'Guardar') as HTMLButtonElement).click(); });
        await flush();
        expect(container.textContent).toContain('Elemento 1, campo «url»: Formato no válido (se espera: url).');
    });

    it('solo lectura: sin añadir/eliminar y acciones deshabilitadas', async () => {
        mount(form(true));
        await flush();
        expect(byText('button', 'Añadir elemento')).toBeUndefined();
        expect(container.querySelector('button[aria-label^="Eliminar"]')).toBeNull();
        expect(byText('button', 'Enviar evento de prueba')!.hasAttribute('disabled')).toBe(true);
    });
});

describe('RunLogTable', () => {
    it('muestra el registro con el nombre del destino y refresca', async () => {
        mount(React.createElement(RunLogTable, { row: row(), domainId: 'dom1' }));
        await flush();
        const table = container.querySelector('table')!;
        expect(table.textContent).toContain('EMAIL_SENT');
        expect(table.textContent).toContain('Principal');
        expect(table.textContent).toContain('12 ms');
        expect(container.textContent).toContain('Correcto');
        const before = calls.length;
        await act(async () => { byText('button', 'Actualizar')!.click(); });
        await flush();
        expect(calls.length).toBeGreaterThan(before);
    });

    it('vacio y sin runLog declarado', async () => {
        config = { ...base(), runLog: [] };
        mount(React.createElement(RunLogTable, { row: row(), domainId: 'dom1' }));
        await flush();
        expect(container.textContent).toContain('Todavía no hay ejecuciones registradas');
    });
});
