// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsForm } from '../SettingsForm';
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
    groups: [{ id: 'content', label: { es: 'Contenido', en: 'Content' } }],
    fields: [
        { key: 'keywords', type: 'list', group: 'content', label: { es: 'Palabras clave', en: 'Keywords' }, default: ['a'], maxItems: 3, legacyEnv: 'DLP_KEYWORDS' },
        { key: 'detectors', type: 'multienum', group: 'content', label: 'Detectores', options: [{ value: 'cards', label: 'Tarjetas', description: 'Luhn', example: '4111' }, 'iban'], default: ['cards'] },
        { key: 'mode', type: 'enum', label: 'Modo', options: ['block', 'warn'], default: 'block', required: true },
        { key: 'strict', type: 'boolean', label: 'Estricto', default: false },
        { key: 'limit', type: 'number', label: 'Limite', min: 1, max: 10, integer: true },
        { key: 'customPatterns', type: 'list', label: 'Patrones' },
        { key: 'API_KEY', type: 'string', secret: true, label: 'Clave', required: true },
    ],
});

const baseConfig = () => ({
    values: { mode: 'warn' },
    sources: { keywords: 'server-env', detectors: 'default', mode: 'domain', strict: 'default', limit: 'unset', customPatterns: 'unset' },
    envLegacy: ['keywords'],
    importable: ['keywords'],
    secrets: [{ name: 'API_KEY', configured: false, source: 'missing' }],
    checklist: { done: 1, total: 2, items: [{ key: 'mode', secret: false, ok: true }, { key: 'API_KEY', secret: true, ok: false }] },
    meta: { updatedAt: '2026-01-02T03:04:05Z', updatedBy: 'm1' },
    limits: { maxConfigBytes: 32768 },
});
let config: any;
let putStatus = 200;
let putBody: any = null;

const row = (over: Partial<ExtensionRow> = {}): ExtensionRow => ({
    id: 'core-dlp', name: 'DLP', description: '', icon: null, version: '1', installedVersion: '1', updateAvailable: false, status: 'enabled', installed: true, enabled: true,
    isPaid: false, price: '0', currency: 'USD', authType: null, category: 'security', template: { settingsSchema: schema }, order: 0, hasCredentials: false, mandatory: false,
    mandatoryByManifest: false, hasErrors: false, manifestValid: true, manifestProblems: [], hasCredentialKeys: true, inCatalog: true, ...over,
} as unknown as ExtensionRow);

function mount(props: Partial<React.ComponentProps<typeof SettingsForm>> = {}, r: ExtensionRow = row()) {
    act(() => {
        root.render(
            React.createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } },
                React.createElement(I18nProvider, { locale: 'es', children: React.createElement(SettingsForm, { row: r, domainId: 'dom1', readOnly: false, onGoCredentials: () => undefined, ...props }) })),
        );
    });
}

const q = <T extends Element = HTMLElement>(sel: string) => container.querySelector<T>(sel);
const byText = (sel: string, text: string) => Array.from(container.querySelectorAll<HTMLElement>(sel)).find((e) => (e.textContent || '').includes(text));
function type(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    act(() => {
        Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
        el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    });
}

beforeEach(() => {
    calls.length = 0;
    config = baseConfig();
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
            if (body.reset) config = { ...baseConfig(), values: {}, sources: { ...baseConfig().sources, mode: 'default' }, envLegacy: [], importable: [] };
            else config = { ...config, values: { ...config.values, ...Object.fromEntries(Object.entries(body.values).filter(([, v]) => v !== null)) } };
            return res(200, { success: true, ...config });
        }
        config = { ...config, sources: { ...config.sources, keywords: 'domain' }, envLegacy: [], importable: [] };
        return res(200, { success: true, imported: ['keywords'], ...config });
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

describe('SettingsForm', () => {
    it('renderiza campos por tipo, grupos, obligatorio, secretos como nota y la vista previa DLP', async () => {
        mount();
        await flush();
        expect(q('[data-testid="settings-form"]')).toBeTruthy();
        expect(byText('h4', 'Contenido')).toBeTruthy();
        expect(q('select')).toBeTruthy();
        expect(q('[role="switch"]')).toBeTruthy();
        expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(2);
        expect(container.textContent).toContain('Luhn');
        expect(container.textContent).toContain('4111');
        expect(container.textContent).toContain('0 de 1 secretos configurados');
        expect(container.querySelector('input[type="text"]')).toBeNull(); // el secreto no tiene input
        expect(byText('h3', 'Probar con texto de ejemplo')).toBeTruthy();
        expect(container.textContent).toContain('2026');
    });

    it('avisa de variable heredada y ofrece importar solo si hay importable', async () => {
        mount();
        await flush();
        expect(q('[data-testid="legacy-keywords"]')).toBeTruthy();
        expect(q('[data-testid="legacy-global"]')).toBeTruthy();
        const btn = byText('button', 'Importar desde el entorno')!;
        expect(btn).toBeTruthy();
        expect(container.textContent).toContain('los secretos no se tocan');
        await act(async () => { btn.click(); });
        await flush();
        const post = calls.find((c) => c.method === 'POST')!;
        expect(post.body).toMatchObject({ domainId: 'dom1', extensionId: 'core-dlp', action: 'import-env' });
        expect(q('[data-testid="legacy-global"]')).toBeNull();
    });

    it('sin importable no hay boton de importar', async () => {
        config = { ...baseConfig(), importable: [] };
        mount();
        await flush();
        expect(byText('button', 'Importar desde el entorno')).toBeUndefined();
        expect(q('[data-testid="legacy-global"]')).toBeTruthy();
    });

    it('Guardar esta deshabilitado sin cambios, valida en vivo y envia solo el diff', async () => {
        mount();
        await flush();
        const save = byText('button', 'Guardar') as HTMLButtonElement;
        expect(save.disabled).toBe(true);
        const limit = q<HTMLInputElement>('input[type="number"]')!;
        type(limit, '99');
        expect(limit.getAttribute('aria-invalid')).toBe('true');
        expect(limit.getAttribute('aria-describedby')).toBe(`${limit.id}-err`);
        expect((byText('button', 'Guardar') as HTMLButtonElement).disabled).toBe(true);
        type(limit, '5');
        expect(limit.getAttribute('aria-invalid')).toBeNull();
        expect((byText('button', 'Guardar') as HTMLButtonElement).disabled).toBe(false);
        await act(async () => { (byText('button', 'Guardar') as HTMLButtonElement).click(); });
        await flush();
        const put = calls.find((c) => c.method === 'PUT')!;
        expect(put.body).toEqual({ domainId: 'dom1', extensionId: 'core-dlp', values: { limit: 5 } });
        expect(q('[role="status"]')!.textContent).toContain('Ajustes guardados');
    });

    it('mapea el 422 del servidor al campo por ruta', async () => {
        mount();
        await flush();
        putStatus = 422;
        putBody = { error: 'Invalid', errors: [{ path: 'values.limit', message: 'Maximo desde servidor' }] };
        type(q<HTMLInputElement>('input[type="number"]')!, '3');
        await act(async () => { (byText('button', 'Guardar') as HTMLButtonElement).click(); });
        await flush();
        const limit = q<HTMLInputElement>('input[type="number"]')!;
        expect(limit.getAttribute('aria-invalid')).toBe('true');
        expect(container.textContent).toContain('Maximo desde servidor');
    });

    it('Restablecer pide confirmacion y envia reset', async () => {
        mount();
        await flush();
        await act(async () => { byText('button', 'Restablecer a valores por defecto')!.click(); });
        expect(document.body.textContent).toContain('¿Restablecer los ajustes?');
        expect(calls.some((c) => c.method === 'PUT')).toBe(false);
        const confirm = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] button')).find((b) => b.textContent === 'Restablecer')!;
        await act(async () => { confirm.click(); });
        await flush();
        expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ domainId: 'dom1', extensionId: 'core-dlp', reset: true });
    });

    it('solo lectura: controles deshabilitados, explicacion y sin importar/restablecer', async () => {
        mount({ readOnly: true });
        await flush();
        expect(container.textContent).toContain('Solo lectura');
        expect(q<HTMLInputElement>('input[type="number"]')!.disabled).toBe(true);
        expect(byText('button', 'Importar desde el entorno')).toBeUndefined();
        expect(byText('button', 'Restablecer a valores por defecto')).toBeUndefined();
        expect((byText('button', 'Guardar') as HTMLButtonElement).disabled).toBe(true);
    });

    it('no instalada: no consulta el backend y lo explica', async () => {
        mount({}, row({ installed: false, status: 'available' }));
        await flush();
        expect(calls.length).toBe(0);
        expect(container.textContent).toContain('no está instalada');
    });

    it('la vista previa DLP usa el formulario sin guardar y no repite el dato', async () => {
        mount();
        await flush();
        const custom = Array.from(container.querySelectorAll<HTMLTextAreaElement>('textarea')).find((t) => t.id.endsWith('customPatterns'))!;
        type(custom, 'zzz-\\d+');
        const sample = Array.from(container.querySelectorAll<HTMLTextAreaElement>('textarea')).find((t) => t.id.endsWith('-text'))!;
        type(sample, 'pedido zzz-98765 y tarjeta 4111 1111 1111 1111');
        await act(async () => { byText('button', 'Probar')!.click(); });
        const text = container.textContent || '';
        expect(text).toContain('Tarjeta de crédito');
        expect(text).toContain('Patrón propio (1)');
        expect(text).toContain('no se envía a ningún sitio');
        expect(calls.every((c) => c.method === 'GET')).toBe(true);
        const status = Array.from(container.querySelectorAll('[role="status"]')).map((e) => e.textContent).join(' ');
        expect(status).not.toContain('98765');
    });
});
