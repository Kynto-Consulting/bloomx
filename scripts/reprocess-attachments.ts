/**
 * reprocess-attachments.ts
 * Backfills attachments for received emails that were stored without them
 * (due to Resend webhook not inlining attachment content for large files).
 * Runs as part of `prebuild` — skips gracefully if credentials are missing.
 */

import { PrismaClient } from '@prisma/client';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';

import {
    extractFilenameFromHeaders,
    extensionFromMimeType,
    sanitizeFilename,
} from '../src/lib/mime-decode';

const prisma = new PrismaClient();

// ─── Minimal storage helpers (no Next.js env shim needed in scripts) ─────────

function makeS3() {
    const endpoint = process.env.S3_ENDPOINT || process.env.B2_ENDPOINT;
    const accessKeyId = process.env.S3_ACCESS_KEY || process.env.B2_ACCESS_KEY;
    const secretAccessKey = process.env.S3_SECRET_KEY || process.env.B2_SECRET_KEY;
    const region = process.env.S3_REGION || process.env.B2_REGION || 'us-east-1';
    if (!endpoint || !accessKeyId || !secretAccessKey) return null;
    return new S3Client({ region, endpoint, credentials: { accessKeyId, secretAccessKey }, forcePathStyle: true });
}

const BUCKET = process.env.S3_BUCKET || process.env.B2_BUCKET || '';

async function getFromStorage(key: string): Promise<string | null> {
    const s3 = makeS3();
    if (!s3 || !BUCKET) return null;
    try {
        const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
        if (!res.Body) return null;
        const chunks: Buffer[] = [];
        for await (const chunk of res.Body as Readable) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        return Buffer.concat(chunks).toString('utf8');
    } catch {
        return null;
    }
}

async function uploadToStorage(key: string, buffer: Buffer, contentType: string): Promise<void> {
    const s3 = makeS3();
    if (!s3 || !BUCKET) return;
    await new Upload({ client: s3, params: { Bucket: BUCKET, Key: key, Body: buffer, ContentType: contentType } }).done();
}

// ─── MIME parser (mirrors webhook route) ─────────────────────────────────────

function extractNonCalendarAttachmentsFromRawMime(rawMime: string) {
    const results: Array<{ filename: string; contentType: string; buffer: Buffer }> = [];
    const boundaryMatch = rawMime.match(/Content-Type:\s*multipart\/[^\r\n]+boundary=(?:"([^"]+)"|(\S+))/i);
    if (!boundaryMatch) return results;

    const boundary = (boundaryMatch[1] ?? boundaryMatch[2]).trim().replace(/;$/, '');
    const escaped = boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = rawMime.split(new RegExp(`--${escaped}(?:--)?`));

    for (const part of parts) {
        const split = part.match(/^([\s\S]*?)\r?\n\r?\n([\s\S]*)$/);
        if (!split) continue;
        const [, headersRaw, bodyRaw] = split;
        
        // Match both attachment and inline files
        const isAttachment = /Content-Disposition:\s*attachment/i.test(headersRaw);
        const isInlineWithName =
            /Content-Disposition:\s*inline/i.test(headersRaw) &&
            (/Content-Type:[^\r\n]*;\s*name\s*=/i.test(headersRaw) ||
                /Content-Disposition:[^\r\n]*;\s*filename\s*=/i.test(headersRaw));

        if (!isAttachment && !isInlineWithName) continue;

        const ctMatch = headersRaw.match(/Content-Type:\s*([^\r\n;]+)/i);
        const contentType = ctMatch ? ctMatch[1].trim() : 'application/octet-stream';
        const ctLower = contentType.toLowerCase();
        if (ctLower.includes('text/calendar') || ctLower.includes('application/ics')) continue;

        // Filename — use the robust decoder
        let filename = extractFilenameFromHeaders(headersRaw);

        // If still empty, try to infer from Content-Type
        if (!filename) {
            const ext = extensionFromMimeType(contentType);
            filename = `attachment-${results.length + 1}${ext || '.bin'}`;
        } else {
            if (!filename.includes('.')) {
                const ext = extensionFromMimeType(contentType);
                if (ext) filename = `${filename}${ext}`;
            }
            filename = sanitizeFilename(filename);
        }

        const te = (headersRaw.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i)?.[1] ?? '7bit').trim().toLowerCase();
        let buffer: Buffer;
        try {
            if (te === 'base64') buffer = Buffer.from(bodyRaw.replace(/\s+/g, ''), 'base64');
            else if (te === 'quoted-printable') {
                const d = bodyRaw.replace(/=(\r?\n)/g, '').replace(/=([A-Fa-f0-9]{2})/g, (_: string, h: string) => String.fromCharCode(parseInt(h, 16)));
                buffer = Buffer.from(d, 'binary');
            } else buffer = Buffer.from(bodyRaw);
        } catch { continue; }

        if (buffer.length > 0) results.push({ filename, contentType, buffer });
    }
    return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    if (!process.env.DATABASE_URL) { console.warn('[reprocess-attachments] DATABASE_URL not set — skipping.'); return; }
    if (!process.env.RESEND_API_KEY) { console.warn('[reprocess-attachments] RESEND_API_KEY not set — skipping.'); return; }
    if (!makeS3()) { console.warn('[reprocess-attachments] Storage not configured — skipping.'); return; }

    // Emails received without any attachment records, not yet checked, with a stored raw payload.
    const candidates = await prisma.email.findMany({
        where: { rawKey: { not: null }, folder: { in: ['inbox', 'spam'] }, attachments: { none: {} }, attachmentsChecked: false },
        select: { id: true, rawKey: true, subject: true },
        orderBy: { createdAt: 'desc' },
        take: 500,
    });

    if (candidates.length === 0) { console.log('[reprocess-attachments] Nothing to reprocess.'); return; }

    console.log(`[reprocess-attachments] Checking ${candidates.length} emails...`);

    let fixed = 0, skipped = 0, failed = 0, totalAdded = 0;
    const checkedIds: string[] = []; // IDs to mark attachmentsChecked=true (all non-transient outcomes)

    for (const email of candidates) {
        const rawJson = await getFromStorage(email.rawKey!);
        if (!rawJson) { skipped++; checkedIds.push(email.id); continue; }

        let data: any;
        try { const evt = JSON.parse(rawJson); data = evt?.data ?? evt; } catch { skipped++; checkedIds.push(email.id); continue; }

        const resendId = String(data?.email_id || data?.id || '').trim();
        if (!resendId) { skipped++; checkedIds.push(email.id); continue; }

        const hints: any[] = Array.isArray(data?.attachments) ? data.attachments : [];
        const nonCal = hints.filter((a: any) => {
            const ct = String(a?.contentType || a?.content_type || '').toLowerCase();
            const fn = String(a?.filename || '').toLowerCase();
            return !ct.includes('text/calendar') && !ct.includes('application/ics') && !fn.endsWith('.ics');
        });
        if (nonCal.length === 0) { skipped++; checkedIds.push(email.id); continue; }

        // Get a fresh raw MIME URL from Resend.
        let rawMimeUrl: string | null = null;
        try {
            const res = await fetch(`https://api.resend.com/emails/receiving/${resendId}`, {
                headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
            });
            if (res.ok) rawMimeUrl = (await res.json())?.raw?.download_url ?? null;
        } catch { /* fall through */ }

        if (!rawMimeUrl) {
            console.warn(`[reprocess-attachments] Could not get MIME URL for email ${email.id} (Resend ID: ${resendId})`);
            failed++; continue; // transient — don't mark checked, retry next build
        }

        let extracted: ReturnType<typeof extractNonCalendarAttachmentsFromRawMime> = [];
        try {
            const mimeRes = await fetch(rawMimeUrl);
            if (!mimeRes.ok) throw new Error(`HTTP ${mimeRes.status}`);
            extracted = extractNonCalendarAttachmentsFromRawMime(await mimeRes.text());
        } catch (err: any) {
            console.warn(`[reprocess-attachments] MIME download failed for ${email.id}: ${err?.message}`);
            failed++; continue; // transient — don't mark checked, retry next build
        }

        if (extracted.length === 0) { skipped++; checkedIds.push(email.id); continue; }

        const parts = email.rawKey!.split('/');
        const dateStr = parts[1] ?? new Date().toISOString().split('T')[0];
        const uuid = parts[2] ?? crypto.randomUUID();

        let added = 0;
        for (const ext of extracted) {
            const attKey = `emails/${dateStr}/${uuid}/attachments/${ext.filename}`;
            try {
                await uploadToStorage(attKey, ext.buffer, ext.contentType);
                await prisma.attachment.create({
                    data: { emailId: email.id, filename: ext.filename, mimeType: ext.contentType, size: ext.buffer.byteLength, key: attKey },
                });
                added++;
            } catch (err: any) {
                console.warn(`[reprocess-attachments] Failed to save ${ext.filename} for ${email.id}: ${err?.message}`);
            }
        }

        checkedIds.push(email.id);
        if (added > 0) {
            console.log(`[reprocess-attachments] Fixed "${email.subject ?? '(no subject)'}" — added ${added} attachment(s)`);
            fixed++; totalAdded += added;
        } else {
            failed++;
        }
    }

    // Mark all conclusively-processed emails so they're skipped on future builds.
    if (checkedIds.length > 0) {
        await prisma.email.updateMany({ where: { id: { in: checkedIds } }, data: { attachmentsChecked: true } });
    }

    console.log(`[reprocess-attachments] Done — fixed: ${fixed}, attachments added: ${totalAdded}, skipped: ${skipped}, failed: ${failed}, marked-checked: ${checkedIds.length}.`);
}

main()
    .catch(err => console.warn('[reprocess-attachments] Unexpected error (non-fatal):', err?.message ?? err))
    .finally(() => prisma.$disconnect());
