// @vitest-environment jsdom
/**
 * Ajustes -> Extensiones: enlace "Gestionar extensiones" (a /extensions y, solo a administradores, a /admin/extensions).
 * i18n es/en, icono decorativo, teclado (enlaces reales con foco visible) y cierre del modal al navegar.
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installCleanup, click, flush, mount, q } from '@/components/expansions/kit/__tests__/harness';
import { I18nProvider } from '@/components/I18nProvider';
import { ManageExtensionsLink } from '../ManageExtensionsLink';
import { getTranslator } from '@/lib/i18n';

const links = () => Array.from(document.querySelectorAll('a'));
const withLocale = (locale: 'es' | 'en', node: React.ReactElement) => <I18nProvider locale={locale}>{node}</I18nProvider>;

describe('ManageExtensionsLink', () => {
    installCleanup();
    beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }))); });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('usuario normal: un enlace a /extensions con titulo, descripcion y aviso de obligatorias; sin enlace de administracion', async () => {
        await mount(withLocale('es', <ManageExtensionsLink />));
        await flush();
        const section = q('[data-testid="manage-extensions-link"]')!;
        expect(section.getAttribute('aria-labelledby')).toBe('settings-manage-extensions-title');
        expect(q('#settings-manage-extensions-title')!.textContent).toBe('Gestionar extensiones');
        expect(section.textContent).toContain('no se pueden desactivar');
        expect(links().map((a) => a.getAttribute('href'))).toEqual(['/extensions']);
        expect(q('[data-testid="manage-extensions-admin"]')).toBeNull();
        expect(section.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
    });

    it('administrador (isAdmin): ademas enlaza a la consola /admin/extensions', async () => {
        await mount(withLocale('es', <ManageExtensionsLink isAdmin />));
        expect(links().map((a) => a.getAttribute('href'))).toEqual(['/extensions', '/admin/extensions']);
        expect(q('[data-testid="manage-extensions-admin"]')!.textContent).toContain('Administración de extensiones');
    });

    it('deteccion de administrador por /api/admin/me: 200 lo muestra, 401/403/fallo no', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
        await mount(withLocale('es', <ManageExtensionsLink />));
        await flush();
        expect(links().map((a) => a.getAttribute('href'))).toEqual(['/extensions', '/admin/extensions']);
        expect((globalThis.fetch as any).mock.calls[0][0]).toBe('/api/admin/me');
    });

    it('un fallo de red al detectar administrador no rompe nada ni muestra el enlace de administracion', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
        await mount(withLocale('es', <ManageExtensionsLink />));
        await flush();
        expect(links().map((a) => a.getAttribute('href'))).toEqual(['/extensions']);
    });

    it('en ingles', async () => {
        await mount(withLocale('en', <ManageExtensionsLink isAdmin />));
        expect(q('#settings-manage-extensions-title')!.textContent).toBe('Manage extensions');
        expect(links().map((a) => a.textContent?.trim())).toEqual(['Open Extensions', 'Open the administration console']);
    });

    it('teclado: son enlaces reales (Tab) con anillo de foco por token; pulsar cierra el modal', async () => {
        const onNavigate = vi.fn();
        await mount(withLocale('es', <ManageExtensionsLink isAdmin onNavigate={onNavigate} />));
        for (const a of links()) {
            expect(a.tabIndex).toBeGreaterThanOrEqual(0);
            expect(a.className).toContain('focus-visible:ring-2');
            expect(a.className).toContain('focus-visible:ring-ring');
        }
        links()[0].focus();
        expect(document.activeElement).toBe(links()[0]);
        await click(links()[0]);
        await click(links()[1]);
        expect(onNavigate).toHaveBeenCalledTimes(2);
    });

    it('solo tokens del tema: sin colores crudos ni estilos en linea', async () => {
        await mount(withLocale('es', <ManageExtensionsLink isAdmin />));
        const html = q('[data-testid="manage-extensions-link"]')!.outerHTML;
        expect(html).not.toMatch(/style=/);
        expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
        expect(html).not.toMatch(/\b(?:bg|text|border)-(?:red|blue|green|gray|slate|zinc|neutral|white|black)\b/);
    });

    it('i18n: es y en tienen exactamente las mismas claves de extensionState', () => {
        const es = getTranslator('es');
        const en = getTranslator('en');
        for (const key of ['loadError.title', 'loadError.retry', 'loadError.inline', 'settingsLink.title', 'settingsLink.open', 'settingsLink.openAdmin']) {
            expect(es.t(`extensionState.${key}`)).not.toBe(`extensionState.${key}`);
            expect(en.t(`extensionState.${key}`)).not.toBe(`extensionState.${key}`);
            expect(es.t(`extensionState.${key}`)).not.toBe(en.t(`extensionState.${key}`));
        }
    });
});

describe('SettingsModal incorpora el enlace', () => {
    it('la pestana Extensiones de Ajustes renderiza <ManageExtensionsLink> (cambio minimo en el modal)', () => {
        const source = readFileSync(path.resolve(__dirname, '../../SettingsModal.tsx'), 'utf8');
        expect(source).toContain("import { ManageExtensionsLink } from '@/components/settings/ManageExtensionsLink';");
        const tab = source.slice(source.indexOf("{activeTab === 'extensions' && ("));
        expect(tab).toContain('<ManageExtensionsLink onNavigate={onClose} />');
        // y esta dentro de la pestana Extensiones, antes de la lista de ajustes por extension
        expect(tab.indexOf('<ManageExtensionsLink')).toBeLessThan(tab.indexOf('settings.attributes'));
    });
});
