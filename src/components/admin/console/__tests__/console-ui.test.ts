// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
let pathname = '/admin/users';
vi.mock('next/navigation', () => ({
    usePathname: () => pathname,
    useRouter: () => ({ push, replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
    default: ({ href, children, ...rest }: any) => React.createElement('a', { href, ...rest }, children),
}));
vi.mock('@/hooks/useDomainConfig', () => ({
    useDomainConfig: () => ({
        config: { id: 'dom1', name: 'mail.acme.test', displayName: 'Acme Mail', logo: null },
        extensions: [{ id: 'core-notion', name: 'Notion' }],
        isLoading: false,
    }),
}));

import { I18nProvider } from '@/components/I18nProvider';
import { DataTable, type Column } from '../DataTable';
import { Pagination } from '../Pagination';
import { StrongConfirmDialog } from '../StrongConfirmDialog';
import { DetailDrawer } from '../DetailDrawer';
import { ConsoleShell } from '../ConsoleShell';
import { useUnsavedChanges } from '../ConsoleContext';
import { NAV_GROUP_ORDER, NAV_ITEMS } from '../nav';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const h = React.createElement;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const json = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });

async function mount(node: React.ReactElement, locale: 'es' | 'en' = 'es') {
    await act(async () => {
        root.render(h(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, h(I18nProvider, { locale, children: node })));
    });
    await flush();
}
const click = async (el: Element | null | undefined) => {
    if (!el) throw new Error('elemento no encontrado');
    await act(async () => { (el as HTMLElement).click(); });
    await flush();
};
const key = async (target: Element, k: string, init: KeyboardEventInit = {}) => {
    await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })); });
};
const setValue = async (el: HTMLInputElement, value: string) => {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    });
};
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
/** Espera (con tope) a que se cumpla una condicion, dejando correr timers/animaciones: evita depender de una espera fija. */
const waitUntil = async (cond: () => boolean, ms = 3000) => {
    const end = Date.now() + ms;
    while (!cond() && Date.now() < end) await flush();
};

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    push.mockReset();
    pathname = '/admin/users';
    window.localStorage.clear();
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    document.body.style.overflow = '';
});

interface Row { id: string; name: string; email: string }
const rows: Row[] = [
    { id: 'a', name: 'Ana', email: 'ana@x.com' },
    { id: 'b', name: 'Beto', email: 'beto@x.com' },
];
const columns = (onOpen = vi.fn()): Column<Row>[] => [
    { id: 'name', header: 'Nombre', sortable: true, isRowHeader: true, cell: (r) => h('button', { type: 'button', onClick: () => onOpen(r) }, r.name) },
    { id: 'email', header: 'Correo', sortable: true, hideBelow: 'sm', cell: (r) => r.email },
];

describe('DataTable', () => {
    it('es una tabla accesible: caption, th scope=col, aria-sort y cabecera de fila', async () => {
        await mount(h(DataTable<Row>, { caption: 'Usuarios', columns: columns(), rows, getRowId: (r) => r.id, sort: { id: 'name', dir: 'asc' }, onSortChange: vi.fn() }));
        expect(q('caption')!.textContent).toBe('Usuarios');
        const ths = Array.from(document.querySelectorAll('thead th'));
        expect(ths.every((t) => t.getAttribute('scope') === 'col')).toBe(true);
        expect(ths[0].getAttribute('aria-sort')).toBe('ascending');
        expect(ths[1].getAttribute('aria-sort')).toBe('none');
        expect(document.querySelectorAll('tbody th[scope="row"]').length).toBe(2);
        // columna secundaria oculta en movil pero presente en escritorio
        expect(ths[1].className).toContain('hidden');
    });

    it('ordenar: el boton del encabezado alterna asc/desc y anuncia el estado', async () => {
        const onSortChange = vi.fn();
        await mount(h(DataTable<Row>, { caption: 'U', columns: columns(), rows, getRowId: (r) => r.id, sort: { id: 'name', dir: 'asc' }, onSortChange }));
        const btnName = Array.from(document.querySelectorAll('thead button')).find((b) => b.getAttribute('aria-label')!.includes('Nombre'))!;
        expect(btnName.getAttribute('aria-label')).toContain('orden ascendente');
        await click(btnName);
        expect(onSortChange).toHaveBeenLastCalledWith({ id: 'name', dir: 'desc' });
        const btnMail = Array.from(document.querySelectorAll('thead button')).find((b) => b.getAttribute('aria-label')!.includes('Correo'))!;
        await click(btnMail);
        expect(onSortChange).toHaveBeenLastCalledWith({ id: 'email', dir: 'asc' });
    });

    it('seleccion masiva: casilla "todas" (estado mixto), casillas por fila con nombre accesible', async () => {
        function Host() {
            const [sel, setSel] = useState<string[]>([]);
            return h(DataTable<Row>, { caption: 'U', columns: columns(), rows, getRowId: (r) => r.id, selectable: true, selected: sel, onSelectedChange: setSel, rowLabel: (r) => r.email });
        }
        await mount(h(Host));
        const head = q<HTMLInputElement>('thead input[type="checkbox"]')!;
        expect(head.getAttribute('aria-label')).toBe('Seleccionar todas las filas de esta página');
        const first = document.querySelector<HTMLInputElement>('input[aria-label="Seleccionar ana@x.com"]')!;
        await click(first);
        expect(first.checked).toBe(true);
        expect(head.indeterminate).toBe(true);
        expect(document.querySelector('tbody tr')!.getAttribute('aria-selected')).toBe('true');
        await click(head);
        expect(Array.from(document.querySelectorAll<HTMLInputElement>('tbody input')).every((i) => i.checked)).toBe(true);
        expect(head.indeterminate).toBe(false);
        await click(head);
        expect(Array.from(document.querySelectorAll<HTMLInputElement>('tbody input')).some((i) => i.checked)).toBe(false);
    });

    it('abrir detalle: el boton de la celda principal es enfocable y activa; clic en la fila tambien, pero no roba los controles', async () => {
        const onOpen = vi.fn();
        const onRowActivate = vi.fn();
        await mount(h(DataTable<Row>, { caption: 'U', columns: columns(onOpen), rows, getRowId: (r) => r.id, onRowActivate }));
        const btn = document.querySelector<HTMLButtonElement>('tbody button')!;
        btn.focus();
        expect(document.activeElement).toBe(btn);
        await click(btn);
        expect(onOpen).toHaveBeenCalledTimes(1);
        expect(onRowActivate).not.toHaveBeenCalled(); // el clic en un boton no dispara la fila
        await click(document.querySelectorAll('tbody td')[0]);
        expect(onRowActivate).toHaveBeenCalledWith(rows[0]);
    });

    it('estados: vacio con mensaje y cargando con role=status', async () => {
        await mount(h(DataTable<Row>, { caption: 'U', columns: columns(), rows: [], getRowId: (r) => r.id }));
        expect(document.body.textContent).toContain('Sin resultados');
        await mount(h(DataTable<Row>, { caption: 'U', columns: columns(), rows: [], getRowId: (r) => r.id, loading: true }));
        expect(q('[role="status"]')!.textContent).toContain('Cargando');
        expect(q('table')!.getAttribute('aria-busy')).toBe('true');
    });
});

describe('Pagination', () => {
    it('rango, botones con nombre y limites', async () => {
        const onPage = vi.fn();
        const onPageSize = vi.fn();
        await mount(h(Pagination, { page: 2, pages: 3, total: 51, pageSize: 25, onPage, onPageSize }));
        expect(document.body.textContent).toContain('Mostrando 26–50 de 51');
        expect(document.body.textContent).toContain('Página 2 de 3');
        await click(q('button[aria-label="Página siguiente"]'));
        expect(onPage).toHaveBeenLastCalledWith(3);
        await click(q('button[aria-label="Primera página"]'));
        expect(onPage).toHaveBeenLastCalledWith(1);
        const sel = q<HTMLSelectElement>('select')!;
        await act(async () => { sel.value = '50'; sel.dispatchEvent(new Event('change', { bubbles: true })); });
        expect(onPageSize).toHaveBeenCalledWith(50);
    });
    it('en la primera pagina no se puede retroceder', async () => {
        await mount(h(Pagination, { page: 1, pages: 1, total: 0, pageSize: 25, onPage: vi.fn() }));
        expect(q<HTMLButtonElement>('button[aria-label="Página anterior"]')!.disabled).toBe(true);
        expect(q<HTMLButtonElement>('button[aria-label="Página siguiente"]')!.disabled).toBe(true);
        expect(document.body.textContent).toContain('0–0 de 0'.replace('0–0', '0–0'));
    });
});

describe('StrongConfirmDialog', () => {
    it('el boton solo se habilita al escribir la frase (sin distinguir mayusculas) y Escape cancela', async () => {
        const onConfirm = vi.fn();
        const onCancel = vi.fn();
        await mount(h(StrongConfirmDialog, { open: true, title: 'Restablecer MFA', description: 'Irreversible', phrase: 'ana@x.com', confirmLabel: 'Restablecer', cancelLabel: 'Cancelar', onConfirm, onCancel }));
        const dialog = q('[role="dialog"]')!;
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        const confirm = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Restablecer') as HTMLButtonElement;
        expect(confirm.disabled).toBe(true);
        const input = q<HTMLInputElement>('input')!;
        expect(document.querySelector(`label[for="${input.id}"]`)!.textContent).toContain('ana@x.com');
        await setValue(input, 'otro');
        expect(confirm.disabled).toBe(true);
        expect(document.body.textContent).toContain('El texto no coincide');
        await setValue(input, 'ANA@x.com');
        expect(confirm.disabled).toBe(false);
        await click(confirm);
        expect(onConfirm).toHaveBeenCalledTimes(1);
        await key(document.body, 'Escape');
        expect(onCancel).toHaveBeenCalled();
    });
    it('ocupado: no confirma ni cierra', async () => {
        const onCancel = vi.fn();
        await mount(h(StrongConfirmDialog, { open: true, title: 't', description: 'd', phrase: 'x', confirmLabel: 'Ok', cancelLabel: 'No', busy: true, onConfirm: vi.fn(), onCancel }));
        await key(document.body, 'Escape');
        expect(onCancel).not.toHaveBeenCalled();
        expect((Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Ok') as HTMLButtonElement).disabled).toBe(true);
    });
});

describe('DetailDrawer', () => {
    it('es un dialogo lateral con titulo, cierra con el boton y con Escape', async () => {
        const onClose = vi.fn();
        await mount(h(DetailDrawer, { open: true, onClose, title: 'Ana', subtitle: 'ana@x.com', children: h('p', null, 'cuerpo') }));
        const dlg = q('[role="dialog"]')!;
        expect(dlg.getAttribute('aria-label')).toBe('Ana');
        expect(dlg.textContent).toContain('cuerpo');
        await click(q('button[aria-label="Cerrar"]'));
        expect(onClose).toHaveBeenCalledTimes(1);
        await key(document.body, 'Escape');
        expect(onClose).toHaveBeenCalledTimes(2);
    });
    it('cerrado no renderiza nada', async () => {
        await mount(h(DetailDrawer, { open: false, onClose: vi.fn(), title: 'Ana', children: h('p', null, 'x') }));
        expect(q('[role="dialog"]')).toBeNull();
    });
});

describe('ConsoleShell', () => {
    const me = { me: { kind: 'user', id: 'u1', email: 'admin@acme.test', userId: 'u1', instanceDomain: 'mail.acme.test' } };
    function stubFetch(meRes: any = json(200, me), extra?: (url: string) => any) {
        const fn = vi.fn(async (input: any) => {
            const url = String(input);
            const custom = extra?.(url);
            if (custom) return custom;
            if (url.includes('/api/admin/me')) return meRes;
            if (url.includes('/api/admin/system')) return json(200, { status: 'ok', db: { ok: true, ms: 3 }, backend: { ok: true, ms: 40 }, rateLimit: 'memory', legacy: false });
            return json(404, {});
        });
        vi.stubGlobal('fetch', fn);
        return fn;
    }

    it('tras la puerta muestra navegacion por secciones, seccion activa, breadcrumb, dominio y enlace para saltar', async () => {
        stubFetch();
        await mount(h(ConsoleShell, null, h('h1', null, 'Contenido')));
        const nav = document.querySelector('aside nav[aria-label="Navegación de la consola"]')!;
        expect(nav).toBeTruthy();
        const links = Array.from(nav.querySelectorAll('a'));
        expect(links.map((a) => a.getAttribute('href'))).toEqual(NAV_GROUP_ORDER.flatMap((g) => NAV_ITEMS.filter((n) => n.group === g).map((n) => n.href)));
        const current = links.filter((a) => a.getAttribute('aria-current') === 'page');
        expect(current.length).toBe(1);
        expect(current[0].textContent).toBe('Usuarios');
        expect(q('nav[aria-label="Ruta de navegación"]')!.textContent).toContain('Usuarios');
        expect(document.body.textContent).toContain('mail.acme.test');
        expect(q('a[href="#console-main"]')!.textContent).toBe('Saltar al contenido');
        expect(q('main#console-main')!.textContent).toContain('Contenido');
        expect(q('header')).toBeTruthy();
    });

    it('404/403 en la puerta: no hay consola, solo mensaje con enlace al acceso', async () => {
        stubFetch(json(403, { error: 'Forbidden' }));
        await mount(h(ConsoleShell, null, h('p', null, 'SECRETO')));
        expect(q('[role="alert"]')!.textContent).toContain('no administra este dominio');
        expect(document.body.textContent).not.toContain('SECRETO');
        expect(q('aside')).toBeNull();
    });

    it('MFA requerido: mensaje especifico', async () => {
        stubFetch(json(403, { error: 'Forbidden', code: 'MFA_REQUIRED' }));
        await mount(h(ConsoleShell, null, h('p', null, 'x')));
        expect(q('[role="alert"]')!.textContent).toContain('verificación en dos pasos');
    });

    it('"/" abre la busqueda global (y no cuando se escribe en un campo); Escape la cierra', async () => {
        stubFetch();
        await mount(h(ConsoleShell, null, h('input', { id: 'free', 'aria-label': 'libre' })));
        const free = q<HTMLInputElement>('#free')!;
        free.focus();
        await key(free, '/');
        expect(q('[role="dialog"]')).toBeNull();
        free.blur();
        await key(document.body, '/');
        const dlg = q('[role="dialog"]')!;
        expect(dlg.getAttribute('aria-label')).toBe('Búsqueda global');
        expect(document.activeElement?.getAttribute('role')).toBe('combobox');
        await key(document.body, 'Escape');
        expect(q('[role="dialog"]')).toBeNull();
    });

    it('Ctrl/Cmd+K abre la busqueda con el foco en el campo, tambien desde un campo de texto; Escape devuelve el foco al elemento previo', async () => {
        stubFetch();
        await mount(h(ConsoleShell, null, h('button', { id: 'prev' }, 'previo'), h('textarea', { id: 'ta', 'aria-label': 'nota' })));
        const prev = q<HTMLButtonElement>('#prev')!;
        prev.focus();
        await key(prev, 'k', { ctrlKey: true });
        // el foco llega al combobox de inmediato (sin esperar a requestAnimationFrame)
        expect(document.activeElement?.getAttribute('role')).toBe('combobox');
        await key(document.activeElement!, 'Escape');
        expect(q('[role="dialog"]')).toBeNull();
        expect(document.activeElement).toBe(prev);
        // Cmd+K (macOS) desde un textarea
        const ta = q<HTMLTextAreaElement>('#ta')!;
        ta.focus();
        await key(ta, 'K', { metaKey: true });
        expect(document.activeElement?.getAttribute('role')).toBe('combobox');
        await key(document.activeElement!, 'Escape');
        expect(document.activeElement).toBe(ta);
    });

    it('"/" dentro de un textarea o un campo editable NO abre la busqueda ni se pierde el caracter', async () => {
        stubFetch();
        await mount(h(ConsoleShell, null, h('textarea', { id: 'ta', 'aria-label': 'nota' }), h('div', { id: 'ce', contentEditable: 'true', tabIndex: 0 })));
        const ta = q<HTMLTextAreaElement>('#ta')!;
        ta.focus();
        const ev = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
        await act(async () => { ta.dispatchEvent(ev); });
        expect(ev.defaultPrevented).toBe(false);
        expect(q('[role="dialog"]')).toBeNull();
    });

    it('"/" abre la busqueda con el foco en el campo y sin escribir "/" en el; Escape devuelve el foco', async () => {
        stubFetch();
        await mount(h(ConsoleShell, null, h('button', { id: 'prev' }, 'previo')));
        const prev = q<HTMLButtonElement>('#prev')!;
        prev.focus();
        const ev = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
        await act(async () => { prev.dispatchEvent(ev); });
        expect(ev.defaultPrevented).toBe(true);
        const input = q<HTMLInputElement>('input[role="combobox"]')!;
        expect(document.activeElement).toBe(input);
        expect(input.value).toBe('');
        await key(input, 'Escape');
        expect(document.activeElement).toBe(prev);
    });

    it('busqueda: secciones/ajustes y extensiones locales, usuarios remotos; flechas + Intro navegan', async () => {
        const fetchMock = stubFetch(json(200, me), (url) => url.includes('/api/admin/search') ? json(200, { users: [{ id: 'u7', name: 'Ana Pérez', email: 'ana@x.com' }] }) : null);
        await mount(h(ConsoleShell, null, h('p', null, 'x')));
        await key(document.body, '/');
        const input = q<HTMLInputElement>('input[role="combobox"]')!;
        await setValue(input, 'mfa');
        let opts = Array.from(document.querySelectorAll('[role="option"]')).map((o) => o.textContent);
        expect(opts.some((t) => t!.includes('Autenticación en dos pasos'))).toBe(true);
        await setValue(input, 'notion');
        opts = Array.from(document.querySelectorAll('[role="option"]')).map((o) => o.textContent);
        expect(opts).toEqual(['Notioncore-notion']);
        // una sola letra no consulta usuarios al servidor
        await setValue(input, 'n');
        await act(async () => { await new Promise((r) => setTimeout(r, 350)); });
        expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/admin/search'))).toBe(false);
        expect(document.body.textContent).toContain('Escribe al menos 2 letras');
    });

    it('busqueda de usuarios: pide /api/admin/search con debounce y navega a ?open=<id>', async () => {
        const fetchMock = stubFetch(json(200, me), (url) => url.includes('/api/admin/search') ? json(200, { users: [{ id: 'u7', name: 'Ana Pérez', email: 'ana@x.com' }] }) : null);
        await mount(h(ConsoleShell, null, h('p', null, 'x')));
        await key(document.body, '/');
        const input = q<HTMLInputElement>('input[role="combobox"]')!;
        await setValue(input, 'ana');
        await act(async () => { await new Promise((r) => setTimeout(r, 350)); });
        expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/api/admin/search?q=ana')).toBe(true);
        const options = Array.from(document.querySelectorAll('[role="option"]'));
        expect(options[0].textContent).toContain('Ana Pérez');
        expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id);
        await key(input, 'Enter');
        expect(push).toHaveBeenCalledWith('/admin/users?open=u7');
        expect(q('[role="dialog"]')).toBeNull();
    });

    it('ArrowDown cambia la opcion activa', async () => {
        stubFetch();
        await mount(h(ConsoleShell, null, h('p', null, 'x')));
        await key(document.body, '/');
        const input = q<HTMLInputElement>('input[role="combobox"]')!;
        const before = input.getAttribute('aria-activedescendant');
        await key(input, 'ArrowDown');
        expect(input.getAttribute('aria-activedescendant')).not.toBe(before);
        const selected = document.querySelectorAll('[role="option"][aria-selected="true"]');
        expect(selected.length).toBe(1);
    });

    it('cajon movil: el boton abre un dialogo con la navegacion y Escape lo cierra', async () => {
        stubFetch();
        await mount(h(ConsoleShell, null, h('p', null, 'x')));
        const burger = q<HTMLButtonElement>('button[aria-label="Abrir menú"]')!;
        expect(burger.getAttribute('aria-expanded')).toBe('false');
        await click(burger);
        const dlg = q('[role="dialog"]')!;
        expect(dlg.querySelectorAll('nav a').length).toBe(NAV_ITEMS.length);
        await key(document.body, 'Escape');
        // la animacion de salida (framer-motion) mantiene el panel en el DOM unos ms: se espera hasta que desaparezca
        await waitUntil(() => q('[role="dialog"]') === null);
        expect(q('[role="dialog"]')).toBeNull();
    });

    it('cambios sin guardar: navegar pide confirmacion; "seguir editando" cancela y "salir" navega', async () => {
        stubFetch();
        function Dirty() { useUnsavedChanges(true); return h('p', null, 'editando'); }
        await mount(h(ConsoleShell, null, h(Dirty)));
        const go = q<HTMLAnchorElement>('aside a[href="/admin/mail"]')!;
        await click(go);
        expect(push).not.toHaveBeenCalled();
        expect(q('[role="dialog"]')!.textContent).toContain('¿Salir sin guardar?');
        await click(Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Seguir editando'));
        expect(push).not.toHaveBeenCalled();
        await click(go);
        await click(Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Salir sin guardar'));
        expect(push).toHaveBeenCalledWith('/admin/mail');
    });

    it('sin cambios pendientes navega directo', async () => {
        stubFetch();
        await mount(h(ConsoleShell, null, h('p', null, 'x')));
        await click(q('aside a[href="/admin/audit"]'));
        expect(push).toHaveBeenCalledWith('/admin/audit');
    });

    it('menu del perfil: patron menu button (flechas, Escape devuelve el foco) y cambio de idioma', async () => {
        stubFetch();
        await mount(h(ConsoleShell, null, h('p', null, 'x')));
        const btn = q<HTMLButtonElement>('button[aria-label="Menú del perfil"]')!;
        expect(btn.getAttribute('aria-haspopup')).toBe('menu');
        await click(btn);
        const menu = q('[role="menu"]')!;
        expect(btn.getAttribute('aria-expanded')).toBe('true');
        expect(menu.textContent).toContain('admin@acme.test');
        await key(menu, 'Escape');
        expect(q('[role="menu"]')).toBeNull();
        expect(document.activeElement).toBe(btn);
        await click(btn);
        const en = Array.from(document.querySelectorAll('[role="menuitemradio"]')).find((b) => b.textContent === 'English');
        await click(en);
        expect(document.documentElement.lang).toBe('en');
        expect(q('aside nav a[href="/admin/users"]')!.textContent).toBe('Users');
    });

    it('estado del sistema: texto ademas del color y detalle desplegable', async () => {
        stubFetch();
        await mount(h(ConsoleShell, null, h('p', null, 'x')));
        const btn = q<HTMLButtonElement>('button[aria-label^="Estado del sistema"]')!;
        expect(btn.getAttribute('aria-label')).toBe('Estado del sistema: Todo operativo');
        await click(btn);
        expect(q('[role="region"]')!.textContent).toContain('Base de datos');
        expect(q('[role="region"]')!.textContent).toContain('Memoria (por instancia)');
    });

    it('densidad compacta desde localStorage se refleja en data-density', async () => {
        window.localStorage.setItem('bloomx:admin:density:v1', 'compact');
        stubFetch();
        await mount(h(ConsoleShell, null, h('p', null, 'x')));
        expect(q('[data-density]')!.getAttribute('data-density')).toBe('compact');
    });
});
