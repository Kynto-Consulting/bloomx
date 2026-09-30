import { createHmac } from 'crypto';
import { prisma } from '@/lib/prisma';
import { safeEqual } from '@/lib/security';

/**
 * Baja de listas (RFC 2369 List-Unsubscribe + RFC 8058 One-Click).
 * Sin migracion: las bajas se guardan como EmailEvent { type: 'unsubscribe', data: { sender, recipient } }.
 * El token es HMAC-SHA256, sin estado y sin caducidad (el destinatario debe poder darse de baja siempre).
 *
 * Controles: NIST SP 800-177r1 sec. 6, CIS v8 9.x, requisitos de remitentes masivos (Google/Yahoo 2024).
 */

const SUPPRESSION_EVENT = 'unsubscribe';

function getSecret(): string | null {
    return process.env.UNSUBSCRIBE_SECRET || process.env.NEXTAUTH_SECRET || null;
}

function b64url(input: string): string {
    return Buffer.from(input, 'utf8').toString('base64url');
}

function sign(payload: string, secret: string): string {
    return createHmac('sha256', secret).update(`unsub:${payload}`).digest('base64url');
}

export function createUnsubscribeToken(senderUserId: string, recipientEmail: string): string | null {
    const secret = getSecret();
    if (!secret) return null;
    const payload = b64url(JSON.stringify({ s: senderUserId, r: recipientEmail.trim().toLowerCase() }));
    return `${payload}.${sign(payload, secret)}`;
}

export function verifyUnsubscribeToken(token: string): { sender: string; recipient: string } | null {
    const secret = getSecret();
    if (!secret || typeof token !== 'string' || token.length > 1024) return null;
    const [payload, sig] = token.split('.');
    if (!payload || !sig || !safeEqual(sig, sign(payload, secret))) return null;
    try {
        const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (typeof parsed?.s !== 'string' || typeof parsed?.r !== 'string') return null;
        return { sender: parsed.s, recipient: parsed.r };
    } catch {
        return null;
    }
}

export function buildUnsubscribeUrl(token: string): string {
    const base = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
    // /api/webhooks/* es publico en middleware (los clientes de correo llaman sin sesion).
    return `${base}/api/webhooks/unsubscribe?t=${encodeURIComponent(token)}`;
}

/** Cabeceras RFC 2369 / RFC 8058 para un envio masivo. null si no hay secreto o URL publica https. */
export function buildUnsubscribeHeaders(senderUserId: string, recipientEmail: string, senderMailbox: string): Record<string, string> | null {
    const token = createUnsubscribeToken(senderUserId, recipientEmail);
    const url = token ? buildUnsubscribeUrl(token) : null;
    // RFC 8058 exige HTTPS.
    if (!url || !url.startsWith('https://')) return null;
    return {
        'List-Unsubscribe': `<${url}>, <mailto:${senderMailbox}?subject=unsubscribe>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
}

export async function recordUnsubscribe(sender: string, recipient: string): Promise<void> {
    const existing = await prisma.emailEvent.findFirst({
        where: {
            type: SUPPRESSION_EVENT,
            AND: [{ data: { path: ['sender'], equals: sender } }, { data: { path: ['recipient'], equals: recipient } }],
        },
        select: { id: true },
    });
    if (existing) return;
    await prisma.emailEvent.create({
        data: { type: SUPPRESSION_EVENT, data: { sender, recipient } },
    });
}

/** Conjunto (en minusculas) de destinatarios dados de baja para este remitente. */
export async function getSuppressedRecipients(sender: string): Promise<Set<string>> {
    const rows = await prisma.emailEvent.findMany({
        where: { type: SUPPRESSION_EVENT, data: { path: ['sender'], equals: sender } },
        select: { data: true },
        take: 50000,
    });
    const out = new Set<string>();
    for (const row of rows) {
        const r = (row.data as any)?.recipient;
        if (typeof r === 'string') out.add(r.toLowerCase());
    }
    return out;
}
