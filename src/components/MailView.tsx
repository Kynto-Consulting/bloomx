'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Archive, ArchiveX, Trash2, Clock, Reply, ReplyAll, Forward, MoreVertical, MousePointerClick, Star, Tag, Check, ArrowLeft, X, Sparkles, CalendarDays, MapPin, ShieldCheck, ShieldAlert, ShieldQuestion, ImageOff } from 'lucide-react';
import { useCache } from '@/contexts/CacheContext';
import { useCompose } from '@/contexts/ComposeContext';
import { formatDate, cn } from '@/lib/utils';
import { sanitizeHtml } from '@/lib/sanitizeHtml';
import { buildForwardHeaderHtml } from '@/lib/forward-header';
import { toast } from 'sonner';
import { fetchDeduped } from '@/lib/fetchdedupe';

import * as Icons from 'lucide-react';
import { SafeIframe } from './ui/SafeIframe';
import { ExtensionLoader } from './expansions/ExtensionLoader';
import { motion, AnimatePresence } from 'framer-motion';
import { Popover } from './ui/Popover';
import { AccountManager } from '@/lib/account-manager';
import { splitAddressList, extractEmailOnly, buildReplyAllRecipients, findAttachmentForCid, replaceCidReferences, extractCidReferences } from '@/lib/email-utils';
import { resolveInlineCidImages } from '@/lib/cid-display';
import type { EmailAuthentication, AuthVerdict } from '@/lib/email-auth';
import { mergeEmailPatchResponse, applyEmailPatch, optimisticEmailPatch } from '@/lib/mail-view-state';
import {
    hasRemoteImages, isRemoteImagesAllowed, allowForEmail, allowForSender, loadPolicy, savePolicy, emptyPolicy,
    type RemoteImagePolicy,
} from '@/lib/remote-images';

const ENABLE_THREAD_VIEW = true;

interface EmailDetails {
    email: {
        id: string;
        from: string;
        to: string;
        cc?: string | null;
        bcc?: string | null;
        cleanTo?: string | null;
        replyTo?: string | null;
        subject: string;
        createdAt: string;
        read: boolean;
        starred: boolean;
        folder: string;
        attachments: any[];
        labels: any[];
        snippet?: string;
    };
    content: string;
    invitePreview?: {
        attachmentId: string;
        filename: string;
        uid?: string | null;
        title: string;
        description?: string | null;
        location?: string | null;
        meetUrl?: string | null;
        startsAt?: string | null;
        endsAt?: string | null;
        method?: string | null;
        organizerEmail?: string | null;
        organizerName?: string | null;
    } | null;
    inviteResponse?: {
        response: 'accepted' | 'tentative' | 'declined';
        respondedAt?: string;
        organizerEmail?: string;
        organizerName?: string;
        uid?: string;
    } | null;
    authentication?: EmailAuthentication | null;
    thread?: EmailDetails[]; // Thread support
}

function getMeetProvider(url?: string | null) {
    if (!url) return null;
    if (url.includes('meet.google.com')) return 'Google Meet';
    if (url.includes('zoom.us')) return 'Zoom';
    if (url.includes('teams.microsoft.com')) return 'Microsoft Teams';
    return 'Videollamada';
}

function formatInviteDate(value?: string | null) {
    if (!value) return '';

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return value;
    }

    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(parsed);
}

function extractRecipientEmails(value?: string | null): string[] {
    return splitAddressList(value).map(extractEmailOnly).filter(Boolean);
}

function resolveSenderFromEmail(email: { to?: string | null; cleanTo?: string | null }): string | undefined {
    const candidates = extractRecipientEmails(email.cleanTo || email.to);

    for (const recipient of candidates) {
        if (AccountManager.getAccountByEmail(recipient)) {
            return recipient;
        }
    }

    return AccountManager.getActiveAccount()?.email || undefined;
}

const VERDICT_LABEL: Record<AuthVerdict, string> = {
    pass: 'correcto', fail: 'fallo', softfail: 'fallo suave', neutral: 'neutral', none: 'sin registro',
    temperror: 'error temporal', permerror: 'error permanente', unknown: 'desconocido',
};

/** Insignia de autenticacion SPF/DKIM/DMARC (solo informativa; ver src/lib/email-auth.ts). */
function AuthBadge({ auth }: { auth?: EmailAuthentication | null }) {
    if (!auth) return null;
    const detail = `SPF: ${VERDICT_LABEL[auth.spf]} · DKIM: ${VERDICT_LABEL[auth.dkim]} · DMARC: ${VERDICT_LABEL[auth.dmarc]}` +
        (auth.trusted ? '' : ' · cabeceras contradictorias: no fiable');
    const cfg = {
        verified: { Icon: ShieldCheck, text: 'Verificado', cls: 'border-success/40 bg-success/10 text-success' },
        partial: { Icon: ShieldQuestion, text: 'Parcial', cls: 'border-warning/40 bg-warning/10 text-warning' },
        failed: { Icon: ShieldAlert, text: 'Sin autenticar', cls: 'border-destructive/40 bg-destructive/10 text-destructive' },
        unknown: { Icon: ShieldQuestion, text: 'Sin datos', cls: 'border-border bg-muted text-muted-foreground' },
    }[auth.summary];
    const Icon = cfg.Icon;
    const untrusted = !auth.trusted && auth.summary === 'verified';
    return (
        <span
            className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', untrusted ? 'border-warning/40 bg-warning/10 text-warning' : cfg.cls)}
            title={detail}
            aria-label={`Autenticacion del remitente: ${cfg.text}. ${detail}`}
        >
            <Icon className="h-3 w-3" aria-hidden="true" />
            {untrusted ? 'Verificado (no fiable)' : cfg.text}
            <span className="hidden md:inline font-normal opacity-80">
                SPF {auth.spf === 'pass' ? '✓' : auth.spf === 'fail' || auth.spf === 'softfail' ? '✗' : '?'}{' '}
                DKIM {auth.dkim === 'pass' ? '✓' : auth.dkim === 'fail' ? '✗' : '?'}{' '}
                DMARC {auth.dmarc === 'pass' ? '✓' : auth.dmarc === 'fail' ? '✗' : '?'}
            </span>
        </span>
    );
}

const CID_INLINE_LIMIT = 2 * 1024 * 1024;

/**
 * Reemplaza imagenes cid: por data: URIs descargando el adjunto (el esquema no guarda Content-ID, se
 * resuelve por nombre de archivo; ver findAttachmentForCid). Las que no se pueden resolver se dejan
 * como estan. Sirve para que las imagenes incrustadas viajen en reenvios/respuestas.
 */
async function inlineCidImages(html: string, attachments: any[] | undefined): Promise<string> {
    const cids = extractCidReferences(html);
    if (cids.length === 0 || !attachments?.length) return html;

    const resolved = new Map<string, string>();
    await Promise.all(cids.map(async (cid) => {
        const att = findAttachmentForCid(cid, attachments);
        if (!att?.url) return;
        try {
            const res = await fetch(att.url);
            if (!res.ok) return;
            const blob = await res.blob();
            if (blob.size > CID_INLINE_LIMIT) return;
            const dataUrl: string = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(blob);
            });
            if (dataUrl.startsWith('data:image/')) resolved.set(cid, dataUrl);
        } catch { /* sin CORS / sin red: dejar el cid original */ }
    }));

    return replaceCidReferences(html, (cid) => resolved.get(cid) ?? null);
}

export function MailView() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const id = searchParams.get('id');
    const [data, setLocalData] = useState<EmailDetails | null>(null);
    const [loading, setLoading] = useState(false);
    const [summary, setSummary] = useState<string | null>(null);
    const [inviteActionEmailId, setInviteActionEmailId] = useState<string | null>(null);
    const [addCalendarEmailId, setAddCalendarEmailId] = useState<string | null>(null);

    const [availableLabels, setAvailableLabels] = useState<any[]>([]);
    const [showLabelMenu, setShowLabelMenu] = useState(false);
    const labelMenuTriggerRef = useRef<HTMLButtonElement>(null);
    const { getData, setData: setCacheData, invalidate } = useCache();

    const { openCompose } = useCompose();

    // Politica de imagenes remotas (bloqueadas por defecto; se permite por correo o por remitente).
    const [imagePolicy, setImagePolicy] = useState<RemoteImagePolicy>(emptyPolicy);
    useEffect(() => { setImagePolicy(loadPolicy()); }, []);
    const updateImagePolicy = (next: RemoteImagePolicy) => {
        setImagePolicy(next);
        savePolicy(next);
    };

    // Track expanded state for thread items
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (!id) return;
        let cancelled = false; // evita que una respuesta tardia de otro correo pise la vista actual

        async function fetchEmailAndLabels() {
            setLoading(true);
            try {
                // Fetch Email - Cache Key v2 to bust old structure
                const emailKey = `email-${id}-${ENABLE_THREAD_VIEW ? 'thread-v2' : 'single'}`;
                let emailData = await getData<EmailDetails>(emailKey);

                if (!emailData) {
                    emailData = await fetchDeduped(`/api/emails/${id}${ENABLE_THREAD_VIEW ? '?thread=true' : ''}`);
                    if (emailData?.email) {
                        setCacheData(emailKey, emailData);
                    }
                }

                // Fetch Common Labels
                const labelsKey = 'labels-all';
                let labelsData = await getData<any[]>(labelsKey);

                if (!labelsData) {
                    const resLabels = await fetch('/api/labels');
                    labelsData = await resLabels.json();
                    if (Array.isArray(labelsData)) {
                        setCacheData(labelsKey, labelsData);
                    }
                }

                if (cancelled) return;

                if (emailData?.email) {
                    // Mark as read if needed
                    if (!emailData.email.read) {
                        // Copia: emailData puede ser el mismo objeto que vive en la cache.
                        emailData = { ...emailData, email: { ...emailData.email, read: true } };
                        const readEmail = emailData!;
                        // Fire and forget API update
                        fetch(`/api/emails/${emailData.email.id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ read: true })
                        }).then(async () => {
                            // Optimistically update the list cache to avoid full re-render
                            const folder = readEmail.email.folder || 'inbox';
                            const listKey = `emails-${folder}`;
                            const cachedList = await getData<any[]>(listKey);

                            if (Array.isArray(cachedList)) {
                                const idx = cachedList.findIndex((e: any) => e.id === readEmail.email.id);
                                if (idx !== -1) {
                                    const newList = [...cachedList];
                                    newList[idx] = { ...newList[idx], read: true };
                                    // This triggers listeners (EmailList) but with specific data change
                                    // Since EmailList is memoized, only the changed item re-renders
                                    setCacheData(listKey, newList);
                                }
                            }

                            invalidate('stats-counts');
                        });
                        // Update cache with read status
                        setCacheData(emailKey, emailData);
                    }

                    setLocalData(emailData);
                    // Start with only the NEWEST email expanded (index 0 now)
                    if (emailData.thread && emailData.thread.length > 0) {
                        // Safety check for malformed data
                        const firstItem = emailData.thread[0];
                        const firstId = firstItem.email?.id || (firstItem as any).id; // Fallback if flat
                        if (firstId) setExpandedIds(new Set([firstId]));
                    } else {
                        setExpandedIds(new Set([emailData.email.id]));
                    }
                }
                if (Array.isArray(labelsData)) {
                    setAvailableLabels(labelsData);
                }
            } catch (err) {
                console.error(err);
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        fetchEmailAndLabels();
        return () => { cancelled = true; };
    }, [id, getData, setCacheData]);

    const handleUpdate = async (updates: any) => {
        if (!data) return;

        const emailId = data.email.id;
        const cacheKey = `email-${emailId}-${ENABLE_THREAD_VIEW ? 'thread-v2' : 'single'}`;
        const previousData = data;

        // Parche optimista sin claves de UI (toggleLabelId) y con las etiquetas ya resueltas.
        const patch = optimisticEmailPatch(updates, data.email.labels || [], availableLabels);
        const optimistic = applyEmailPatch(data, emailId, patch);

        setLocalData(optimistic);
        setCacheData(cacheKey, optimistic);

        try {
            const res = await fetch(`/api/emails/${emailId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });

            if (!res.ok) throw new Error('Failed to update');

            if (updates.toggleLabelId || updates.labelIds) {
                // La respuesta de PATCH es la fila de Email (labels) SIN adjuntos firmados ni replyTo resuelto:
                // se fusiona con lo que hay en pantalla en vez de reemplazar el correo.
                const json = await res.json();
                const merged = applyEmailPatch(optimistic, emailId, json, mergeEmailPatchResponse);
                setLocalData(merged);
                setCacheData(cacheKey, merged);
            }

            toast.success('Updated');
        } catch (error) {
            setLocalData(previousData);
            setCacheData(cacheKey, previousData);
            toast.error('Failed to update');
        }
    };

    const toggleLabel = (labelId: string) => {
        handleUpdate({ toggleLabelId: labelId });
    };

    const createAndApplyLabel = async () => {
        const rawName = window.prompt('Label name');
        const name = String(rawName || '').trim();

        if (!name) {
            return;
        }

        try {
            const response = await fetch('/api/labels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });

            if (!response.ok) {
                throw new Error('Failed to create label');
            }

            const label = await response.json();

            setAvailableLabels((prev) => {
                const exists = prev.some((item) => item.id === label.id);
                if (exists) return prev;
                return [...prev, label].sort((a, b) => String(a.name).localeCompare(String(b.name)));
            });

            const cachedLabels = (await getData<any[]>('labels-all')) || [];
            if (!cachedLabels.some((item) => item.id === label.id)) {
                setCacheData('labels-all', [...cachedLabels, label]);
            }

            toggleLabel(label.id);
            setShowLabelMenu(false);
            toast.success('Label created');
        } catch (error) {
            toast.error('Failed to create label');
        }
    };

    const handleInviteResponse = async (emailId: string, response: 'accepted' | 'tentative' | 'declined') => {
        setInviteActionEmailId(emailId);

        try {
            const res = await fetch(`/api/emails/${emailId}/rsvp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ response })
            });

            const json = await res.json();
            if (!res.ok) {
                throw new Error(json.error || 'Failed to send RSVP');
            }

            setLocalData((current) => {
                if (!current) return current;

                const updateItem = (item: EmailDetails): EmailDetails => {
                    if (item.email.id !== emailId) return item;
                    return {
                        ...item,
                        inviteResponse: json.inviteResponse,
                    };
                };

                return {
                    ...current,
                    inviteResponse: current.email.id === emailId ? json.inviteResponse : current.inviteResponse,
                    thread: current.thread?.map(updateItem),
                };
            });

            toast.success(`Invitation ${response}`);
        } catch (error: any) {
            toast.error(error.message || 'Failed to send RSVP');
        } finally {
            setInviteActionEmailId(null);
        }
    };

    const handleAddToCalendar = async (emailId: string, invitePreview: NonNullable<EmailDetails['invitePreview']>) => {
        setAddCalendarEmailId(emailId);
        try {
            const calendarsRes = await fetch('/api/calendars');
            if (!calendarsRes.ok) throw new Error('No se pudieron obtener los calendarios');
            const calendars: any[] = await calendarsRes.json();

            const target = calendars.find((c) => c.source === 'shared' && !c.isReadOnly)
                || calendars.find((c) => !c.isReadOnly);

            if (!target) throw new Error('No hay un calendario disponible');

            const res = await fetch('/api/calendar/events', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    calendarId: target.id,
                    title: invitePreview.title,
                    description: invitePreview.description || null,
                    location: invitePreview.meetUrl || invitePreview.location || null,
                    startsAt: invitePreview.startsAt,
                    endsAt: invitePreview.endsAt,
                    inviteUid: invitePreview.uid || null,
                    organizerEmail: invitePreview.organizerEmail || null,
                    organizerName: invitePreview.organizerName || null,
                    source: 'shared',
                }),
            });

            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'No se pudo agregar el evento');

            toast.success('Evento agregado al calendario');
        } catch (error: any) {
            toast.error(error.message || 'Error al agregar al calendario');
        } finally {
            setAddCalendarEmailId(null);
        }
    };

    const trashEmail = async () => {
        if (!data) return;

        // Trust the URL param first if available, otherwise fallback to email data
        const folderParam = searchParams.get('folder');
        const isTrashContext = folderParam === 'trash' || data.email.folder === 'trash';
        const currentFolder = data.email.folder || 'inbox';

        if (isTrashContext) {
            const toastId = toast.loading('Deleting permanently...');
            try {
                const res = await fetch(`/api/emails/${data.email.id}/delete`, { method: 'DELETE' });
                if (res.ok) {
                    toast.success('Deleted permanently', { id: toastId });

                    // Invalidate both potential keys to be safe
                    invalidate(`emails-trash`);
                    invalidate(`emails-${currentFolder}`);

                    router.push(`/?folder=${folderParam || 'inbox'}`);
                } else {
                    toast.error('Failed to delete', { id: toastId });
                }
            } catch (e) {
                toast.error('Failed to delete', { id: toastId });
            }
        } else {
            await handleUpdate({ folder: 'trash' });
            invalidate(`email-${data.email.id}`);
            invalidate(`emails-${currentFolder}`);
            invalidate('emails-trash'); // Ensure trash count/list updates
            router.push('/');
        }
    };

    /** Mensaje al que se responde: el pulsado (boton dentro del mensaje) o, en la barra, el mas reciente. */
    const resolveTarget = (item?: EmailDetails) => {
        if (item?.email) return { targetEmail: item.email, targetContent: item.content };
        const newest = data && data.thread && data.thread.length > 0 ? data.thread[0] : data;
        return { targetEmail: newest!.email, targetContent: newest!.content };
    };

    const buildQuote = async (targetEmail: EmailDetails['email'], targetContent: string) => {
        // Las imagenes cid: solo existen dentro del correo original: se incrustan para que sigan visibles.
        const content = await inlineCidImages(targetContent || '', targetEmail.attachments);
        const quoteHeader = `<div dir="ltr" class="gmail_attr">On ${formatDate(targetEmail.createdAt)}, ${targetEmail.from} wrote:<br></div>`;
        const quoteBody = `<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px #999 solid;padding-left:1ex">${content}</blockquote>`;
        return `<p></p><br><div class="gmail_quote">${quoteHeader}${quoteBody}</div>`;
    };

    const handleReply = async (item?: EmailDetails) => {
        if (!data) return;
        const { targetEmail, targetContent } = resolveTarget(item);
        const replyTarget = targetEmail.replyTo || targetEmail.from;
        const replyFrom = resolveSenderFromEmail(targetEmail);

        openCompose({
            id: crypto.randomUUID(),
            from: replyFrom,
            to: replyTarget,
            subject: targetEmail.subject.startsWith('Re:') ? targetEmail.subject : `Re: ${targetEmail.subject}`,
            body: await buildQuote(targetEmail, targetContent),
            minimized: false
        });
    };

    const handleReplyAll = async (item?: EmailDetails) => {
        if (!data) return;
        const { targetEmail, targetContent } = resolveTarget(item);

        const replyFrom = resolveSenderFromEmail(targetEmail);
        const ownEmails = [
            replyFrom || '',
            AccountManager.getActiveAccount()?.email || '',
            ...AccountManager.getAccounts().map(a => a.email),
            ...extractRecipientEmails(targetEmail.cleanTo).filter(e => !!AccountManager.getAccountByEmail(e)),
            ...extractRecipientEmails(targetEmail.to).filter(e => !!AccountManager.getAccountByEmail(e)),
        ];

        const recipients = buildReplyAllRecipients({
            from: targetEmail.from,
            replyTo: targetEmail.replyTo,
            to: targetEmail.to,
            cc: targetEmail.cc,
            ownEmails,
        });

        openCompose({
            id: crypto.randomUUID(),
            from: replyFrom,
            to: recipients.to.join(', '),
            cc: recipients.cc.length > 0 ? recipients.cc.join(', ') : undefined,
            subject: targetEmail.subject.startsWith('Re:') ? targetEmail.subject : `Re: ${targetEmail.subject}`,
            body: await buildQuote(targetEmail, targetContent),
            minimized: false
        });
    };

    const handleForward = async (item?: EmailDetails) => {
        if (!data) return;
        const { targetEmail, targetContent } = resolveTarget(item);
        const forwardFrom = resolveSenderFromEmail(targetEmail);
        const content = await inlineCidImages(targetContent || '', targetEmail.attachments);

        openCompose({
            id: crypto.randomUUID(),
            from: forwardFrom,
            to: '',
            attachments: (targetEmail.attachments || [])
                .filter((att: any) => att && (att.key || att.url))
                .map((att: any) => ({
                    filename: att.filename,
                    mimeType: att.mimeType || 'application/octet-stream',
                    size: att.size || 0,
                    key: att.key,
                    // Solo enviamos la URL si no hay key (el servidor lee los bytes por key).
                    url: att.key ? undefined : att.url,
                    forwarded: true,
                })),
            subject: targetEmail.subject.startsWith('Fwd:') ? targetEmail.subject : `Fwd: ${targetEmail.subject}`,
            // Cabecera escapada (ver lib/forward-header.ts): antes "Nombre <a@b.com>" se interpretaba como etiqueta HTML.
            body: `<p></p>${buildForwardHeaderHtml({ from: targetEmail.from, date: formatDate(targetEmail.createdAt), subject: targetEmail.subject, to: targetEmail.to })}<br>${content}`,
            minimized: false
        });
    };

    const toggleExpand = (id: string) => {
        const newSet = new Set(expandedIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setExpandedIds(newSet);
    };

    if (!id || !data) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center text-muted-foreground">
                <MousePointerClick className="h-8 w-8 opacity-50" />
                No message selected
            </div>
        );
    }

    const threadItems = (data.thread && data.thread.length > 0) ? data.thread : [data];

    return (
        <div className="flex h-full flex-col bg-background overflow-x-hidden">
            <div className="flex items-center gap-2 p-2 bg-background/95 backdrop-blur-sm sticky top-0 z-10 border-b overflow-x-auto">
                <button type="button" onClick={() => router.push('/')} className="md:hidden p-2" aria-label="Volver a la lista" title="Volver"><ArrowLeft className="h-5 w-5" aria-hidden="true" /></button>
                <div className="flex items-center gap-1">
                    <button onClick={() => {
                        const params = new URLSearchParams(searchParams);
                        params.delete('id');
                        router.push(`/?${params.toString()}`);
                    }} className="p-2 hover:bg-muted rounded-md hidden md:block" title="Cerrar" aria-label="Cerrar correo"><X className="h-4 w-4" aria-hidden="true" /></button>
                    <div className="h-5 w-px bg-border mx-1 hidden md:block" />

                    <button type="button" onClick={() => handleUpdate({ folder: 'archive' })} className="p-2 hover:bg-muted rounded-md" title="Archivar" aria-label="Archivar"><Archive className="h-4 w-4" aria-hidden="true" /></button>
                    <button type="button" onClick={() => handleUpdate({ folder: 'spam' })} className="p-2 hover:bg-muted rounded-md" title="Marcar como spam" aria-label="Marcar como spam"><ArchiveX className="h-4 w-4" aria-hidden="true" /></button>
                    <button type="button" onClick={trashEmail} className="p-2 hover:bg-muted rounded-md" title="Eliminar" aria-label="Eliminar"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                    <button
                        ref={labelMenuTriggerRef}
                        onClick={() => setShowLabelMenu((current) => !current)}
                        className="p-2 hover:bg-muted rounded-md"
                        title="Etiquetas"
                        aria-label="Etiquetas"
                        aria-haspopup="menu"
                        aria-expanded={showLabelMenu}
                    >
                        <Tag className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => handleReply()} className="p-2 hover:bg-muted rounded-md" title="Responder" aria-label="Responder"><Reply className="h-4 w-4 text-muted-foreground" aria-hidden="true" /></button>
                    <button type="button" onClick={() => handleReplyAll()} className="p-2 hover:bg-muted rounded-md" title="Responder a todos" aria-label="Responder a todos"><ReplyAll className="h-4 w-4 text-muted-foreground" aria-hidden="true" /></button>
                    <button type="button" onClick={() => handleForward()} className="p-2 hover:bg-muted rounded-md" title="Reenviar" aria-label="Reenviar"><Forward className="h-4 w-4 text-muted-foreground" aria-hidden="true" /></button>

                    {/* JSON Extensions Toolbar */}
                    <ExtensionLoader mountPoint="EMAIL_TOOLBAR" context={data?.email ? { ...data.email, content: data.content } : undefined} />
                </div>

                <Popover
                    trigger={labelMenuTriggerRef}
                    isOpen={showLabelMenu}
                    onClose={() => setShowLabelMenu(false)}
                    width={260}
                    header={false}
                    className="rounded-xl border border-border bg-card p-2 shadow-2xl"
                >
                    <div className="flex flex-col gap-1">
                        <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Labels</div>

                        {availableLabels.length === 0 ? (
                            <div className="px-2 py-2 text-sm text-muted-foreground">No labels yet</div>
                        ) : (
                            availableLabels.map((label) => {
                                const selected = Boolean(data?.email?.labels?.some((item: any) => item.id === label.id));

                                return (
                                    <button
                                        key={label.id}
                                        type="button"
                                        role="menuitemcheckbox"
                                        aria-checked={selected}
                                        onClick={() => toggleLabel(label.id)}
                                        className="flex items-center justify-between rounded-lg px-2 py-2 text-sm text-foreground/80 hover:bg-muted"
                                    >
                                        <span className="truncate">{label.name}</span>
                                        {selected ? <Check className="h-4 w-4 text-success" /> : null}
                                    </button>
                                );
                            })
                        )}

                        <div className="my-1 border-t border-border/60" />

                        <button
                            type="button"
                            onClick={createAndApplyLabel}
                            className="rounded-lg px-2 py-2 text-left text-sm font-medium text-primary hover:bg-primary/10"
                        >
                            Create label
                        </button>
                    </div>
                </Popover>

                <div className="h-5 w-px bg-border mx-1" />
                <button type="button" onClick={() => handleUpdate({ starred: !data.email?.starred })} className={cn("p-2 hover:bg-muted rounded-md", data.email?.starred && "text-yellow-500")} title={data.email?.starred ? 'Quitar estrella' : 'Marcar con estrella'} aria-label={data.email?.starred ? 'Quitar estrella' : 'Marcar con estrella'} aria-pressed={!!data.email?.starred}>
                    <Star className={cn("h-4 w-4", data.email?.starred && "fill-current")} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto overflow-x-hidden">
                <div className="p-6 pb-2">
                    <h2 className="text-xl font-semibold leading-tight">{threadItems[0].email.subject || '(No Subject)'}</h2>
                </div>

                <div className="flex flex-col overflow-x-hidden">
                    <AnimatePresence initial={false}>
                        {threadItems.map((item, index) => {
                            const isExpanded = expandedIds.has(item.email.id);
                            const isLast = index === threadItems.length - 1; // Actually now it's index 0 that is usually expanded if we reversed? No.
                            // Wait, API returns sorted DESC (Newest first).
                            // So threadItems[0] is newest. threadItems[length-1] is oldest.
                            // Render order: We usually want Oldest -> Newest (Gmail style) or Newest -> Oldest?
                            // User asked: "el orden al revez pls esta de el mas viejo al mas nuevo. primero el mas nuevo" -> "order reverse pls it is oldest to newest. first the newest".
                            // So we render Newest first (Index 0).

                            const cleanHtml = sanitizeHtml(item.content || "");
                            const remoteAllowed = isRemoteImagesAllowed(imagePolicy, item.email.id, item.email.from);
                            const remoteBlocked = !remoteAllowed && hasRemoteImages(cleanHtml);
                            // `cid:` -> URL firmada del adjunto inline (solo src="cid:...", solo /api/assets). Se calcula DESPUES de hasRemoteImages:
                            // las imagenes propias no cuentan como remotas y las remotas de verdad siguen bloqueadas.
                            const cidResolved = resolveInlineCidImages(cleanHtml, item.email.attachments, typeof window !== 'undefined' ? window.location.origin : undefined);
                            const invitePreview = item.invitePreview;
                            const inviteResponse = item.inviteResponse;
                            const formattedStartsAt = formatInviteDate(invitePreview?.startsAt);
                            const formattedEndsAt = formatInviteDate(invitePreview?.endsAt);
                            const isInviteActionPending = inviteActionEmailId === item.email.id;

                            return (
                                <motion.div
                                    key={item.email.id}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={{ duration: 0.3, delay: index * 0.05 }}
                                    className={cn("transition-all", isExpanded ? "bg-background shadow-sm z-10 my-1 rounded-sm" : "bg-muted/30 cursor-pointer hover:bg-muted/50")}
                                    layout
                                >
                                    <div
                                        className="p-4"
                                        role="button"
                                        tabIndex={0}
                                        aria-expanded={isExpanded}
                                        aria-label={`${isExpanded ? 'Contraer' : 'Expandir'} mensaje de ${item.email.from}`}
                                        onKeyDown={(e) => {
                                            if (e.target !== e.currentTarget) return;
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                toggleExpand(item.email.id);
                                            }
                                        }}
                                        onClick={(e) => {
                                            if (!isExpanded) {
                                                toggleExpand(item.email.id);
                                            } else {
                                                // Optional: Allow collapsing?
                                                toggleExpand(item.email.id);
                                            }
                                        }}
                                    >
                                        <div className="flex items-start justify-between gap-4 cursor-pointer min-w-0">
                                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                                <div className={cn("flex h-8 w-8 items-center justify-center rounded-full font-semibold text-xs transition-colors", isExpanded ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                                                    {item.email.from.charAt(0).toUpperCase()}
                                                </div>
                                                <div className="flex flex-col min-w-0">
                                                    <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-2">
                                                        <span className={cn("text-sm font-medium transition-colors truncate", !isExpanded && "text-muted-foreground")}>{item.email.from}</span>
                                                        <span className="text-xs text-muted-foreground truncate">&lt;{item.email.to}&gt;</span>
                                                    </div>
                                                    {isExpanded && item.authentication && (
                                                        <span className="mt-1"><AuthBadge auth={item.authentication} /></span>
                                                    )}
                                                    {isExpanded && item.email.cc && (
                                                        <span className="text-xs text-muted-foreground truncate">CC: {item.email.cc}</span>
                                                    )}
                                                    {isExpanded && item.email.bcc && (
                                                        <span className="text-xs text-muted-foreground truncate">BCC: {item.email.bcc}</span>
                                                    )}
                                                    <span className="text-xs text-muted-foreground sm:hidden">{formatDate(item.email.createdAt)}</span>
                                                    {!isExpanded && (
                                                        <motion.span
                                                            initial={{ opacity: 0 }}
                                                            animate={{ opacity: 1 }}
                                                            className="text-xs text-muted-foreground truncate max-w-[300px] opacity-70"
                                                        >
                                                            {item.email.snippet || "Click to expand..."}
                                                        </motion.span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="hidden text-xs text-muted-foreground whitespace-nowrap shrink-0 sm:block">{formatDate(item.email.createdAt)}</div>
                                        </div>
                                    </div>

                                    <AnimatePresence>
                                        {isExpanded && (
                                            <motion.div
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: 'auto' }}
                                                exit={{ opacity: 0, height: 0 }}
                                                transition={{ duration: 0.3, ease: "easeInOut" }}
                                                className="overflow-hidden"
                                            >
                                                <div className="px-4 pb-8 pl-4 sm:pl-14 min-w-0 overflow-x-hidden">
                                                    {invitePreview && (() => {
                                                        const meetProvider = getMeetProvider(invitePreview.meetUrl);
                                                        return (
                                                        <div className="mb-6 rounded-2xl border border-primary/20 bg-primary/7 p-4 text-sm text-foreground">
                                                            <div className="flex flex-col items-start gap-4 sm:flex-row sm:justify-between">
                                                                <div className="space-y-2">
                                                                    <div className="flex items-center gap-2 font-medium text-foreground">
                                                                        <CalendarDays className="h-4 w-4" />
                                                                        <span>Calendar invitation detected</span>
                                                                    </div>
                                                                    <div className="text-base font-semibold text-foreground">{invitePreview.title}</div>
                                                                    {formattedStartsAt && (
                                                                        <div className="flex items-center gap-2 text-foreground/80">
                                                                            <Clock className="h-4 w-4" />
                                                                            <span>
                                                                                {formattedStartsAt}
                                                                                {formattedEndsAt ? ` - ${formattedEndsAt}` : ''}
                                                                            </span>
                                                                        </div>
                                                                    )}
                                                                    {(invitePreview.location || invitePreview.meetUrl) && (
                                                                        <div className="flex items-center gap-2 text-foreground/80">
                                                                            <MapPin className="h-4 w-4 shrink-0" />
                                                                            {invitePreview.meetUrl ? (
                                                                                <a
                                                                                    href={invitePreview.meetUrl}
                                                                                    target="_blank"
                                                                                    rel="noopener noreferrer"
                                                                                    className="font-medium text-primary hover:underline"
                                                                                >
                                                                                    {meetProvider || invitePreview.location || 'Unirse a la reunión'}
                                                                                </a>
                                                                            ) : (
                                                                                <span>{invitePreview.location}</span>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                    <div className="flex flex-wrap gap-2 pt-1">
                                                                        <button
                                                                            type="button"
                                                                            disabled={isInviteActionPending}
                                                                            onClick={() => handleInviteResponse(item.email.id, 'accepted')}
                                                                            className="inline-flex items-center rounded-full border border-success/45 bg-card px-3 py-2 text-sm font-medium text-success transition-colors hover:bg-success/10 disabled:opacity-60"
                                                                        >
                                                                            Accept
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            disabled={isInviteActionPending}
                                                                            onClick={() => handleInviteResponse(item.email.id, 'tentative')}
                                                                            className="inline-flex items-center rounded-full border border-warning/45 bg-card px-3 py-2 text-sm font-medium text-warning transition-colors hover:bg-warning/10 disabled:opacity-60"
                                                                        >
                                                                            Maybe
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            disabled={isInviteActionPending}
                                                                            onClick={() => handleInviteResponse(item.email.id, 'declined')}
                                                                            className="inline-flex items-center rounded-full border border-destructive/45 bg-card px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
                                                                        >
                                                                            Decline
                                                                        </button>
                                                                        {invitePreview.meetUrl && (
                                                                            <a
                                                                                href={invitePreview.meetUrl}
                                                                                target="_blank"
                                                                                rel="noopener noreferrer"
                                                                                className="inline-flex items-center rounded-full border border-primary bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                                                                            >
                                                                                Unirse a {meetProvider || 'la reunión'}
                                                                            </a>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    disabled={addCalendarEmailId === item.email.id}
                                                                    onClick={() => handleAddToCalendar(item.email.id, invitePreview)}
                                                                    className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-primary/15 disabled:opacity-60"
                                                                >
                                                                    <CalendarDays className="h-4 w-4" />
                                                                    Agregar al calendario
                                                                </button>
                                                            </div>
                                                        </div>
                                                        );
                                                    })()}

                                                    {remoteBlocked && (
                                                        <div role="status" className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 py-2 text-xs text-foreground/80">
                                                            <ImageOff className="h-4 w-4 shrink-0" aria-hidden="true" />
                                                            <span className="flex-1 min-w-[180px]">Se bloquearon las imagenes remotas para proteger tu privacidad (pueden avisar al remitente de que abriste el correo).</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => updateImagePolicy(allowForEmail(imagePolicy, item.email.id))}
                                                                className="rounded-full border bg-background px-3 py-1 font-medium hover:bg-muted"
                                                            >
                                                                Cargar imagenes remotas
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => updateImagePolicy(allowForSender(imagePolicy, item.email.from))}
                                                                className="rounded-full border bg-background px-3 py-1 font-medium hover:bg-muted"
                                                            >
                                                                Siempre de este remitente
                                                            </button>
                                                        </div>
                                                    )}

                                                    <SafeIframe html={cidResolved.html} blockRemoteImages={!remoteAllowed} trustedImageSources={cidResolved.sources} />

                                                    <div className="mt-8 flex gap-2 opacity-100">
                                                        <button type="button" onClick={() => handleReply(item)} className="inline-flex items-center gap-2 px-4 py-2 rounded-full border bg-background hover:bg-muted text-sm font-medium transition-colors">
                                                            <Reply className="h-4 w-4" aria-hidden="true" /> Responder
                                                        </button>
                                                        <button type="button" onClick={() => handleReplyAll(item)} className="inline-flex items-center gap-2 px-4 py-2 rounded-full border bg-background hover:bg-muted text-sm font-medium transition-colors">
                                                            <ReplyAll className="h-4 w-4" aria-hidden="true" /> Responder a todos
                                                        </button>
                                                        <button type="button" onClick={() => handleForward(item)} className="inline-flex items-center gap-2 px-4 py-2 rounded-full border bg-background hover:bg-muted text-sm font-medium transition-colors">
                                                            <Forward className="h-4 w-4" aria-hidden="true" /> Reenviar
                                                        </button>
                                                    </div>

                                                    {item.email.attachments && item.email.attachments.length > 0 && (
                                                        <div className="mt-6 pt-4 border-t">
                                                            <div className="flex flex-wrap gap-3">
                                                                {item.email.attachments.map((att: any) => (
                                                                    <a key={att.id} href={att.url || '#'} download={att.filename || undefined} target="_blank" rel="noopener noreferrer" title={`Descargar ${att.filename || 'adjunto'}`} className="flex items-center gap-3 p-2 rounded-lg border bg-background hover:bg-accent transition-colors">
                                                                        <Icons.File className="w-4 h-4 text-muted-foreground" />
                                                                        <span className="text-sm truncate max-w-[200px]">{att.filename}</span>
                                                                    </a>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );
}
