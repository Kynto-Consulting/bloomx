import { prisma } from '@/lib/prisma';
import { auditLog } from '@/lib/security';
import { getProvider } from './providers';
import { revokeAtProvider, type RevokeOutcome } from './tokens';

/**
 * Desvincula las cuentas de un proveedor de un usuario: REVOCA en el proveedor (RFC 7009, best-effort con timeout: un fallo del proveedor
 * jamas impide desvincular) y borra la fila (tokens incluidos). Auditoria sin tokens: solo proveedor, conteos y resultado de la revocacion.
 */
export async function unlinkUserProvider(userId: string, providerId: string, ip?: string): Promise<{ unlinked: number; revoked: RevokeOutcome[] }> {
    const accounts = await prisma.account.findMany({ where: { userId, provider: providerId } });
    const provider = await getProvider(providerId).catch(() => null);
    const revoked: RevokeOutcome[] = [];
    if (provider && provider.status === 'ready') {
        for (const account of accounts) revoked.push(await revokeAtProvider(provider, account));
    }
    const res = await prisma.account.deleteMany({ where: { userId, provider: providerId } });
    auditLog('auth.oauth.unlinked', { provider: providerId, userId, ip, accounts: res.count, revocation: revoked });
    return { unlinked: res.count, revoked };
}
