import { prisma } from '@/lib/prisma';
import { apiBase } from '@/lib/conferencing/api-bases';
import { ConferencingError } from '@/lib/conferencing/types';

/**
 * Token de la cuenta Zoom VINCULADA DEL PROPIO USUARIO (OAuth de usuario: api/auth/[provider] + api/auth/callback/zoom).
 * Account.access_token/refresh_token ya llegan descifrados (extension de Prisma lib/account-tokens.ts).
 * Nunca toca la cuenta de otro usuario: el filtro siempre es `userId`.
 *
 * Los refresh tokens de Zoom son de UN SOLO USO: al refrescar se guarda el nuevo par. Si Zoom responde invalid_grant
 * (revocado / app desinstalada) la cuenta queda marcada como caida y se pide reconectar.
 */

export interface ZoomTokenResult {
    accessToken: string;
    accountId: string;
    scope?: string | null;
}

const inflight = new Map<string, Promise<ZoomTokenResult>>();

export function zoomOAuthConfigured(env: Record<string, string | undefined> = process.env): boolean {
    return Boolean(env.ZOOM_CLIENT_ID && env.ZOOM_CLIENT_SECRET);
}

async function refresh(accountId: string, refreshToken: string, previous: { scope: string | null; token_type: string | null }): Promise<ZoomTokenResult> {
    const clientId = process.env.ZOOM_CLIENT_ID;
    const clientSecret = process.env.ZOOM_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new ConferencingError('not_connected', 'Zoom OAuth is not configured on this instance');

    let res: Response;
    try {
        res = await fetch(`${apiBase('ZOOM_OAUTH_BASE')}/oauth/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
            },
            body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
            signal: AbortSignal.timeout(10_000),
        });
    } catch {
        throw new ConferencingError('provider_error', 'Could not reach Zoom');
    }
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || !data?.access_token) {
        if (data?.error === 'invalid_grant' || res.status === 400 || res.status === 401) {
            await prisma.account
                .update({ where: { id: accountId }, data: { access_token: null, refresh_token: null, expires_at: 0 } })
                .catch(() => undefined);
            throw new ConferencingError('token_revoked', 'Zoom account needs to be reconnected');
        }
        throw new ConferencingError('provider_error', 'Failed to refresh the Zoom token');
    }

    const expiresAt = Number.isFinite(Number(data.expires_in)) ? Math.floor(Date.now() / 1000 + Number(data.expires_in)) : null;
    const updated = await prisma.account.update({
        where: { id: accountId },
        data: {
            access_token: data.access_token,
            refresh_token: data.refresh_token || refreshToken,
            expires_at: expiresAt,
            scope: data.scope || previous.scope,
            token_type: data.token_type || previous.token_type,
        },
    });
    return { accessToken: data.access_token, accountId: updated.id, scope: updated.scope };
}

export async function getZoomAccessToken(userId: string): Promise<ZoomTokenResult> {
    const account = await prisma.account.findFirst({ where: { userId, provider: 'zoom' }, orderBy: { id: 'asc' } });
    if (!account) throw new ConferencingError('not_connected', 'Zoom account is not linked');
    if (!account.access_token && !account.refresh_token) throw new ConferencingError('token_revoked', 'Zoom account needs to be reconnected');

    const expiresAt = account.expires_at ? account.expires_at * 1000 : 0;
    const expired = !account.access_token || (expiresAt > 0 && expiresAt <= Date.now() + 60_000);
    if (!expired && account.access_token) return { accessToken: account.access_token, accountId: account.id, scope: account.scope };
    if (!account.refresh_token) throw new ConferencingError('token_revoked', 'Zoom account needs to be reconnected');

    const pending = inflight.get(account.id);
    if (pending) return pending;
    const p = refresh(account.id, account.refresh_token, { scope: account.scope, token_type: account.token_type }).finally(() => inflight.delete(account.id));
    inflight.set(account.id, p);
    return p;
}
