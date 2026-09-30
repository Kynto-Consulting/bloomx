
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getGoogleAccessToken } from '@/lib/google/account';
import { buildBackendHeaders } from '@/lib/backend-auth';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://backend.bloomx.arubik.dev';

async function getLinkedAuthContext(userId: string) {
    const auth: Record<string, any> = {};

    try {
        const google = await getGoogleAccessToken(userId);
        auth.google = {
            accessToken: google.accessToken,
            accountId: google.accountId,
            source: 'user-account'
        };
    } catch {
        // Google is optional for the current user.
    }

    return auth;
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

        const data = await res.json();
        return NextResponse.json(data);
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
        const payload = {
            extensionId: body?.extensionId,
            action: body?.action,
            params: body?.params,
            context: enrichedContext,
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
