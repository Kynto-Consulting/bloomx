/**
 * i18n de BloomX (es/en). Punto de entrada: diccionarios + traductor.
 *
 *   Servidor:  import { getServerTranslator } from '@/lib/i18n/server'
 *   Cliente:   const { t, locale, setLocale } = useI18n()   // '@/components/I18nProvider'
 *   Puro/test: createTranslator(locale, dictionaries)
 */
import { createTranslator, type Dictionaries, type Locale, type Translator } from './core';
import es from './messages/es';
import en from './messages/en';

export * from './core';
export type { Messages } from './messages/es';

export const dictionaries: Dictionaries = { es, en };

const cache = new Map<Locale, Translator>();

/** Traductor con los diccionarios reales (cacheado por idioma). */
export function getTranslator(locale: Locale): Translator {
    let tr = cache.get(locale);
    if (!tr) {
        tr = createTranslator(locale, dictionaries);
        cache.set(locale, tr);
    }
    return tr;
}
