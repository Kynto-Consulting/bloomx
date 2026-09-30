import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { compileTemplate, isValidTimezone, LiquidError, systemDateVars, type CompiledTemplate } from '@/lib/liquid';
import { extractAddress, formatFromHeader, isValidEmailAddress, parseRecipientList, sanitizeSubject } from '@/lib/mail-validation';
import { buildAbsoluteUnsubscribeUrl, buildUnsubscribeHeaders, getSuppressedRecipients } from '@/lib/unsubscribe';
import { rateLimit } from '@/lib/security';
import {
    appendUnsubscribeFooter, createResendSender, htmlToText, idempotencyKey, sendWithRetry, templateHasUnsubscribe,
    type ResendPayload,
} from '@/lib/elixir-send';

/**
 * Envio masivo de Elixir, por LOTES y reanudable.
 *
 * Protocolo: el cliente envia lotes de <= MAX_BATCH_ROWS filas (`items: [{ index, row }]`) con un `campaignId` estable.
 * El servidor procesa mientras quede presupuesto de tiempo (maxDuration) y responde:
 *   { results: [{ index, email, status: 'sent'|'skipped'|'error'|'unsubscribed', message?, code? }],
 *     pending: number[],          // indices NO procesados (sin tiempo / 429 / cuota): el cliente los reintenta
 *     retryAfterMs?: number, paused?: 'quota' }
 * Idempotencia por (campana, destinatario): cabecera `Idempotency-Key` hacia Resend (24 h) + registro en
 * EmailEvent { type: 'elixir_send' } (sin migracion), de modo que un reintento tras un corte no duplica correos.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BATCH_ROWS = Math.min(100, Number.parseInt(process.env.ELIXIR_BATCH_MAX || '50', 10) || 50);
const MAX_EXTRA_RECIPIENTS = 10;
const BATCH_BUDGET_MS = Number.parseInt(process.env.ELIXIR_BATCH_BUDGET_MS || '', 10) || 45_000;
const SEND_INTERVAL_MS = Number.parseInt(process.env.ELIXIR_SEND_INTERVAL_MS || '', 10) || 550; // Resend: ~2 req/s
const MAX_ROWS_PER_HOUR = Number.parseInt(process.env.ELIXIR_MAX_ROWS_PER_HOUR || process.env.MAX_BULK_ROWS || '', 10) || 5000;
const SEND_EVENT = 'elixir_send';

type Row = Record<string, string>;
type RowStatus = 'sent' | 'skipped' | 'error' | 'unsubscribed';
type RowResult = { index: number; email: string; status: RowStatus; message?: string; code?: string };

const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]).transform(v => (v === null ? '' : String(v)).slice(0, 20_000));

const payloadSchema = z.object({
    campaignId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'campaignId inválido'),
    items: z.array(z.object({
        index: z.number().int().min(0).max(1_000_000),
        row: z.record(z.string().max(200), cell).refine(r => Object.keys(r).length <= 500, 'Demasiadas columnas'),
    })).min(1).max(MAX_BATCH_ROWS).optional(),
    rows: z.array(z.record(z.string().max(200), cell)).min(1).max(MAX_BATCH_ROWS).optional(),
    startIndex: z.number().int().min(0).optional(),
    template: z.string().min(1, 'La plantilla está vacía').max(500_000),
    subject: z.string().min(1, 'El asunto está vacío').max(2_000),
    recipientColumn: z.string().min(1, 'Columna de destinatario no especificada').max(200),
    senderConfig: z.object({
        fromName: z.string().max(300).optional(),
        fromEmail: z.string().max(500).optional(),
        cc: z.string().max(2_000).optional(),
        bcc: z.string().max(2_000).optional(),
    }).partial().optional(),
    systemVars: z.record(z.string().max(100), z.string().max(2_000)).optional().refine(v => !v || Object.keys(v).length <= 50, 'Demasiadas variables'),
    timezone: z.string().max(64).optional(),
    autoescape: z.boolean().optional(),
    strictVariables: z.boolean().optional(),
    unsubscribeFooter: z.boolean().optional(),
}).refine(p => !!p.items || !!p.rows, { message: 'items requerido' });

// ── Cuota horaria por usuario (best-effort por instancia) ───────────────────────

const quota = new Map<string, { count: number; resetAt: number }>();
function takeQuota(userId: string): { ok: boolean; retryAfterMs: number } {
    const now = Date.now();
    let q = quota.get(userId);
    if (!q || q.resetAt <= now) { q = { count: 0, resetAt: now + 3_600_000 }; quota.set(userId, q); }
    if (q.count >= MAX_ROWS_PER_HOUR) return { ok: false, retryAfterMs: q.resetAt - now };
    q.count++;
    return { ok: true, retryAfterMs: 0 };
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function compileField(name: string, src: string): CompiledTemplate | NextResponse {
    try {
        return compileTemplate(src);
    } catch (e) {
        const err = e as LiquidError;
        return NextResponse.json({
            error: `Error en ${name}: ${err.message}`,
            code: 'template_error',
            field: name,
            details: err instanceof LiquidError ? err.toJSON() : undefined,
        }, { status: 422 });
    }
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    const startedAt = Date.now();
    const deadline = startedAt + BATCH_BUDGET_MS;

    const sessionUser = await getCurrentUser();
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Peticiones (lotes) por hora; el limite real de correos es la cuota por fila de arriba.
    const rl = rateLimit(`elixir:${sessionUser.id}`, 1200, 60 * 60 * 1000);
    if (!rl.ok) {
        return NextResponse.json({ error: 'Too many bulk sends. Try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } });
    }

    let raw: unknown;
    try { raw = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const parsed = payloadSchema.safeParse(raw);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return NextResponse.json({ error: `${issue?.path.join('.') || 'payload'}: ${issue?.message ?? 'inválido'}`, code: 'invalid_payload' }, { status: 400 });
    }
    const body = parsed.data;
    const items: Array<{ index: number; row: Row }> = body.items ?? (body.rows ?? []).map((row, i) => ({ index: (body.startIndex ?? 0) + i, row }));
    const senderConfig = body.senderConfig ?? {};
    const timezone = body.timezone && isValidTimezone(body.timezone) ? body.timezone : 'UTC';

    const user = await prisma.user.findUnique({
        where: { id: sessionUser.id },
        select: { id: true, email: true, name: true, accounts: { select: { providerAccountId: true } } },
    });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const allowedEmails = new Set<string>([
        user.email.toLowerCase(),
        ...user.accounts.map(a => String(a.providerAccountId || '').trim().toLowerCase()).filter(e => e.includes('@')),
    ]);

    if (senderConfig.fromEmail?.trim()) {
        const rawFrom = senderConfig.fromEmail.trim().toLowerCase();
        const extracted = rawFrom.match(/<([^>]+)>/)?.[1]?.toLowerCase() ?? rawFrom;
        // Si contiene variables Liquid se valida por fila, despues de renderizar.
        if (!/\{\{|\{%/.test(rawFrom) && !allowedEmails.has(extracted)) {
            return NextResponse.json({ error: 'Unauthorized sender account' }, { status: 401 });
        }
    }

    // Compilar UNA vez: cualquier error de sintaxis aborta antes de enviar nada.
    const cSubject = compileField('subject', body.subject); if (cSubject instanceof NextResponse) return cSubject;
    const cHtml = compileField('template', body.template); if (cHtml instanceof NextResponse) return cHtml;
    const cFromName = senderConfig.fromName?.trim() ? compileField('fromName', senderConfig.fromName) : null;
    if (cFromName instanceof NextResponse) return cFromName;
    const cFromEmail = senderConfig.fromEmail?.trim() ? compileField('fromEmail', senderConfig.fromEmail) : null;
    if (cFromEmail instanceof NextResponse) return cFromEmail;
    const cCc = senderConfig.cc?.trim() ? compileField('cc', senderConfig.cc) : null;
    if (cCc instanceof NextResponse) return cCc;
    const cBcc = senderConfig.bcc?.trim() ? compileField('bcc', senderConfig.bcc) : null;
    if (cBcc instanceof NextResponse) return cBcc;

    const strictVariables = body.strictVariables !== false;
    const autoescape = body.autoescape !== false;
    const addFooter = body.unsubscribeFooter !== false && !templateHasUnsubscribe(body.template);
    const now = new Date();
    const dateVars = systemDateVars(now, timezone, 'es');
    const baseRender = { timezone, locale: 'es' as const, now, strictVariables };

    // Supresion (fallo cerrado: si no se puede consultar, no se envia) y ya-enviados (idempotencia).
    let suppressed: Set<string>;
    try { suppressed = await getSuppressedRecipients(user.id); }
    catch { return NextResponse.json({ error: 'No se pudo consultar la lista de bajas; reintente', code: 'suppression_unavailable' }, { status: 503, headers: { 'Retry-After': '5' } }); }

    const alreadySent = new Set<string>();
    try {
        const evs = await prisma.emailEvent.findMany({
            where: { type: SEND_EVENT, AND: [{ data: { path: ['campaign'], equals: body.campaignId } }, { data: { path: ['sender'], equals: user.id } }] },
            select: { data: true }, take: 100_000,
        });
        for (const e of evs) { const r = (e.data as { recipient?: unknown } | null)?.recipient; if (typeof r === 'string') alreadySent.add(r); }
    } catch { /* tabla/consulta no disponible: la idempotencia de Resend sigue activa */ }

    const send = createResendSender(process.env.RESEND_API_KEY);
    const results: RowResult[] = [];
    const pending: number[] = [];
    const seenRecipients = new Set<string>();
    let retryAfterMs: number | undefined;
    let paused: 'quota' | undefined;
    let lastSendAt = 0;

    const records: Promise<unknown>[] = [];
    const push = (r: RowResult) => results.push(r);

    for (let pos = 0; pos < items.length; pos++) {
        const { index, row } = items[pos];
        if (paused || (retryAfterMs !== undefined)) { pending.push(index); continue; }
        if (Date.now() + 2_000 > deadline) { pending.push(index); continue; }

        const recipientEmail = String(row[body.recipientColumn] ?? '').trim();
        if (!isValidEmailAddress(recipientEmail)) {
            push({ index, email: recipientEmail.slice(0, 80) || '(vacío)', status: 'skipped', message: 'Email inválido', code: 'invalid_email' }); continue;
        }
        const key = recipientEmail.toLowerCase();
        if (seenRecipients.has(key)) { push({ index, email: recipientEmail, status: 'skipped', message: 'Duplicado', code: 'duplicate' }); continue; }
        seenRecipients.add(key);
        if (suppressed.has(key)) { push({ index, email: recipientEmail, status: 'unsubscribed', message: 'Dado de baja', code: 'unsubscribed' }); continue; }
        if (alreadySent.has(key)) { push({ index, email: recipientEmail, status: 'sent', message: 'Ya enviado (reanudado)', code: 'already_sent' }); continue; }

        // ── Render por fila: si falla, la fila es 'error' (NUNCA se envia la plantilla cruda) ──
        let payload: ResendPayload;
        let fromEmail: string;
        const unsubscribeUrl = buildAbsoluteUnsubscribeUrl(user.id, recipientEmail);
        try {
            const merged: Record<string, unknown> = { ...dateVars, ...(body.systemVars ?? {}), ...row, ...(unsubscribeUrl ? { unsubscribe_url: unsubscribeUrl } : {}) };
            const subject = sanitizeSubject(cSubject.render(merged, baseRender));
            if (!subject) throw new LiquidError('runtime', 'El asunto quedó vacío tras renderizar');
            let html = cHtml.render(merged, { ...baseRender, autoescape });
            if (!html.trim()) throw new LiquidError('runtime', 'El cuerpo quedó vacío tras renderizar');
            if (addFooter && unsubscribeUrl) html = appendUnsubscribeFooter(html, unsubscribeUrl, 'es');

            const fromName = cFromName ? cFromName.render(merged, baseRender) : (user.name || 'User');
            const renderedFrom = cFromEmail ? cFromEmail.render(merged, baseRender) : user.email;
            fromEmail = extractAddress(renderedFrom).toLowerCase();
            if (!isValidEmailAddress(fromEmail) || !allowedEmails.has(fromEmail)) {
                push({ index, email: recipientEmail, status: 'error', message: 'Unauthorized sender account', code: 'unauthorized_sender' }); continue;
            }
            const ccList = cCc ? parseRecipientList(cCc.render(merged, baseRender)).valid.filter(a => !suppressed.has(a.toLowerCase())).slice(0, MAX_EXTRA_RECIPIENTS) : [];
            const bccList = cBcc ? parseRecipientList(cBcc.render(merged, baseRender)).valid.filter(a => !suppressed.has(a.toLowerCase())).slice(0, MAX_EXTRA_RECIPIENTS) : [];
            payload = { from: formatFromHeader(fromName, fromEmail), to: [recipientEmail], subject, html, text: htmlToText(html) || undefined };
            if (ccList.length) payload.cc = ccList;
            if (bccList.length) payload.bcc = bccList;
            const headers = buildUnsubscribeHeaders(user.id, recipientEmail, fromEmail);
            if (headers) payload.headers = headers;
            payload.tags = [{ name: 'campaign', value: body.campaignId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256) }, { name: 'source', value: 'elixir' }];
        } catch (e) {
            const le = e instanceof LiquidError ? e : null;
            push({ index, email: recipientEmail, status: 'error', message: `Plantilla: ${(e as Error)?.message ?? 'error de render'}`, code: le ? `liquid_${le.code}` : 'render_failed' });
            continue;
        }

        // ── Cuota y ritmo ──
        const q = takeQuota(user.id);
        if (!q.ok) { paused = 'quota'; retryAfterMs = q.retryAfterMs; pending.push(index); continue; }
        const wait = lastSendAt + SEND_INTERVAL_MS - Date.now();
        if (wait > 0) await sleep(wait);
        lastSendAt = Date.now();

        const idem = idempotencyKey(body.campaignId, recipientEmail);
        const r = await sendWithRetry(() => send(payload, idem), { deadline: deadline - 1_000 });
        if (r.kind === 'sent') {
            push({ index, email: recipientEmail, status: 'sent' });
            records.push(prisma.emailEvent.create({
                data: { type: SEND_EVENT, resendEmailId: r.id ?? null, data: { campaign: body.campaignId, sender: user.id, recipient: recipientEmail, at: new Date().toISOString() } },
            }).catch(() => { /* registro opcional: la idempotencia de Resend sigue activa */ }));
        } else if (r.kind === 'error') {
            push({ index, email: recipientEmail, status: 'error', message: r.message, code: 'send_failed' });
        } else {
            // Sin tiempo o rate-limit persistente: queda pendiente (el cliente reintenta con la misma clave).
            pending.push(index);
            retryAfterMs = r.retryAfterMs;
        }
    }

    await Promise.allSettled(records);
    return NextResponse.json({ campaignId: body.campaignId, results, pending, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}), ...(paused ? { paused } : {}) });
}
