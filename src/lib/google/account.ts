import { prisma } from '@/lib/prisma';
import { GoogleAuthError, classifyGoogleApiError } from './errors';
import { pickGoogleAccount } from './pick-account';
import { apiBase } from '@/lib/conferencing/api-bases';

export { GoogleAuthError, isGoogleAuthError, googleAuthErrorToResponse } from './errors';

type GoogleTokenResult = {
    accessToken: string;
    refreshToken?: string | null;
    accountId: string;
    /** Scopes concedidos (Account.scope): el contexto de extensiones los usa para elegir la API de Meet. */
    scope?: string | null;
};

async function refreshGoogleAccessToken(refreshToken: string) {
    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        throw new Error('Google OAuth is not configured');
    }

    const response = await fetch(apiBase('GOOGLE_TOKEN_URL'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
        }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.error) {
        // invalid_grant = el usuario revoco el acceso, cambio la contrasena o el token caduco.
        if (data?.error === 'invalid_grant' || classifyGoogleApiError(response.status, data)) {
            throw new GoogleAuthError('GOOGLE_RECONNECT_REQUIRED');
        }
        throw new Error(data?.error_description || data?.error || 'Failed to refresh Google token');
    }

    return data as {
        access_token: string;
        expires_in?: number;
        refresh_token?: string;
        scope?: string;
        token_type?: string;
    };
}

// Refrescos en curso por cuenta: dos peticiones concurrentes comparten el mismo refresco
// (Google puede invalidar el refresh token si se pide en paralelo) dentro de la misma instancia.
const refreshInFlight = new Map<string, Promise<GoogleTokenResult>>();

export async function getGoogleAccessToken(userId: string): Promise<GoogleTokenResult> {
    const accounts = await prisma.account.findMany({
        where: {
            userId,
            provider: 'google',
        },
    });
    const account = pickGoogleAccount(accounts);

    if (!account) {
        throw new GoogleAuthError('GOOGLE_NOT_LINKED');
    }

    // La cuenta existe pero ya no tiene credenciales utilizables (revocada antes): pedir reconexion.
    if (!account.access_token && !account.refresh_token) {
        throw new GoogleAuthError('GOOGLE_RECONNECT_REQUIRED');
    }

    const expiresAt = account.expires_at ? account.expires_at * 1000 : 0;
    const isExpired = !account.access_token || (Boolean(expiresAt) && expiresAt <= Date.now() + 60_000);

    if (!isExpired && account.access_token) {
        return {
            accessToken: account.access_token,
            refreshToken: account.refresh_token,
            accountId: account.id,
            scope: account.scope,
        };
    }

    if (!account.refresh_token) {
        throw new GoogleAuthError('GOOGLE_RECONNECT_REQUIRED');
    }

    const inFlight = refreshInFlight.get(account.id);
    if (inFlight) return inFlight;

    const refreshToken = account.refresh_token;
    const promise = (async (): Promise<GoogleTokenResult> => {
        let refreshed;
        try {
            refreshed = await refreshGoogleAccessToken(refreshToken);
        } catch (error) {
            if (error instanceof GoogleAuthError) {
                // Marcar la cuenta como caida: las siguientes llamadas piden reconexion sin gastar otro refresco.
                await prisma.account
                    .update({ where: { id: account.id }, data: { access_token: null, refresh_token: null, expires_at: 0 } })
                    .catch(() => undefined);
            }
            throw error;
        }

        const updated = await prisma.account.update({
            where: { id: account.id },
            data: {
                access_token: refreshed.access_token,
                refresh_token: refreshed.refresh_token || account.refresh_token,
                expires_at: refreshed.expires_in ? Math.floor(Date.now() / 1000 + refreshed.expires_in) : account.expires_at,
                scope: refreshed.scope || account.scope,
                token_type: refreshed.token_type || account.token_type,
            },
        });

        return {
            accessToken: updated.access_token || refreshed.access_token,
            refreshToken: updated.refresh_token,
            accountId: updated.id,
            scope: updated.scope,
        };
    })().finally(() => {
        refreshInFlight.delete(account.id);
    });

    refreshInFlight.set(account.id, promise);
    return promise;
}
