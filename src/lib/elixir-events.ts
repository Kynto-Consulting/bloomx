/**
 * elixir-events.ts — eventos de entrega de Resend (rebotes, quejas, retrasos) -> lista de supresion y filas de
 * campana. Logica sin Next/Prisma (dependencias inyectadas) para probarla con vitest.
 *
 * Idempotencia: `recordUnsubscribe` ya es idempotente por (sender, recipient) y el marcado de fila es un UPDATE
 * absoluto; reentregas del mismo evento (mismo svix-id) no cambian el resultado. Cualquier fallo de I/O responde
 * 500 para que Resend reintente.
 */
import { Webhook } from 'svix';
import { extractAddress } from './mail-validation';

export type DeliveryKind = 'bounce' | 'complaint' | 'delayed';

export interface ParsedDeliveryEvent {
    kind: DeliveryKind;
    emailId: string;
    to: string[];
    /** Solo bounce: true si es permanente (los temporales no suprimen). */
    permanent: boolean;
    detail: string;
}

export function parseDeliveryEvent(payload: unknown): ParsedDeliveryEvent | null {
    const ev = payload as { type?: unknown; data?: Record<string, any> } | null;
    if (!ev || typeof ev.type !== 'string' || !ev.data || typeof ev.data !== 'object') return null;
    const kind: DeliveryKind | null =
        ev.type === 'email.bounced' ? 'bounce' : ev.type === 'email.complained' ? 'complaint' : ev.type === 'email.delivery_delayed' ? 'delayed' : null;
    if (!kind) return null;
    const emailId = ev.data.email_id;
    if (typeof emailId !== 'string' || !emailId || emailId.length > 200) return null;
    const rawTo: unknown[] = Array.isArray(ev.data.to) ? ev.data.to : typeof ev.data.to === 'string' ? [ev.data.to] : [];
    const to = rawTo
        .filter((t): t is string => typeof t === 'string')
        .map(t => extractAddress(t).trim().toLowerCase())
        .filter(t => t.includes('@'))
        .slice(0, 50);
    const bounce = ev.data.bounce as { type?: unknown; subType?: unknown; message?: unknown } | undefined;
    const btype = typeof bounce?.type === 'string' ? bounce.type.toLowerCase() : '';
    const permanent = kind === 'bounce' && btype === 'permanent';
    const msg = typeof bounce?.message === 'string' ? bounce.message : '';
    const detail =
        kind === 'bounce' ? `Rebote ${permanent ? 'permanente' : btype || 'desconocido'}${msg ? `: ${msg}` : ''}`.slice(0, 500)
        : kind === 'complaint' ? 'Queja de spam'
        : 'Entrega retrasada';
    return { kind, emailId, to, permanent, detail };
}

export interface EventRowRef { campaignId: string; idx: number; userId: string; recipient: string | null; status: string }

export interface EventDeps {
    findRowByResendId(emailId: string): Promise<EventRowRef | null>;
    /** Remitente (userId) del correo cuando NO es una fila de campana (envio directo de Elixir o correo normal). */
    findSenderByResendId(emailId: string): Promise<string | null>;
    markRow(campaignId: string, idx: number, status: 'bounced' | 'complained' | null, message: string, code: string): Promise<void>;
    recordSuppression(sender: string, recipient: string, reason: 'bounce' | 'complaint'): Promise<void>;
}

export interface EventOutcome { handled: boolean; suppressed: string[]; rowMarked: boolean; reason?: string }

export async function applyDeliveryEvent(ev: ParsedDeliveryEvent, deps: EventDeps): Promise<EventOutcome> {
    const suppressReason: 'bounce' | 'complaint' | null =
        ev.kind === 'complaint' ? 'complaint' : ev.kind === 'bounce' && ev.permanent ? 'bounce' : null;
    const out: EventOutcome = { handled: true, suppressed: [], rowMarked: false };

    const row = await deps.findRowByResendId(ev.emailId);
    if (row) {
        // Las filas de campana son de un solo destinatario: se suprime exactamente ese.
        const rcpt = row.recipient ?? (ev.to.length === 1 ? ev.to[0] : null);
        if (suppressReason && rcpt) {
            await deps.recordSuppression(row.userId, rcpt, suppressReason);
            out.suppressed.push(rcpt);
        }
        const status = ev.kind === 'bounce' && ev.permanent ? 'bounced' : ev.kind === 'complaint' ? 'complained' : null;
        await deps.markRow(row.campaignId, row.idx, status, ev.detail, `event_${ev.kind}`);
        out.rowMarked = true;
        return out;
    }

    // Sin fila: solo se suprime si se puede atribuir a un remitente y hay un unico destinatario.
    if (!suppressReason) { out.reason = 'no_row'; return out; }
    if (ev.to.length !== 1) { out.reason = 'ambiguous_recipients'; return out; }
    const sender = await deps.findSenderByResendId(ev.emailId);
    if (!sender) { out.reason = 'unknown_email'; return out; }
    await deps.recordSuppression(sender, ev.to[0], suppressReason);
    out.suppressed.push(ev.to[0]);
    return out;
}

export interface VerifyResult { ok: boolean; status: number; error?: string; payload?: unknown }

/** Verifica la firma Svix (id, timestamp <= 5 min, HMAC-SHA256 con `whsec_...`). Falla cerrado sin secreto. */
export function verifyResendSignature(rawBody: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, secret: string | undefined): VerifyResult {
    if (!secret) return { ok: false, status: 503, error: 'Webhook not configured' };
    if (!headers.id || !headers.timestamp || !headers.signature) return { ok: false, status: 400, error: 'Missing signature headers' };
    try {
        const payload = new Webhook(secret).verify(rawBody, {
            'svix-id': headers.id, 'svix-timestamp': headers.timestamp, 'svix-signature': headers.signature,
        });
        return { ok: true, status: 200, payload };
    } catch {
        return { ok: false, status: 400, error: 'Invalid signature' };
    }
}
