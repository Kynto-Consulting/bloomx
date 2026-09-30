/**
 * Contexto `auth` que el HOST inyecta a las extensiones a partir de las cuentas vinculadas del USUARIO DE LA SESION.
 *
 * Seguridad (propiedad estricta): el `userId` sale siempre de la sesion del servidor; este modulo no acepta ids
 * del cliente. Un `context.auth` enviado por el navegador se descarta en las rutas que lo llaman.
 */
import { getGoogleAccessToken, isGoogleAuthError } from '@/lib/google/account';
import { getZoomAccessToken } from '@/lib/zoom/account';
import { isConferencingError } from './types';

export interface LinkedAuthEntry {
    accessToken: string;
    accountId: string;
    scope?: string | null;
    source: 'user-account';
}

export interface LinkedAuth {
    google?: LinkedAuthEntry;
    zoom?: LinkedAuthEntry;
}

export type LinkProblem = 'not_connected' | 'token_revoked';

export interface LinkedAuthResult {
    auth: LinkedAuth;
    /** Por que falta la cuenta de un proveedor (para pedir Conectar vs Reconectar). */
    problems: { google?: LinkProblem; zoom?: LinkProblem };
}

export async function getLinkedAuth(userId: string): Promise<LinkedAuthResult> {
    const auth: LinkedAuth = {};
    const problems: LinkedAuthResult['problems'] = {};

    await Promise.all([
        (async () => {
            try {
                const g = await getGoogleAccessToken(userId);
                auth.google = { accessToken: g.accessToken, accountId: g.accountId, scope: g.scope ?? null, source: 'user-account' };
            } catch (error) {
                if (isGoogleAuthError(error)) problems.google = error.code === 'GOOGLE_RECONNECT_REQUIRED' ? 'token_revoked' : 'not_connected';
                else problems.google = 'not_connected';
            }
        })(),
        (async () => {
            try {
                const z = await getZoomAccessToken(userId);
                auth.zoom = { accessToken: z.accessToken, accountId: z.accountId, scope: z.scope ?? null, source: 'user-account' };
            } catch (error) {
                problems.zoom = isConferencingError(error) && error.code === 'token_revoked' ? 'token_revoked' : 'not_connected';
            }
        })(),
    ]);

    return { auth, problems };
}
