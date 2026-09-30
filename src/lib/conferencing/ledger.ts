/**
 * Registro persistente de reuniones (tabla ConferenceMeeting):
 *
 *  1. IDEMPOTENCIA: la clave `Idempotency-Key` se RESERVA antes de llamar al proveedor (unica por usuario+proveedor+clave).
 *     Dos peticiones simultaneas o un reintento devuelven la MISMA reunion en vez de crear otra (Zoom no ofrece
 *     idempotencia propia; en Google tambien se envia un requestId derivado de la clave). Funciona con varias instancias.
 *  2. PROPIEDAD: en modo instancia el token del proveedor es de toda la cuenta (S2S / organizador); el registro permite
 *     comprobar que quien pide borrar/actualizar una reunion es quien la creo (evita IDOR sobre meetingId ajenos).
 *
 * Patron analogo a lib/send-idempotency.ts (claim -> complete | release, con reservas abandonadas reutilizables).
 */
import { prisma } from '@/lib/prisma';
import type { ConferencingMeeting, ConferencingProviderId } from './types';

export const PENDING_STALE_MS = 90_000;
export const WAIT_FOR_PENDING_MS = 8_000;
const POLL_MS = 400;

const isUnique = (e: unknown) => Boolean(e && typeof e === 'object' && (e as { code?: unknown }).code === 'P2002');

export type MeetingClaim =
    | { kind: 'claimed'; id: string }
    | { kind: 'replay'; meeting: ConferencingMeeting }
    | { kind: 'in_progress' };

function toMeeting(row: { payload: unknown }): ConferencingMeeting | null {
    const p = row.payload as ConferencingMeeting | null;
    return p && typeof p === 'object' && typeof p.joinUrl === 'string' ? p : null;
}

/** Reserva la clave. Sin `idempotencyKey` no hay reserva (cada llamada crea una reunion). */
export async function claimMeeting(args: { userId: string; provider: ConferencingProviderId; idempotencyKey?: string | null }): Promise<MeetingClaim> {
    const { userId, provider } = args;
    const key = args.idempotencyKey || null;
    if (!key) return { kind: 'claimed', id: '' };

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const row = await prisma.conferenceMeeting.create({
                data: { userId, provider, meetingId: '', joinUrl: '', idempotencyKey: key, status: 'pending' },
                select: { id: true },
            });
            return { kind: 'claimed', id: row.id };
        } catch (e) {
            if (!isUnique(e)) throw e;
            const prior = await prisma.conferenceMeeting.findFirst({
                where: { userId, provider, idempotencyKey: key },
                select: { id: true, status: true, payload: true, updatedAt: true },
            });
            if (!prior) continue; // se libero entre medias
            const meeting = prior.status === 'ready' ? toMeeting(prior) : null;
            if (meeting) return { kind: 'replay', meeting };
            if (prior.status === 'pending' && Date.now() - prior.updatedAt.getTime() > PENDING_STALE_MS) {
                await prisma.conferenceMeeting.deleteMany({ where: { id: prior.id, status: 'pending' } });
                continue;
            }
            if (prior.status === 'deleted') {
                // Clave reutilizada tras borrar la reunion: se trata como peticion nueva.
                await prisma.conferenceMeeting.deleteMany({ where: { id: prior.id, status: 'deleted' } });
                continue;
            }
            return { kind: 'in_progress' };
        }
    }
    return { kind: 'in_progress' };
}

/** Espera a que una reserva en curso termine (otra peticion con la misma clave) y devuelve su reunion. */
export async function waitForMeeting(args: { userId: string; provider: ConferencingProviderId; idempotencyKey: string }, timeoutMs = WAIT_FOR_PENDING_MS): Promise<ConferencingMeeting | null> {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const row = await prisma.conferenceMeeting.findFirst({
            where: { userId: args.userId, provider: args.provider, idempotencyKey: args.idempotencyKey },
            select: { status: true, payload: true },
        });
        if (!row) return null; // la primera peticion fallo y libero la reserva
        if (row.status === 'ready') return toMeeting(row);
    }
    return null;
}

/** La reunion se creo: queda registrada (con la clave, si la hubo) para repetir respuesta y comprobar propiedad. */
export async function completeMeeting(claimId: string, args: { userId: string; provider: ConferencingProviderId; idempotencyKey?: string | null }, meeting: ConferencingMeeting): Promise<void> {
    const data = {
        meetingId: meeting.meetingId,
        joinUrl: meeting.joinUrl,
        hostUrl: meeting.hostUrl ?? null,
        status: 'ready',
        // Sin adjuntos (pesados) ni nada sensible: solo lo que la API ya devuelve al navegador.
        payload: JSON.parse(JSON.stringify({ ...meeting, attachment: undefined })),
    };
    if (claimId) {
        await prisma.conferenceMeeting.update({ where: { id: claimId }, data });
        return;
    }
    await prisma.conferenceMeeting.create({ data: { userId: args.userId, provider: args.provider, idempotencyKey: null, ...data } });
}

/** El proveedor fallo: libera la reserva para que el reintento cree la reunion. */
export async function releaseClaim(claimId: string): Promise<void> {
    if (!claimId) return;
    await prisma.conferenceMeeting.deleteMany({ where: { id: claimId, status: 'pending' } }).catch(() => undefined);
}

/**
 * ¿Es de este usuario la reunion? SOLO el registro de la fachada decide (nunca un evento que la "referencie": el
 * `conferenceMeetingId` de un evento lo envia el cliente y no prueba propiedad).
 */
export async function userOwnsMeeting(userId: string, provider: ConferencingProviderId, meetingId: string): Promise<boolean> {
    if (!meetingId) return false;
    const row = await prisma.conferenceMeeting.findFirst({
        where: { userId, provider, meetingId, status: { not: 'deleted' } },
        select: { id: true },
    });
    return Boolean(row);
}

export async function markMeetingDeleted(userId: string, provider: ConferencingProviderId, meetingId: string): Promise<void> {
    await prisma.conferenceMeeting.updateMany({ where: { userId, provider, meetingId }, data: { status: 'deleted' } }).catch(() => undefined);
}

/** ¿El evento de Google (externalId) es de un calendario sincronizado de ESTE usuario? (attachToEventId) */
export async function userOwnsGoogleEvent(userId: string, externalId: string): Promise<boolean> {
    if (!externalId) return false;
    const ev = await prisma.calendarEvent.findFirst({ where: { userId, externalId }, select: { id: true } });
    return Boolean(ev);
}
