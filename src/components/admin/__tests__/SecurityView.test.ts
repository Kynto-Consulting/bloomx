// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', async () => {
    const R = await import('react');
    return { default: ({ href, children, ...rest }: any) => R.createElement('a', { href, ...rest }, children) };
});

import { SecurityView } from '../security/SecurityView';
import { I18nProvider } from '@/components/I18nProvider';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

const STATUS = {
    generatedAt: '2026-09-30T10:00:00.000Z',
    checks: [
        { id: 'admin_emails', group: 'admins', status: 'ok', code: 'admins.configured', params: { count: 2 } },
        { id: 'mfa_policy', group: 'admins', status: 'fail', code: 'mfa.admin_not_enforced' },
        { id: 'mfa_enrolled', group: 'admins', status: 'warn', code: 'mfa.admins_missing', params: { count: 1 } },
        { id: 'session_limits', group: 'session', status: 'ok', code: 'session.limits_ok', params: { ttlHours: 24, absoluteDays: 14 } },
        { id: 'cron_secret', group: 'config', status: 'warn', code: 'config.cron_secret_missing' },
        { id: 'webhook_secret', group: 'config', status: 'info', code: 'config.webhook_secret_unset' },
        { id: 'domain_signing', group: 'config', status: 'warn', code: 'config.signing_legacy' },
        { id: 'login_failures', group: 'events', status: 'warn', code: 'events.login_failures_high', params: { count: 25 } },
        { id: 'futuro', group: 'events', status: 'info', code: 'events.codigo_desconocido' },
    ],
    admins: [
        { email: 'boss@corp.com', userId: 'u1', mfaEnabled: true },
        { email: 'nomfa@corp.com', userId: 'u2', mfaEnabled: false },
        { email: 'ghost@corp.com', userId: null, mfaEnabled: null },
    ],
    mfaPolicy: { enforceAdmin: false, requiredAll: false, available: true },
    session: { ttlSeconds: 86400, absoluteMaxSeconds: 14 * 86400 },
    config: { domainSigning: false },
    events: {
        available: true,
        last24h: { 'auth.login.failure': 25, 'admin.access_denied': 1 },
        last7d: { 'auth.login.failure': 40, 'admin.access_denied': 2 },
        recent: [{ id: 'e1', ts: '2026-09-30T09:00:00.000Z', event: 'auth.login.failure', userId: null, ip: '203.0.x.x', reason: 'bad_password' }],
    },
    counts: { disabledUsers: 2, mustChangePassword: 1, activeSessions: 6 },
};

const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const flush = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const btn = (text: string) => Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes(text)) as HTMLButtonElement | undefined;

async function mount(locale: 'es' | 'en' = 'es') {
    await act(async () => {
        root.render(React.createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } },
            React.createElement(I18nProvider, { locale, children: React.createElement(SecurityView) })));
    });
    await flush();
}

beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => json(200, STATUS));
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

describe('SecurityView', () => {
    it('lista las comprobaciones con estado en TEXTO, titulo traducido y recomendacion', async () => {
        await mount();
        const items = Array.from(container.querySelectorAll('li[data-status]'));
        expect(items).toHaveLength(STATUS.checks.length);
        const byStatus = (s: string) => items.filter((i) => i.getAttribute('data-status') === s);
        expect(byStatus('fail')[0].textContent).toContain('Crítico');
        expect(byStatus('fail')[0].textContent).toContain('MFA de administradores desactivado');
        expect(byStatus('fail')[0].textContent).toContain('MFA_ENFORCE_ADMIN=false');
        expect(byStatus('warn').map((i) => i.textContent).join(' ')).toContain('1 administrador(es) sin MFA activado');
        expect(byStatus('warn')[0].textContent).toContain('Aviso');
        expect(byStatus('info')[0].textContent).toContain('Informativo');
        expect(byStatus('ok')[0].textContent).toContain('Correcto');
        // interpolacion de parametros
        expect(container.textContent).toContain('24 h de inactividad y 14 d de tope absoluto');
        expect(container.textContent).toContain('25 inicios de sesión fallidos en 24 h');
        // un codigo futuro sin traduccion no rompe la pantalla (muestra el codigo)
        expect(container.textContent).toContain('events.codigo_desconocido');
        expect(container.textContent).toContain('1 crítico(s) y 4 aviso(s)');
    });

    it('modo heredado de firma es un aviso con recomendacion y enlace a la clave de firma', async () => {
        await mount();
        const item = container.querySelector('li[data-status]:has(a[href="/admin/profile#signing-key"])')!;
        expect(item.textContent).toContain('Modo heredado');
        expect(item.textContent).toContain('válido y soportado');
        expect(item.getAttribute('data-status')).toBe('warn');
    });

    it('tabla de administradores y MFA con enlaces a usuarios', async () => {
        await mount();
        const table = Array.from(container.querySelectorAll('table')).find((t) => t.querySelector('caption')?.textContent === 'Administradores y estado de MFA')!;
        expect(table.querySelectorAll('th[scope="col"]')).toHaveLength(3);
        const rows = Array.from(table.querySelectorAll('tbody tr')).map((r) => r.textContent);
        expect(rows[0]).toContain('boss@corp.com');
        expect(rows[0]).toContain('Activo');
        expect(rows[1]).toContain('No activo');
        expect(rows[2]).toContain('Sin cuenta');
        expect(table.querySelector('a[href="/admin/users?open=u1"]')).toBeTruthy();
        expect(table.querySelector('a[href="/admin/users?open=u2"]')).toBeTruthy();
        expect(table.querySelectorAll('a')).toHaveLength(2);
        expect(container.textContent).toContain('ADMIN_EMAILS');
    });

    it('tarjetas de conteos y eventos con enlaces a /admin/audit?event=', async () => {
        await mount();
        const text = container.textContent || '';
        expect(text).toContain('Sesiones activas');
        expect(text).toContain('Usuarios deshabilitados');
        expect(text).toContain('Cambio de contraseña pendiente');
        expect(container.querySelector('a[href="/admin/audit?event=auth.login.failure"]')).toBeTruthy();
        expect(container.querySelector('a[href="/admin/audit?event=admin.access_denied"]')).toBeTruthy();
        expect(text).toContain('203.0.x.x');
        expect(text).toContain('bad_password');
    });

    it('conteos nulos se muestran como "No disponible" y sin auditoria se explica', async () => {
        fetchMock.mockImplementation(async () => json(200, {
            ...STATUS, counts: { disabledUsers: null, mustChangePassword: null, activeSessions: null },
            events: { available: false, last24h: {}, last7d: {}, recent: [] },
        }));
        await mount();
        expect((container.textContent || '').match(/No disponible/g)!.length).toBeGreaterThanOrEqual(3);
        expect(container.textContent).toContain('La auditoría no está disponible');
    });

    it('Actualizar es un boton operable por teclado que vuelve a pedir el estado', async () => {
        await mount();
        const refresh = btn('Actualizar')!;
        expect(refresh.tagName).toBe('BUTTON');
        refresh.focus();
        expect(document.activeElement).toBe(refresh);
        const before = fetchMock.mock.calls.length;
        await act(async () => { refresh.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
        await flush();
        expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
        // todos los enlaces son tab-stops normales (sin tabindex negativo)
        for (const a of Array.from(container.querySelectorAll('a'))) expect(a.getAttribute('tabindex')).toBeNull();
    });

    it('error 403 muestra alerta traducida con reintento', async () => {
        fetchMock.mockImplementation(async () => json(403, { code: 'forbidden' }));
        await mount();
        expect(container.querySelector('[role="alert"]')?.textContent).toContain('No tienes permiso');
        expect(btn('Reintentar')).toBeTruthy();
    });

    it('todo correcto: resumen sin problemas; en ingles traduce', async () => {
        fetchMock.mockImplementation(async () => json(200, { ...STATUS, checks: STATUS.checks.filter((c) => c.status === 'ok') }));
        await mount('en');
        expect(container.querySelector('[role="status"]')?.textContent).toContain('No problems detected.');
        expect(container.textContent).toContain('Administrators and MFA');
    });
});
