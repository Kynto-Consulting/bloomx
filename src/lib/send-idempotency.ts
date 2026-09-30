import { prisma } from './prisma';

/**
 * Idempotencia atomica de `POST /api/emails` (cabecera `Idempotency-Key`).
 *
 * Antes: "buscar EmailEvent -> enviar -> crear EmailEvent". Dos peticiones simultaneas con la misma clave pasaban la
 * busqueda a la vez y enviaban el correo dos veces (reproducido con Postgres real, ver send-idempotency.pg.test.ts).
 * Ahora la clave se RESERVA antes de enviar: se inserta un EmailEvent `send_idem:<usuario>:<clave>` y el indice unico
 * parcial "EmailEvent_send_idem_key" (src/lib/db/schema.ts) hace que solo una peticion gane (P2002 para el resto).
 *
 * Ciclo: claim -> (send) -> markSent(resendId) -> attachEmail(emailId). Si el envio falla se libera con release().
 * Una reserva sin resendId mas antigua que STALE_CLAIM_MS se considera abandonada (proceso caido) y se reutiliza.
 */

export const STALE_CLAIM_MS = 2 * 60_000;

export type SendClaim =
    | { kind: 'claimed'; id: string }
    | { kind: 'duplicate'; resendEmailId: string | null; inProgress: boolean };

const isUnique = (e: unknown) => Boolean(e && typeof e === 'object' && (e as { code?: unknown }).code === 'P2002');

export async function claimSendKey(type: string): Promise<SendClaim> {
    // Camino rapido (y compatible si el indice unico aun no esta aplicado): ya hay un envio registrado
    const known = await prisma.emailEvent.findFirst({ where: { type }, select: { id: true, resendEmailId: true, createdAt: true } });
    if (known?.resendEmailId) return { kind: 'duplicate', resendEmailId: known.resendEmailId, inProgress: false };

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const ev = await prisma.emailEvent.create({ data: { type }, select: { id: true } });
            return { kind: 'claimed', id: ev.id };
        } catch (e) {
            if (!isUnique(e)) throw e;
            const prior = await prisma.emailEvent.findFirst({ where: { type }, select: { id: true, resendEmailId: true, createdAt: true } });
            if (!prior) continue; // se libero entre medias: reintentar el claim
            if (prior.resendEmailId) return { kind: 'duplicate', resendEmailId: prior.resendEmailId, inProgress: false };
            if (Date.now() - prior.createdAt.getTime() > STALE_CLAIM_MS) {
                await prisma.emailEvent.deleteMany({ where: { id: prior.id, resendEmailId: null } });
                continue;
            }
            return { kind: 'duplicate', resendEmailId: null, inProgress: true };
        }
    }
    return { kind: 'duplicate', resendEmailId: null, inProgress: true };
}

/** El correo YA salio hacia Resend: a partir de aqui un reintento debe devolver este id y nunca reenviar. */
export async function markSendKeySent(id: string, resendEmailId: string | null): Promise<void> {
    await prisma.emailEvent.update({ where: { id }, data: { resendEmailId } });
}

export async function attachSendKeyEmail(id: string, emailId: string): Promise<void> {
    await prisma.emailEvent.update({ where: { id }, data: { emailId } });
}

/** Libera la reserva si el envio no se produjo (error de Resend / excepcion previa al envio). */
export async function releaseSendKey(id: string): Promise<void> {
    await prisma.emailEvent.deleteMany({ where: { id, resendEmailId: null } });
}
