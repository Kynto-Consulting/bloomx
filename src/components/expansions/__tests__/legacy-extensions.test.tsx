// @vitest-environment jsdom
/**
 * Regresion de produccion (Sealer 1.0.0 / Signature 1.0.0 / Mail Groups 1.0.0 siguen publicadas en la BD):
 *  - una extension YA publicada no se desactiva entera por un fallo de validacion de UN mount (degradacion por mount), y el error
 *    queda registrado por mount en el registro de errores de extensiones;
 *  - /extensions y la consola de administracion indican la actualizacion disponible y su remedio;
 *  - Ajustes muestra UNA sola pestana por extension (sin duplicados con la pestana nativa de Mail Groups);
 *  - los textos por idioma ({es, en}) se resuelven al idioma del usuario.
 * Los fixtures son los manifests REALES del commit 13640db de bloomx-extensions.
 */
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installCleanup, mount, qa, flush } from '@/components/expansions/kit/__tests__/harness';

const state = vi.hoisted(() => ({ extensions: [] as any[], locale: 'es' as 'es' | 'en', session: { data: { user: { id: 'u1', email: 'a@b.c', name: 'A' } }, update: () => Promise.resolve() } }));

vi.mock('@/hooks/useDomainConfig', () => ({ useDomainConfig: () => ({ extensions: state.extensions, isLoading: false, isError: false, extensionsLoaded: true, config: {}, themeConfig: {} }) }));
vi.mock('@/hooks/useExtensionPrefs', () => ({ useExtensionPrefs: () => ({ prefs: { disabled: [], order: [] }, setEnabled: vi.fn(), move: vi.fn() }) }));
vi.mock('@/components/I18nProvider', async () => {
    const { getTranslator } = await import('@/lib/i18n');
    return { useI18n: () => ({ locale: state.locale, t: getTranslator(state.locale).t, setLocale: vi.fn(), intlLocale: state.locale }) };
});
// El renderer real necesita sesion/router; aqui solo interesa QUE se monta (tipo y textos ya localizados).
vi.mock('@/components/expansions/renderer/JsonRenderer', async () => {
    const { localizeUi } = await import('@/lib/expansions/ui-schema');
    return {
        JsonRenderer: ({ component }: any) => {
            const local = localizeUi(component, state.locale);
            return <div data-testid="json-node" data-type={local.type}>{JSON.stringify(local.props ?? {})}</div>;
        },
    };
});
vi.mock('@/components/SessionProvider', () => ({ useSession: () => state.session, signOut: vi.fn() }));
vi.mock('@/contexts/CacheContext', () => ({ useCache: () => ({ setData: vi.fn() }) }));
vi.mock('@/components/ThemeProvider', () => ({ useTheme: () => ({ getAppearance: () => ({}) }) }));
vi.mock('./../../Editor', () => ({ Editor: () => null }));
vi.mock('@/components/Editor', () => ({ Editor: () => null }));
vi.mock('@/components/settings/AppearanceSettings', () => ({ AppearanceSettings: () => null }));
vi.mock('@/components/settings/LabelsSettings', () => ({ LabelsSettings: () => null }));
vi.mock('@/components/settings/OrganizerProposals', () => ({ OrganizerProposals: () => null }));
vi.mock('@/components/settings/RulesSettings', () => ({ RulesSettings: () => null }));
vi.mock('@/components/settings/IntegrationsSettings', () => ({ IntegrationsSettings: () => null }));
vi.mock('@/components/settings/ManageExtensionsLink', () => ({ ManageExtensionsLink: () => null }));
vi.mock('@/components/settings/MyMailboxTransfer', () => ({ MyMailboxTransfer: () => null }));
vi.mock('@/components/ui/TagInput', () => ({ TagInput: () => null }));

import { ExtensionLoader } from '@/components/expansions/ExtensionLoader';
import { SettingsModal } from '@/components/SettingsModal';
import { syncExtensionSettingsTabs } from '@/lib/expansions/client/dynamic-settings';
import { clientExpansionRegistry } from '@/lib/expansions/client/registry';
import { __resetExtensionErrors, getExtensionErrors } from '@/lib/expansions/client/error-log';
import { prepareManifest } from '@/lib/expansions/prepare-manifest';
import { buildRows } from '@/lib/expansions/manage/model';
import { EMPTY_PREFS } from '@/lib/expansions/client/prefs';
import { validateManifest } from '@/lib/expansions/manifest-schema';
import { isI18nText, localizeUi } from '@/lib/expansions/ui-schema';
import { mailGroupsEn, mailGroupsEs } from '@/lib/i18n/messages/mail-groups';
import { dictionaries, flattenMessages } from '@/lib/i18n';

const FIX = path.resolve(__dirname, '../../../lib/expansions/__tests__/fixtures/legacy');
const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(FIX, `${name}.json`), 'utf8'));
const asExtension = (template: any, over: Record<string, any> = {}) => ({ id: template.id, name: template.name, template, settings: {}, ...over });

describe('degradacion por mount: Signature 1.0.0 y Sealer 1.0.0 reales', () => {
    installCleanup();
    beforeEach(() => {
        localStorage.clear();
        __resetExtensionErrors();
        state.locale = 'es';
        vi.spyOn(console, 'warn').mockImplementation(() => { });
    });
    afterEach(() => { vi.restoreAllMocks(); });

    it('los errores de produccion se reproducen en modo estricto y NO desactivan la extension al cargar', () => {
        const signature = fixture('signature');
        const sealer = fixture('sealer');
        expect(validateManifest(signature).errors.map((e) => `${e.path}: ${e.message}`)).toContain('mounts[0].handler: "appendSignature" no esta declarada en api.functions');
        expect(validateManifest(sealer).errors.map((e) => `${e.path}: ${e.message}`)).toContain('mounts[4].handler: "encryptEmail" no esta declarada en api.functions');
        expect(prepareManifest('core-signature', signature).ok).toBe(true);
        expect(prepareManifest('core-sealer', sealer).ok).toBe(true);
    });

    it('ExtensionLoader monta los demas mounts (COMPOSER_TOOLBAR del sealer) y registra cada problema POR MOUNT con ruta y motivo', async () => {
        state.extensions = [asExtension(fixture('signature')), asExtension(fixture('sealer'))];
        const view = await mount(<ExtensionLoader mountPoint="COMPOSER_TOOLBAR" />);
        await flush();
        expect(qa('[data-testid="json-node"]').length).toBeGreaterThan(0);
        expect(view.container.textContent).toContain('Encrypt');

        const errors = getExtensionErrors();
        const sealerErr = errors.find((e) => e.extensionId === 'core-sealer' && e.path === 'mounts[4].handler');
        const sigErr = errors.find((e) => e.extensionId === 'core-signature' && e.path === 'mounts[0].handler');
        expect(sealerErr?.message).toMatch(/"encryptEmail" no esta declarada en api\.functions/);
        expect(sigErr?.message).toMatch(/"appendSignature" no esta declarada en api\.functions/);
        // Se conservan (se resuelven por nombre en el backend) y el aviso lo dice.
        expect(sealerErr?.message).toMatch(/se conserva/);
        // Ninguno es un error de "manifest invalido" (kind manifest): la extension no se desactivo.
        expect(errors.every((e) => e.kind !== 'manifest')).toBe(true);
    });

    it('un mount descartado por error propio se registra como tal y el resto se monta', async () => {
        const template = {
            id: 'mixta', name: 'Mixta', version: '1.0.0',
            mounts: [
                { point: 'EMAIL_TOOLBAR', component: { type: 'BUTTON', props: { label: 'Bueno' } } },
                { point: 'EMAIL_TOOLBAR', component: { type: 'BUTTON', props: { label: 'Malo', onClick: { action: 'ACCION_INVENTADA' } } } },
                { point: 'PUNTO_INVENTADO', component: { type: 'BUTTON', props: { label: 'Fantasma' } } },
            ],
        };
        state.extensions = [asExtension(template)];
        const view = await mount(<ExtensionLoader mountPoint="EMAIL_TOOLBAR" />);
        await flush();
        expect(view.container.textContent).toContain('Bueno');
        expect(view.container.textContent).not.toContain('Malo');
        const dropped = getExtensionErrors('mixta');
        expect(dropped.map((e) => e.path).sort()).toEqual(['mounts[1].component.props.onClick.action', 'mounts[2].point']);
        expect(dropped.every((e) => /descartado/.test(e.message))).toBe(true);
    });
});

describe('/extensions: actualizacion disponible y explicacion', () => {
    it('signature 1.0.0 con catalogo 1.1.0: actualizacion disponible, avisos por mount y sin desactivarse', () => {
        const ext = asExtension(fixture('signature'));
        const [row] = buildRows({ extensions: [ext], prefs: EMPTY_PREFS, catalog: { 'core-signature': { version: '1.1.0' } } });
        expect(row.valid).toBe(true);
        expect(row.version).toBe('1.0.0');
        expect(row.catalogVersion).toBe('1.1.0');
        expect(row.updateAvailable).toBe(true);
        expect(row.active).toBe(true);
        expect(row.hasErrors).toBe(true);
        expect(row.problems.map((p) => p.path)).toEqual(['mounts[0].handler']);
        expect(row.problems[0].undeclaredFunction).toBe(true);
        expect(row.droppedCount).toBe(0);
    });

    it('un manifest realmente invalido sigue marcandose invalido y muestra la actualizacion disponible', () => {
        const ext = asExtension({ id: 'rota', name: 'Rota', version: '1.0.0', mounts: 'no-es-lista' });
        const [row] = buildRows({ extensions: [ext], prefs: EMPTY_PREFS, catalog: { rota: { version: '1.2.0' } } });
        expect(row.valid).toBe(false);
        expect(row.updateAvailable).toBe(true);
        expect(row.active).toBe(false);
    });
});

describe('Ajustes: una sola pestana por extension', () => {
    installCleanup();
    beforeEach(() => {
        state.locale = 'es';
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ expansionSettings: {} }) })));
        syncExtensionSettingsTabs([]);
    });
    afterEach(() => { syncExtensionSettingsTabs([]); vi.unstubAllGlobals(); });

    const tabTitles = () => clientExpansionRegistry.getByMountPoint('CUSTOM_SETTINGS_TAB').map((t: any) => t.title);

    it('Mail Groups 1.0.0 (con su CUSTOM_SETTINGS_TAB antigua) no duplica la pestana nativa', () => {
        expect(tabTitles()).toEqual(['Mail Groups']);
        syncExtensionSettingsTabs([asExtension(fixture('mail-groups')), asExtension(fixture('signature'))]);
        const tabs = clientExpansionRegistry.getByMountPoint('CUSTOM_SETTINGS_TAB');
        expect(tabs.filter((t: any) => /mail groups/i.test(t.title))).toHaveLength(1);
        expect(tabs.map((t: any) => t.id)).toEqual(['core-mail-groups', 'ext:core-signature']);
    });

    it('SettingsModal (jsdom) pinta exactamente UNA pestana Mail Groups aunque la BD tenga la version antigua', async () => {
        syncExtensionSettingsTabs([asExtension(fixture('mail-groups')), asExtension(fixture('signature'))]);
        const view = await mount(<SettingsModal open onClose={() => { }} />);
        await flush();
        const tabs = qa('[role="tab"]', view.container.ownerDocument.body).map((t) => t.textContent?.trim());
        expect(tabs.filter((t) => t === 'Mail Groups')).toHaveLength(1);
        expect(tabs).toContain('Email Signature');
        // Todas las pestanas de extension llevan icono (SVG) coherente.
        const extTabs = qa('[role="tab"]').filter((t) => ['Mail Groups', 'Email Signature'].includes(t.textContent?.trim() ?? ''));
        expect(extTabs).toHaveLength(2);
        for (const tab of extTabs) expect(tab.querySelector('svg')).not.toBeNull();
    });

    it('una extension que declara SETTINGS_PANEL y CUSTOM_SETTINGS_TAB genera UNA pestana y prevalece SETTINGS_PANEL', () => {
        const template = {
            id: 'doble', name: 'Doble', version: '1.0.0',
            mounts: [
                { point: 'CUSTOM_SETTINGS_TAB', component: { type: 'CARD', props: { title: 'Antigua' } } },
                { point: 'SETTINGS_PANEL', component: { type: 'CARD', props: { title: 'Nueva', icon: 'Settings' } } },
                { point: 'SETTINGS_PANEL', component: { type: 'CARD', props: { title: 'Segundo panel' } } },
            ],
        };
        syncExtensionSettingsTabs([asExtension(template), asExtension(template)]);
        const tabs = clientExpansionRegistry.getByMountPoint('CUSTOM_SETTINGS_TAB').filter((t: any) => t.id.startsWith('ext:'));
        expect(tabs).toHaveLength(1);
        expect(tabs[0].title).toBe('Nueva');
        expect(tabs[0].icon).toBeTruthy();
    });

    it('sin icono en el manifest todas las pestanas usan un icono generico; orden estable independiente del orden de llegada', () => {
        const make = (id: string, title: string) => asExtension({ id, name: title, version: '1.0.0', mounts: [{ point: 'CUSTOM_SETTINGS_TAB', component: { type: 'CARD', props: { title } } }] });
        syncExtensionSettingsTabs([make('b', 'Beta'), make('a', 'Alfa')]);
        const first = clientExpansionRegistry.getByMountPoint('CUSTOM_SETTINGS_TAB').map((t: any) => t.id);
        syncExtensionSettingsTabs([make('a', 'Alfa'), make('b', 'Beta')]);
        const second = clientExpansionRegistry.getByMountPoint('CUSTOM_SETTINGS_TAB').map((t: any) => t.id);
        expect(first).toEqual(second);
        expect(second).toEqual(['core-mail-groups', 'ext:a', 'ext:b']);
        for (const tab of clientExpansionRegistry.getByMountPoint('CUSTOM_SETTINGS_TAB')) expect(tab.icon).toBeTruthy();
    });

    it('hubspot, notion y trello (sin ajustes en su manifest) no crean pestanas; tampoco se duplican al repetirse', () => {
        syncExtensionSettingsTabs(['hubspot', 'notion', 'trello'].flatMap((n) => [asExtension(fixture(`current-${n}`)), asExtension(fixture(`current-${n}`))]));
        expect(clientExpansionRegistry.getByMountPoint('CUSTOM_SETTINGS_TAB').map((t: any) => t.id)).toEqual(['core-mail-groups']);
    });

    it('el titulo por idioma ({es, en}) se resuelve al idioma del usuario en la pestana', async () => {
        const template = { id: 'i18n-ext', name: 'I18n', version: '1.0.0', mounts: [{ point: 'CUSTOM_SETTINGS_TAB', component: { type: 'CARD', props: { title: { es: 'Mi firma', en: 'My signature' } } } }] };
        syncExtensionSettingsTabs([asExtension(template)]);
        state.locale = 'en';
        const view = await mount(<SettingsModal open onClose={() => { }} />);
        await flush();
        const labels = qa('[role="tab"]', view.container.ownerDocument.body).map((t) => t.textContent?.trim());
        expect(labels).toContain('My signature');
        expect(labels).not.toContain('Mi firma');
    });
});

describe('textos por idioma', () => {
    it('signature actual: cada texto visible existe en es y en y el renderer recibe el idioma del usuario', async () => {
        const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../bloomx-extensions/signature/manifest.json'), 'utf8'));
        const settings = manifest.mounts.find((m: any) => m.point === 'CUSTOM_SETTINGS_TAB');
        const found: Record<string, string>[] = [];
        const walk = (node: any) => {
            if (Array.isArray(node)) node.forEach(walk);
            else if (node && typeof node === 'object') { if (isI18nText(node)) found.push(node); else Object.values(node).forEach(walk); }
        };
        walk(settings);
        expect(found.length).toBeGreaterThanOrEqual(6);
        for (const text of found) expect(Object.keys(text).sort()).toEqual(['en', 'es']);
        expect(JSON.stringify(localizeUi(settings, 'es'))).toContain('Firma de correo');
        expect(JSON.stringify(localizeUi(settings, 'en'))).toContain('Email Signature');
    });

    it('ExtensionLoader entrega la plantilla localizada (EVENT_LOCATION_BUILDER lee label como string)', async () => {
        state.locale = 'en';
        state.extensions = [asExtension({ id: 'loc', name: 'Loc', version: '1.0.0', mounts: [{ point: 'EMAIL_TOOLBAR', component: { type: 'BUTTON', props: { label: { es: 'Hola', en: 'Hello' } } } }] })];
        const view = await mount(<ExtensionLoader mountPoint="EMAIL_TOOLBAR" />);
        await flush();
        expect(view.container.textContent).toContain('Hello');
        expect(view.container.textContent).not.toContain('Hola');
    });

    it('Mail Groups nativo: paridad es/en de todos sus textos (mismas claves, sin vacios, en distinto de es)', () => {
        expect(Object.keys(mailGroupsEn).sort()).toEqual(Object.keys(mailGroupsEs).sort());
        for (const key of Object.keys(mailGroupsEs) as (keyof typeof mailGroupsEs)[]) {
            expect(mailGroupsEs[key].trim()).not.toBe('');
            expect(mailGroupsEn[key].trim()).not.toBe('');
            if (key !== 'aliasPlaceholder') expect(mailGroupsEn[key]).not.toBe(mailGroupsEs[key]);
        }
        const es = flattenMessages(dictionaries.es!);
        const en = flattenMessages(dictionaries.en!);
        for (const key of Object.keys(mailGroupsEs)) {
            expect(es[`mailGroups.${key}`]).toBeTruthy();
            expect(en[`mailGroups.${key}`]).toBeTruthy();
        }
    });

    it('MailGroupsSettings ya no tiene texto visible en ingles fijo en el codigo', () => {
        const source = fs.readFileSync(path.resolve(__dirname, '../settings/MailGroupsSettings.tsx'), 'utf8');
        for (const literal of ['Create aliases like', 'Add group', 'No aliases yet', 'Add recipients', '> Mail groups', 'Remove\n']) {
            expect(source).not.toContain(literal);
        }
    });
});

describe('accion inexistente en una version antigua: falla al USAR el boton con un mensaje claro', () => {
    afterEach(() => { vi.unstubAllGlobals(); document.documentElement.lang = ''; vi.restoreAllMocks(); });

    it('404 ACTION_NOT_FOUND del backend -> mensaje localizado con accion y version (sin HTML ni datos del servidor)', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => { });
        const { executeExtensionAction } = await import('@/lib/expansions/api');
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: 'Action "encryptEmail" does not exist...', code: 'ACTION_NOT_FOUND', action: 'encryptEmail<b>', version: '1.0.0', extension: 'core-sealer' }) })));
        document.documentElement.lang = 'es';
        const es = await executeExtensionAction('core-sealer', 'encryptEmail');
        expect(es).toEqual({ success: false, error: 'La acción "encryptEmailb" no existe en la versión 1.0.0 de esta extensión. Actualiza la extensión desde Extensiones.' });
        document.documentElement.lang = 'en';
        const en = await executeExtensionAction('core-sealer', 'encryptEmail');
        expect(en.error).toBe('The action "encryptEmailb" is not available in version 1.0.0 of this extension. Update the extension from Extensions.');
    });
});
