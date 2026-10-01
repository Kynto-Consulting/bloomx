/** Formas de las respuestas de /api/admin/users y /api/admin/accounts (sin secretos por construccion). */

export interface UserRow {
    id: string;
    quotaMb: number | null;
    quotaSource: 'user' | 'domain' | 'env' | 'none';
    name: string | null;
    email: string;
    avatar: boolean;
    createdAt: string | null;
    disabled: boolean;
    isAdmin: boolean;
    mfaEnabled: boolean;
    googleLinked: boolean;
    lastLoginAt: string | null;
    storageBytes: number;
    sessions: number;
}

export interface PageInfo {
    page: number;
    pageSize: number;
    total: number;
    pages: number;
}

export interface UsersResponse {
    users: UserRow[];
    page: PageInfo;
}

export interface UserDetail {
    user: { id: string; name: string | null; email: string; avatar: boolean; createdAt: string | null; isAdmin: boolean; isSelf: boolean; permission_level: number; levelName: string; levelSource: 'env' | 'console' | 'manager' | 'none' };
    state: { disabled: boolean; disabledAt: string | null; mustChangePassword: boolean; lastLoginAt: string | null; lastLoginIp: string | null };
    mfa: { available: boolean; enabled: boolean; pendingEnrollment: boolean; recoveryCodesLeft: number; required: boolean };
    accounts: { id: string; provider: string; scopes: string[]; expiresAt: string | null; hasRefreshToken: boolean }[];
    sessions: { jti: string; mfa: boolean; ip: string | null; userAgent: string | null; createdAt: string | null; expiresAt: string | null }[];
    storage: { attachmentBytes: number; attachmentCount: number; emailCount: number; folders: { folder: string; count: number }[] };
    quota: UserQuota | null;
}

/** Cuota de buzon de un usuario: valor efectivo, origen y uso estimado. */
export interface UserQuota {
    userMb: number | null;
    domainMb: number | null;
    envMb: number | null;
    effectiveMb: number | null;
    source: 'user' | 'domain' | 'env' | 'none';
    usedBytes: number;
    percent: number | null;
    level: string;
    approximate: true;
    maxMb: number;
}

export type AccountStatus = 'valid' | 'expired' | 'revoked';

export interface AccountRow {
    id: string;
    userId: string;
    userEmail: string;
    userName: string | null;
    provider: string;
    providerAccountId: string;
    scopes: string[];
    expiresAt: string | null;
    status: AccountStatus;
    hasRefreshToken: boolean;
    integrations: string[];
}

export interface AccountsResponse {
    accounts: AccountRow[];
    providers: string[];
    page: PageInfo;
}
