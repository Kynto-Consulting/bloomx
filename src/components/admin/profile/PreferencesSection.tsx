'use client';

import * as React from 'react';
import { useI18n } from '@/components/I18nProvider';
import { useTheme } from '@/components/ThemeProvider';
import { Card, useDensity, type Density } from '@/components/admin/console';
import type { Locale } from '@/lib/i18n';
import { RadioGroup } from './RadioGroup';

/** Preferencias locales al navegador (sin API): idioma, tema y densidad de la consola. */
export function PreferencesSection() {
    const { t, locale, setLocale } = useI18n();
    const { themes, preference, setPreference } = useTheme();
    const [density, setDensity] = useDensity();
    const p = (k: string) => t(`admin.console.profile.preferences.${k}`);

    // Etiquetas de tema: diccionario si existe la clave (appearance.themes.<id>), si no el texto del registro.
    const tr = (key: string, fallback: string) => { const v = t(key); return v === key ? fallback : v; };
    const brandName = (label: string) => label.replace(/ · (Claro|Oscuro)$/, '');
    const themeLabel = (th: { id: string; label: string; brand?: boolean; scheme: string }) => th.brand
        ? t(th.scheme === 'dark' ? 'appearance.brandDark' : 'appearance.brandLight', { name: brandName(th.label) })
        : tr(`appearance.themes.${th.id}.label`, th.label);

    const themeOptions = [
        { value: 'system', label: t('appearance.system'), description: t('appearance.systemDescription') },
        ...themes.map((th) => ({ value: th.id, label: themeLabel(th) })),
    ];

    return (
        <Card title={p('title')} description={p('description')} bodyClassName="space-y-6">
            <RadioGroup<Locale>
                legend={p('language.legend')}
                help={p('language.help')}
                name="locale"
                value={locale}
                onChange={setLocale}
                options={[
                    { value: 'es', label: p('language.es') },
                    { value: 'en', label: p('language.en') },
                ]}
            />
            <RadioGroup<string>
                legend={p('theme.legend')}
                help={p('theme.help')}
                name="theme"
                value={preference}
                onChange={setPreference}
                options={themeOptions}
            />
            <RadioGroup<Density>
                legend={p('density.legend')}
                help={p('density.help')}
                name="density"
                value={density}
                onChange={setDensity}
                options={[
                    { value: 'comfortable', label: p('density.comfortable'), description: p('density.comfortableHelp') },
                    { value: 'compact', label: p('density.compact'), description: p('density.compactHelp') },
                ]}
            />
        </Card>
    );
}
