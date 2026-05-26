import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { uploadToStorage } from '@/lib/storage';
import {
    extractFilenameFromHeaders,
    extensionFromMimeType,
    sanitizeFilename,
} from '@/lib/mime-decode';
import { parseInviteFromIcs } from '@/lib/calendar/ics';
import { ensureDefaultCalendars } from '@/lib/calendar/defaults';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const INTERNAL_SECRET = process.env.INTERNAL_SECRET;

// ── Helpers ───────────────────────────────────────────────────────────────────

function decodeQuotedPrintable(input: string): string {
    return String(input || '')
        .replace(/=(\r?\n)/g, '')
        .replace(/=([A-Fa-f0-9]{2})/g, (_, hex: string) =>
            String.fromCharCode(parseInt(hex, 16)),
        );
}

/**
 * Fetch with automatic retries + exponential backoff.
 * Returns the Response on success, throws after MAX_RETRIES failures.
 */
async function fetchWithRetry(url: string, options?: RequestInit, retries = MAX_RETRIES): Promise<Response> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, options);
            if (res.ok) return res;
            // 429 / 5xx → retry; 4xx (client errors) → don't bother
            if (res.status < 500 && res.status !== 429) {
                throw new Error(`HTTP ${res.status} — not retrying`);
            }
            lastErr = new Error(`HTTP ${res.status}`);
        } catch (err) {
            lastErr = err;
        }
        if (attempt < retries) {
            const delay = 500 * 2 ** (attempt - 1); // 500ms, 1s, 2s …
            await new Promise(r => setTimeout(r, delay));
        }
    }
    throw lastErr;
}

/**
 * Upload a Buffer to storage with retries.
 * Returns true on success, false on permanent failure.
 */
async function uploadWithRetry(key: string, buffer: Buffer, contentType: string): Promise<boolean> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            await uploadToStorage(key, buffer, contentType);
            return true;
        } catch (err) {
            console.error(`[process-attachments] Upload attempt ${attempt}/${MAX_RETRIES} failed for ${key}:`, err);
            if (attempt < MAX_RETRIES) {
                await new Promise(r => setTimeout(r, 500 * 2 ** (attempt - 1)));
            }
        }
    }
    return false;
}

// ── MIME Extraction ───────────────────────────────────────────────────────────

interface ExtractedPart {
    filename: string;
    contentType: string;
    buffer: Buffer;
    isCalendar: boolean;
}

/**
 * Extract all attachment parts (calendar and non-calendar) from a raw MIME string.
 * Uses robust RFC 2047 / RFC 5987 filename decoding.
 */
function extractAttachmentsFromRawMime(rawMime: string): ExtractedPart[] {
    const results: ExtractedPart[] = [];

    // Find the top-level boundary
    const boundaryMatch = rawMime.match(
        /Content-Type:\s*multipart\/[^\r\n]+boundary=(?:"([^"]+)"|(\S+))/i,
    );
    if (!boundaryMatch) return results;

    const boundary = (boundaryMatch[1] ?? boundaryMatch[2]).trim().replace(/;$/, '');
    const escaped = boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = rawMime.split(new RegExp(`--${escaped}(?:--)?`));

    for (const part of parts) {
        // Split headers from body on first blank line
        const split = part.match(/^([\s\S]*?)\r?\n\r?\n([\s\S]*)$/);
        if (!split) continue;
        const [, headersRaw, bodyRaw] = split;

        // Only process attachments (and inline parts that look like files)
        const isAttachment = /Content-Disposition:\s*attachment/i.test(headersRaw);
        const isInlineWithName =
            /Content-Disposition:\s*inline/i.test(headersRaw) &&
            (/Content-Type:[^\r\n]*;\s*name\s*=/i.test(headersRaw) ||
                /Content-Disposition:[^\r\n]*;\s*filename\s*=/i.test(headersRaw));

        if (!isAttachment && !isInlineWithName) continue;

        // Content-Type
        const ctMatch = headersRaw.match(/Content-Type:\s*([^\r\n;]+)/i);
        const contentType = ctMatch ? ctMatch[1].trim() : 'application/octet-stream';
        const ctLower = contentType.toLowerCase();
        const isCalendar =
            ctLower.includes('text/calendar') || ctLower.includes('application/ics');

        // Filename — use the robust decoder
        let filename = extractFilenameFromHeaders(headersRaw);

        // If still empty, try to infer from Content-Type
        if (!filename) {
            const ext = extensionFromMimeType(contentType);
            filename = `attachment-${results.length + 1}${ext}`;
        } else {
            // Ensure the filename has an extension consistent with its MIME type
            if (!isCalendar && !filename.includes('.')) {
                const ext = extensionFromMimeType(contentType);
                if (ext) filename = `${filename}${ext}`;
            }
            filename = sanitizeFilename(filename);
        }

        // Transfer-encoding
        const teMatch = headersRaw.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i);
        const te = (teMatch ? teMatch[1].trim() : '7bit').toLowerCase();

        let buffer: Buffer;
        try {
            if (te === 'base64') {
                buffer = Buffer.from(bodyRaw.replace(/\s+/g, ''), 'base64');
            } else if (te === 'quoted-printable') {
                buffer = Buffer.from(decodeQuotedPrintable(bodyRaw), 'binary');
            } else {
                buffer = Buffer.from(bodyRaw);
            }
        } catch {
            continue;
        }

        if (buffer.length === 0) continue;

        results.push({ filename, contentType, buffer, isCalendar });
    }

    return results;
}

/**
 * Extract calendar ICS blocks from raw MIME (handles both MIME parts and inline blocks).
 */
function extractCalendarIcsFromRawMime(rawMime: string): string[] {
    const found: string[] = [];
    const partRegex =
        /Content-Type:\s*(?:text\/calendar|application\/ics)[^\r\n]*((?:\r?\n[^\r\n]*)*)\r?\n\r?\n([\s\S]*?)(?=\r?\n--[^\r\n]+(?:--)?\r?\n?)/gi;
    let m: RegExpExecArray | null;
    while ((m = partRegex.exec(rawMime)) !== null) {
        const partHeaders = String(m[1] || '');
        const partBody = String(m[2] || '');
        const te = (
            partHeaders.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i)?.[1] ?? ''
        )
            .trim()
            .toLowerCase();

        let decoded = partBody;
        if (te === 'base64') {
            try {
                decoded = Buffer.from(partBody.replace(/\s+/g, ''), 'base64').toString('utf8');
            } catch {
                decoded = '';
            }
        } else if (te === 'quoted-printable') {
            decoded = decodeQuotedPrintable(partBody);
        }

        if (decoded && /BEGIN:VCALENDAR/i.test(decoded) && /END:VCALENDAR/i.test(decoded)) {
            found.push(decoded);
        }
    }

    if (found.length > 0) return Array.from(new Set(found));

    const inline = rawMime.match(/BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/gi) || [];
    return Array.from(new Set(inline.map(b => b.trim()).filter(Boolean)));
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    // Auth: internal secret
    if (INTERNAL_SECRET) {
        const provided = req.headers.get('x-internal-secret');
        if (provided !== INTERNAL_SECRET) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
    }

    const { id: emailId } = await params;

    // Load the email record
    const email = await prisma.email.findUnique({
        where: { id: emailId },
        include: { attachments: true },
    });

    if (!email) {
        return NextResponse.json({ error: 'Email not found' }, { status: 404 });
    }

    if (email.attachmentsChecked) {
        return NextResponse.json({ skipped: true, reason: 'already processed' });
    }

    const rawMimeUrl = email.rawMimeUrl;
    if (!rawMimeUrl) {
        // No MIME to download — just mark done
        await prisma.email.update({ where: { id: emailId }, data: { attachmentsChecked: true } });
        return NextResponse.json({ skipped: true, reason: 'no rawMimeUrl' });
    }

    // Derive storage path prefix from the email's rawKey or a fresh uuid
    const parts = (email.rawKey ?? '').split('/');
    const dateStr = parts[1] ?? new Date().toISOString().split('T')[0];
    const uuid = parts[2] ?? crypto.randomUUID();

    // Download raw MIME with retries
    let rawMime: string;
    try {
        const mimeRes = await fetchWithRetry(rawMimeUrl);
        rawMime = await mimeRes.text();
    } catch (err) {
        console.error(`[process-attachments] Failed to download raw MIME for email ${emailId}:`, err);
        return NextResponse.json({ error: 'Failed to fetch raw MIME' }, { status: 502 });
    }

    // Extract all attachment parts
    const extracted = extractAttachmentsFromRawMime(rawMime);

    // Also extract calendar ICS blocks that may not appear as explicit parts
    const calendarBlocks = extractCalendarIcsFromRawMime(rawMime);

    const newAttachments: { filename: string; mimeType: string; size: number; key: string }[] = [];
    const parsedInvites: ReturnType<typeof parseInviteFromIcs>[] = [];

    // ── Process non-calendar attachments ──────────────────────────────────────
    for (const ext of extracted) {
        if (ext.isCalendar) {
            // Handle calendar inline
            const invite = parseInviteFromIcs(ext.buffer.toString('utf8'));
            if (invite) parsedInvites.push(invite);
        }

        // Skip if already present in DB by filename
        const alreadyExists = email.attachments.some(
            a => a.filename.toLowerCase() === ext.filename.toLowerCase() && a.status === 'ready',
        );
        if (alreadyExists) continue;

        const attKey = `emails/${dateStr}/${uuid}/attachments/${ext.filename}`;
        const uploaded = await uploadWithRetry(attKey, ext.buffer, ext.contentType);

        if (uploaded) {
            newAttachments.push({
                filename: ext.filename,
                mimeType: ext.contentType,
                size: ext.buffer.byteLength,
                key: attKey,
            });
        } else {
            console.error(`[process-attachments] Permanently failed to upload ${ext.filename} for email ${emailId}`);
        }
    }

    // ── Process standalone calendar ICS blocks ────────────────────────────────
    for (let i = 0; i < calendarBlocks.length; i++) {
        const icsContent = calendarBlocks[i];
        const invite = parseInviteFromIcs(icsContent);
        if (invite) parsedInvites.push(invite);

        // Only add to attachments if there's no calendar attachment already
        const hasCalendarAttachment =
            email.attachments.some(a => a.mimeType.includes('calendar') || a.filename.endsWith('.ics')) ||
            newAttachments.some(a => a.mimeType.includes('calendar') || a.filename.endsWith('.ics'));

        if (hasCalendarAttachment) continue;

        const filename = `invite-${i + 1}.ics`;
        const buf = Buffer.from(icsContent, 'utf8');
        const attKey = `emails/${dateStr}/${uuid}/attachments/${filename}`;
        const uploaded = await uploadWithRetry(attKey, buf, 'text/calendar;charset=utf-8');
        if (uploaded) {
            newAttachments.push({
                filename,
                mimeType: 'text/calendar;charset=utf-8',
                size: buf.byteLength,
                key: attKey,
            });
        }
    }

    // ── Update pending attachment records or create new ones ──────────────────
    const pendingAttachments = email.attachments.filter(a => a.status === 'pending');

    for (const att of pendingAttachments) {
        // Try to find a matching extracted part by filename hint
        const match = newAttachments.find(
            na => na.filename.toLowerCase() === att.filename.toLowerCase(),
        );
        if (match) {
            await prisma.attachment.update({
                where: { id: att.id },
                data: { key: match.key, status: 'ready', size: match.size },
            });
            // Remove from newAttachments so we don't double-create
            const idx = newAttachments.indexOf(match);
            if (idx !== -1) newAttachments.splice(idx, 1);
        } else {
            // Mark as failed — couldn't extract the content
            await prisma.attachment.update({
                where: { id: att.id },
                data: { status: 'failed' },
            });
        }
    }

    // Create records for newly discovered attachments
    if (newAttachments.length > 0) {
        await prisma.attachment.createMany({
            data: newAttachments.map(a => ({
                emailId,
                ...a,
                status: 'ready',
            })),
        });
    }

    // ── Handle calendar invites ───────────────────────────────────────────────
    if (parsedInvites.length > 0) {
        const emailRecord = await prisma.email.findUnique({
            where: { id: emailId },
            select: { userId: true, from: true },
        });

        if (emailRecord) {
            const { handleInboundCalendarInviteForUser } = await import(
                '@/app/api/webhooks/resend/calendar-invite-handler'
            ).catch(() => ({ handleInboundCalendarInviteForUser: null }));

            if (handleInboundCalendarInviteForUser) {
                const user = await prisma.user.findUnique({
                    where: { id: emailRecord.userId },
                    select: { id: true, email: true },
                });

                if (user) {
                    for (const invite of parsedInvites) {
                        if (!invite) continue;
                        await handleInboundCalendarInviteForUser({
                            userId: user.id,
                            userEmail: user.email,
                            emailId,
                            senderEmail: emailRecord.from,
                            senderName: null,
                            invite,
                        }).catch(err =>
                            console.error('[process-attachments] Calendar invite error:', err),
                        );
                    }
                }
            }
        }
    }

    // ── Mark as done ──────────────────────────────────────────────────────────
    await prisma.email.update({
        where: { id: emailId },
        data: { attachmentsChecked: true },
    });

    console.log(
        `[process-attachments] Done for email ${emailId}: ${newAttachments.length} uploaded, ${pendingAttachments.length} pending resolved.`,
    );

    return NextResponse.json({
        success: true,
        uploaded: newAttachments.length,
        calendars: parsedInvites.filter(Boolean).length,
    });
}
