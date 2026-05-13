import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { getFromStorage, uploadToStorage } from '@/lib/storage';

// ─── MIME helpers (mirrors the webhook route logic) ──────────────────────────

function extractNonCalendarAttachmentsFromRawMime(rawMime: string): Array<{
    filename: string;
    contentType: string;
    buffer: Buffer;
}> {
    const results: Array<{ filename: string; contentType: string; buffer: Buffer }> = [];

    const boundaryMatch = rawMime.match(/Content-Type:\s*multipart\/[^\r\n]+boundary=(?:"([^"]+)"|(\S+))/i);
    if (!boundaryMatch) return results;

    const boundary = (boundaryMatch[1] ?? boundaryMatch[2]).trim().replace(/;$/, '');
    const escapedBoundary = boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = rawMime.split(new RegExp(`--${escapedBoundary}(?:--)?`));

    for (const part of parts) {
        const split = part.match(/^([\s\S]*?)\r?\n\r?\n([\s\S]*)$/);
        if (!split) continue;
        const [, headersRaw, bodyRaw] = split;

        if (!/Content-Disposition:\s*attachment/i.test(headersRaw)) continue;

        const ctMatch = headersRaw.match(/Content-Type:\s*([^\r\n;]+)/i);
        const contentType = ctMatch ? ctMatch[1].trim() : 'application/octet-stream';
        const ctLower = contentType.toLowerCase();
        if (ctLower.includes('text/calendar') || ctLower.includes('application/ics')) continue;

        let filename = '';
        const cdFn = headersRaw.match(/Content-Disposition:[^\r\n]*\bfilename\*?=(?:UTF-8'')?["']?([^"'\r\n;]+)/i);
        if (cdFn) filename = decodeURIComponent(cdFn[1].trim().replace(/["']/g, ''));
        if (!filename) {
            const ctFn = headersRaw.match(/Content-Type:[^\r\n]*\bname\*?=(?:UTF-8'')?["']?([^"'\r\n;]+)/i);
            if (ctFn) filename = decodeURIComponent(ctFn[1].trim().replace(/["']/g, ''));
        }
        if (!filename) filename = `attachment-${results.length + 1}.bin`;

        const teMatch = headersRaw.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i);
        const te = teMatch ? teMatch[1].trim().toLowerCase() : '7bit';

        let buffer: Buffer;
        try {
            if (te === 'base64') {
                buffer = Buffer.from(bodyRaw.replace(/\s+/g, ''), 'base64');
            } else if (te === 'quoted-printable') {
                const decoded = bodyRaw
                    .replace(/=(\r?\n)/g, '')
                    .replace(/=([A-Fa-f0-9]{2})/g, (_: string, h: string) => String.fromCharCode(parseInt(h, 16)));
                buffer = Buffer.from(decoded, 'binary');
            } else {
                buffer = Buffer.from(bodyRaw);
            }
        } catch {
            continue;
        }

        if (buffer.length === 0) continue;
        results.push({ filename, contentType, buffer });
    }

    return results;
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

    // 5. Upload and create DB records (skip if dryRun).
    let added = 0;
    for (const ext of extracted) {
        const attKey = `emails/${dateStr}/${uuid}/attachments/${ext.filename}`;

        if (!dryRun) {
            await uploadToStorage(attKey, ext.buffer, ext.contentType);
            await prisma.attachment.create({
                data: {
                    emailId: email.id,
                    filename: ext.filename,
                    mimeType: ext.contentType,
                    size: ext.buffer.byteLength,
                    key: attKey,
                },
            });
        }
        added++;
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

    // Find candidate emails: received emails with a rawKey but no attachment records.
    const emails = await prisma.email.findMany({
        where: {
            ...(emailIds ? { id: { in: emailIds } } : { userId: user.id }),
            rawKey: { not: null },
            folder: { in: ['inbox', 'spam'] },
            ...(since ? { createdAt: { gte: since } } : {}),
            attachments: { none: {} },
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

    for (const email of emails) {
        const result = await processEmail(email as any, dryRun);
        details.push(result);
        if (result.status === 'fixed') {
            fixed++;
            attachmentsAdded += result.attachmentsAdded;
        } else if (result.status === 'resend_error' || result.status === 'mime_error') {
            errors++;
        }
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
