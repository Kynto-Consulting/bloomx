import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { testConnection } from '@/lib/conferencing/service';
import { ConferencingError } from '@/lib/conferencing/types';
import { errorResponse, limit, NO_STORE_HEADERS, parseProvider, resolveDomain } from '@/lib/conferencing/http';
import { invalidateStatusCache } from '@/lib/conferencing/status';
import { auditLog, getClientIp } from '@/lib/security';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';

/**
 * POST /api/calendar/conferencing/{google-meet|zoom}/test  (SOLO administrador de la instancia: requireAdmin)
 * Ejecuta el handler `testConnection` de la extension con las credenciales del dominio -> { ok: true, mode, detail? }.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
    const guard = await requireAdmin(req);
    if (!guard.ok) return guard.response;

    const provider = parseProvider((await params).provider);
    if (!provider || provider === 'custom') return errorResponse(new ConferencingError('invalid_input', 'Unknown provider'));

    const limited = await limit(`conf:test:${getClientIp(req)}`, 10, 60_000);
    if (limited) return errorResponse(limited);

    // La prueba usa las credenciales de la instancia; si el admin es un manager (sin usuario de la app), se usa un id estable.
    const user = await getCurrentUser();
    const actor = {
        userId: user?.id || (guard.actor.kind === 'manager' ? `manager:${guard.actor.id || 'unknown'}` : guard.actor.id),
        email: user?.email || guard.actor.email || null,
        domain: resolveDomain(req),
    };

    try {
        const result = await testConnection(actor, provider);
        invalidateStatusCache(actor);
        auditLog('admin.conferencing.test', { userId: guard.actor.id, provider, outcome: 'ok', ip: getClientIp(req) });
        return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE_HEADERS });
    } catch (error) {
        auditLog('admin.conferencing.test', { userId: guard.actor.id, provider, outcome: 'failed', ip: getClientIp(req) });
        return errorResponse(error);
    }
}
