
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getLinkedAuth } from '@/lib/conferencing/auth-context';
import { buildBackendHeaders, loadDomainPrivateKey } from '@/lib/backend-auth';
import { loadDisabledExtensionsForUser } from '@/lib/expansions/user-disabled';
import { getPublicAiState } from '@/lib/ai/settings';
import { annotateExtensionsWithAi, recentBlockedIds } from '@/lib/ai/extension-block';
import { sanitizeDisabledForRequest } from '@/lib/expansions/server-hooks';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://backend.bloomx.arubik.dev';

// Cuentas vinculadas (Google y Zoom) del USUARIO DE LA SESION, compartido con la fachada de conferencias
// (lib/conferencing/auth-context.ts). Google/Zoom son opcionales para el usuario actual.
async function getLinkedAuthContext(userId: string) {
    const { auth } = await getLinkedAuth(userId);
    return auth as Record<string, any>;
}

export async function GET(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const host = process.env.TOP_DOMAIN || req.headers.get('host') || '';

    const { searchParams } = new URL(req.url);
    const trigger = searchParams.get('trigger');

    try {
        // Identidad hacia el backend compartido: firmada (Ed25519) si hay BLOOMX_DOMAIN_PRIVATE_KEY; si no, protocolo
        // legado por cabeceras. Ya no se reenvia el JWT de sesion.
        const backendUrl = `${BACKEND_URL}/api/extensions?trigger=${trigger || ''}`;
        const res = await fetch(backendUrl, {
            headers: buildBackendHeaders({ method: 'GET', url: backendUrl, body: '', domain: host, userId: user.id, email: user.email || '' }),
        });

        if (!res.ok) {
            return NextResponse.json({ error: 'Backend error' }, { status: res.status });
        }

        let data = await res.json();
        // Handlers de middleware: se quitan los de extensiones bloqueadas por la IA (no se ofrecen; siguen instaladas). Los ids bloqueados
        // salen del ultimo calculo de /api/config (misma funcion pura); refrescar el estado de IA (cache 30 s) mantiene el kill switch <= 30 s.
        if (Array.isArray(data)) {
            let blocked = recentBlockedIds();
            if (!blocked) {
                // Calculo antiguo o inexistente (p. ej. nadie llamo a /api/config en este proceso): se recalcula con la config del dominio.
                try {
                    const cfgRes = await fetch(`${BACKEND_URL}/api/config?domain=${encodeURIComponent(host.split(':')[0])}`, { cache: 'no-store' });
                    const cfg = cfgRes.ok ? await cfgRes.json() : null;
                    if (cfg && Array.isArray(cfg.extensions)) annotateExtensionsWithAi(cfg.extensions, await getPublicAiState());
                } catch { /* sin estado: no se filtra; el backend rechaza igualmente la ejecucion */ }
                blocked = recentBlockedIds();
            }
            if (blocked && blocked.size > 0) data = data.filter((h: any) => !blocked.has(String(h?.extensionId ?? '')));
        }
        return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        console.error("Proxy GET Error", error);
        return NextResponse.json({ error: 'Failed to fetch expansions' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const host = process.env.TOP_DOMAIN || req.headers.get('host') || '';

    try {
        const body = await req.json();
        const linkedAuth = await getLinkedAuthContext(user.id);
        const clientContext = body?.context && typeof body.context === 'object' && !Array.isArray(body.context) ? body.context : {};
        // `auth` SOLO lo fija este servidor con las cuentas vinculadas del usuario autenticado: un `context.auth`
        // enviado por el navegador se descarta (no puede inyectar tokens de otros proveedores/cuentas).
        const { auth: _clientAuth, ...safeClientContext } = clientContext as Record<string, unknown>;
        const enrichedContext = Object.keys(linkedAuth).length > 0
            ? { ...safeClientContext, auth: linkedAuth }
            : safeClientContext;
        // Extensiones que el usuario desactivo (de sus ajustes en BD, no del navegador). Solo dominio FIRMADO; el backend ignora la lista
        // para las obligatorias. Si no se pueden leer, no se envia (comportamiento de siempre).
        let disabledExtensions: string[] = [];
        if (loadDomainPrivateKey()) {
            try { disabledExtensions = sanitizeDisabledForRequest(await loadDisabledExtensionsForUser(user.id)); } catch { disabledExtensions = []; }
        }
        const payload = {
            extensionId: body?.extensionId,
            action: body?.action,
            params: body?.params,
            context: enrichedContext,
            ...(disabledExtensions.length > 0 ? { disabledExtensions } : {}),
        };

        // Forward to backend execution endpoint (firmado con la clave de esta instancia, o legado sin clave)
        const executeUrl = `${BACKEND_URL}/api/extension/execute`;
        const rawBody = JSON.stringify(payload);
        const res = await fetch(executeUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...buildBackendHeaders({ method: 'POST', url: executeUrl, body: rawBody, domain: host, userId: user.id, email: user.email || '' }),
            },
            body: rawBody
        });

        const data = await res.json();
        return NextResponse.json(data, { status: res.status });

    } catch (error) {
        console.error("Proxy POST Error", error);
        return NextResponse.json({ error: 'Failed to execute action' }, { status: 500 });
    }
}
