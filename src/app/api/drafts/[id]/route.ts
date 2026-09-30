import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/session';
import { resolveAuthorizedSenders } from '@/lib/draft-access';

export async function DELETE(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const params = await props.params;
    const user = await getCurrentUser();
    if (!user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    try {
        // Solo el remitente propietario puede borrar el borrador (Draft no tiene userId). El borrador puede
        // estar guardado con una cuenta vinculada como remitente: se compara con todas las direcciones del usuario.
        const senders = Array.from(await resolveAuthorizedSenders(user.id, user.email));
        const result = await prisma.draft.deleteMany({
            where: { id: params.id, from: { in: senders } },
        });
        // count 0 = ya no existe (o no es suyo): se responde igual para no filtrar existencia.
        return NextResponse.json({ success: true, deleted: result.count });
    } catch (error: any) {
        // If record not found, it's already deleted. Treat as success.
        if (error?.code === 'P2025') {
            return NextResponse.json({ success: true });
        }
        console.error('Failed to delete draft:', error);
        return NextResponse.json({ error: 'Failed to delete draft' }, { status: 500 });
    }
}
