import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/session';
import { auditLog, getClientIp } from '@/lib/security';
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
        await prisma.account.deleteMany({ where: { userId: user.id, provider: 'zoom' } });
        invalidateStatusCache({ userId: user.id, domain: resolveDomain(req) });
        auditLog('auth.oauth.unlinked', { provider: 'zoom', userId: user.id, ip: getClientIp(req) });
        return NextResponse.json({ success: true, message: 'Zoom account unlinked' });
    } catch (error) {
        console.error('Unlink Error:', error instanceof Error ? error.message : 'error');
        return NextResponse.json({ error: 'Failed to unlink account' }, { status: 500 });
    }
}
