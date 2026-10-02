import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getClientIp } from '@/lib/security';
import { unlinkUserProvider } from '@/lib/oauth/unlink';
import { invalidateStatusCache } from '@/lib/conferencing/status';
import { resolveDomain } from '@/lib/conferencing/http';

export const runtime = 'nodejs';

/** DELETE /api/auth/unlink/zoom: desvincula la cuenta Zoom del PROPIO usuario (nunca la de otro). */
export async function DELETE(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        // Revoca en Zoom (access token) cuando ZoomLib esta registrado y SIEMPRE borra las cuentas del usuario; audita 'auth.oauth.unlinked' sin tokens.
        await unlinkUserProvider(user.id, 'zoom', getClientIp(req));
        invalidateStatusCache({ userId: user.id, domain: resolveDomain(req) });
        return NextResponse.json({ success: true, message: 'Zoom account unlinked' });
    } catch (error) {
        console.error('Unlink Error:', error instanceof Error ? error.message : 'error');
        return NextResponse.json({ error: 'Failed to unlink account' }, { status: 500 });
    }
}
