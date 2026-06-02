/**
 * mime-attachments.ts
 * Single source of truth for extracting attachment parts from a raw MIME message.
 *
 * Handles the cases that previously caused attachments to be lost:
 *  - Folded headers: Outlook/Word put `boundary=` on the next (folded) line, so a
 *    same-line `Content-Type: multipart/...; boundary=...` regex never matched.
 *  - Nested multipart (multipart/mixed > related > alternative): we split on EVERY
 *    declared boundary, not just the outermost one, so inline images are captured.
 *  - Inline parts without Content-Disposition: Word inline images carry only
 *    `name=` + `Content-ID:` and no disposition header.
 *  - Single-part messages: DMARC reports (Google/mimecast) arrive as a bare
 *    `Content-Type: application/zip` with no multipart wrapper at all.
 */

import {
    extractFilenameFromHeaders,
    extensionFromMimeType,
    sanitizeFilename,
} from './mime-decode';

export interface ExtractedAttachment {
    filename: string;
    contentType: string;
    buffer: Buffer;
    isCalendar: boolean;
}

function decodeQuotedPrintable(input: string): string {
    return String(input || '')
        .replace(/=(\r?\n)/g, '')
        .replace(/=([A-Fa-f0-9]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** Collect every distinct MIME boundary declared anywhere in the message (fold-safe). */
function collectBoundaries(rawMime: string): string[] {
    const boundaries: string[] = [];
    const re = /boundary\s*=\s*(?:"([^"]+)"|([^\s;"]+))/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(rawMime)) !== null) {
        const b = (m[1] ?? m[2]).trim().replace(/;$/, '');
        if (b && !boundaries.includes(b)) boundaries.push(b);
    }
    return boundaries;
}

/** Decode a part body according to its Content-Transfer-Encoding. */
function decodeBody(headersRaw: string, bodyRaw: string): Buffer | null {
    // Anchor to line start (m flag): a DKIM-Signature `h=` list can contain the literal
    // text "content-transfer-encoding:content-disposition:..." which an unanchored regex
    // would match instead of the real header, leaving base64 bodies un-decoded.
    const te = (headersRaw.match(/^Content-Transfer-Encoding:\s*([^\r\n]+)/im)?.[1] ?? '7bit')
        .trim()
        .toLowerCase();
    try {
        if (te === 'base64') return Buffer.from(bodyRaw.replace(/\s+/g, ''), 'base64');
        if (te === 'quoted-printable') return Buffer.from(decodeQuotedPrintable(bodyRaw), 'binary');
        return Buffer.from(bodyRaw, 'binary');
    } catch {
        return null;
    }
}

/** Parse one MIME segment (headers + body) into an attachment, or null if it isn't one. */
function parsePart(part: string, indexHint: number): ExtractedAttachment | null {
    const split = part.match(/^([\s\S]*?)\r?\n\r?\n([\s\S]*)$/);
    if (!split) return null;
    const [, headersRaw, bodyRaw] = split;

    // Line-anchored (m flag) so a DKIM `h=` header list can't shadow the real headers.
    const ctMatch = headersRaw.match(/^Content-Type:\s*([^\r\n;]+)/im);
    const contentType = ctMatch ? ctMatch[1].trim() : 'application/octet-stream';
    const ctLower = contentType.toLowerCase();

    // Body parts we never treat as attachments.
    const isBodyPart =
        ctLower.startsWith('multipart/') || ctLower === 'text/html' || ctLower === 'text/plain';

    const isAttachment = /^Content-Disposition:\s*attachment/im.test(headersRaw);
    // Word/Outlook inline images often have only name= and a Content-ID, no disposition.
    const hasName =
        /(?:^|;|\s)name\s*=/i.test(headersRaw) ||
        /filename\s*=/i.test(headersRaw) ||
        /Content-ID:/i.test(headersRaw);

    if (!isAttachment && !(hasName && !isBodyPart)) return null;
    if (isBodyPart && !isAttachment) return null; // multipart container with a name= — skip

    const isCalendar = ctLower.includes('text/calendar') || ctLower.includes('application/ics');

    let filename = extractFilenameFromHeaders(headersRaw);
    if (!filename) {
        const ext = extensionFromMimeType(contentType);
        filename = `attachment-${indexHint}${ext || '.bin'}`;
    } else {
        if (!isCalendar && !filename.includes('.')) {
            const ext = extensionFromMimeType(contentType);
            if (ext) filename = `${filename}${ext}`;
        }
        filename = sanitizeFilename(filename);
    }

    const buffer = decodeBody(headersRaw, bodyRaw);
    if (!buffer || buffer.length === 0) return null;

    return { filename, contentType, buffer, isCalendar };
}

/**
 * Extract all attachment parts (calendar and non-calendar) from a raw MIME string.
 */
export function extractAttachmentsFromRawMime(rawMime: string): ExtractedAttachment[] {
    const results: ExtractedAttachment[] = [];
    const boundaries = collectBoundaries(rawMime);

    if (boundaries.length > 0) {
        const alt = boundaries.map(b => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
        const parts = rawMime.split(new RegExp(`--(?:${alt})(?:--)?`));
        for (const part of parts) {
            const att = parsePart(part, results.length + 1);
            if (att) results.push(att);
        }
        return results;
    }

    // No boundary at all → single-part message (e.g. a bare application/zip DMARC report).
    const att = parsePart(rawMime, 1);
    if (att) results.push(att);
    return results;
}
