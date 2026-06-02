import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { getFromStorage, uploadToStorage } from '@/lib/storage';
import { extractAttachmentsFromRawMime } from '@/lib/mime-attachments';

// Non-calendar attachment extraction, backed by the shared, robust MIME parser.
function extractNonCalendarAttachmentsFromRawMime(rawMime: string): Array<{
    filename: string;
    contentType: string;
    buffer: Buffer;
}> {
    return extractAttachmentsFromRawMime(rawMime)
        .filter(a => !a.isCalendar)
        .map(({ filename, contentType, buffer }) => ({ filename, contentType, buffer }));
}

// ─── Per-email processor ─────────────────────────────────────────────────────

interface ProcessResult {
    emailId: string;
    subject: string | null;
    status: 'skipped' | 'no_raw_key' | 'no_resend_id' | 'no_attachments_expected' | 'resend_error' | 'mime_error' | 'fixed' | 'already_ok';
    attachmentsAdded: number;
    error?: string;
}

async function processEmail(
    email: { id: string; rawKey: string | null; subject: string | null },
    dryRun: boolean,
): Promise<ProcessResult> {
    const base = { emailId: email.id, subject: email.subject, attachmentsAdded: 0 };

    if (!email.rawKey) return { ...base, status: 'no_raw_key' };

    // 1. Read stored webhook payload from storage.
    const rawJson = await getFromStorage(email.rawKey);
    if (!rawJson) return { ...base, status: 'no_raw_key' };

    let webhookEvent: any;
    try { webhookEvent = JSON.parse(rawJson); } catch {
        return { ...base, status: 'no_raw_key', error: 'JSON parse failed' };
    }

    const data = webhookEvent?.data ?? webhookEvent; // some older payloads may be stored as data directly
    const resendEmailId = String(data?.email_id || data?.id || '').trim();
    if (!resendEmailId) return { ...base, status: 'no_resend_id' };

    // 2. Check if the original payload had any non-calendar attachment hints.
    const rawAttachments: any[] = Array.isArray(data?.attachments) ? data.attachments : [];
    const nonCalendarHints = rawAttachments.filter((att: any) => {
        const ct = String(att?.contentType || att?.content_type || '').toLowerCase();
        const fn = String(att?.filename || '').toLowerCase();
        return !ct.includes('text/calendar') && !ct.includes('application/ics') && !fn.endsWith('.ics');
    });

    if (nonCalendarHints.length === 0) return { ...base, status: 'no_attachments_expected' };

    // 3. Get a fresh raw MIME download URL from Resend (stored URL is expired).
    let rawMimeUrl: string | null = null;
    try {
        const res = await fetch(`https://api.resend.com/emails/receiving/${resendEmailId}`, {
            headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        });
        if (res.ok) {
            const resendData = await res.json();
            rawMimeUrl = resendData?.raw?.download_url ?? null;
        } else {
            return { ...base, status: 'resend_error', error: `Resend API ${res.status}` };
        }
    } catch (err: any) {
        return { ...base, status: 'resend_error', error: err?.message };
    }

    if (!rawMimeUrl) return { ...base, status: 'resend_error', error: 'No download_url returned' };

    // 4. Download raw MIME and extract attachments.
    let extracted: Array<{ filename: string; contentType: string; buffer: Buffer }> = [];
    try {
        const mimeRes = await fetch(rawMimeUrl);
        if (!mimeRes.ok) return { ...base, status: 'mime_error', error: `MIME download ${mimeRes.status}` };
        const rawMime = await mimeRes.text();
        extracted = extractNonCalendarAttachmentsFromRawMime(rawMime);
    } catch (err: any) {
        return { ...base, status: 'mime_error', error: err?.message };
    }

    if (extracted.length === 0) return { ...base, status: 'skipped', error: 'No attachment parts found in MIME' };

    // Derive date/uuid path prefix from rawKey: emails/{date}/{uuid}/raw.json
    const pathParts = email.rawKey.split('/');
    const dateStr = pathParts[1] ?? new Date().toISOString().split('T')[0];
    const uuid = pathParts[2] ?? crypto.randomUUID();

    // Existing rows that still need content: PENDING placeholders or already-ready rows
    // (ready rows are matched so we don't duplicate them).
    const existing = await prisma.attachment.findMany({ where: { emailId: email.id } });
    const pendingRows = existing.filter(a => a.key === 'PENDING' || a.status === 'pending' || a.status === 'failed' || a.size === 0);
    const matchedIds = new Set<string>();

    // 5. Upload, then update matching PENDING rows or create new ones (skip writes in dryRun).
    let added = 0;
    for (const ext of extracted) {
        // Skip if an already-ready row with this filename exists.
        if (existing.some(a => a.status === 'ready' && a.key !== 'PENDING' && a.filename.toLowerCase() === ext.filename.toLowerCase())) {
            continue;
        }
        const attKey = `emails/${dateStr}/${uuid}/attachments/${ext.filename}`;

        // Prefer to fill a PENDING row: exact filename, else same mime-type, else any leftover.
        const match =
            pendingRows.find(a => !matchedIds.has(a.id) && a.filename.toLowerCase() === ext.filename.toLowerCase()) ||
            pendingRows.find(a => !matchedIds.has(a.id) && a.mimeType.toLowerCase() === ext.contentType.toLowerCase()) ||
            pendingRows.find(a => !matchedIds.has(a.id));

        if (!dryRun) {
            await uploadToStorage(attKey, ext.buffer, ext.contentType);
            if (match) {
                await prisma.attachment.update({
                    where: { id: match.id },
                    data: { key: attKey, status: 'ready', size: ext.buffer.byteLength, mimeType: ext.contentType, filename: ext.filename },
                });
            } else {
                await prisma.attachment.create({
                    data: { emailId: email.id, filename: ext.filename, mimeType: ext.contentType, size: ext.buffer.byteLength, key: attKey, status: 'ready' },
                });
            }
        }
        if (match) matchedIds.add(match.id);
        added++;
    }

    // Any PENDING rows we couldn't fill (no matching MIME part) → mark failed so the UI
    // stops rendering a broken `PENDING` download link.
    if (!dryRun) {
        const unfilled = pendingRows.filter(a => !matchedIds.has(a.id));
        if (unfilled.length > 0) {
            await prisma.attachment.updateMany({ where: { id: { in: unfilled.map(a => a.id) } }, data: { status: 'failed' } });
        }
    }

    return { ...base, status: 'fixed', attachmentsAdded: added };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const dryRun = Boolean(body?.dryRun ?? false);
    const emailIds: string[] | null = Array.isArray(body?.emailIds) ? body.emailIds : null;
    const since: Date | null = body?.since ? new Date(body.since) : null;
    const limit = Math.min(Number(body?.limit ?? 200), 500);

    // Find candidate emails: received emails with a rawKey that either have NO attachment
    // rows yet, OR have at least one stuck `PENDING` placeholder (large-file async path
    // that never resolved). Pass force=true to also re-examine already-checked emails.
    const force = Boolean(body?.force ?? false);
    const emails = await prisma.email.findMany({
        where: {
            ...(emailIds ? { id: { in: emailIds } } : { userId: user.id }),
            rawKey: { not: null },
            folder: { in: ['inbox', 'spam'] },
            ...(since ? { createdAt: { gte: since } } : {}),
            OR: [
                { attachments: { none: {} }, ...(force ? {} : { attachmentsChecked: false }) },
                { attachments: { some: { key: 'PENDING' } } },
            ],
        },
        select: { id: true, rawKey: true, subject: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
    });

    if (emails.length === 0) {
        return NextResponse.json({ processed: 0, fixed: 0, attachmentsAdded: 0, errors: 0, details: [] });
    }

    const details: ProcessResult[] = [];
    let fixed = 0;
    let attachmentsAdded = 0;
    let errors = 0;

    const checkedIds: string[] = [];

    for (const email of emails) {
        const result = await processEmail(email as any, dryRun);
        details.push(result);
        if (result.status === 'fixed') {
            fixed++;
            attachmentsAdded += result.attachmentsAdded;
            if (!dryRun) checkedIds.push(email.id);
        } else if (result.status === 'resend_error' || result.status === 'mime_error') {
            errors++;
            // transient — don't mark checked so the next run retries
        } else {
            // skipped / no_raw_key / no_resend_id / no_attachments_expected / already_ok
            if (!dryRun) checkedIds.push(email.id);
        }
    }

    if (checkedIds.length > 0) {
        await prisma.email.updateMany({ where: { id: { in: checkedIds } }, data: { attachmentsChecked: true } });
    }

    return NextResponse.json({
        dryRun,
        processed: emails.length,
        fixed,
        attachmentsAdded,
        errors,
        details,
    });
}
