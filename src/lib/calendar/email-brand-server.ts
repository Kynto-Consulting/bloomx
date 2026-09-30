/**
 * Carga de la marca de correo en SERVIDOR (rutas API, notificaciones). Usa la MISMA peticion y cache que el layout
 * (GET {backend}/api/config?domain=..., revalidate 60 s, etiqueta DOMAIN_CONFIG_TAG): `PUT /api/admin/domain` la invalida,
 * asi que un cambio de logo o color llega a los correos en cuanto el admin guarda.
 *
 * Nunca lanza: si el backend no responde o no hay config se devuelve la marca por defecto (Bloom), que es el
 * comportamiento previo. Sin secretos: /api/config ya es publico.
 */
import { DOMAIN_CONFIG_TAG } from '@/lib/domain-config-cache';
import { LOCALE_COOKIE } from '@/lib/i18n/core';
import { getEmailBrand, resolveEmailLocale, type EmailBrand, type EmailDomainContext, type EmailLocale } from './email-brand';

/** Mismo criterio de dominio del tenant que el resto del servidor: TOP_DOMAIN o Host (sin puerto). */
export function resolveEmailHost(req?: Request | null): string {
    const fromReq = req?.headers?.get('x-forwarded-host') || req?.headers?.get('host') || '';
    return (process.env.TOP_DOMAIN || fromReq).split(',')[0].trim().split(':')[0].toLowerCase();
}

export async function fetchDomainEmailContext(host: string): Promise<EmailDomainContext | null> {
    try {
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://backend.bloomx.arubik.dev';
        const url = new URL(`${backendUrl}/api/config`);
        if (host) url.searchParams.set('domain', host);
        const res = await fetch(url.toString(), {
            headers: { 'x-forwarded-host': host },
            next: { revalidate: 60, tags: [DOMAIN_CONFIG_TAG] },
        });
        if (!res.ok) return null;
        const data = await res.json();
        const config = data?.config;
        return config && typeof config === 'object' ? (config as EmailDomainContext) : null;
    } catch {
        return null;
    }
}

/** Marca del dominio de la peticion (o la marca por defecto). */
export async function getRequestEmailBrand(req?: Request | null): Promise<EmailBrand> {
    const host = resolveEmailHost(req);
    return getEmailBrand(await fetchDomainEmailContext(host));
}

function readCookie(header: string | null | undefined, name: string): string | null {
    if (!header) return null;
    for (const part of header.split(';')) {
        const [k, ...v] = part.trim().split('=');
        if (k === name) return decodeURIComponent(v.join('=')).trim() || null;
    }
    return null;
}

/**
 * Idioma del correo segun el contexto de la peticion. `audience: 'recipient'` = invitado de una reserva publica
 * (Accept-Language primero); `'user'` = usuario/anfitrion (su preferencia, luego la de la empresa).
 */
export function getRequestEmailLocale(
    req: Request | null | undefined,
    brand: Pick<EmailBrand, 'locale'> | null,
    audience: 'recipient' | 'user',
): EmailLocale {
    return resolveEmailLocale({
        brand,
        audience,
        preferred: readCookie(req?.headers?.get('cookie'), LOCALE_COOKIE),
        acceptLanguage: req?.headers?.get('accept-language') ?? null,
    });
}
