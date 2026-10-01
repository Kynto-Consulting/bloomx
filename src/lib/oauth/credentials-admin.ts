import { oauthStore } from './store';
import { credentialNamesOf, loadProviders, saveProviderSecret, saveSharedCredential, usesOfficialEndpoints, type ProviderRuntime } from './providers';
import { parseServiceAccount } from './principals';

/**
 * Credenciales OAuth que gestiona el NUCLEO (no el backend compartido): client secret, refresh token del organizador y JSON de la cuenta de
 * servicio de los proveedores que declara una extension. El panel de credenciales de la extension (/api/admin/extensions/settings) las
 * DESVIA aqui: se guardan cifradas con la clave de datos de ESTA instancia, ancladas a los hosts aprobados, y jamas viajan al backend ni a
 * una extension.
 */

const providersOf = async (extensionId: string): Promise<ProviderRuntime[]> => Array.from((await loadProviders()).values()).filter((p) => p.extensionId === extensionId);

export interface OAuthCredentialStatus { name: string; configured: boolean; source: 'domain' | 'server-env' | 'missing'; movable: false }

/** Estado (sin valores) de las credenciales OAuth de una extension: 'domain' = guardada en la instancia; 'server-env' = variable de entorno heredada. */
export async function oauthCredentialStatus(extensionId: string): Promise<OAuthCredentialStatus[]> {
    const out: OAuthCredentialStatus[] = [];
    for (const p of await providersOf(extensionId)) {
        const row = await oauthStore().getProviderConfig(p.id).catch(() => null);
        const pinned = !!row && JSON.stringify([...row.approvedHosts].sort()) === JSON.stringify(p.endpointHosts);
        const official = usesOfficialEndpoints(p.id, p.endpointHosts);
        for (const name of credentialNamesOf(p)) {
            const stored = pinned && (name === p.clientSecretName ? !!row?.clientSecret : !!row?.extra?.[name]);
            const env = official && !!process.env[name];
            out.push({ name, configured: stored || env, source: stored ? 'domain' : env ? 'server-env' : 'missing', movable: false });
        }
    }
    return out;
}

export type DivertResult = { remaining: Record<string, unknown>; applied: string[]; set: string[]; removed: string[]; error?: 'invalid_service_account' | 'storage_unavailable' };

/** Separa de `credentials` las que gestiona el nucleo y las guarda/borra aqui. El resto se reenvia al backend como siempre. */
export async function divertOAuthCredentials(extensionId: string, credentials: Record<string, unknown>, by: string | null): Promise<DivertResult> {
    const remaining = { ...credentials };
    const applied: string[] = [];
    const set: string[] = [];
    const removed: string[] = [];
    for (const p of await providersOf(extensionId)) {
        for (const name of credentialNamesOf(p)) {
            if (!(name in remaining)) continue;
            const value = remaining[name];
            delete remaining[name];
            applied.push(name);
            if (value === null || value === '') {
                const ok = name === p.clientSecretName ? await clearClientSecret(p, by) : await saveSharedCredential(p, name, null, by);
                if (!ok) return { remaining, applied, set, removed, error: 'storage_unavailable' };
                removed.push(name);
                continue;
            }
            if (typeof value !== 'string' || value.length > 16_384) return { remaining, applied, set, removed, error: 'invalid_service_account' };
            if (name === p.principals.serviceAccountJson && !parseServiceAccount(value)) return { remaining, applied, set, removed, error: 'invalid_service_account' };
            const ok = name === p.clientSecretName ? await saveProviderSecret(p, value.trim(), by) : await saveSharedCredential(p, name, value, by);
            if (!ok) return { remaining, applied, set, removed, error: 'storage_unavailable' };
            set.push(name);
        }
    }
    return { remaining, applied, set, removed };
}

async function clearClientSecret(p: ProviderRuntime, by: string | null): Promise<boolean> {
    const row = await oauthStore().getProviderConfig(p.id).catch(() => null);
    if (!row) return true;
    // Se conserva el resto de credenciales compartidas: solo se vacia el client secret.
    return oauthStore().saveProviderConfig({ provider: p.id, extensionId: row.extensionId, clientSecret: null, approvedHosts: row.approvedHosts, updatedBy: by, extra: row.extra });
}
