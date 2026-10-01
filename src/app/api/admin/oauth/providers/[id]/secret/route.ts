import { z } from 'zod';
import { adminRoute, audit, badRequest, notFound, parseBody, parseQuery } from '@/lib/admin/http';
import { assertFreshMfa } from '@/lib/admin/stepup';
import { clearProviderSecret, credentialNamesOf, getProvider, saveProviderSecret, saveSharedCredential } from '@/lib/oauth/providers';
import { parseServiceAccount } from '@/lib/oauth/principals';

const value = z.string().min(8).max(16_384).refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v), 'invalid');
// `secret` (historico) = client secret. `credential` + `value` = una credencial COMPARTIDA declarada por el manifest (organizador / cuenta de servicio).
const body = z.union([z.strictObject({ secret: value }), z.strictObject({ credential: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/), value })]);
const delQuery = z.strictObject({ credential: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/).optional() });

/**
 * PUT { secret } | { credential, value }: guarda (write-only) un secreto del proveedor CIFRADO con la clave de datos de ESTA instancia y ANCLADO a
 * los hosts de los endpoints actuales (el admin los aprueba al guardar). Nivel 4 + step-up. Jamas se devuelve ni se registra.
 * DELETE [?credential=NOMBRE]: borra el client secret (sin parametro) o la credencial compartida indicada.
 */
export const PUT = adminRoute<{ id: string }>({ scope: 'oauth.secret', write: true }, async (ctx, { id }) => {
    await assertFreshMfa(ctx);
    const provider = await getProvider(id);
    if (!provider) throw notFound('provider_not_found');
    const input = await parseBody(ctx.req, body);
    const by = ctx.actor.id ?? ctx.actor.email ?? null;
    if ('secret' in input) {
        if (input.secret.length > 512 || /\s/.test(input.secret)) throw badRequest('invalid_input');
        if (!(await saveProviderSecret(provider, input.secret, by))) throw badRequest('storage_unavailable', 'Run db:ensure');
        audit(ctx, 'oauth.secret_saved', { provider: provider.id, extensionId: provider.extensionId, credential: provider.clientSecretName ?? 'clientSecret', approvedHosts: provider.endpointHosts });
        return { success: true, approvedHosts: provider.endpointHosts };
    }
    const allowed = credentialNamesOf(provider).filter((n) => n !== provider.clientSecretName);
    if (!allowed.includes(input.credential)) throw badRequest('unknown_credential');
    // La cuenta de servicio se valida ANTES de guardarla (formato y tamano), sin devolver el contenido.
    if (input.credential === provider.principals.serviceAccountJson && !parseServiceAccount(input.value)) throw badRequest('invalid_service_account');
    if (input.credential === provider.principals.organizerRefreshToken && /\s/.test(input.value)) throw badRequest('invalid_input');
    if (!(await saveSharedCredential(provider, input.credential, input.value, by))) throw badRequest('storage_unavailable', 'Run db:ensure');
    audit(ctx, 'oauth.secret_saved', { provider: provider.id, extensionId: provider.extensionId, credential: input.credential, approvedHosts: provider.endpointHosts });
    return { success: true, credential: input.credential, approvedHosts: provider.endpointHosts };
});

export const DELETE = adminRoute<{ id: string }>({ scope: 'oauth.secret', write: true }, async (ctx, { id }) => {
    await assertFreshMfa(ctx);
    if (!/^[a-z][a-z0-9-]{1,31}$/.test(id)) throw notFound('provider_not_found');
    const { credential } = parseQuery(ctx.req, delQuery);
    if (credential) {
        const provider = await getProvider(id);
        if (!provider || !credentialNamesOf(provider).includes(credential)) throw badRequest('unknown_credential');
        const removed = await saveSharedCredential(provider, credential, null, ctx.actor.id ?? ctx.actor.email ?? null);
        audit(ctx, 'oauth.secret_cleared', { provider: id, credential, removed });
        return { success: true, removed };
    }
    const removed = await clearProviderSecret(id);
    audit(ctx, 'oauth.secret_cleared', { provider: id, removed });
    return { success: true, removed };
});
