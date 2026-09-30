// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', async () => {
    const R = await import('react');
    return { default: ({ href, children, ...rest }: any) => R.createElement('a', { href, ...rest }, children) };
});

import { RetentionView } from '../retention/RetentionView';
import { I18nProvider } from '@/components/I18nProvider';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

const LIMITS = {
    spamDays: { min: 0, max: 3650 }, trashDays: { min: 0, max: 3650 }, rawDays: { min: 0, max: 3650 },
    auditDays: { min: 0, max: 3650, zeroOrMin: 30 }, secureMessageDays: { min: 0, max: 3650 }, batch: { min: 1, max: 1000 },
};
const ENV = { spamDays: 30, trashDays: 0, rawDays: 0, auditDays: 365, secureMessageDays: 30, batch: 200 };
let settings: any;
let quota: any;
const REPORT = { dryRun: true, spamEmails: 5, trashEmails: 1, rawPayloads: 0, secureMessages: 2, auditEventsPurged: 10, revocationsPurged: 0, extensionNotificationsPurged: 0, storageFailed: 0, sessionRowsPurged: 4 };
const STORAGE = {
    attachments: { count: 12, bytes: 5 * 1024 * 1024 },
    emailsByFolder: [{ folder: 'inbox', count: 40 }, { folder: 'spam', count: 6 }],
    topUsers: [{ userId: 'u1', email: 'big@user.com', bytes: 3 * 1024 * 1024, attachments: 8 }],
    tables: { userSessions: 9, auditEvents: 1234, oldestAuditAt: '2026-01-01T00:00:00.000Z', revokedSessions: 2 },
    policy: ENV,
    wouldDelete: REPORT,
};

const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const flush = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const setValue = async (el: HTMLInputElement, value: string) => {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    });
};
const click = async (el: Element | null | undefined) => {
    if (!el) throw new Error('elemento no encontrado');
    await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();
};
const btn = (text: string) => Array.from(document.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') || b.textContent || '').includes(text)) as HTMLButtonElement | undefined;
const input = (key: string) => document.querySelector<HTMLInputElement>(`#retention-${key}`)!;
const calls = (method: string, urlPart: string) => fetchMock.mock.calls.filter((c) => (c[1]?.method ?? 'GET') === method && String(c[0]).includes(urlPart));

async function mount() {
    await act(async () => {
        root.render(React.createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } },
            React.createElement(I18nProvider, { locale: 'es', children: React.createElement(RetentionView) })));
    });
    await flush();
}

beforeEach(() => {
    settings = { effective: { ...ENV, spamDays: 10 }, env: ENV, overrides: { spamDays: 10 }, updatedAt: '2026-09-01T00:00:00.000Z', updatedBy: 'b***@corp.com', limits: LIMITS };
    quota = { mailQuotaMb: null, enforceMailQuota: false, envMailQuotaMb: 500, effectiveMb: 500, source: 'env', updatedAt: null, updatedBy: null, maxMb: 10_000_000 };
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init?: any) => {
        const u = String(url);
        if (u.includes('/retention/quota') && init?.method === 'PUT') {
            const body = JSON.parse(init.body);
            if ('mailQuotaMb' in body) quota = { ...quota, mailQuotaMb: body.mailQuotaMb, effectiveMb: body.mailQuotaMb === null ? quota.envMailQuotaMb : body.mailQuotaMb || null, source: body.mailQuotaMb === null ? 'env' : 'console' };
            if ('enforceMailQuota' in body) quota = { ...quota, enforceMailQuota: body.enforceMailQuota === true };
            quota = { ...quota, updatedAt: '2026-09-03T00:00:00.000Z', updatedBy: 'b***@corp.com' };
            return json(200, quota);
        }
        if (u.includes('/retention/quota')) return json(200, quota);
        if (u.includes('/retention/settings') && init?.method === 'PUT') {
            const body = JSON.parse(init.body);
            const overrides = { ...settings.overrides };
            for (const [k, v] of Object.entries(body)) { if (v === null) delete (overrides as any)[k]; else (overrides as any)[k] = v; }
            settings = { ...settings, overrides, effective: { ...ENV, ...overrides }, updatedAt: '2026-09-02T00:00:00.000Z' };
            return json(200, settings);
        }
        if (u.includes('/retention/settings')) return json(200, settings);
        if (u.includes('/retention/run')) return json(200, { ...REPORT, dryRun: JSON.parse(init.body).dryRun });
        if (u.includes('/retention/storage')) return json(200, STORAGE);
        return json(404, {});
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

describe('Politicas', () => {
    it('muestra valor efectivo, origen (entorno/consola) y "volver a entorno" solo donde hay override', async () => {
        await mount();
        expect(input('spamDays').value).toBe('10');
        expect(input('trashDays').value).toBe('0');
        expect(input('auditDays').value).toBe('365');
        expect(document.querySelectorAll('button[aria-label^="Volver al valor del entorno"]')).toHaveLength(1);
        expect(container.textContent).toContain('Consola');
        expect(container.textContent).toContain('Entorno: 30');
        expect(container.textContent).toContain('Última modificación');
        // cada campo tiene label
        for (const k of ['spamDays', 'trashDays', 'rawDays', 'auditDays', 'secureMessageDays', 'batch']) {
            expect(document.querySelector(`label[for="retention-${k}"]`)).toBeTruthy();
        }
    });

    it('validacion accesible: auditDays 10 -> error, aria-invalid y Guardar deshabilitado', async () => {
        await mount();
        await setValue(input('auditDays'), '10');
        const err = document.querySelector('#retention-auditDays-err');
        expect(err?.getAttribute('role')).toBe('alert');
        expect(err?.textContent).toContain('al menos 30');
        expect(input('auditDays').getAttribute('aria-invalid')).toBe('true');
        expect(input('auditDays').getAttribute('aria-describedby')).toBe('retention-auditDays-err');
        expect(btn('Guardar cambios')!.disabled).toBe(true);
        await setValue(input('batch'), '5000');
        expect(document.querySelector('#retention-batch-err')?.textContent).toContain('entre 1 y 1000');
        await setValue(input('spamDays'), '1.5');
        expect(document.querySelector('#retention-spamDays-err')?.textContent).toContain('entero');
    });

    it('editar y guardar envia solo las claves cambiadas y confirma con un mensaje', async () => {
        await mount();
        expect(btn('Guardar cambios')!.disabled).toBe(true);
        await setValue(input('trashDays'), '15');
        expect(btn('Guardar cambios')!.disabled).toBe(false);
        await click(btn('Guardar cambios'));
        await flush();
        const put = calls('PUT', '/retention/settings');
        expect(put).toHaveLength(1);
        expect(JSON.parse(put[0][1].body)).toEqual({ trashDays: 15 });
        expect(container.querySelector('[role="status"]')?.textContent).toContain('Políticas guardadas');
        expect(input('trashDays').value).toBe('15');
        expect(document.querySelectorAll('button[aria-label^="Volver al valor del entorno"]')).toHaveLength(2);
    });

    it('"volver a entorno" envia null para esa clave', async () => {
        await mount();
        await click(document.querySelector('button[aria-label^="Volver al valor del entorno"]'));
        await flush();
        expect(JSON.parse(calls('PUT', '/retention/settings')[0][1].body)).toEqual({ spamDays: null });
        expect(input('spamDays').value).toBe('30');
        expect(document.querySelectorAll('button[aria-label^="Volver al valor del entorno"]')).toHaveLength(0);
    });

    it('un error del servidor al guardar se anuncia', async () => {
        await mount();
        fetchMock.mockImplementationOnce(async () => json(503, { code: 'settings_unavailable' }));
        await setValue(input('batch'), '50');
        await click(btn('Guardar cambios'));
        await flush();
        expect(container.textContent).toContain('Error del servidor');
    });
});

describe('Ejecutar ahora', () => {
    it('Simular va directo (sin confirmacion) y muestra el resultado en una tabla role=status', async () => {
        await mount();
        await click(btn('Simular'));
        await flush();
        const post = calls('POST', '/retention/run');
        expect(post).toHaveLength(1);
        expect(JSON.parse(post[0][1].body)).toEqual({ dryRun: true });
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        const region = Array.from(document.querySelectorAll('[role="status"]')).find((e) => e.querySelector('table'))!;
        expect(region.textContent).toContain('Simulación');
        expect(region.textContent).toContain('Correos en spam');
        expect(region.textContent).toContain('No se simula'); // revocaciones / notificaciones no se calculan en simulacion
        expect(region.querySelector('caption')?.textContent).toBe('Resultado de la purga');
    });

    it('Ejecutar ahora exige la frase EJECUTAR, avisa de lo irreversible y de cuanto se borraria', async () => {
        await mount();
        await click(btn('Simular'));
        await click(btn('Ejecutar ahora'));
        const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
        expect(dialog).toBeTruthy();
        expect(dialog.textContent).toContain('irreversible');
        expect(dialog.textContent).toContain('22 elementos'); // 5+1+0+2+10+4
        const confirm = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Ejecutar purga') as HTMLButtonElement;
        expect(confirm.disabled).toBe(true);
        const field = dialog.querySelector('input') as HTMLInputElement;
        expect(dialog.textContent).toContain('EJECUTAR');
        await setValue(field, 'EJECUTA');
        expect(confirm.disabled).toBe(true);
        expect(calls('POST', '/retention/run').filter((c) => JSON.parse(c[1].body).dryRun === false)).toHaveLength(0);
        await setValue(field, 'EJECUTAR');
        expect(confirm.disabled).toBe(false);
        await click(confirm);
        await flush();
        const real = calls('POST', '/retention/run').filter((c) => JSON.parse(c[1].body).dryRun === false);
        expect(real).toHaveLength(1);
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        const region = Array.from(document.querySelectorAll('[role="status"]')).find((e) => e.querySelector('table'))!;
        expect(region.textContent).toContain('Ejecución real');
        expect(region.textContent).toContain('Borrados');
    });

    it('sin simulacion previa lo dice, y Escape cierra sin ejecutar', async () => {
        await mount();
        await click(btn('Ejecutar ahora'));
        const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
        expect(dialog.textContent).toContain('No has simulado todavía');
        await act(async () => { dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
        await flush(600);
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(calls('POST', '/retention/run')).toHaveLength(0);
    });

    it('409 (purga en curso) y 429 se explican dentro del dialogo', async () => {
        await mount();
        fetchMock.mockImplementationOnce(async () => json(409, { code: 'run_in_progress' }));
        await click(btn('Ejecutar ahora'));
        const field = document.querySelector('[role="dialog"] input') as HTMLInputElement;
        await setValue(field, 'ejecutar');
        await click(Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => b.textContent === 'Ejecutar purga'));
        await flush();
        expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain('Ya hay una purga en curso');
        fetchMock.mockImplementationOnce(async () => json(429, { code: 'rate_limited' }));
        await click(Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => b.textContent === 'Ejecutar purga'));
        await flush();
        expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain('Demasiadas ejecuciones reales');
    });
});

describe('Almacenamiento', () => {
    it('muestra agregados con formatBytes, carpetas y top usuarios (con enlace), nunca contenido', async () => {
        await mount();
        const text = container.textContent || '';
        expect(text).toContain('5 MB');
        expect(text).toContain('inbox');
        expect(text).toContain('big@user.com');
        expect(text).toContain('3 MB');
        expect(container.querySelector('a[href="/admin/users?open=u1"]')).toBeTruthy();
        expect(text).toContain('Total: 22 elementos');
    });

    it('valores no disponibles se muestran como tal; error con reintento', async () => {
        fetchMock.mockImplementation(async (url: string) => {
            const u = String(url);
            if (u.includes('/retention/settings')) return json(200, settings);
            return json(200, { ...STORAGE, attachments: null, topUsers: null, emailsByFolder: null, wouldDelete: null, tables: { userSessions: null, auditEvents: null, oldestAuditAt: null, revokedSessions: null } });
        });
        await mount();
        expect((container.textContent || '').match(/No disponible/g)!.length).toBeGreaterThanOrEqual(5);
    });

    it('si falla la carga del almacenamiento muestra una alerta con Reintentar', async () => {
        fetchMock.mockImplementation(async (url: string) => (String(url).includes('/retention/settings') ? json(200, settings) : json(500, { code: 'internal' })));
        await mount();
        const alert = document.querySelector('#storage [role="alert"]');
        expect(alert?.textContent).toContain('Error del servidor');
        fetchMock.mockImplementation(async (url: string) => (String(url).includes('/retention/settings') ? json(200, settings) : json(200, STORAGE)));
        await click(Array.from(document.querySelectorAll('#storage button')).find((b) => b.textContent === 'Reintentar'));
        await flush();
        expect(container.textContent).toContain('big@user.com');
    });
});

describe('Cuota de buzon', () => {
    const mbInput = () => document.querySelector<HTMLInputElement>('#retention-quota-mb')!;
    const enforceBox = () => document.querySelector<HTMLInputElement>('#retention-quota-enforce')!;

    it('muestra la cuota vigente y su origen, con etiquetas asociadas y el bloqueo apagado por defecto', async () => {
        await mount();
        const card = document.querySelector('#quota')!;
        expect(card.querySelector('h2')?.textContent).toBe('Cuota de buzón');
        expect(mbInput().value).toBe('500');
        expect(document.querySelector('label[for="retention-quota-mb"]')).toBeTruthy();
        expect(document.querySelector('label[for="retention-quota-enforce"]')).toBeTruthy();
        expect(enforceBox().checked).toBe(false);
        expect(card.textContent).toContain('Vigente: 500 MB');
        expect(card.textContent).toContain('Entorno');
        expect(card.querySelector('button[aria-label*="cuota de buzón"]')).toBeNull(); // sin valor de consola no hay "volver a entorno"
    });

    it('guardar envia solo lo cambiado (con requireAdmin en la ruta) y confirma; despues ofrece volver a entorno', async () => {
        await mount();
        await setValue(mbInput(), '2048');
        await click(btn('Guardar cuota'));
        await flush();
        const put = calls('PUT', '/retention/quota');
        expect(put).toHaveLength(1);
        expect(JSON.parse(put[0][1].body)).toEqual({ mailQuotaMb: 2048 });
        expect(document.querySelector('#quota')!.textContent).toContain('Cuota guardada');
        expect(document.querySelector('#quota')!.textContent).toContain('Vigente: 2048 MB');

        await click(enforceBox());
        await click(btn('Guardar cuota'));
        await flush();
        expect(JSON.parse(calls('PUT', '/retention/quota')[1][1].body)).toEqual({ enforceMailQuota: true });
        expect(enforceBox().checked).toBe(true);

        await click(document.querySelector('#quota button[aria-label*="cuota de buzón"]'));
        await flush();
        expect(JSON.parse(calls('PUT', '/retention/quota')[2][1].body)).toEqual({ mailQuotaMb: null });
        expect(mbInput().value).toBe('500');
    });

    it('validacion accesible: no entero / fuera de rango -> alerta, aria-invalid y Guardar deshabilitado; 0 = sin limite y avisa si el bloqueo no tendra efecto', async () => {
        await mount();
        await setValue(mbInput(), '1.5');
        const err = document.querySelector('#retention-quota-mb-err');
        expect(err?.getAttribute('role')).toBe('alert');
        expect(mbInput().getAttribute('aria-invalid')).toBe('true');
        expect(mbInput().getAttribute('aria-describedby')).toBe('retention-quota-mb-err');
        expect(btn('Guardar cuota')!.disabled).toBe(true);
        await setValue(mbInput(), '99999999');
        expect(document.querySelector('#retention-quota-mb-err')?.textContent).toContain('10000000');
        await setValue(mbInput(), '0');
        expect(document.querySelector('#retention-quota-mb-err')).toBeNull();
        await click(enforceBox());
        expect(document.querySelector('#quota')!.textContent).toContain('el bloqueo no tendrá efecto');
        expect(btn('Guardar cuota')!.disabled).toBe(false);
    });

    it('un error del servidor al guardar se anuncia', async () => {
        await mount();
        await setValue(mbInput(), '100');
        fetchMock.mockImplementationOnce(async () => json(503, { code: 'settings_unavailable' }));
        await click(btn('Guardar cuota'));
        await flush();
        expect(document.querySelector('#quota')!.textContent).toContain('Error del servidor');
    });
});
