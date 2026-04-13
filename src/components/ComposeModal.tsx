'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { X, Minimize2, Trash2, Maximize2, Loader2, Send, Paperclip, Clock, Mic } from 'lucide-react';
import { toast } from 'sonner';
import { useCompose } from '@/contexts/ComposeContext';
// Local expansions removed.
// import { clientExpansionRegistry } from '@/lib/expansions/client/registry';
// import { ensureClientExpansions } from '@/lib/expansions/client/core-expansions';
// Initialize client expansions
// ensureClientExpansions();
import { useCache } from '@/contexts/CacheContext';
import { cn } from '@/lib/utils';
import { TagInput } from './ui/TagInput';
import { Editor } from './Editor';
import { ExtensionLoader } from '@/components/expansions/ExtensionLoader';
import { useSession } from '@/components/SessionProvider';
// import { ClientExpansions } from '@/lib/expansions/client/renderer'; // Legacy
import { ClientExpansionContext } from '@/lib/expansions/client/types'; // Legacy
import { Popover } from './ui/Popover';
import { motion } from 'framer-motion';
import { executeExtensionAction, fetchExpansions } from '@/lib/expansions/api';
import { AccountManager } from '@/lib/account-manager';

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
    index,
}: ComposeModalProps) {
    const { closeCompose, toggleMinimize, updateCompose, windows } = useCompose();
    const { getData, setData } = useCache();
    const { data: session } = useSession();
    const router = useRouter();

    const [toTags, setToTags] = useState<string[]>(initialTo ? initialTo.split(',').map(s => s.trim()).filter(Boolean) : []);
    const [senderOptions, setSenderOptions] = useState<string[]>([]);
    const [fromAddress, setFromAddress] = useState(String(initialFrom || '').trim().toLowerCase());
    const [subject, setSubject] = useState(initialSubject);
    const [body, setBody] = useState(initialBody);
    const [attachments, setAttachments] = useState<any[]>(initialAttachments);
    const [isUploading, setIsUploading] = useState(false);
    const [unifiedRepliesEnabled, setUnifiedRepliesEnabled] = useState(false);

    // Slash Commands Registry (Computed)
    const [activeSlashComponent, setActiveSlashComponent] = useState<{ Component: React.ComponentType<any>, id: string, args?: string } | null>(null);



    // CC/BCC State
    const [ccTags, setCcTags] = useState<string[]>(initialCc ? initialCc.split(',').map(s => s.trim()).filter(Boolean) : []);
    const [bccTags, setBccTags] = useState<string[]>(initialBcc ? initialBcc.split(',').map(s => s.trim()).filter(Boolean) : []);

    const [showCcBcc, setShowCcBcc] = useState(!!initialCc || !!initialBcc);
    const [sending, setSending] = useState(false);
    const [draftId, setDraftId] = useState(initialDraftId);
    const [mailGroupAliases, setMailGroupAliases] = useState<Record<string, string[]>>({});

    // Track if user maximized the window manually (custom state, separate from minimize)
    const [maximized, setMaximized] = useState(false);

    const editorRef = useRef<any>(null);

    // Middleware Refs
    const beforeSendHandlers = useRef<Array<(details: any) => Promise<any>>>([]);
    const registerBeforeSend = (handler: any) => {
        beforeSendHandlers.current.push(handler);
    };

    // Voice Dictation State
    const [isListening, setIsListening] = useState(false);
    const recognitionRef = useRef<any>(null);

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

                const mailboxModeEnabled = Boolean(data?.expansionSettings?.['core-mailbox']?.unifiedRepliesEnabled);
                setUnifiedRepliesEnabled(mailboxModeEnabled);

                if (!mailboxModeEnabled) {
                    setFromAddress(String(session?.user?.email || initialFrom || '').trim().toLowerCase());
                }
            })
            .catch(() => undefined);
    }, [initialFrom, session?.user?.email]);

    const effectiveSenderEmail = unifiedRepliesEnabled
        ? (fromAddress || session?.user?.email || '')
        : (session?.user?.email || fromAddress || '');

    const resolveSenderHeaders = () => {
        const token = AccountManager.getTokenForEmail(effectiveSenderEmail);
        const headers: Record<string, string> = {};
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
        return headers;
    };

    const canSwitchSender = unifiedRepliesEnabled && senderOptions.length > 1;

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





    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const activeWindow = windows.find(w => w.id === id);
    const minimized = activeWindow?.minimized ?? initialMinimized;

    // Load Signature for new emails


    // Auto-save draft logic (Attachments NOT saved to draft yet - Edit: Now they are!)
    useEffect(() => {
        // Only auto-save if there's content
        if (toTags.length === 0 && ccTags.length === 0 && bccTags.length === 0 && !subject && !body) return;

        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(async () => {
            try {
                const res = await fetch('/api/drafts', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...resolveSenderHeaders(),
                    },
                    body: JSON.stringify({
                        id: draftId,
                            from: effectiveSenderEmail,
                        to: toTags.join(', '),
                        cc: ccTags.join(', '),
                        bcc: bccTags.join(', '),
                        subject,
                        body
                    }),
                });
                const data = await res.json();
                if (data.draft && !draftId) setDraftId(data.draft.id);
            } catch (err) {
                console.error('Failed to save draft:', err);
            }
        }, 2000);
        return () => {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        };
    }, [toTags, ccTags, bccTags, subject, body, draftId, effectiveSenderEmail]);

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

    const handleSchedule = async (date: Date) => {
        if (toTags.length === 0) {
            toast.error('Agrega al menos un destinatario');
            return;
        }

        const plainTextBody = extractPlainTextFromHtml(body);
        if (!plainTextBody && attachments.length === 0) {
            toast.error('No puedes enviar un correo vacio. Escribe un mensaje o adjunta un archivo.');
            return;
        }

        setSending(true);
        try {
            const attachmentsForSend = await syncCalendarEventsFromAttachments(toTags, ccTags, attachments);
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
                    text: plainTextBody,
                    html: body,
                    attachments: attachmentsForSend,
                    scheduledAt: date.toISOString()
                }),
            });
            const result = await res.json().catch(() => null);
            if (res.ok) {
                if (draftId) await fetch(`/api/drafts/${draftId}`, { method: 'DELETE' });
                closeCompose(id);
                // Ideally show a specific toast: "Email scheduled for ..."
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

    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault();

        let finalBody = body;
        let finalTo = toTags;
        let finalCc = ccTags;
        let finalBcc = bccTags;
        let finalSubject = subject;

        // Local expansions removed.
        const mounts: any[] = []; // Placeholder
        const sortedMounts: any[] = [];

        if (finalTo.length === 0) {
            toast.error('Agrega al menos un destinatario');
            return;
        }

        const plainTextBody = extractPlainTextFromHtml(finalBody);
        if (!plainTextBody && attachments.length === 0) {
            toast.error('No puedes enviar un correo vacio. Escribe un mensaje o adjunta un archivo.');
            return;
        }

        setSending(true);
        try {
            const attachmentsForSend = await syncCalendarEventsFromAttachments(finalTo, finalCc, attachments);
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
                    text: plainTextBody,
                    html: finalBody,
                    attachments: attachmentsForSend
                }),
            });
            const result = await res.json().catch(() => null);
            if (res.ok) {
                if (draftId) await fetch(`/api/drafts/${draftId}`, { method: 'DELETE' });
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
        if (!e.target.files || e.target.files.length === 0) return;

        setIsUploading(true);
        const file = e.target.files[0];
        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            if (!res.ok) throw new Error('Upload failed');

            const data = await res.json();
            setAttachments(prev => [...prev, data]);
        } catch (error) {
            console.error(error);
            // toast.error('Failed to upload attachment'); // Add toast if available
        } finally {
            setIsUploading(false);
            // Reset input
            e.target.value = '';
        }
    };

    const removeAttachment = (index: number) => {
        setAttachments(prev => prev.filter((_, i) => i !== index));
    };

    const handleClose = () => {
        closeCompose(id);
    };

    const handleDelete = async () => {
        // Optimistic close
        closeCompose(id);
        if (draftId) {
            try {
                await fetch(`/api/drafts/${draftId}`, { method: 'DELETE' });
                // Update Sidebar Count
                const currentCounts = await getData<any>('stats-counts');
                if (currentCounts) {
                    const newCount = Math.max(0, (currentCounts.drafts || 0) - 1);
                    setData('stats-counts', { ...currentCounts, drafts: newCount }, { silent: false });
                }
            } catch (e) {
                console.error('Failed to delete draft', e);
            }
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
            const newVal = currentBody.includes(content) ? currentBody : currentBody + (currentBody ? '<br><br>' : '') + content;
            actions.setBody(newVal);
        },
        prependBody: (content: string) => {
            editorRef.current?.prependContent(content);
        },
        insertBody: (content: string) => {
            editorRef.current?.insertContent(content);
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

    const rightOffset = 24 + index * 40;

    const slashCommandsList: any[] = [];
    // Local expansions removed.

    // ...

    if (minimized) {
        return (
            <motion.div
                initial={{ opacity: 0, y: 100, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 100, scale: 0.9 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="fixed bottom-0 z-50 w-64 rounded-t-lg bg-background shadow-lg"
                style={{ right: `${rightOffset}px` }}
            >
                <div
                    className="flex items-center justify-between px-4 py-2 cursor-pointer bg-muted/50 rounded-t-lg hover:bg-muted"
                    onClick={() => toggleMinimize(id)}
                >
                    <span className="text-sm font-semibold truncate">{subject || 'New Message'}</span>
                    <div className="flex items-center">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                handleClose();
                            }}
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
        ? "fixed inset-0 md:inset-4 z-50 flex flex-col bg-white rounded-none md:rounded-lg shadow-2xl overflow-hidden shadow-md"
        : cn(
            "fixed bottom-0 right-0 md:right-[var(--right-offset)] z-50 flex flex-col bg-white rounded-t-xl shadow-2xl overflow-hidden ring-1 ring-border/10 shadow-md",
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
                        className="absolute top-0 left-0 w-full h-1 cursor-ns-resize z-[60] hover:bg-blue-500/20"
                        onMouseDown={handleResizeStart}
                    />
                    <div
                        className="absolute top-0 left-0 w-1 h-full cursor-ew-resize z-[60] hover:bg-blue-500/20"
                        onMouseDown={handleResizeStart}
                    />
                    <div
                        className="absolute top-0 left-0 w-4 h-4 cursor-nwse-resize z-[60] group rounded-tl-lg"
                        onMouseDown={handleResizeStart}
                    >
                        <div className="absolute top-1 left-1 w-px h-2 bg-gray-300 group-hover:bg-blue-400 rotate-45 transform origin-top-left" />
                        <div className="absolute top-1 left-2 w-px h-2 bg-gray-300 group-hover:bg-blue-400 rotate-45 transform origin-top-left" />
                    </div>
                </>
            )}

            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 bg-gray-100 select-none ">
                <span className="text-sm font-semibold pl-1">New Message</span>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => toggleMinimize(id)}
                        className="p-1 hover:bg-gray-200 rounded-sm transition-colors text-gray-600"
                    >
                        <Minimize2 className="h-4 w-4" />
                    </button>
                    <button
                        onClick={() => setMaximized(!maximized)}
                        className="p-1 hover:bg-gray-200 rounded-sm transition-colors text-gray-600"
                    >
                        <Maximize2 className="h-4 w-4" />
                    </button>
                    <button
                        onClick={handleClose}
                        className="p-1 hover:bg-gray-200 rounded-sm transition-colors text-gray-600"
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

            {/* Active Slash Command Overlay */}
            {activeSlashComponent && (
                <div className="absolute inset-x-0 bottom-0 top-auto z-50 bg-white shadow-2xl border-t animate-in slide-in-from-bottom-5 rounded-b-xl overflow-hidden">
                    <div className="flex justify-end p-1 bg-gray-50 border-b">
                        <button onClick={() => setActiveSlashComponent(null)} className="p-1 hover:bg-gray-200 rounded"><X className="w-3 h-3" /></button>
                    </div>
                    <activeSlashComponent.Component context={contextProps} />
                </div>
            )}

            {/* Form */}
            <div className="flex flex-col flex-1 h-full overflow-hidden relative">
                <div className="px-3 py-1 flex flex-col gap-1 bg-white">
                    <div className="flex items-center gap-2 border-b border-transparent focus-within:border-gray-200 transition-colors">
                        <span className="text-sm font-medium text-gray-500 w-10">From</span>
                        <div className="flex-1 py-1.5">
                            {canSwitchSender ? (
                                <select
                                    value={fromAddress}
                                    onChange={(event) => setFromAddress(event.target.value)}
                                    className="w-full bg-transparent text-sm text-gray-700 outline-none"
                                >
                                    {senderOptions.map((email) => (
                                        <option key={email} value={email}>{email}</option>
                                    ))}
                                </select>
                            ) : (
                                <div className="text-sm text-gray-700 truncate">
                                    {effectiveSenderEmail || session?.user?.email || 'Unknown sender'}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex items-start gap-2 border-b border-transparent focus-within:border-gray-200 transition-colors">
                        <div className="pt-2">
                            <span className="text-sm font-medium text-gray-500">To</span>
                        </div>
                        <div className="flex-1">
                            <TagInput
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
                                onClick={() => setShowCcBcc(!showCcBcc)}
                                className="text-xs text-gray-500 hover:text-gray-900 transition-colors px-2 py-1"
                            >
                                Cc/Bcc
                            </button>
                        </div>
                    </div>

                    {showCcBcc && (
                        <div className="animate-in slide-in-from-top-2 duration-200 flex flex-col gap-1">
                            <div className="flex items-start gap-2 border-b border-transparent focus-within:border-gray-200">
                                <span className="text-sm font-medium text-gray-500 pt-2 w-8">Cc</span>
                                <div className="flex-1">
                                    <TagInput value={ccTags} onChange={actions.setCc} className="border-none px-0 py-1.5" suggestionEndpoint="/api/contacts/suggestions" />
                                </div>
                            </div>
                            <div className="flex items-start gap-2 border-b border-transparent focus-within:border-gray-200">
                                <span className="text-sm font-medium text-gray-500 pt-2 w-8">Bcc</span>
                                <div className="flex-1">
                                    <TagInput value={bccTags} onChange={actions.setBcc} className="border-none px-0 py-1.5" suggestionEndpoint="/api/contacts/suggestions" />
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="px-3 py-2 bg-white">
                    <input
                        className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-gray-400"
                        placeholder="Subject"
                        value={subject}
                        onChange={(e) => actions.setSubject(e.target.value)}
                    />
                </div>

                <div className="h-px bg-gray-100 mx-3" />

                {/* Editor Area */}
                <div className="flex-1 bg-white p-3 overflow-hidden flex flex-col relative">
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
                        <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                            {attachments.map((att, i) => (
                                <div key={i} className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-md px-2 py-1 text-xs max-w-[150px]">
                                    <Paperclip className="w-3 h-3 text-gray-500 shrink-0" />
                                    <span className="truncate">{att.filename || att.name}</span>
                                    <button onClick={() => removeAttachment(i)} className="text-gray-400 hover:text-red-500 ml-1">
                                        <X className="w-3 h-3" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                </div>

                {/* Active Slash Component (e.g. Zoom Form) */}
                {activeSlashComponent && activeSlashComponent.Component && (
                    <div className="absolute bottom-14 left-4 z-40 bg-white border border-gray-200 rounded-lg shadow-xl p-0 animate-in fade-in zoom-in-95">
                        <activeSlashComponent.Component
                            context={{ ...contextProps, onClose: () => setActiveSlashComponent(null) }}
                            args={activeSlashComponent.args}
                            onClose={() => setActiveSlashComponent(null)}
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

                <div className="bg-white px-3 pb-2">
                    <ExtensionLoader
                        mountPoint="EMAIL_FOOTER"
                        context={contextProps}
                    />
                </div>

                {/* Footer / Send Button */}
                <div className="flex items-center justify-between p-3 bg-gray-50/50 relative">
                    <div className="flex items-center gap-2">
                        <div className="flex items-center rounded-full shadow-sm bg-blue-600 text-white transition-all hover:bg-blue-700">
                            <button
                                onClick={handleSend}
                                disabled={sending || toTags.length === 0 || isUploading}
                                className={cn(
                                    "inline-flex items-center justify-center gap-2 rounded-l-full text-sm font-semibold pl-4 pr-3 h-9 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 border-r border-blue-500",
                                    sending && "opacity-70 cursor-not-allowed"
                                )}
                            >
                                {sending ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Sending
                                    </>
                                ) : (
                                    "Send"
                                )}
                            </button>
                            <div className="relative h-9 flex items-center pr-1 rounded-r-full hover:bg-blue-800/50 transition-colors">
                                <label className="cursor-pointer p-2 flex items-center justify-center h-full w-full rounded-r-full" title="Schedule Send">
                                    <Clock className="w-4 h-4" />
                                    <input
                                        type="datetime-local"
                                        className="absolute inset-0 opacity-0 cursor-pointer w-full"
                                        onChange={(e) => {
                                            if (e.target.value) {
                                                const date = new Date(e.target.value);
                                                // Confirm with user or just set it? Let's send immediately with schedule for now or set state?
                                                // Better: Set state and change button text to "Schedule"
                                                // For MVP: Just send immediately with this date
                                                if (confirm(`Schedule email for ${date.toLocaleString()}?`)) {
                                                    // Hack to reuse handleSend with the date
                                                    // Actually, we need to update state and trigger send.
                                                    // Let's create a specific handleSchedule(date) function.
                                                    handleSchedule(date);
                                                }
                                                e.target.value = ''; // Reset
                                            }
                                        }}
                                        min={new Date().toISOString().slice(0, 16)}
                                    />
                                </label>
                            </div>
                        </div>
                        <div className="overflow-hidden flex items-center gap-2 scroll-x w-full">
                            <label className={cn(
                                "text-gray-500 hover:bg-gray-200 p-2 rounded-full cursor-pointer transition-colors relative",
                                isUploading && "opacity-50 cursor-wait"
                            )}>
                                {isUploading ? <Loader2 className="w-5 h-5 animate-spin p-0.5" /> : <Paperclip className="w-5 h-5" />}
                                <input type="file" className="hidden" onChange={handleFileSelect} disabled={isUploading} />
                            </label>

                            {/* Voice Dictation */}
                            <button
                                onClick={() => {
                                    if (typeof window === 'undefined' || (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window))) {
                                        alert('Voice dictation not supported in this browser.');
                                        return;
                                    }

                                    if (isListening) {
                                        recognitionRef.current?.stop();
                                        setIsListening(false);
                                        return;
                                    }

                                    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
                                    const recognition = new SpeechRecognition();
                                    recognition.continuous = true;
                                    recognition.interimResults = true;

                                    recognition.onstart = () => setIsListening(true);
                                    recognition.onend = () => setIsListening(false);
                                    recognition.onerror = (e: any) => {
                                        console.error(e);
                                        setIsListening(false);
                                    };

                                    recognition.onresult = (event: any) => {
                                        let finalTranscript = '';
                                        // @ts-ignore
                                        for (let i = event.resultIndex; i < event.results.length; ++i) {
                                            if (event.results[i].isFinal) {
                                                finalTranscript += event.results[i][0].transcript;
                                            }
                                        }
                                        if (finalTranscript) {
                                            setBody((prev) => (prev || '') + ' ' + finalTranscript);
                                        }
                                    };

                                    recognitionRef.current = recognition;
                                    recognition.start();
                                }}
                                className={cn(
                                    "p-2 rounded-full transition-colors relative",
                                    isListening ? "text-red-600 bg-red-50 animate-pulse" : "text-gray-500 hover:bg-gray-200"
                                )}
                                title="Dictate"
                            >
                                <Mic className="w-5 h-5" />
                                {isListening && (
                                    <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                                    </span>
                                )}
                            </button>

                            {/* Expansions (Toolbar) */}
                            <ExtensionLoader
                                mountPoint="COMPOSER_TOOLBAR"
                                context={contextProps}
                            /></div>
                    </div>

                    <button
                        onClick={handleDelete}
                        className="text-gray-400 hover:bg-gray-200 hover:text-gray-700 p-2 rounded-full transition-colors"
                        title="Delete Draft"
                    >
                        <Trash2 className="w-5 h-5" />
                    </button>
                </div>

            </div>
        </motion.div>
    );
}
