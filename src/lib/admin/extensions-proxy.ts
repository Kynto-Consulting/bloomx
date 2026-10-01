import { clientVersionHeaders } from '@/lib/expansions/client/capabilities';
import { HttpError } from '@/lib/admin/http';
import { sanitizeUpgrade } from '@/lib/admin/extensions-compat';
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
                // Version del cliente: el backend resuelve la version de cada extension que ESTE cliente entiende.
                ...clientVersionHeaders(),
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
    if (status === 404 && data?.code === 'VERSION_NOT_FOUND') return new HttpError(404, 'version_not_found');
    if (status === 404) return new HttpError(404, notFoundCode);
    // La version que sirve este cliente no es compatible: codigo estable + upgrade saneado (versiones/capacidades acotadas).
    if (status === 409 && data?.code === 'EXTENSION_CLIENT_INCOMPATIBLE') {
        const upgrade = sanitizeUpgrade(data?.upgrade);
        const missingCaps = upgrade?.missingCaps.length ? upgrade.missingCaps : (sanitizeUpgrade({ missingCaps: data?.missingCaps })?.missingCaps ?? []);
        return new HttpError(409, 'client_incompatible', undefined, { upgrade, missingCaps });
    }
    // Dependencias entre extensiones: lista saneada (ids, rangos y acciones acotados), nunca el texto del backend.
    if (status === 409 && data?.code === 'EXTENSION_DEPENDENCIES_REQUIRED') return new HttpError(409, 'dependencies_required', undefined, { dependencies: sanitizeDeps(data?.dependencies) });
    if (status === 409 && data?.code === 'EXTENSION_DEPENDENCY_MISSING') return new HttpError(409, 'EXTENSION_DEPENDENCY_MISSING', undefined, { errors: sanitizeDepErrors(data?.errors ?? data?.dependencies) });
    if (status === 409 && data?.code === 'PUBLIC_ROUTE_APPROVAL_REQUIRED') return new HttpError(409, 'PUBLIC_ROUTE_APPROVAL_REQUIRED');
    if (status === 409 && data?.code === 'PERMISSION_APPROVAL_REQUIRED') return new HttpError(409, 'PERMISSION_APPROVAL_REQUIRED');
    if (status === 429) return new HttpError(429, 'rate_limited');
    return new HttpError(502, typeof data?.code === 'string' && /^[A-Z_]{1,40}$/.test(data.code) ? data.code : 'backend_error');
}

const DEP_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const short = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
function sanitizeDeps(raw: unknown): Array<{ id: string; version: string; range: string; action: 'install' | 'activate' }> {
    if (!Array.isArray(raw)) return [];
    return raw.filter((d) => d && typeof d.id === 'string' && DEP_ID.test(d.id)).slice(0, 16)
        .map((d) => ({ id: d.id, version: short(d.version, 32), range: short(d.range, 60), action: d.action === 'activate' ? 'activate' as const : 'install' as const }));
}
function sanitizeDepErrors(raw: unknown): Array<{ dependency: string; range: string; reason: string }> {
    if (!Array.isArray(raw)) return [];
    return raw.filter((d) => d && typeof d.dependency === 'string' && DEP_ID.test(d.dependency)).slice(0, 16)
        .map((d) => ({ dependency: d.dependency, range: short(d.range, 60), reason: short(d.reason, 40) }));
}

/** Ids de extension de una lista del backend (pausadas / por pausar), acotados y validados. */
export function sanitizeIdList(raw: unknown): string[] {
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id)).slice(0, 50) : [];
}
