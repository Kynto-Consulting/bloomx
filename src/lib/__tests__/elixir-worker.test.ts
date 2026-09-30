import { describe, expect, it, vi } from 'vitest';
import {
    buildRowPayload, compileCampaign, runCampaignTick, type CampaignStore, type ClaimedRow, type RowPatch, type WorkerDeps,
} from '../elixir-worker';
import { idempotencyKey, type ResendPayload, type SendOutcome } from '../elixir-send';
import type { CampaignRecord, CampaignRowStatus, CampaignStatus } from '../elixir-campaigns';

// ── Store en memoria (misma semantica que el store SQL) ──────────────────────

interface MemRow { idx: number; email: string; recipient: string | null; data: Record<string, string>; status: CampaignRowStatus; attempts: number; nextAttemptAt: number; message?: string | null; code?: string | null; resendEmailId?: string | null; sentAt?: number; updatedAt: number }

function memStore(campaign: CampaignRecord, rows: MemRow[], clock: () => number) {
    const state = { campaign, rows, locked: false as boolean };
    const store: CampaignStore = {
        async lockCampaign(_id, _until, _now) {
            if (state.campaign.status !== 'running' || state.locked) return null;
            state.locked = true; return state.campaign;
        },
        async unlockCampaign() { state.locked = false; },
        async getStatus() { return state.campaign.status; },
        async reclaimStaleRows(_id, staleBefore) {
            let n = 0;
            for (const r of state.rows) if (r.status === 'sending' && r.updatedAt < staleBefore.getTime()) { r.status = 'pending'; n++; }
            return n;
        },
        async claimRows(_id, limit, now) {
            const ready = state.rows.filter(r => r.status === 'pending' && r.nextAttemptAt <= now.getTime()).sort((a, b) => a.idx - b.idx).slice(0, limit);
            for (const r of ready) { r.status = 'sending'; r.attempts++; r.updatedAt = clock(); }
            return ready.map((r): ClaimedRow => ({ idx: r.idx, email: r.email, recipient: r.recipient, data: r.data, attempts: r.attempts }));
        },
        async markRow(_id, idx, p: RowPatch) {
            const r = state.rows.find(x => x.idx === idx)!;
            r.status = p.status; r.message = p.message ?? null; r.code = p.code ?? null;
            if (p.resendEmailId) r.resendEmailId = p.resendEmailId;
            if (p.sentAt) r.sentAt = p.sentAt.getTime();
            if (p.nextAttemptAt) r.nextAttemptAt = p.nextAttemptAt.getTime();
        },
        async releaseRows(_id, idxs) {
            for (const r of state.rows) if (r.status === 'sending' && idxs.includes(r.idx)) { r.status = 'pending'; r.attempts = Math.max(0, r.attempts - 1); }
        },
        async countSentSince(_u, since) { return state.rows.filter(r => r.sentAt !== undefined && r.sentAt > since.getTime()).length; },
        async countRemaining(_id, now) {
            return {
                ready: state.rows.filter(r => r.status === 'pending' && r.nextAttemptAt <= now.getTime()).length,
                pending: state.rows.filter(r => r.status === 'pending').length,
                sending: state.rows.filter(r => r.status === 'sending').length,
            };
        },
        async finishCampaign(_id, status: CampaignStatus, lastError) {
            if (state.campaign.status === 'running') { state.campaign.status = status; state.campaign.lastError = lastError ?? null; }
        },
        async setLastError(_id, m) { state.campaign.lastError = m; },
    };
    return { store, state };
}

function makeCampaign(over: Partial<CampaignRecord> = {}): CampaignRecord {
    return {
        id: 'ecp_test000001', userId: 'u1', name: 'Test', status: 'running', subject: 'Hola {{ nombre }}',
        template: '<html><body><p>Hola {{ nombre }}</p></body></html>', senderConfig: {},
        options: { recipientColumn: 'email', autoescape: true, strictVariables: true, unsubscribeFooter: true, timezone: 'UTC' },
        total: 0, lockedUntil: null, lastError: null, startedAt: null, finishedAt: null, createdAt: new Date(), updatedAt: new Date(),
        ...over,
    };
}

function mkRows(emails: string[], extra: Record<string, string> = { nombre: 'Ana' }): MemRow[] {
    return emails.map((e, i) => ({
        idx: i, email: e, recipient: e.toLowerCase(), data: { email: e, ...extra }, status: 'pending', attempts: 0, nextAttemptAt: 0, updatedAt: 0,
    }));
}

function setup(opts: { emails?: string[]; campaign?: Partial<CampaignRecord>; send?: (p: ResendPayload, k: string) => Promise<SendOutcome>; suppressed?: string[]; getSuppressed?: () => Promise<Set<string>>; rows?: MemRow[] } = {}) {
    const clock = () => Date.now();
    const campaign = makeCampaign(opts.campaign);
    const { store, state } = memStore(campaign, opts.rows ?? mkRows(opts.emails ?? ['a@x.com', 'b@x.com', 'c@x.com']), clock);
    const sent: Array<{ payload: ResendPayload; key: string }> = [];
    const send = opts.send ?? (async (payload, key) => { sent.push({ payload, key }); return { ok: true, id: `re_${sent.length}` }; });
    const deps: WorkerDeps = {
        store,
        loadUser: async () => ({ id: 'u1', email: 'me@brand.com', name: 'Me', allowedEmails: new Set(['me@brand.com']) }),
        getSuppressed: opts.getSuppressed ?? (async () => new Set(opts.suppressed ?? [])),
        send: async (p, k) => { if (opts.send) sent.push({ payload: p, key: k }); return send(p, k); },
        unsubscribeUrl: (_u, r) => `https://app.test/unsub?r=${encodeURIComponent(r)}`,
        unsubscribeHeaders: (_u, r) => ({ 'List-Unsubscribe': `<https://app.test/unsub?r=${r}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }),
        sleep: async () => undefined,
        retry: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 2, random: () => 0.5 },
    };
    const limits = { sendIntervalMs: 0, budgetMs: 30_000 };
    return { deps, state, sent, run: (over: Partial<Parameters<typeof runCampaignTick>[2]> = {}) => runCampaignTick(deps, campaign.id, { ...limits, ...over }) };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('runCampaignTick', () => {
    it('envia todas las filas, guarda el id de Resend y cierra la campana', async () => {
        const t = setup();
        const r = await t.run();
        expect(r).toMatchObject({ ran: true, sent: 3, errors: 0, finished: 'done', reason: 'done' });
        expect(t.state.campaign.status).toBe('done');
        expect(t.state.rows.map(x => x.status)).toEqual(['sent', 'sent', 'sent']);
        expect(t.state.rows[0].resendEmailId).toBe('re_1');
        expect(t.state.locked).toBe(false);
    });

    it('anade cabeceras de baja, pie, version texto, tags e idempotency-key por (campana, destinatario)', async () => {
        const t = setup({ emails: ['A@X.com'] });
        const sentList: Array<{ p: ResendPayload; k: string }> = [];
        (t.deps as { send: WorkerDeps['send'] }).send = async (p, k) => { sentList.push({ p, k }); return { ok: true, id: 're_1' }; };
        await t.run();
        const { p, k } = sentList[0];
        expect(p.to).toEqual(['a@x.com']);
        expect(p.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
        expect(p.html).toContain('https://app.test/unsub');
        expect(p.text).toContain('Hola Ana');
        expect(p.tags).toContainEqual({ name: 'source', value: 'elixir' });
        expect(k).toBe(idempotencyKey('ecp_test000001', 'a@x.com'));
        expect(p.from).toContain('me@brand.com');
    });

    it('no envia a destinatarios dados de baja y los marca unsubscribed', async () => {
        const t = setup({ suppressed: ['b@x.com'] });
        const r = await t.run();
        expect(r.sent).toBe(2);
        expect(r.unsubscribed).toBe(1);
        expect(t.state.rows[1].status).toBe('unsubscribed');
        expect(t.sent.map(s => s.payload.to[0])).not.toContain('b@x.com');
    });

    it('si el render falla la fila queda en error y NUNCA se envia la plantilla cruda', async () => {
        const rows = mkRows(['a@x.com', 'b@x.com']);
        delete rows[1].data.nombre;
        const t = setup({ rows });
        const r = await t.run();
        expect(r.errors).toBe(1);
        expect(t.state.rows[1].status).toBe('error');
        expect(t.state.rows[1].code).toMatch(/^liquid_/);
        expect(t.sent).toHaveLength(1);
        expect(t.sent[0].payload.html).not.toContain('{{');
    });

    it('rechaza remitentes no autorizados por fila', async () => {
        const t = setup({ campaign: { senderConfig: { fromEmail: 'otro@evil.com' } } });
        const r = await t.run();
        expect(r.errors).toBe(3);
        expect(t.state.rows[0].code).toBe('unauthorized_sender');
        expect(t.sent).toHaveLength(0);
    });

    it('un 429 persistente aplaza la fila con backoff, libera el resto y no cuenta como error', async () => {
        const t = setup({ send: async () => ({ ok: false, message: 'Too many requests', statusCode: 429, name: 'rate_limit_exceeded' }) });
        const before = Date.now();
        const r = await t.run();
        expect(r).toMatchObject({ reason: 'rate_limited', deferred: 1, errors: 0, sent: 0 });
        expect(r.retryAfterMs).toBeGreaterThanOrEqual(30_000);
        expect(t.state.rows[0]).toMatchObject({ status: 'pending', code: 'deferred' });
        expect(t.state.rows[0].nextAttemptAt).toBeGreaterThan(before + 20_000);
        // el resto vuelve a pending sin gastar un intento
        expect(t.state.rows[1]).toMatchObject({ status: 'pending', attempts: 0 });
        expect(t.state.campaign.status).toBe('running');
        // un segundo tick inmediato no reintenta la fila aplazada (aun no toca), pero si las demas
        const sends = vi.fn(async () => ({ ok: true as const, id: 're_x' }));
        (t.deps as { send: WorkerDeps['send'] }).send = sends;
        const r2 = await t.run();
        expect(sends).toHaveBeenCalledTimes(2);
        expect(r2.sent).toBe(2);
        expect(t.state.campaign.status).toBe('running'); // queda la aplazada
    });

    it('tras MAX_ROW_ATTEMPTS intentos la fila pasa a error', async () => {
        const rows = mkRows(['a@x.com']);
        rows[0].attempts = 5; // el claim la deja en 6
        const t = setup({ rows, send: async () => ({ ok: false, message: 'boom', statusCode: 503 }) });
        const r = await t.run();
        expect(r.errors).toBe(1);
        expect(t.state.rows[0]).toMatchObject({ status: 'error', code: 'max_attempts' });
        expect(t.state.campaign.status).toBe('done');
    });

    it('un error definitivo (4xx) marca error sin reintentar', async () => {
        const send = vi.fn(async () => ({ ok: false as const, message: 'invalid to', statusCode: 422 }));
        const t = setup({ emails: ['a@x.com'], send });
        await t.run();
        expect(send).toHaveBeenCalledTimes(1);
        expect(t.state.rows[0]).toMatchObject({ status: 'error', code: 'send_failed', message: 'invalid to' });
    });

    it('cancelar a mitad de lote detiene el envio y deja el resto pendiente (reanudable)', async () => {
        const t = setup({ emails: ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com'] });
        let n = 0;
        (t.deps as { send: WorkerDeps['send'] }).send = async () => { n++; if (n === 1) t.state.campaign.status = 'cancelled'; return { ok: true, id: `re_${n}` }; };
        const r = await t.run();
        expect(r.sent).toBe(1);
        expect(r.reason).toBe('paused_or_cancelled');
        expect(t.state.rows.map(x => x.status)).toEqual(['sent', 'pending', 'pending', 'pending']);
        expect(t.state.rows.slice(1).every(x => x.attempts === 0)).toBe(true);
        // Reanudar: vuelve a running y solo se envian las pendientes (no se duplica la primera)
        t.state.campaign.status = 'running';
        const sends = vi.fn(async () => ({ ok: true as const, id: 're_z' }));
        (t.deps as { send: WorkerDeps['send'] }).send = sends;
        const r2 = await t.run();
        expect(sends).toHaveBeenCalledTimes(3);
        expect(r2.finished).toBe('done');
    });

    it('respeta la cuota horaria persistente', async () => {
        const t = setup({ emails: ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com'] });
        const r = await t.run({ maxPerHour: 2 });
        expect(r.sent).toBe(2);
        expect(r.reason).toBe('quota');
        expect(t.state.campaign.status).toBe('running');
        // mismo tick con cuota agotada por filas previas
        const r2 = await t.run({ maxPerHour: 2 });
        expect(r2.sent).toBe(0);
        expect(r2.reason).toBe('quota');
    });

    it('no ejecuta dos workers a la vez sobre la misma campana', async () => {
        const t = setup();
        t.state.locked = true;
        const r = await t.run();
        expect(r).toMatchObject({ ran: false, reason: 'not_running_or_locked' });
        expect(t.state.rows.every(x => x.status === 'pending')).toBe(true);
    });

    it('no procesa campanas pausadas o canceladas', async () => {
        const t = setup({ campaign: { status: 'paused' } });
        expect((await t.run()).ran).toBe(false);
    });

    it('si la lista de bajas no se puede consultar, no envia nada (fallo cerrado)', async () => {
        const t = setup({ getSuppressed: async () => { throw new Error('db down'); } });
        const r = await t.run();
        expect(r).toMatchObject({ reason: 'suppression_unavailable', sent: 0 });
        expect(t.sent).toHaveLength(0);
        expect(t.state.rows.every(x => x.status === 'pending')).toBe(true);
        expect(t.state.locked).toBe(false);
    });

    it('un error de plantilla marca la campana como failed sin enviar', async () => {
        const t = setup({ campaign: { template: '{% if %}<p>x</p>' } });
        const r = await t.run();
        expect(r).toMatchObject({ reason: 'template_error', finished: 'failed' });
        expect(t.state.campaign.status).toBe('failed');
        expect(t.state.campaign.lastError).toBeTruthy();
    });

    it('recupera filas `sending` abandonadas por un worker caido', async () => {
        const rows = mkRows(['a@x.com']);
        rows[0].status = 'sending'; rows[0].updatedAt = Date.now() - 10 * 60_000;
        const t = setup({ rows });
        const r = await t.run();
        expect(r.sent).toBe(1);
        expect(t.state.rows[0].status).toBe('sent');
    });

    it('un tick sin filas listas (todas aplazadas) no cierra la campana', async () => {
        const rows = mkRows(['a@x.com']);
        rows[0].nextAttemptAt = Date.now() + 3_600_000;
        const t = setup({ rows });
        const r = await t.run();
        expect(r.processed).toBe(0);
        expect(r.finished).toBeUndefined();
        expect(t.state.campaign.status).toBe('running');
    });
});

describe('buildRowPayload / compileCampaign', () => {
    it('compileCampaign indica el campo con error', () => {
        expect(() => compileCampaign({ subject: 'ok', template: '{% for %}', senderConfig: {} })).toThrow(/template|for/i);
        expect(() => compileCampaign({ subject: '', template: 'x', senderConfig: {} })).toThrow(/asunto/i);
    });

    it('autoescape evita inyectar HTML desde los datos', () => {
        const c = makeCampaign({ template: '<p>{{ nombre }}</p>' });
        const built = buildRowPayload({
            campaign: c, compiled: compileCampaign(c), user: { id: 'u1', email: 'me@brand.com', name: 'Me', allowedEmails: new Set(['me@brand.com']) },
            suppressed: new Set(), dateVars: {}, timezone: 'UTC', now: new Date(), unsubscribeUrl: () => null, unsubscribeHeaders: () => null,
        }, 'a@x.com', { nombre: '<img src=x onerror=alert(1)>' });
        expect(built.ok).toBe(true);
        if (built.ok) expect(built.payload.html).not.toContain('<img');
    });

    it('la plantilla con {{ unsubscribe_url }} no recibe pie duplicado', () => {
        const c = makeCampaign({ template: '<p><a href="{{ unsubscribe_url }}">baja</a></p>' });
        const built = buildRowPayload({
            campaign: c, compiled: compileCampaign(c), user: { id: 'u1', email: 'me@brand.com', name: null, allowedEmails: new Set(['me@brand.com']) },
            suppressed: new Set(), dateVars: {}, timezone: 'UTC', now: new Date(), unsubscribeUrl: () => 'https://u.test/x', unsubscribeHeaders: () => null,
        }, 'a@x.com', { nombre: 'Ana' });
        expect(built.ok && built.payload.html.match(/https:\/\/u\.test\/x/g)?.length).toBe(1);
    });
});
