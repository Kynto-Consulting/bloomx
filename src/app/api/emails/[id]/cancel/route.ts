import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from "@/lib/session";
import { canAccessEmail } from '@/lib/mailbox-access';
import { cancelScheduledSend, failureToHttp } from '@/lib/resend-scheduled';

/** Cuerpo HTML del correo programado: lo guardado al programar (htmlKey/textKey); si no, lo que tenga el proveedor; si no, el resumen. */
async function recoverBody(email: { htmlKey: string | null; textKey: string | null; messageId: string | null; snippet: string | null }): Promise<string> {
    try {
        // El almacenamiento (SDK de S3) solo se carga si hay algo que leer.
        const { getFromStorage } = (email.htmlKey || email.textKey) ? await import('@/lib/storage') : { getFromStorage: async () => null };
        if (email.htmlKey) {
            const html = await getFromStorage(email.htmlKey);
            if (html) return html;
        }
        if (email.textKey) {
            const text = await getFromStorage(email.textKey);
            if (text) return `<p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, '<br>')}</p>`;
        }
    } catch (e) {
        console.error('Failed to read scheduled body from storage', e);
    }
    if (email.messageId) {
        try {
            const { resend } = await import('@/lib/resend');
            const resendEmail = await resend.emails.get(email.messageId);
            const data = (resendEmail as any)?.data;
            if (data) return data.html || data.text || '';
        } catch (e) {
            console.error('Failed to fetch from Resend', e);
        }
    }
    return '';
}

/**
 * POST /api/emails/[id]/cancel: cancela un envio programado y lo devuelve a BORRADORES (con destinatarios, cc/bcc,
 * asunto, cuerpo y adjuntos). Si el proveedor dice que ya salio, NO toca nada localmente salvo reflejar que ya se envio.
 */
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getCurrentUser();

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { id } = await params;

        // 1. Find the email
        const email = await prisma.email.findUnique({
            where: { id },
            include: { attachments: true }
        });

        if (!email) {
            return NextResponse.json({ error: 'Email not found' }, { status: 404 });
        }

        // Propiedad (IDOR): el correo debe estar en un buzon accesible para el usuario de la sesion. 404 (no 403) para
        // no revelar la existencia de correos ajenos. Se comprueba ANTES de tocar Resend, borradores o la BD.
        if (!(await canAccessEmail(user.id, email.userId))) {
            return NextResponse.json({ error: 'Email not found' }, { status: 404 });
        }

        if (email.status !== 'scheduled' && email.folder !== 'scheduled') {
            return NextResponse.json({ error: 'Email is not scheduled', code: 'NOT_SCHEDULED' }, { status: 409 });
        }

        // 2. Cancelar en Resend. Sin id remoto (404) no hay nada que cancelar alli; "ya enviado" o proveedor caido detienen el
        //    proceso: seguir dejaria un borrador Y el correo saliendo igualmente.
        if (email.messageId) {
            const outcome = await cancelScheduledSend(email.messageId);
            if (!outcome.ok && outcome.kind !== 'not_found') {
                if (outcome.kind === 'already_sent') {
                    await prisma.email.updateMany({ where: { id, userId: email.userId, folder: 'scheduled' }, data: { folder: 'sent', status: 'sent' } });
                }
                const http = failureToHttp(outcome);
                return NextResponse.json({ error: http.error, code: http.code }, { status: http.status });
            }
        }

        // 3. Volver a borrador con todo lo que tenia el correo.
        const bodyContent = await recoverBody(email);
        const draft = await prisma.draft.create({
            data: {
                from: email.from,
                to: email.to,
                cc: email.cc ?? null,
                bcc: email.bcc ?? null,
                subject: email.subject,
                body: bodyContent || email.snippet || '',
                attachments: {
                    create: email.attachments.map(a => ({
                        filename: a.filename,
                        mimeType: a.mimeType,
                        size: a.size,
                        key: a.key
                    }))
                }
            },
            include: { attachments: true },
        });

        // 4. Delete the Scheduled Email
        await prisma.email.deleteMany({ where: { id, userId: email.userId } });

        // `draft`: lo necesario para abrirlo en el redactor sin otra peticion (editar un programado).
        return NextResponse.json({
            success: true,
            draftId: draft.id,
            draft: { id: draft.id, from: email.from, to: email.to, cc: email.cc ?? '', bcc: email.bcc ?? '', subject: email.subject ?? '', body: bodyContent || email.snippet || '', attachments: draft.attachments ?? [] },
        });

    } catch (error: any) {
        console.error('Cancel error:', error);
        return NextResponse.json({ error: 'Failed to cancel the scheduled email' }, { status: 500 });
    }
}
