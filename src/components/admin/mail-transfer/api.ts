'use client';

import { ApiError, adminFetch } from '@/components/admin/console/api';

export type TransferMode = 'admin' | 'self';
export const transferBase = (mode: TransferMode) => (mode === 'admin' ? '/api/admin/mail-transfer' : '/api/mail-transfer');

export interface JobPublic {
    id: string;
    kind: 'import' | 'export';
    scope: string;
    format: string;
    status: string;
    phase: string;
    fileName: string | null;
    totalBytes: number;
    uploadedBytes: number;
    totalItems: number;
    doneItems: number;
    importedItems: number;
    duplicateItems: number;
    skippedItems: number;
    errorItems: number;
    bytesProcessed: number;
    outputBytes: number;
    outputSha256: string | null;
    lastError: string | null;
    cancelRequested: boolean;
    downloadable: boolean;
    downloadedAt: string | null;
    expiresAt: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    stale: boolean;
    options: Record<string, any>;
    summary: Record<string, any>;
}

export interface TransferConfig {
    mode: TransferMode;
    domain: string;
    allowedDomains: string[];
    selfEmail: string | null;
    chunkBytes: number;
    limits: { maxUploadBytes: number; maxMessageBytes: number; maxAttachmentsPerMessage: number; maxPstBytes: number; exportTtlHours: number; maxCreatePerCall: number };
    reauth: { recent: boolean; method: string | null; expiresAt: number | null; mfaEnrolled: boolean; canUsePassword: boolean; windowSeconds: number };
}

export interface PreviewMailbox { address: string; count: number; status: 'exists' | 'missing' | 'foreign_domain' }
export interface PreviewResponse {
    job: JobPublic;
    summary: Record<string, any>;
    mailboxes: PreviewMailbox[];
    unknown: number;
    domain: string;
    allowedDomains: string[];
    selfEmail: string | null;
    canCreate: boolean;
}

export const TERMINAL = ['done', 'failed', 'canceled', 'expired'];

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
    const d = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface UploadOptions {
    base: string;
    jobId: string;
    file: File;
    chunkBytes: number;
    totalChunks: number;
    concurrency?: number;
    onProgress: (doneBytes: number) => void;
    onRetry?: (chunk: number) => void;
    signal?: AbortSignal;
}

/** Subida por trozos reanudable: consulta los trozos ya recibidos, sube el resto con hash por trozo y reintentos. */
export async function uploadInChunks(o: UploadOptions): Promise<void> {
    const got = await adminFetch<{ received: number[] }>(`${o.base}/jobs/${o.jobId}/chunks`, { signal: o.signal });
    const have = new Set(got.received);
    let done = 0;
    const sizeOf = (i: number) => Math.min(o.chunkBytes, o.file.size - i * o.chunkBytes);
    for (const i of have) done += sizeOf(i);
    o.onProgress(done);
    const todo: number[] = [];
    for (let i = 0; i < o.totalChunks; i++) if (!have.has(i)) todo.push(i);
    let next = 0;
    const worker = async () => {
        while (next < todo.length) {
            if (o.signal?.aborted) throw new DOMException('aborted', 'AbortError');
            const i = todo[next++];
            const blob = o.file.slice(i * o.chunkBytes, i * o.chunkBytes + sizeOf(i));
            const buf = await blob.arrayBuffer();
            const hash = await sha256Hex(buf);
            let attempt = 0;
            for (;;) {
                try {
                    const res = await fetch(`${o.base}/jobs/${o.jobId}/chunks/${i}`, {
                        method: 'PUT', body: buf, headers: { 'x-chunk-sha256': hash, 'Content-Type': 'application/octet-stream' }, credentials: 'same-origin', cache: 'no-store', signal: o.signal,
                    });
                    if (res.ok) break;
                    const j = await res.json().catch(() => null);
                    throw new ApiError(res.status, j?.code);
                } catch (e) {
                    if ((e as { name?: string })?.name === 'AbortError') throw e;
                    // 4xx (salvo hash corrupto 422 y limite 429) son definitivos
                    const fatal = e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 422 && e.status !== 429;
                    if (fatal || ++attempt > 4) throw e;
                    o.onRetry?.(i);
                    await new Promise((r) => setTimeout(r, 400 * attempt * attempt));
                }
            }
            done += sizeOf(i);
            o.onProgress(done);
        }
    };
    await Promise.all(Array.from({ length: Math.min(o.concurrency ?? 3, todo.length || 1) }, worker));
}

type T = (k: string, p?: Record<string, string | number>) => string;

/** Texto legible de un error de la API (admin.console.transfer.errors.<code>) con respaldo por estado. */
export function errorText(t: T, e: unknown, fallbackKey = 'admin.console.transfer.errors.generic'): string {
    if (e instanceof ApiError && e.code) {
        const key = `admin.console.transfer.errors.${e.code}`;
        const txt = t(key, { max: 50 });
        if (txt !== key) return txt;
    }
    if (e instanceof ApiError && e.status === 429) return t('admin.console.transfer.errors.rate_limited');
    if (e instanceof ApiError && e.status === 0) return t('admin.console.common.errors.network');
    return t(fallbackKey);
}

/** Codigo de error del trabajo (lastError) con texto legible. */
export function jobErrorText(t: T, code: string | null): string | null {
    if (!code) return null;
    const key = `admin.console.transfer.errors.${code}`;
    const txt = t(key);
    return txt !== key ? txt : t('admin.console.transfer.errors.internal');
}

export const fetchJson = adminFetch;
