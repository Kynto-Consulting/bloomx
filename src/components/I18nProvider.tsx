'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
    DEFAULT_LOCALE,
    LOCALE_COOKIE,
    LOCALE_STORAGE_KEY,
    getTranslator,
    isLocale,
    type Locale,
    type TranslateParams,
} from '@/lib/i18n';

/**
 * Proveedor de idioma. El servidor resuelve el idioma inicial (cookie -> Accept-Language)
 * y lo pasa por props, asi el primer HTML ya sale en el idioma correcto y con <html lang>.
 * Al cambiar de idioma se guarda en cookie (para el SSR) y localStorage, y se actualiza
 * <html lang> sin recargar.
 */

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export interface I18nContextValue {
    locale: Locale;
    setLocale: (locale: Locale) => void;
    t: (key: string, params?: TranslateParams) => string;
    /** Locale BCP-47 para Intl (fechas, numeros). */
    intlLocale: string;
}

const defaultTr = getTranslator(DEFAULT_LOCALE);

const I18nContext = createContext<I18nContextValue>({
    locale: DEFAULT_LOCALE,
    setLocale: () => { },
    t: defaultTr.t,
    intlLocale: DEFAULT_LOCALE,
});

export const useI18n = () => useContext(I18nContext);

export function I18nProvider({ locale: initial, children }: { locale: Locale; children: React.ReactNode }) {
    const [locale, setLocaleState] = useState<Locale>(initial);

    // Si el usuario ya eligio idioma en localStorage pero no hay cookie (cookie borrada), restaurarlo.
    useEffect(() => {
        try {
            const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
            const hasCookie = document.cookie.split('; ').some((c) => c.startsWith(`${LOCALE_COOKIE}=`));
            if (!hasCookie && isLocale(stored) && stored !== initial) {
                setLocaleState(stored);
                document.documentElement.lang = stored;
            }
        } catch { /* storage bloqueado */ }
    }, [initial]);

    const setLocale = useCallback((next: Locale) => {
        if (!isLocale(next)) return;
        setLocaleState(next);
        try { document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`; } catch { /* noop */ }
        try { window.localStorage.setItem(LOCALE_STORAGE_KEY, next); } catch { /* noop */ }
        document.documentElement.lang = next;
    }, []);

    const value = useMemo<I18nContextValue>(() => {
        const tr = getTranslator(locale);
        return { locale, setLocale, t: tr.t, intlLocale: locale };
    }, [locale, setLocale]);

    return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
