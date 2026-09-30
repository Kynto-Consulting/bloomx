// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminMailPage from '@/app/admin/(console)/mail/page';
import { BarChart } from '../MailCharts';
import { I18nProvider } from '@/components/I18nProvider';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();
const flush = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const METRICS = {
    range: '7d', granularity: 'day', since: '2030-01-01T00:00:00.000Z', generatedAt: '2030-01-07T12:00:00.000Z', domain: 'mail.acme.com',
    series: [
        { bucket: '2030-01-06', sent: 4, received: 9, bounces: 1, complaints: 0, unsubscribes: 0, spam: 2, blocked: 0 },
        { bucket: '2030-01-07', sent: 6, received: 3, bounces: 0, complaints: 1, unsubscribes: 2, spam: 0, blocked: 1 },
    ],
    totals: { sent: 10, received: 12, bounces: 1, complaints: 1, unsubscribes: 2, spam: 2, blocked: 1 },
    blockedAttachments: { available: true },
    scheduled: { pending: 2, overdue: 1, oldest: '2030-01-05T10:00:00.000Z' },
    quota: {
        limit: 200, windowMinutes: 60,
        topLastHour: [
            { userId: 'u1', email: 'heavy@acme.com', sentLastHour: 190, limit: 200, percent: 95 },
            { userId: 'u2', email: 'calm@acme.com', sentLastHour: 10, limit: 200, percent: 5 },
        ],
        topRange: [{ userId: 'u1', email: 'heavy@acme.com', sent: 10, received: 12, total: 22 }],
    },
};

const supp = (over: Record<string, unknown> = {}) => ({
    items: [
        { id: 's1', recipient: 'ana@ext.com', reason: 'bounce', createdAt: '2030-01-02T10:00:00.000Z', senderEmail: 'owner@acme.com' },
        { id: 's2', recipient: 'luis@ext.com', reason: 'unsubscribe', createdAt: '2030-01-01T10:00:00.000Z', senderEmail: null },
    ],
    page: 1, pageSize: 25, total: 2, pages: 1, ...over,
});

const WEBHOOKS = {
    baseUrl: 'https://mail.acme.com',
    inbound: { path: '/api/webhooks/resend', url: 'https://mail.acme.com/api/webhooks/resend', signatureConfigured: false, lastReceivedAt: '2030-01-07T09:00:00.000Z' },
    events: { path: '/api/webhooks/resend-events', url: 'https://mail.acme.com/api/webhooks/resend-events', signatureConfigured: true, lastEventAt: null },
};

const DNS = {
    configured: true, domain: 'mail.acme.com', checkedAt: '2030-01-07T12:00:00.000Z',
    spf: { status: 'ok', record: 'v=spf1 include:amazonses.com -all', notes: ['spf_hardfail', 'spf_sender_include'], includes: 1, lookups: 1 },
    dkim: { status: 'warn', record: 'v=DKIM1; k=rsa', notes: ['dkim_no_public_key'], selector: 'resend', selectorsTried: ['resend'] },
    dmarc: { status: 'missing', record: null, notes: ['dmarc_missing'], policy: null },
    mx: { status: 'error', record: null, notes: ['dns_error'], hosts: [] },
};

let routes: Record<string, (url: URL, init?: RequestInit) => ReturnType<typeof res>>;

beforeEach(() => {
    routes = {
        '/api/admin/mail/metrics': () => res(200, METRICS),
        '/api/admin/mail/suppressions': () => res(200, supp()),
        '/api/admin/mail/webhooks': () => res(200, WEBHOOKS),
        '/api/admin/mail/dns': () => res(200, DNS),
    };
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
        const url = new URL(input, 'http://localhost');
        const handler = routes[url.pathname] ?? (url.pathname.startsWith('/api/admin/mail/suppressions/') ? routes['/api/admin/mail/suppressions/*'] : undefined);
        if (!handler) return res(404, { code: 'not_found' });
        return handler(url, init);
    });
    vi.stubGlobal('fetch', fetchMock);
    window.location.hash = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    window.location.hash = '';
});

async function mount(locale: 'es' | 'en' = 'es') {
    await act(async () => {
        root.render(
            React.createElement(I18nProvider, {
                locale,
                children: React.createElement(SWRConfig, {
                    value: { provider: () => new Map(), dedupingInterval: 0 },
                    children: React.createElement(AdminMailPage),
                }),
            }),
        );
    });
    await flush();
    await flush();
}

/** Espera (sondeando) a que se cumpla la condicion: el debounce y SWR dependen de temporizadores reales. */
const until = async (cond: () => boolean, ms = 3000) => {
    const end = Date.now() + ms;
    while (!cond() && Date.now() < end) await flush(50);
};
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));
const text = () => container.textContent || '';
const click = async (el: Element | null | undefined) => {
    if (!el) throw new Error('elemento no encontrado');
    await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();
};
const setInput = async (el: HTMLInputElement, value: string) => {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    });
};
const setSelect = async (el: HTMLSelectElement, value: string) => {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, value);
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
};
const tab = (name: string) => Array.from(container.querySelectorAll('[role="tab"]')).find((t) => t.textContent === name) as HTMLElement;
const button = (name: string | RegExp, scope: ParentNode = document) =>
    Array.from(scope.querySelectorAll('button')).find((b) => {
        const label = b.getAttribute('aria-label') || b.textContent || '';
        return typeof name === 'string' ? label.includes(name) : name.test(label);
    }) as HTMLButtonElement | undefined;
const byLabel = (label: string) => container.querySelector<HTMLElement>(`[aria-label="${label}"]`) as HTMLInputElement;

async function openTab(name: string) {
    // Radix activa la pestana con mousedown (clic principal), no con click.
    await act(async () => {
        const t = tab(name);
        t.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ctrlKey: false }));
        t.focus();
    });
    await flush();
    await flush();
}

describe('Correo: Resumen', () => {
    it('render de metricas con datos falsos y pestanas accesibles', async () => {
        await mount();
        expect(container.querySelector('h1')?.textContent).toBe('Correo');
        const list = container.querySelector('[role="tablist"]')!;
        expect(list.getAttribute('aria-label')).toBe('Secciones de correo');
        expect(Array.from(container.querySelectorAll('[role="tab"]')).map((t) => t.textContent)).toEqual(['Resumen', 'Cuotas', 'Supresión', 'Webhooks', 'Salud DNS']);
        expect(tab('Resumen').getAttribute('aria-selected')).toBe('true');
        const stats = container.querySelector('[data-testid="mail-stats"]')!.textContent!;
        expect(stats).toContain('Enviados10');
        expect(stats).toContain('Recibidos12');
        expect(stats).toContain('Rebotes1');
        expect(stats).toContain('Quejas1');
        expect(stats).toContain('Bajas2');
        expect(stats).toContain('Spam2');
        expect(stats).toContain('Adjuntos bloqueados1');
        expect(text()).toContain('Dominio de la instancia: mail.acme.com');
        expect(text()).toContain('Cola de programados');
        expect(text()).toContain('Vencidos');
        // tabla textual alternativa para lectores de pantalla
        const tables = container.querySelectorAll('figure table.sr-only');
        expect(tables.length).toBe(2);
        expect(tables[0].querySelector('caption')?.textContent).toContain('Volumen de correo');
        expect(tables[0].textContent).toContain('2030-01-07');
        expect(urls()).toContain('/api/admin/mail/metrics?range=7d');
    });

    it('cambio de rango vuelve a pedir las metricas', async () => {
        await mount();
        const sel = container.querySelector<HTMLSelectElement>('select')!;
        expect(sel.value).toBe('7d');
        await setSelect(sel, '24h');
        expect(urls()).toContain('/api/admin/mail/metrics?range=24h');
        await setSelect(container.querySelector<HTMLSelectElement>('select')!, '30d');
        expect(urls()).toContain('/api/admin/mail/metrics?range=30d');
    });

    it('adjuntos bloqueados no disponibles: lo dice (no inventa datos)', async () => {
        routes['/api/admin/mail/metrics'] = () => res(200, { ...METRICS, blockedAttachments: { available: false }, totals: { ...METRICS.totals, blocked: 0 } });
        await mount();
        const stats = container.querySelector('[data-testid="mail-stats"]')!.textContent!;
        expect(stats).toContain('Adjuntos bloqueadosNo disponible');
        expect(stats).toContain('No hay registro persistente');
    });

    it('error de carga: alerta y reintento', async () => {
        let fail = true;
        routes['/api/admin/mail/metrics'] = () => (fail ? res(500, { code: 'internal' }) : res(200, METRICS));
        await mount();
        const alert = container.querySelector('[role="alert"]')!;
        expect(alert.textContent).toContain('No se pudieron cargar las métricas de correo.');
        fail = false;
        await click(button('Reintentar', container));
        expect(container.querySelector('[role="alert"]')).toBeNull();
        expect(container.querySelector('[data-testid="mail-stats"]')).not.toBeNull();
    });

    it('nunca pide ni muestra contenido de mensajes', async () => {
        await mount();
        for (const th of Array.from(container.querySelectorAll('th'))) expect(th.textContent).not.toMatch(/asunto|subject|cuerpo|body|adjunto/i);
        for (const u of urls()) expect(u).not.toMatch(/subject|body|emails\?/);
    });

    it('en ingles', async () => {
        await mount('en');
        expect(container.querySelector('h1')?.textContent).toBe('Mail');
        expect(text()).toContain('Sent');
        expect(text()).toContain('Scheduled queue');
    });
});

describe('Correo: teclado en las pestanas', () => {
    it('flecha derecha mueve el foco y activa la siguiente pestana', async () => {
        await mount();
        const first = tab('Resumen');
        await act(async () => { first.focus(); });
        await act(async () => { first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
        await flush();
        expect(document.activeElement).toBe(tab('Cuotas'));
        expect(tab('Cuotas').getAttribute('aria-selected')).toBe('true');
        expect(text()).toContain('Cuotas y envíos por hora');
    });
});

describe('Correo: Cuotas', () => {
    it('tabla de uso con barra y Badge cerca del limite', async () => {
        await mount();
        await openTab('Cuotas');
        expect(text()).toContain('heavy@acme.com');
        expect(text()).toContain('Cerca del límite');
        expect(text()).toContain('Normal');
        expect(text()).toContain('190 de 200 (95 %)');
        expect(text()).toContain('Límite por usuario: 200 envíos por hora');
        const bars = container.querySelectorAll('[role="progressbar"]');
        expect(bars).toHaveLength(2);
        expect(bars[0].getAttribute('aria-valuenow')).toBe('95');
        expect(container.querySelectorAll('table caption')[0].textContent).toBe('Envíos por usuario en la última hora');
        expect(text()).toContain('Usuarios con más volumen en el periodo');
    });

    it('en el limite muestra "En el límite"', async () => {
        routes['/api/admin/mail/metrics'] = () => res(200, { ...METRICS, quota: { ...METRICS.quota, topLastHour: [{ userId: 'u1', email: 'x@acme.com', sentLastHour: 200, limit: 200, percent: 100 }] } });
        await mount();
        await openTab('Cuotas');
        expect(text()).toContain('En el límite');
    });
});

describe('Correo: Supresion', () => {
    it('la ancla #suppression abre la pestana y lista destinatarios, motivo y remitente', async () => {
        window.location.hash = '#suppression';
        await mount();
        expect(tab('Supresión').getAttribute('aria-selected')).toBe('true');
        expect(container.querySelector('#suppression')).not.toBeNull();
        const table = container.querySelector('#suppression table')!;
        expect(table.querySelector('caption')?.textContent).toBe('Destinatarios suprimidos');
        expect(table.textContent).toContain('ana@ext.com');
        expect(table.textContent).toContain('Rebote');
        expect(table.textContent).toContain('owner@acme.com');
        expect(table.textContent).toContain('Usuario eliminado');
        expect(table.textContent).toContain('Baja');
    });

    it('filtro por motivo y busqueda con debounce viajan como parametros', async () => {
        window.location.hash = '#suppression';
        await mount();
        const reason = Array.from(container.querySelectorAll<HTMLSelectElement>('#suppression select')).find((s) => s.closest('div')?.querySelector('label')?.textContent === 'Motivo')!;
        await setSelect(reason, 'bounce');
        expect(urls().some((u) => u.includes('/suppressions?') && u.includes('reason=bounce'))).toBe(true);
        await setInput(byLabel('Buscar destinatario o remitente') as HTMLInputElement, 'ana@');
        await until(() => urls().some((u) => u.includes('reason=bounce') && u.includes('q=ana%40')));
        expect(urls().some((u) => u.includes('reason=bounce') && u.includes('q=ana%40'))).toBe(true);
        // "Quitar filtros" no existe aqui, pero el boton de limpiar de la busqueda si
        await click(button('Limpiar', container));
        await until(() => !String(urls().at(-1)).includes('q='));
        expect(urls().at(-1)).not.toContain('q=');
    });

    it('vacio con filtros y sin filtros', async () => {
        routes['/api/admin/mail/suppressions'] = () => res(200, supp({ items: [], total: 0, pages: 1 }));
        window.location.hash = '#suppression';
        await mount();
        expect(text()).toContain('No hay destinatarios suprimidos.');
    });

    it('seleccion masiva y quitar con confirmacion que avisa de que volveran a recibir correo', async () => {
        const calls: { url: string; init?: RequestInit }[] = [];
        routes['/api/admin/mail/suppressions/bulk-delete'] = (url, init) => { calls.push({ url: url.pathname, init }); return res(200, { ok: true, removed: 2, requested: 2 }); };
        // bulk-delete es una ruta distinta de /suppressions/* (se resuelve por pathname exacto)
        window.location.hash = '#suppression';
        await mount();
        const all = container.querySelector<HTMLInputElement>('#suppression thead input[type="checkbox"]')!;
        await click(all);
        expect(text()).toContain('2 seleccionado(s)');
        expect(button('Quitar seleccionadas (2)', container)).toBeTruthy();
        await click(button('Quitar seleccionadas (2)', container));
        const dialog = document.querySelector('[role="dialog"]')!;
        expect(dialog).not.toBeNull();
        expect(dialog.textContent).toContain('¿Quitar de la lista de supresión?');
        expect(dialog.textContent).toContain('volverán a poder recibir correos');
        expect(calls).toHaveLength(0); // aun no se ha llamado
        await click(button('Quitar de la lista', dialog));
        expect(calls).toHaveLength(1);
        expect(calls[0].init?.method).toBe('POST');
        expect(JSON.parse(String(calls[0].init?.body))).toEqual({ ids: ['s1', 's2'] });
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(container.querySelector('[role="status"]:not(:empty)')?.textContent).toContain('2 supresiones eliminadas.');
    });

    it('quitar una fila: DELETE con el id y mensaje del destinatario; Escape cancela sin llamar', async () => {
        const del = vi.fn((url: URL, init?: RequestInit) => res(200, { ok: true, removed: 1 }));
        routes['/api/admin/mail/suppressions/*'] = del;
        window.location.hash = '#suppression';
        await mount();
        await click(button('Quitar supresión de ana@ext.com', container));
        let dialog = document.querySelector('[role="dialog"]')!;
        expect(dialog.textContent).toContain('ana@ext.com volverá a poder recibir correos');
        await act(async () => { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
        await flush();
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(del).not.toHaveBeenCalled();

        await click(button('Quitar supresión de ana@ext.com', container));
        dialog = document.querySelector('[role="dialog"]')!;
        await click(button('Quitar de la lista', dialog));
        expect(del).toHaveBeenCalledTimes(1);
        expect(del.mock.calls[0][0].pathname).toBe('/api/admin/mail/suppressions/s1');
        expect(del.mock.calls[0][1]?.method).toBe('DELETE');
        expect(container.querySelector('[role="status"]:not(:empty)')?.textContent).toContain('Supresión eliminada.');
    });

    it('error al quitar: el dialogo sigue abierto con el mensaje', async () => {
        routes['/api/admin/mail/suppressions/*'] = () => res(404, { code: 'not_found' });
        window.location.hash = '#suppression';
        await mount();
        await click(button('Quitar supresión de luis@ext.com', container));
        const dialog = document.querySelector('[role="dialog"]')!;
        await click(button('Quitar de la lista', dialog));
        const d2 = document.querySelector('[role="dialog"]')!;
        expect(d2).not.toBeNull();
        expect(d2.querySelector('[role="alert"]')?.textContent).toContain('No se encontró el elemento');
    });

    it('mas de 100 seleccionadas: el boton queda desactivado con aviso', async () => {
        const many = Array.from({ length: 101 }, (_, i) => ({ id: `id${i}`, recipient: `r${i}@x.com`, reason: 'bounce', createdAt: null, senderEmail: null }));
        routes['/api/admin/mail/suppressions'] = () => res(200, supp({ items: many, total: 101, pageSize: 100, pages: 2 }));
        window.location.hash = '#suppression';
        await mount();
        await click(container.querySelector('#suppression thead input[type="checkbox"]'));
        const btn = button('Quitar seleccionadas (101)', container)!;
        expect(btn.disabled).toBe(true);
        expect(container.querySelector('[role="alert"]')?.textContent).toContain('hasta 100 a la vez');
    });
});

describe('Correo: Webhooks', () => {
    it('estado sin secretos: firma opcional, firma verificada, rutas y fechas; copiar', async () => {
        const writeText = vi.fn(async () => undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        window.location.hash = '#webhooks';
        await mount();
        const t = text();
        expect(t).toContain('Sin firma (opcional)');
        expect(t).toContain('Firma verificada');
        expect(t).toContain('https://mail.acme.com/api/webhooks/resend');
        expect(t).toContain('https://mail.acme.com/api/webhooks/resend-events');
        expect(t).toContain('Nunca'); // sin eventos de entrega
        expect(container.querySelectorAll('code')).toHaveLength(2);
        expect(t).not.toMatch(/whsec_/);
        // "sin firma" no se presenta como error
        expect(container.querySelector('[role="alert"]')).toBeNull();
        await click(button('Copiar ruta: Correo entrante', container));
        expect(writeText).toHaveBeenCalledWith('https://mail.acme.com/api/webhooks/resend');
        expect(container.textContent).toContain('Ruta copiada');
    });

    it('sin URL publica muestra la ruta relativa', async () => {
        routes['/api/admin/mail/webhooks'] = () => res(200, { ...WEBHOOKS, baseUrl: null, inbound: { ...WEBHOOKS.inbound, url: null }, events: { ...WEBHOOKS.events, url: null } });
        window.location.hash = '#webhooks';
        await mount();
        expect(text()).toContain('/api/webhooks/resend-events');
        expect(text()).toContain('define NEXT_PUBLIC_APP_URL');
    });
});

describe('Correo: Salud DNS', () => {
    it('la ancla #dns abre la pestana; tarjetas con estado en texto, registro en <code> y notas traducidas', async () => {
        window.location.hash = '#dns';
        await mount();
        expect(tab('Salud DNS').getAttribute('aria-selected')).toBe('true');
        expect(container.querySelector('#dns')).not.toBeNull();
        expect(container.querySelector('[role="note"]')?.textContent).toContain('solo lectura');
        const cards = ['dns-spf', 'dns-dkim', 'dns-dmarc', 'dns-mx'].map((id) => container.querySelector(`#${id}`)!);
        expect(cards.every(Boolean)).toBe(true);
        expect(cards[0].textContent).toContain('Correcto');
        expect(cards[0].querySelector('code')?.textContent).toBe('v=spf1 include:amazonses.com -all');
        expect(cards[0].textContent).toContain('Termina en -all');
        expect(cards[0].textContent).toContain('1 include(s), 1 consulta(s) DNS');
        expect(cards[1].textContent).toContain('Revisar');
        expect(cards[1].textContent).toContain('no contiene la clave pública');
        expect(cards[1].textContent).toContain('Selector: resend');
        expect(cards[2].textContent).toContain('No encontrado');
        expect(cards[2].textContent).toContain('Sin registro');
        expect(cards[2].querySelector('code')).toBeNull();
        expect(cards[3].textContent).toContain('Error de consulta');
        expect(cards[3].textContent).toContain('La consulta DNS falló');
        expect(text()).toContain('Dominio: mail.acme.com');
    });

    it('selector invalido: error y no se consulta; valido: fresh=1 con el selector', async () => {
        window.location.hash = '#dns';
        await mount();
        const before = urls().length;
        const input = container.querySelector<HTMLInputElement>('#dns input')!;
        await setInput(input, 'Mi Selector!');
        await click(button('Comprobar de nuevo', container));
        expect(container.querySelector('#dns [role="alert"]')?.textContent).toContain('Usa minúsculas');
        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(urls().length).toBe(before);

        await setInput(input, 'Selector-1');
        await click(button('Comprobar de nuevo', container));
        await flush();
        expect(urls().at(-1)).toBe('/api/admin/mail/dns?selector=selector-1&fresh=1');
        expect(container.querySelector('#dns [role="alert"]')).toBeNull();
    });

    it('comprobar de nuevo sin selector usa fresh=1', async () => {
        window.location.hash = '#dns';
        await mount();
        await click(button('Comprobar de nuevo', container));
        await flush();
        expect(urls().at(-1)).toBe('/api/admin/mail/dns?fresh=1');
    });

    it('dominio sin configurar', async () => {
        routes['/api/admin/mail/dns'] = () => res(200, { configured: false, domain: null, checkedAt: 'x', spf: null, dkim: null, dmarc: null, mx: null });
        window.location.hash = '#dns';
        await mount();
        expect(text()).toContain('no está configurado');
        expect(container.querySelector('#dns-spf')).toBeNull();
    });
});

describe('BarChart', () => {
    it('sin datos muestra texto; con datos la grafica es decorativa y hay tabla alternativa', async () => {
        await act(async () => {
            root.render(React.createElement(I18nProvider, {
                locale: 'es',
                children: React.createElement('div', null,
                    React.createElement(BarChart, { title: 'Vacia', series: [{ key: 'a', label: 'A', className: 'bg-primary' }], points: [{ bucket: '2030-01-01', values: { a: 0 } }] }),
                    React.createElement(BarChart, { title: 'Llena', series: [{ key: 'a', label: 'A', className: 'bg-primary' }], points: [{ bucket: '2030-01-01T05', values: { a: 3 } }, { bucket: '2030-01-01T06', values: { a: 6 } }] }),
                ),
            }));
        });
        const figures = container.querySelectorAll('figure');
        expect(figures[0].textContent).toContain('Sin actividad en este periodo.');
        expect(figures[1].querySelector('[aria-hidden="true"] .bg-primary')).not.toBeNull();
        expect(figures[1].querySelector('table.sr-only')?.textContent).toContain('6');
        expect(figures[1].textContent).toContain('05:00');
    });
});
