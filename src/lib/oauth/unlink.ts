import { prisma } from '@/lib/prisma';
import { auditLog } from '@/lib/security';
import { getProvider } from './providers';
import { getAccessToken, revokeAtProvider, type RevokeOutcome } from './tokens';

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
        for (const account of accounts as Array<{ id: string; providerAccountId: string; refresh_token: string | null; access_token: string | null }>) {
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
