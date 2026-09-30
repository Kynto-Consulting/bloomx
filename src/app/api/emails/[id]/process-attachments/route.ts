import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { uploadToStorage, getFromStorage } from '@/lib/storage';
import { extractAttachmentsFromRawMime } from '@/lib/mime-attachments';
import { parseInviteFromIcs } from '@/lib/calendar/ics';
import { ensureDefaultCalendars } from '@/lib/calendar/defaults';
import { handleInboundCalendarInvite } from '@/lib/calendar/invite-handler';
import { validateAttachment } from '@/lib/file-type';
import { scanBuffer, avShouldBlock } from '@/lib/av-hook';
import { uniqueAttachmentKey } from '@/lib/attachment-keys';
import { saveAttachmentContentIds } from '@/lib/attachment-content-id';
import { auditLog } from '@/lib/security';

// Large inbound attachments mean downloading the full raw MIME (all parts,
// base64) and re-uploading to our own storage. Give the function room so big
// files don't hit the default serverless timeout. Vercel clamps to the plan max.
export const runtime = 'nodejs';
export const maxDuration = 300;

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
import { safeEqual } from '@/lib/security';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET;
// Limites anti-agotamiento de memoria/almacenamiento (raw MIME base64 ~ 1.37x el adjunto).
const MAX_RAW_MIME_BYTES = 80 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 45 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_EMAIL = 50;

function assertMimeSize(res: Response) {
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_RAW_MIME_BYTES) {
        throw new Error(`Raw MIME too large (${len} bytes)`);
    }
}

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

/**
 * Resolve a fresh raw-MIME download URL from Resend using the stored webhook payload's
 * email_id. Resend's download URLs expire after a few hours, so the URL saved on the
 * email row can go stale; this re-derives a working one on demand.
 */
async function resolveFreshRawMimeUrl(rawKey: string | null): Promise<string | null> {
    if (!rawKey || !process.env.RESEND_API_KEY) return null;
    try {
        const rawJson = await getFromStorage(rawKey);
        if (!rawJson) return null;
        const evt = JSON.parse(rawJson);
        const data = evt?.data ?? evt;
        const resendId = String(data?.email_id || data?.id || '').trim();
        if (!resendId) return null;
        const res = await fetch(`https://api.resend.com/emails/receiving/${resendId}`, {
            headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        });
        if (!res.ok) return null;
        return (await res.json())?.raw?.download_url ?? null;
    } catch {
        return null;
    }
}

// ── MIME Extraction ───────────────────────────────────────────────────────────
// Attachment extraction lives in @/lib/mime-attachments (fold-aware, nested-multipart,
// inline-without-disposition, and single-part aware). Imported above.

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
    // Falla cerrado en produccion si INTERNAL_SECRET no esta configurado (la ruta es publica en middleware)
    if (!INTERNAL_SECRET && process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (INTERNAL_SECRET) {
        const provided = req.headers.get('x-internal-secret') || '';
        if (!safeEqual(provided, INTERNAL_SECRET)) {
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

    const hasPending = email.attachments.some(
        a => a.status === 'pending' || a.key === 'PENDING' || a.size === 0,
    );

    // Prefer the URL saved on the email; if absent, derive a fresh one from Resend.
    let rawMimeUrl = email.rawMimeUrl || (await resolveFreshRawMimeUrl(email.rawKey));
    if (!rawMimeUrl) {
        // Nothing to download. If placeholders are still waiting, leave them unchecked so
        // the reprocess backfill can retry later; otherwise mark this email done.
        if (!hasPending) {
            await prisma.email.update({ where: { id: emailId }, data: { attachmentsChecked: true } });
        }
        return NextResponse.json({ skipped: true, reason: 'no rawMimeUrl' });
    }

    // Derive storage path prefix from the email's rawKey or a fresh uuid
    const parts = (email.rawKey ?? '').split('/');
    const dateStr = parts[1] ?? new Date().toISOString().split('T')[0];
    const uuid = parts[2] ?? crypto.randomUUID();

    // Download raw MIME with retries; the saved URL may have expired between webhook and
    // this run, so re-derive a fresh one from Resend and retry once before giving up.
    let rawMime: string;
    try {
        const mimeRes = await fetchWithRetry(rawMimeUrl);
        assertMimeSize(mimeRes);
        rawMime = await mimeRes.text();
    } catch (err) {
        const fresh = await resolveFreshRawMimeUrl(email.rawKey);
        if (!fresh || fresh === rawMimeUrl) {
            console.error(`[process-attachments] Failed to download raw MIME for email ${emailId}:`, err);
            return NextResponse.json({ error: 'Failed to fetch raw MIME' }, { status: 502 });
        }
        try {
            const mimeRes = await fetchWithRetry(fresh);
            assertMimeSize(mimeRes);
            rawMime = await mimeRes.text();
        } catch (err2) {
            console.error(`[process-attachments] Retry with fresh URL failed for email ${emailId}:`, err2);
            return NextResponse.json({ error: 'Failed to fetch raw MIME' }, { status: 502 });
        }
    }

    // Extract all attachment parts
    const extracted = extractAttachmentsFromRawMime(rawMime)
        .filter(a => a.buffer.byteLength <= MAX_ATTACHMENT_BYTES)
        .slice(0, MAX_ATTACHMENTS_PER_EMAIL);

    // Also extract calendar ICS blocks that may not appear as explicit parts
    const calendarBlocks = extractCalendarIcsFromRawMime(rawMime);

    const newAttachments: { filename: string; mimeType: string; size: number; key: string; contentId?: string }[] = [];
    // Content-ID por clave de storage: se guarda con SQL best-effort al final (tolera que la columna aun no exista).
    const contentIdWrites: { emailId: string; key: string; contentId?: string }[] = [];
    const blockedAttachments: { filename: string; mimeType: string; size: number; reason: string }[] = [];
    const parsedInvites: ReturnType<typeof parseInviteFromIcs>[] = [];
    // Claves ya usadas (BD + esta ejecucion): dos adjuntos con el mismo nombre ya no se sobrescriben
    const usedKeys = new Set<string>(email.attachments.map(a => String(a.key || '').toLowerCase()));
    const attachmentPrefix = `emails/${dateStr}/${uuid}/attachments`;

    // ── Process non-calendar attachments ──────────────────────────────────────
    for (const ext of extracted) {
        if (ext.isCalendar) {
            // Handle calendar inline
            const invite = parseInviteFromIcs(ext.buffer.toString('utf8'));
            if (invite) parsedInvites.push(invite);
        }

        // Skip if already present in DB by filename
        const existing = email.attachments.find(
            a => a.filename.toLowerCase() === ext.filename.toLowerCase() && a.status === 'ready',
        );
        if (existing) {
            // Ya estaba (p. ej. inline del webhook): solo se completa su Content-ID si el MIME lo trae.
            if (ext.contentId) contentIdWrites.push({ emailId, key: existing.key, contentId: ext.contentId });
            continue;
        }

        // 1) Tipo real por magic-bytes (ejecutables/HTML disfrazados) y 2) antivirus opcional (AV_SCAN_URL)
        const verdict = validateAttachment({
            filename: ext.filename,
            declaredMime: ext.contentType,
            buffer: ext.buffer,
            direction: 'inbound',
        });
        let blockReason: string | null = verdict.verdict === 'blocked' ? verdict.reason : null;
        if (!blockReason) {
            const av = await scanBuffer(ext.buffer, ext.filename, { userId: email.userId });
            if (avShouldBlock(av)) blockReason = av.status === 'infected' ? 'av_infected' : 'av_unavailable';
        }
        if (blockReason) {
            blockedAttachments.push({ filename: ext.filename, mimeType: ext.contentType, size: ext.buffer.byteLength, reason: blockReason });
            auditLog('attachment.blocked', { userId: email.userId, emailId, reason: blockReason, direction: 'inbound' });
            continue;
        }
        if (verdict.verdict === 'sanitized') {
            auditLog('attachment.sanitized', { userId: email.userId, emailId, reason: verdict.reason, detected: verdict.detected.mime });
        }

        const attKey = uniqueAttachmentKey(attachmentPrefix, ext.filename, usedKeys);
        const uploaded = await uploadWithRetry(attKey, ext.buffer, verdict.storeMime);

        if (uploaded) {
            newAttachments.push({
                filename: ext.filename,
                mimeType: verdict.storeMime,
                size: ext.buffer.byteLength,
                key: attKey,
                ...(ext.contentId ? { contentId: ext.contentId } : {}),
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
        const attKey = uniqueAttachmentKey(attachmentPrefix, filename, usedKeys);
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
    const pendingAttachments = email.attachments.filter(
        a => a.status === 'pending' || a.key === 'PENDING' || a.size === 0,
    );

    for (const att of pendingAttachments) {
        // Match an extracted part: exact filename → same mime-type → any leftover.
        // (The webhook's filename hint can differ from the decoded MIME filename, so we
        // must not fail a placeholder when content WAS extracted — just under another name.)
        const match =
            newAttachments.find(na => na.filename.toLowerCase() === att.filename.toLowerCase()) ||
            newAttachments.find(na => na.mimeType.toLowerCase() === att.mimeType.toLowerCase()) ||
            newAttachments[0];

        if (match) {
            await prisma.attachment.update({
                where: { id: att.id },
                data: { key: match.key, status: 'ready', size: match.size, mimeType: match.mimeType, filename: match.filename },
            });
            if (match.contentId) contentIdWrites.push({ emailId, key: match.key, contentId: match.contentId });
            const idx = newAttachments.indexOf(match);
            if (idx !== -1) newAttachments.splice(idx, 1);
        } else {
            // No extracted content matched this placeholder — mark failed so the UI hides it.
            await prisma.attachment.update({
                where: { id: att.id },
                data: { status: 'failed' },
            });
        }
    }

    // Adjuntos bloqueados (ejecutable / AV): se deja fila con status "failed" y key "BLOCKED" (la UI oculta las "failed"
    // y /api/assets solo sirve attachments/* y emails/*/attachments/*, asi que no hay enlace descargable).
    if (blockedAttachments.length > 0) {
        await prisma.attachment.createMany({
            data: blockedAttachments.map(b => ({
                emailId,
                filename: b.filename,
                mimeType: b.mimeType,
                size: b.size,
                key: 'BLOCKED',
                status: 'failed',
            })),
        });
    }

    // Create records for newly discovered attachments
    if (newAttachments.length > 0) {
        await prisma.attachment.createMany({
            // Campos explicitos: `contentId` NO va aqui (un cliente Prisma viejo rechazaria el argumento);
            // se guarda aparte con SQL best-effort.
            data: newAttachments.map(a => ({
                emailId,
                filename: a.filename,
                mimeType: a.mimeType,
                size: a.size,
                key: a.key,
                status: 'ready',
            })),
        });
        for (const a of newAttachments) {
            if (a.contentId) contentIdWrites.push({ emailId, key: a.key, contentId: a.contentId });
        }
    }

    // Content-ID de imagenes inline. Nunca hace fallar el procesamiento (columna ausente -> se omite).
    await saveAttachmentContentIds(contentIdWrites);

    // ── Handle calendar invites ───────────────────────────────────────────────
    if (parsedInvites.length > 0) {
        const emailRecord = await prisma.email.findUnique({
            where: { id: emailId },
            select: { userId: true, from: true },
        });

        if (emailRecord) {
            const user = await prisma.user.findUnique({
                where: { id: emailRecord.userId },
                select: { id: true, email: true },
            });

            if (user) {
                for (const invite of parsedInvites) {
                    if (!invite) continue;
                    await handleInboundCalendarInvite({
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
