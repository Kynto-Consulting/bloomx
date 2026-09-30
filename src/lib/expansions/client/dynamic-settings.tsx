import React from 'react';
import * as LucideIcons from 'lucide-react';
import { JsonRenderer } from '@/components/expansions/renderer/JsonRenderer';
import { normalizeMount, validateManifest } from '@/lib/expansions/manifest-schema';
import { clientExpansionRegistry } from './registry';

/**
 * Pestanas de ajustes declaradas por manifests JSON (mount CUSTOM_SETTINGS_TAB, p.ej. Email Signature).
 * SettingsModal solo lee `clientExpansionRegistry`; aqui se traducen los manifests de las extensiones del
 * dominio a entradas del registro (con prefijo `ext:` para no chocar con las nativas como core-mail-groups).
 */

const DYNAMIC_PREFIX = 'ext:';
let registeredIds: string[] = [];

function createTabComponent(extensionId: string, component: any) {
    const JsonSettingsTab: React.FC = () => <JsonRenderer component={component} context={{ extensionId }} />;
    JsonSettingsTab.displayName = `JsonSettingsTab(${extensionId})`;
    return JsonSettingsTab;
}

export function syncExtensionSettingsTabs(extensions: any[]) {
    for (const id of registeredIds) clientExpansionRegistry.unregister(id);
    registeredIds = [];

    for (const extension of Array.isArray(extensions) ? extensions : []) {
        const template = extension?.template;
        if (!template || template.status === 'disabled' || !Array.isArray(template.mounts)) continue;
        if (!validateManifest(template).ok) continue;

        const extensionId = String(template.id || extension.id || '');
        if (!extensionId) continue;

        for (const rawMount of template.mounts) {
            if (rawMount?.point !== 'CUSTOM_SETTINGS_TAB') continue;
            const mount = normalizeMount(rawMount);
            if (!mount?.component || typeof mount.component.type !== 'string') continue;

            const tabId = `${DYNAMIC_PREFIX}${extensionId}`;
            const iconName = mount.component.props?.icon;
            const Icon = typeof iconName === 'string' ? (LucideIcons as any)[iconName] : undefined;

            clientExpansionRegistry.register({
                id: tabId,
                label: mount.component.props?.title || extension.name || extensionId,
                mounts: [
                    {
                        point: 'CUSTOM_SETTINGS_TAB',
                        title: mount.component.props?.title || extension.name || extensionId,
                        icon: Icon,
                        Component: createTabComponent(extensionId, mount.component) as any,
                    },
                ],
            });
            registeredIds.push(tabId);
            break; // una pestana por extension
        }
    }
}
