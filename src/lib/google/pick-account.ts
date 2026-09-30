/**
 * Elige la cuenta Google a usar cuando hay varias vinculadas: primero las que conservan
 * refresh_token, y entre ellas la de token mas vigente. Determinista (no depende del orden de id).
 */
export function pickGoogleAccount<T extends { id: string; refresh_token?: string | null; access_token?: string | null; expires_at?: number | null }>(
    accounts: T[],
): T | null {
    if (accounts.length === 0) return null;
    return [...accounts].sort((a, b) => {
        const byRefresh = Number(Boolean(b.refresh_token)) - Number(Boolean(a.refresh_token));
        if (byRefresh !== 0) return byRefresh;
        const byExpiry = (b.expires_at ?? 0) - (a.expires_at ?? 0);
        if (byExpiry !== 0) return byExpiry;
        return a.id.localeCompare(b.id);
    })[0];
}
