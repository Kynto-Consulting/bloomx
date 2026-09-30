
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from "@/lib/session";
import { getFromStorage } from '@/lib/storage';
import { parseInviteFromIcs } from '@/lib/calendar/ics';
import { loadStoredThreadHeaders, loadThreadMemberIds } from '@/lib/thread-store';
import { normalizeSubject as normalizeSubjectShared } from '@/lib/threading';
import { canAccessEmail, getAccessibleMailboxUserIds } from '@/lib/mailbox-access';
import { escapeHtmlText } from '@/lib/mail-validation';
import { parseAuthenticationResults, parseTransportDetails } from '@/lib/email-auth';
import { buildEmailOpenedContext, fireLifecycleHook, shouldFireOnce } from '@/lib/expansions/server-hooks';
import { moveEmailsTracked, restoreEmailsToPrevious } from '@/lib/mail-store';
import { afterLabelsAdded, afterLabelsRemoved } from '@/lib/labels/behavior';

function extractMailboxEmail(value: unknown): string {
    if (!value) return '';

    if (typeof value === 'object') {
        const email = String((value as any)?.email || '').trim().toLowerCase();
        if (email.includes('@')) {
            return email;
        }
    }

    const raw = String(value || '').trim();
    const bracketMatch = raw.match(/<([^>]+)>/);
    const candidate = (bracketMatch?.[1] || raw).trim().toLowerCase();
    return candidate.includes('@') ? candidate : '';
}

function pickReplyToCandidate(data: any): unknown {
    const payloadReplyTo = data?.reply_to;
    if (Array.isArray(payloadReplyTo) && payloadReplyTo.length > 0) {
        return payloadReplyTo[0];
    }

    if (payloadReplyTo) {
        return payloadReplyTo;
    }

    const headers = data?.headers;
    if (headers && typeof headers === 'object') {
        return (headers as any)['reply-to']
            || (headers as any)['Reply-To']
            || (headers as any)['reply_to']
            || (headers as any)['Reply_To'];
    }

    return null;
}

function extractRecipientToken(value?: string | null): string {
    const source = String(value || '').trim().toLowerCase();
    if (!source) return '';

    const firstSegment = source.split(',')[0]?.trim() || '';
    const bracketMatch = firstSegment.match(/<([^>]+)>/);
    const token = (bracketMatch?.[1] || firstSegment).trim().toLowerCase();

    return token || source;
}

async function buildInviteState(emailId: string) {
    const latestRsvp = await prisma.emailEvent.findFirst({
        where: {
            emailId,
            type: 'invite.rsvp'
        },
        orderBy: { createdAt: 'desc' }
    });

    return latestRsvp?.data || null;
}

async function buildInvitePreview(email: any) {
    const calendarAttachment = (email.attachments || []).find((attachment: any) => {
        const mimeType = String(attachment?.mimeType || '').toLowerCase();
        const filename = String(attachment?.filename || '').toLowerCase();
        return mimeType.includes('text/calendar') || filename.endsWith('.ics');
    });

    if (!calendarAttachment?.key) {
        return null;
    }

    const rawInvite = await getFromStorage(calendarAttachment.key);
    const invite = parseInviteFromIcs(rawInvite || '');
    if (!invite) {
        return null;
    }

    return {
        attachmentId: calendarAttachment.id,
        filename: calendarAttachment.filename,
        uid: invite.uid || null,
        title: invite.summary || email.subject || 'Calendar invitation',
        description: invite.description || null,
        location: invite.location || null,
        meetUrl: invite.meetUrl || null,
        startsAt: invite.startsAt || null,
        endsAt: invite.endsAt || null,
        method: invite.method || null,
        organizerEmail: invite.organizerEmail || null,
        organizerName: invite.organizerName || null,
    };
}

/**
 * Resultado SPF/DKIM/DMARC del correo entrante, leido de la cabecera Authentication-Results
 * guardada en el payload crudo (sin migracion de esquema). null si no hay datos o es un correo enviado.
 */
async function resolveAuthentication(email: any) {
    const empty = { authentication: null, transport: null };
    try {
        const rawKey = String(email?.rawKey || '').trim();
        if (!rawKey) return empty;
        const rawPayload = await getFromStorage(rawKey);
        if (!rawPayload) return empty;
        const parsed = JSON.parse(rawPayload);
        const dataNode = parsed?.data || parsed;
        return {
            authentication: parseAuthenticationResults(dataNode?.headers),
            transport: parseTransportDetails(dataNode?.headers),
        };
    } catch {
        return empty;
    }
}

async function buildEmailPayload(email: any, content: string, signedAttachments: any[]) {
    const invitePreview = await buildInvitePreview(email);
    const inviteResponse = await buildInviteState(email.id);

    return {
        email: {
            ...email,
            replyTo: email.replyTo || null,
            rawMimeUrl: undefined, // URL de descarga del proveedor: no exponer al cliente
            attachments: signedAttachments,
        },
        content,
        ...(await resolveAuthentication(email)),
        invitePreview,
        inviteResponse,
    };
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> } // Treat params as a promise
) {
    const user = await getCurrentUser();
    if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const { id } = await params;
        const { searchParams } = new URL(req.url);
        const fetchThread = searchParams.get('thread') === 'true';

        const email = await prisma.email.findUnique({
            where: { id },
            include: {
                labels: true,
                attachments: true
            }
        });

        // Anti-IDOR: el correo debe pertenecer al usuario (o a un buzon vinculado). 404 para no filtrar existencia.
        if (!email || !(await canAccessEmail(user.id, email.userId))) {
            return NextResponse.json({ error: 'Email not found' }, { status: 404 });
        }

        let content = email.snippet || "(No content)";

        // Helper to fetch content
        const fetchContent = async (e: any) => {
            // Cadena de respaldo: HTML -> texto plano -> extracto. Un htmlKey cuyo objeto falta o esta vacio NO debe dejar el
            // mensaje en blanco si existe el texto plano (o al menos el extracto).
            if (e.htmlKey) {
                const storedHtml = await getFromStorage(e.htmlKey);
                if (storedHtml && storedHtml.trim()) return storedHtml;
            }
            if (e.textKey) {
                const storedText = await getFromStorage(e.textKey);
                if (storedText && storedText.trim()) return `<pre>${escapeHtmlText(storedText)}</pre>`;
            }
            return e.snippet ? `<pre>${escapeHtmlText(String(e.snippet))}</pre>` : "";
        };

        // Helper to sign attachments. Skip placeholders/failures (key === 'PENDING' or a
        // non-ready status) so the UI never renders a broken download link.
        const signAttachments = async (list: any[]) => {
            const usable = list.filter(att => att.key && att.key !== 'PENDING' && att.status !== 'pending' && att.status !== 'failed');
            return Promise.all(usable.map(async (att) => {
                const url = await import('@/lib/storage').then(m => m.getSignedDownloadUrl(att.key, att.filename));
                return { ...att, url };
            }));
        };

        const replyToCache = new Map<string, string | null>();
        const resolveReplyTo = async (e: any): Promise<string | null> => {
            const persistedReplyTo = extractMailboxEmail(e?.replyTo);
            if (persistedReplyTo) {
                return persistedReplyTo;
            }

            const rawKey = String(e?.rawKey || '').trim();
            if (!rawKey) {
                return null;
            }

            if (replyToCache.has(rawKey)) {
                return replyToCache.get(rawKey) || null;
            }

            try {
                const rawPayload = await getFromStorage(rawKey);
                if (!rawPayload) {
                    replyToCache.set(rawKey, null);
                    return null;
                }

                const parsed = JSON.parse(rawPayload);
                const dataNode = parsed?.data || parsed;
                const candidate = pickReplyToCandidate(dataNode);
                const replyTo = extractMailboxEmail(candidate) || null;
                replyToCache.set(rawKey, replyTo);
                return replyTo;
            } catch {
                replyToCache.set(rawKey, null);
                return null;
            }
        };

        content = await fetchContent(email);
        const attachmentsWithUrls = await signAttachments(email.attachments ?? []);

        let threadEmails: any[] = [];

        // Hilo por cabeceras (Email.threadKey, lib/threading.ts): los miembros del hilo son los correos con la misma clave, aunque cambie el
        // asunto. Correos antiguos sin clave: respaldo por asunto normalizado + destinatarios (misma normalizacion que la lista y el SQL).
        const storedThread = fetchThread ? await loadStoredThreadHeaders(email.id) : null;
        const memberIds = storedThread?.threadKey ? await loadThreadMemberIds(email.userId, storedThread.threadKey) : [];
        if (fetchThread && storedThread?.threadKey && memberIds.length > 0) {
            const members = await prisma.email.findMany({
                where: { id: { in: memberIds }, userId: email.userId },
                orderBy: { createdAt: 'desc' }, // Newest first
                include: { labels: true, attachments: true },
            });
            threadEmails = await Promise.all(members.map(async (e) => {
                const c = await fetchContent(e);
                const atts = await signAttachments(e.attachments ?? []);
                const payload = await buildEmailPayload(e, c, atts);
                payload.email.replyTo = await resolveReplyTo(e);
                return payload;
            }));
        } else if (fetchThread && email.subject) {
            const normalizeSubject = normalizeSubjectShared;

            const normalized = normalizeSubject(email.subject);
            const recipientToken = extractRecipientToken(email.cleanTo || email.to);

            // Only search if not empty and length sufficient to be a "topic"
            if (normalized && normalized.length >= 3) {
                const threadWhere: any = {
                    userId: email.userId,
                    OR: [
                        { subject: { equals: normalized, mode: 'insensitive' } },
                        { subject: { startsWith: 'Re: ' + normalized, mode: 'insensitive' } }, // Simple heuristic
                        { subject: { contains: normalized, mode: 'insensitive' } } // Broader search, filter in code
                    ]
                };

                if (recipientToken) {
                    threadWhere.AND = [
                        {
                            OR: [
                                { cleanTo: { contains: recipientToken, mode: 'insensitive' } },
                                { to: { contains: recipientToken, mode: 'insensitive' } }
                            ]
                        }
                    ];
                }

                // Find all emails with this subject (ignoring prefixes)
                const threadCandidates = await prisma.email.findMany({
                    where: threadWhere,
                    orderBy: { createdAt: 'desc' }, // Newest first
                    include: {
                        labels: true,
                        attachments: true
                    }
                });

                // Strict filter and prepare
                const pEmails = threadCandidates.filter(e => normalizeSubject(e.subject || '') === normalized);

                threadEmails = await Promise.all(pEmails.map(async (e) => {
                    const c = await fetchContent(e);
                    const atts = await signAttachments(e.attachments ?? []);
                    const payload = await buildEmailPayload(e, c, atts);
                    payload.email.replyTo = await resolveReplyTo(e);
                    return payload;
                }));
            }
        }

        const emailPayload = await buildEmailPayload(email, content, attachmentsWithUrls);
        const emailReplyTo = await resolveReplyTo(email);
        emailPayload.email.replyTo = emailReplyTo;

        // Hook EMAIL_OPENED (no bloqueante; contexto minimo derivado aqui, nunca del cliente; dedupe 60 s).
        if (shouldFireOnce(`email-opened:${user.id}:${email.id}`)) {
            fireLifecycleHook('EMAIL_OPENED', user.id, buildEmailOpenedContext({ emailId: email.id, folder: email.folder, from: email.from, isRead: email.read }));
        }

        return NextResponse.json({
            ...emailPayload,
            thread: threadEmails.length > 0 ? threadEmails : undefined
        });

    } catch (error) {
        console.error('Failed to fetch email:', error);
        return NextResponse.json({ error: 'Failed to fetch email' }, { status: 500 });
    }
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> } // Treat params as a promise
) {
    const user = await getCurrentUser();
    if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const { id } = await params; // Await the params
        const body = await req.json();
        const { starred, folder, labelIds, toggleLabelId, read, restore } = body;

        // Anti-IDOR: solo correos de buzones accesibles por el usuario.
        const accessibleIds = await getAccessibleMailboxUserIds(user.id);
        const existing = await prisma.email.findFirst({
            where: { id, userId: { in: accessibleIds } },
            include: { labels: true },
        });
        if (!existing) {
            return NextResponse.json({ error: 'Email not found' }, { status: 404 });
        }

        const updateData: any = {};

        if (typeof starred === 'boolean') {
            updateData.starred = starred;
        }

        if (typeof read === 'boolean') {
            updateData.read = read;
        }

        if (folder !== undefined && folder !== null && folder !== '') {
            if (typeof folder !== 'string' || !/^[A-Za-z0-9_-]{1,50}$/.test(folder)) {
                return NextResponse.json({ error: 'Invalid folder' }, { status: 400 });
            }
            updateData.folder = folder;
        }

        // Solo se pueden asociar etiquetas del mismo propietario del correo.
        const ownedLabelIds = async (ids: unknown): Promise<string[]> => {
            if (!Array.isArray(ids)) return [];
            const wanted = ids.filter((v): v is string => typeof v === 'string');
            if (wanted.length === 0) return [];
            const rows = await prisma.label.findMany({
                where: { id: { in: wanted }, userId: existing.userId },
                select: { id: true },
            });
            return rows.map((r) => r.id);
        };

        // Handle full label replacement or toggling single label
        if (labelIds) {
            const allowed = await ownedLabelIds(labelIds);
            updateData.labels = {
                set: allowed.map((lid) => ({ id: lid }))
            };
        }

        if (toggleLabelId) {
            const [allowedLabel] = await ownedLabelIds([toggleLabelId]);
            if (allowedLabel) {
                const hasLabel = existing.labels.some(l => l.id === allowedLabel);
                updateData.labels = hasLabel
                    ? { disconnect: { id: allowedLabel } }
                    : { connect: { id: allowedLabel } };
            }
        }

        // "Restaurar": vuelve a la carpeta de origen guardada en el servidor (previousFolder); sin dato, a la bandeja.
        if (restore === true) {
            if (updateData.folder !== undefined) return NextResponse.json({ error: 'Use folder or restore, not both' }, { status: 400 });
            const fallback = typeof body.fallbackFolder === 'string' ? { [existing.id]: body.fallbackFolder } : {};
            await restoreEmailsToPrevious([existing.id], [existing.userId], fallback);
        }

        // Cambio de carpeta: SQL propio que fija tambien previousFolder (origen de "Restaurar") en la misma sentencia.
        if (updateData.folder !== undefined) {
            await moveEmailsTracked({ ids: [existing.id], userIds: [existing.userId], folder: updateData.folder });
            delete updateData.folder;
        }

        let email = await prisma.email.update({
            where: { id: existing.id },
            data: updateData,
            include: { labels: true }
        });

        // Etiquetas-carpeta: anadirlas saca el correo de Entrada; quitar la ultima lo devuelve (ver lib/labels/behavior.ts).
        if (labelIds || toggleLabelId) {
            const before = new Set(existing.labels.map((l) => l.id));
            const after = new Set(email.labels.map((l) => l.id));
            const added = Array.from(after).filter((x) => !before.has(x));
            const removed = Array.from(before).filter((x) => !after.has(x));
            let changed = 0;
            if (added.length) changed += await afterLabelsAdded([existing.userId], [existing.id], added);
            if (removed.length) changed += await afterLabelsRemoved([existing.userId], [existing.id], removed);
            if (changed > 0) {
                const fresh = await prisma.email.findUnique({ where: { id: existing.id }, include: { labels: true } });
                if (fresh) email = fresh;
            }
        }

        return NextResponse.json(email);

    } catch (error) {
        console.error('Failed to update email:', error);
        return NextResponse.json({ error: 'Failed to update email' }, { status: 500 });
    }
}
