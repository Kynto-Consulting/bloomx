/**
 * elixir-campaigns.ts — modelo y logica PURA de campanas persistentes de Elixir (sin Prisma/Next,
 * para poder probarla con vitest). El acceso a datos vive en `elixir-campaign-store.ts` y el worker en
 * `elixir-worker.ts`.
 *
 * Estados de campana: draft -> running <-> paused, running -> done | cancelled | failed.
 * Estados de fila:    pending -> sending -> sent | error | skipped | unsubscribed
 *                     sent -> bounced | complained (por eventos de Resend)
 */

import { isValidEmailAddress } from './mail-validation';

export type CampaignStatus = 'draft' | 'running' | 'paused' | 'done' | 'cancelled' | 'failed';
export type CampaignRowStatus = 'pending' | 'sending' | 'sent' | 'error' | 'skipped' | 'unsubscribed' | 'bounced' | 'complained';

export const CAMPAIGN_STATUSES: readonly CampaignStatus[] = ['draft', 'running', 'paused', 'done', 'cancelled', 'failed'];
export const ROW_STATUSES: readonly CampaignRowStatus[] = ['pending', 'sending', 'sent', 'error', 'skipped', 'unsubscribed', 'bounced', 'complained'];

export const MAX_CAMPAIGN_ROWS = Number.parseInt(process.env.ELIXIR_MAX_CAMPAIGN_ROWS || '', 10) || 20_000;
export const MAX_ROWS_PER_CHUNK = 500;
export const MAX_TEMPLATES_PER_USER = 200;
/** Intentos por fila (cada intento ya incluye reintentos internos de `sendWithRetry`). */
export const MAX_ROW_ATTEMPTS = 6;

export interface CampaignOptions {
    recipientColumn: string;
    systemVars?: Record<string, string>;
    timezone?: string;
    autoescape?: boolean;
    strictVariables?: boolean;
    unsubscribeFooter?: boolean;
}

export interface SenderConfigStored {
    fromName?: string;
    fromEmail?: string;
    cc?: string;
    bcc?: string;
}

export interface CampaignRecord {
    id: string;
    userId: string;
    name: string;
    status: CampaignStatus;
    subject: string;
    template: string;
    senderConfig: SenderConfigStored;
    options: CampaignOptions;
    total: number;
    lockedUntil: Date | null;
    lastError: string | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

export type CampaignCounts = Record<CampaignRowStatus, number>;

export function emptyCounts(): CampaignCounts {
    return { pending: 0, sending: 0, sent: 0, error: 0, skipped: 0, unsubscribed: 0, bounced: 0, complained: 0 };
}

/** Convierte filas `{status, n}` de un GROUP BY en el mapa de conteos (ignora estados desconocidos). */
export function countsFromGroups(groups: Array<{ status: string; n: number | bigint | string }>): CampaignCounts {
    const c = emptyCounts();
    for (const g of groups) {
        if ((ROW_STATUSES as readonly string[]).includes(g.status)) c[g.status as CampaignRowStatus] += Number(g.n) || 0;
    }
    return c;
}

export interface CampaignProgress {
    total: number;
    /** Filas con resultado final (todo salvo pending/sending). */
    processed: number;
    remaining: number;
    percent: number;
}

export function progressOf(total: number, counts: CampaignCounts): CampaignProgress {
    const remaining = counts.pending + counts.sending;
    const processed = Math.max(0, total - remaining);
    const percent = total > 0 ? Math.min(100, Math.floor((processed / total) * 100)) : 0;
    return { total, processed, remaining, percent };
}

// ── Transiciones ─────────────────────────────────────────────────────────────

export type CampaignAction = 'start' | 'pause' | 'resume' | 'cancel' | 'retry_errors';

/** Devuelve el estado destino de una accion del usuario, o null si no es valida desde `from`. */
export function nextStatusForAction(from: CampaignStatus, action: CampaignAction): CampaignStatus | null {
    switch (action) {
        case 'start': return from === 'draft' ? 'running' : null;
        case 'pause': return from === 'running' ? 'paused' : null;
        case 'resume': return from === 'paused' || from === 'cancelled' || from === 'failed' ? 'running' : null;
        case 'cancel': return from === 'running' || from === 'paused' || from === 'draft' ? 'cancelled' : null;
        // Reintentar fallidos: relanza una campana terminada (o en curso) con las filas en error vueltas a pending.
        case 'retry_errors': return from === 'done' || from === 'paused' || from === 'failed' || from === 'cancelled' ? 'running' : null;
    }
}

export function isTerminal(status: CampaignStatus): boolean {
    return status === 'done' || status === 'cancelled' || status === 'failed';
}

// ── Backoff por fila ─────────────────────────────────────────────────────────

/** Espera antes del siguiente intento de una fila (30 s, 1 min, 2 min... tope 1 h). */
export function rowBackoffMs(attempts: number, retryAfterMs = 0): number {
    const exp = Math.min(3_600_000, 30_000 * 2 ** Math.max(0, attempts - 1));
    return Math.max(exp, retryAfterMs);
}

// ── Clasificacion de filas al cargarlas ──────────────────────────────────────

export interface ClassifiedRow {
    index: number;
    email: string;
    /** Minusculas; null si la fila no es enviable (no participa del indice unico). */
    recipient: string | null;
    status: 'pending' | 'skipped';
    message: string | null;
    code: string | null;
}

/**
 * Valida el destinatario de una fila. `seen` acumula destinatarios ya aceptados en la campana
 * (incluidos los de trozos anteriores) para marcar duplicados.
 */
export function classifyRow(index: number, row: Record<string, string>, recipientColumn: string, seen: Set<string>): ClassifiedRow {
    const email = String(row[recipientColumn] ?? '').trim();
    if (!isValidEmailAddress(email)) {
        return { index, email: email.slice(0, 200), recipient: null, status: 'skipped', message: 'Email inválido', code: 'invalid_email' };
    }
    const key = email.toLowerCase();
    if (seen.has(key)) {
        return { index, email, recipient: null, status: 'skipped', message: 'Duplicado', code: 'duplicate' };
    }
    seen.add(key);
    return { index, email, recipient: key, status: 'pending', message: null, code: null };
}

// ── Sanitizacion de datos de fila ────────────────────────────────────────────

const MAX_CELL = 20_000;
const MAX_COLUMNS = 500;

/** Normaliza una fila a Record<string,string> acotado. null si excede los limites. */
export function sanitizeRowData(input: unknown): Record<string, string> | null {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const entries = Object.entries(input as Record<string, unknown>);
    if (entries.length > MAX_COLUMNS) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of entries) {
        if (k.length > 200 || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        if (v !== null && typeof v === 'object') continue;
        out[k] = (v === null || v === undefined ? '' : String(v)).slice(0, MAX_CELL);
    }
    return out;
}

/** Normaliza el estado que reporta la API hacia el cliente: solo campos publicos. */
export function publicCampaign(c: CampaignRecord, counts: CampaignCounts) {
    return {
        id: c.id,
        name: c.name,
        status: c.status,
        subject: c.subject,
        total: c.total,
        counts,
        progress: progressOf(c.total, counts),
        lastError: c.lastError,
        startedAt: c.startedAt,
        finishedAt: c.finishedAt,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
    };
}
