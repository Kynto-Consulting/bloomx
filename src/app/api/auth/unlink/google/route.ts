import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getClientIp } from '@/lib/security';
import { invalidateStatusCache } from '@/lib/conferencing/status';
import { resolveDomain } from '@/lib/conferencing/http';
import { unlinkUserProvider } from '@/lib/oauth/unlink';

/** ALIAS de DELETE /api/oauth/google/unlink (misma respuesta de siempre). Ahora ademas REVOCA el acceso en Google (RFC 7009). */
export async function DELETE(req: NextRequest) {
    // La sesion real es el JWT propio (lib/session.ts), no una sesion de NextAuth.
    const user = await getCurrentUser();
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        await unlinkUserProvider(user.id, 'google', getClientIp(req));
        invalidateStatusCache({ userId: user.id, domain: resolveDomain(req) });
        return NextResponse.json({ success: true, message: 'Google account unlinked' });
    } catch (error) {
        console.error('Unlink Error:', error instanceof Error ? error.message.slice(0, 120) : 'error');
        return NextResponse.json({ error: 'Failed to unlink account' }, { status: 500 });
    }
}
