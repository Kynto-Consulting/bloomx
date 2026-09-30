import { HttpError } from '@/lib/admin/http';
import { backendUrl } from '@/lib/admin/extensions-instance';

/**
 * Llamadas de los proxies /api/admin/extensions/** al backend compartido (`/api/manager/extensions/**`), que exige la
 * sesion de manager (cookie lucia) y propiedad del dominio. Se reenvia SOLO la cookie y un cuerpo reconstruido por la ruta
 * (nunca el cuerpo crudo del navegador); timeout de 10 s; las respuestas las reduce cada ruta a una lista blanca.
 */

const TIMEOUT_MS = 10_000;

export interface BackendResult {
    status: number;
    data: any;
}

export async function managerFetch(req: Request, path: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<BackendResult> {
    try {
        const res = await fetch(`${backendUrl()}${path}`, {
            method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
            headers: {
                ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
                Cookie: req.headers.get('cookie') || '',
            },
            body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
            cache: 'no-store',
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const data = await res.json().catch(() => ({}));
        return { status: res.status, data };
    } catch {
        throw new HttpError(502, 'backend_unavailable');
    }
}

/** El backend exige sesion de manager: 401/403 => el admin no la tiene (p. ej. admin por ADMIN_EMAILS) o no es dueno. */
export const isManagerDenied = (status: number) => status === 401 || status === 403;

/** Convierte un estado de error del backend en un HttpError con codigo estable (sin reenviar su texto). */
export function backendError(result: BackendResult, notFoundCode = 'not_installed'): HttpError {
    const { status, data } = result;
    if (isManagerDenied(status)) return new HttpError(403, 'manager_session_required');
    if (status === 400) return new HttpError(400, 'invalid_input');
    if (status === 402) return new HttpError(402, 'PAYMENT_REQUIRED');
    if (status === 404) return new HttpError(404, notFoundCode);
    if (status === 429) return new HttpError(429, 'rate_limited');
    return new HttpError(502, typeof data?.code === 'string' && /^[A-Z_]{1,40}$/.test(data.code) ? data.code : 'backend_error');
}
