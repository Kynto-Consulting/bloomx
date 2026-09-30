import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Token firmado para cancelar una cita desde el enlace del correo:  <bookingId>.<expSeg>.<firma>
 *  - La firma HMAC-SHA256 cubre id y expiracion: no se puede alterar ni adivinar.
 *  - Expira cuando empieza la cita (despues ya no tiene sentido cancelar).
 *  - Ademas se guarda en AppointmentBooking.cancelToken: la ruta comprueba que coincida (un token viejo no sirve).
 */

const DEV_FALLBACK_SECRET = 'dev-only-appointment-cancel-secret';

export function getCancelSecret(): string {
    const secret = process.env.APPOINTMENT_CANCEL_SECRET || process.env.NEXTAUTH_SECRET;
    if (!secret) {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('APPOINTMENT_CANCEL_SECRET or NEXTAUTH_SECRET is required in production');
        }
        return DEV_FALLBACK_SECRET;
    }
    return secret;
}

function sign(payload: string, secret: string): string {
    // Separacion de dominio: la firma no sirve para otros usos del mismo secreto (p. ej. el JWT de sesion).
    return createHmac('sha256', secret).update(`appointment-cancel:v1:${payload}`).digest('base64url');
}

export function signCancelToken(bookingId: string, expiresAtMs: number, secret: string = getCancelSecret()): string {
    const payload = `${bookingId}.${Math.floor(expiresAtMs / 1000)}`;
    return `${payload}.${sign(payload, secret)}`;
}

export type CancelTokenResult =
    | { ok: true; bookingId: string; expiresAtMs: number }
    | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export function verifyCancelToken(token: unknown, secret: string = getCancelSecret(), nowMs: number = Date.now()): CancelTokenResult {
    if (typeof token !== 'string' || token.length > 300) return { ok: false, reason: 'malformed' };
    const parts = token.split('.');
    if (parts.length !== 3) return { ok: false, reason: 'malformed' };
    const [bookingId, expRaw, signature] = parts;
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(bookingId) || !/^\d{1,12}$/.test(expRaw) || !signature) {
        return { ok: false, reason: 'malformed' };
    }

    const expected = Buffer.from(sign(`${bookingId}.${expRaw}`, secret));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        return { ok: false, reason: 'bad_signature' };
    }

    const expiresAtMs = Number(expRaw) * 1000;
    if (expiresAtMs < nowMs) return { ok: false, reason: 'expired' };
    return { ok: true, bookingId, expiresAtMs };
}
