/**
 * Llamadas del HOST al backend compartido en nombre del MANAGER dueno del dominio (cookie `auth_session` de la peticion):
 *  - GET  /api/admin/domain              -> dominio + extensiones instaladas (ids de instalacion)
 *  - GET/PUT /api/extension/settings     -> credenciales por dominio de una extension (cifradas en el backend)
 * Las rutas que lo usan ya pasaron por requireAdmin(); el backend vuelve a comprobar sesion y propiedad del dominio.
 * Nunca se devuelven valores de credenciales al navegador: solo `{ name, configured }`.
 */
import { backendBaseUrl } from '@/lib/backend-auth';

export const CONFERENCING_EXTENSIONS = ['core-zoom', 'core-google-meet', 'core-microsoft-teams', 'core-calendar'] as const;
export type ConferencingExtensionId = (typeof CONFERENCING_EXTENSIONS)[number];

export interface AdminInstall {
    installed: boolean;
    installId: string | null;
}

export interface AdminDomainInfo {
    domainId: string;
    installs: Record<ConferencingExtensionId, AdminInstall>;
}

type Fetcher = typeof fetch;

export async function fetchAdminDomain(cookie: string, fetchImpl: Fetcher = fetch): Promise<AdminDomainInfo | null> {
    let res: Response;
    try {
        res = await fetchImpl(`${backendBaseUrl()}/api/admin/domain`, { headers: { Cookie: cookie }, cache: 'no-store', signal: AbortSignal.timeout(8_000) });
    } catch {
        return null;
    }
    if (!res.ok) return null;
    const data: any = await res.json().catch(() => null);
    if (!data || typeof data.id !== 'string') return null;

    const installs = Object.fromEntries(CONFERENCING_EXTENSIONS.map((id) => [id, { installed: false, installId: null } as AdminInstall])) as Record<ConferencingExtensionId, AdminInstall>;
    for (const item of Array.isArray(data.extensions) ? data.extensions : []) {
        if (item?.enabled === false) continue;
        const canonical: unknown = item?.extension?.template?.id ?? item?.extension?.id;
        if (typeof canonical === 'string' && (CONFERENCING_EXTENSIONS as readonly string[]).includes(canonical)) {
            const installId = typeof item.extensionId === 'string' ? item.extensionId : typeof item?.extension?.id === 'string' ? item.extension.id : null;
            installs[canonical as ConferencingExtensionId] = { installed: Boolean(installId), installId };
        }
    }
    return { domainId: data.id, installs };
}

export async function fetchCredentialKeys(cookie: string, domainId: string, installId: string, fetchImpl: Fetcher = fetch): Promise<Array<{ name: string; configured: boolean }>> {
    try {
        const res = await fetchImpl(`${backendBaseUrl()}/api/extension/settings?${new URLSearchParams({ domainId, extensionId: installId })}`, {
            headers: { Cookie: cookie },
            cache: 'no-store',
            signal: AbortSignal.timeout(8_000),
        });
        if (!res.ok) return [];
        const data: any = await res.json().catch(() => ({}));
        return (Array.isArray(data?.keys) ? data.keys : [])
            .filter((k: any) => k && typeof k.name === 'string')
            .map((k: any) => ({ name: String(k.name), configured: k.configured === true }));
    } catch {
        return [];
    }
}

/** Escribe credenciales (null = borrar). Devuelve true si el backend las acepto. */
export async function putCredentials(
    cookie: string,
    domainId: string,
    installId: string,
    credentials: Record<string, string | null>,
    fetchImpl: Fetcher = fetch,
): Promise<boolean> {
    try {
        const res = await fetchImpl(`${backendBaseUrl()}/api/extension/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Cookie: cookie },
            body: JSON.stringify({ domainId, extensionId: installId, credentials }),
            cache: 'no-store',
            signal: AbortSignal.timeout(10_000),
        });
        return res.ok;
    } catch {
        return false;
    }
}
