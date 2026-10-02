import { prisma } from '@/lib/prisma';
import { auditLog } from '@/lib/security';
import { validateActionInput } from '@/lib/expansions/oauth-schema';
import { buildActionRequestUrl } from './action-url';
import { providerFetch } from './http';
import { getProvider, type ProviderRuntime } from './providers';
import { getAccessToken, parseAccountExtras, revokeAtProvider, type RevokeOutcome } from './tokens';

/** `onUnlink` del proveedor (p. ej. DELETE del webhook de Discord con el id/token guardados): mejor esfuerzo, sin token OAuth, mismas reglas de URL que el broker. */
export async function runOnUnlink(provider: ProviderRuntime, account: { provider_data?: string | null }): Promise<boolean> {
    const action = provider.onUnlink ? provider.actions.find((a) => a.id === provider.onUnlink) : undefined;
    if (!action || action.noAuth !== true) return false;
    const input = validateActionInput(action, {});
    if (!input.ok) return false;
    const url = buildActionRequestUrl(provider, action, input, parseAccountExtras(account.provider_data, provider));
    if (!url) return false;
    try {
        const res = await providerFetch(provider.allowedHosts, url, { method: action.method, timeoutMs: 5000, maxBytes: 20_000 });
        return res.ok || res.status === 404;
    } catch {
        return false;
    }
}

/**
 * Desvincula las cuentas de un proveedor de un usuario: REVOCA en el proveedor (RFC 7009, best-effort con timeout: un fallo del proveedor
 * jamas impide desvincular) y borra la fila (tokens incluidos). Auditoria sin tokens: solo proveedor, conteos y resultado de la revocacion.
 */
export async function unlinkUserProvider(userId: string, providerId: string, ip?: string): Promise<{ unlinked: number; revoked: RevokeOutcome[] }> {
    const accounts = await prisma.account.findMany({ where: { userId, provider: providerId } });
    const provider = await getProvider(providerId).catch(() => null);
    const revoked: RevokeOutcome[] = [];
    if (provider && provider.status === 'ready') {
        // Slack: el token de BOT es el de la instalacion del equipo y cada usuario guarda una copia: solo se revoca si ningun otro usuario lo conserva.
        const others = provider.tokenFormat === 'slack-v2' ? await prisma.account.findMany({ where: { provider: providerId } }).catch(() => []) : [];
        for (const account of accounts as Array<{ id: string; providerAccountId: string; refresh_token: string | null; access_token: string | null; provider_data?: string | null }>) {
            // Antes de revocar el token: limpiar lo que dejo la vinculacion en el proveedor (webhook). Un fallo no impide desvincular.
            if (provider.onUnlink) await runOnUnlink(provider, account);
            if (provider.tokenFormat === 'slack-v2' && account.providerAccountId.endsWith(':bot')) {
                const team = account.providerAccountId.split(':')[0];
                if ((others as Array<{ userId: string; providerAccountId: string }>).some((o) => o.userId !== userId && o.providerAccountId.startsWith(`${team}:`) && o.providerAccountId.endsWith(':bot'))) { revoked.push('shared'); continue; }
            }
            let tokens = account;
            // Proveedores que revocan por access token (Zoom): si el access token caduco se refresca primero para poder revocar.
            if (provider.revokeToken === 'access' && account.refresh_token) {
                try { const fresh = await getAccessToken(provider, userId, { accountId: account.id }); tokens = { ...account, access_token: fresh.accessToken }; } catch { /* best-effort */ }
            }
            revoked.push(await revokeAtProvider(provider, tokens));
        }
    }
    const res = await prisma.account.deleteMany({ where: { userId, provider: providerId } });
    auditLog('auth.oauth.unlinked', { provider: providerId, userId, ip, accounts: res.count, revocation: revoked });
    return { unlinked: res.count, revoked };
}
