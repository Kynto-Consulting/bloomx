import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/session';
import { canAccessEmail } from '@/lib/mailbox-access';
import { cancelScheduledSend, failureToHttp, rescheduleSend } from '@/lib/resend-scheduled';
import { SCHEDULE_ACTIONS, validateScheduleDate, type ScheduleAction } from '@/lib/mail-scheduled';
import { sendScheduledNow } from '@/lib/send-now';
import { moveEmailsTracked } from '@/lib/mail-store';
import { parseRecipientList } from '@/lib/mail-validation';
import { buildEmailSentContext, fireLifecycleHook } from '@/lib/expansions/server-hooks';

export const runtime = 'nodejs';

const err = (status: number, code: string, error: string) => NextResponse.json({ error, code }, { status });

/**
 * POST /api/emails/[id]/schedule  { action: 'reschedule' | 'sendNow' | 'delete', scheduledAt? }
 *
 *  - reschedule: nueva hora (ISO, entre ahora+1 min y +30 dias). Actualiza Resend (PATCH scheduled_at) y luego nuestra BD.
 *  - sendNow:    envio INMEDIATO (lib/send-now.ts): cancela el programado en Resend, reconstruye el mensaje desde el almacenamiento y
 *                lo envia ya con Idempotency-Key derivada del id del programado. Ya enviado -> 409 ALREADY_SENT; si el envio es
 *                rechazado se reprograma a +2 min y se avisa (502 SEND_FAILED_RESCHEDULED); nunca dos envios ni cero.
 *  - delete:     cancela en Resend y manda el correo a la papelera.
 * Propiedad estricta (canAccessEmail; ajeno = 404). Si Resend dice que ya salio: 409 ALREADY_SENT y se sincroniza la fila.
 * Editar = POST /api/emails/[id]/cancel (vuelve a borrador).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const { id } = await params;
        const body = await req.json().catch(() => null);
        const action = body?.action as ScheduleAction;
        if (!(SCHEDULE_ACTIONS as readonly string[]).includes(action)) return err(400, 'INVALID_ACTION', 'Invalid action');

        const email = await prisma.email.findUnique({ where: { id }, include: { attachments: { select: { id: true } } } });
        if (!email || !(await canAccessEmail(user.id, email.userId))) return err(404, 'NOT_FOUND', 'Email not found');
        if (email.folder !== 'scheduled' && email.status !== 'scheduled') return err(409, 'NOT_SCHEDULED', 'Email is not scheduled');

        let newDate: Date | null = null;
        if (action === 'reschedule') {
            const check = validateScheduleDate(body?.scheduledAt);
            if (!check.ok) return err(400, check.reason === 'invalid' ? 'INVALID_DATE' : check.reason === 'too_soon' ? 'DATE_TOO_SOON' : 'DATE_TOO_FAR', 'Invalid date');
            newDate = check.date;
        }

        if (action === 'sendNow') {
            const r = await sendScheduledNow(id);
            switch (r.kind) {
                case 'sent':
                case 'duplicate':
                case 'deferred': {
                    const to = parseRecipientList(email.to).valid;
                    const cc = parseRecipientList(email.cc).valid;
                    const bcc = parseRecipientList(email.bcc).valid;
                    if (r.kind === 'sent' || r.kind === 'deferred') {
                        fireLifecycleHook('EMAIL_SENT', email.userId, buildEmailSentContext({
                            emailId: email.id, to, cc, bcc, hasAttachments: email.attachments.length > 0, sentAt: new Date(),
                        }));
                    }
                    return NextResponse.json({
                        success: true, folder: 'sent',
                        ...(r.kind === 'duplicate' ? { duplicate: true } : {}),
                        ...(r.kind === 'deferred' ? { deferred: true, deliverAt: r.deliverAt.toISOString() } : r.kind === 'sent' ? { immediate: true } : {}),
                    });
                }
                case 'in_progress': return NextResponse.json({ error: 'The email is being sent right now.', code: 'SEND_IN_PROGRESS' }, { status: 409, headers: { 'Retry-After': '2' } });
                case 'not_scheduled': return err(409, 'NOT_SCHEDULED', 'Email is not scheduled');
                case 'already_sent': return err(409, 'ALREADY_SENT', 'The email was already sent and can no longer be changed.');
                case 'provider_unavailable': return err(502, 'PROVIDER_UNAVAILABLE', 'The mail provider is unavailable. Try again in a moment.');
                case 'send_failed_rescheduled':
                    return NextResponse.json({ error: 'The provider rejected the immediate send; it was rescheduled in 2 minutes.', code: 'SEND_FAILED_RESCHEDULED', scheduledAt: r.scheduledAt.toISOString() }, { status: 502 });
                default:
                    return err(502, 'SEND_PENDING', 'The send could not be confirmed. Try "Send now" again: it will not be duplicated.');
            }
        }

        // 'sending': el proveedor ya no tiene el programado (un "enviar ahora" quedo a medias). Solo se puede reintentar o eliminar.
        if (email.status === 'sending' && action === 'reschedule') return err(409, 'SEND_PENDING', 'A send is pending. Try "Send now" again or delete it.');

        // 1) Resend primero: si falla no se toca nuestra BD (nunca queda un estado local que contradiga al proveedor).
        if (email.messageId && email.status !== 'sending') {
            const outcome = action === 'delete'
                ? await cancelScheduledSend(email.messageId)
                : await rescheduleSend(email.messageId, newDate!);
            if (!outcome.ok && outcome.kind !== 'not_found') {
                if (outcome.kind === 'already_sent') {
                    await prisma.email.updateMany({ where: { id, userId: email.userId, folder: 'scheduled' }, data: { folder: 'sent', status: 'sent' } });
                }
                const http = failureToHttp(outcome);
                return err(http.status, http.code, http.error);
            }
        }

        // 2) Nuestra BD (condicionada a que siga programado: una segunda peticion simultanea no repite el efecto).
        if (action === 'reschedule' && newDate) {
            const r = await prisma.email.updateMany({ where: { id, userId: email.userId, folder: 'scheduled' }, data: { scheduledAt: newDate } });
            if (r.count === 0) return err(409, 'NOT_SCHEDULED', 'Email is not scheduled');
            return NextResponse.json({ success: true, scheduledAt: newDate.toISOString(), previousScheduledAt: email.scheduledAt ? email.scheduledAt.toISOString() : null });
        }

        // delete: a la papelera (previousFolder = scheduled, asi "Restaurar" lo devuelve a la bandeja)
        const moved = await moveEmailsTracked({ ids: [id], userIds: [email.userId], folder: 'trash' });
        if (moved === 0) return err(409, 'NOT_SCHEDULED', 'Email is not scheduled');
        await prisma.email.updateMany({ where: { id, userId: email.userId }, data: { status: 'cancelled', scheduledAt: null } });
        return NextResponse.json({ success: true, folder: 'trash' });
    } catch (error) {
        console.error('Schedule action error:', error instanceof Error ? error.message.slice(0, 200) : 'error');
        return err(500, 'INTERNAL', 'Failed to update the scheduled email');
    }
}
