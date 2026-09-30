import { cookies, headers } from 'next/headers';
import { LOCALE_COOKIE, resolveLocale, type Locale } from './core';
import { getTranslator } from './index';

/** Idioma de la peticion: cookie de preferencia -> Accept-Language -> defecto. */
export async function getRequestLocale(): Promise<Locale> {
    let cookie: string | undefined;
    let acceptLanguage: string | null = null;
    try {
        cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
    } catch { /* fuera de contexto de peticion */ }
    try {
        acceptLanguage = (await headers()).get('accept-language');
    } catch { /* idem */ }
    return resolveLocale({ cookie, acceptLanguage });
}

export async function getServerTranslator() {
    return getTranslator(await getRequestLocale());
}
