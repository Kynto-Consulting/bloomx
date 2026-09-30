import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { recordUnsubscribe } from '@/lib/unsubscribe';
import { findRowByResendId, markRowDelivery } from '@/lib/elixir-campaign-store';
import { applyDeliveryEvent, parseDeliveryEvent, verifyResendSignature, type EventDeps } from '@/lib/elixir-events';

/**
 * Webhook de EVENTOS DE ENTREGA de Resend (email.bounced, email.complained, email.delivery_delayed).
 * Es independiente del webhook de correo entrante (/api/webhooks/resend, que usa WEBHOOK_SECRET): configure en
 * Resend un segundo webhook apuntando aqui, con su propio secreto en RESEND_WEBHOOK_SECRET (whsec_...).
 *
 *  - Firma Svix OPCIONAL: con RESEND_WEBHOOK_SECRET se verifica; sin el se acepta (lo decide cada organizador).
 *  - Rebote PERMANENTE o queja -> recordUnsubscribe(sender, recipient, 'bounce'|'complaint') y fila de campana
 *    marcada bounced/complained. Rebote temporal / retraso -> solo se anota en la fila.
 *  - Idempotente (reentregas del mismo evento no cambian nada). Fallo de I/O -> 500 para que Resend reintente.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const deps: EventDeps = {
    findRowByResendId,
    async findSenderByResendId(emailId) {
        // Envio directo de Elixir (modo por lotes de la pestana): EmailEvent 'elixir_send' guarda el remitente.
        const ev = await prisma.emailEvent.findFirst({ where: { type: 'elixir_send', resendEmailId: emailId }, select: { data: true } });
        const s = (ev?.data as { sender?: unknown } | null)?.sender;
        if (typeof s === 'string' && s) return s;
        // Correo normal enviado desde la app: Email.messageId = id de Resend.
        const mail = await prisma.email.findUnique({ where: { messageId: emailId }, select: { userId: true } });
        return mail?.userId ?? null;
    },
    markRow: markRowDelivery,
    recordSuppression: recordUnsubscribe,
};

export async function POST(req: NextRequest) {
    const raw = await req.text();
    if (raw.length > 512_000) return NextResponse.json({ error: 'Payload too large' }, { status: 413 });

    // Firma OPCIONAL (decide cada organizador): con RESEND_WEBHOOK_SECRET se exige firma Svix valida; sin el se acepta.
    let payload: unknown;
    if (process.env.RESEND_WEBHOOK_SECRET) {
        const v = verifyResendSignature(raw, {
            id: req.headers.get('svix-id'),
            timestamp: req.headers.get('svix-timestamp'),
            signature: req.headers.get('svix-signature'),
        }, process.env.RESEND_WEBHOOK_SECRET);
        if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
        payload = v.payload;
    } else {
        console.warn('[resend-events] RESEND_WEBHOOK_SECRET not set: accepting UNSIGNED delivery events (optional)');
        try { payload = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    }

    const ev = parseDeliveryEvent(payload);
    if (!ev) return NextResponse.json({ received: true, ignored: true });

    try {
        const out = await applyDeliveryEvent(ev, deps);
        return NextResponse.json({ received: true, ...out });
    } catch (e) {
        console.error('[resend-events] failed:', (e as Error)?.message);
        return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
}
