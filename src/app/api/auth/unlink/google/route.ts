import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/session';
import { auditLog, getClientIp } from '@/lib/security';

export async function DELETE(req: NextRequest) {
    // La sesion real es el JWT propio (lib/session.ts), no una sesion de NextAuth: antes esta ruta siempre daba 401.
    const user = await getCurrentUser();
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        await prisma.account.deleteMany({
            where: {
                userId: user.id,
                provider: 'google'
            }
        });

        auditLog('auth.oauth.unlinked', { provider: 'google', userId: user.id, ip: getClientIp(req) });
        return NextResponse.json({ success: true, message: 'Google account unlinked' });
    } catch (error) {
        console.error('Unlink Error:', error);
        return NextResponse.json({ error: 'Failed to unlink account' }, { status: 500 });
    }
}
