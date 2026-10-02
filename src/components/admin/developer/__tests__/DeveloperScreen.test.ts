// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { DeveloperScreen } from '../DeveloperScreen';
import { I18nProvider } from '@/components/I18nProvider';
import { ConsoleContext } from '@/components/admin/console';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();
const calls: { url: string; method: string; body: any }[] = [];
const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const res = (status: number, body: any) => ({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(JSON.stringify(body)) });

let overview: any;
let validate: any;

const baseOverview = () => ({
    slug: 'mail-test', idPrefix: 'dev.mail-test.',
    terms: { requiredVersion: '2026-01', acceptedVersion: '2026-01', acceptedAt: '2026-02-01T10:00:00Z' },
    paypal: { status: 'linked', emailMasked: 'd***@x.com' },
    shares: { developerBps: 7000, platformBps: 3000 },
    limits: { minPriceCents: 99, maxPriceCents: 99900, maxServerBytes: 1_000_000, maxManifestBytes: 100_000, maxIconBytes: 100_000, maxReadmeBytes: 100_000 },
    extensions: [{
        id: 'dev.mail-test.demo', name: 'Demo', pricing: { model: 'subscription', monthCents: 500, trialDays: 7 }, status: 'private', latestVersion: '1.0.0',
        versions: [
            { version: '1.0.0', status: 'approved', changelog: 'primera', submittedAt: '2026-01-02T00:00:00Z', reviewedAt: '2026-01-03T00:00:00Z', reviewNote: 'Todo bien, pero revisa el permiso HTTP.', analysis: { risk: 'medium', findings: [] }, submissionId: 'sub1' },
        ],
    }],
});
const baseValidate = () => ({
    ok: false,
    issues: [{ path: 'permissions[1]', message: 'Permiso desconocido: FOO', severity: 'error' }, { path: 'description', message: 'Descripcion corta', severity: 'warning' }],
    analysis: { risk: 'high', findings: [{ id: 'net', severity: 'warning', message: 'Hace peticiones HTTP', path: 'server.js' }] },
    versioning: { lastVersion: '1.0.0', increases: true, suggested: { patch: '1.0.1', minor: '1.1.0', major: '2.0.0' }, changelogRequired: true },
    permissionsDiff: { added: ['HTTP_REQUEST'], removed: [], unchanged: ['READ_EMAIL'] },
});

function route(url: string, init: any) {
    const p = new URL(url, 'https://x.test').pathname;
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method: init?.method ?? 'GET', body });
    if (p === '/api/admin/developer/overview') return res(200, overview);
    if (p === '/api/admin/developer/validate') return res(200, validate);
    if (p === '/api/admin/developer/submissions/sub1/publish') return res(200, { ok: true });
    if (p === '/api/admin/developer/terms') return res(200, { ok: true });
    return res(404, {});
}

async function render() {
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
                        React.createElement(DeveloperScreen),
                    ),
                }),
            ),
        );
    });
    await wait(0);
    await wait(0);
}

beforeEach(() => {
    calls.length = 0;
    overview = baseOverview();
    validate = baseValidate();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init: any) => route(String(url), init));
    vi.stubGlobal('fetch', fetchMock);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    vi.unstubAllGlobals();
});

const button = (label: string) => Array.from(container.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === label) as HTMLButtonElement | undefined;

async function dropManifest(content: string) {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([content], 'manifest.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await wait(50);
}

describe('portal de desarrolladores', () => {
    it('muestra identificador, prefijo, terminos aceptados, enlaces a /docs y la extension con su version y nota del revisor', async () => {
        await render();
        const text = container.textContent ?? '';
        expect(text).toContain('Portal de desarrolladores');
        expect(text).toContain('dev.mail-test.');
        expect(text).toContain('Aceptaste la versión 2026-01');
        expect(text).toContain('Todo bien, pero revisa el permiso HTTP.');
        const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
        expect(hrefs).toContain('/docs/developer-guide');
        expect(hrefs).toContain('/docs/billing-guide');
    });

    it('con la publicacion de terceros desactivada en el backend muestra el estado claro y oculta terminos y editor', async () => {
        overview.thirdPartyEnabled = false;
        await render();
        const banner = container.querySelector('[data-testid="bx-dev-disabled"]');
        expect(banner?.textContent).toContain('Publicación de terceros desactivada');
        expect(container.textContent).not.toContain('Aceptaste la versión');
        expect(container.querySelector('input[type="file"]')).toBeNull();
        expect(container.textContent).toContain('Todo bien, pero revisa el permiso HTTP.'); // lo existente sigue visible
    });

    it('con thirdPartyEnabled=true (o ausente, backend antiguo) no muestra el aviso y mantiene el editor', async () => {
        overview.thirdPartyEnabled = true;
        await render();
        expect(container.querySelector('[data-testid="bx-dev-disabled"]')).toBeNull();
        expect(container.querySelector('input[type="file"]')).not.toBeNull();
    });

    it('sin aceptar los terminos vigentes ofrece aceptarlos con la version exigida', async () => {
        overview.terms = { requiredVersion: '2026-02', acceptedVersion: '2026-01', acceptedAt: '2026-02-01T10:00:00Z' };
        await render();
        expect(container.textContent).toContain('la vigente es la 2026-02');
        const accept = button('Aceptar términos')!;
        expect(accept.disabled).toBe(true);
        const check = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
        await act(async () => { check.click(); });
        expect(button('Aceptar términos')!.disabled).toBe(false);
        await act(async () => { button('Aceptar términos')!.click(); });
        await wait(0);
        expect(calls.find((c) => c.url.endsWith('/developer/terms'))!.body).toEqual({ version: '2026-02' });
    });

    it('valida en vivo con debounce, rellena id y version, y muestra errores por ruta, riesgo, versionado y permisos', async () => {
        await render();
        await dropManifest('{"id":"dev.mail-test.demo","version":"1.0.1"}');
        expect(calls.filter((c) => c.url.endsWith('/validate'))).toHaveLength(0); // aun dentro del debounce
        await wait(900);
        await wait(0);
        const v = calls.filter((c) => c.url.endsWith('/validate'));
        expect(v).toHaveLength(1);
        expect(v[0].body.extensionId).toBe('dev.mail-test.demo');
        expect(v[0].body.version).toBe('1.0.1');
        expect(v[0].body.files.manifest).toContain('dev.mail-test.demo');
        const text = container.textContent ?? '';
        expect(text).toContain('permissions[1]');
        expect(text).toContain('Permiso desconocido: FOO');
        expect(text).toContain('Riesgo alto');
        expect(text).toContain('Última versión: 1.0.0');
        expect(text).toContain('HTTP_REQUEST');
        // con errores no se puede enviar
        expect(button('Enviar a revisión')!.disabled).toBe(true);
    });

    it('un archivo que supera el limite o de tipo no admitido se rechaza en el cliente', async () => {
        await render();
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        const big = new File(['x'.repeat(100_001)], 'manifest.json');
        const bad = new File(['x'], 'virus.exe');
        Object.defineProperty(input, 'files', { value: [big, bad], configurable: true });
        await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
        await wait(50);
        const alerts = Array.from(container.querySelectorAll('[role="alert"]')).map((a) => a.textContent).join(' ');
        expect(alerts).toContain('manifest.json supera el límite');
        expect(alerts).toContain('virus.exe no es un archivo admitido');
        expect(calls.some((c) => c.url.endsWith('/validate'))).toBe(false);
    });

    it('el precio muestra el reparto con el porcentaje del backend y el neto estimado en centavos exactos', async () => {
        overview.shares = { developerBps: 6500, platformBps: 3500 };
        await render();
        // abre el panel de precio de la extension existente (suscripcion 5 USD/mes con 65 %)
        const details = container.querySelector('details') as HTMLDetailsElement;
        await act(async () => { details.open = true; details.dispatchEvent(new Event('toggle')); });
        const text = container.textContent ?? '';
        expect(text).toContain('Tú recibes 65 %');
        expect(text).toContain('Plataforma 35 %');
        expect(text).toContain('3,25 USD'); // 65 % de 5,00
        expect(text).toContain('39,00 USD'); // 12 x 3,25
    });

    it('una version aprobada se publica explicitamente (aprobar no publica)', async () => {
        await render();
        const publish = button('Publicar')!;
        expect(publish).toBeTruthy();
        await act(async () => { publish.click(); });
        await wait(0);
        await wait(0);
        expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/submissions/sub1/publish'))).toBe(true);
    });

    it('sin clave de firma muestra el aviso y nada mas', async () => {
        fetchMock.mockImplementation(async () => res(403, { error: 'signature_required', code: 'signature_required' }));
        await render();
        expect(container.textContent).toContain('no firma sus peticiones');
        expect(container.querySelector('input[type="file"]')).toBeNull();
    });
});
