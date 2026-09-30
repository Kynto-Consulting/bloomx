import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/session';

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
        // Solo el remitente propietario puede borrar el borrador (Draft no tiene userId)
        await prisma.draft.delete({
            where: { id: params.id, from: user.email },
        });
        return NextResponse.json({ success: true });
    } catch (error: any) {
        // If record not found, it's already deleted. Treat as success.
        if (error?.code === 'P2025') {
            return NextResponse.json({ success: true });
        }
        console.error('Failed to delete draft:', error);
        return NextResponse.json({ error: 'Failed to delete draft' }, { status: 500 });
    }
}
