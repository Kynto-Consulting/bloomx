/**
 * reprocess-attachments.ts
 * Backfills attachments for received emails that were stored without them
 * (Resend webhook doesn't inline content for many attachments — including .ics,
 * which it never inlines — so they land as 0-byte / PENDING placeholders).
 *
 * Two repair strategies, in order:
 *   1. Re-download the raw MIME from Resend and extract the real bytes.
 *   2. For calendar (.ics) attachments whose MIME has already expired at Resend,
 *      REGENERATE the invite from the matching CalendarEvent we already own.
 *
 * Runs as part of `prebuild` — skips gracefully if credentials are missing.
 */

import { PrismaClient } from '@prisma/client';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
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

// ─── ICS regeneration (fallback when the raw MIME has expired) ───────────────

function escapeIcs(value: string) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function icsDate(value: Date | string) {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

type EventForIcs = {
    id: string;
    title: string;
    description: string | null;
    location: string | null;
    startsAt: Date;
    endsAt: Date;
    inviteUid: string | null;
    externalId: string | null;
    organizerEmail: string | null;
    organizerName: string | null;
    updatedAt: Date | null;
    attendees: Array<{ email: string; name: string | null; isOrganizer: boolean }>;
};

function buildRequestIcsFromEvent(ev: EventForIcs): Buffer {
    const brandLocal = (process.env.BRAND_NAME || process.env.NEXT_PUBLIC_BRAND_NAME || 'bloom')
        .toLowerCase().replace(/[^a-z0-9]/g, '');
    const uid = ev.inviteUid || ev.externalId || `${ev.id}@${brandLocal}.local`;
    const seqBase = new Date(ev.updatedAt || new Date()).getTime();
    const sequence = Number.isFinite(seqBase) ? Math.floor(seqBase / 1000) : 0;
    const orgEmail = ev.organizerEmail || `noreply@${brandLocal}.local`;
    const orgName = ev.organizerName || orgEmail;

    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        `PRODID:-//${process.env.BRAND_NAME || 'Bloom'}//Calendar//EN`,
        'CALSCALE:GREGORIAN',
        'METHOD:REQUEST',
        'BEGIN:VEVENT',
        `UID:${escapeIcs(uid)}`,
        `DTSTAMP:${icsDate(new Date())}`,
        `DTSTART:${icsDate(ev.startsAt)}`,
        `DTEND:${icsDate(ev.endsAt)}`,
        `SUMMARY:${escapeIcs(ev.title || 'Event')}`,
        `DESCRIPTION:${escapeIcs(ev.description || ev.title || 'Event invitation')}`,
        `LOCATION:${escapeIcs(ev.location || '')}`,
        `ORGANIZER;CN=${escapeIcs(orgName)}:mailto:${orgEmail}`,
        `SEQUENCE:${sequence}`,
        'STATUS:CONFIRMED',
        'TRANSP:OPAQUE',
    ];
    for (const a of ev.attendees) {
        if (!a.email || a.isOrganizer) continue;
        lines.push(`ATTENDEE;CN=${escapeIcs(a.name || a.email)};ROLE=REQ-PARTICIPANT;RSVP=TRUE;PARTSTAT=NEEDS-ACTION:mailto:${a.email}`);
    }
    lines.push('END:VEVENT', 'END:VCALENDAR');
    return Buffer.from(lines.join('\r\n'), 'utf8');
}

function extractAddr(value: string): string {
    const m = String(value || '').match(/<([^>]+)>/);
    return (m?.[1] || String(value || '')).trim().toLowerCase();
}

/** Find the CalendarEvent that an "Invitation: <title>" email refers to. Best-effort. */
async function findMatchingEvent(email: { from: string; subject: string | null; userId: string }): Promise<EventForIcs | null> {
    const title = String(email.subject || '')
        .replace(/^\s*(invitation|invitaci[oó]n)\s*:\s*/i, '')
        .trim();
    if (!title) return null;
    const fromAddr = extractAddr(email.from);

    const candidates = await prisma.calendarEvent.findMany({
        where: { title: { equals: title, mode: 'insensitive' } },
        include: { attendees: { select: { email: true, name: true, isOrganizer: true } } },
        orderBy: { createdAt: 'desc' },
        take: 25,
    });
    if (candidates.length === 0) return null;

    // Prefer: organizer matches the email sender; else the recipient owns the event.
    const byOrganizer = candidates.find(c => (c.organizerEmail || '').toLowerCase() === fromAddr);
    const byOwner = candidates.find(c => c.userId === email.userId);
    const chosen = byOrganizer || byOwner || (candidates.length === 1 ? candidates[0] : null);
    if (!chosen) return null;

    return {
        id: chosen.id,
        title: chosen.title,
        description: chosen.description,
        location: chosen.location,
        startsAt: chosen.startsAt,
        endsAt: chosen.endsAt,
        inviteUid: chosen.inviteUid,
        externalId: chosen.externalId,
        organizerEmail: chosen.organizerEmail,
        organizerName: chosen.organizerName,
        updatedAt: chosen.updatedAt,
        attendees: chosen.attendees,
    };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    if (!process.env.DATABASE_URL) { console.warn('[reprocess-attachments] DATABASE_URL not set — skipping.'); return; }
    if (!makeS3()) { console.warn('[reprocess-attachments] Storage not configured — skipping.'); return; }

    // Candidates: received emails with at least one broken attachment (PENDING, failed,
    // or 0-byte — calendar invites very often land 0-byte), OR never-checked emails with
    // a stored raw payload. We DO NOT gate on attachmentsChecked for broken rows so a
    // previously-"checked" email with a 0-byte .ics still gets repaired.
    const candidates = await prisma.email.findMany({
        where: {
            folder: { in: ['inbox', 'spam'] },
            OR: [
                { attachments: { some: { key: 'PENDING' } } },
                { attachments: { some: { status: 'pending' } } },
                { attachments: { some: { status: 'failed' } } },
                { attachments: { some: { size: 0 } } },
                { attachments: { none: {} }, attachmentsChecked: false, rawKey: { not: null } },
            ],
        },
        select: { id: true, rawKey: true, subject: true, from: true, userId: true },
        orderBy: { createdAt: 'desc' },
        take: 500,
    });

    if (candidates.length === 0) { console.log('[reprocess-attachments] Nothing to reprocess.'); return; }
    console.log(`[reprocess-attachments] Checking ${candidates.length} emails...`);

    const hasResend = !!process.env.RESEND_API_KEY;
    let fixedMime = 0, fixedRegen = 0, failed = 0, totalAdded = 0;

    for (const email of candidates) {
        try {
            const existing = await prisma.attachment.findMany({ where: { emailId: email.id } });
            const broken = existing.filter(a => a.key === 'PENDING' || a.status === 'pending' || a.status === 'failed' || a.size === 0);
            const brokenCalendar = broken.filter(a => a.mimeType.toLowerCase().includes('calendar') || a.filename.toLowerCase().endsWith('.ics'));

            // ── Strategy 1: re-download raw MIME from Resend and extract real bytes ──
            let extracted: ReturnType<typeof extractAttachmentsFromRawMime> = [];
            const rawJson = email.rawKey ? await getFromStorage(email.rawKey) : null;
            let resendId = '';
            if (rawJson) {
                try { const evt = JSON.parse(rawJson); resendId = String((evt?.data ?? evt)?.email_id || (evt?.data ?? evt)?.id || '').trim(); } catch { /* ignore */ }
            }
            if (hasResend && resendId) {
                try {
                    const res = await fetch(`https://api.resend.com/emails/receiving/${resendId}`, {
                        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
                    });
                    const url = res.ok ? (await res.json())?.raw?.download_url : null;
                    if (url) {
                        const mimeRes = await fetch(url);
                        if (mimeRes.ok) extracted = extractAttachmentsFromRawMime(await mimeRes.text());
                    }
                } catch { /* fall through to regen */ }
            }

            const parts = (email.rawKey ?? `emails/${new Date().toISOString().split('T')[0]}/${email.id}`).split('/');
            const dateStr = parts[1] ?? new Date().toISOString().split('T')[0];
            const uuid = parts[2] ?? email.id;
            const matched = new Set<string>();
            let added = 0;

            // Fill broken rows from extracted MIME parts (calendar INCLUDED this time).
            for (const ext of extracted) {
                if (existing.some(a => a.status === 'ready' && a.size > 0 && a.filename.toLowerCase() === ext.filename.toLowerCase())) continue;
                const row =
                    broken.find(a => !matched.has(a.id) && a.filename.toLowerCase() === ext.filename.toLowerCase()) ||
                    broken.find(a => !matched.has(a.id) && a.mimeType.toLowerCase() === ext.contentType.toLowerCase()) ||
                    broken.find(a => !matched.has(a.id) && ext.isCalendar && (a.mimeType.toLowerCase().includes('calendar') || a.filename.toLowerCase().endsWith('.ics'))) ||
                    broken.find(a => !matched.has(a.id));
                const attKey = `emails/${dateStr}/${uuid}/attachments/${ext.filename}`;
                try {
                    await uploadToStorage(attKey, ext.buffer, ext.contentType);
                    if (row) {
                        await prisma.attachment.update({
                            where: { id: row.id },
                            data: { key: attKey, status: 'ready', size: ext.buffer.byteLength, mimeType: ext.contentType, filename: ext.filename },
                        });
                        matched.add(row.id);
                    } else {
                        await prisma.attachment.create({
                            data: { emailId: email.id, filename: ext.filename, mimeType: ext.contentType, size: ext.buffer.byteLength, key: attKey, status: 'ready' },
                        });
                    }
                    added++;
                } catch (err: any) {
                    console.warn(`[reprocess-attachments] upload failed (${ext.filename}, ${email.id}): ${err?.message}`);
                }
            }
            if (added > 0) { fixedMime++; totalAdded += added; }

            // ── Strategy 2: regenerate any still-broken .ics from the CalendarEvent ──
            const stillBrokenCal = brokenCalendar.filter(a => !matched.has(a.id));
            if (stillBrokenCal.length > 0) {
                const ev = await findMatchingEvent(email);
                if (ev) {
                    const ics = buildRequestIcsFromEvent(ev);
                    const filename = `${(ev.title || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'event'}.ics`;
                    const attKey = `emails/${dateStr}/${uuid}/attachments/${filename}`;
                    try {
                        await uploadToStorage(attKey, ics, 'text/calendar;charset=utf-8');
                        // Patch the first broken calendar row; mark the rest failed.
                        const [first, ...rest] = stillBrokenCal;
                        await prisma.attachment.update({
                            where: { id: first.id },
                            data: { key: attKey, status: 'ready', size: ics.byteLength, mimeType: 'text/calendar;charset=utf-8', filename },
                        });
                        matched.add(first.id);
                        if (rest.length > 0) {
                            await prisma.attachment.updateMany({ where: { id: { in: rest.map(r => r.id) } }, data: { status: 'failed' } });
                            rest.forEach(r => matched.add(r.id));
                        }
                        fixedRegen++; totalAdded++;
                        console.log(`[reprocess-attachments] Regenerated .ics for "${email.subject}" from event ${ev.id}`);
                    } catch (err: any) {
                        console.warn(`[reprocess-attachments] ics regen upload failed (${email.id}): ${err?.message}`);
                    }
                }
            }

            // Any non-calendar broken rows we couldn't fill → mark failed so the UI hides them.
            const unfilled = broken.filter(a => !matched.has(a.id) && !(a.mimeType.toLowerCase().includes('calendar') || a.filename.toLowerCase().endsWith('.ics')));
            if (unfilled.length > 0) {
                await prisma.attachment.updateMany({ where: { id: { in: unfilled.map(a => a.id) } }, data: { status: 'failed' } });
            }

            await prisma.email.update({ where: { id: email.id }, data: { attachmentsChecked: true } });
        } catch (err: any) {
            failed++;
            console.warn(`[reprocess-attachments] email ${email.id} failed: ${err?.message}`);
        }
    }

    console.log(`[reprocess-attachments] Done — MIME-fixed: ${fixedMime}, ICS-regenerated: ${fixedRegen}, attachments added: ${totalAdded}, failed: ${failed}.`);
}

main()
    .catch(err => console.warn('[reprocess-attachments] Unexpected error (non-fatal):', err?.message ?? err))
    .finally(() => prisma.$disconnect());
