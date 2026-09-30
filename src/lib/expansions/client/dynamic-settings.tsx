import React from 'react';
import * as LucideIcons from 'lucide-react';
import { JsonRenderer } from '@/components/expansions/renderer/JsonRenderer';
import { ExtensionIcon } from '@/components/expansions/ExtensionIcon';
import { resolveIcon } from '@/components/expansions/kit/resolve-icon';
import { resolveIconRef } from '@/lib/expansions/icon-ref';
import { getPreparedManifest } from '@/lib/expansions/prepare-manifest';
import { isI18nText } from '@/lib/expansions/ui-schema';
import { clientExpansionRegistry } from './registry';

/**
 * Pestanas de ajustes declaradas por manifests JSON (mount SETTINGS_PANEL o CUSTOM_SETTINGS_TAB, p.ej. Email Signature).
 * SettingsModal solo lee `clientExpansionRegistry`; aqui se traducen los manifests de las extensiones del
 * dominio a entradas del registro (con prefijo `ext:` para no chocar con las nativas como core-mail-groups).
 *
 * UNA sola pestana por extension:
 *   - Si la extension declara varios mounts de ajustes, prevalece SETTINGS_PANEL sobre el antiguo CUSTOM_SETTINGS_TAB (el primero de cada
 *     tipo; el resto se ignora).
 *   - Si el cliente ya trae una pestana NATIVA para esa extension (registro con su mismo id, p. ej. `core-mail-groups`), la del manifest
 *     se ignora: sin duplicados aunque la version instalada sea antigua y aun declare su propia pestana (caso Mail Groups 1.0.0).
 *   - Clave = `ext:<id de extension>` (los ajustes guardados de cada extension viven bajo esa clave, no cambia).
 * Orden estable (titulo, luego id) e icono coherente: el del mount o, si no lo hay, uno generico.
 */

const DYNAMIC_PREFIX = 'ext:';
const SETTINGS_POINTS = ['SETTINGS_PANEL', 'CUSTOM_SETTINGS_TAB'] as const;
let registeredIds: string[] = [];

function createTabComponent(extensionId: string, component: any) {
    const JsonSettingsTab: React.FC = () => <JsonRenderer component={component} context={{ extensionId }} />;
    JsonSettingsTab.displayName = `JsonSettingsTab(${extensionId})`;
    return JsonSettingsTab;
}

const brandIconComponents = new Map<string, React.ElementType>();

function iconFor(name: unknown): React.ElementType {
    // Logotipo de marca / iniciales (brand:zoom, initials:AB, nombres antiguos como Zoom): componente estable por nombre.
    const ref = resolveIconRef(name);
    if (typeof name === 'string' && ref && ref.kind !== 'lucide') {
        let component = brandIconComponents.get(name);
        if (!component) {
            const BrandTabIcon: React.FC = () => <ExtensionIcon icon={name} size={16} />;
            BrandTabIcon.displayName = `BrandTabIcon(${name})`;
            component = BrandTabIcon;
            brandIconComponents.set(name, component);
        }
        return component;
    }
    // Icono Lucide (con o sin prefijo lucide:). Los iconos de lucide son componentes (funcion o forwardRef); un nombre desconocido usa el generico.
    const Icon = resolveIcon(name);
    return Icon ?? LucideIcons.Puzzle;
}

/** Titulo textual de un mount (un objeto por idioma {es, en} se conserva en `titleI18n`; `title` lleva la variante por defecto). */
function titleOf(value: unknown, fallback: string): { title: string; titleI18n?: Record<string, string> } {
    if (isI18nText(value)) return { title: value.en ?? value.es ?? Object.values(value)[0] ?? fallback, titleI18n: value };
    return { title: typeof value === 'string' && value.trim() ? value : fallback };
}

export function syncExtensionSettingsTabs(extensions: any[]) {
    for (const id of registeredIds) clientExpansionRegistry.unregister(id);
    registeredIds = [];

    const tabs: Array<{ id: string; title: string; titleI18n?: Record<string, string>; icon: React.ElementType; component: any; extensionId: string }> = [];
    const seen = new Set<string>();

    for (const extension of Array.isArray(extensions) ? extensions : []) {
        const template = extension?.template;
        if (!template || typeof template !== 'object' || template.status === 'disabled' || !Array.isArray(template.mounts)) continue;

        const extensionId = String(template.id || extension.id || '');
        if (!extensionId || seen.has(extensionId)) continue;

        // Una extension con pestana nativa en el cliente (registro con su mismo id) no publica una segunda.
        if (clientExpansionRegistry.get(extensionId)) { seen.add(extensionId); continue; }

        // Manifest ya preparado: mounts con errores propios descartados, UI antiguo migrado. Solo un manifest invalido se omite.
        const prepared = getPreparedManifest(extensionId, template);
        if (!prepared.ok) continue;

        let mount: any = null;
        for (const point of SETTINGS_POINTS) {
            mount = prepared.template.mounts.find((item: any) => item?.point === point && item.component && typeof item.component.type === 'string');
            if (mount) break;
        }
        if (!mount) continue;

        seen.add(extensionId);
        const fallbackName = typeof extension.name === 'string' && extension.name ? extension.name : typeof template.name === 'string' && template.name ? template.name : extensionId;
        const { title, titleI18n } = titleOf(mount.component.props?.title, fallbackName);
        tabs.push({ id: `${DYNAMIC_PREFIX}${extensionId}`, title, titleI18n, icon: iconFor(mount.component.props?.icon ?? template.icon), component: mount.component, extensionId });
    }

    // Orden estable, independiente del orden en que llegue la lista del servidor.
    tabs.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));

    for (const tab of tabs) {
        clientExpansionRegistry.register({
            id: tab.id,
            label: tab.title,
            mounts: [
                {
                    point: 'CUSTOM_SETTINGS_TAB',
                    title: tab.title,
                    titleI18n: tab.titleI18n,
                    icon: tab.icon,
                    Component: createTabComponent(tab.extensionId, tab.component) as any,
                } as any,
            ],
        });
        registeredIds.push(tab.id);
    }
}
