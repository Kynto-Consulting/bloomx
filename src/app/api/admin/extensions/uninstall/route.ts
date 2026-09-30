import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { auditLog, getClientIp } from '@/lib/security';

export async function POST(req: Request) {
    const guard = await requireAdmin(req);
    if (!guard.ok) return guard.response;

    try {
        const body = await req.json();
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://backend.bloomx.arubik.dev';
        const cookieStore = req.headers.get('cookie') || '';

        const response = await fetch(`${backendUrl}/api/manager/extensions/uninstall`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': cookieStore,
            },
            body: JSON.stringify(body),
        });

        const data = await response.json();
        // Desinstalar borra authData y credenciales cifradas del dominio (lo hace el backend); aqui queda la traza.
        auditLog('admin.extension.uninstall', {
            userId: guard.actor.id,
            ip: getClientIp(req),
            domainId: typeof body?.domainId === 'string' ? body.domainId : undefined,
            extensionId: typeof body?.extensionId === 'string' ? body.extensionId : undefined,
            outcome: response.ok ? 'ok' : 'failed',
            status: response.status,
            credentialsWiped: response.ok,
        });
        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        console.error('[ADMIN_EXTENSION_UNINSTALL_PROXY]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}