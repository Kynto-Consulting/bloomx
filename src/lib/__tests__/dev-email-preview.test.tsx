// @vitest-environment jsdom
/**
 * /dev/email-preview: herramienta de desarrollo para revisar visualmente los correos de reuniones.
 *  - 404 en produccion (aunque haya override o sesion de administrador);
 *  - en desarrollo: con NEXT_PUBLIC_BLOOMX_THEME_OVERRIDE o con administrador; nada mas;
 *  - el middleware la deja pasar sin sesion solo en desarrollo con el override;
 *  - el laboratorio renderiza TODAS las variantes en iframes sandbox y responde a marca / idioma / esquema / ancho.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const notFound = vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); });
vi.mock('next/navigation', () => ({ notFound: () => notFound() }));
const isAdminUserSession = vi.fn(async () => false);
vi.mock('@/lib/admin-auth', () => ({ isAdminUserSession: () => isAdminUserSession() }));

import DevEmailPreviewPage from '@/app/dev/email-preview/page';
import { canOpenEmailPreviewLab } from '@/lib/dev/email-preview-gate';
import { EmailPreviewLab } from '@/components/dev/EmailPreviewLab';
import { SAMPLE_VARIANTS } from '@/lib/calendar/email-samples';
import { middleware } from '@/middleware';

const OVERRIDE = 'NEXT_PUBLIC_BLOOMX_THEME_OVERRIDE';
const h = React.createElement as unknown as (type: unknown, props: object | null, ...children: unknown[]) => React.ReactElement;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
    notFound.mockClear();
    isAdminUserSession.mockReset();
    isAdminUserSession.mockResolvedValue(false);
    vi.stubEnv(OVERRIDE, '');
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('puerta: canOpenEmailPreviewLab', () => {
    it('produccion: nunca, ni con override ni con administrador', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv(OVERRIDE, '{"primaryColor":"#7c3aed"}');
        isAdminUserSession.mockResolvedValue(true);
        expect(await canOpenEmailPreviewLab()).toBe(false);
        expect(isAdminUserSession).not.toHaveBeenCalled();
    });

    it('desarrollo con override: si, sin consultar la sesion', async () => {
        vi.stubEnv('NODE_ENV', 'development');
        vi.stubEnv(OVERRIDE, '{"primaryColor":"#7c3aed"}');
        expect(await canOpenEmailPreviewLab()).toBe(true);
        expect(isAdminUserSession).not.toHaveBeenCalled();
    });

    it('desarrollo sin override: solo administradores; un fallo de la sesion es "no"', async () => {
        vi.stubEnv('NODE_ENV', 'development');
        isAdminUserSession.mockResolvedValue(true);
        expect(await canOpenEmailPreviewLab()).toBe(true);
        isAdminUserSession.mockResolvedValue(false);
        expect(await canOpenEmailPreviewLab()).toBe(false);
        isAdminUserSession.mockRejectedValue(new Error('db down'));
        expect(await canOpenEmailPreviewLab()).toBe(false);
        expect(await canOpenEmailPreviewLab({ isAdmin: async () => true })).toBe(true);
    });
});

describe('pagina /dev/email-preview', () => {
    it('produccion: 404 (notFound) incluso con override y con administrador', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv(OVERRIDE, '{"primaryColor":"#7c3aed"}');
        isAdminUserSession.mockResolvedValue(true);
        await expect(DevEmailPreviewPage()).rejects.toThrow('NEXT_NOT_FOUND');
        expect(notFound).toHaveBeenCalledTimes(1);
    });

    it('desarrollo sin override ni admin: 404', async () => {
        vi.stubEnv('NODE_ENV', 'development');
        await expect(DevEmailPreviewPage()).rejects.toThrow('NEXT_NOT_FOUND');
    });

    it('desarrollo con override o con administrador: renderiza el laboratorio', async () => {
        vi.stubEnv('NODE_ENV', 'development');
        vi.stubEnv(OVERRIDE, '{"primaryColor":"#7c3aed"}');
        const viaOverride = await DevEmailPreviewPage();
        expect((viaOverride as React.ReactElement).type).toBe(EmailPreviewLab);
        vi.stubEnv(OVERRIDE, '');
        isAdminUserSession.mockResolvedValue(true);
        const viaAdmin = await DevEmailPreviewPage();
        expect((viaAdmin as React.ReactElement).type).toBe(EmailPreviewLab);
        expect(notFound).not.toHaveBeenCalled();
    });
});

describe('middleware: /dev/email-preview', () => {
    const call = (path: string) => middleware(new NextRequest(`http://localhost:3000${path}`));
    const passes = (res: Response) => res.headers.get('x-middleware-next') === '1';

    it('pasa sin sesion solo en desarrollo con override; en produccion o sin override exige sesion', async () => {
        vi.stubEnv('NODE_ENV', 'development');
        vi.stubEnv(OVERRIDE, '{"primaryColor":"#7c3aed"}');
        expect(passes(await call('/dev/email-preview'))).toBe(true);
        expect(passes(await call('/dev/otra-cosa'))).toBe(false);
        vi.stubEnv(OVERRIDE, '');
        expect(passes(await call('/dev/email-preview'))).toBe(false);
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv(OVERRIDE, '{"primaryColor":"#7c3aed"}');
        expect(passes(await call('/dev/email-preview'))).toBe(false);
    });
});

describe('<EmailPreviewLab>', () => {
    let container: HTMLDivElement;
    let root: Root;
    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => { root.render(h(EmailPreviewLab, null)); });
    });
    afterEach(() => { act(() => root.unmount()); container.remove(); });

    const frames = () => Array.from(container.querySelectorAll<HTMLIFrameElement>('iframe[data-testid="lab-frame"]'));
    const button = (label: string) => Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
    const select = (testid: string, value: string) => act(() => {
        const el = container.querySelector<HTMLSelectElement>(`[data-testid="${testid}"]`)!;
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
        setter.call(el, value);
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    it('renderiza TODAS las variantes en iframes sandbox con srcdoc, sin hallazgos de compatibilidad', () => {
        expect(frames()).toHaveLength(SAMPLE_VARIANTS.length);
        for (const f of frames()) {
            expect(f.getAttribute('sandbox')).toBe('');
            expect(f.hasAttribute('src')).toBe(false);
            expect(f.getAttribute('srcdoc')).toContain('<html lang="es"');
        }
        expect(container.querySelector('[data-testid="lint-total"]')?.textContent).toContain('Sin hallazgos');
    });

    it('cambia de marca, idioma, esquema (paleta propia, inversion parcial y total) y ancho', () => {
        select('brand-select', 'yellow');
        expect(frames()[0].getAttribute('srcdoc')).toContain('bgcolor="#ffcc00"');
        expect(container.querySelector('[data-testid="brand-facts"]')?.textContent).toContain('corregida a AA');
        act(() => button('English').click());
        expect(frames()[0].getAttribute('srcdoc')).toContain('<html lang="en"');
        act(() => button('Oscuro (paleta propia)').click());
        expect(frames()[0].getAttribute('srcdoc')).not.toContain('prefers-color-scheme');
        expect(frames()[0].getAttribute('srcdoc')).toContain('.bxm-card{background-color:');
        const light = frames()[0].getAttribute('srcdoc');
        act(() => button('Inversión parcial').click());
        const partial = frames()[0].getAttribute('srcdoc');
        expect(partial).not.toBe(light);
        expect(partial).not.toContain('prefers-color-scheme');
        expect(partial).toContain('bgcolor="#000000"');
        // Marca oscura: la inversion total invierte tambien la banda (la parcial la respeta).
        select('brand-select', 'navy');
        const navyPartial = frames()[0].getAttribute('srcdoc');
        act(() => button('Inversión total').click());
        expect(frames()[0].getAttribute('srcdoc')).not.toBe(navyPartial);
        expect(frames()[0].style.width).toBe('680px');
        act(() => button('Móvil (375)').click());
        expect(frames()[0].style.width).toBe('375px');
        select('variant-select', 'update');
        expect(frames()).toHaveLength(1);
    });

    it('marca personalizada: acepta cualquier color sin romper el linter', () => {
        select('brand-select', 'custom');
        const input = container.querySelector<HTMLInputElement>('input[type="color"]')!;
        act(() => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
            setter.call(input, '#00ff00');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(frames()[0].getAttribute('srcdoc')).toContain('bgcolor="#00ff00"');
        expect(container.querySelector('[data-testid="lint-total"]')?.textContent).toContain('Sin hallazgos');
    });
});
