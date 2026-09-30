// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SpamListEditor, type SpamListEditorProps } from '@/components/spam/SpamListEditor';
import { button, calls, click, dialog, fetchMock, flush, mountRoot, render, routeFetch, setValue, textOf, unmountRoot } from '../profile/__tests__/test-utils';
import { LIST_ROWS, q, qa, setSelect, wait } from './spam-fixtures';

let rows: ReturnType<typeof LIST_ROWS>;
let addResult: any;
let importResult: any;

const H = (kind: string, base = '/api/admin/spam/lists') => ({
    [`GET ${base}/${kind}`]: () => ({ body: { rows, total: rows.length, limit: kind === 'external' ? 2000 : 10000 } }),
    [`POST ${base}/${kind}`]: () => ({ body: addResult }),
    [`DELETE ${base}/${kind}`]: (init: any) => {
        const b = JSON.parse(init.body);
        const n = 'all' in b ? rows.length : b.ids.length;
        rows = 'all' in b ? [] : rows.filter((r) => !b.ids.includes(r.id));
        return { body: { deleted: n } };
    },
    [`POST ${base}/${kind}/import`]: () => ({ body: importResult }),
});

async function mount(props: Partial<SpamListEditorProps> = {}, locale: 'es' | 'en' = 'es') {
    await render(React.createElement(SpamListEditor, { apiBase: '/api/admin/spam/lists', kind: 'block', variant: 'admin', ...props }), locale);
}
const field = (id: string) => q<HTMLInputElement>(`#spam-list-block-${id}`)!;

beforeEach(() => {
    rows = LIST_ROWS();
    addResult = { added: 1, duplicates: 0, invalid: [], limitReached: false };
    importResult = { added: 1, duplicates: 0, invalid: [], errors: [], limitReached: false, lines: 1 };
    routeFetch(H('block') as any);
    mountRoot();
});
afterEach(async () => {
    await unmountRoot();
    vi.unstubAllGlobals();
});

describe('SpamListEditor (admin)', () => {
    it('tabla accesible con las columnas pedidas, contador "N de 10 000" y guardas explicadas', async () => {
        await mount();
        const heads = qa('thead th').map((h) => h.textContent);
        for (const c of ['Valor', 'Tipo', 'Subdominios', 'Motivo', 'Caduca', 'Aciertos', 'Último acierto', 'Creada por']) expect(heads).toContain(c);
        expect(q('caption')?.textContent).toBe('Lista de remitentes bloqueados');
        expect(qa('thead th[scope="col"]').length).toBeGreaterThan(8);
        expect(q('#spam-list-block-counter')!.textContent).toBe('2 de 10.000');
        expect(q('#spam-list-block-counter')!.getAttribute('aria-live')).toBe('polite');
        const t = textOf();
        expect(t).toContain('spam.test');
        expect(t).toContain('Caducada'); // la fila caducada se marca con texto, no solo color
        expect(t).toContain('no se puede bloquear el dominio propio');
        expect(t).toContain('administradores');
        expect(t).toContain('nunca rechaza');
    });

    it('permitidos: explica que NO elude suplantacion ni malware; externos: sin regex', async () => {
        routeFetch({ ...H('allow'), ...H('external') } as any);
        await mount({ kind: 'allow', idPrefix: 'a' });
        expect(textOf()).toContain('NO elude la detección de suplantación ni de adjuntos peligrosos');
        await unmountRoot();
        mountRoot();
        await mount({ kind: 'external', idPrefix: 'e' });
        expect(q('#e-type option[value="regex"]')).toBeNull();
        expect(q('#e-counter')!.textContent).toBe('2 de 2000');
    });

    it('alta: envia tipo, valor, subdominios, motivo y caducidad; confirma y refresca', async () => {
        await mount();
        await setValue(field('value'), ' Nuevo.Test ');
        await click(field('sub'));
        await setValue(field('reason'), 'phishing');
        await setValue(field('expires'), '2099-01-01T10:00');
        await click(button('Añadir'));
        await flush();
        const post = calls.find((c) => c.method === 'POST')!;
        expect(post.path).toBe('/api/admin/spam/lists/block');
        expect(post.body.entries).toHaveLength(1);
        expect(post.body.entries[0]).toMatchObject({ matchType: 'domain', value: 'Nuevo.Test', includeSubdomains: true, reason: 'phishing' });
        expect(new Date(post.body.entries[0].expiresAt).getTime()).toBe(new Date('2099-01-01T10:00').getTime());
        expect(textOf()).toContain('1 entrada(s) añadida(s)');
        expect(field('value').value).toBe('');
        expect(calls.filter((c) => c.method === 'GET').length).toBeGreaterThanOrEqual(2); // refresco
    });

    it('cambiar el tipo cambia el ejemplo y oculta "subdominios" para email', async () => {
        await mount();
        expect(field('value').placeholder).toBe('ejemplo.com');
        await setSelect(field('type') as unknown as HTMLSelectElement, 'wildcard');
        expect(field('value').placeholder).toBe('*@ejemplo.com');
        expect(field('sub')).toBeTruthy();
        await setSelect(field('type') as unknown as HTMLSelectElement, 'email');
        expect(field('sub')).toBeNull();
    });

    it('errores de validacion localizados, asociados al campo (aria-invalid / alert)', async () => {
        addResult = { added: 0, duplicates: 0, invalid: [{ index: 0, error: 'protected_own_domain' }], limitReached: false };
        await mount();
        await setValue(field('value'), 'corp.test');
        await click(button('Añadir'));
        await flush();
        const err = q('#spam-list-block-value-err')!;
        expect(err.getAttribute('role')).toBe('alert');
        expect(err.textContent).toBe('No se puede bloquear el dominio propio.');
        expect(field('value').getAttribute('aria-invalid')).toBe('true');
        expect(field('value').getAttribute('aria-describedby')).toBe('spam-list-block-value-err');
        for (const [code, text] of [['protected_admin', 'administrador'], ['invalid_domain', 'Dominio no válido'], ['unsafe_regex', 'no segura'], ['expiry_in_past', 'futuro'], ['regex_not_allowed', 'regulares']]) {
            addResult = { added: 0, duplicates: 0, invalid: [{ index: 0, error: code }], limitReached: false };
            await click(button('Añadir'));
            await flush();
            expect(q('#spam-list-block-value-err')!.textContent).toContain(text);
        }
        await setValue(field('value'), 'otro.test');
        expect(q('#spam-list-block-value-err')).toBeNull(); // se limpia al editar
    });

    it('duplicado y tope alcanzado se anuncian; boton deshabilitado sin valor', async () => {
        await mount();
        expect(button('Añadir')!.disabled).toBe(true);
        addResult = { added: 0, duplicates: 1, invalid: [], limitReached: false };
        await setValue(field('value'), 'spam.test');
        await click(button('Añadir'));
        await flush();
        expect(textOf()).toContain('Ya estaba en la lista');
        addResult = { added: 0, duplicates: 0, invalid: [], limitReached: true };
        await click(button('Añadir'));
        await flush();
        expect(q('[role="alert"]')?.textContent).toContain('tope');
    });

    it('borrar una fila pide confirmacion (foco en Cancelar) y envia los ids', async () => {
        await mount();
        await click(button('Eliminar spam.test'));
        const d = dialog()!;
        expect(d.textContent).toContain('«spam.test»');
        expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
        await click(button('Eliminar', d));
        await flush();
        const del = calls.find((c) => c.method === 'DELETE')!;
        expect(del.body).toEqual({ ids: ['a'] });
        expect(textOf()).toContain('1 entrada(s) eliminada(s)');
        expect(dialog()).toBeNull();
    });

    it('cancelar con Escape no borra', async () => {
        await mount();
        await click(button('Eliminar spam.test'));
        await act_keydown(dialog()!, 'Escape');
        await wait(600);
        expect(dialog()).toBeNull();
        expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
    });

    it('seleccion multiple: borra varios', async () => {
        await mount();
        const boxes = qa<HTMLInputElement>('tbody input[type="checkbox"]');
        await click(boxes[0]);
        await click(boxes[1]);
        await click(button('Eliminar seleccionadas (2)'));
        expect(dialog()!.textContent).toContain('2 entrada(s)');
        await click(button('Eliminar', dialog()!));
        await flush();
        expect(calls.find((c) => c.method === 'DELETE')!.body).toEqual({ ids: ['a', 'b'] });
    });

    it('borrar todo exige escribir la frase (StrongConfirmDialog) y manda all+confirm', async () => {
        await mount();
        await click(button('Borrar todo'));
        const d = dialog()!;
        const confirmBtn = button('Borrar todo', d)!;
        expect(confirmBtn.disabled).toBe(true);
        expect(d.textContent).toContain('2 entradas');
        await setValue(d.querySelector('input'), 'BORRAR');
        expect(confirmBtn.disabled).toBe(false);
        await click(confirmBtn);
        await flush();
        expect(calls.find((c) => c.method === 'DELETE')!.body).toEqual({ all: true, confirm: true });
        expect(textOf()).toContain('Lista vaciada (2 entradas)');
        expect(textOf()).toContain('Todavía no hay entradas');
    });

    it('busqueda con debounce, filtro por tipo/estado y orden van en la URL; paginacion visible', async () => {
        await mount();
        await setValue(q<HTMLInputElement>('input[type="search"]'), 'spam');
        expect(calls.filter((c) => c.method === 'GET' && c.search.includes('q=spam'))).toHaveLength(0);
        await wait(450);
        const labelSel = (text: string) => {
            const l = qa<HTMLLabelElement>('label').filter((x) => (x.textContent || '').trim() === text).pop()!; // el filtro va despues del formulario
            return document.getElementById(l.htmlFor) as HTMLSelectElement;
        };
        await setSelect(labelSel('Tipo'), 'domain'); // hay dos "Tipo": formulario y filtro; el filtro es el ultimo
        await setSelect(labelSel('Estado'), 'expired');
        await setSelect(labelSel('Ordenar por'), 'hits');
        await wait(10);
        const p = new URLSearchParams(calls.filter((c) => c.method === 'GET').pop()!.search);
        expect(p.get('q')).toBe('spam');
        expect(p.get('status')).toBe('expired');
        expect(p.get('sort')).toBe('hits');
        expect(q('nav[aria-label="Paginación"]')).toBeTruthy();
    });

    it('importar CSV: envia el texto y muestra el informe con errores por linea', async () => {
        importResult = { added: 2, duplicates: 1, invalid: [], errors: [{ line: 3, error: 'invalid_domain' }, { line: 5, error: 'protected_admin' }], limitReached: false, lines: 6 };
        await mount();
        await click(button('Importar'));
        expect(textOf()).toContain('Pega un CSV');
        await setValue(q<HTMLTextAreaElement>('#spam-list-block-csv'), 'domain,a.test\nmal');
        await click(button('Importar'));
        await flush();
        const post = calls.find((c) => c.path.endsWith('/import'))!;
        expect(post.body).toEqual({ csv: 'domain,a.test\nmal' });
        const status = qa('[role="status"]').map((e) => e.textContent).join(' ');
        expect(status).toContain('Importadas: 2. Repetidas: 1. Filas leídas: 6. Con error: 2.');
        const rowsTxt = qa('table').find((t) => t.querySelector('caption')?.textContent === 'Errores de importación por línea')!;
        expect(rowsTxt.querySelectorAll('tbody tr')).toHaveLength(2);
        expect(rowsTxt.textContent).toContain('Dominio no válido');
        expect(rowsTxt.textContent).toContain('administrador');
        expect(rowsTxt.querySelector('tbody th[scope="row"]')?.textContent).toBe('3');
    });

    it('importar desde archivo: lo carga en el area de texto y rechaza > 2 MB', async () => {
        await mount();
        const input = q<HTMLInputElement>('#spam-list-block-csvfile')!;
        const big = new File(['x'], 'grande.csv', { type: 'text/csv' });
        Object.defineProperty(big, 'size', { value: 3 * 1024 * 1024 });
        Object.defineProperty(input, 'files', { value: [big], configurable: true });
        await act_change(input);
        expect(q('#spam-list-block-csvfile-err')?.textContent).toContain('2 MB');
        const ok = new File(['domain,b.test'], 'lista.csv', { type: 'text/csv' });
        Object.defineProperty(input, 'files', { value: [ok], configurable: true });
        await act_change(input);
        await wait(50);
        expect(q<HTMLTextAreaElement>('#spam-list-block-csv')!.value).toBe('domain,b.test');
    });

    it('exportar CSV descarga desde /export', async () => {
        const base = fetchMock.getMockImplementation()!;
        fetchMock.mockImplementation(async (u: string, i?: any) => (String(u).includes('/export')
            ? { ok: true, status: 200, blob: async () => new Blob(['type,value']), headers: { get: () => 'attachment; filename="spam-block.csv"' } }
            : base(u, i)));
        const create = vi.fn(() => 'blob:x');
        Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
        await mount();
        await click(button('Exportar CSV'));
        await flush();
        expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/api/admin/spam/lists/block/export')).toBe(true);
        expect(create).toHaveBeenCalled();
    });

    it('error de carga: alerta con Reintentar', async () => {
        routeFetch({ 'GET /api/admin/spam/lists/block': () => ({ status: 500, body: {} }) } as any);
        await mount();
        expect(q('[role="alert"]')?.textContent).toContain('No se pudo cargar la lista');
        expect(button('Reintentar')).toBeTruthy();
    });

    it('en ingles usa las claves de spam.lists', async () => {
        await mount({}, 'en');
        expect(q('caption')?.textContent).toBe('List of blocked senders');
        expect(textOf()).toContain('2 of 10,000');
        expect(textOf()).toContain('never rejects');
    });
});

describe('SpamListEditor (variante user)', () => {
    const USER = { apiBase: '/api/spam/lists', variant: 'user' as const, idPrefix: 'u' };

    it('usa su apiBase, no muestra "Creada por" ni importacion y exporta con ?format=csv', async () => {
        routeFetch(H('block', '/api/spam/lists') as any);
        const base = fetchMock.getMockImplementation()!;
        fetchMock.mockImplementation(async (u: string, i?: any) => (String(u).includes('format=csv')
            ? { ok: true, status: 200, blob: async () => new Blob(['type,value']), headers: { get: () => null } }
            : base(u, i)));
        Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
        await mount(USER);
        expect(qa('thead th').map((h) => h.textContent)).not.toContain('Creada por');
        expect(textOf()).not.toContain('Importar CSV');
        expect(q('#u-csv')).toBeNull();
        expect(textOf()).toContain('Protección: no se puede bloquear el dominio propio');
        expect(textOf()).not.toContain('administradores');
        expect(calls.every((c) => c.path.startsWith('/api/spam/lists'))).toBe(true);
        await click(button('Exportar CSV'));
        await flush();
        expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/api/spam/lists/block?format=csv')).toBe(true);
    });

    it('alta y borrado funcionan contra la API del usuario', async () => {
        routeFetch(H('block', '/api/spam/lists') as any);
        await mount(USER);
        await setValue(q<HTMLInputElement>('#u-value'), 'x.test');
        await click(button('Añadir'));
        await flush();
        expect(calls.find((c) => c.method === 'POST')!.path).toBe('/api/spam/lists/block');
        await click(button('Eliminar spam.test'));
        await click(button('Eliminar', dialog()!));
        await flush();
        expect(calls.find((c) => c.method === 'DELETE')!.path).toBe('/api/spam/lists/block');
    });
});

import { act } from 'react';
async function act_keydown(el: Element, key: string) {
    await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });
}
async function act_change(el: Element) {
    await act(async () => { el.dispatchEvent(new Event('change', { bubbles: true })); });
}
