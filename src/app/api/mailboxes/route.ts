import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/session';
import { getAccessibleMailboxUserIds } from '@/lib/mailbox-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/mailboxes -> buzones que la SESION puede leer (el propio y los vinculados), con su id y direccion.
 * El cliente los usa para pedir la union en el servidor (`mailboxes=<ids>` en /api/emails, /api/counts y /api/emails/batch).
 * Nunca lista buzones que getAccessibleMailboxUserIds no devuelva.
 */
export async function GET() {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    try {
        const ids = await getAccessibleMailboxUserIds(user.id);
        const rows = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } });
        const mailboxes = rows
            .map((r) => ({ id: r.id, email: r.email, self: r.id === user.id }))
            .sort((a, b) => Number(b.self) - Number(a.self) || a.email.localeCompare(b.email));
        return NextResponse.json({ mailboxes }, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) {
        console.error('[GET /api/mailboxes] failed:', error instanceof Error ? error.message.slice(0, 200) : 'error');
        return NextResponse.json({ error: 'Failed to load mailboxes' }, { status: 500 });
    }
}
