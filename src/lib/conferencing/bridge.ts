/**
 * Puente servidor -> extension (POST {backend}/api/extension/execute), firmado con la clave de dominio de ESTA instancia
 * (o protocolo legado sin firma). Es el UNICO camino por el que el host ejecuta logica de Zoom / Google Meet / Calendar.
 *
 * - La identidad (userId/email) sale de la sesion del servidor, nunca del cuerpo de la peticion del navegador.
 * - `context.auth` lo fija el servidor con las cuentas vinculadas del usuario de la sesion.
 * - La respuesta del backend lleva `X-BloomX-Auth: signed|legacy`: en `legacy` la extension corre SIN credenciales del
 *   dominio (solo puede usar la cuenta del propio usuario).
 */
import { backendBaseUrl, buildBackendHeaders } from '@/lib/backend-auth';
import { loadDomainTemplates } from '@/lib/expansions/domain-templates';
import { grantForTemplate } from '@/lib/expansions/execution-grants';
import { parseExtensionError } from './errors';
import { ConferencingError } from './types';

export type BridgeAuthMode = 'signed' | 'legacy' | null;

export type BridgeResult =
    | { ok: true; result: any; authMode: BridgeAuthMode }
    | { ok: false; error: ConferencingError; kind: 'not_installed' | 'unreachable' | 'rejected'; authMode: BridgeAuthMode };

export interface CallExtensionInit {
    /** Dominio del tenant (cabecera Host / TOP_DOMAIN). */
    domain: string;
    userId: string;
    email?: string | null;
    extensionId: string;
    action: string;
    params?: Record<string, unknown>;
    /** Contexto adicional fijado por el servidor (p. ej. auth de las cuentas vinculadas). */
    context?: Record<string, unknown>;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    /**
     * Concesion de ejecucion (ext.grants.v1) firmada con la clave de ESTE dominio. Si no se pasa, se emite aqui con el manifest que el backend sirve a
     * esta instancia; sin ella el backend no entrega servicios del host (intermediario OAuth, almacenamiento...) a la extension: Meet/Zoom/Teams
     * 2.x dirian siempre 'no conectado'. En pruebas (fetchImpl inyectado) no se hace red para emitirla.
     */
    executionGrant?: string | null;
}

async function resolveExecutionGrant(init: CallExtensionInit): Promise<string | null> {
    if (init.executionGrant !== undefined) return init.executionGrant;
    if (init.fetchImpl) return null;
    try {
        const template = (await loadDomainTemplates(init.domain)).get(init.extensionId);
        return grantForTemplate(init.domain, init.extensionId, template, init.userId);
    } catch {
        return null; // sin grant: los servicios del host quedan sin disponer (como antes de las concesiones)
    }
}

function readAuthMode(res: Response): BridgeAuthMode {
    const v = res.headers?.get?.('x-bloomx-auth');
    return v === 'signed' || v === 'legacy' ? v : null;
}

export async function callExtension(init: CallExtensionInit): Promise<BridgeResult> {
    const doFetch = init.fetchImpl ?? fetch;
    const url = `${backendBaseUrl()}/api/extension/execute`;
    const executionGrant = await resolveExecutionGrant(init);
    const rawBody = JSON.stringify({
        extensionId: init.extensionId,
        action: init.action,
        params: init.params ?? {},
        context: init.context ?? {},
        ...(executionGrant ? { executionGrant } : {}),
    });

    let res: Response;
    try {
        res = await doFetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...buildBackendHeaders({ method: 'POST', url, body: rawBody, domain: init.domain, userId: init.userId, email: init.email || '' }),
            },
            body: rawBody,
            cache: 'no-store',
            signal: AbortSignal.timeout(init.timeoutMs ?? 20_000),
        });
    } catch {
        return { ok: false, kind: 'unreachable', authMode: null, error: new ConferencingError('unavailable', 'Extension backend is unreachable') };
    }

    const authMode = readAuthMode(res);
    const data: any = await res.json().catch(() => ({}));

    if (res.ok && data?.success !== false) {
        return { ok: true, result: data?.result ?? null, authMode };
    }

    const message = typeof data?.error === 'string' ? data.error : '';
    if (res.status === 404 && /not installed/i.test(message)) {
        return { ok: false, kind: 'not_installed', authMode, error: new ConferencingError('unavailable', 'Extension is not installed') };
    }
    if (res.status === 404) {
        return { ok: false, kind: 'rejected', authMode, error: new ConferencingError('not_supported', 'The extension does not implement this action') };
    }
    if (res.status === 401 && message === 'AUTH_REQUIRED') {
        return { ok: false, kind: 'rejected', authMode, error: new ConferencingError('not_connected', 'Account connection required') };
    }
    if (res.status === 401 || res.status === 403) {
        return { ok: false, kind: 'rejected', authMode, error: new ConferencingError('unavailable', 'The extension backend rejected the request') };
    }
    if (res.status === 429) {
        const retry = Number(res.headers?.get?.('retry-after'));
        return { ok: false, kind: 'rejected', authMode, error: new ConferencingError('rate_limited', undefined, { retryAfter: Number.isFinite(retry) && retry > 0 ? retry : undefined }) };
    }
    if (res.status === 408) {
        return { ok: false, kind: 'rejected', authMode, error: new ConferencingError('provider_error', 'The provider took too long to respond') };
    }
    if (res.status >= 500 && !message) {
        return { ok: false, kind: 'unreachable', authMode, error: new ConferencingError('unavailable', 'Extension backend error') };
    }
    return { ok: false, kind: 'rejected', authMode, error: parseExtensionError(message) };
}
