'use client';

import { useI18n } from '@/components/I18nProvider';
import { describeIncompatible, describeUpgrade, type CompatLocale } from '@/lib/admin/extensions-compat';
import type { ExtensionRow } from '@/lib/admin/extensions-view';

/** Idioma de los textos de compatibilidad (solo es/en; cualquier otro cae a es). */
export function useCompatLocale(): CompatLocale {
    const { locale } = useI18n();
    return locale === 'en' ? 'en' : 'es';
}

/**
 * Aviso de compatibilidad con el cliente: "ninguna version es compatible" (bloquea instalar/activar/actualizar) y/o "hay una version
 * mas nueva que requiere actualizar el cliente: falta ...". Nada si no hay incompatibilidad ni upgrade.
 */
export function CompatNotice({ row, id }: { row: Pick<ExtensionRow, 'incompatible' | 'upgrade'>; id?: string }) {
    const locale = useCompatLocale();
    const incompatible = describeIncompatible(row, locale);
    const upgrade = row.incompatible ? null : describeUpgrade(row.upgrade, locale);
    if (!incompatible && !upgrade) return null;
    return (
        <p id={id} className={`text-xs ${incompatible ? 'text-warning' : 'text-muted-foreground'}`}>
            {incompatible ?? upgrade}
        </p>
    );
}
