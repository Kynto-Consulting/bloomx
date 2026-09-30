/** Tipos compartidos entre las rutas /api/admin/profile* y la pantalla "Mi perfil" de la consola. Sin secretos. */

export interface ProfileMfa {
    available: boolean;
    enabled: boolean;
    pendingEnrollment: boolean;
    recoveryCodesLeft: number;
    /** La politica (ADMIN_EMAILS / MFA_REQUIRED_ALL) exige MFA: no se puede desactivar. */
    required: boolean;
}

export interface ProfileData {
    me: {
        kind: 'user' | 'manager';
        id: string | null;
        name: string | null;
        email: string | null;
        avatar: string | null;
        lastLoginAt: string | null;
        mustChangePassword: boolean;
    };
    /** Solo kind "user" (un manager gestiona MFA y contrasena en el backend). */
    mfa: ProfileMfa | null;
    sessions: { active: number } | null;
    /** Esta instancia firma sus peticiones al backend (hay BLOOMX_DOMAIN_PRIVATE_KEY valida). Solo un booleano. */
    instanceSigning: boolean;
}

export interface ProfileSession {
    jti: string;
    ip: string | null;
    userAgent: string | null;
    createdAt: string | null;
    expiresAt: string | null;
    mfa: boolean;
    current: boolean;
}

export interface DomainKeyStatus {
    registered?: boolean;
    fingerprint?: string | null;
    requireSignature?: boolean;
    legacyMode?: boolean;
    success?: boolean;
}
