import { prisma } from '@/lib/prisma';

type GoogleTokenResult = {
    accessToken: string;
    refreshToken?: string | null;
    accountId: string;
};

async function refreshGoogleAccessToken(refreshToken: string) {
    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        throw new Error('Google OAuth is not configured');
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
        }),
    });

    const data = await response.json();
    if (!response.ok || data?.error) {
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

export async function getGoogleAccessToken(userId: string): Promise<GoogleTokenResult> {
    const account = await prisma.account.findFirst({
        where: {
            userId,
            provider: 'google',
        },
        orderBy: { id: 'asc' },
    });

    if (!account?.access_token) {
        throw new Error('Google account is not linked');
    }

    const expiresAt = account.expires_at ? account.expires_at * 1000 : 0;
    const isExpired = Boolean(expiresAt) && expiresAt <= Date.now() + 60_000;

    if (!isExpired) {
        return {
            accessToken: account.access_token,
            refreshToken: account.refresh_token,
            accountId: account.id,
        };
    }

    if (!account.refresh_token) {
        throw new Error('Google account needs to be reconnected');
    }

    const refreshed = await refreshGoogleAccessToken(account.refresh_token);

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
    };
}