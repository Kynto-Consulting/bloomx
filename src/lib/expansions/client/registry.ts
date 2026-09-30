
// Registro de extensiones "nativas" del cliente (componentes React propios, p.ej. Mail Groups) y de las pestanas de
// ajustes que declaran los manifests JSON (ver dynamic-settings.ts).

import { MailGroupsSettings } from '@/components/expansions/settings/MailGroupsSettings';
import { Users } from 'lucide-react';
import { ClientExpansion } from "./types";

const registry: Map<string, ClientExpansion> = new Map();

registry.set('core-mail-groups', {
    id: 'core-mail-groups',
    mounts: [
        {
            point: 'CUSTOM_SETTINGS_TAB',
            title: 'Mail Groups',
            icon: Users,
            Component: MailGroupsSettings as any,
        }
    ],
    label: 'Mail Groups',
});


export const clientExpansionRegistry = {
    register: (expansion: ClientExpansion) => {
        registry.set(expansion.id, expansion);
    },
    unregister: (id: string) => registry.delete(id),
    get: (id: string) => registry.get(id),
    getAll: () => Array.from(registry.values()),
    getByMountPoint: (point: string) => {
        const expansions = Array.from(registry.values());
        const mounts: any[] = [];
        for (const exp of expansions) {
            if (exp.mounts) {
                for (const mount of exp.mounts) {
                    if (mount.point === point) {
                        // `id` identifica la pestana (SettingsModal la usa como clave y como indice en expansionSettings)
                        mounts.push({ ...mount, id: (mount as any).id || exp.id, expansionId: exp.id });
                    }
                }
            }
        }
        return mounts;
    }
};

export function registerClientExpansion(expansion: ClientExpansion) {
    registry.set(expansion.id, expansion);
}

export function getClientExpansion(id: string): ClientExpansion | undefined {
    return registry.get(id);
}

export function getAllClientExpansions(): ClientExpansion[] {
    return Array.from(registry.values());
}
