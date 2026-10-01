import { clientVersionHeaders } from '@/lib/expansions/client/capabilities';
import { NextResponse } from 'next/server';
import { requireLevel } from '@/lib/admin-auth';
import { auditLog, getClientIp } from '@/lib/security';

/**
 * Proxy de credenciales por dominio de extensiones -> backend /api/extension/settings.
 *
 *   GET  ?domainId=..&extensionId=..            -> { keys: [{ name, configured, source, movable }] }
 *        source = fuente ACTIVA de la variable: 'domain' | 'legacy' | 'server-env' | 'missing' (sin valores).
 *   POST { domainId, extensionId, action: 'migrate-legacy' } -> { success, migrated: [nombres], serverEnv: [nombres], keys }
 *        copia (cifrados, en el backend) los valores heredados del dominio a credenciales del dominio.
 *   PUT  { domainId, extensionId, credentials } -> { success, keys }   (null/"" borra una credencial)
 *
 * - Solo admin (requireAdmin). El backend vuelve a comprobar sesion de manager y propiedad del dominio.
 * - Nunca se devuelve un valor: la respuesta se reconstruye con una lista blanca ({ name, configured }).
 * - La auditoria registra QUE claves cambiaron (nombres), jamas sus valores.
 */

const BACKEND_URL = () => process.env.NEXT_PUBLIC_BACKEND_URL || 'https://backend.bloomx.arubik.dev';
const NO_STORE = { 'Cache-Control': 'no-store' };

const SOURCES = ['domain', 'legacy', 'server-env', 'missing'] as const;

function publicKeys(data: any): { name: string; configured: boolean; source: (typeof SOURCES)[number]; movable: boolean }[] {
    if (!data || !Array.isArray(data.keys)) return [];
    return data.keys
        .filter((k: any) => k && typeof k.name === 'string')
        .map((k: any) => {
            const source = SOURCES.includes(k.source) ? k.source : k.configured === true ? 'domain' : 'missing';
            return { name: String(k.name), configured: k.configured === true, source, movable: k.movable === true };
        });
}

function nameList(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((n): n is string => typeof n === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(n)) : [];
}

function shape(status: number, data: any) {
    if (status >= 200 && status < 300) {
        return NextResponse.json(
            {
                ...(data?.success === true ? { success: true } : {}),
                // Solo NOMBRES de variable (nunca valores), reconstruidos con lista blanca.
                ...(Array.isArray(data?.migrated) ? { migrated: nameList(data.migrated) } : {}),
                ...(Array.isArray(data?.serverEnv) ? { serverEnv: nameList(data.serverEnv) } : {}),
                keys: publicKeys(data),
            },
            { status, headers: NO_STORE },
        );
    }
    // Solo mensajes de error acotados; nada del cuerpo original que pudiera arrastrar datos.
    const error = typeof data?.error === 'string' ? data.error.slice(0, 200) : 'Request failed';
    return NextResponse.json({ error }, { status, headers: NO_STORE });
}

// Niveles (lib/admin-levels.ts): ver nombres de credenciales = 3 (admin); fijarlas, borrarlas o migrarlas = 4 (superadmin).
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
        const response = await fetch(`${BACKEND_URL()}/api/extension/settings?${query}`, {
            method: 'GET',
            headers: { Cookie: req.headers.get('cookie') || '', ...clientVersionHeaders() },
            cache: 'no-store',
        });
        const data = await response.json().catch(() => ({}));
        return shape(response.status, data);
    } catch (error) {
        console.error('[ADMIN_EXTENSION_SETTINGS_GET]', error instanceof Error ? error.message : 'error');
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500, headers: NO_STORE });
    }
}

export async function PUT(req: Request) {
    const guard = await requireLevel(4, req);
    if (!guard.ok) return guard.response;

    try {
        let body: any = null;
        try {
            body = await req.json();
        } catch {
            body = null;
        }
        const domainId = typeof body?.domainId === 'string' ? body.domainId : '';
        const extensionId = typeof body?.extensionId === 'string' ? body.extensionId : '';
        const credentials = body?.credentials;
        if (!domainId || !extensionId || !credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400, headers: NO_STORE });
        }

        const response = await fetch(`${BACKEND_URL()}/api/extension/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Cookie: req.headers.get('cookie') || '', ...clientVersionHeaders() },
            // Se reenvian solo los tres campos conocidos.
            body: JSON.stringify({ domainId, extensionId, credentials }),
            cache: 'no-store',
        });
        const data = await response.json().catch(() => ({}));

        const entries = Object.entries(credentials as Record<string, unknown>);
        auditLog('admin.extension.credentials', {
            userId: guard.actor.id,
            ip: getClientIp(req),
            domainId,
            extensionId,
            outcome: response.ok ? 'ok' : 'failed',
            status: response.status,
            // Solo nombres de variable (no valores): "set" = rotar/establecer, "removed" = borrar.
            set: entries.filter(([, v]) => typeof v === 'string' && v !== '').map(([k]) => k),
            removed: entries.filter(([, v]) => v === null || v === '').map(([k]) => k),
        });

        return shape(response.status, data);
    } catch (error) {
        console.error('[ADMIN_EXTENSION_SETTINGS_PUT]', error instanceof Error ? error.message : 'error');
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500, headers: NO_STORE });
    }
}

export async function POST(req: Request) {
    const guard = await requireLevel(4, req);
    if (!guard.ok) return guard.response;

    try {
        let body: any = null;
        try {
            body = await req.json();
        } catch {
            body = null;
        }
        const domainId = typeof body?.domainId === 'string' ? body.domainId : '';
        const extensionId = typeof body?.extensionId === 'string' ? body.extensionId : '';
        if (!domainId || !extensionId || body?.action !== 'migrate-legacy') {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400, headers: NO_STORE });
        }

        const response = await fetch(`${BACKEND_URL()}/api/extension/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: req.headers.get('cookie') || '', ...clientVersionHeaders() },
            body: JSON.stringify({ domainId, extensionId, action: 'migrate-legacy' }),
            cache: 'no-store',
        });
        const data = await response.json().catch(() => ({}));

        auditLog('admin.extension.credentials.migrate', {
            userId: guard.actor.id,
            ip: getClientIp(req),
            domainId,
            extensionId,
            outcome: response.ok ? 'ok' : 'failed',
            status: response.status,
            // Solo nombres de variable (no valores).
            set: response.ok ? nameList(data?.migrated) : [],
        });

        return shape(response.status, data);
    } catch (error) {
        console.error('[ADMIN_EXTENSION_SETTINGS_MIGRATE]', error instanceof Error ? error.message : 'error');
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500, headers: NO_STORE });
    }
}
