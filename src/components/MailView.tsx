'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { ChevronsDownUp, ChevronsUpDown, Forward, MousePointerClick, Paperclip, RefreshCw, Reply, ReplyAll } from 'lucide-react';
import { useCache } from '@/contexts/CacheContext';
import { useCompose } from '@/contexts/ComposeContext';
import { useSession } from '@/components/SessionProvider';
import { useI18n } from '@/components/I18nProvider';
import { cn } from '@/lib/utils';
import { sanitizeHtml } from '@/lib/sanitizeHtml';
import { buildForwardQuote, buildForwardSubject, buildReplyQuote, buildReplySubject } from '@/lib/reply-builder';
import { makeReplyDeps } from '@/lib/reply-deps';
import { toast } from 'sonner';
import { fetchDeduped } from '@/lib/fetchdedupe';
import { ExtensionLoader } from './expansions/ExtensionLoader';
import { AccountManager } from '@/lib/account-manager';
import { splitAddressList, extractEmailOnly, buildReplyAllRecipients, findAttachmentForCid, replaceCidReferences, extractCidReferences } from '@/lib/email-utils';
import { resolveJoinLink } from '@/lib/calendar/join-link';
import { applyEmailPatch, initialExpandedIds } from '@/lib/mail-view-state';
import { loadPolicy, savePolicy, emptyPolicy, type RemoteImagePolicy } from '@/lib/remote-images';
import { COUNTS_CACHE_KEY, labelSelectionState, type LabelRef, type ListEmail } from '@/lib/mail-list';
import { ownAddressSet, senderName, threadParticipants } from '@/lib/mail-list-view';
import { labelDisplayName } from '@/lib/organizer/labels';
import { folderOfEmail, type MailActionId } from '@/lib/mail-actions';
import { buildShortcutMap } from '@/lib/shortcuts';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { mailBus, mailNav, neighbours } from '@/components/mail/mail-bus';
import { ReaderToolbar, type ReaderMenuKind } from '@/components/mail/ReaderToolbar';
import { ThreadMessage } from '@/components/mail/ThreadMessage';
import { ThreadDedupeToggle, useThreadDedupe } from '@/components/mail/useThreadDedupe';
import { MoveMenu } from '@/components/mail/MoveMenu';
import { SnoozeMenu } from '@/components/mail/SnoozeMenu';
import { useMailActions } from '@/components/mail/useMailActions';
import { useLabels } from '@/components/mail/useLabels';
import { buildPrintDocument, printHtmlDocument } from '@/components/mail/print-email';
import type { EmailDetails, InvitePreview } from '@/components/mail/reader-types';

const ENABLE_THREAD_VIEW = true;

function extractRecipientEmails(value?: string | null): string[] {
    return splitAddressList(value).map(extractEmailOnly).filter(Boolean);
}

function resolveSenderFromEmail(email: { to?: string | null; cleanTo?: string | null }): string | undefined {
    const candidates = extractRecipientEmails(email.cleanTo || email.to);
    for (const recipient of candidates) {
        if (AccountManager.getAccountByEmail(recipient)) return recipient;
    }
    return AccountManager.getActiveAccount()?.email || undefined;
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

const threadKey = (id: string) => `email-${id}-${ENABLE_THREAD_VIEW ? 'thread-v2' : 'single'}`;

/** Enlace de reunion de una invitacion: decide por HOST si es boton, texto con aviso o nada (ver lib/calendar/join-link). */
const resolveInviteJoin = (invite: InvitePreview) => resolveJoinLink({
    meetUrl: invite.meetUrl,
    location: invite.location,
    description: invite.description,
});

const quickBtn = cn(
    'inline-flex min-h-10 items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors',
    'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
);

export function MailView() {
    const { t, intlLocale } = useI18n();
    const searchParams = useSearchParams();
    const router = useRouter();
    const id = searchParams.get('id');
    const { data: session } = useSession();
    const rootRef = useRef<HTMLDivElement | null>(null);
    const [data, setLocalData] = useState<EmailDetails | null>(null);
    const dataRef = useRef<EmailDetails | null>(null);
    dataRef.current = data;
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [inviteActionEmailId, setInviteActionEmailId] = useState<string | null>(null);
    const [addCalendarEmailId, setAddCalendarEmailId] = useState<string | null>(null);
    const { getData, setData: setCacheData, invalidate } = useCache();
    const { openCompose } = useCompose();
    const openDraft = useCallback((d: { id: string; from?: string; to?: string; cc?: string; bcc?: string; subject?: string; body?: string; attachments?: unknown[]; inReplyToEmailId?: string | null; replyMode?: 'reply' | 'replyAll' | 'forward' | null }) => {
        openCompose({ id: d.id, draftId: d.id, from: d.from, to: d.to || '', cc: d.cc || '', bcc: d.bcc || '', subject: d.subject || '', body: d.body || '', minimized: false, attachments: (d.attachments as any[]) || [], ...(d.inReplyToEmailId ? { inReplyToEmailId: d.inReplyToEmailId, replyMode: d.replyMode || undefined } : {}) });
    }, [openCompose]);
    const actions = useMailActions({ openDraft });
    const actionsRef = useRef(actions);
    actionsRef.current = actions;
    const { labels: availableLabels, loading: labelsLoading, ensure: ensureLabels } = useLabels();

    // Politica de imagenes remotas (bloqueadas por defecto; se permite por correo o por remitente).
    const [imagePolicy, setImagePolicy] = useState<RemoteImagePolicy>(emptyPolicy);
    useEffect(() => { setImagePolicy(loadPolicy()); }, []);
    const updateImagePolicy = (next: RemoteImagePolicy) => {
        setImagePolicy(next);
        savePolicy(next);
    };

    // Mensajes expandidos del hilo y cuales llegaron sin leer (se resaltan aunque ya se marquen como leidos).
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    const [unreadIds, setUnreadIds] = useState<Set<string>>(new Set());

    const [menu, setMenu] = useState<ReaderMenuKind | null>(null);
    const menuAnchorRef = useRef<HTMLElement | null>(null);

    const ownAddresses = useMemo(
        () => ownAddressSet([session?.user?.email, AccountManager.getActiveAccount()?.email, ...AccountManager.getAccounts().map((a) => a.email)]),
        [session?.user?.email],
    );

    /** Marca como leido sin recargar la lista: PATCH + parche en la lista abierta + contadores. */
    const markReadQuiet = useCallback(async (emailId: string) => {
        try {
            const res = await fetch(`/api/emails/${emailId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ read: true }),
            });
            if (!res.ok) return;
            mailBus.emit({ type: 'patch', items: [{ id: emailId, updates: { read: true } }] });
            void invalidate(COUNTS_CACHE_KEY);
        } catch { /* se reintenta al volver a abrir */ }
    }, [invalidate]);

    useEffect(() => {
        if (!id) return;
        let cancelled = false; // evita que una respuesta tardia de otro correo pise la vista actual

        async function fetchEmail() {
            setLoading(true);
            setLoadError(false);
            try {
                const emailKey = threadKey(id as string);
                let emailData = await getData<EmailDetails>(emailKey);
                if (!emailData) {
                    emailData = await fetchDeduped(`/api/emails/${id}${ENABLE_THREAD_VIEW ? '?thread=true' : ''}`);
                    if (emailData?.email) setCacheData(emailKey, emailData);
                }
                if (cancelled) return;
                if (!emailData?.email) { setLoadError(true); return; }

                const items = emailData.thread && emailData.thread.length > 0 ? emailData.thread : [emailData];
                // Resaltar lo que llego sin leer ANTES de marcarlo como leido.
                setUnreadIds(new Set(items.filter((m) => m.email.read === false).map((m) => m.email.id)));
                setExpandedIds(initialExpandedIds(items.map((m) => ({ id: m.email.id, read: m.email.read })), emailData.email.id));

                if (!emailData.email.read) {
                    // Copia: emailData puede ser el mismo objeto que vive en la cache.
                    emailData = { ...emailData, email: { ...emailData.email, read: true } };
                    void markReadQuiet(emailData.email.id);
                    setCacheData(emailKey, emailData);
                }
                setLocalData(emailData);
            } catch (err) {
                console.error(err);
                if (!cancelled) setLoadError(true);
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        fetchEmail();
        return () => { cancelled = true; };
    }, [id, getData, setCacheData, markReadQuiet, reloadKey]);

    // Cambios hechos desde otras partes (lista, menus, deshacer) se reflejan en el lector abierto.
    useEffect(() => mailBus.subscribe((event) => {
        const current = dataRef.current;
        if (!current) return;
        let next = current;
        const apply = (emailId: string, patch: Record<string, unknown>) => { next = applyEmailPatch(next, emailId, patch); };
        if (event.type === 'patch') {
            event.items.forEach((i) => apply(i.id, i.updates));
        } else if (event.type === 'upsert') {
            event.emails.forEach((e) => apply(e.id, { read: e.read, starred: e.starred, labels: e.labels, folder: e.folder }));
        } else {
            return;
        }
        if (next !== current) {
            setLocalData(next);
            setCacheData(threadKey(current.email.id), next);
        }
    }), [setCacheData]);

    const threadItems = useMemo<EmailDetails[]>(() => (data ? (data.thread && data.thread.length > 0 ? data.thread : [data]) : []), [data]);
    const stale = Boolean(data && id && data.email.id !== id && !threadItems.some((m) => m.email.id === id));
    const folder = data?.email.folder || searchParams.get('folder') || 'inbox';

    /** Correos sobre los que actuan las acciones del lector: los mensajes del hilo que estan en la misma carpeta. */
    const targets = useCallback((): ListEmail[] => {
        const current = dataRef.current;
        if (!current) return [];
        const items = current.thread && current.thread.length > 0 ? current.thread : [current];
        const inFolder = items.filter((m) => m.email.folder === current.email.folder).map((m) => m.email as unknown as ListEmail);
        return inFolder.length > 0 ? inFolder : [current.email as unknown as ListEmail];
    }, []);

    const closeReader = useCallback(() => {
        const params = new URLSearchParams(searchParams.toString());
        params.delete('id');
        router.push(`/?${params.toString()}`);
    }, [router, searchParams]);

    const openEmail = useCallback((emailId: string) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('id', emailId);
        router.push(`/?${params.toString()}`);
    }, [router, searchParams]);

    // --- Acciones (las mismas que la lista: ver lib/mail-actions) ---
    const runAction = useCallback(async (action: MailActionId) => {
        const list = targets();
        if (list.length === 0) return;
        const a = actionsRef.current;
        switch (action) {
            case 'archive': case 'unarchive': case 'trash': case 'restore': case 'spam': case 'notSpam':
                closeReader();
                await a.moveEmails(list, action, folder);
                break;
            case 'deleteForever': case 'deleteDraft':
                if (await a.deleteForever(list, folder)) closeReader();
                break;
            case 'markRead': await a.setFlags(list.filter((e) => !e.read), { read: true }); break;
            case 'markUnread': await a.setFlags(list.filter((e) => e.read), { read: false }); break;
            case 'star': await a.setFlags(list.filter((e) => !e.starred), { starred: true }); break;
            case 'unstar': await a.setFlags(list.filter((e) => e.starred), { starred: false }); break;
            case 'cancelSchedule': if (await a.cancelSchedule(list)) closeReader(); break;
            case 'editScheduled': if (await a.cancelSchedule(list.slice(0, 1), { open: true })) closeReader(); break;
            case 'sendNow': if (await a.sendNow(list)) closeReader(); break;
            case 'deleteScheduled': if (await a.deleteScheduled(list)) closeReader(); break;
            default: break;
        }
    }, [targets, closeReader, folder]);

    const openMenu = (kind: ReaderMenuKind, anchor: HTMLElement | null) => {
        menuAnchorRef.current = anchor;
        if (kind === 'move' || kind === 'label') void ensureLabels();
        setMenu(kind);
    };

    const notSpam = useCallback(() => { void runAction('notSpam'); }, [runAction]);
    const toggleStar = () => { if (data) void runAction(data.email.starred ? 'unstar' : 'star'); };
    const toggleRead = () => { if (data) void runAction(data.email.read ? 'markUnread' : 'markRead'); };

    const allExpanded = threadItems.length > 0 && threadItems.every((m) => expandedIds.has(m.email.id));
    const toggleExpandAll = () => setExpandedIds(
        allExpanded
            ? new Set([threadItems[0]?.email.id].filter(Boolean) as string[])
            : new Set(threadItems.map((m) => m.email.id)),
    );
    const toggleExpand = useCallback((emailId: string) => {
        const current = dataRef.current;
        const item = current && (current.thread?.find((m) => m.email.id === emailId) ?? (current.email.id === emailId ? current : null));
        setExpandedIds((prev) => {
            const next = new Set(prev);
            if (next.has(emailId)) next.delete(emailId); else next.add(emailId);
            return next;
        });
        // Al expandir un mensaje sin leer se marca como leido (el resaltado se conserva en esta sesion).
        if (item && item.email.read === false && !expandedIdsRef.current.has(emailId)) void markReadQuiet(emailId);
    }, [markReadQuiet]);
    const expandedIdsRef = useRef(expandedIds);
    expandedIdsRef.current = expandedIds;

    // Los mensajes sin leer que se abren expandidos (ademas del principal) tambien se marcan como leidos.
    useEffect(() => {
        if (!data) return;
        for (const m of threadItems) {
            if (expandedIdsRef.current.has(m.email.id) && m.email.read === false && m.email.id !== data.email.id) void markReadQuiet(m.email.id);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data?.email.id, threadItems.length]);

    // --- Invitaciones ---
    const handleInviteResponse = async (emailId: string, response: 'accepted' | 'tentative' | 'declined') => {
        setInviteActionEmailId(emailId);
        try {
            const res = await fetch(`/api/emails/${emailId}/rsvp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ response }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || t('mailView.invite.rsvpFailed'));
            setLocalData((current) => {
                if (!current) return current;
                const updateItem = (item: EmailDetails): EmailDetails => (item.email.id !== emailId ? item : { ...item, inviteResponse: json.inviteResponse });
                return {
                    ...current,
                    inviteResponse: current.email.id === emailId ? json.inviteResponse : current.inviteResponse,
                    thread: current.thread?.map(updateItem),
                };
            });
            toast.success(t(`mailView.invite.responded.${response}`));
        } catch (error: any) {
            toast.error(error.message || t('mailView.invite.rsvpFailed'));
        } finally {
            setInviteActionEmailId(null);
        }
    };

    const handleAddToCalendar = async (emailId: string, invitePreview: InvitePreview) => {
        setAddCalendarEmailId(emailId);
        try {
            const calendarsRes = await fetch('/api/calendars');
            if (!calendarsRes.ok) throw new Error(t('mailView.invite.calendarsFailed'));
            const calendars: any[] = await calendarsRes.json();
            const target = calendars.find((c) => c.source === 'shared' && !c.isReadOnly) || calendars.find((c) => !c.isReadOnly);
            if (!target) throw new Error(t('mailView.invite.noCalendar'));
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
            if (!res.ok) throw new Error(json.error || t('mailView.invite.addFailed'));
            toast.success(t('mailView.invite.added'));
        } catch (error: any) {
            toast.error(error.message || t('mailView.invite.addFailed'));
        } finally {
            setAddCalendarEmailId(null);
        }
    };

    // --- Responder / reenviar ---
    /** Mensaje al que se responde: el pulsado (boton dentro del mensaje) o, en la barra, el mas reciente. */
    const resolveTarget = (item?: EmailDetails) => {
        if (item?.email) return { targetEmail: item.email, targetContent: item.content };
        const newest = data && data.thread && data.thread.length > 0 ? data.thread[0] : data;
        return { targetEmail: newest!.email, targetContent: newest!.content };
    };

    /** Cita de respuesta (estructura Gmail/Outlook, saneada y con tope de tamano): ver lib/reply-builder.ts. */
    const buildQuote = async (targetEmail: EmailDetails['email'], targetContent: string) => {
        // Las imagenes cid: solo existen dentro del correo original: se incrustan para que sigan visibles.
        const content = await inlineCidImages(targetContent || '', targetEmail.attachments);
        return buildReplyQuote(targetEmail, content, makeReplyDeps({ t, intlLocale })).body;
    };

    const handleReply = async (item?: EmailDetails) => {
        if (!data) return;
        const { targetEmail, targetContent } = resolveTarget(item);
        openCompose({
            id: crypto.randomUUID(),
            from: resolveSenderFromEmail(targetEmail),
            to: targetEmail.replyTo || targetEmail.from,
            subject: buildReplySubject(targetEmail.subject),
            body: await buildQuote(targetEmail, targetContent),
            inReplyToEmailId: targetEmail.id,
            replyMode: 'reply',
            minimized: false,
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
            subject: buildReplySubject(targetEmail.subject),
            body: await buildQuote(targetEmail, targetContent),
            inReplyToEmailId: targetEmail.id,
            replyMode: 'replyAll',
            minimized: false,
        });
    };

    const handleForward = async (item?: EmailDetails) => {
        if (!data) return;
        const { targetEmail, targetContent } = resolveTarget(item);
        const content = await inlineCidImages(targetContent || '', targetEmail.attachments);
        openCompose({
            id: crypto.randomUUID(),
            from: resolveSenderFromEmail(targetEmail),
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
            subject: buildForwardSubject(targetEmail.subject),
            // Bloque "Forwarded message" (estilo Gmail u Outlook segun preferencia), con los campos escapados.
            body: buildForwardQuote(targetEmail, content, makeReplyDeps({ t, intlLocale })).body,
            inReplyToEmailId: targetEmail.id,
            replyMode: 'forward',
            minimized: false,
        });
    };

    /** Reenviar como adjunto: cuerpo vacio; el servidor adjunta el .eml del original (attachOriginalEmlOf). */
    const handleForwardAsEml = (item?: EmailDetails) => {
        if (!data) return;
        const { targetEmail } = resolveTarget(item);
        openCompose({
            id: crypto.randomUUID(),
            from: resolveSenderFromEmail(targetEmail),
            to: '',
            subject: buildForwardSubject(targetEmail.subject),
            body: '<p></p>',
            inReplyToEmailId: targetEmail.id,
            replyMode: 'forward',
            attachOriginalEmlOf: targetEmail.id,
            minimized: false,
        });
    };

    // --- Imprimir ---
    const printThread = () => {
        if (!data) return;
        const dateFmt = new Intl.DateTimeFormat(intlLocale, { dateStyle: 'full', timeStyle: 'short' });
        const shown = threadItems.filter((m) => expandedIds.has(m.email.id));
        const list = (shown.length > 0 ? shown : [threadItems[0]]).slice().reverse();
        const doc = buildPrintDocument(
            list.map((m) => ({
                from: m.email.from,
                to: m.email.to,
                cc: m.email.cc,
                date: dateFmt.format(new Date(m.email.createdAt)),
                subject: m.email.subject || t('emailList.noSubject'),
                html: sanitizeHtml(m.content || ''),
                attachments: (m.email.attachments || []).map((a: any) => a.filename).filter(Boolean),
            })),
            {
                from: t('mailView.recipients.from'),
                to: t('mailView.recipients.to'),
                cc: t('mailView.recipients.cc'),
                date: t('mailView.recipients.date'),
                attachments: t('mailView.attachments.short'),
            },
            data.email.subject || t('emailList.noSubject'),
        );
        if (!printHtmlDocument(doc)) toast.error(t('mailView.toolbar.printFailed'));
    };

    // --- Teclado propio del lector (a: responder a todos, f: reenviar). El resto (e, #, !, z, j/k, v, l...) vive en la lista. ---
    const isVisible = () => Boolean(rootRef.current && rootRef.current.offsetParent !== null);
    useKeyboardShortcuts(buildShortcutMap({
        replyAll: () => { if (isVisible() && data) void handleReplyAll(); },
        forward: () => { if (isVisible() && data) void handleForward(); },
    }));

    // --- Vecinos (anterior / siguiente) segun el orden de la lista ---
    const [navIds, setNavIds] = useState<string[]>(() => mailNav.get());
    useEffect(() => mailNav.subscribe(() => setNavIds(mailNav.get())), []);
    const { prev, next } = neighbours(navIds, id);

    // --- Menus ---
    const menuTargets = menu ? targets() : [];
    const labelStateFor = (labelId: string) => labelSelectionState(menuTargets as any, menuTargets.map((e) => e.id), labelId);
    const participants = useMemo(() => threadParticipants(threadItems.map((m) => m.email as unknown as ListEmail), 4), [threadItems]);
    const threadDedupe = useThreadDedupe(threadItems);

    if (!id) {
        return (
            <div ref={rootRef} className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center text-muted-foreground">
                <MousePointerClick className="h-8 w-8 opacity-50" aria-hidden="true" />
                {t('mailView.noSelection')}
            </div>
        );
    }

    if (!data || stale) {
        return (
            <div ref={rootRef} className="flex h-full flex-col bg-background">
                {loadError && !loading ? (
                    <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                        <p className="text-sm font-medium text-foreground">{t('mailView.loadError.title')}</p>
                        <p className="text-xs text-muted-foreground">{t('mailView.loadError.help')}</p>
                        <div className="flex gap-2">
                            <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> {t('emailList.loadError.retry')}
                            </button>
                            <button type="button" onClick={closeReader} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('mailView.toolbar.close')}</button>
                        </div>
                    </div>
                ) : (
                    <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex-1 space-y-4 p-6">
                        <span className="sr-only">{t('common.loading')}</span>
                        <div className="h-6 w-2/3 animate-pulse rounded bg-muted" />
                        <div className="flex items-center gap-3"><div className="h-9 w-9 animate-pulse rounded-full bg-muted" /><div className="h-4 w-1/3 animate-pulse rounded bg-muted" /></div>
                        <div className="h-3 w-full animate-pulse rounded bg-muted" />
                        <div className="h-3 w-5/6 animate-pulse rounded bg-muted" />
                        <div className="h-3 w-4/6 animate-pulse rounded bg-muted" />
                    </div>
                )}
            </div>
        );
    }

    const subject = threadItems[0].email.subject || t('emailList.noSubject');
    const labels: LabelRef[] = (data.email.labels || []) as LabelRef[];
    const toolbarProps = {
        folder,
        read: Boolean(data.email.read),
        starred: Boolean(data.email.starred),
        hasPrev: Boolean(prev),
        hasNext: Boolean(next),
        threadSize: threadItems.length,
        allExpanded,
        onBack: closeReader,
        onClose: closeReader,
        onPrev: () => { if (prev) openEmail(prev); },
        onNext: () => { if (next) openEmail(next); },
        onAction: (a: MailActionId) => { void runAction(a); },
        onMenu: openMenu,
        onToggleStar: toggleStar,
        onToggleRead: toggleRead,
        onPrint: printThread,
        onToggleExpandAll: toggleExpandAll,
    };

    return (
        <div ref={rootRef} className="flex h-full flex-col overflow-x-hidden bg-background" data-mail-reader>
            <ReaderToolbar
                variant="top"
                {...toolbarProps}
                extra={<ExtensionLoader mountPoint="EMAIL_TOOLBAR" context={data?.email ? { ...data.email, content: data.content } : undefined} />}
            />

            <div className="flex-1 overflow-y-auto overflow-x-hidden" aria-busy={loading || undefined}>
                <div className="px-4 pb-2 pt-5 sm:px-6">
                    <h2 className="text-xl font-semibold leading-tight">{subject}</h2>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {labels.length > 0 && (
                            <ul className="flex flex-wrap items-center gap-1.5" aria-label={t('emailList.row.labels')}>
                                {labels.map((label) => (
                                    <li key={label.id} className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-chip px-1.5 py-0.5 text-[11px] font-medium text-chip-foreground">
                                        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: label.color || undefined }} />
                                        {labelDisplayName(label.name, t)}
                                    </li>
                                ))}
                            </ul>
                        )}
                        {threadItems.length > 1 && (
                            <>
                                <span>{t('emailList.threadMessages', { n: threadItems.length })}</span>
                                <span aria-hidden="true">·</span>
                                <span className="truncate">{participants.names.join(', ')}{participants.extra > 0 ? ` +${participants.extra}` : ''}</span>
                                <ThreadDedupeToggle state={threadDedupe} className="ml-auto" />
                                <button
                                    type="button"
                                    onClick={toggleExpandAll}
                                    className={`${threadDedupe.relevant ? '' : 'ml-auto '}inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                                >
                                    {allExpanded ? <ChevronsDownUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden="true" />}
                                    {allExpanded ? t('mailView.thread.collapseAll') : t('mailView.thread.expandAll')}
                                </button>
                            </>
                        )}
                    </div>
                </div>

                <div className="flex flex-col overflow-x-hidden border-t border-border" role="feed" aria-label={t('mailView.thread.label')}>
                    {threadItems.map((item, index) => (
                        <ThreadMessage
                            key={item.email.id}
                            item={item}
                            index={index}
                            expanded={expandedIds.has(item.email.id)}
                            wasUnread={unreadIds.has(item.email.id)}
                            imagePolicy={imagePolicy}
                            onImagePolicy={updateImagePolicy}
                            onToggle={toggleExpand}
                            onReply={handleReply}
                            onReplyAll={handleReplyAll}
                            onForward={handleForward}
                            inviteBusy={inviteActionEmailId === item.email.id}
                            calendarBusy={addCalendarEmailId === item.email.id}
                            onInvite={handleInviteResponse}
                            onAddToCalendar={handleAddToCalendar}
                            own={ownAddresses}
                            resolveJoin={resolveInviteJoin}
                            dedupe={threadDedupe.results.get(item.email.id)}
                            hideDuplicates={threadDedupe.relevant ? threadDedupe.enabled : undefined}
                            onNotSpam={notSpam}
                        />
                    ))}
                </div>

                {/* Respuesta rapida al pie del hilo */}
                {folder !== 'drafts' && (
                    <section aria-label={t('mailView.reply.section')} className="m-4 rounded-xl border border-border bg-card p-3 text-card-foreground sm:mx-6 sm:mb-6">
                        <p className="mb-2 text-xs text-muted-foreground">
                            {t('mailView.reply.to', { name: senderName(threadItems[0].email.from) || threadItems[0].email.from })}
                        </p>
                        <div className="flex flex-wrap gap-2">
                            <button type="button" data-quick-reply="reply" onClick={() => void handleReply()} className={quickBtn}><Reply className="h-4 w-4" aria-hidden="true" /> {t('mailView.reply.reply')}</button>
                            <button type="button" data-quick-reply="replyAll" onClick={() => void handleReplyAll()} className={quickBtn}><ReplyAll className="h-4 w-4" aria-hidden="true" /> {t('mailView.reply.replyAll')}</button>
                            <button type="button" data-quick-reply="forward" onClick={() => void handleForward()} className={quickBtn}><Forward className="h-4 w-4" aria-hidden="true" /> {t('mailView.reply.forward')}</button>
                            <button type="button" data-quick-reply="forwardEml" onClick={() => handleForwardAsEml()} className={quickBtn}><Paperclip className="h-4 w-4" aria-hidden="true" /> {t('mailView.reply.forwardEml')}</button>
                        </div>
                    </section>
                )}
            </div>

            <ReaderToolbar variant="bottom" {...toolbarProps} />

            {(menu === 'move' || menu === 'label') && (
                <MoveMenu
                    open
                    mode={menu}
                    onClose={() => setMenu(null)}
                    anchorRef={menuAnchorRef}
                    currentFolder={folderOfEmail(data.email as unknown as ListEmail, folder)}
                    labels={availableLabels}
                    loading={labelsLoading}
                    labelState={labelStateFor}
                    onMove={(to) => { const list = targets(); closeReader(); void actions.moveToFolder(list, to, folder); }}
                    onToggleLabel={(label) => { void actions.applyLabel(targets(), label); }}
                />
            )}
            {(menu === 'snooze' || menu === 'reschedule') && (
                <SnoozeMenu
                    open
                    variant={menu}
                    onClose={() => setMenu(null)}
                    anchorRef={menuAnchorRef}
                    onSnooze={(until) => {
                        const list = targets();
                        if (menu === 'reschedule') { void actions.reschedule(list, until); return; }
                        closeReader();
                        void actions.snoozeEmails(list, until, folder);
                    }}
                />
            )}
            {actions.dialog}
        </div>
    );
}
