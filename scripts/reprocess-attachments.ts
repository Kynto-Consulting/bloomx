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

import { extractAttachmentsFromRawMime } from '../src/lib/mime-attachments';

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

// ─── MIME parser (shared, robust implementation) ─────────────────────────────

function extractNonCalendarAttachmentsFromRawMime(rawMime: string) {
    return extractAttachmentsFromRawMime(rawMime)
        .filter(a => !a.isCalendar)
        .map(({ filename, contentType, buffer }) => ({ filename, contentType, buffer }));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    if (!process.env.DATABASE_URL) { console.warn('[reprocess-attachments] DATABASE_URL not set — skipping.'); return; }
    if (!process.env.RESEND_API_KEY) { console.warn('[reprocess-attachments] RESEND_API_KEY not set — skipping.'); return; }
    if (!makeS3()) { console.warn('[reprocess-attachments] Storage not configured — skipping.'); return; }

    // Candidates: stored raw payload, and either NO attachment rows (not yet checked) OR
    // at least one stuck `PENDING` placeholder from the large-file async path.
    const candidates = await prisma.email.findMany({
        where: {
            rawKey: { not: null },
            folder: { in: ['inbox', 'spam'] },
            OR: [
                { attachments: { none: {} }, attachmentsChecked: false },
                { attachments: { some: { key: 'PENDING' } } },
            ],
        },
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

        // Existing rows that still need content (PENDING placeholders, failed, or zero-size).
        const existing = await prisma.attachment.findMany({ where: { emailId: email.id } });
        const pendingRows = existing.filter(a => a.key === 'PENDING' || a.status === 'pending' || a.status === 'failed' || a.size === 0);
        const matchedIds = new Set<string>();

        let added = 0;
        for (const ext of extracted) {
            if (existing.some(a => a.status === 'ready' && a.key !== 'PENDING' && a.filename.toLowerCase() === ext.filename.toLowerCase())) {
                continue; // already have this one
            }
            const attKey = `emails/${dateStr}/${uuid}/attachments/${ext.filename}`;
            const match =
                pendingRows.find(a => !matchedIds.has(a.id) && a.filename.toLowerCase() === ext.filename.toLowerCase()) ||
                pendingRows.find(a => !matchedIds.has(a.id) && a.mimeType.toLowerCase() === ext.contentType.toLowerCase()) ||
                pendingRows.find(a => !matchedIds.has(a.id));
            try {
                await uploadToStorage(attKey, ext.buffer, ext.contentType);
                if (match) {
                    await prisma.attachment.update({
                        where: { id: match.id },
                        data: { key: attKey, status: 'ready', size: ext.buffer.byteLength, mimeType: ext.contentType, filename: ext.filename },
                    });
                    matchedIds.add(match.id);
                } else {
                    await prisma.attachment.create({
                        data: { emailId: email.id, filename: ext.filename, mimeType: ext.contentType, size: ext.buffer.byteLength, key: attKey, status: 'ready' },
                    });
                }
                added++;
            } catch (err: any) {
                console.warn(`[reprocess-attachments] Failed to save ${ext.filename} for ${email.id}: ${err?.message}`);
            }
        }

        // PENDING rows we couldn't fill → mark failed so the UI stops showing broken links.
        const unfilled = pendingRows.filter(a => !matchedIds.has(a.id));
        if (unfilled.length > 0) {
            await prisma.attachment.updateMany({ where: { id: { in: unfilled.map(a => a.id) } }, data: { status: 'failed' } });
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
