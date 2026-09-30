'use client';

import { useMemo } from 'react';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { useI18n } from '@/components/I18nProvider';
import { getTranslator, type Locale } from '@/lib/i18n';
import {
    landingFromTheme,
    resolveDocsVisibility,
    resolveLandingText,
    type LandingConfig,
    type LandingTextKey,
} from '@/lib/landing-config';

/**
 * Landing de la empresa activa (Domain.theme.landing), siempre re-saneada en el cliente (una instancia vieja del
 * backend podria devolverla sin sanear o no devolverla: sin landing -> {} = diseno actual).
 * `t` usa el idioma efectivo (landing.locale si la empresa lo fuerza; si no, el del visitante).
 */
export function useLandingConfig() {
    const { config, isLoading } = useDomainConfig();
    const { locale: userLocale } = useI18n();
    const theme = config?.theme;
    const landing: LandingConfig = useMemo(() => landingFromTheme(theme), [theme]);
    const locale: Locale = landing.locale ?? userLocale;
    const tr = useMemo(() => getTranslator(locale), [locale]);
    const docs = useMemo(() => resolveDocsVisibility(landing), [landing]);
    return {
        landing,
        docs,
        locale,
        isLoading,
        t: tr.t,
        /** Texto de empresa (i18n[locale] > base) o undefined para caer al diccionario. */
        text: (key: LandingTextKey) => resolveLandingText(landing, locale, key),
    };
}
