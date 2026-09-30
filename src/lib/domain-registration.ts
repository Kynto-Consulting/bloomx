/**
 * Politica de registro del dominio activo (Domain.theme.landing.registration) para el servidor del frontend.
 *
 *   enabled:false   -> el alta esta cerrada (403), por mucho que el formulario se manipule.
 *   requireKey:false -> no se pide la clave de registro.
 *
 * Se lee de /api/config del backend (cache corta, misma etiqueta que el layout) y se RE-SANEA aqui. Si el backend
 * no responde, se devuelve la politica historica (abierta pero con clave): nunca se abre mas de lo que ya estaba.
 */
import { landingFromTheme } from './landing-config';
import { DOMAIN_CONFIG_TAG } from './domain-config-cache';

export interface RegistrationPolicy { enabled: boolean; requireKey: boolean }
export const DEFAULT_REGISTRATION_POLICY: RegistrationPolicy = { enabled: true, requireKey: true };

/** Politica a partir de un theme crudo (Domain.theme). Puro y testeable. */
export function registrationPolicyFromTheme(theme: unknown): RegistrationPolicy {
    const reg = landingFromTheme(theme).registration;
    return { enabled: reg?.enabled !== false, requireKey: reg?.requireKey !== false };
}

export async function getRegistrationPolicy(req: Request): Promise<RegistrationPolicy> {
    try {
        const host = process.env.TOP_DOMAIN || req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://backend.bloomx.arubik.dev';
        const url = new URL(`${backendUrl}/api/config`);
        if (host) url.searchParams.set('domain', host.split(':')[0]);
        const res = await fetch(url.toString(), {
            headers: { 'x-forwarded-host': host },
            next: { revalidate: 60, tags: [DOMAIN_CONFIG_TAG] },
            signal: AbortSignal.timeout(3000),
        } as RequestInit);
        if (!res.ok) return DEFAULT_REGISTRATION_POLICY;
        const data = await res.json();
        return registrationPolicyFromTheme(data?.config?.theme);
    } catch {
        return DEFAULT_REGISTRATION_POLICY;
    }
}
