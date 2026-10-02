import { clientVersionHeaders } from '@/lib/expansions/client/capabilities';
import { NextResponse } from 'next/server';
import { requireLevel } from '@/lib/admin-auth';
import { auditLog, getClientIp } from '@/lib/security';
import { shapeConfigResponse, shapeConfigError } from '@/lib/admin/extensions-config-shape';
import { collectUserRefs, normalizeSettingsSchema, type SettingIssue } from '@/lib/expansions/settings-schema';
import { validateUserRefs } from '@/lib/admin/extension-users';
import { assertInstanceDomain } from '@/lib/admin/extensions-instance';
import { refreshPermissions } from '@/lib/permissions';

/**
 * Proxy de AJUSTES por dominio de extensiones (no secretos) -> backend /api/extension/config.
 *
 *   GET  ?domainId=..&extensionId=..                        -> { values, sources, envLegacy, importable, secrets, checklist, meta, limits }
 *   PUT  { domainId, extensionId, values: { clave: valor|null } }  -> { success, ...GET }  | 422 { error, errors:[{path,message}] }
 *   PUT  { domainId, extensionId, values?, secrets?: { 'campo.id.sub': valor|null } }  -> secretos POR ELEMENTO (write-only)
 *   PUT  { domainId, extensionId, reset: true }             -> restablece todos los ajustes
 *   POST { domainId, extensionId, action: 'run-action', actionId, itemId? } -> { ok, result, runLog }
 *   POST { domainId, extensionId, action: 'import-env', keys? } -> { success, imported, ...GET }
 *
 * - Campos `user` / `users` / `userMap` (selector de usuarios): antes de reenviar, ESTE servidor comprueba contra la base del dominio que cada id
 *   NUEVO existe, no esta desactivado y cumple el `filter` del schema (422 con code userMissing | userDisabled | userFilter). El backend compartido
 *   solo valida formato y tipos (no tiene el directorio de usuarios). Exige ademas que `domainId` sea el dominio de esta instancia.
 * - GET = nivel 3 (admin); PUT/POST = nivel 4 (superadmin). El backend vuelve a comprobar sesion de gestor y propiedad del dominio.
 * - La respuesta se reconstruye con lista blanca (lib/admin/extensions-config-shape.ts): nunca pasa un secreto ni un valor del
 *   entorno global; solo nombres de credencial y estado.
 * - La auditoria registra QUE claves cambiaron (nombres), jamas sus valores.
 */

const BACKEND_URL = () => process.env.NEXT_PUBLIC_BACKEND_URL || 'https://backend.bloomx.arubik.dev';
const NO_STORE = { 'Cache-Control': 'no-store' };
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const SECRET_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*\.[a-z0-9-]+\.[A-Za-z][A-Za-z0-9_]*$/;
const ACTION_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const ITEM_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

function shape(status: number, data: any) {
    if (status >= 200 && status < 300) return NextResponse.json(shapeConfigResponse(data), { status, headers: NO_STORE });
    return NextResponse.json(shapeConfigError(data), { status, headers: NO_STORE });
}

async function readBody(req: Request): Promise<any> {
    try {
        return await req.json();
    } catch {
        return null;
    }
}

/** Comprueba los ids de usuario del cambio (si el schema declara campos user/users/userMap). null = nada que bloquear. */
async function userRefIssues(req: Request, domainId: string, extensionId: string, values: Record<string, unknown>): Promise<SettingIssue[] | null> {
    const query = new URLSearchParams({ domainId, extensionId });
    let state: any = null;
    try {
        const res = await fetch(`${BACKEND_URL()}/api/extension/config?${query}`, { method: 'GET', headers: { Cookie: req.headers.get('cookie') || '', ...clientVersionHeaders() }, cache: 'no-store' });
        if (!res.ok) return null; // el PUT recibira el mismo error de autorizacion
        state = await res.json().catch(() => null);
    } catch {
        return null;
    }
    const fields = normalizeSettingsSchema(state?.schema).fields;
    if (collectUserRefs(fields, values).length === 0) return null;
    await assertInstanceDomain(domainId, req);
    await refreshPermissions();
    const stored = state?.values && typeof state.values === 'object' && !Array.isArray(state.values) ? state.values : {};
    const issues = await validateUserRefs(fields, values, stored);
    return issues.length ? issues : null;
}

const keyNames = (value: unknown): string[] => (Array.isArray(value) ? value.filter((k): k is string => typeof k === 'string' && KEY_RE.test(k)).slice(0, 100) : []);

export async function GET(req: Request) {
    const guard = await requireLevel(3, req);
    if (!guard.ok) return guard.response;

    try {
        const { searchParams } = new URL(req.url);
        const domainId = searchParams.get('domainId') || '';
        const extensionId = searchParams.get('extensionId') || '';
        if (!domainId || !extensionId) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400, headers: NO_STORE });
        }
        const query = new URLSearchParams({ domainId, extensionId });
        const response = await fetch(`${BACKEND_URL()}/api/extension/config?${query}`, {
            method: 'GET',
            headers: { Cookie: req.headers.get('cookie') || '', ...clientVersionHeaders() },
            cache: 'no-store',
        });
        const data = await response.json().catch(() => ({}));
        return shape(response.status, data);
    } catch (error) {
        console.error('[ADMIN_EXTENSION_CONFIG_GET]', error instanceof Error ? error.message : 'error');
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500, headers: NO_STORE });
    }
}

export async function PUT(req: Request) {
    const guard = await requireLevel(4, req);
    if (!guard.ok) return guard.response;

    try {
        const body = await readBody(req);
        const domainId = typeof body?.domainId === 'string' ? body.domainId : '';
        const extensionId = typeof body?.extensionId === 'string' ? body.extensionId : '';
        const reset = body?.reset === true;
        const values = body?.values;
        const validValues = !!values && typeof values === 'object' && !Array.isArray(values);
        const secrets = body?.secrets;
        const validSecrets = !!secrets && typeof secrets === 'object' && !Array.isArray(secrets);
        if (!domainId || !extensionId || (!reset && !validValues && !validSecrets) || (body?.values !== undefined && !validValues) || (body?.secrets !== undefined && !validSecrets)) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400, headers: NO_STORE });
        }

        if (!reset && validValues) {
            try {
                const issues = await userRefIssues(req, domainId, extensionId, values as Record<string, unknown>);
                if (issues) return NextResponse.json(shapeConfigError({ error: 'Invalid settings', errors: issues }), { status: 422, headers: NO_STORE });
            } catch (error) {
                const status = typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : 503;
                return NextResponse.json({ error: 'domain_check_failed' }, { status, headers: NO_STORE });
            }
        }

        const response = await fetch(`${BACKEND_URL()}/api/extension/config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Cookie: req.headers.get('cookie') || '', ...clientVersionHeaders() },
            // Solo los campos conocidos.
            body: JSON.stringify(reset ? { domainId, extensionId, reset: true } : { domainId, extensionId, ...(validValues ? { values } : {}), ...(validSecrets ? { secrets } : {}) }),
            cache: 'no-store',
        });
        const data = await response.json().catch(() => ({}));

        const entries = !reset && validValues ? Object.entries(values as Record<string, unknown>) : [];
        const secretEntries = !reset && validSecrets ? Object.entries(secrets as Record<string, unknown>).filter(([k]) => SECRET_NAME_RE.test(k)) : [];
        auditLog('admin.extension.config', {
            userId: guard.actor.id,
            ip: getClientIp(req),
            domainId,
            extensionId,
            action: reset ? 'reset' : 'update',
            outcome: response.ok ? 'ok' : 'failed',
            status: response.status,
            // Solo nombres de ajuste (no valores).
            set: entries.filter(([, v]) => v !== null && v !== '').map(([k]) => k).filter((k) => KEY_RE.test(k)).slice(0, 100),
            removed: entries.filter(([, v]) => v === null || v === '').map(([k]) => k).filter((k) => KEY_RE.test(k)).slice(0, 100),
            // Secretos por elemento: solo el NOMBRE (campo.id.sub), nunca el valor.
            secretsSet: secretEntries.filter(([, v]) => typeof v === 'string' && v !== '').map(([k]) => k).slice(0, 100),
            // Quien rota o borra un secreto queda en la auditoria (userId + hora del registro), nunca con valor.
            secretsRemoved: secretEntries.filter(([, v]) => v === null).map(([k]) => k).slice(0, 100),
        });

        return shape(response.status, data);
    } catch (error) {
        console.error('[ADMIN_EXTENSION_CONFIG_PUT]', error instanceof Error ? error.message : 'error');
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500, headers: NO_STORE });
    }
}

export async function POST(req: Request) {
    const guard = await requireLevel(4, req);
    if (!guard.ok) return guard.response;

    try {
        const body = await readBody(req);
        const domainId = typeof body?.domainId === 'string' ? body.domainId : '';
        const extensionId = typeof body?.extensionId === 'string' ? body.extensionId : '';
        if (!domainId || !extensionId || (body?.action !== 'import-env' && body?.action !== 'run-action')) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400, headers: NO_STORE });
        }
        if (body.action === 'run-action') return runAction(req, guard.actor.id, domainId, extensionId, body);
        const keys = Array.isArray(body.keys) ? keyNames(body.keys) : undefined;

        const response = await fetch(`${BACKEND_URL()}/api/extension/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: req.headers.get('cookie') || '', ...clientVersionHeaders() },
            body: JSON.stringify({ domainId, extensionId, action: 'import-env', ...(keys ? { keys } : {}) }),
            cache: 'no-store',
        });
        const data = await response.json().catch(() => ({}));

        auditLog('admin.extension.config', {
            userId: guard.actor.id,
            ip: getClientIp(req),
            domainId,
            extensionId,
            action: 'import-env',
            outcome: response.ok ? 'ok' : 'failed',
            status: response.status,
            // Solo nombres de ajuste importados (no valores).
            set: response.ok ? keyNames(data?.imported) : [],
        });

        return shape(response.status, data);
    } catch (error) {
        console.error('[ADMIN_EXTENSION_CONFIG_IMPORT]', error instanceof Error ? error.message : 'error');
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500, headers: NO_STORE });
    }
}

async function runAction(req: Request, userId: string | undefined, domainId: string, extensionId: string, body: any) {
    const actionId = typeof body.actionId === 'string' && ACTION_ID_RE.test(body.actionId) ? body.actionId : '';
    const itemId = typeof body.itemId === 'string' && ITEM_ID_RE.test(body.itemId) ? body.itemId : undefined;
    if (!actionId || (body.itemId !== undefined && !itemId)) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400, headers: NO_STORE });
    }
    const response = await fetch(`${BACKEND_URL()}/api/extension/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: req.headers.get('cookie') || '', ...clientVersionHeaders() },
        body: JSON.stringify({ domainId, extensionId, action: 'run-action', actionId, ...(itemId ? { itemId } : {}) }),
        cache: 'no-store',
    });
    const data = await response.json().catch(() => ({}));
    auditLog('admin.extension.config.action', {
        userId,
        ip: getClientIp(req),
        domainId,
        extensionId,
        actionId,
        ...(itemId ? { itemId } : {}),
        outcome: response.ok && data?.result?.status === 'ok' ? 'ok' : 'failed',
        status: response.status,
    });
    return shape(response.status, data);
}
