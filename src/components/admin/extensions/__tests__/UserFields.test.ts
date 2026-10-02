// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserMapEditor, UserSelect } from '../UserFields';
import { I18nProvider } from '@/components/I18nProvider';
import { normalizeSettingsSchema } from '@/lib/expansions/settings-schema';
import type { UserMapValue } from '@/lib/admin/extensions-config';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const json = (body: any) => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) });

const DIR = [
    { id: 'u1', email: 'ana@a.test', name: 'Ana', disabled: false, level: 0, levelName: 'user' },
    { id: 'u2', email: 'bob@a.test', name: 'Bob', disabled: true, level: 0, levelName: 'user' },
    { id: 'u3', email: 'cris@a.test', name: null, disabled: false, level: 3, levelName: 'admin' },
];
const urls: string[] = [];

beforeEach(() => {
    urls.length = 0;
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
        urls.push(String(url));
        const u = new URL(String(url), 'https://f.test');
        const ids = u.searchParams.get('ids');
        if (ids !== null) {
            const list = ids.split(',').filter(Boolean);
            return json({ users: DIR.filter((d) => list.includes(d.id)), missing: list.filter((id) => !DIR.some((d) => d.id === id)) });
        }
        const q = (u.searchParams.get('q') || '').toLowerCase();
        const users = DIR.filter((d) => !q || d.email.includes(q) || (d.name ?? '').toLowerCase().includes(q));
        return json({ users, total: users.length, page: 0, limit: 10, hasMore: false });
    });
    vi.stubGlobal('fetch', fetchMock);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});

const schema = normalizeSettingsSchema({
    fields: [
        { key: 'owner', type: 'user', label: 'Owner' },
        { key: 'team', type: 'users', label: 'Team', maxItems: 2 },
        { key: 'digest', type: 'userMap', valueType: 'boolean', default: false, label: 'Digest' },
        { key: 'quota', type: 'userMap', valueType: 'number', min: 1, max: 9, integer: true, label: 'Quota' },
    ],
});
const field = (k: string) => schema.fields.find((f) => f.key === k)!;

async function render(node: React.ReactElement, locale: 'es' | 'en' = 'es') {
    await act(async () => { root.render(React.createElement(I18nProvider, { locale, children: node })); });
    await flush();
}
const click = async (el: Element | null | undefined) => {
    if (!el) throw new Error('elemento no encontrado');
    await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();
};
const type = async (el: HTMLInputElement, value: string) => {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
};
const btn = (text: string) => Array.from(document.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') || b.textContent || '').includes(text)) as HTMLButtonElement | undefined;

describe('UserSelect (user / users)', () => {
    function Harness({ multi, initial }: { multi: boolean; initial: string | string[] }) {
        const [value, setValue] = useState<string | string[]>(initial);
        return React.createElement('div', null,
            React.createElement(UserSelect, { field: field(multi ? 'team' : 'owner'), multi, value, onChange: setValue, editable: true, inputId: 'x' }),
            React.createElement('output', { 'data-testid': 'value' }, JSON.stringify(value)));
    }

    it('resuelve ids guardados a nombre/correo y marca los que ya no existen como "Usuario eliminado"', async () => {
        await render(React.createElement(Harness, { multi: true, initial: ['u1', 'gone'] }));
        expect(urls.some((u) => u.includes('ids=u1%2Cgone'))).toBe(true);
        expect(document.querySelector('[data-testid="user-chip-u1"]')!.textContent).toContain('Ana (ana@a.test)');
        expect(document.querySelector('[data-testid="user-chip-gone"]')!.textContent).toContain('Usuario eliminado');
    });

    it('busca de forma asincrona contra el directorio, no deja elegir desactivados y guarda el ID (no el correo)', async () => {
        await render(React.createElement(Harness, { multi: false, initial: '' }));
        const input = document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
        await act(async () => { input.focus(); input.dispatchEvent(new FocusEvent('focus', { bubbles: true })); });
        await type(input, 'b');
        expect(urls.some((u) => u.includes('q=b'))).toBe(true);
        const bob = Array.from(document.querySelectorAll('[role="option"] button')).find((b) => b.textContent!.includes('Bob')) as HTMLButtonElement;
        expect(bob.disabled).toBe(true);
        expect(bob.textContent).toContain('Desactivado');
        await type(input, 'ana');
        await click(Array.from(document.querySelectorAll('[role="option"] button')).find((b) => b.textContent!.includes('Ana')));
        expect(document.querySelector('[data-testid="value"]')!.textContent).toBe('"u1"');
        expect(document.querySelector('[data-testid="value"]')!.textContent).not.toContain('@');
    });

    it('users: respeta maxItems (oculta el buscador), permite quitar y muestra el contador', async () => {
        await render(React.createElement(Harness, { multi: true, initial: ['u1', 'u3'] }));
        expect(document.querySelector('input[role="combobox"]')).toBeNull();
        expect(document.body.textContent).toContain('2 de 2 usuarios');
        await click(btn('Quitar a Ana'));
        expect(document.querySelector('[data-testid="value"]')!.textContent).toBe('["u3"]');
        expect(document.querySelector('input[role="combobox"]')).not.toBeNull();
    });
});

describe('UserMapEditor (userMap)', () => {
    function Harness({ fieldKey, initial }: { fieldKey: 'digest' | 'quota'; initial: UserMapValue }) {
        const [value, setValue] = useState<UserMapValue>(initial);
        return React.createElement('div', null,
            React.createElement(UserMapEditor, { field: field(fieldKey), value, onChange: setValue, editable: true, inputId: 'm' }),
            React.createElement('output', { 'data-testid': 'value' }, JSON.stringify(value)));
    }
    const out = () => JSON.parse(document.querySelector('[data-testid="value"]')!.textContent!);

    it('muestra la tabla con un interruptor por usuario, el valor por defecto y marca eliminados/desactivados', async () => {
        await render(React.createElement(Harness, { fieldKey: 'digest', initial: { u1: true, u2: false, gone: true } }));
        expect(document.body.textContent).toContain('Quien no tenga entrada usa: no');
        expect(document.querySelector('[data-testid="usermap-row-u1"] [role="switch"]')!.getAttribute('aria-checked')).toBe('true');
        expect(document.querySelector('[data-testid="usermap-row-u2"]')!.textContent).toContain('Desactivado');
        expect(document.querySelector('[data-testid="usermap-row-gone"]')!.textContent).toContain('Usuario eliminado');
        await click(document.querySelector('[data-testid="usermap-row-u1"] [role="switch"]'));
        expect(out()).toEqual({ u1: false, u2: false, gone: true });
    });

    it('anadir usuario, quitar, ajuste masivo (todos si/no) y limpiar eliminados', async () => {
        await render(React.createElement(Harness, { fieldKey: 'digest', initial: { u1: true, gone: false } }));
        const input = document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
        await act(async () => { input.dispatchEvent(new FocusEvent('focus', { bubbles: true })); });
        await type(input, 'cris');
        await click(Array.from(document.querySelectorAll('[role="option"] button')).find((b) => b.textContent!.includes('cris@a.test')));
        expect(Object.keys(out()).sort()).toEqual(['gone', 'u1', 'u3']);
        expect(out().u3).toBe(true); // el valor inicial de un boolean es lo contrario del default (false)
        await click(btn('Todos: no'));
        expect(out()).toEqual({ u1: false, gone: false, u3: false });
        await click(btn('Todos: sí'));
        expect(Object.values(out()).every((v) => v === true)).toBe(true);
        await click(btn('Quitar eliminados (1)'));
        expect(Object.keys(out()).sort()).toEqual(['u1', 'u3']);
        await click(btn('Quitar a Ana'));
        expect(Object.keys(out())).toEqual(['u3']);
    });

    it('"Anadir a todos": pagina el directorio, omite desactivados y respeta el tope', async () => {
        await render(React.createElement(Harness, { fieldKey: 'digest', initial: {} }));
        await click(btn('Añadir a todos'));
        expect(out()).toEqual({ u1: true, u3: true });
        expect(document.body.textContent).toContain('2 usuarios con entrada');
    });

    it('valor numerico por usuario: entrada con min/max y sin botones masivos de boolean', async () => {
        await render(React.createElement(Harness, { fieldKey: 'quota', initial: { u1: '3' } }));
        const input = document.querySelector<HTMLInputElement>('[data-testid="usermap-row-u1"] input[type="number"]')!;
        expect(input.min).toBe('1');
        expect(input.max).toBe('9');
        await type(input, '7');
        expect(out()).toEqual({ u1: '7' });
        expect(btn('Todos: sí')).toBeUndefined();
    });

    it('en ingles y de solo lectura no hay acciones de edicion', async () => {
        function RO() {
            return React.createElement(UserMapEditor, { field: field('digest'), value: { u1: true }, onChange: () => undefined, editable: false, inputId: 'm' });
        }
        await render(React.createElement(RO), 'en');
        expect(document.querySelector('input[role="combobox"]')).toBeNull();
        expect(document.querySelector('[data-testid="usermap-row-u1"] [role="switch"]')!.hasAttribute('disabled')).toBe(true);
        expect(btn('Remove')).toBeUndefined();
        expect(document.body.textContent).toContain('Anyone without an entry uses: no');
    });
});
