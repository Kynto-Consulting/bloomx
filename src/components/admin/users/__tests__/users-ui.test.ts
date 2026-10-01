// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ search: '', listeners: new Set<() => void>() }));
vi.mock('next/navigation', async () => {
    const R = await import('react');
    const subscribe = (cb: () => void) => { nav.listeners.add(cb); return () => nav.listeners.delete(cb); };
    return {
        useSearchParams: () => {
            const s = R.useSyncExternalStore(subscribe, () => nav.search, () => nav.search);
            return R.useMemo(() => new URLSearchParams(s), [s]);
        },
        usePathname: () => '/admin/users',
        useRouter: () => ({
            replace: (url: string) => {
                nav.search = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
                nav.listeners.forEach((l) => l());
            },
        }),
    };
});
vi.mock('next/link', async () => {
    const R = await import('react');
    return { default: ({ href, children, ...rest }: any) => R.createElement('a', { href, ...rest }, children) };
});
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

import { I18nProvider } from '@/components/I18nProvider';
import { toast } from 'sonner';
import { UsersPage } from '../UsersPage';
import { AccountsPage } from '../../accounts/AccountsPage';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

const ROWS = [
    { id: 'u1', name: 'Ann Zeta', email: 'ann@x.test', avatar: false, createdAt: '2025-01-01T00:00:00.000Z', disabled: false, isAdmin: true, mfaEnabled: true, googleLinked: true, lastLoginAt: '2025-03-01T10:00:00.000Z', storageBytes: 2048, sessions: 2, quotaMb: 50, quotaSource: 'user' },
    { id: 'u2', name: null, email: 'bob@x.test', avatar: false, createdAt: '2025-01-02T00:00:00.000Z', disabled: true, isAdmin: false, mfaEnabled: false, googleLinked: false, lastLoginAt: null, storageBytes: 0, sessions: 0, quotaMb: null, quotaSource: 'none' },
];
const DETAIL = (over: any = {}) => ({
    user: { id: 'u1', name: 'Ann Zeta', email: 'ann@x.test', avatar: false, createdAt: '2025-01-01T00:00:00.000Z', isAdmin: true, isSelf: false, permission_level: 4, levelName: 'superadmin', levelSource: 'env' },
    state: { disabled: false, disabledAt: null, mustChangePassword: false, lastLoginAt: '2025-03-01T10:00:00.000Z', lastLoginIp: '10.0.0.1' },
    mfa: { available: true, enabled: true, pendingEnrollment: false, recoveryCodesLeft: 8, required: true },
    accounts: [{ id: 'a1', provider: 'google', scopes: ['openid'], expiresAt: null, hasRefreshToken: true }],
    sessions: [{ jti: 'jti-1', mfa: true, ip: '1.2.3.4', userAgent: 'Mozilla', createdAt: '2025-03-01T10:00:00.000Z', expiresAt: '2025-04-01T10:00:00.000Z' }],
    storage: { attachmentBytes: 2048, attachmentCount: 2, emailCount: 3, folders: [{ folder: 'inbox', count: 3 }] },
    quota: { userMb: 50, domainMb: 2000, envMb: null, effectiveMb: 50, source: 'user', usedBytes: 26214400, percent: 50, level: 'ok', approximate: true, maxMb: 10000000 },
    ...over,
});
const ACCOUNTS = [
    { id: 'a1', userId: 'u1', userEmail: 'ann@x.test', userName: 'Ann Zeta', provider: 'google', providerAccountId: '123…90', scopes: ['openid', 'https://www.googleapis.com/auth/calendar'], expiresAt: '2030-01-01T00:00:00.000Z', status: 'valid', hasRefreshToken: true, integrations: ['calendar'] },
    { id: 'a2', userId: 'u2', userEmail: 'bob@x.test', userName: null, provider: 'zoom', providerAccountId: 'abc…yz', scopes: [], expiresAt: null, status: 'revoked', hasRefreshToken: false, integrations: [] },
];

const jsonRes = (status: number, body: any) => ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: new Headers() });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const click = async (el: Element | null | undefined) => {
    if (!el) throw new Error('elemento no encontrado');
    await act(async () => { (el as HTMLElement).click(); });
    await flush();
};
const setValue = async (el: HTMLInputElement | HTMLSelectElement, value: string) => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    await act(async () => {
        Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
        el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    });
    await flush();
};
const buttons = () => Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
const btn = (text: string) => buttons().find((b) => (b.getAttribute('aria-label') || b.textContent || '').trim().includes(text));
const dialog = () => document.querySelector('[role="dialog"][aria-modal="true"]:last-of-type') as HTMLElement | null;
const dialogs = () => Array.from(document.querySelectorAll('[role="dialog"]')) as HTMLElement[];
const inDialog = (text: string) => Array.from(dialogs().at(-1)!.querySelectorAll('button')).find((b) => (b.textContent || '').trim().includes(text)) as HTMLButtonElement;
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));
const callsTo = (part: string, method?: string) =>
    fetchMock.mock.calls.filter((c) => String(c[0]).includes(part) && (!method || (c[1]?.method ?? 'GET') === method));

function routeFetch(extra: (url: string, init?: any) => any = () => undefined) {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
        const custom = extra(String(url), init);
        if (custom !== undefined) return custom;
        const u = String(url);
        const method = init?.method ?? 'GET';
        if (u.startsWith('/api/admin/users/bulk')) return jsonRes(200, { summary: { ok: 1, notFound: 0, skippedSelf: 1, failed: 0 }, results: [] });
        if (/^\/api\/admin\/users\/u1(\?|$)/.test(u) && method === 'GET') return jsonRes(200, DETAIL());
        if (/^\/api\/admin\/users\/u1\/quota/.test(u) && method === 'PUT') return jsonRes(200, DETAIL().quota);
        if (/^\/api\/admin\/users\/u1\/password/.test(u)) return jsonRes(200, { success: true, temporaryPassword: 'Tmp-Secret-Pw-9999' });
        if (u.startsWith('/api/admin/users?') || u === '/api/admin/users') {
            if (method === 'POST') return jsonRes(201, { success: true, user: { id: 'n1', email: 'new@x.test', name: null }, temporaryPassword: 'Generated-Pw-12345' });
            return jsonRes(200, { users: ROWS, page: { page: 1, pageSize: 25, total: 2, pages: 1 } });
        }
        if (u.startsWith('/api/admin/accounts?')) return jsonRes(200, { accounts: ACCOUNTS, providers: ['google', 'zoom'], page: { page: 1, pageSize: 25, total: 2, pages: 1 } });
        if (method === 'DELETE' || method === 'POST' || method === 'PATCH') return jsonRes(200, { success: true });
        return jsonRes(404, { error: 'nf', code: 'not_found' });
    });
}

async function mount(node: React.ReactElement, search = '') {
    nav.search = search;
    await act(async () => {
        root.render(
            React.createElement(I18nProvider, {
                locale: 'es',
                children: React.createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 }, children: node }),
            }),
        );
    });
    await flush();
    await flush();
}

beforeEach(() => {
    fetchMock.mockReset();
    (toast.success as any).mockReset?.();
    (toast.error as any).mockReset?.();
    vi.stubGlobal('fetch', fetchMock);
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    routeFetch();
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});

describe('UsersPage: tabla', () => {
    it('renderiza cabecera, tabla con caption, filas, insignias y orden por defecto accesible', async () => {
        await mount(React.createElement(UsersPage));
        expect(document.querySelector('h1')!.textContent).toBe('Usuarios');
        const table = document.querySelector('table')!;
        expect(table.querySelector('caption')!.textContent).toBe('Lista de usuarios');
        expect(table.querySelectorAll('tbody tr')).toHaveLength(2);
        const text = table.textContent!;
        expect(text).toContain('Ann Zeta');
        expect(text).toContain('bob@x.test');
        expect(text).toContain('Sin nombre');
        expect(text).toContain('Deshabilitado');
        expect(text).toContain('Administrador');
        expect(text).toContain('MFA activo');
        expect(text).toContain('2 KB');
        const created = Array.from(table.querySelectorAll('th[scope="col"]')).find((th) => th.textContent!.includes('Alta'))!;
        expect(created.getAttribute('aria-sort')).toBe('descending');
        expect(urls()[0]).toContain('/api/admin/users?sort=createdAt&dir=desc&page=1&pageSize=25');
    });

    it('ordenar por columna actualiza aria-sort, la URL y la consulta', async () => {
        await mount(React.createElement(UsersPage));
        await click(btn('Ordenar por Usuario'));
        expect(nav.search).toContain('sort=email');
        expect(nav.search).toContain('dir=asc');
        expect(urls().at(-1)).toContain('sort=email&dir=asc');
        const th = Array.from(document.querySelectorAll('th[scope="col"]')).find((x) => x.textContent!.includes('Usuario'))!;
        expect(th.getAttribute('aria-sort')).toBe('ascending');
        await click(btn('Ordenar por Usuario'));
        expect(urls().at(-1)).toContain('sort=email&dir=desc');
    });

    it('error de carga: alerta con boton Reintentar', async () => {
        routeFetch((u) => (u.startsWith('/api/admin/users?') ? jsonRes(500, { code: 'internal' }) : undefined));
        await mount(React.createElement(UsersPage));
        expect(document.querySelector('[role="alert"]')!.textContent).toContain('Error del servidor');
        routeFetch();
        await click(btn('Reintentar'));
        expect(document.querySelectorAll('tbody tr')).toHaveLength(2);
    });
});

describe('UsersPage: filtros en la URL', () => {
    it('los filtros actualizan URL y consulta; limpiar filtros los quita', async () => {
        await mount(React.createElement(UsersPage));
        const selectByLabel = (label: string) => {
            const l = Array.from(document.querySelectorAll('label')).find((x) => x.textContent === label)!;
            return document.getElementById(l.getAttribute('for')!) as HTMLSelectElement;
        };
        await setValue(selectByLabel('Estado'), 'disabled');
        expect(urls().at(-1)).toContain('status=disabled');
        await setValue(selectByLabel('Rol'), 'admin');
        await setValue(selectByLabel('MFA'), 'yes');
        await setValue(selectByLabel('Cuenta Google'), 'no');
        const last = urls().at(-1)!;
        expect(last).toContain('status=disabled');
        expect(last).toContain('role=admin');
        expect(last).toContain('mfa=yes');
        expect(last).toContain('google=no');
        expect(nav.search).toContain('google=no');

        await click(btn('Quitar filtros'));
        await wait(60); // SWR revalida con datos en cache un frame despues
        expect(nav.search).toBe('');
        expect(urls().at(-1)).not.toMatch(/status=|role=|mfa=|google=/);
        expect(btn('Quitar filtros')).toBeUndefined();
    });

    it('el buscador usa debounce, reinicia la pagina y se sincroniza con la URL', async () => {
        await mount(React.createElement(UsersPage), 'page=3');
        const before = fetchMock.mock.calls.length;
        const input = document.querySelector<HTMLInputElement>('input[type="search"]')!;
        expect(input.getAttribute('aria-label')).toBe('Buscar usuarios');
        await setValue(input, 'an');
        await setValue(input, 'ann');
        expect(fetchMock.mock.calls.length).toBe(before); // aun no: debounce
        await wait(400);
        expect(nav.search).toContain('q=ann');
        expect(nav.search).not.toContain('page=');
        expect(urls().at(-1)).toContain('q=ann');
        expect(urls().filter((u) => u.includes('q=an&')).length).toBe(0);
    });

    it('lee filtros, orden y pagina de la URL y descarta valores invalidos', async () => {
        await mount(React.createElement(UsersPage), 'status=disabled&sort=password&role=root&page=2&pageSize=50');
        const u = urls()[0];
        expect(u).toContain('status=disabled');
        expect(u).toContain('sort=createdAt');
        expect(u).not.toContain('role=');
        expect(u).toContain('page=2&pageSize=50');
    });

    it('exportar CSV usa los mismos filtros', async () => {
        const blob = { blob: async () => new Blob(['x']), ok: true, status: 200, headers: new Headers({ 'Content-Disposition': 'attachment; filename="users.csv"' }) };
        (URL as any).createObjectURL = vi.fn(() => 'blob:x');
        (URL as any).revokeObjectURL = vi.fn();
        routeFetch((u) => (u.startsWith('/api/admin/users/export') ? blob : undefined));
        await mount(React.createElement(UsersPage), 'q=ann&status=active');
        await click(btn('Exportar CSV'));
        const call = urls().find((u) => u.startsWith('/api/admin/users/export'))!;
        expect(call).toContain('q=ann');
        expect(call).toContain('status=active');
        expect(toast.success).toHaveBeenCalled();
    });
});

describe('UsersPage: seleccion masiva', () => {
    it('la casilla "todas" selecciona la pagina, aparece la barra y las confirmaciones cancelan o ejecutan', async () => {
        await mount(React.createElement(UsersPage));
        expect(document.querySelector('[role="toolbar"]')).toBeNull();
        const all = document.querySelector<HTMLInputElement>('input[aria-label="Seleccionar todas las filas de esta página"]')!;
        await click(all);
        expect(all.checked).toBe(true);
        const bar = document.querySelector('[role="toolbar"]')!;
        expect(bar.textContent).toContain('2 seleccionado(s)');
        expect(document.querySelectorAll('tbody input[type="checkbox"]:checked')).toHaveLength(2);

        // Cancelar no llama a la API
        await click(btn('Deshabilitar'));
        expect(dialog()!.textContent).toContain('Se deshabilitarán 2 usuario(s)');
        await click(inDialog('Cancelar'));
        expect(dialogs()).toHaveLength(0);
        expect(callsTo('/api/admin/users/bulk')).toHaveLength(0);

        // Confirmar
        await click(btn('Deshabilitar'));
        await click(inDialog('Deshabilitar'));
        const [, init] = callsTo('/api/admin/users/bulk')[0];
        expect(JSON.parse(init.body)).toEqual({ ids: ['u1', 'u2'], action: 'disable' });
        expect(toast.success).toHaveBeenCalledWith('Listo: 1 aplicados, 1 omitidos, 0 con error.');
        expect(document.querySelector('[role="toolbar"]')).toBeNull(); // seleccion limpia
    });

    it('seleccionar una fila y quitar la seleccion', async () => {
        await mount(React.createElement(UsersPage));
        await click(document.querySelector('input[aria-label="Seleccionar ann@x.test"], input[aria-label="Seleccionar Ann Zeta"]'));
        expect(document.querySelector('[role="toolbar"]')!.textContent).toContain('1 seleccionado(s)');
        await click(btn('Cerrar sesiones'));
        expect(dialog()!.textContent).toContain('Se cerrarán todas las sesiones activas de 1 usuario(s)');
        await click(inDialog('Cancelar'));
        await click(btn('Quitar selección'));
        expect(document.querySelector('[role="toolbar"]')).toBeNull();
    });
});

describe('UsersPage: detalle en panel lateral', () => {
    it('Enter/clic en el boton de la fila abre el detalle (?open=) y Escape lo cierra', async () => {
        await mount(React.createElement(UsersPage));
        const open = btn('Abrir detalle de Ann Zeta')!;
        expect(open.tagName).toBe('BUTTON');
        expect(open.getAttribute('type')).toBe('button');
        open.focus();
        expect(document.activeElement).toBe(open);
        // Los navegadores convierten Intro/Espacio sobre un <button> en clic: aqui se dispara ese clic.
        await act(async () => { open.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
        await click(open);
        expect(nav.search).toContain('open=u1');
        await flush();
        const d = dialog()!;
        expect(d.getAttribute('aria-modal')).toBe('true');
        expect(d.textContent).toContain('Ann Zeta');
        for (const section of ['Datos', 'Estado y rol', 'Autenticación en dos pasos (MFA)', 'Sesiones activas', 'Cuentas vinculadas', 'Almacenamiento', 'Contraseña']) {
            expect(d.textContent).toContain(section);
        }
        // El rol ahora es un permission_level (0-4) con su origen: ADMIN_EMAILS = nivel 4 fijado por entorno (no editable desde la consola).
        expect(d.textContent).toContain('Nivel 4 · superadmin');
        expect(d.textContent).toContain('fijado por entorno (ADMIN_EMAILS)');
        expect(d.textContent).not.toMatch(/Tmp-Secret/);

        await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
        await flush();
        expect(nav.search).not.toContain('open=');
        expect(dialogs()).toHaveLength(0);
    });

    it('tabla: columna Cuota con el limite efectivo y su origen cuando es del usuario', async () => {
        await mount(React.createElement(UsersPage));
        const rows = Array.from(document.querySelectorAll('tbody tr'));
        expect(rows[0].textContent).toContain('50 MB');
        expect(rows[0].textContent).toContain('(usuario)');
        expect(rows[1].textContent).toContain('Sin límite');
        expect(Array.from(document.querySelectorAll('thead th')).some((th) => th.textContent?.includes('Cuota de buzón'))).toBe(true);
    });

    it('detalle: cuota efectiva, origen y uso; guardar valida entero 0..max y llama a PUT; restablecer envia null', async () => {
        await mount(React.createElement(UsersPage), 'open=u1');
        const d = dialog()!;
        expect(d.textContent).toContain('Cuota de buzón');
        expect(d.textContent).toContain('50 MB');
        expect(d.textContent).toContain('Usuario');
        expect(d.textContent).toContain('2000 MB'); // valor del dominio
        const input = d.querySelector('input[inputmode="numeric"]') as HTMLInputElement;
        expect(input.value).toBe('50');
        expect(input.labels?.[0]?.textContent).toContain('Cuota de buzón (MB)');
        expect(btn('Guardar cuota')!.disabled).toBe(true); // sin cambios

        // validacion: nada de decimales, negativos, texto ni pasarse del maximo
        for (const bad of ['1.5', '-3', 'abc', '10000001', '1e3']) {
            await setValue(input, bad);
            await click(btn('Guardar cuota'));
            expect(dialog()!.querySelector('[role="alert"]')?.textContent).toContain('número entero de MB entre 0 y 10000000');
            expect(input.getAttribute('aria-invalid')).toBe('true');
        }
        expect(callsTo('/api/admin/users/u1/quota', 'PUT')).toHaveLength(0);

        await setValue(input, '120');
        expect(input.getAttribute('aria-invalid')).toBeNull();
        await click(btn('Guardar cuota'));
        const put = callsTo('/api/admin/users/u1/quota', 'PUT');
        expect(put).toHaveLength(1);
        expect(JSON.parse(put[0][1].body)).toEqual({ mailQuotaMb: 120 });
        expect(toast.success).toHaveBeenCalledWith('Cuota actualizada');

        await click(btn('Restablecer a la del dominio'));
        const puts = callsTo('/api/admin/users/u1/quota', 'PUT');
        expect(puts).toHaveLength(2);
        expect(JSON.parse(puts[1][1].body)).toEqual({ mailQuotaMb: null });
        expect(toast.success).toHaveBeenCalledWith('Cuota restablecida a la del dominio');
    });

    it('detalle: campo vacio equivale a restablecer; con origen dominio el boton Restablecer esta desactivado', async () => {
        routeFetch((u, init) => (/^\/api\/admin\/users\/u1(\?|$)/.test(u) && (init?.method ?? 'GET') === 'GET'
            ? jsonRes(200, DETAIL({ quota: { userMb: null, domainMb: 2000, envMb: null, effectiveMb: 2000, source: 'domain', usedBytes: 0, percent: 0, level: 'ok', approximate: true, maxMb: 10000000 } }))
            : undefined));
        await mount(React.createElement(UsersPage), 'open=u1');
        const d = dialog()!;
        expect(d.textContent).toContain('Dominio');
        expect(btn('Restablecer a la del dominio')!.disabled).toBe(true);
        const input = d.querySelector('input[inputmode="numeric"]') as HTMLInputElement;
        expect(input.value).toBe('');
        expect(input.placeholder).toBe('2000');
        await setValue(input, '0');
        await click(btn('Guardar cuota'));
        expect(JSON.parse(callsTo('/api/admin/users/u1/quota', 'PUT')[0][1].body)).toEqual({ mailQuotaMb: 0 });
    });

    it('detalle: si la cuota no se pudo cargar lo dice sin romper el resto', async () => {
        routeFetch((u, init) => (/^\/api\/admin\/users\/u1(\?|$)/.test(u) && (init?.method ?? 'GET') === 'GET' ? jsonRes(200, DETAIL({ quota: null })) : undefined));
        await mount(React.createElement(UsersPage), 'open=u1');
        expect(dialog()!.textContent).toContain('No se pudo cargar la cuota de este usuario.');
        expect(dialog()!.textContent).toContain('Contraseña');
    });

    it('respeta ?open=<id> al cargar', async () => {
        await mount(React.createElement(UsersPage), 'open=u1');
        expect(dialog()!.textContent).toContain('ann@x.test');
        expect(urls().some((u) => u.startsWith('/api/admin/users/u1'))).toBe(true);
    });

    it('restablecer MFA exige escribir el correo; cancelar no llama; confirmar llama a mfa-reset', async () => {
        await mount(React.createElement(UsersPage), 'open=u1');
        await click(btn('Restablecer MFA'));
        const strong = dialogs().at(-1)!;
        expect(strong.textContent).toContain('ann@x.test');
        const confirm = inDialog('Restablecer MFA');
        expect(confirm.disabled).toBe(true);
        const field = strong.querySelector('input')!;
        await setValue(field, 'otro@x.test');
        expect(inDialog('Restablecer MFA').disabled).toBe(true);
        await click(inDialog('Cancelar'));
        expect(callsTo('/mfa-reset')).toHaveLength(0);

        await click(btn('Restablecer MFA'));
        await setValue(dialogs().at(-1)!.querySelector('input')!, 'ANN@x.test');
        expect(inDialog('Restablecer MFA').disabled).toBe(false);
        await click(inDialog('Restablecer MFA'));
        expect(callsTo('/api/admin/users/u1/mfa-reset', 'POST')).toHaveLength(1);
        expect(toast.success).toHaveBeenCalledWith('MFA restablecido y sesiones cerradas.');
    });

    it('sesiones: revocar una (confirmacion) y todas', async () => {
        await mount(React.createElement(UsersPage), 'open=u1');
        await click(document.querySelector('button[aria-label^="Cerrar la sesión iniciada"]'));
        expect(dialogs().at(-1)!.textContent).toContain('Se cerrará esta sesión de ann@x.test');
        await click(inDialog('Cancelar'));
        expect(callsTo('/sessions')).toHaveLength(0);
        await click(document.querySelector('button[aria-label^="Cerrar la sesión iniciada"]'));
        await click(inDialog('Cerrar sesión'));
        expect(callsTo('/api/admin/users/u1/sessions/jti-1', 'DELETE')).toHaveLength(1);

        await click(btn('Cerrar todas las sesiones'));
        await click(inDialog('Cerrar todas las sesiones'));
        expect(callsTo('/api/admin/users/u1/sessions', 'DELETE').some((c) => String(c[0]).endsWith('/sessions'))).toBe(true);
    });

    it('deshabilitar usuario pide confirmacion; contrasena temporal se muestra una vez con boton de copiar', async () => {
        await mount(React.createElement(UsersPage), 'open=u1');
        await click(btn('Deshabilitar usuario'));
        await click(inDialog('Cancelar'));
        expect(callsTo('/api/admin/users/u1', 'PATCH')).toHaveLength(0);
        await click(btn('Deshabilitar usuario'));
        await click(inDialog('Deshabilitar usuario'));
        const [, init] = callsTo('/api/admin/users/u1', 'PATCH')[0];
        expect(JSON.parse(init.body)).toEqual({ disabled: true });

        await click(btn('Restablecer con contraseña temporal'));
        expect(dialogs().at(-1)!.textContent).toContain('Se mostrará una sola vez');
        await click(inDialog('Generar temporal'));
        const shown = document.querySelector<HTMLInputElement>('input[readonly]')!;
        expect(shown.value).toBe('Tmp-Secret-Pw-9999');
        await click(btn('Copiar contraseña'));
        expect((navigator.clipboard.writeText as any)).toHaveBeenCalledWith('Tmp-Secret-Pw-9999');
        await click(btn('Ya la copié'));
        expect(document.querySelector('input[readonly]')).toBeNull();
        expect(document.body.textContent).not.toContain('Tmp-Secret-Pw-9999');
    });

    it('errores de la API se traducen (p. ej. no puedes aplicarlo a ti mismo)', async () => {
        routeFetch((u, init) => (u.endsWith('/mfa-reset') ? jsonRes(409, { code: 'cannot_target_self' }) : undefined));
        await mount(React.createElement(UsersPage), 'open=u1');
        await click(btn('Restablecer MFA'));
        await setValue(dialogs().at(-1)!.querySelector('input')!, 'ann@x.test');
        await click(inDialog('Restablecer MFA'));
        expect(dialogs().at(-1)!.querySelector('[role="alert"]')!.textContent).toContain('No puedes aplicar esta acción sobre tu propia cuenta');
    });
});

describe('UsersPage: crear usuario', () => {
    it('?create=1 abre el formulario con la politica; generar contrasena; al crear muestra la temporal una vez', async () => {
        await mount(React.createElement(UsersPage), 'create=1');
        const d = dialog()!;
        expect(d.textContent).toContain('mínimo 12 caracteres');
        const email = d.querySelector<HTMLInputElement>('input[type="email"]')!;
        expect(email.required).toBe(true);
        await setValue(email, 'new@x.test');
        await click(btn('Generar contraseña'));
        const pw = Array.from(d.querySelectorAll('input')).find((i) => i.autocomplete === 'new-password')!;
        expect(pw.value.length).toBeGreaterThanOrEqual(16);
        expect(pw.type).toBe('text');
        await setValue(pw, '');

        await act(async () => { d.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
        await flush();
        const [, init] = callsTo('/api/admin/users', 'POST')[0];
        expect(JSON.parse(init.body)).toMatchObject({ email: 'new@x.test', mustChangePassword: true });
        expect(JSON.parse(init.body).password).toBeUndefined();
        const shown = document.querySelector<HTMLInputElement>('input[readonly]')!;
        expect(shown.value).toBe('Generated-Pw-12345');
        await click(inDialog('Cerrar'));
        expect(nav.search).not.toContain('create=');
        expect(document.body.textContent).not.toContain('Generated-Pw-12345');
    });

    it('errores del alta: correo duplicado', async () => {
        routeFetch((u, init) => (u === '/api/admin/users' && init?.method === 'POST' ? jsonRes(409, { code: 'user_exists' }) : undefined));
        await mount(React.createElement(UsersPage), 'create=1');
        await setValue(dialog()!.querySelector<HTMLInputElement>('input[type="email"]')!, 'dup@x.test');
        await act(async () => { dialog()!.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
        await flush();
        expect(dialog()!.querySelector('[role="alert"]')!.textContent).toBe('Ya existe un usuario con ese correo.');
    });

    it('Escape cierra el formulario', async () => {
        await mount(React.createElement(UsersPage), 'create=1');
        expect(dialog()).not.toBeNull();
        await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
        await flush();
        expect(nav.search).not.toContain('create=');
        expect(dialogs()).toHaveLength(0);
    });
});

describe('AccountsPage', () => {
    it('renderiza cuentas con estado (texto), enmascara el id y aplica filtros en la URL', async () => {
        await mount(React.createElement(AccountsPage));
        expect(document.querySelector('h1')!.textContent).toBe('Cuentas vinculadas');
        const text = document.querySelector('table')!.textContent!;
        expect(text).toContain('Válido');
        expect(text).toContain('Sin credenciales');
        expect(text).toContain('123…90');
        expect(text).toContain('Calendario');
        expect(text).not.toMatch(/token_/);
        expect(document.body.textContent).toContain('No se puede saber si Google revocó el acceso');

        const l = Array.from(document.querySelectorAll('label')).find((x) => x.textContent === 'Estado del token')!;
        await setValue(document.getElementById(l.getAttribute('for')!) as HTMLSelectElement, 'revoked');
        expect(urls().at(-1)).toContain('status=revoked');
        expect(nav.search).toContain('status=revoked');
    });

    it('detalle: scopes e integraciones; desvincular y pedir reconexion con confirmacion', async () => {
        await mount(React.createElement(AccountsPage));
        await click(btn('Abrir detalle de la cuenta de Ann Zeta'));
        expect(nav.search).toContain('open=a1');
        const d = dialog()!;
        expect(d.textContent).toContain('https://www.googleapis.com/auth/calendar');
        expect(d.textContent).toContain('Sí (no se muestra)');
        expect(d.textContent).toContain('El administrador no puede hacerlo en su nombre');

        await click(btn('Pedir reconexión'));
        expect(dialogs().at(-1)!.textContent).toContain('Quien completa el OAuth es el propio usuario');
        await click(inDialog('Cancelar'));
        expect(callsTo('/reconnect')).toHaveLength(0);
        await click(btn('Pedir reconexión'));
        await click(inDialog('Pedir reconexión'));
        const [, init] = callsTo('/api/admin/accounts/a1/reconnect', 'POST')[0];
        expect(JSON.parse(init.body)).toEqual({ mode: 'reconnect' });

        await click(btn('Desvincular'));
        await click(inDialog('Cancelar'));
        expect(callsTo('/api/admin/accounts/a1', 'DELETE')).toHaveLength(0);
        await click(btn('Desvincular'));
        await click(inDialog('Desvincular'));
        expect(callsTo('/api/admin/accounts/a1', 'DELETE')).toHaveLength(1);
        expect(nav.search).not.toContain('open=');
    });

    it('Escape cierra el detalle', async () => {
        await mount(React.createElement(AccountsPage), 'open=a2');
        expect(dialog()!.textContent).toContain('Sin credenciales');
        await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
        await flush();
        expect(dialogs()).toHaveLength(0);
    });
});
