// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
const nav = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => nav.params, useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { BillingScreen } from '../BillingScreen';
import { markPending } from '../pending-purchase';
import { I18nProvider } from '@/components/I18nProvider';
import { ConsoleContext } from '@/components/admin/console';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();
const calls: { url: string; method: string; body: any }[] = [];
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const res = (status: number, body: any) => ({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(JSON.stringify(body)) });

const STATUS = { configured: true, env: 'sandbox', currency: 'USD', developerShareBps: 7000, platformShareBps: 3000, minPriceCents: 99, maxPriceCents: 99900, holdDays: 14, payoutMinCents: 1000, trialMaxDays: 30, tablesReady: true };
const SUMMARY = {
    range: { from: '2026-01-01', to: '2026-01-31' }, currency: 'USD',
    income: { grossCents: 10000, platformFeeCents: 3000, netCents: 7000, refundsCents: 500, salesCount: 4 },
    expenses: { purchasesCents: 1999, purchasesCount: 1, refundedCents: 0 },
    balance: { availableCents: 1234, heldCents: 5000, paidCents: 800, pendingPayoutCents: 0 },
    mrr: { cents: 2500, activeSubscribers: 5, churnedInRange: 1, trialing: 2 },
    byExtension: [{ extensionId: 'dev.acme.pro', salesCount: 4, grossCents: 10000, netCents: 7000, refundsCents: 500, activeSubscribers: 5 }],
};
let capture: { status: number; body: any };

function route(url: string, init: any) {
    const u = new URL(url, 'https://x.test');
    const p = u.pathname;
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method: init?.method ?? 'GET', body });
    if (p === '/api/admin/billing/status') return res(200, STATUS);
    if (p === '/api/admin/billing/summary') return res(200, SUMMARY);
    if (p === '/api/admin/billing/orders/capture') return res(capture.status, capture.body);
    if (p === '/api/admin/billing/subscriptions/confirm') return res(200, { status: 'ACTIVE', subscription: { extensionId: 'dev.acme.pro' }, install: { status: 'pending_approval' } });
    if (p === '/api/admin/billing/orders') return res(201, { kind: 'order', id: 'o9', approveUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=T9' });
    if (p === '/api/admin/extensions/catalog') return res(200, { extensions: [{ id: 'dev.acme.pro', name: 'Acme Pro', price: '5.00', currency: 'USD', isPaid: true, template: { permissions: ['crm.read'] } }] });
    if (p === '/api/admin/billing/paypal/account') return res(200, { linked: false, status: 'none', emailMasked: null, payoutsEnabled: false, linkedAt: null, pendingSince: null, switchEffectiveAt: null, previousEmailMasked: null });
    return res(404, {});
}

async function render(search: string) {
    nav.params = new URLSearchParams(search);
    await act(async () => {
        root.render(
            React.createElement(
                SWRConfig,
                { value: { provider: () => new Map(), dedupingInterval: 0 } },
                React.createElement(I18nProvider, {
                    locale: 'es',
                    children: React.createElement(
                        ConsoleContext.Provider,
                        { value: { me: null, domain: { id: 'dom1', name: 'mail.test', displayName: 'Mail', logo: null }, setDirty: () => undefined, setCrumbTail: () => undefined } },
                        React.createElement(BillingScreen),
                    ),
                }),
            ),
        );
    });
    await flush();
    await flush();
}

beforeEach(() => {
    calls.length = 0;
    capture = { status: 200, body: { status: 'CAPTURED', order: { id: 'o1', extensionId: 'dev.acme.pro', amountCents: 500, currency: 'USD' }, install: { status: 'installed' } } };
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init: any) => route(String(url), init));
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', '/admin/billing');
    window.sessionStorage.clear();
    markPending('order', 'o1'); markPending('order', 'o2'); markPending('subscription', 'I-SUB1');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    vi.unstubAllGlobals();
});

describe('resumen', () => {
    it('muestra ingresos, egresos, saldo, MRR y ventas por extension con importes exactos', async () => {
        await render('');
        const text = container.textContent ?? '';
        expect(text).toContain('Facturación');
        expect(text).toContain('100,00 USD'); // bruto
        expect(text).toContain('70,00 USD'); // neto
        expect(text).toContain('19,99 USD'); // egresos
        expect(text).toContain('12,34 USD'); // disponible
        expect(text).toContain('25,00 USD'); // MRR
        expect(text).toContain('dev.acme.pro');
        expect(container.querySelector('[role="tablist"]')).not.toBeNull();
        expect(calls.find((c) => c.url.includes('/summary'))!.url).toMatch(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);
    });
});

describe('retorno de PayPal', () => {
    it('?order=: captura con orderId y token del query y muestra pago + extension instalada', async () => {
        await render('order=o1&token=PAYPALTOKEN1');
        const cap = calls.find((c) => c.url.endsWith('/orders/capture'))!;
        expect(cap.method).toBe('POST');
        expect(cap.body).toEqual({ orderId: 'o1', token: 'PAYPALTOKEN1' });
        const text = container.textContent ?? '';
        expect(text).toContain('Pago completado');
        expect(text).toContain('Extensión instalada en tu dominio');
        const link = Array.from(container.querySelectorAll('a')).find((a) => a.getAttribute('href')?.startsWith('/admin/extensions?open='));
        expect(link?.getAttribute('href')).toBe('/admin/extensions?open=dev.acme.pro');
    });
    it('?order=: pago pendiente se explica sin darlo por fallido', async () => {
        capture = { status: 200, body: { status: 'PENDING', order: { id: 'o1', extensionId: 'dev.acme.pro', amountCents: 500, currency: 'USD' }, install: { status: 'skipped' } } };
        await render('order=o1');
        const text = container.textContent ?? '';
        expect(text).toContain('PayPal aún está procesando');
        expect(text).not.toContain('Extensión instalada');
    });
    it('?order=: pagada pero con permisos por aprobar y pagada con instalacion fallida', async () => {
        capture = { status: 200, body: { status: 'CAPTURED', order: { id: 'o1', extensionId: 'dev.acme.pro', amountCents: 500, currency: 'USD' }, install: { status: 'pending_approval' } } };
        await render('order=o1');
        expect(container.textContent).toContain('Falta aprobar sus permisos');
        await act(async () => { root.unmount(); });
        root = createRoot(container);
        capture = { status: 200, body: { status: 'CAPTURED', order: { id: 'o2', extensionId: 'dev.acme.pro', amountCents: 500, currency: 'USD' }, install: { status: 'failed', code: 'EXTENSION_INVALID' } } };
        await render('order=o2');
        expect(container.textContent).toContain('la instalación falló (EXTENSION_INVALID)');
    });
    it('?order=: pago fallido', async () => {
        capture = { status: 200, body: { status: 'FAILED', order: { id: 'o1', extensionId: 'dev.acme.pro', amountCents: 500, currency: 'USD' }, install: { status: 'skipped' } } };
        await render('order=o1');
        expect(container.textContent).toContain('El pago no se completó');
    });
    it('?subscription=: confirma la suscripcion', async () => {
        await render('subscription=I-SUB1');
        const confirm = calls.find((c) => c.url.endsWith('/subscriptions/confirm'))!;
        expect(confirm.body).toEqual({ subscriptionId: 'I-SUB1' });
        expect(container.textContent).toContain('Suscripción activa');
        expect(container.textContent).toContain('Falta aprobar sus permisos');
    });
    it('?order= / ?subscription= que este navegador no creo: aviso y ninguna llamada de captura', async () => {
        await render('order=zzz&token=TOK');
        expect(calls.some((c) => c.url.includes('/orders/capture'))).toBe(false);
        expect(container.textContent).toContain('no corresponde a un pago iniciado desde este navegador');
        await act(async () => { root.unmount(); });
        root = createRoot(container);
        await render('subscription=I-OTHER');
        expect(calls.some((c) => c.url.includes('/subscriptions/confirm'))).toBe(false);
    });
    it('?buy=: pide confirmacion con extension, plan, precio y permisos; no crea la orden hasta el clic', async () => {
        await render('buy=dev.acme.pro&plan=month');
        expect(calls.some((c) => c.url.endsWith('/billing/orders'))).toBe(false);
        const text = container.textContent ?? '';
        expect(text).toContain('Confirma la compra');
        expect(text).toContain('Acme Pro');
        expect(text).toContain('Mensual');
        expect(text).toContain('5,00 USD');
        expect(text).toContain('crm.read');
        const go = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Continuar a PayPal')!;
        await act(async () => { go.click(); });
        await flush();
        const created = calls.find((c) => c.url.endsWith('/billing/orders'))!;
        expect(created.body).toEqual({ extensionId: 'dev.acme.pro', plan: 'month' });
        const { isPending } = await import('../pending-purchase');
        expect(isPending('order', 'o9')).toBe(true);
    });
    it('&cancelled=1: no llama a capture ni a confirm', async () => {
        await render('order=o1&cancelled=1');
        expect(calls.some((c) => c.url.includes('/orders/capture') || c.url.includes('/subscriptions/confirm'))).toBe(false);
        expect(container.textContent).toContain('Cancelaste el pago');
    });
    it('parametros con formato raro no llegan al backend', async () => {
        await render('order=' + encodeURIComponent('../../x'));
        expect(calls.some((c) => c.url.includes('/orders/capture'))).toBe(false);
        expect(container.textContent).toContain('No se reconoció el enlace de retorno');
    });
    it('503 payments_not_configured => estado informativo, no error opaco', async () => {
        capture = { status: 503, body: { error: 'payments_not_configured', code: 'payments_not_configured' } };
        await render('order=o1');
        expect(container.textContent).toContain('Los pagos aún no están habilitados');
    });
    it('sin step-up reciente pide verificar la identidad y no reintenta solo', async () => {
        capture = { status: 403, body: { error: 'reauth_required', code: 'reauth_required' } };
        await render('order=o1');
        expect(container.textContent).toContain('Confirma tu identidad');
        expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent === 'Verificar identidad')).toBe(true);
        expect(calls.filter((c) => c.url.endsWith('/orders/capture'))).toHaveLength(1);
    });
    it('?paypal=linked abre la pestana de cuenta con el aviso', async () => {
        await render('paypal=linked');
        expect(container.textContent).toContain('Cuenta de PayPal vinculada correctamente');
        expect(container.textContent).toContain('Iniciar sesión con PayPal');
    });
    it('?paypal=error muestra el motivo acotado', async () => {
        await render('paypal=error&reason=access_denied');
        expect(container.textContent).toContain('No se pudo vincular la cuenta de PayPal');
        expect(container.textContent).toContain('access_denied');
    });
});

describe('instancia sin clave de firma', () => {
    it('signature_required => aviso claro y sin pestanas', async () => {
        fetchMock.mockImplementation(async () => res(403, { error: 'signature_required', code: 'signature_required' }));
        await render('');
        expect(container.textContent).toContain('no firma sus peticiones');
        expect(container.querySelector('[role="tablist"]')).toBeNull();
    });
});
