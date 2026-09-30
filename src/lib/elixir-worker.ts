/**
 * elixir-worker.ts — procesa filas pendientes de una campana persistente de Elixir, por lotes y con
 * presupuesto de tiempo. Sin dependencias de Next/Prisma: todo el I/O entra por `WorkerDeps`
 * (store, envio, supresion, usuario), asi se prueba con vitest usando dobles en memoria.
 *
 * Garantias:
 *  - Un solo worker por campana (bloqueo `lockedUntil` en el store).
 *  - Idempotencia por (campana, destinatario): la fila unica + cabecera `Idempotency-Key` hacia Resend.
 *  - Nunca se envia una plantilla cruda: si el render falla, la fila queda en `error`.
 *  - Respeta lista de supresion (fallo cerrado), cuota horaria persistente, cancelacion/pausa entre filas.
 *  - Backoff por fila ante 429/5xx (`rowBackoffMs`); tras MAX_ROW_ATTEMPTS pasa a `error`.
 */

import { compileTemplate, isValidTimezone, LiquidError, systemDateVars, type CompiledTemplate } from './liquid';
import { extractAddress, formatFromHeader, isValidEmailAddress, parseRecipientList, sanitizeSubject } from './mail-validation';
import {
    appendUnsubscribeFooter, htmlToText, idempotencyKey, sendWithRetry, templateHasUnsubscribe,
    type ResendPayload, type SendOutcome, type RetryOptions,
} from './elixir-send';
import { MAX_ROW_ATTEMPTS, rowBackoffMs, type CampaignRecord, type CampaignRowStatus, type CampaignStatus } from './elixir-campaigns';

export interface ClaimedRow {
    idx: number;
    email: string;
    recipient: string | null;
    data: Record<string, string>;
    attempts: number;
}

export interface RowPatch {
    status: CampaignRowStatus;
    message?: string | null;
    code?: string | null;
    resendEmailId?: string | null;
    sentAt?: Date | null;
    nextAttemptAt?: Date;
}

export interface CampaignStore {
    /** Adquiere el bloqueo de la campana si esta `running` y libre. null si no. */
    lockCampaign(id: string, lockUntil: Date, now: Date): Promise<CampaignRecord | null>;
    unlockCampaign(id: string): Promise<void>;
    getStatus(id: string): Promise<CampaignStatus | null>;
    /** Devuelve a `pending` las filas `sending` sin actividad desde `staleBefore` (caida del worker). */
    reclaimStaleRows(id: string, staleBefore: Date): Promise<number>;
    /** Marca como `sending` (attempts+1) hasta `limit` filas listas y las devuelve ordenadas por idx. */
    claimRows(id: string, limit: number, now: Date): Promise<ClaimedRow[]>;
    markRow(id: string, idx: number, patch: RowPatch): Promise<void>;
    /** Devuelve filas reclamadas a `pending` sin consumir un intento. */
    releaseRows(id: string, idxs: number[]): Promise<void>;
    countSentSince(userId: string, since: Date): Promise<number>;
    /** pending listas ahora, pending totales y sending. */
    countRemaining(id: string, now: Date): Promise<{ ready: number; pending: number; sending: number }>;
    finishCampaign(id: string, status: CampaignStatus, lastError?: string | null): Promise<void>;
    setLastError(id: string, message: string | null): Promise<void>;
}

export interface WorkerUser {
    id: string;
    email: string;
    name: string | null;
    /** Direcciones (minusculas) autorizadas como remitente. */
    allowedEmails: Set<string>;
}

export interface WorkerDeps {
    store: CampaignStore;
    loadUser(userId: string): Promise<WorkerUser | null>;
    /** Lanza si no se puede consultar (se trata como fallo cerrado). */
    getSuppressed(userId: string): Promise<Set<string>>;
    send(payload: ResendPayload, idemKey: string): Promise<SendOutcome>;
    unsubscribeUrl(userId: string, recipient: string): string | null;
    unsubscribeHeaders(userId: string, recipient: string, senderMailbox: string): Record<string, string> | null;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    retry?: Pick<RetryOptions, 'maxAttempts' | 'baseDelayMs' | 'maxDelayMs' | 'random'>;
}

export interface WorkerLimits {
    /** Presupuesto total de la invocacion. */
    budgetMs: number;
    /** Separacion minima entre envios (Resend ~2 req/s). */
    sendIntervalMs: number;
    /** Correos por hora y usuario (persistente: cuenta filas `sent` en la BD). */
    maxPerHour: number;
    claimSize: number;
    lockMs: number;
    staleSendingMs: number;
}

export const DEFAULT_LIMITS: WorkerLimits = {
    budgetMs: Number.parseInt(process.env.ELIXIR_BATCH_BUDGET_MS || '', 10) || 45_000,
    sendIntervalMs: Number.parseInt(process.env.ELIXIR_SEND_INTERVAL_MS || '', 10) || 550,
    maxPerHour: Number.parseInt(process.env.ELIXIR_MAX_ROWS_PER_HOUR || process.env.MAX_BULK_ROWS || '', 10) || 5000,
    claimSize: 10,
    lockMs: 90_000,
    staleSendingMs: 5 * 60_000,
};

export interface TickResult {
    ran: boolean;
    reason?: 'not_running_or_locked' | 'user_missing' | 'template_error' | 'suppression_unavailable' | 'quota' | 'paused_or_cancelled' | 'budget' | 'idle' | 'rate_limited' | 'done';
    processed: number;
    sent: number;
    errors: number;
    unsubscribed: number;
    deferred: number;
    /** Filas listas que quedan (>0 => conviene encadenar otra invocacion). */
    readyRemaining: number;
    /** Espera sugerida antes de volver a intentar (429/cuota). */
    retryAfterMs?: number;
    finished?: CampaignStatus;
}

function emptyTick(ran: boolean, reason?: TickResult['reason']): TickResult {
    return { ran, reason, processed: 0, sent: 0, errors: 0, unsubscribed: 0, deferred: 0, readyRemaining: 0 };
}

// ── Construccion del correo de una fila (pura) ───────────────────────────────

export interface CompiledCampaign {
    subject: CompiledTemplate;
    html: CompiledTemplate;
    fromName: CompiledTemplate | null;
    fromEmail: CompiledTemplate | null;
    cc: CompiledTemplate | null;
    bcc: CompiledTemplate | null;
}

/** Compila todos los campos; lanza LiquidError con `field` en el mensaje si alguno falla. */
export function compileCampaign(c: Pick<CampaignRecord, 'subject' | 'template' | 'senderConfig'>): CompiledCampaign {
    const one = (field: string, src: string | undefined): CompiledTemplate | null => {
        if (!src || !src.trim()) return null;
        try { return compileTemplate(src); }
        catch (e) { throw new LiquidError('syntax', `Error en ${field}: ${(e as Error).message}`); }
    };
    const subject = one('subject', c.subject);
    const html = one('template', c.template);
    if (!subject) throw new LiquidError('syntax', 'El asunto está vacío');
    if (!html) throw new LiquidError('syntax', 'La plantilla está vacía');
    return {
        subject, html,
        fromName: one('fromName', c.senderConfig.fromName),
        fromEmail: one('fromEmail', c.senderConfig.fromEmail),
        cc: one('cc', c.senderConfig.cc),
        bcc: one('bcc', c.senderConfig.bcc),
    };
}

export type BuildResult =
    | { ok: true; payload: ResendPayload }
    | { ok: false; code: string; message: string };

export interface BuildContext {
    campaign: Pick<CampaignRecord, 'id' | 'template' | 'options'>;
    compiled: CompiledCampaign;
    user: WorkerUser;
    suppressed: Set<string>;
    dateVars: Record<string, string>;
    timezone: string;
    now: Date;
    unsubscribeUrl(recipient: string): string | null;
    unsubscribeHeaders(recipient: string, senderMailbox: string): Record<string, string> | null;
}

const MAX_EXTRA_RECIPIENTS = 10;

export function buildRowPayload(ctx: BuildContext, recipientEmail: string, row: Record<string, string>): BuildResult {
    const { campaign, compiled: c, user } = ctx;
    const opts = campaign.options;
    const strictVariables = opts.strictVariables !== false;
    const autoescape = opts.autoescape !== false;
    const addFooter = opts.unsubscribeFooter !== false && !templateHasUnsubscribe(campaign.template);
    const baseRender = { timezone: ctx.timezone, locale: 'es' as const, now: ctx.now, strictVariables };
    try {
        const unsubscribeUrl = ctx.unsubscribeUrl(recipientEmail);
        const merged: Record<string, unknown> = {
            ...ctx.dateVars, ...(opts.systemVars ?? {}), ...row, ...(unsubscribeUrl ? { unsubscribe_url: unsubscribeUrl } : {}),
        };
        const subject = sanitizeSubject(c.subject.render(merged, baseRender));
        if (!subject) throw new LiquidError('runtime', 'El asunto quedó vacío tras renderizar');
        let html = c.html.render(merged, { ...baseRender, autoescape });
        if (!html.trim()) throw new LiquidError('runtime', 'El cuerpo quedó vacío tras renderizar');
        if (addFooter && unsubscribeUrl) html = appendUnsubscribeFooter(html, unsubscribeUrl, 'es');

        const fromName = c.fromName ? c.fromName.render(merged, baseRender) : (user.name || 'User');
        const renderedFrom = c.fromEmail ? c.fromEmail.render(merged, baseRender) : user.email;
        const fromEmail = extractAddress(renderedFrom).toLowerCase();
        if (!isValidEmailAddress(fromEmail) || !user.allowedEmails.has(fromEmail)) {
            return { ok: false, code: 'unauthorized_sender', message: 'Unauthorized sender account' };
        }
        const pick = (t: CompiledTemplate | null) => t
            ? parseRecipientList(t.render(merged, baseRender)).valid.filter(a => !ctx.suppressed.has(a.toLowerCase())).slice(0, MAX_EXTRA_RECIPIENTS)
            : [];
        const cc = pick(c.cc);
        const bcc = pick(c.bcc);
        const payload: ResendPayload = {
            from: formatFromHeader(fromName, fromEmail), to: [recipientEmail], subject, html, text: htmlToText(html) || undefined,
        };
        if (cc.length) payload.cc = cc;
        if (bcc.length) payload.bcc = bcc;
        const headers = ctx.unsubscribeHeaders(recipientEmail, fromEmail);
        if (headers) payload.headers = headers;
        payload.tags = [
            { name: 'campaign', value: campaign.id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256) },
            { name: 'source', value: 'elixir' },
        ];
        return { ok: true, payload };
    } catch (e) {
        const le = e instanceof LiquidError ? e : null;
        return { ok: false, code: le ? `liquid_${le.code}` : 'render_failed', message: `Plantilla: ${(e as Error)?.message ?? 'error de render'}` };
    }
}

// ── Tick ─────────────────────────────────────────────────────────────────────

export async function runCampaignTick(deps: WorkerDeps, campaignId: string, limitsIn: Partial<WorkerLimits> = {}): Promise<TickResult> {
    const limits = { ...DEFAULT_LIMITS, ...limitsIn };
    const now = deps.now ?? (() => Date.now());
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
    const { store } = deps;
    const started = now();
    const deadline = started + limits.budgetMs;

    const campaign = await store.lockCampaign(campaignId, new Date(started + limits.lockMs), new Date(started));
    if (!campaign) return emptyTick(false, 'not_running_or_locked');

    const res = emptyTick(true);
    try {
        await store.reclaimStaleRows(campaign.id, new Date(started - limits.staleSendingMs));

        const user = await deps.loadUser(campaign.userId);
        if (!user) {
            await store.finishCampaign(campaign.id, 'failed', 'Usuario no encontrado');
            res.reason = 'user_missing'; res.finished = 'failed';
            return res;
        }

        let compiled: CompiledCampaign;
        try { compiled = compileCampaign(campaign); }
        catch (e) {
            const msg = (e as Error).message;
            await store.finishCampaign(campaign.id, 'failed', msg);
            res.reason = 'template_error'; res.finished = 'failed';
            return res;
        }

        let suppressed: Set<string>;
        try { suppressed = await deps.getSuppressed(user.id); }
        catch {
            await store.setLastError(campaign.id, 'No se pudo consultar la lista de bajas; se reintentará');
            res.reason = 'suppression_unavailable'; res.retryAfterMs = 30_000;
            return res;
        }

        const tz = campaign.options.timezone && isValidTimezone(campaign.options.timezone) ? campaign.options.timezone : 'UTC';
        const nowDate = new Date(started);
        const ctx: BuildContext = {
            campaign, compiled, user, suppressed, timezone: tz, now: nowDate,
            dateVars: systemDateVars(nowDate, tz, 'es'),
            unsubscribeUrl: r => deps.unsubscribeUrl(user.id, r),
            unsubscribeHeaders: (r, m) => deps.unsubscribeHeaders(user.id, r, m),
        };

        // Cuota horaria persistente.
        const sentLastHour = await store.countSentSince(user.id, new Date(started - 3_600_000));
        let quotaLeft = Math.max(0, limits.maxPerHour - sentLastHour);
        if (quotaLeft === 0) { res.reason = 'quota'; res.retryAfterMs = 10 * 60_000; }

        let lastSendAt = 0;
        let stop = quotaLeft === 0;
        while (!stop && quotaLeft > 0 && now() + 3_000 < deadline) {
            const batch = await store.claimRows(campaign.id, Math.min(limits.claimSize, quotaLeft), new Date(now()));
            if (batch.length === 0) break;

            for (let i = 0; i < batch.length; i++) {
                const row = batch[i];
                const rest = () => batch.slice(i).map(b => b.idx);

                // Cancelar/pausar: se detecta entre filas.
                const st = await store.getStatus(campaign.id);
                if (st !== 'running') { await store.releaseRows(campaign.id, rest()); res.reason = 'paused_or_cancelled'; stop = true; break; }
                if (now() + 3_000 >= deadline) { await store.releaseRows(campaign.id, rest()); res.reason = 'budget'; stop = true; break; }

                const recipient = (row.recipient ?? row.email).trim();
                const key = recipient.toLowerCase();
                res.processed++;

                if (!isValidEmailAddress(recipient)) {
                    await store.markRow(campaign.id, row.idx, { status: 'skipped', message: 'Email inválido', code: 'invalid_email' });
                    continue;
                }
                if (suppressed.has(key)) {
                    await store.markRow(campaign.id, row.idx, { status: 'unsubscribed', message: 'Dado de baja', code: 'unsubscribed' });
                    res.unsubscribed++;
                    continue;
                }
                const built = buildRowPayload(ctx, recipient, row.data);
                if (!built.ok) {
                    await store.markRow(campaign.id, row.idx, { status: 'error', message: built.message, code: built.code });
                    res.errors++;
                    continue;
                }

                const wait = lastSendAt + limits.sendIntervalMs - now();
                if (wait > 0) await sleep(wait);
                lastSendAt = now();

                const idem = idempotencyKey(campaign.id, recipient);
                const r = await sendWithRetry(() => deps.send(built.payload, idem), { ...deps.retry, deadline: deadline - 1_000, now, sleep });
                if (r.kind === 'sent') {
                    await store.markRow(campaign.id, row.idx, { status: 'sent', resendEmailId: r.id ?? null, sentAt: new Date(now()), message: null, code: null });
                    res.sent++; quotaLeft--;
                } else if (r.kind === 'error') {
                    await store.markRow(campaign.id, row.idx, { status: 'error', message: r.message.slice(0, 500), code: 'send_failed' });
                    res.errors++;
                } else if (row.attempts >= MAX_ROW_ATTEMPTS) {
                    await store.markRow(campaign.id, row.idx, { status: 'error', message: `Sin éxito tras ${row.attempts} intentos: ${r.message}`.slice(0, 500), code: 'max_attempts' });
                    res.errors++;
                } else {
                    // Rate limit / 5xx persistente: la fila vuelve a pending con backoff; se detiene el lote.
                    const delay = rowBackoffMs(row.attempts, r.retryAfterMs);
                    await store.markRow(campaign.id, row.idx, {
                        status: 'pending', message: r.message.slice(0, 500), code: 'deferred', nextAttemptAt: new Date(now() + delay),
                    });
                    res.deferred++;
                    res.retryAfterMs = Math.max(res.retryAfterMs ?? 0, delay);
                    res.reason = 'rate_limited';
                    if (i + 1 < batch.length) await store.releaseRows(campaign.id, batch.slice(i + 1).map(b => b.idx));
                    stop = true;
                    break;
                }
            }
        }
        if (quotaLeft === 0 && !res.reason) { res.reason = 'quota'; res.retryAfterMs = 10 * 60_000; }

        const rem = await store.countRemaining(campaign.id, new Date(now()));
        res.readyRemaining = rem.ready;
        const st = await store.getStatus(campaign.id);
        if (st === 'running' && rem.pending === 0 && rem.sending === 0) {
            await store.finishCampaign(campaign.id, 'done', null);
            res.finished = 'done'; res.reason = 'done';
        } else if (st === 'running' && !res.reason) {
            res.reason = rem.ready > 0 ? 'budget' : 'idle';
        }
        if (res.processed > 0 && !res.finished) await store.setLastError(campaign.id, null);
        return res;
    } finally {
        await store.unlockCampaign(campaign.id).catch(() => { /* el bloqueo caduca solo */ });
    }
}
