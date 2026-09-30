import { describe, expect, it, vi } from 'vitest';
import { Webhook } from 'svix';
import { applyDeliveryEvent, parseDeliveryEvent, verifyResendSignature, type EventDeps } from '../elixir-events';
import { classifyRow, countsFromGroups, nextStatusForAction, progressOf, rowBackoffMs, sanitizeRowData, emptyCounts } from '../elixir-campaigns';

const bounced = (over: Record<string, unknown> = {}) => ({
    type: 'email.bounced', created_at: '2026-01-01T00:00:00Z',
    data: { email_id: 're_1', to: ['Ana <ANA@x.com>'], bounce: { type: 'Permanent', subType: 'General', message: 'no such user' }, ...over },
});

function deps(over: Partial<EventDeps> = {}): EventDeps & { calls: string[] } {
    const calls: string[] = [];
    return {
        calls,
        findRowByResendId: vi.fn(async () => null),
        findSenderByResendId: vi.fn(async () => null),
        markRow: vi.fn(async (c, i, s, m, code) => { calls.push(`mark:${c}:${i}:${s}:${code}`); }),
        recordSuppression: vi.fn(async (s, r, reason) => { calls.push(`supp:${s}:${r}:${reason}`); }),
        ...over,
    };
}

describe('parseDeliveryEvent', () => {
    it('normaliza destinatarios y distingue rebote permanente', () => {
        const e = parseDeliveryEvent(bounced())!;
        expect(e).toMatchObject({ kind: 'bounce', emailId: 're_1', to: ['ana@x.com'], permanent: true });
        expect(parseDeliveryEvent(bounced({ bounce: { type: 'Transient' } }))!.permanent).toBe(false);
    });
    it('ignora tipos no soportados y payloads invalidos', () => {
        expect(parseDeliveryEvent({ type: 'email.delivered', data: { email_id: 'x' } })).toBeNull();
        expect(parseDeliveryEvent({ type: 'email.bounced', data: {} })).toBeNull();
        expect(parseDeliveryEvent(null)).toBeNull();
        expect(parseDeliveryEvent('x')).toBeNull();
    });
    it('reconoce queja y retraso', () => {
        expect(parseDeliveryEvent({ type: 'email.complained', data: { email_id: 'a', to: ['b@x.com'] } })!.kind).toBe('complaint');
        expect(parseDeliveryEvent({ type: 'email.delivery_delayed', data: { email_id: 'a', to: ['b@x.com'] } })!.kind).toBe('delayed');
    });
});

describe('applyDeliveryEvent', () => {
    const row = { campaignId: 'ecp_1', idx: 4, userId: 'u1', recipient: 'ana@x.com', status: 'sent' };

    it('rebote permanente de una fila de campana: suprime y marca bounced', async () => {
        const d = deps({ findRowByResendId: vi.fn(async () => row) });
        const out = await applyDeliveryEvent(parseDeliveryEvent(bounced())!, d);
        expect(d.calls).toEqual(['supp:u1:ana@x.com:bounce', 'mark:ecp_1:4:bounced:event_bounce']);
        expect(out).toMatchObject({ suppressed: ['ana@x.com'], rowMarked: true });
    });

    it('queja: suprime como complaint y marca complained', async () => {
        const d = deps({ findRowByResendId: vi.fn(async () => row) });
        await applyDeliveryEvent(parseDeliveryEvent({ type: 'email.complained', data: { email_id: 're_1', to: ['ana@x.com'] } })!, d);
        expect(d.calls).toEqual(['supp:u1:ana@x.com:complaint', 'mark:ecp_1:4:complained:event_complaint']);
    });

    it('rebote temporal y retraso NO suprimen: solo anotan la fila', async () => {
        const d = deps({ findRowByResendId: vi.fn(async () => row) });
        await applyDeliveryEvent(parseDeliveryEvent(bounced({ bounce: { type: 'Transient' } }))!, d);
        await applyDeliveryEvent(parseDeliveryEvent({ type: 'email.delivery_delayed', data: { email_id: 're_1', to: ['ana@x.com'] } })!, d);
        expect(d.recordSuppression).not.toHaveBeenCalled();
        expect(d.calls).toEqual(['mark:ecp_1:4:null:event_bounce', 'mark:ecp_1:4:null:event_delayed']);
    });

    it('es idempotente: repetir el evento produce las mismas operaciones absolutas', async () => {
        const d = deps({ findRowByResendId: vi.fn(async () => row) });
        const ev = parseDeliveryEvent(bounced())!;
        await applyDeliveryEvent(ev, d); await applyDeliveryEvent(ev, d);
        expect(d.calls.slice(0, 2)).toEqual(d.calls.slice(2, 4));
    });

    it('sin fila: suprime via remitente conocido si hay un unico destinatario', async () => {
        const d = deps({ findSenderByResendId: vi.fn(async () => 'u9') });
        const out = await applyDeliveryEvent(parseDeliveryEvent(bounced())!, d);
        expect(d.calls).toEqual(['supp:u9:ana@x.com:bounce']);
        expect(out.rowMarked).toBe(false);
    });

    it('sin fila y ambiguo o desconocido: no suprime', async () => {
        const d = deps({ findSenderByResendId: vi.fn(async () => 'u9') });
        const multi = await applyDeliveryEvent(parseDeliveryEvent(bounced({ to: ['a@x.com', 'b@x.com'] }))!, d);
        expect(multi.reason).toBe('ambiguous_recipients');
        const d2 = deps();
        expect((await applyDeliveryEvent(parseDeliveryEvent(bounced())!, d2)).reason).toBe('unknown_email');
        expect(d.recordSuppression).not.toHaveBeenCalled();
        expect(d2.recordSuppression).not.toHaveBeenCalled();
    });

    it('propaga fallos de I/O (la ruta responde 500 para que Resend reintente)', async () => {
        const d = deps({ findRowByResendId: vi.fn(async () => row), recordSuppression: vi.fn(async () => { throw new Error('db'); }) });
        await expect(applyDeliveryEvent(parseDeliveryEvent(bounced())!, d)).rejects.toThrow('db');
    });
});

describe('verifyResendSignature', () => {
    const secret = 'whsec_' + Buffer.from('super-secret-key-for-tests-1234567').toString('base64');
    const body = JSON.stringify(bounced());
    const sign = (ts = new Date(), b = body) => {
        const id = 'msg_123';
        return { id, timestamp: String(Math.floor(ts.getTime() / 1000)), signature: new Webhook(secret).sign(id, ts, b) };
    };

    it('acepta una firma valida y devuelve el payload', () => {
        const r = verifyResendSignature(body, sign(), secret);
        expect(r.ok).toBe(true);
        expect((r.payload as { type: string }).type).toBe('email.bounced');
    });
    it('rechaza firma incorrecta, cuerpo alterado y timestamp viejo', () => {
        const h = sign();
        expect(verifyResendSignature(body, { ...h, signature: 'v1,AAAA' }, secret)).toMatchObject({ ok: false, status: 400 });
        expect(verifyResendSignature(body + ' ', h, secret)).toMatchObject({ ok: false, status: 400 });
        expect(verifyResendSignature(body, sign(new Date(Date.now() - 3_600_000)), secret)).toMatchObject({ ok: false, status: 400 });
    });
    it('falla cerrado sin secreto o sin cabeceras', () => {
        expect(verifyResendSignature(body, sign(), undefined)).toMatchObject({ ok: false, status: 503 });
        expect(verifyResendSignature(body, { id: null, timestamp: null, signature: null }, secret)).toMatchObject({ ok: false, status: 400 });
    });
});

describe('elixir-campaigns (logica pura)', () => {
    it('classifyRow valida, normaliza y marca duplicados', () => {
        const seen = new Set<string>();
        expect(classifyRow(0, { email: 'A@x.com' }, 'email', seen)).toMatchObject({ status: 'pending', recipient: 'a@x.com' });
        expect(classifyRow(1, { email: 'a@X.com' }, 'email', seen)).toMatchObject({ status: 'skipped', code: 'duplicate', recipient: null });
        expect(classifyRow(2, { email: 'no-es-email' }, 'email', seen)).toMatchObject({ status: 'skipped', code: 'invalid_email' });
        expect(classifyRow(3, {}, 'email', seen)).toMatchObject({ status: 'skipped', code: 'invalid_email' });
    });

    it('transiciones validas e invalidas', () => {
        expect(nextStatusForAction('draft', 'start')).toBe('running');
        expect(nextStatusForAction('running', 'start')).toBeNull();
        expect(nextStatusForAction('running', 'pause')).toBe('paused');
        expect(nextStatusForAction('paused', 'resume')).toBe('running');
        expect(nextStatusForAction('cancelled', 'resume')).toBe('running');
        expect(nextStatusForAction('done', 'resume')).toBeNull();
        expect(nextStatusForAction('done', 'cancel')).toBeNull();
        expect(nextStatusForAction('done', 'retry_errors')).toBe('running');
        expect(nextStatusForAction('running', 'retry_errors')).toBeNull();
    });

    it('progreso y conteos', () => {
        const c = countsFromGroups([{ status: 'sent', n: 7 }, { status: 'pending', n: 2 }, { status: 'sending', n: BigInt(1) }, { status: 'raro', n: 9 }]);
        expect(c).toMatchObject({ sent: 7, pending: 2, sending: 1 });
        expect(progressOf(10, c)).toEqual({ total: 10, processed: 7, remaining: 3, percent: 70 });
        expect(progressOf(0, emptyCounts()).percent).toBe(0);
    });

    it('backoff por fila crece y respeta Retry-After y el tope', () => {
        expect(rowBackoffMs(1)).toBe(30_000);
        expect(rowBackoffMs(3)).toBe(120_000);
        expect(rowBackoffMs(20)).toBe(3_600_000);
        expect(rowBackoffMs(1, 90_000)).toBe(90_000);
    });

    it('sanitizeRowData acota celdas y descarta claves peligrosas y objetos', () => {
        const r = sanitizeRowData({ a: 1, b: null, c: 'x'.repeat(30_000), __proto__x: 'ok', nested: { x: 1 } })!;
        expect(r.a).toBe('1'); expect(r.b).toBe(''); expect(r.c).toHaveLength(20_000); expect('nested' in r).toBe(false);
        expect(sanitizeRowData([1])).toBeNull();
        expect(sanitizeRowData(Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`k${i}`, 'v'])))).toBeNull();
    });
});
