/**
 * handlers.ts - logica de las rutas de importar/exportar (independiente de Next: recibe un HCtx).
 * Las devoluciones son objetos JSON o Response; los errores son HttpError (400/403/404/409/429/503...).
 */
import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { HttpError, badRequest, conflict, json, notFound } from '@/lib/admin/http';
import { num, query } from '@/lib/admin/sql';
import { createUserAccount } from '@/lib/admin/user-create';
import { encrypt } from '@/lib/encryption';
import { getMfaStatus, isAdminEmail, MfaStoreUnavailableError, verifyMfa } from '@/lib/mfa';
import { prisma } from '@/lib/prisma';
import { validateNewPassword } from '@/lib/security';
import { NextResponse } from 'next/server';
import { REAUTH_COOKIE, REAUTH_TTL_MS, buildDownloadUrl, issueReauthToken, verifyDownload } from './auth';
import { EMAIL_SHAPE, allowedDomains, findUsersByEmail, isInstanceAddress, mailboxStatuses } from './mailboxes';
import { CHUNK_SIZE, chunkName, ChunkedSource } from './source';
import { UPLOAD_CHUNK_BYTES, jobPrefix } from './limits';
import { items as itemStore, jobs, jobToPublic, MailTransferTablesMissingError, type JobRow } from './store';
import { newEncryptionParams } from './package-crypto';
import { purgeJobStorage } from './import-engine';
import { readZipDirectory, verifyZipPassword } from './zip';
import { runTick } from './runtime';
import { reportStream } from './report';
import { adminOnly, assertJobAccess, audit, hasRecentAuth, limit, owner, readJson, requireDomainConfirmation, requireRecent, type HCtx } from './http';
import type { ExportOptions } from './export-engine';
import type { ImportOptions } from './import-engine';

const NO_STORE = { 'Cache-Control': 'no-store' };

async function getJobOr404(c: HCtx, id: string): Promise<JobRow> {
    if (!/^mtj_[a-f0-9]{32}$/.test(id)) throw notFound();
    return assertJobAccess(c, await jobs.getOwned(id, owner(c)));
}

async function capActive(c: HCtx): Promise<void> {
    if ((await jobs.countActive(c.domain)) >= c.limits.maxConcurrentJobs) throw new HttpError(429, 'too_many_active_jobs');
}

const safeFileName = (n: string) => {
    // eslint-disable-next-line no-control-regex
    const base = n.replace(/[\u0000-\u001f\u007f]/g, '').split(/[\\/]/).pop()!.trim().slice(0, 180);
    return base || 'archivo';
};

// ---------------------------------------------------------------------------------------------------------------------
// Configuracion / re-autenticacion
// ---------------------------------------------------------------------------------------------------------------------

export async function getConfig(c: HCtx) {
    let mfaEnrolled = false;
    if (c.actor.localUserId) {
        try { mfaEnrolled = (await getMfaStatus(c.actor.localUserId)).enabled; } catch (e) { if (!(e instanceof MfaStoreUnavailableError)) throw e; }
    }
    const recent = hasRecentAuth(c);
    return {
        mode: c.actor.mode,
        domain: c.domain,
        allowedDomains: allowedDomains(),
        selfEmail: c.actor.selfEmail,
        chunkBytes: UPLOAD_CHUNK_BYTES,
        limits: {
            maxUploadBytes: c.limits.maxUploadBytes,
            maxMessageBytes: c.limits.maxMessageBytes,
            maxAttachmentsPerMessage: c.limits.maxAttachmentsPerMessage,
            maxPstBytes: c.limits.maxPstBytes,
            exportTtlHours: c.limits.exportTtlHours,
            maxCreatePerCall: c.limits.maxCreatePerCall,
        },
        formats: { import: ['mbox', 'eml', 'zip', 'gzip', 'tar', 'pst'], export: ['mbox', 'eml'] },
        reauth: { recent: recent.ok, method: recent.method ?? null, expiresAt: recent.expiresAt ?? null, mfaEnrolled, canUsePassword: c.actor.kind === 'manager' || !!c.actor.localUserId, windowSeconds: REAUTH_TTL_MS / 1000 },
    };
}

const reauthSchema = z.object({ password: z.string().max(1024).optional(), code: z.string().max(32).optional(), recoveryCode: z.string().max(64).optional() });

function backendBase(): string {
    return (process.env.NEXT_PUBLIC_BACKEND_URL || 'https://backend.bloomx.arubik.dev').replace(/\/+$/, '');
}

export async function postReauth(c: HCtx): Promise<Response> {
    await limit(c, 'reauth', 6, 5 * 60_000);
    const body = await readJson(c, reauthSchema);
    let ok = false;
    let method: 'password' | 'mfa' = 'password';
    if (c.actor.kind === 'manager') {
        if (!body.password || !c.actor.email) throw new HttpError(400, 'password_required');
        try {
            const res = await fetch(`${backendBase()}/api/auth/login`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: c.actor.email, password: body.password }),
                signal: AbortSignal.timeout(6000), cache: 'no-store',
            });
            ok = res.ok;
            if (res.status >= 500) throw new HttpError(502, 'backend_unavailable');
        } catch (e) {
            if (e instanceof HttpError) throw e;
            throw new HttpError(502, 'backend_unavailable');
        }
    } else {
        const userId = c.actor.localUserId;
        if (!userId) throw new HttpError(403, 'forbidden');
        if (body.code || body.recoveryCode) {
            let enrolled = false;
            try { enrolled = (await getMfaStatus(userId)).enabled; } catch (e) { if (!(e instanceof MfaStoreUnavailableError)) throw e; }
            if (!enrolled) throw new HttpError(400, 'mfa_not_enrolled');
            const r = await verifyMfa(userId, { code: body.code, recoveryCode: body.recoveryCode });
            ok = r.ok;
            method = 'mfa';
        } else if (body.password) {
            const u = await prisma.user.findUnique({ where: { id: userId }, select: { password: true } });
            // Cuentas solo-Google no tienen contrasena util: bcrypt.compare simplemente falla
            ok = !!u && (await bcrypt.compare(body.password, u.password).catch(() => false));
        } else {
            throw new HttpError(400, 'password_or_code_required');
        }
    }
    if (!ok) {
        audit(c, 'reauth_failed', { method });
        throw new HttpError(401, 'invalid_credentials');
    }
    const { token, expiresAt } = issueReauthToken(c.actor.key, method, c.actor.sessionId);
    audit(c, 'reauth', { method });
    const res = NextResponse.json({ ok: true, method, expiresAt }, { headers: NO_STORE });
    res.cookies.set(REAUTH_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/api', maxAge: Math.floor(REAUTH_TTL_MS / 1000) });
    return res;
}

// ---------------------------------------------------------------------------------------------------------------------
// Trabajos
// ---------------------------------------------------------------------------------------------------------------------

export async function listJobs(c: HCtx) {
    await limit(c, 'jobs.list', 120);
    const sp = new URL(c.req.url).searchParams;
    const page = Math.max(1, Math.min(1000, Number.parseInt(sp.get('page') ?? '1', 10) || 1));
    const pageSize = Math.max(1, Math.min(50, Number.parseInt(sp.get('pageSize') ?? '20', 10) || 20));
    const kind = sp.get('kind');
    const r = await jobs.listOwned(owner(c), {
        limit: pageSize, offset: (page - 1) * pageSize,
        kind: kind === 'import' || kind === 'export' ? kind : undefined,
        scope: c.actor.mode === 'self' ? 'self' : undefined,
    });
    const rows = c.actor.mode === 'self' ? r.rows : r.rows.filter((j) => j.scope !== 'self');
    return { jobs: rows.map(jobToPublic), page: { page, pageSize, total: r.total, pages: Math.max(1, Math.ceil(r.total / pageSize)) } };
}

export async function getJob(c: HCtx, id: string) {
    await limit(c, 'jobs.get', 240);
    const job = await getJobOr404(c, id);
    const errors = job.errorItems > 0 ? await itemStore.errors(job.id, 20) : [];
    return { job: jobToPublic(job), errors };
}

export async function deleteJob(c: HCtx, id: string) {
    await limit(c, 'jobs.delete', 30);
    const job = await getJobOr404(c, id);
    if (!['done', 'failed', 'canceled', 'expired'].includes(job.status)) throw conflict('job_active');
    await purgeJobStorage(job.id, c.deps());
    await jobs.remove(job.id);
    audit(c, 'deleted', { jobId: job.id, kind: job.kind });
    return { ok: true };
}

const cancelable = ['created', 'uploading', 'uploaded', 'ready'];

export async function cancelJob(c: HCtx, id: string) {
    await limit(c, 'jobs.cancel', 30);
    const job = await getJobOr404(c, id);
    if (['done', 'failed', 'canceled', 'expired'].includes(job.status)) return { job: jobToPublic(job) };
    if (cancelable.includes(job.status)) {
        await jobs.update(job.id, { status: 'canceled', finishedAt: new Date(), phase: '' });
        await purgeJobStorage(job.id, c.deps());
    } else {
        await jobs.requestCancel(job.id);
        c.kick(job.id);
    }
    audit(c, 'cancel_requested', { jobId: job.id, kind: job.kind, status: job.status });
    return { job: jobToPublic((await jobs.get(job.id))!) };
}

const FATAL = new Set(['zip_wrong_password', 'zip_auth_failed', 'zip_password_required', 'unsupported_format', 'zip_invalid', 'zip_bomb', 'zip_bomb_total', 'zip_too_many_entries', 'encrypted_package', 'unsupported_msg', 'pst_too_large', 'pst_unreadable', 'gzip_bomb', 'gzip_corrupt', 'zip_corrupt']);

export async function resumeJob(c: HCtx, id: string) {
    await limit(c, 'jobs.resume', 30);
    const job = await getJobOr404(c, id);
    if (job.status === 'failed') {
        if (FATAL.has(job.lastError ?? '')) throw conflict('not_resumable');
        const wasImporting = job.kind === 'import' && !!job.cursor.import && job.summary && Object.keys(job.summary).length > 0;
        await jobs.update(job.id, { status: job.kind === 'import' ? (wasImporting ? 'queued' : 'analyzing') : 'queued', lastError: null, finishedAt: null, cancelRequested: false });
        audit(c, 'resumed', { jobId: job.id, kind: job.kind });
    } else if (!['queued', 'running', 'analyzing'].includes(job.status)) {
        throw conflict('not_resumable');
    }
    c.kick(job.id);
    return { job: jobToPublic((await jobs.get(job.id))!) };
}

/** Empuje desde el navegador: ejecuta un tick en esta peticion (si el trabajo esta atascado o sin worker). */
export async function tickJob(c: HCtx, id: string) {
    await limit(c, 'jobs.tick', 40);
    const job = await getJobOr404(c, id);
    if (!['analyzing', 'queued', 'running'].includes(job.status)) return { job: jobToPublic(job), tick: { ran: false, more: false } };
    const t = await runTick(job.id, c.deps());
    if (t.more) c.kick(job.id);
    return { job: jobToPublic((await jobs.get(job.id))!), tick: { ran: t.ran, more: t.more, reason: t.reason ?? null } };
}

export async function getReport(c: HCtx, id: string): Promise<Response> {
    await limit(c, 'jobs.report', 20);
    const job = await getJobOr404(c, id);
    const lang = new URL(c.req.url).searchParams.get('lang') === 'en' ? 'en' : 'es';
    audit(c, 'report_downloaded', { jobId: job.id, kind: job.kind });
    return new Response(reportStream(job.id, lang), {
        status: 200,
        headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="bloomx-${job.kind}-${job.id.slice(4, 12)}-report.csv"`,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
        },
    });
}

// ---------------------------------------------------------------------------------------------------------------------
// Importar: subida por trozos
// ---------------------------------------------------------------------------------------------------------------------

const createImportSchema = z.object({ fileName: z.string().trim().min(1).max(300), size: z.number().int().positive() });

export async function createImport(c: HCtx) {
    await limit(c, 'import.create', 20);
    const body = await readJson(c, createImportSchema);
    if (c.actor.mode === 'admin') requireRecent(c);
    if (body.size > c.limits.maxUploadBytes) throw new HttpError(413, 'file_too_large');
    await capActive(c);
    const options: ImportOptions = c.actor.mode === 'self' ? { selfEmail: c.actor.selfEmail ?? undefined, targetMode: 'single', singleMailbox: c.actor.selfEmail ?? undefined } : {};
    const job = await jobs.create({
        userId: c.actor.key, actorKind: c.actor.kind, domain: c.domain, kind: 'import', scope: c.actor.mode === 'self' ? 'self' : 'domain',
        targetUserId: c.actor.selfUserId, status: 'uploading', fileName: safeFileName(body.fileName), totalBytes: body.size, options: options as Record<string, unknown>,
    });
    const totalChunks = Math.ceil(body.size / UPLOAD_CHUNK_BYTES);
    audit(c, 'import_created', { jobId: job!.id, bytes: body.size, scope: job!.scope });
    return { job: jobToPublic(job!), chunkBytes: UPLOAD_CHUNK_BYTES, totalChunks };
}

export async function putChunk(c: HCtx, id: string, indexRaw: string): Promise<Response | Record<string, unknown>> {
    await limit(c, 'import.chunk', 900);
    const job = await getJobOr404(c, id);
    if (job.status !== 'uploading' || job.kind !== 'import') throw conflict('not_uploading');
    const index = Number.parseInt(indexRaw, 10);
    const totalChunks = Math.ceil(job.totalBytes / UPLOAD_CHUNK_BYTES);
    if (!Number.isInteger(index) || index < 0 || index >= totalChunks || String(index) !== indexRaw) throw badRequest('bad_chunk_index');
    const expected = Math.min(UPLOAD_CHUNK_BYTES, job.totalBytes - index * UPLOAD_CHUNK_BYTES);
    const declared = Number(c.req.headers.get('content-length') ?? '0');
    if (declared > expected) throw new HttpError(413, 'chunk_too_large');
    const claimedHash = (c.req.headers.get('x-chunk-sha256') ?? '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(claimedHash)) throw badRequest('chunk_hash_required');
    const buf = Buffer.from(await c.req.arrayBuffer());
    if (buf.length !== expected) throw badRequest('bad_chunk_size');
    const actual = createHash('sha256').update(buf).digest('hex');
    if (actual !== claimedHash) throw new HttpError(422, 'chunk_hash_mismatch');
    const deps = c.deps();
    const prefix = jobPrefix(job.id);
    await deps.storage.put(`${prefix}/src/${chunkName(index)}`, buf);
    await deps.storage.put(`${prefix}/srcsha/${chunkName(index)}`, Buffer.from(actual));
    return { ok: true, index, sha256: actual };
}

export async function getChunks(c: HCtx, id: string) {
    await limit(c, 'import.chunks', 120);
    const job = await getJobOr404(c, id);
    const deps = c.deps();
    const objs = await deps.storage.list(`${jobPrefix(job.id)}/src/`);
    const totalChunks = Math.ceil(job.totalBytes / UPLOAD_CHUNK_BYTES);
    const received: number[] = [];
    for (const o of objs) {
        const i = Number.parseInt(o.key.split('/').pop() ?? '', 10);
        if (!Number.isInteger(i) || i >= totalChunks) continue;
        const expected = Math.min(UPLOAD_CHUNK_BYTES, job.totalBytes - i * UPLOAD_CHUNK_BYTES);
        if (o.size === expected) received.push(i);
    }
    received.sort((a, b) => a - b);
    return { received, totalChunks, chunkBytes: UPLOAD_CHUNK_BYTES, status: job.status };
}

export async function completeUpload(c: HCtx, id: string) {
    await limit(c, 'import.complete', 20);
    const job = await getJobOr404(c, id);
    if (job.kind !== 'import') throw conflict('not_import');
    if (job.status !== 'uploading') throw conflict('not_uploading');
    const chunks = await getChunks(c, id);
    if (chunks.received.length !== chunks.totalChunks) throw new HttpError(409, 'upload_incomplete', String(chunks.totalChunks - chunks.received.length));
    // Verificacion final: los digests por trozo (verificados al subir) se combinan en un digest del archivo
    const deps = c.deps();
    const hashes: string[] = new Array(chunks.totalChunks);
    for (let i = 0; i < chunks.totalChunks; i += 50) {
        await Promise.all(Array.from({ length: Math.min(50, chunks.totalChunks - i) }, async (_, k) => {
            const b = await deps.storage.get(`${jobPrefix(job.id)}/srcsha/${chunkName(i + k)}`);
            if (!b || !/^[a-f0-9]{64}$/.test(b.toString())) throw new HttpError(409, 'upload_incomplete');
            hashes[i + k] = b.toString();
        }));
    }
    const chunkDigest = createHash('sha256').update(hashes.join('')).digest('hex');
    await jobs.update(job.id, { status: 'analyzing', phase: 'queued', uploadedBytes: job.totalBytes, summary: { chunkDigest }, cursor: {}, startedAt: new Date() });
    audit(c, 'upload_completed', { jobId: job.id, bytes: job.totalBytes, chunks: chunks.totalChunks, digest: chunkDigest });
    c.kick(job.id);
    return { job: jobToPublic((await jobs.get(job.id))!) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Importar: vista previa, buzones faltantes, confirmacion
// ---------------------------------------------------------------------------------------------------------------------

export async function getPreview(c: HCtx, id: string) {
    await limit(c, 'import.preview', 60);
    const job = await getJobOr404(c, id);
    if (job.kind !== 'import') throw conflict('not_import');
    const s = job.summary as any;
    const list: Array<{ address: string; count: number }> = Array.isArray(s.mailboxes) ? s.mailboxes : [];
    const statuses = await mailboxStatuses(list.map((m) => m.address));
    return {
        job: jobToPublic(job),
        summary: { ...s, mailboxes: undefined },
        mailboxes: list.map((m) => ({ address: m.address, count: m.count, status: statuses.get(m.address) ?? 'foreign_domain' })),
        unknown: Number(s.unknownMailbox ?? 0),
        domain: c.domain,
        allowedDomains: allowedDomains(),
        selfEmail: c.actor.selfEmail,
        canCreate: c.actor.mode === 'admin',
        minPasswordLength: 12,
    };
}

const createMailboxesSchema = z.object({
    addresses: z.array(z.string().trim().toLowerCase().max(254)).min(1).max(200),
    passwordMode: z.enum(['generic', 'random']),
    genericPassword: z.string().max(200).optional(),
    mustChange: z.boolean().default(true),
    confirmDomain: z.string().max(253),
});

export async function createMailboxes(c: HCtx, id: string) {
    adminOnly(c);
    await limit(c, 'import.mailboxes', 12);
    const job = await getJobOr404(c, id);
    if (job.kind !== 'import' || job.status !== 'ready') throw conflict('not_ready');
    requireRecent(c);
    const body = await readJson(c, createMailboxesSchema);
    requireDomainConfirmation(c, body.confirmDomain);
    const unique = Array.from(new Set(body.addresses));
    if (unique.length > c.limits.maxCreatePerCall) throw new HttpError(400, 'too_many_to_create', String(c.limits.maxCreatePerCall));
    if (body.passwordMode === 'generic' && !body.genericPassword) throw badRequest('generic_password_required');
    const domains = allowedDomains();
    const invalid = unique.filter((a) => !EMAIL_SHAPE.test(a) || !isInstanceAddress(a, domains));
    if (invalid.length) throw new HttpError(400, 'invalid_addresses', invalid.slice(0, 5).join(', '));
    if (body.passwordMode === 'generic') {
        for (const a of unique) {
            const weak = validateNewPassword(body.genericPassword, a);
            if (weak) throw badRequest('weak_password', weak);
        }
    }
    const existing = await findUsersByEmail(unique);
    const created: Array<{ email: string; password: string; mustChange: boolean }> = [];
    const already: string[] = [];
    const failed: Array<{ email: string; code: string }> = [];
    for (const email of unique) {
        if (existing.has(email)) { already.push(email); continue; }
        try {
            const r = await createUserAccount({
                email, password: body.passwordMode === 'generic' ? body.genericPassword : undefined, mustChangePassword: body.mustChange,
            });
            created.push({ email: r.user.email, password: body.passwordMode === 'generic' ? body.genericPassword! : r.temporaryPassword!, mustChange: r.mustChangePassword });
        } catch (e) {
            if (e instanceof HttpError && e.code === 'user_exists') already.push(email);
            else failed.push({ email, code: e instanceof HttpError ? e.code : 'internal' });
        }
    }
    // Auditoria sin contrasenas ni direcciones completas (el logger enmascara "email")
    audit(c, 'mailboxes_created', { jobId: job.id, created: created.length, existing: already.length, failed: failed.length, credentialMode: body.passwordMode, mustChange: body.mustChange });
    return json({ created, existing: already, failed }, { status: 201, headers: NO_STORE });
}

const zipPasswordSchema = z.object({ password: z.string().min(1).max(512).optional(), skipEncrypted: z.boolean().optional() });

/**
 * ZIP con entradas cifradas: el asistente pide la contrasena. Se comprueba contra la entrada cifrada mas pequena y se guarda CIFRADA
 * con la clave de la instancia SOLO en las opciones del trabajo hasta que se terminan de expandir las entradas cifradas (fase de
 * extraccion, en segundo plano y por varias invocaciones); despues se borra. Nunca se registra, audita ni se devuelve.
 */
export async function postZipPassword(c: HCtx, id: string) {
    await limit(c, 'import.zippw', 10, 5 * 60_000);
    const job = await getJobOr404(c, id);
    if (job.kind !== 'import' || job.status !== 'uploaded' || !(job.summary as any)?.passwordRequired) throw conflict('not_ready');
    if (c.actor.mode === 'admin') requireRecent(c);
    const body = await readJson(c, zipPasswordSchema);
    let options: Record<string, any> = { ...job.options };
    if (body.skipEncrypted) {
        options = { ...options, zipSkipEncrypted: true };
        delete options.zipPw;
    } else {
        if (!body.password) throw badRequest('password_required');
        const src = new ChunkedSource(c.deps().storage, `${jobPrefix(job.id)}/src`, job.totalBytes);
        const dir = await readZipDirectory(src, { maxTotalBytes: c.limits.maxExpandedBytes }, { allowEncrypted: true });
        const verdict = await verifyZipPassword(src, dir, body.password);
        if (verdict === 'wrong_password') {
            audit(c, 'zip_password_rejected', { jobId: job.id });
            throw new HttpError(422, 'wrong_password');
        }
        options = { ...options, zipPw: encrypt(body.password) };
        delete options.zipSkipEncrypted;
    }
    await jobs.update(job.id, { status: 'analyzing', phase: 'queued', options, summary: { chunkDigest: (job.summary as any).chunkDigest ?? null }, lastError: null });
    audit(c, 'zip_password_accepted', { jobId: job.id, skipped: !!body.skipEncrypted });
    c.kick(job.id);
    return { job: jobToPublic((await jobs.get(job.id))!) };
}

const confirmSchema = z.object({
    confirmDomain: z.string().max(253).optional(),
    targetMode: z.enum(['auto', 'single']).default('auto'),
    singleMailbox: z.string().trim().toLowerCase().max(254).optional(),
    mailboxMap: z.record(z.string().max(254), z.string().trim().toLowerCase().max(254).nullable()).optional(),
    notifyUsers: z.boolean().default(false),
});

export async function confirmImport(c: HCtx, id: string) {
    await limit(c, 'import.confirm', 10);
    const job = await getJobOr404(c, id);
    if (job.kind !== 'import' || job.status !== 'ready') throw conflict('not_ready');
    const body = await readJson(c, confirmSchema);
    if (c.actor.mode === 'admin') {
        requireRecent(c);
        requireDomainConfirmation(c, body.confirmDomain);
    }
    await capActive(c);
    const s = job.summary as any;
    let options: ImportOptions;
    if (c.actor.mode === 'self') {
        options = { selfEmail: c.actor.selfEmail!, targetMode: 'single', singleMailbox: c.actor.selfEmail! };
    } else {
        options = { targetMode: body.targetMode, singleMailbox: body.singleMailbox, mailboxMap: body.mailboxMap ?? {}, notifyUsers: body.notifyUsers };
        if (body.targetMode === 'single' && !body.singleMailbox) throw badRequest('single_mailbox_required');
    }
    // Todos los destinos deben existir (los faltantes se crean antes con /mailboxes)
    const targets = new Set<string>();
    if (options.singleMailbox && options.targetMode === 'single') targets.add(options.singleMailbox.toLowerCase());
    for (const v of Object.values(options.mailboxMap ?? {})) if (v) targets.add(v.toLowerCase());
    for (const t of targets) if (!EMAIL_SHAPE.test(t)) throw new HttpError(400, 'invalid_addresses', t);
    const users = await findUsersByEmail([...targets]);
    const missing = [...targets].filter((t) => !users.has(t));
    if (missing.length) throw new HttpError(409, 'mailboxes_missing', missing.slice(0, 20).join(', '));
    // Direcciones detectadas que quedarian sin destino (se informara; se omiten con motivo en el informe)
    const detected: Array<{ address: string; count: number }> = Array.isArray(s.mailboxes) ? s.mailboxes : [];
    const existingDetected = options.targetMode === 'auto' ? await findUsersByEmail(detected.map((d) => d.address)) : new Map();
    let unmapped = 0;
    if (options.targetMode === 'auto') {
        for (const d of detected) {
            const mapped = Object.prototype.hasOwnProperty.call(options.mailboxMap ?? {}, d.address) ? (options.mailboxMap ?? {})[d.address] : existingDetected.has(d.address) ? d.address : null;
            if (!mapped) unmapped += d.count;
        }
        const unk = Number(s.unknownMailbox ?? 0);
        const mappedUnknown = Object.prototype.hasOwnProperty.call(options.mailboxMap ?? {}, '') && (options.mailboxMap ?? {})[''];
        if (unk > 0 && !mappedUnknown) unmapped += unk;
    }
    await jobs.update(job.id, { status: 'queued', options: { ...options, confirmedAt: new Date().toISOString() }, phase: 'import', lastError: null });
    audit(c, 'import_confirmed', {
        jobId: job.id, scope: job.scope, messages: Number(s.messages ?? 0), mailboxes: targets.size || detected.length, bytes: job.totalBytes, targetMode: options.targetMode, unmapped,
    });
    c.kick(job.id);
    return { job: jobToPublic((await jobs.get(job.id))!), unmapped };
}

// ---------------------------------------------------------------------------------------------------------------------
// Exportar
// ---------------------------------------------------------------------------------------------------------------------

const createExportSchema = z.object({
    scopeMode: z.enum(['domain', 'selected', 'one']).default('domain'),
    mailboxes: z.array(z.string().trim().toLowerCase().max(254)).max(5000).optional(),
    folders: z.array(z.enum(['inbox', 'sent', 'archive', 'spam', 'trash', 'scheduled', 'snoozed', 'drafts'])).max(10).default([]),
    from: z.string().datetime().nullable().optional(),
    to: z.string().datetime().nullable().optional(),
    includeAttachments: z.boolean().default(true),
    format: z.enum(['mbox', 'eml']).default('mbox'),
    password: z.string().max(200).optional(),
    oneTime: z.boolean().default(true),
    notifyUsers: z.boolean().default(false),
    confirmDomain: z.string().max(253).optional(),
});

export async function createExport(c: HCtx) {
    await limit(c, 'export.create', 6);
    const body = await readJson(c, createExportSchema);
    requireRecent(c);
    if (c.actor.mode === 'admin') requireDomainConfirmation(c, body.confirmDomain);
    await capActive(c);
    if (body.from && body.to && new Date(body.from) > new Date(body.to)) throw badRequest('invalid_range');

    let mailboxes: string[];
    if (c.actor.mode === 'self') {
        mailboxes = [c.actor.selfEmail!];
    } else if (body.scopeMode === 'domain') {
        const domains = allowedDomains();
        const rows = await query<{ email: string }>(
            `SELECT lower("email") AS email FROM "User" WHERE lower(split_part("email", '@', 2)) = ANY($1::text[]) ORDER BY 1 LIMIT $2`, domains, c.limits.maxMailboxesPerExport + 1);
        if (rows.length > c.limits.maxMailboxesPerExport) throw new HttpError(400, 'too_many_mailboxes', String(c.limits.maxMailboxesPerExport));
        mailboxes = rows.map((r) => r.email);
    } else {
        const list = Array.from(new Set((body.mailboxes ?? []).filter(Boolean)));
        if (list.length === 0) throw badRequest('mailboxes_required');
        if (body.scopeMode === 'one' && list.length !== 1) throw badRequest('one_mailbox_only');
        if (list.length > c.limits.maxMailboxesPerExport) throw new HttpError(400, 'too_many_mailboxes');
        const found = await findUsersByEmail(list);
        const missing = list.filter((m) => !found.has(m));
        if (missing.length) throw new HttpError(404, 'mailboxes_not_found', missing.slice(0, 10).join(', '));
        mailboxes = list;
    }
    if (mailboxes.length === 0) throw badRequest('mailboxes_required');

    let enc: ExportOptions['enc'];
    if (body.password) {
        if (body.password.length < 12) throw badRequest('weak_password', 'Password must be at least 12 characters');
        const p = newEncryptionParams(body.password);
        enc = { salt: p.salt.toString('hex'), noncePrefix: p.noncePrefix.toString('hex'), keyEnc: encrypt(p.key.toString('hex')) };
    }

    const options: ExportOptions = {
        scopeMode: c.actor.mode === 'self' ? 'self' : body.scopeMode, mailboxes, folders: body.folders, from: body.from ?? null, to: body.to ?? null,
        includeAttachments: body.includeAttachments, format: body.format, encrypted: !!enc, enc, oneTime: body.oneTime, notifyUsers: body.notifyUsers,
    };
    // Estimacion para la barra de progreso
    const idRows = await query<{ id: string }>(`SELECT "id" FROM "User" WHERE lower("email") = ANY($1::text[])`, mailboxes);
    const total = await prisma.email.count({
        where: {
            userId: { in: idRows.map((r) => r.id) },
            ...(body.folders.length ? { folder: { in: body.folders } } : {}),
            ...(body.from || body.to ? { createdAt: { ...(body.from ? { gte: new Date(body.from) } : {}), ...(body.to ? { lte: new Date(body.to) } : {}) } } : {}),
        },
    });
    const job = await jobs.create({
        userId: c.actor.key, actorKind: c.actor.kind, domain: c.domain, kind: 'export', scope: c.actor.mode === 'self' ? 'self' : body.scopeMode === 'domain' ? 'domain' : 'mailboxes',
        targetUserId: c.actor.selfUserId, format: body.format, status: 'queued', options: options as unknown as Record<string, unknown>,
    });
    await jobs.update(job!.id, { totalItems: total });
    for (const m of mailboxes.slice(0, 5000)) await itemStore.record({ jobId: job!.id, mailbox: m, sourceKey: `mbx:${m}`, status: 'pending' });
    audit(c, 'export_started', {
        jobId: job!.id, scope: job!.scope, mailboxes: mailboxes.length, messages: total, folders: body.folders.join(',') || 'all', from: body.from ?? null, to: body.to ?? null,
        includeAttachments: body.includeAttachments, format: body.format, encrypted: !!enc, oneTime: body.oneTime,
    });
    c.kick(job!.id);
    return { job: jobToPublic((await jobs.get(job!.id))!) };
}

export async function issueDownloadLink(c: HCtx, id: string) {
    await limit(c, 'export.link', 12);
    const job = await getJobOr404(c, id);
    if (job.kind !== 'export') throw conflict('not_ready');
    if (job.downloadedAt && (job.options as ExportOptions).oneTime !== false) throw new HttpError(410, 'already_downloaded');
    if (job.status === 'expired') throw new HttpError(410, 'expired');
    if (job.status !== 'done') throw conflict('not_ready');
    if (job.expiresAt && job.expiresAt.getTime() < Date.now()) throw new HttpError(410, 'expired');
    requireRecent(c);
    const base = process.env.NEXT_PUBLIC_APP_URL || '';
    const { url, expiresAt } = buildDownloadUrl(base, c.apiPrefix, job.id, c.actor.key);
    audit(c, 'download_link_issued', { jobId: job.id, scope: job.scope, bytes: job.outputBytes, sha256: job.outputSha256 });
    const enc = !!(job.options as ExportOptions).encrypted;
    return {
        url: url.startsWith('http') ? new URL(url).pathname + new URL(url).search : url,
        expiresAt, bytes: job.outputBytes, sha256: job.outputSha256, encrypted: enc, oneTime: (job.options as ExportOptions).oneTime !== false,
        filename: exportFilename(job),
    };
}

export function exportFilename(job: JobRow): string {
    const day = (job.finishedAt ?? new Date()).toISOString().slice(0, 10);
    const enc = !!(job.options as ExportOptions).encrypted;
    return `bloomx-${job.scope === 'self' ? 'mailbox' : 'export'}-${(job.options as ExportOptions).format}-${day}.zip${enc ? '.bmx' : ''}`;
}

export async function download(c: HCtx, id: string): Promise<Response> {
    await limit(c, 'export.download', 12);
    const job = await getJobOr404(c, id);
    const sp = new URL(c.req.url).searchParams;
    const v = verifyDownload(job.id, c.actor.key, sp.get('exp'), sp.get('sig'));
    if (v === 'expired') throw new HttpError(410, 'link_expired');
    if (v !== 'ok') throw new HttpError(403, 'invalid_link');
    if (job.kind !== 'export') throw conflict('not_ready');
    if (job.downloadedAt && (job.options as ExportOptions).oneTime !== false) throw new HttpError(410, 'already_downloaded');
    if (job.status === 'expired') throw new HttpError(410, 'expired');
    if (job.status !== 'done') throw conflict('not_ready');
    if (job.expiresAt && job.expiresAt.getTime() < Date.now()) throw new HttpError(410, 'expired');
    const oneTime = (job.options as ExportOptions).oneTime !== false;
    if (oneTime) {
        if (!(await jobs.claimDownload(job.id))) throw new HttpError(410, 'already_downloaded');
    }
    const deps = c.deps();
    const total = job.outputBytes;
    const src = new ChunkedSource(deps.storage, `${jobPrefix(job.id)}/out`, total);
    let pos = 0;
    let completed = false;
    audit(c, 'download_started', { jobId: job.id, scope: job.scope, bytes: total, sha256: job.outputSha256, oneTime });
    const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
            if (pos >= total) {
                completed = true;
                controller.close();
                if (oneTime) {
                    await purgeJobStorage(job.id, deps).catch(() => undefined);
                    await jobs.update(job.id, { status: 'expired' }).catch(() => undefined);
                }
                audit(c, 'download_completed', { jobId: job.id, bytes: total });
                return;
            }
            try {
                const b = await src.read(pos, CHUNK_SIZE);
                pos += b.length;
                controller.enqueue(new Uint8Array(b.buffer, b.byteOffset, b.length));
            } catch {
                controller.error(new Error('storage_read_failed'));
                if (oneTime) await jobs.releaseDownload(job.id).catch(() => undefined);
            }
        },
        async cancel() {
            // Descarga interrumpida: no se consume el "una sola vez"
            if (oneTime && !completed) await jobs.releaseDownload(job.id).catch(() => undefined);
        },
    });
    return new Response(stream, {
        status: 200,
        headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(total),
            'Content-Disposition': `attachment; filename="${exportFilename(job)}"`,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            ...(job.outputSha256 ? { 'X-Content-SHA256': job.outputSha256 } : {}),
        },
    });
}

// ---------------------------------------------------------------------------------------------------------------------
// Buzones del dominio (asistente de exportacion)
// ---------------------------------------------------------------------------------------------------------------------

export async function listMailboxes(c: HCtx) {
    adminOnly(c);
    await limit(c, 'mailboxes.list', 120);
    const sp = new URL(c.req.url).searchParams;
    const q = (sp.get('q') ?? '').trim().slice(0, 100);
    const page = Math.max(1, Math.min(500, Number.parseInt(sp.get('page') ?? '1', 10) || 1));
    const pageSize = Math.max(1, Math.min(50, Number.parseInt(sp.get('pageSize') ?? '20', 10) || 20));
    const domains = allowedDomains();
    const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    const where = `lower(split_part(u."email", '@', 2)) = ANY($1::text[]) AND ($2 = '' OR u."email" ILIKE $3 ESCAPE '\\' OR COALESCE(u."name",'') ILIKE $3 ESCAPE '\\')`;
    const total = num((await query<{ n: unknown }>(`SELECT COUNT(*) AS n FROM "User" u WHERE ${where}`, domains, q, like))[0]?.n);
    const rows = await query<{ email: string; name: string | null; n: unknown }>(
        `SELECT u."email", u."name", (SELECT COUNT(*) FROM "Email" e WHERE e."userId" = u."id") AS n FROM "User" u WHERE ${where} ORDER BY lower(u."email") LIMIT $4 OFFSET $5`,
        domains, q, like, pageSize, (page - 1) * pageSize);
    const all = num((await query<{ n: unknown }>(`SELECT COUNT(*) AS n FROM "User" u WHERE lower(split_part(u."email", '@', 2)) = ANY($1::text[])`, domains))[0]?.n);
    return { mailboxes: rows.map((r) => ({ email: r.email, name: r.name, emails: num(r.n), isAdmin: isAdminEmail(r.email) })), page: { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) }, totalMailboxes: all };
}

export { MailTransferTablesMissingError };
