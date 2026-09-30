// "Enviar ahora" de un correo PROGRAMADO: envio inmediato de verdad.
//
// Resend no permite adelantar un programado sin margen (rechaza fechas pasadas), asi que el orden es:
//   1. reservar la operacion (EmailEvent `send_idem:...`, indice unico parcial): 5 llamadas simultaneas -> UNA envia;
//   2. reconstruir el mensaje (cuerpo y adjuntos desde el almacenamiento) ANTES de tocar al proveedor: si falta algo no se cancela nada;
//   3. cancelar el programado en Resend (REST). "Ya enviado" -> 409 ALREADY_SENT y se sincroniza la fila;
//   4. la fila pasa a status `sending` (el proveedor ya no lo tiene: un reintento salta el paso 3);
//   5. enviar YA por REST con Idempotency-Key derivada del id del programado (un reintento nunca duplica);
//   6. exito -> fila a Enviados con el id nuevo. Fallo DEFINITIVO (el proveedor rechazo el mensaje) -> se REPROGRAMA a +2 min (mismo
//      contenido) y se avisa; fallo AMBIGUO (red/5xx: quiza salio) -> se conserva `sending` y NO se reprograma (podria duplicar):
//      reintentar es seguro porque la clave de idempotencia es la misma.
// Nunca hay dos envios (clave de reserva + Idempotency-Key + reprogramar solo tras rechazo definitivo) ni cero silencioso (la fila
// sigue en Programados como `scheduled` o `sending`, con su contenido).
import { prisma } from '@/lib/prisma';
import { cancelScheduledSend, rescheduleSend, sendEmailRest, type RestSendPayload } from '@/lib/resend-scheduled';
import { claimSendKey, markSendKeySent, releaseSendKey } from '@/lib/send-idempotency';
import { parseRecipientList } from '@/lib/mail-validation';
import { SEND_NOW_RESTORE_MS, SEND_NOW_FALLBACK_MS } from '@/lib/mail-scheduled';

export type SendNowResult =
    | { kind: 'sent'; resendId: string }
    /** Otra llamada ya lo envio (o lo esta enviando): idempotente. */
    | { kind: 'duplicate'; resendId: string | null }
    | { kind: 'in_progress' }
    | { kind: 'not_scheduled' }
    | { kind: 'already_sent' }
    /** No se pudo cancelar (proveedor caido / rechazo): no se cambio nada. */
    | { kind: 'provider_unavailable'; status: number }
    /** Faltan datos para reconstruir el mensaje (p. ej. un adjunto ya no esta en el almacenamiento): se adelanto el programado a +30 s. */
    | { kind: 'deferred'; deliverAt: Date; reason: string }
    /** El proveedor rechazo el envio inmediato: se reprogramo el mismo contenido. */
    | { kind: 'send_failed_rescheduled'; scheduledAt: Date; message: string }
    /** Fallo ambiguo o sin reprogramar: la fila queda en `sending` y se puede reintentar sin duplicar. */
    | { kind: 'send_failed_pending'; message: string };

interface Row {
    id: string;
    userId: string;
    from: string;
    to: string;
    cc: string | null;
    bcc: string | null;
    replyTo: string | null;
    subject: string | null;
    messageId: string;
    htmlKey: string | null;
    textKey: string | null;
    status: string;
    folder: string;
    attachments: Array<{ filename: string; key: string; mimeType: string }>;
}

const short = (v: string) => v.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60);

/** Reconstruye el mensaje desde lo guardado. null = falta algo (motivo en `reason`). */
export async function rebuildPayload(row: Row): Promise<{ ok: true; payload: RestSendPayload } | { ok: false; reason: string }> {
    const storage = await import('@/lib/storage');
    let html: string | undefined;
    let text: string | undefined;
    try {
        if (row.htmlKey) html = (await storage.getFromStorage(row.htmlKey)) || undefined;
        if (row.textKey) text = (await storage.getFromStorage(row.textKey)) || undefined;
    } catch {
        return { ok: false, reason: 'body_unavailable' };
    }
    if (!html && !text) return { ok: false, reason: 'body_missing' };

    const attachments: Array<{ filename: string; content: string }> = [];
    for (const a of row.attachments) {
        let buffer: Buffer | null = null;
        try { buffer = await storage.getBufferFromStorage(a.key); } catch { buffer = null; }
        if (!buffer) return { ok: false, reason: 'attachment_missing' };
        attachments.push({ filename: a.filename, content: buffer.toString('base64') });
    }
    const to = parseRecipientList(row.to).valid;
    if (to.length === 0) return { ok: false, reason: 'no_recipients' };
    const cc = parseRecipientList(row.cc).valid;
    const bcc = parseRecipientList(row.bcc).valid;
    const payload: RestSendPayload = {
        from: row.from,
        to,
        ...(cc.length ? { cc } : {}),
        ...(bcc.length ? { bcc } : {}),
        subject: row.subject || '',
        ...(html ? { html } : {}),
        ...(text ? { text } : {}),
        ...(row.replyTo ? { reply_to: [row.replyTo] } : {}),
        ...(attachments.length ? { attachments } : {}),
    };
    return { ok: true, payload };
}

export interface SendNowDeps {
    now: () => number;
}

/** Ejecuta "enviar ahora" sobre un correo programado ya autorizado por el llamador (propiedad comprobada). */
export async function sendScheduledNow(emailId: string, deps: SendNowDeps = { now: Date.now }): Promise<SendNowResult> {
    const first = await prisma.email.findUnique({
        where: { id: emailId },
        select: { id: true, userId: true, messageId: true, folder: true },
    });
    if (!first || first.folder !== 'scheduled') return { kind: 'not_scheduled' };

    // 1. Reserva: una sola llamada por (correo, id del programado) ejecuta; el resto recibe el resultado o "en curso".
    const claim = await claimSendKey(`send_idem:${first.userId}:sendnow-${short(first.id)}-${short(first.messageId)}`);
    if (claim.kind === 'duplicate') {
        return claim.inProgress ? { kind: 'in_progress' } : { kind: 'duplicate', resendId: claim.resendEmailId };
    }
    const claimId = claim.id;
    const release = () => releaseSendKey(claimId).catch(() => undefined);

    try {
        const row = (await prisma.email.findFirst({
            where: { id: emailId, folder: 'scheduled' },
            include: { attachments: { select: { filename: true, key: true, mimeType: true } } },
        })) as Row | null;
        if (!row) { await release(); return { kind: 'not_scheduled' }; }

        // 2. Reconstruir ANTES de cancelar.
        const rebuilt = await rebuildPayload(row);
        if (!rebuilt.ok) {
            // Sin datos para enviar YA: como ultimo recurso se adelanta el programado (no se cancela, no puede haber duplicado).
            const at = new Date(deps.now() + SEND_NOW_FALLBACK_MS);
            if (row.status !== 'sending' && row.messageId) {
                const out = await rescheduleSend(row.messageId, at);
                if (!out.ok && out.kind !== 'not_found') {
                    await release();
                    if (out.kind === 'already_sent') {
                        await prisma.email.updateMany({ where: { id: row.id, folder: 'scheduled' }, data: { folder: 'sent', status: 'sent', scheduledAt: null } });
                        return { kind: 'already_sent' };
                    }
                    return { kind: 'provider_unavailable', status: out.status };
                }
            }
            const moved = await prisma.email.updateMany({ where: { id: row.id, folder: 'scheduled' }, data: { folder: 'sent', status: 'sent', scheduledAt: null } });
            if (moved.count > 0) await markSendKeySent(claimId, row.messageId).catch(() => undefined);
            else await release();
            return { kind: 'deferred', deliverAt: at, reason: rebuilt.reason };
        }

        // 3. Cancelar el programado (salvo que un intento anterior ya lo cancelo: status `sending`).
        if (row.status !== 'sending' && row.messageId) {
            const out = await cancelScheduledSend(row.messageId);
            if (!out.ok && out.kind !== 'not_found') {
                await release();
                if (out.kind === 'already_sent') {
                    await prisma.email.updateMany({ where: { id: row.id, folder: 'scheduled' }, data: { folder: 'sent', status: 'sent', scheduledAt: null } });
                    return { kind: 'already_sent' };
                }
                return { kind: 'provider_unavailable', status: out.status };
            }
        }

        // 4. El proveedor ya no lo tiene: dejarlo anotado por si el proceso muere aqui.
        await prisma.email.updateMany({ where: { id: row.id, folder: 'scheduled' }, data: { status: 'sending' } });

        // 5. Enviar YA. Clave derivada del id del programado: un reintento (mismo programado) devuelve el mismo envio.
        const key = `sendnow-${short(row.id)}-${short(row.messageId)}`;
        let sent = await sendEmailRest(rebuilt.payload, key);
        if (!sent.ok && !sent.definitive) sent = await sendEmailRest(rebuilt.payload, key); // ambiguo: una repeticion con la misma clave es segura

        if (sent.ok) {
            // 6a. Exito.
            await markSendKeySent(claimId, sent.id).catch(() => undefined);
            // El correo YA salio: pase lo que pase con la BD no se debe devolver un error que invite a reenviar.
            const where = { id: row.id, folder: 'scheduled' };
            await prisma.email.updateMany({ where, data: { folder: 'sent', status: 'sent', scheduledAt: null, messageId: sent.id } })
                .catch(() => prisma.email.updateMany({ where, data: { folder: 'sent', status: 'sent', scheduledAt: null } }));
            return { kind: 'sent', resendId: sent.id };
        }

        if (!sent.definitive) {
            // 6c. Ambiguo: puede haber salido. No reprogramar (duplicaria); reintentar es seguro.
            await release();
            return { kind: 'send_failed_pending', message: sent.message };
        }

        // 6b. Rechazo definitivo: reprogramar el mismo contenido a +2 min (id nuevo, clave nueva) y avisar.
        const at = new Date(deps.now() + SEND_NOW_RESTORE_MS);
        const restored = await sendEmailRest(
            { ...rebuilt.payload, scheduled_at: at.toISOString() },
            `sendnow-restore-${short(row.id)}-${short(row.messageId)}`,
        );
        await release();
        if (restored.ok) {
            await prisma.email.updateMany({
                where: { id: row.id, folder: 'scheduled' },
                data: { status: 'scheduled', scheduledAt: at, messageId: restored.id },
            });
            return { kind: 'send_failed_rescheduled', scheduledAt: at, message: sent.message };
        }
        return { kind: 'send_failed_pending', message: sent.message };
    } catch (error) {
        await release();
        throw error;
    }
}
