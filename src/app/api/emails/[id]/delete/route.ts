
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from "@/lib/session";
import { canAccessEmail } from '@/lib/mailbox-access';
import { deleteEmailsCompletely } from '@/lib/retention';
import { auditLog, getClientIp } from '@/lib/security';

// Borrado completo (ISO 27001:2022 A.8.10): HTML, texto, raw.json y todos los adjuntos del almacenamiento
// (respetando objetos compartidos con otros destinatarios del mismo mensaje), y despues la fila.
export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getCurrentUser();

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { id } = await params;

        const email = await prisma.email.findUnique({
            where: { id },
            select: { id: true, userId: true },
        });

        // 404 tanto si no existe como si no es accesible (no confirmar existencia)
        if (!email || !(await canAccessEmail(user.id, email.userId))) {
            return NextResponse.json({ error: 'Email not found' }, { status: 404 });
        }

        const result = await deleteEmailsCompletely([id]);
        auditLog('email.deleted', {
            userId: user.id,
            ip: getClientIp(req),
            storageDeleted: result.storageDeleted,
            storageFailed: result.storageFailed.length,
        });

        return NextResponse.json({ success: true, storage: { deleted: result.storageDeleted, failed: result.storageFailed.length } });

    } catch (error) {
        console.error('Failed to delete email:', error);
        return NextResponse.json({ error: 'Failed to delete email' }, { status: 500 });
    }
}
