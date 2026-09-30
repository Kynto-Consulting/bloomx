/**
 * Errores de autenticacion de Google (sin dependencias de BD para poder probarlos).
 *
 *  - GOOGLE_NOT_LINKED: el usuario nunca conecto Google  -> 409 (accion: conectar)
 *  - GOOGLE_RECONNECT_REQUIRED: token revocado/expirado o scopes insuficientes -> 401 (accion: reconectar)
 */
export type GoogleAuthErrorCode = 'GOOGLE_NOT_LINKED' | 'GOOGLE_RECONNECT_REQUIRED';

export class GoogleAuthError extends Error {
    readonly code: GoogleAuthErrorCode;

    constructor(code: GoogleAuthErrorCode, message?: string) {
        super(message ?? (code === 'GOOGLE_NOT_LINKED' ? 'Google account is not linked' : 'Google account needs to be reconnected'));
        this.name = 'GoogleAuthError';
        this.code = code;
    }
}

export function isGoogleAuthError(error: unknown): error is GoogleAuthError {
    return error instanceof GoogleAuthError || (Boolean(error) && (error as { name?: unknown }).name === 'GoogleAuthError');
}

/** Ruta que inicia el flujo OAuth de Google. `returnTo` debe ser una ruta interna valida. */
export const GOOGLE_RECONNECT_PATH = '/api/auth/google';

export function buildReconnectUrl(returnTo: string = '/'): string {
    const safe = returnTo.startsWith('/') && !returnTo.startsWith('//') && !returnTo.includes('\\') ? returnTo : '/';
    return `${GOOGLE_RECONNECT_PATH}?returnTo=${encodeURIComponent(safe)}`;
}

/** Traduce un error de Google a la respuesta HTTP que debe recibir el cliente. */
export function googleAuthErrorToResponse(error: GoogleAuthError, returnTo: string = '/'): { status: number; body: Record<string, unknown> } {
    if (error.code === 'GOOGLE_RECONNECT_REQUIRED') {
        return {
            status: 401,
            body: {
                error: error.message,
                code: error.code,
                reconnect: true,
                reconnectUrl: buildReconnectUrl(returnTo),
            },
        };
    }
    return {
        status: 409,
        body: { error: error.message, code: error.code, reconnect: false, reconnectUrl: buildReconnectUrl(returnTo) },
    };
}

/**
 * Clasifica una respuesta de error de la API de Google. Devuelve un GoogleAuthError si el problema
 * se resuelve reconectando la cuenta (token invalido/revocado, scopes insuficientes) y null si no.
 */
export function classifyGoogleApiError(status: number, body: unknown): GoogleAuthError | null {
    const err = (body as { error?: unknown } | null)?.error;
    const errObj = (err && typeof err === 'object' ? err : {}) as { status?: string; message?: string; errors?: Array<{ reason?: string }> };
    const reasons = (errObj.errors || []).map((e) => e.reason);
    const errString = typeof err === 'string' ? err : '';

    if (errString === 'invalid_grant' || errString === 'invalid_token') {
        return new GoogleAuthError('GOOGLE_RECONNECT_REQUIRED');
    }
    if (status === 401 || errObj.status === 'UNAUTHENTICATED') {
        return new GoogleAuthError('GOOGLE_RECONNECT_REQUIRED');
    }
    const scopeProblem =
        reasons.includes('insufficientPermissions') ||
        /insufficient (authentication )?scopes?/i.test(errObj.message || '') ||
        (errObj.status === 'PERMISSION_DENIED' && /scope/i.test(errObj.message || ''));
    if (status === 403 && scopeProblem) {
        return new GoogleAuthError('GOOGLE_RECONNECT_REQUIRED', 'Google permissions are missing; reconnect your Google account');
    }
    return null;
}
