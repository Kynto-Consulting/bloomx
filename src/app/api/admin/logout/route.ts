import { NextRequest, NextResponse } from 'next/server';
import { auditLog, getClientIp, rateLimitAsync } from '@/lib/security';
import { backendBaseUrl } from '@/lib/backend-auth';

export const runtime = 'nodejs';

/**
 * POST /api/admin/logout -> cierra la sesion de ADMINISTRACION de tipo manager (cookie auth_session del backend):
 * avisa al backend (best-effort, con timeout) y borra la cookie local. No exige requireAdmin a proposito: cerrar sesion
 * debe poder hacerse siempre. La sesion de un usuario admin de la app se cierra con /api/auth/logout.
 */
export async function POST(req: NextRequest) {
    const ip = getClientIp(req);
    const rl = await rateLimitAsync(`adminlogout:${ip}`, 30, 60_000);
    if (!rl.ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } });

    const cookie = req.cookies.get('auth_session')?.value;
    if (cookie) {
        try {
            await fetch(`${backendBaseUrl()}/api/auth/logout`, {
                method: 'POST',
                headers: { Cookie: `auth_session=${cookie}` },
                signal: AbortSignal.timeout(4000),
                cache: 'no-store',
            });
        } catch {
            // el backend puede estar caido: igualmente se borra la cookie local
        }
    }
    auditLog('admin.logout', { ip });
    const res = NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'no-store' } });
    res.cookies.set('auth_session', '', { path: '/', maxAge: 0 });
    return res;
}
