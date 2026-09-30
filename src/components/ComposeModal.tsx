'use client';

import { useState, useEffect, useRef, useId, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { X, Minimize2, Trash2, Maximize2, Loader2, Send, Paperclip, Clock, Mic, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { useCompose } from '@/contexts/ComposeContext';
// Local expansions removed.
// import { clientExpansionRegistry } from '@/lib/expansions/client/registry';
import { cleanOutgoingHtml } from '@/lib/outgoing-html';
// import { ensureClientExpansions } from '@/lib/expansions/client/core-expansions';
// Initialize client expansions
// ensureClientExpansions();
import { useCache } from '@/contexts/CacheContext';
import { useOffline } from '@/contexts/OfflineContext';
import { cn } from '@/lib/utils';
import { TagInput } from './ui/TagInput';
import { DateTimePicker } from './ui/DateTimePicker';
import { Editor } from './Editor';
import { ExtensionLoader } from '@/components/expansions/ExtensionLoader';
import { SlashActionRunner, type SlashRun } from '@/components/expansions/SlashActionRunner';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { collectOverlays, collectSlashCommands, type SlashCommand } from '@/lib/slash-commands';
import { ComposerConferencingPanel, type ComposerInsertion } from '@/components/conferencing/ComposerConferencingPanel';
import { useSession } from '@/components/SessionProvider';
// import { ClientExpansions } from '@/lib/expansions/client/renderer'; // Legacy
import { ClientExpansionContext } from '@/lib/expansions/client/types'; // Legacy
import { Popover } from './ui/Popover';
import { motion } from 'framer-motion';
import { executeExtensionAction, fetchExpansions } from '@/lib/expansions/api';
import { AccountManager } from '@/lib/account-manager';
import { splitAddressList } from '@/lib/email-utils';
import { parseRecipientList } from '@/lib/mail-validation';
import { DraftSaver, toDraftAttachments, type DraftPayload, type SaveStatus } from '@/lib/draft-autosave';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { buildSealedEmailBody, createSealedLink, validateSealOptions } from '@/lib/sealed/client';
import { sealedMessages } from '@/lib/sealed/messages';
import { useI18n } from '@/components/I18nProvider';
import { useDictation } from '@/hooks/useDictation';
import { dictationMessages, issueMessage } from '@/lib/dictation/dictation';
import { emitComposeOpened } from '@/lib/expansions/client/emit-event';

function extractPlainTextFromHtml(value: string) {
    return String(value || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeRecipientEmails(values: string[]) {
    const normalized = values
        .map((value) => String(value || '').trim())
        .map((value) => {
            const angled = value.match(/<([^>]+)>/);
            const candidate = angled?.[1] ? angled[1].trim() : value;
            return candidate.toLowerCase();
        })
        .filter((email) => email.includes('@'));

    return Array.from(new Set(normalized));
}

interface ComposeModalProps {
    id: string;
    initialFrom?: string;
    initialTo?: string;
    initialCc?: string;
    initialBcc?: string;
    initialSubject?: string;
    initialBody?: string;
    initialMinimized?: boolean;
    initialDraftId?: string;
    initialAttachments?: any[];
    /** Correo al que se responde / que se reenvia (encadena el hilo en el servidor). */
    inReplyToEmailId?: string;
    replyMode?: 'reply' | 'replyAll' | 'forward';
    /** Reenviar como adjunto .eml: el servidor adjunta el .eml del correo con este id. */
    attachOriginalEmlOf?: string;
    index: number;
}

export function ComposeModal({
    id,
    initialFrom = '',
    initialTo = '',
    initialCc = '',
    initialBcc = '',
    initialSubject = '',
    initialBody = '',
    initialMinimized = false,
    initialDraftId,
    initialAttachments = [],
    inReplyToEmailId,
    replyMode,
    attachOriginalEmlOf,
    index,
}: ComposeModalProps) {
    const { closeCompose, toggleMinimize, updateCompose, windows } = useCompose();
    const { getData, setData } = useCache();
    const { addToQueue, isOnline } = useOffline();
    const { data: session } = useSession();
    const router = useRouter();

    // Hook COMPOSE_OPENED (fire-and-forget; el modo se infiere del asunto inicial; el servidor valida ids).
    useEffect(() => {
        const subjectHint = String(initialSubject || '').trim();
        const mode = /^(fwd?|rv):/i.test(subjectHint) ? 'forward' : /^re:/i.test(subjectHint) ? (initialCc ? 'replyAll' : 'reply') : 'new';
        emitComposeOpened({ mode: replyMode || mode, ...(initialDraftId ? { draftId: initialDraftId } : {}), ...(inReplyToEmailId ? { inReplyToEmailId } : {}) });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const [toTags, setToTags] = useState<string[]>(splitAddressList(initialTo));
    const [senderOptions, setSenderOptions] = useState<string[]>([]);
    const [fromAddress, setFromAddress] = useState(String(initialFrom || '').trim().toLowerCase());
    const [subject, setSubject] = useState(initialSubject);
    const [body, setBody] = useState(initialBody);
    const [attachments, setAttachments] = useState<any[]>(initialAttachments);
    const [isUploading, setIsUploading] = useState(false);

    // Slash Commands Registry (Computed)
    const [activeSlashComponent, setActiveSlashComponent] = useState<{ Component: React.ComponentType<any>, id: string, args?: string } | null>(null);
    const { extensions: installedExtensions } = useDomainConfig();
    const [slashRun, setSlashRun] = useState<SlashRun | null>(null);
    const slashNonce = useRef(0);
    const runSlashCommand = useCallback((command: SlashCommand, args: string) => {
        const extension = installedExtensions.find((ext: any) => (ext?.template?.id || ext?.id) === command.extensionId);
        slashNonce.current += 1;
        setSlashRun({
            nonce: slashNonce.current,
            extensionId: command.extensionId || '',
            action: command.action,
            overlays: collectOverlays(extension),
            args,
        });
    }, [installedExtensions]);



    // CC/BCC State
    const [ccTags, setCcTags] = useState<string[]>(splitAddressList(initialCc));
    const [bccTags, setBccTags] = useState<string[]>(splitAddressList(initialBcc));

    const [showCcBcc, setShowCcBcc] = useState(!!initialCc || !!initialBcc);
    const [sending, setSending] = useState(false);
    // Envio sellado: el cuerpo se cifra en el navegador (AES-256-GCM) y el correo lleva solo el enlace (clave en el #fragmento).
    const [sealed, setSealed] = useState(false);
    const [sealPanelOpen, setSealPanelOpen] = useState(false);
    const [sealPassword, setSealPassword] = useState('');
    const [sealMaxViews, setSealMaxViews] = useState<number | null>(null);
    const { locale: uiLocale, t: tr } = useI18n();
    // Panel de videoconferencia del composer (comandos de nucleo "/zoom" y "/meet").
    const [conferencingPanel, setConferencingPanel] = useState<'zoom' | 'google-meet' | null>(null);
    const sm = sealedMessages(uiLocale);
    // 'Copiar enlace': crea el mensaje sellado y copia el enlace SIN enviar correo (se comparte por otro canal).
    const [sealCopying, setSealCopying] = useState(false);
    const [sealCopiedLink, setSealCopiedLink] = useState<{ url: string; copied: boolean } | null>(null);
    const [schedulePickerOpen, setSchedulePickerOpen] = useState(false);
    const [scheduleValue, setScheduleValue] = useState('');
    const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
    const [mailGroupAliases, setMailGroupAliases] = useState<Record<string, string[]>>({});
    const [isGoogleLinked, setIsGoogleLinked] = useState(false);
    const [isGoogleMeetAvailable, setIsGoogleMeetAvailable] = useState(false);

    // Track if user maximized the window manually (custom state, separate from minimize)
    const [maximized, setMaximized] = useState(false);

    const editorRef = useRef<any>(null);

    // Middleware Refs
    const beforeSendHandlers = useRef<Array<(details: any) => Promise<any>>>([]);
    const registerBeforeSend = (handler: any) => {
        beforeSendHandlers.current.push(handler);
    };

    // Voice Dictation (Web Speech API): el texto final se inserta en el cursor del editor; el provisional se ve en el rotulo.
    const dictMsg = dictationMessages(uiLocale);
    const dictation = useDictation({ locale: uiLocale, onText: (html) => editorRef.current?.insertContent(html) });

    // Resize state (Desktop)
    const [dimensions, setDimensions] = useState({ width: 500, height: 550 });
    const [isResizing, setIsResizing] = useState(false);
    const resizeRef = useRef<{ startX: number, startY: number, startWidth: number, startHeight: number } | null>(null);

    const handleResizeStart = (e: React.MouseEvent) => {
        if (maximized) return;
        setIsResizing(true);
        resizeRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            startWidth: dimensions.width,
            startHeight: dimensions.height
        };
        e.preventDefault();
    };

    useEffect(() => {
        const collectSenderOptions = () => {
            const options = new Set<string>();

            if (session?.user?.email) {
                options.add(String(session.user.email).trim().toLowerCase());
            }

            if (initialFrom) {
                options.add(String(initialFrom).trim().toLowerCase());
            }

            try {
                const storedAccounts = AccountManager.getAccounts();
                storedAccounts.forEach((account) => {
                    const email = String(account?.email || '').trim().toLowerCase();
                    if (email.includes('@')) {
                        options.add(email);
                    }
                });
            } catch {
                // Ignore local storage parsing errors.
            }

            const nextOptions = Array.from(options);
            setSenderOptions(nextOptions);

            if (!fromAddress && nextOptions.length > 0) {
                setFromAddress(nextOptions[0]);
            }
        };

        collectSenderOptions();
        if (typeof window !== 'undefined') {
            window.addEventListener('account-change', collectSenderOptions);
            return () => window.removeEventListener('account-change', collectSenderOptions);
        }
    }, [session?.user?.email, initialFrom, fromAddress]);

    useEffect(() => {
        fetch('/api/settings', { cache: 'no-store' })
            .then((response) => response.json())
            .then((data) => {
                const groups = data?.expansionSettings?.['core-mail-groups']?.groups;
                if (groups && typeof groups === 'object') {
                    setMailGroupAliases(groups);
                }
                setIsGoogleLinked(Boolean(data?.isGoogleLinked));
                setIsGoogleMeetAvailable(Boolean(data?.isGoogleMeetAvailable));
            })
            .catch(() => undefined);
    }, []);

    // Always honor the selected/from address first so reply/forward uses the correct mailbox.
    const effectiveSenderEmail = fromAddress || session?.user?.email || '';

    const resolveSenderHeaders = () => {
        const token = AccountManager.getTokenForEmail(effectiveSenderEmail);
        const headers: Record<string, string> = {};
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
        return headers;
    };

    const canSwitchSender = senderOptions.length > 1;

    useEffect(() => {
        if (!isResizing) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (!resizeRef.current) return;
            const deltaX = resizeRef.current.startX - e.clientX;
            const deltaY = resizeRef.current.startY - e.clientY;

            setDimensions({
                width: Math.max(400, Math.min(typeof window !== 'undefined' ? window.innerWidth - 40 : 1000, resizeRef.current.startWidth + deltaX)),
                height: Math.max(400, Math.min(typeof window !== 'undefined' ? window.innerHeight - 40 : 1000, resizeRef.current.startHeight + deltaY))
            });
        };

        const handleMouseUp = () => setIsResizing(false);

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing, maximized]);

    // Simple toast func since component doesn't import
    // Ideally use 'sonner'





    const activeWindow = windows.find(w => w.id === id);
    const minimized = activeWindow?.minimized ?? initialMinimized;

    // --- Autosave de borradores (ver src/lib/draft-autosave.ts) ---
    // Un solo guardador por composer: guardados serializados (sin duplicados), flush al cerrar/ocultar,
    // y discard() al enviar/eliminar para que un POST tardio no resucite el borrador.
    const senderHeadersRef = useRef(resolveSenderHeaders);
    senderHeadersRef.current = resolveSenderHeaders;
    const saverRef = useRef<DraftSaver | null>(null);
    if (saverRef.current === null) {
        saverRef.current = new DraftSaver({
            initialDraftId,
            getHeaders: () => senderHeadersRef.current(),
            onStatus: (status) => setSaveStatus(status),
            // Mantiene el draftId en el contexto: reabrir el mismo borrador desde la lista no abre un duplicado.
            onDraftId: (draftId) => updateCompose(id, { draftId }),
        });
    }
    const baselineKeyRef = useRef<string | null>(null);
    const dirtyRef = useRef(false);

    useEffect(() => {
        const saver = saverRef.current;
        if (!saver) return;
        const payload: DraftPayload = {
            from: effectiveSenderEmail,
            to: toTags.join(', '),
            cc: ccTags.join(', '),
            bcc: bccTags.join(', '),
            subject,
            body,
            attachments: toDraftAttachments(attachments),
            ...(inReplyToEmailId ? { inReplyToEmailId } : {}),
            ...(inReplyToEmailId && replyMode ? { replyMode } : {}),
        };
        // Hasta la primera edicion real (el remitente se resuelve tras montar) no se guarda nada:
        // abrir una respuesta sin escribir no debe crear un borrador.
        const { from: _from, ...content } = payload;
        const contentKey = JSON.stringify(content);
        if (!dirtyRef.current) {
            if (baselineKeyRef.current === null || baselineKeyRef.current === contentKey) {
                baselineKeyRef.current = contentKey;
                saver.setBaseline(payload);
                return;
            }
            dirtyRef.current = true;
        }
        saver.schedule(payload);
    }, [toTags, ccTags, bccTags, subject, body, attachments, effectiveSenderEmail]);

    // Cerrar la pestana/ventana u ocultarla: no perder los ultimos segundos de escritura.
    useEffect(() => {
        const saver = saverRef.current;
        const onHide = () => saver?.flushOnUnload();
        const onVisibility = () => { if (document.visibilityState === 'hidden') void saver?.flush(); };
        window.addEventListener('pagehide', onHide);
        window.addEventListener('beforeunload', onHide);
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            window.removeEventListener('pagehide', onHide);
            window.removeEventListener('beforeunload', onHide);
            document.removeEventListener('visibilitychange', onVisibility);
            // Cierre de la ventana (X, Escape): guardar ahora lo pendiente. Tras enviar/eliminar el saver
            // ya esta descartado y esto no hace nada.
            void saver?.flush();
        };
    }, []);

    const syncCalendarEventsFromAttachments = async (
        currentTo: string[],
        currentCc: string[],
        currentAttachments: any[]
    ) => {
        const attachmentsToSync = currentAttachments
            .map((attachment, index) => ({ attachment, index }))
            .filter(({ attachment }) => attachment?.calendarEvent);

        if (attachmentsToSync.length === 0) {
            return currentAttachments;
        }

        const hasUnsyncedEvents = attachmentsToSync.some(({ attachment }) => !attachment?.calendarEvent?.syncedEventId);
        let writableCalendar: any = null;

        if (hasUnsyncedEvents) {
            const calendarsResponse = await fetch('/api/calendars', { cache: 'no-store' });
            if (!calendarsResponse.ok) {
                throw new Error('No se pudo consultar los calendarios para guardar la invitacion');
            }

            const calendars = await calendarsResponse.json();
            writableCalendar = Array.isArray(calendars)
                ? (calendars.find((calendar: any) => calendar.source === 'local' && !calendar.isReadOnly)
                    || calendars.find((calendar: any) => !calendar.isReadOnly))
                : null;

            if (!writableCalendar?.id) {
                throw new Error('No hay un calendario editable disponible para registrar el evento');
            }
        }

        const composerRecipients = normalizeRecipientEmails([...currentTo, ...currentCc]);

        const nextAttachments = [...currentAttachments];

        for (const { attachment, index } of attachmentsToSync) {
            const calendarEvent = attachment.calendarEvent || {};
            const attendees = composerRecipients;

            if (!calendarEvent.startsAt || !calendarEvent.endsAt) {
                throw new Error('La invitacion no tiene fecha de inicio y fin validas para guardar en calendario');
            }

            const organizerEmail = String(calendarEvent.organizerEmail || session?.user?.email || '').trim().toLowerCase() || null;
            const organizerName = String(calendarEvent.organizerName || session?.user?.name || organizerEmail || '').trim() || null;

            let syncedEventId = calendarEvent.syncedEventId || null;

            if (!syncedEventId) {
                const createEventResponse = await fetch('/api/calendar/events', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        calendarId: writableCalendar.id,
                        title: calendarEvent.title || subject || 'New Event',
                        description: calendarEvent.description || null,
                        location: calendarEvent.location || null,
                        startsAt: calendarEvent.startsAt,
                        endsAt: calendarEvent.endsAt,
                        attendees,
                        inviteUid: calendarEvent.inviteUid || null,
                        organizerEmail,
                        organizerName,
                        source: 'local',
                    }),
                });

                const createEventResult = await createEventResponse.json().catch(() => null);
                if (!createEventResponse.ok) {
                    throw new Error(createEventResult?.error || 'No se pudo guardar el evento en calendario');
                }

                syncedEventId = createEventResult?.id || createEventResult?.eventId || null;
            } else {
                const updateEventResponse = await fetch(`/api/calendar/events/${syncedEventId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: calendarEvent.title || subject || 'New Event',
                        location: calendarEvent.location || null,
                        startsAt: calendarEvent.startsAt,
                        endsAt: calendarEvent.endsAt,
                        attendees,
                    }),
                });

                if (!updateEventResponse.ok) {
                    const updateResult = await updateEventResponse.json().catch(() => null);
                    const updateError = String(updateResult?.error || '').toLowerCase();
                    if (!updateError.includes('read-only')) {
                        throw new Error(updateResult?.error || 'No se pudo actualizar el evento en calendario');
                    }
                }
            }

            if (!syncedEventId) {
                throw new Error('No se pudo sincronizar el evento antes de enviar la invitacion');
            }

            const inviteAttachmentResponse = await fetch(`/api/calendar/events/${syncedEventId}/attach-invite`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: calendarEvent.title || subject || 'New Event',
                    description: calendarEvent.description || null,
                    location: calendarEvent.location || null,
                    startsAt: calendarEvent.startsAt,
                    endsAt: calendarEvent.endsAt,
                    to: attendees,
                    inviteUid: calendarEvent.inviteUid || null,
                    organizerEmail,
                    organizerName,
                    replaceAttendees: true,
                }),
            });

            const inviteAttachmentResult = await inviteAttachmentResponse.json().catch(() => null);
            if (!inviteAttachmentResponse.ok || !inviteAttachmentResult?.attachment) {
                throw new Error(inviteAttachmentResult?.error || 'No se pudo actualizar el adjunto de invitacion');
            }

            nextAttachments[index] = {
                ...attachment,
                ...inviteAttachmentResult.attachment,
                calendarEvent: {
                    ...calendarEvent,
                    ...inviteAttachmentResult?.attachment?.calendarEvent,
                    syncedEventId: inviteAttachmentResult?.eventId || syncedEventId,
                    inviteUid: inviteAttachmentResult?.inviteUid || calendarEvent.inviteUid,
                    organizerEmail,
                    organizerName,
                    attendees,
                }
            };
        }

        setAttachments(nextAttachments);
        return nextAttachments;
    };

    /** Valida destinatarios (formato, IDN, nombres con coma) antes de tocar la red. */
    const validateRecipients = (): boolean => {
        const invalid = [toTags, ccTags, bccTags].flatMap((tags) => parseRecipientList(tags).invalid);
        if (invalid.length > 0) {
            toast.error(`Direccion no valida: ${invalid[0]}`);
            return false;
        }
        return true;
    };

    /** Envio sellado: validaciones previas (sin adjuntos; contrasena/vistas validas) antes de tocar la red. */
    const validateSealed = (): boolean => {
        if (!sealed) return true;
        if (attachments.length > 0) {
            toast.error(sm.noAttachments);
            return false;
        }
        const invalid = validateSealOptions({ password: sealPassword || undefined, maxViews: sealMaxViews });
        if (invalid) {
            toast.error(invalid);
            setSealPanelOpen(true);
            return false;
        }
        // Sin contrasena la clave viaja solo en el enlace del correo: el servidor de correo / DLP puede leerla. Se pide confirmar.
        if (!sealPassword && typeof window !== 'undefined' && !window.confirm(sm.passwordMissingConfirm)) {
            setSealPanelOpen(true);
            return false;
        }
        return true;
    };

    /** 'Copiar enlace': cifra en el navegador, sube el sobre y copia el enlace. No envia ningun correo. */
    const handleCopySealedLink = async () => {
        if (sealCopying) return;
        const invalid = validateSealOptions({ password: sealPassword || undefined, maxViews: sealMaxViews });
        if (invalid) { toast.error(invalid); return; }
        if (!extractPlainTextFromHtml(body)) { toast.error(sm.copyEmpty); return; }
        if (!sealPassword && typeof window !== 'undefined' && !window.confirm(sm.passwordMissingConfirm)) return;
        setSealCopying(true);
        setSealCopiedLink(null);
        try {
            const link = await createSealedLink({ subject, html: body }, { password: sealPassword || undefined, maxViews: sealMaxViews });
            let copied = false;
            try { await navigator.clipboard.writeText(link.url); copied = true; } catch { copied = false; }
            setSealCopiedLink({ url: link.url, copied });
            if (copied) toast.success(sm.copied);
        } catch (e: any) {
            toast.error(String(e?.message || 'Error'));
        } finally {
            setSealCopying(false);
        }
    };

    /** Lo que realmente viaja en el correo: el cuerpo normal, o solo el enlace si el envio es sellado (cifrado aqui, en el navegador). */
    const prepareOutgoing = async (html: string, text: string, subjectLine: string): Promise<{ html: string; text: string }> => {
        html = cleanOutgoingHtml(html); // nunca viajan overlays/controles de extensiones en el cuerpo
        if (!sealed) return { html, text };
        const link = await createSealedLink({ subject: subjectLine, html }, { password: sealPassword || undefined, maxViews: sealMaxViews });
        return buildSealedEmailBody(link);
    };

    /** Vinculo con el correo original (hilo) y modo, solo si existen: el servidor los valida. */
    const replyLinkFields = {
        ...(inReplyToEmailId ? { inReplyToEmailId } : {}),
        ...(replyMode ? { replyMode } : {}),
        ...(attachOriginalEmlOf ? { attachOriginalEmlOf } : {}),
    };

    const handleSchedule = async (date: Date) => {
        if (sending) return;
        if (toTags.length === 0) {
            toast.error('Agrega al menos un destinatario');
            return;
        }
        if (!validateRecipients()) return;
        if (!validateSealed()) return;

        const plainTextBody = extractPlainTextFromHtml(body);
        if (!plainTextBody && attachments.length === 0) {
            toast.error('No puedes enviar un correo vacio. Escribe un mensaje o adjunta un archivo.');
            return;
        }

        setSending(true);
        try {
            const attachmentsForSend = sealed ? [] : await syncCalendarEventsFromAttachments(toTags, ccTags, attachments);
            const outgoing = await prepareOutgoing(body, plainTextBody, subject);
            const res = await fetch('/api/emails', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...resolveSenderHeaders(),
                },
                body: JSON.stringify({
                    to: toTags.join(', '),
                    from: effectiveSenderEmail,
                    cc: ccTags.length > 0 ? ccTags.join(', ') : undefined,
                    bcc: bccTags.length > 0 ? bccTags.join(', ') : undefined,
                    subject,
                    text: outgoing.text,
                    html: outgoing.html,
                    attachments: attachmentsForSend,
                    ...replyLinkFields,
                    scheduledAt: date.toISOString()
                }),
            });
            const result = await res.json().catch(() => null);
            if (res.ok) {
                // discard(): cancela el autosave pendiente y borra el borrador aunque haya un POST en vuelo.
                await saverRef.current?.discard();
                closeCompose(id);
                toast.success(`Correo programado para ${date.toLocaleString()}`);
            } else {
                throw new Error(result?.error?.message || result?.error || 'No se pudo programar el correo');
            }
        } catch (err) {
            console.error(err);
            toast.error(err instanceof Error ? err.message : 'No se pudo programar el correo');
        } finally {
            setSending(false);
        }
    };

    const handleSend = async (e?: React.SyntheticEvent) => {
        e?.preventDefault();
        if (sending || isUploading) return;
        dictation.stop();

        const finalBody = body;
        const finalTo = toTags;
        const finalCc = ccTags;
        const finalBcc = bccTags;
        const finalSubject = subject;

        if (finalTo.length === 0) {
            toast.error('Agrega al menos un destinatario');
            return;
        }
        if (!validateRecipients()) return;
        if (!validateSealed()) return;

        const plainTextBody = extractPlainTextFromHtml(finalBody);
        if (!plainTextBody && attachments.length === 0) {
            toast.error('No puedes enviar un correo vacio. Escribe un mensaje o adjunta un archivo.');
            return;
        }

        setSending(true);
        try {
            const attachmentsForSend = sealed ? [] : await syncCalendarEventsFromAttachments(finalTo, finalCc, attachments);
            const outgoing = await prepareOutgoing(finalBody, plainTextBody, finalSubject);
            const res = await fetch('/api/emails', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...resolveSenderHeaders(),
                },
                body: JSON.stringify({
                    to: finalTo.join(', '),
                    from: effectiveSenderEmail,
                    cc: finalCc.length > 0 ? finalCc.join(', ') : undefined,
                    bcc: finalBcc.length > 0 ? finalBcc.join(', ') : undefined,
                    subject: finalSubject,
                    text: outgoing.text,
                    html: outgoing.html,
                    attachments: attachmentsForSend,
                    ...replyLinkFields,
                }),
            });
            const result = await res.json().catch(() => null);
            if (res.ok) {
                // discard(): cancela el autosave pendiente y borra el borrador aunque haya un POST en vuelo.
                await saverRef.current?.discard();
                closeCompose(id);
            } else {
                throw new Error(result?.error?.message || result?.error || 'No se pudo enviar el correo');
            }
        } catch (err) {
            console.error(err);
            toast.error(err instanceof Error ? err.message : 'No se pudo enviar el correo');
        } finally {
            setSending(false);
        }
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const input = e.target;
        const files = Array.from(input.files || []);
        if (files.length === 0) return;

        setIsUploading(true);
        try {
            for (const file of files) {
                const formData = new FormData();
                formData.append('file', file);
                try {
                    const res = await fetch('/api/upload', { method: 'POST', body: formData });
                    if (!res.ok) {
                        const err = await res.json().catch(() => null);
                        throw new Error(err?.error || 'Upload failed');
                    }
                    const data = await res.json();
                    setAttachments(prev => [...prev, data]);
                } catch (error) {
                    console.error(error);
                    toast.error(`No se pudo adjuntar "${file.name}"${error instanceof Error && error.message ? `: ${error.message}` : ''}`);
                }
            }
        } finally {
            setIsUploading(false);
            // Reset input
            input.value = '';
        }
    };

    const removeAttachment = (index: number) => {
        setAttachments(prev => prev.filter((_, i) => i !== index));
    };

    const handleClose = () => {
        // El guardado pendiente se vacia en el cleanup del efecto de unmount (flush).
        closeCompose(id);
    };

    const handleDelete = async () => {
        // discard() marca el saver como descartado de forma sincrona: el flush del unmount ya no guarda nada.
        const discarding = saverRef.current?.discard();
        closeCompose(id);
        try {
            await discarding;
            // Update Sidebar Count
            const currentCounts = await getData<any>('stats-counts');
            if (currentCounts) {
                const newCount = Math.max(0, (currentCounts.drafts || 0) - 1);
                setData('stats-counts', { ...currentCounts, drafts: newCount }, { silent: false });
            }
        } catch (e) {
            console.error('Failed to delete draft', e);
        }
    };

    const [popover, setPopover] = useState<{ anchor: HTMLElement | DOMRect, content: React.ReactNode, width?: number | string, header?: boolean } | null>(null);

    const uploadAttachment = async (file: File) => {
        setIsUploading(true);
        const formData = new FormData();
        formData.append('file', file);
        try {
            const res = await fetch('/api/upload', { method: 'POST', body: formData });
            if (!res.ok) throw new Error('Upload failed');
            const data = await res.json();
            setAttachments(prev => [...prev, data]);
            return data;
        } catch (error) {
            console.error(error);
            return null;
        } finally {
            setIsUploading(false);
        }
    };

    // --- Middleware (Event Interceptors) ---

    // Helper to run middleware chain
    const runMiddleware = async <T,>(mountPoint: 'ON_BODY_CHANGE_HANDLER' | 'ON_SUBJECT_CHANGE_HANDLER' | 'ON_RECIPIENTS_CHANGE_HANDLER', initialValue: T): Promise<T> => {
        try {
            const mounts = await fetchExpansions(mountPoint);
            if (!Array.isArray(mounts) || mounts.length === 0) {
                return initialValue;
            }

            let currentValue: any = initialValue;

            for (const mount of mounts) {
                const extensionId = mount?.extensionId || mount?.id;
                const handlerName = mount?.handler;

                if (!extensionId || !handlerName) {
                    continue;
                }

                const response = await executeExtensionAction(extensionId, handlerName, currentValue, {
                    secureData: {
                        'mail-groups-data': mailGroupAliases,
                    },
                });

                if (response.success && response.result) {
                    currentValue = response.result;
                }
            }

            return currentValue as T;
        } catch (error) {
            console.error(`Failed to run ${mountPoint} middleware`, error);
            return initialValue;
        }
    };

    // Define Actions separately to avoid TDZ (Temporal Dead Zone) issues
    const actions = {
        setTo: async (tags: string[]) => {
            setToTags(tags);
            const newState = await runMiddleware('ON_RECIPIENTS_CHANGE_HANDLER', { to: tags, cc: ccTags, bcc: bccTags });
            if (newState.to) setToTags(newState.to);
            if (newState.cc) setCcTags(newState.cc);
            if (newState.bcc) setBccTags(newState.bcc);
        },
        setCc: async (tags: string[]) => {
            setCcTags(tags);
            const newState = await runMiddleware('ON_RECIPIENTS_CHANGE_HANDLER', { to: toTags, cc: tags, bcc: bccTags });
            if (newState.to) setToTags(newState.to);
            if (newState.cc) setCcTags(newState.cc);
            if (newState.bcc) setBccTags(newState.bcc);
        },
        setBcc: async (tags: string[]) => {
            setBccTags(tags);
            const newState = await runMiddleware('ON_RECIPIENTS_CHANGE_HANDLER', { to: toTags, cc: ccTags, bcc: tags });
            if (newState.to) setToTags(newState.to);
            if (newState.cc) setCcTags(newState.cc);
            if (newState.bcc) setBccTags(newState.bcc);
        },
        setSubject: async (val: string) => {
            setSubject(val);
            const newVal = await runMiddleware('ON_SUBJECT_CHANGE_HANDLER', val);
            if (newVal !== val) setSubject(newVal);
        },
        setBody: async (val: string) => {
            setBody(val);
            const newVal = await runMiddleware('ON_BODY_CHANGE_HANDLER', val);
            if (newVal !== val) setBody(newVal);
        },
        addRecipient: async (email: string, type: 'to' | 'cc' | 'bcc' = 'to') => {
            const normalized = email.toLowerCase().trim();
            let newTo = toTags, newCc = ccTags, newBcc = bccTags;

            if (type === 'to' && !toTags.includes(normalized)) newTo = [...toTags, normalized];
            else if (type === 'cc' && !ccTags.includes(normalized)) {
                newCc = [...ccTags, normalized];
                setShowCcBcc(true);
            }
            else if (type === 'bcc' && !bccTags.includes(normalized)) {
                newBcc = [...bccTags, normalized];
                setShowCcBcc(true);
            }

            if (type === 'to' && newTo === toTags) return;

            if (type === 'to') setToTags(newTo);
            if (type === 'cc') setCcTags(newCc);
            if (type === 'bcc') setBccTags(newBcc);

            const newState = await runMiddleware('ON_RECIPIENTS_CHANGE_HANDLER', { to: newTo, cc: newCc, bcc: newBcc });
            if (newState.to) setToTags(newState.to);
            if (newState.cc) setCcTags(newState.cc);
            if (newState.bcc) setBccTags(newState.bcc);
        },
        removeRecipient: async (email: string, type: 'to' | 'cc' | 'bcc' = 'to') => {
            const normalized = email.toLowerCase().trim();
            let newTo = toTags, newCc = ccTags, newBcc = bccTags;

            if (type === 'to') {
                newTo = toTags.filter(t => t.toLowerCase().trim() !== normalized);
                setToTags(newTo);
            } else if (type === 'cc') {
                newCc = ccTags.filter(t => t.toLowerCase().trim() !== normalized);
                setCcTags(newCc);
            } else if (type === 'bcc') {
                newBcc = bccTags.filter(t => t.toLowerCase().trim() !== normalized);
                setBccTags(newBcc);
            }

            const newState = await runMiddleware('ON_RECIPIENTS_CHANGE_HANDLER', { to: newTo, cc: newCc, bcc: newBcc });
            if (newState.to) setToTags(newState.to);
            if (newState.cc) setCcTags(newState.cc);
            if (newState.bcc) setBccTags(newState.bcc);
        }
    };

    const contextProps: ClientExpansionContext = {
        subject,
        to: toTags,
        cc: ccTags,
        bcc: bccTags,
        sender: {
            email: effectiveSenderEmail || undefined,
            name: session?.user?.name ?? undefined,
        },
        isGoogleLinked,
        isGoogleMeetAvailable,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        locale: uiLocale,
        ...actions,
        toast: (msg: string, type: 'success' | 'error' | 'info' = 'success') => {
            if (type === 'success') toast.success(msg);
            else if (type === 'error') toast.error(msg);
            else toast(msg);
        },
        showConfetti: () => {
            const count = 30;
            for (let i = 0; i < count; i++) {
                const el = document.createElement('div');
                el.innerText = '🎉';
                el.style.position = 'fixed';
                el.style.left = Math.random() * 100 + 'vw';
                el.style.top = '-20px';
                el.style.zIndex = '9999';
                el.style.transition = `all ${Math.random() * 1.5 + 1.5}s ease-out`;
                document.body.appendChild(el);
                setTimeout(() => {
                    el.style.transform = `translate(${Math.random() * 100 - 50}px, ${window.innerHeight + 100}px) rotate(${Math.random() * 360}deg)`;
                    el.style.opacity = '0';
                }, 10);
                setTimeout(() => el.remove(), 3000);
            }
        },
        emailContent: body,
        appendBody: (content: string) => {
            const currentBody = body;
            content = cleanOutgoingHtml(content);
            const newVal = currentBody.includes(content) ? currentBody : currentBody + (currentBody ? '<br><br>' : '') + content;
            actions.setBody(newVal);
        },
        prependBody: (content: string) => {
            editorRef.current?.prependContent(cleanOutgoingHtml(content));
        },
        insertBody: (content: string) => {
            editorRef.current?.insertContent(cleanOutgoingHtml(content));
        },
        openPopover: (anchor: HTMLElement | DOMRect, content: React.ReactNode, options?: { width?: number | string, header?: boolean }) => {
            setPopover({ anchor, content, width: options?.width, header: options?.header });
        },
        openOverlay: (content: React.ReactNode) => {
            setActiveSlashComponent({ Component: () => <>{content}</>, id: 'custom-overlay' });
        },
        uploadAttachment,
        addAttachment: (attachment: any) => {
            setAttachments(prev => [...prev, attachment]);
        },
        close: () => {
            setActiveSlashComponent(null);
            setPopover(null);
        }
    };

    // --- Accesibilidad: ids, dialogo, foco, Escape y Ctrl/Cmd+Enter ---
    const dialogRef = useRef<HTMLDivElement>(null);
    const uid = useId();
    // Rotulo vivo del dictado: texto provisional, estado o error (role=status para lectores de pantalla).
    const dictationCaption = dictation.issue
        ? issueMessage(dictation.issue, dictMsg)
        : dictation.status === 'starting' ? dictMsg.starting
        : dictation.status === 'listening' ? (dictation.interim || dictMsg.listening) : '';
    const fromId = `${uid}-from`;
    const toId = `${uid}-to`;
    const ccId = `${uid}-cc`;
    const bccId = `${uid}-bcc`;
    const subjectId = `${uid}-subject`;

    // Ventana maximizada = comportamiento modal: el foco no escapa hasta que se cierra/restaura.
    useFocusTrap(dialogRef, maximized && !minimized, { restoreFocus: false });

    useEffect(() => {
        if (initialMinimized) return;
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const timer = window.setTimeout(() => {
            const root = dialogRef.current;
            if (!root || root.contains(document.activeElement)) return;
            const target = initialTo ? root.querySelector<HTMLElement>('.ProseMirror') : document.getElementById(toId);
            (target ?? root).focus({ preventScroll: true });
        }, 80);
        return () => {
            window.clearTimeout(timer);
            // Al cerrar, devolver el foco a donde estaba (si el elemento enfocado desaparecio con la ventana).
            if (previous && document.contains(previous) && (!document.activeElement || document.activeElement === document.body)) {
                previous.focus({ preventScroll: true });
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleDialogKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void handleSend();
            return;
        }
        if (e.key !== 'Escape' || e.defaultPrevented) return;
        const target = e.target as HTMLElement;
        // Escape dentro del editor / selects / listas de sugerencias lo gestiona ese control.
        if (target.isContentEditable || target.tagName === 'SELECT' || target.closest?.('[role="listbox"]')) return;
        if (schedulePickerOpen) { setSchedulePickerOpen(false); return; }
        if (conferencingPanel) { setConferencingPanel(null); return; }
        if (popover || activeSlashComponent) { setPopover(null); setActiveSlashComponent(null); return; }
        if (maximized) { setMaximized(false); return; }
        handleClose();
    };

    const saveStatusText = saveStatus === 'saving' ? 'Guardando...' : saveStatus === 'saved' ? 'Borrador guardado' : saveStatus === 'error' ? 'Error al guardar' : '';

    const rightOffset = 24 + index * 40;

    // Comandos "/" declarados por las extensiones instaladas (manifest.slashCommands). Editor los muestra en un menu;
    // al elegir uno, SlashActionRunner ejecuta su accion con el motor de extensiones.
    // "/zoom" y "/meet" son comandos de NUCLEO (abren el ConferencingPicker); ganan a un comando de extension homonimo.
    const slashCommandsList: SlashCommand[] = useMemo(
        () => {
            const core: SlashCommand[] = [
                { key: 'zoom', description: tr('conferencing.composer.zoomDescription'), extensionName: 'Zoom', execute: () => setConferencingPanel('zoom') },
                { key: 'meet', description: tr('conferencing.composer.meetDescription'), extensionName: 'Google Meet', execute: () => setConferencingPanel('google-meet') },
            ];
            const coreKeys = new Set(core.map((c) => c.key));
            return [
                ...core,
                ...collectSlashCommands(installedExtensions)
                    .filter((command) => !coreKeys.has(command.key.toLowerCase()))
                    .map((command) => ({
                        ...command,
                        execute: (args: string) => runSlashCommand(command, args),
                    })),
            ];
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [installedExtensions, tr],
    );

    // Reunion creada: inserta el bloque (boton "Unirse" + datos de marcacion) y adjunta el ICS si la extension lo entrego.
    const handleConferencingInsert = useCallback((insertion: ComposerInsertion) => {
        if (insertion.html) editorRef.current?.insertContent(cleanOutgoingHtml(insertion.html));
        if (insertion.attachment) setAttachments((prev) => [...prev, insertion.attachment]);
    }, []);

    // ...

    if (minimized) {
        return (
            <motion.div
                initial={{ opacity: 0, y: 100, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 100, scale: 0.9 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="fixed bottom-0 z-50 w-64 rounded-t-lg bg-background text-foreground shadow-lg"
                style={{ right: `${rightOffset}px` }}
            >
                <div
                    className="flex items-center justify-between px-4 py-2 cursor-pointer bg-muted/50 rounded-t-lg hover:bg-muted"
                    role="button"
                    tabIndex={0}
                    aria-label={`Restaurar borrador: ${subject || 'Nuevo mensaje'}`}
                    onClick={() => toggleMinimize(id)}
                    onKeyDown={(e) => {
                        if (e.target !== e.currentTarget) return;
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMinimize(id); }
                    }}
                >
                    <span className="text-sm font-semibold truncate">{subject || 'New Message'}</span>
                    <div className="flex items-center">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                handleClose();
                            }}
                            type="button"
                            aria-label="Cerrar borrador"
                            title="Cerrar"
                            className="p-1 hover:bg-accent hover:text-accent-foreground rounded-sm transition-colors"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>
            </motion.div>
        );
    }

    const modalClass = maximized
        ? "fixed inset-0 md:inset-4 z-50 flex flex-col bg-card text-card-foreground rounded-none md:rounded-lg shadow-2xl overflow-hidden shadow-md"
        : cn(
            "fixed bottom-0 right-0 md:right-[var(--right-offset)] z-50 flex flex-col bg-card text-card-foreground rounded-t-xl shadow-2xl overflow-hidden ring-1 ring-border/10 shadow-md",
            isResizing ? "transition-none select-none" : ""
        );

    const modalStyle = maximized
        ? {}
        : {
            '--right-offset': `${rightOffset}px`,
            width: typeof window !== 'undefined' && window.innerWidth < 768 ? '100%' : `${dimensions.width}px`,
            height: typeof window !== 'undefined' && window.innerWidth < 768 ? '100%' : `${dimensions.height}px`,
        } as React.CSSProperties;

    return (
        <motion.div
            ref={dialogRef}
            role="dialog"
            aria-label="Nuevo mensaje"
            aria-modal={maximized ? true : undefined}
            tabIndex={-1}
            onKeyDown={handleDialogKeyDown}
            className={modalClass}
            style={modalStyle}
            initial={{ opacity: 0, y: 100, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
        >
            {/* Resize handles (Top and Left edges) */}
            {!maximized && (
                <>
                    <div
                        className="absolute top-0 left-0 w-full h-1 cursor-ns-resize z-[60] hover:bg-primary/20"
                        onMouseDown={handleResizeStart}
                    />
                    <div
                        className="absolute top-0 left-0 w-1 h-full cursor-ew-resize z-[60] hover:bg-primary/20"
                        onMouseDown={handleResizeStart}
                    />
                    <div
                        className="absolute top-0 left-0 w-4 h-4 cursor-nwse-resize z-[60] group rounded-tl-lg"
                        onMouseDown={handleResizeStart}
                    >
                        <div className="absolute top-1 left-1 w-px h-2 bg-border group-hover:bg-primary/70 rotate-45 transform origin-top-left" />
                        <div className="absolute top-1 left-2 w-px h-2 bg-border group-hover:bg-primary/70 rotate-45 transform origin-top-left" />
                    </div>
                </>
            )}

            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 bg-muted select-none ">
                <div className="flex items-baseline gap-2 min-w-0">
                    <span className="text-sm font-semibold pl-1">New Message</span>
                    <span role="status" aria-live="polite" className="text-xs text-muted-foreground truncate">{saveStatusText}</span>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        aria-label="Minimizar"
                        title="Minimizar"
                        onClick={() => toggleMinimize(id)}
                        className="p-1 hover:bg-secondary rounded-sm transition-colors text-muted-foreground"
                    >
                        <Minimize2 className="h-4 w-4" />
                    </button>
                    <button
                        type="button"
                        aria-label={maximized ? 'Restaurar tamano' : 'Maximizar'}
                        title={maximized ? 'Restaurar tamano' : 'Maximizar'}
                        onClick={() => setMaximized(!maximized)}
                        className="p-1 hover:bg-secondary rounded-sm transition-colors text-muted-foreground"
                    >
                        <Maximize2 className="h-4 w-4" />
                    </button>
                    <button
                        type="button"
                        aria-label="Cerrar (el borrador se guarda)"
                        title="Cerrar"
                        onClick={handleClose}
                        className="p-1 hover:bg-secondary rounded-sm transition-colors text-muted-foreground"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* Headless Init Expansions (Signatures, etc) */}
            <ExtensionLoader
                mountPoint="COMPOSER_INIT"
                context={contextProps}
            />

            {/* Ejecuta la accion del slash command elegido en el editor */}
            <SlashActionRunner run={slashRun} context={contextProps} />

            {/* Active Slash Command Overlay */}
            {activeSlashComponent && (
                <div className="absolute inset-x-0 bottom-0 top-auto z-50 bg-card text-card-foreground shadow-2xl border-t animate-in slide-in-from-bottom-5 rounded-b-xl overflow-hidden">
                    <div className="flex justify-end p-1 bg-muted/50 border-b">
                        <button onClick={() => setActiveSlashComponent(null)} className="p-1 hover:bg-secondary rounded"><X className="w-3 h-3" /></button>
                    </div>
                    <activeSlashComponent.Component context={contextProps} />
                </div>
            )}

            {/* Form */}
            <div className="flex flex-col flex-1 h-full overflow-hidden relative">
                <div className="px-3 py-1 flex flex-col gap-1 bg-card">
                    <div className="flex items-center gap-2 border-b border-transparent focus-within:border-border transition-colors">
                        <label htmlFor={fromId} className="text-sm font-medium text-muted-foreground w-10">From</label>
                        <div className="flex-1 py-1.5">
                            {canSwitchSender ? (
                                <select
                                    id={fromId}
                                    value={fromAddress}
                                    onChange={(event) => setFromAddress(event.target.value)}
                                    className="w-full bg-transparent text-sm text-foreground outline-none"
                                >
                                    {senderOptions.map((email) => (
                                        <option key={email} value={email}>{email}</option>
                                    ))}
                                </select>
                            ) : (
                                <div className="text-sm text-foreground truncate">
                                    {effectiveSenderEmail || session?.user?.email || 'Unknown sender'}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex items-start gap-2 border-b border-transparent focus-within:border-border transition-colors">
                        <div className="pt-2">
                            <label htmlFor={toId} className="text-sm font-medium text-muted-foreground">To</label>
                        </div>
                        <div className="flex-1">
                            <TagInput
                                inputId={toId}
                                value={toTags}
                                onChange={actions.setTo}
                                placeholder=""
                                className="border-none px-0 py-1.5"
                                suggestionEndpoint="/api/contacts/suggestions"
                            />
                        </div>
                        <div className="pt-1">
                            <button
                                type="button"
                                aria-expanded={showCcBcc}
                                aria-label="Mostrar u ocultar Cc y Bcc"
                                onClick={() => setShowCcBcc(!showCcBcc)}
                                className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
                            >
                                Cc/Bcc
                            </button>
                        </div>
                    </div>

                    {showCcBcc && (
                        <div className="animate-in slide-in-from-top-2 duration-200 flex flex-col gap-1">
                            <div className="flex items-start gap-2 border-b border-transparent focus-within:border-border">
                                <label htmlFor={ccId} className="text-sm font-medium text-muted-foreground pt-2 w-8">Cc</label>
                                <div className="flex-1">
                                    <TagInput inputId={ccId} value={ccTags} onChange={actions.setCc} className="border-none px-0 py-1.5" suggestionEndpoint="/api/contacts/suggestions" />
                                </div>
                            </div>
                            <div className="flex items-start gap-2 border-b border-transparent focus-within:border-border">
                                <label htmlFor={bccId} className="text-sm font-medium text-muted-foreground pt-2 w-8">Bcc</label>
                                <div className="flex-1">
                                    <TagInput inputId={bccId} value={bccTags} onChange={actions.setBcc} className="border-none px-0 py-1.5" suggestionEndpoint="/api/contacts/suggestions" />
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="px-3 py-2 bg-card">
                    <input
                        className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground"
                        id={subjectId}
                        aria-label="Asunto"
                        placeholder="Subject"
                        value={subject}
                        onChange={(e) => actions.setSubject(e.target.value)}
                    />
                </div>

                <div className="h-px bg-muted mx-3" />

                {/* Editor Area */}
                <div className="flex-1 bg-card p-3 overflow-hidden flex flex-col relative">
                    <div className="flex-1 overflow-y-auto">
                        <Editor
                            ref={editorRef}
                            value={body}
                            onChange={actions.setBody}
                            slashCommands={slashCommandsList}
                            context={contextProps}
                        />
                    </div>

                    {/* Attachment list overlay */}
                    {attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-2 border-t border-border/60">
                            {attachments.map((att, i) => (
                                <div key={i} className="flex items-center gap-1 bg-muted/50 border border-border rounded-md px-2 py-1 text-xs max-w-[150px]">
                                    <Paperclip className="w-3 h-3 text-muted-foreground shrink-0" />
                                    <span className="truncate">{att.filename || att.name}</span>
                                    <button type="button" onClick={() => removeAttachment(i)} className="text-muted-foreground hover:text-destructive ml-1" aria-label={`Quitar adjunto ${att.filename || att.name || ''}`}>
                                        <X className="w-3 h-3" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                </div>

                {/* Active Slash Component (e.g. Zoom Form) */}
                {activeSlashComponent && activeSlashComponent.Component && (
                    <div className="absolute bottom-14 left-4 z-40 bg-card text-card-foreground border border-border rounded-lg shadow-xl p-0 animate-in fade-in zoom-in-95">
                        <activeSlashComponent.Component
                            context={{ ...contextProps, onClose: () => setActiveSlashComponent(null) }}
                            args={activeSlashComponent.args}
                            onClose={() => setActiveSlashComponent(null)}
                        />
                    </div>
                )}

                {/* Panel de videoconferencia (/zoom, /meet) */}
                {conferencingPanel && (
                    <div className="absolute bottom-14 left-4 z-40 max-h-[70%] overflow-y-auto bg-card text-card-foreground border border-border rounded-lg shadow-xl animate-in fade-in zoom-in-95">
                        <ComposerConferencingPanel
                            provider={conferencingPanel}
                            subject={subject}
                            recipients={[...toTags, ...ccTags].filter((tag) => tag.includes('@'))}
                            onInsert={handleConferencingInsert}
                            onClose={() => setConferencingPanel(null)}
                        />
                    </div>
                )}

                {/* Managed Popover Slot */}
                {popover && (
                    <Popover
                        trigger={popover.anchor}
                        isOpen={true}
                        onClose={() => setPopover(null)}
                        width={popover.width}
                        header={popover.header}
                    >
                        {popover.content}
                    </Popover>
                )}

                <div className="bg-card px-3 pb-2">
                    <ExtensionLoader
                        mountPoint="EMAIL_FOOTER"
                        context={contextProps}
                    />
                </div>

                {/* Envio sellado: opciones (cifrado en el navegador; el correo lleva solo el enlace) */}
                {sealPanelOpen && (
                    <div id={`${uid}-seal`} role="group" aria-label={sm.composerLegend} className="bg-card px-3 pb-2">
                        <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2 text-sm">
                            <label className="flex items-center gap-2 font-medium">
                                <input
                                    type="checkbox"
                                    checked={sealed}
                                    onChange={(e) => setSealed(e.target.checked)}
                                    className="h-4 w-4"
                                />
                                {sm.sealToggle}
                            </label>
                            <p className="text-xs text-muted-foreground">{sm.sealIntro}</p>
                            {sealed && (
                                <div className="grid gap-2 sm:grid-cols-2">
                                    <div className="space-y-1">
                                        <label htmlFor={`${uid}-seal-pw`} className="text-xs font-medium">{sm.passwordField}</label>
                                        <input
                                            id={`${uid}-seal-pw`}
                                            type="password"
                                            autoComplete="new-password"
                                            value={sealPassword}
                                            aria-describedby={`${uid}-seal-pw-risk`}
                                            onChange={(e) => setSealPassword(e.target.value)}
                                            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label htmlFor={`${uid}-seal-views`} className="text-xs font-medium">{sm.viewsField}</label>
                                        <select
                                            id={`${uid}-seal-views`}
                                            value={sealMaxViews ?? ''}
                                            onChange={(e) => setSealMaxViews(e.target.value ? Number(e.target.value) : null)}
                                            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        >
                                            <option value="">{sm.viewsUnlimited}</option>
                                            <option value="1">{sm.views1}</option>
                                            <option value="3">{sm.views3}</option>
                                            <option value="10">{sm.views10}</option>
                                        </select>
                                    </div>
                                </div>
                            )}
                            {sealed && (
                                <>
                                    <p id={`${uid}-seal-pw-risk`} role={sealPassword ? undefined : 'note'} className={cn('text-xs rounded-md px-2 py-1.5', sealPassword ? 'text-muted-foreground' : 'bg-warning/10 text-warning')}>
                                        {sealPassword ? sm.passwordRisk : `${sm.passwordHint} ${sm.passwordRisk}`}
                                    </p>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => void handleCopySealedLink()}
                                            disabled={sealCopying}
                                            aria-busy={sealCopying || undefined}
                                            aria-describedby={`${uid}-seal-copy-help`}
                                            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        >
                                            {sealCopying && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                                            {sealCopying ? sm.copying : sm.copyLink}
                                        </button>
                                        <span id={`${uid}-seal-copy-help`} className="text-xs text-muted-foreground">{sm.copyLinkHelp}</span>
                                    </div>
                                    <div aria-live="polite">
                                        {sealCopiedLink && !sealCopiedLink.copied && (
                                            <label className="block text-xs">
                                                {sm.copyFailed}
                                                <input readOnly value={sealCopiedLink.url} onFocus={(e) => e.currentTarget.select()} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 font-mono text-xs" />
                                            </label>
                                        )}
                                        {sealCopiedLink?.copied && <p className="text-xs text-success">{sm.copied}</p>}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}

                {dictationCaption && (
                    <div
                        id={`${uid}-dictation`}
                        role="status"
                        aria-live="polite"
                        className={cn(
                            'flex items-start gap-2 px-4 py-2 text-xs border-t border-border',
                            dictation.issue ? 'bg-destructive/10 text-destructive' : 'bg-muted/40 text-muted-foreground',
                        )}
                    >
                        {dictation.status === 'listening' && !dictation.issue && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-destructive animate-pulse" aria-hidden="true" />}
                        <span className={cn('min-w-0 flex-1 break-words', dictation.interim && !dictation.issue && 'italic text-foreground')}>{dictationCaption}</span>
                        {dictation.issue && (
                            <button type="button" onClick={dictation.clearIssue} className="shrink-0 rounded p-0.5 hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={uiLocale === 'en' ? 'Dismiss' : 'Cerrar aviso'}><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
                        )}
                    </div>
                )}

                {/* Footer / Send Button */}
                <div className="flex items-center justify-between p-3 bg-muted/50 relative">
                    <div className="flex items-center gap-2">
                        <div className="flex items-center rounded-full shadow-sm bg-primary text-primary-foreground transition-all hover:bg-primary/90">
                            <button
                                type="button"
                                aria-keyshortcuts="Control+Enter Meta+Enter"
                                title="Enviar (Ctrl/Cmd+Enter)"
                                onClick={handleSend}
                                disabled={sending || toTags.length === 0 || isUploading}
                                className={cn(
                                    "inline-flex items-center justify-center gap-2 rounded-l-full text-sm font-semibold pl-4 pr-3 h-9 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 border-r border-primary",
                                    sending && "opacity-70 cursor-not-allowed"
                                )}
                            >
                                {sending ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Sending
                                    </>
                                ) : (
                                    sealed ? "Send sealed" : "Send"
                                )}
                            </button>
                            <div className="relative h-9 flex items-center pr-1 rounded-r-full hover:bg-primary-foreground/10 transition-colors">
                                <button
                                    type="button"
                                    onClick={() => setSchedulePickerOpen(o => !o)}
                                    title="Programar envio"
                                    aria-label="Programar envio"
                                    aria-haspopup="dialog"
                                    aria-expanded={schedulePickerOpen}
                                    className="cursor-pointer p-2 flex items-center justify-center h-full w-full rounded-r-full"
                                >
                                    <Clock className="w-4 h-4" />
                                </button>
                                {schedulePickerOpen && (
                                    <div className="absolute bottom-full right-0 mb-2 z-[200]">
                                        <div className="bg-background text-foreground rounded-lg shadow-xl border border-border overflow-hidden">
                                            <DateTimePicker
                                                value={scheduleValue}
                                                onChange={(v) => {
                                                    setScheduleValue(v);
                                                    if (v) {
                                                        const date = new Date(v);
                                                        if (!isNaN(date.getTime()) && confirm(`Schedule email for ${date.toLocaleString()}?`)) {
                                                            handleSchedule(date);
                                                            setSchedulePickerOpen(false);
                                                            setScheduleValue('');
                                                        }
                                                    }
                                                }}
                                                minDate={new Date().toISOString().slice(0, 10)}
                                                placeholder="Pick date & time"
                                                className="border-0 rounded-none bg-transparent hover:bg-transparent shadow-none"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="overflow-hidden flex items-center gap-2 scroll-x w-full">
                            <label className={cn(
                                "text-muted-foreground hover:bg-secondary p-2 rounded-full cursor-pointer transition-colors relative focus-within:ring-2 focus-within:ring-ring",
                                isUploading && "opacity-50 cursor-wait"
                            )}>
                                {isUploading ? <Loader2 className="w-5 h-5 animate-spin p-0.5" /> : <Paperclip className="w-5 h-5" />}
                                <input type="file" multiple className="sr-only" aria-label="Adjuntar archivos" onChange={handleFileSelect} disabled={isUploading} />
                            </label>

                            {/* Voice Dictation */}
                            <button
                                type="button"
                                onClick={dictation.toggle}
                                disabled={!dictation.supported}
                                className={cn(
                                    'p-2 rounded-full transition-colors relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                    dictation.listening ? 'text-destructive bg-destructive/10' : 'text-muted-foreground hover:bg-secondary',
                                    !dictation.supported && 'opacity-50 cursor-not-allowed hover:bg-transparent',
                                )}
                                title={!dictation.supported ? dictMsg.unsupportedTooltip : dictation.listening ? dictMsg.stop : dictMsg.start}
                                aria-label={dictation.listening ? dictMsg.stop : dictMsg.start}
                                aria-pressed={dictation.listening}
                                aria-describedby={dictationCaption ? `${uid}-dictation` : undefined}
                            >
                                {dictation.status === 'starting' ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> : <Mic className="w-5 h-5" aria-hidden="true" />}
                                {dictation.status === 'listening' && (
                                    <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5" aria-hidden="true">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive/70 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive"></span>
                                    </span>
                                )}
                            </button>

                            {/* Enviar sellado */}
                            <button
                                type="button"
                                onClick={() => {
                                    if (!sealed) {
                                        setSealed(true);
                                        setSealPanelOpen(true);
                                    } else {
                                        setSealPanelOpen((open) => !open);
                                    }
                                }}
                                className={cn(
                                    "p-2 rounded-full transition-colors relative",
                                    sealed ? "text-primary bg-primary/10" : "text-muted-foreground hover:bg-secondary"
                                )}
                                title="Enviar sellado (cifrado de extremo a extremo)"
                                aria-label={sealed ? 'Envio sellado activado: opciones' : 'Enviar sellado'}
                                aria-pressed={sealed}
                                aria-expanded={sealPanelOpen}
                                aria-controls={`${uid}-seal`}
                            >
                                <Lock className="w-5 h-5" />
                            </button>

                            {/* Expansions (Toolbar) */}
                            <ExtensionLoader
                                mountPoint="COMPOSER_TOOLBAR"
                                context={contextProps}
                            /></div>
                    </div>

                    <button
                        type="button"
                        onClick={handleDelete}
                        className="text-muted-foreground hover:bg-secondary hover:text-foreground p-2 rounded-full transition-colors"
                        title="Descartar borrador"
                        aria-label="Descartar borrador"
                    >
                        <Trash2 className="w-5 h-5" />
                    </button>
                </div>

            </div>
        </motion.div>
    );
}
