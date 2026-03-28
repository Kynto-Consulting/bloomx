'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Archive, ArchiveX, Trash2, Clock, Reply, ReplyAll, Forward, MoreVertical, MousePointerClick, Star, Tag, Check, ArrowLeft, X, Sparkles } from 'lucide-react';
import { useCache } from '@/contexts/CacheContext';
import { useCompose } from '@/contexts/ComposeContext';
import { formatDate, cn } from '@/lib/utils';
import { sanitizeHtml } from '@/lib/sanitizeHtml';
import { toast } from 'sonner';
import { fetchDeduped } from '@/lib/fetchdedupe';

import * as Icons from 'lucide-react';
import { SafeIframe } from './ui/SafeIframe';
import { ExtensionLoader } from './expansions/ExtensionLoader';
import { motion, AnimatePresence } from 'framer-motion';

const ENABLE_THREAD_VIEW = true;

interface EmailDetails {
    email: {
        id: string;
        from: string;
        to: string;
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
    thread?: EmailDetails[]; // Thread support
}

export function MailView() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const id = searchParams.get('id');
    const [data, setLocalData] = useState<EmailDetails | null>(null);
    const [loading, setLoading] = useState(false);
    const [summary, setSummary] = useState<string | null>(null);

    const [availableLabels, setAvailableLabels] = useState<any[]>([]);
    const [showLabelMenu, setShowLabelMenu] = useState(false);
    const { getData, setData: setCacheData, invalidate } = useCache();

    const { openCompose } = useCompose();

    // Track expanded state for thread items
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (!id) return;

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

                if (emailData?.email) {
                    // Mark as read if needed
                    if (!emailData.email.read) {
                        emailData.email.read = true;
                        // Fire and forget API update
                        fetch(`/api/emails/${emailData.email.id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ read: true })
                        }).then(async () => {
                            // Optimistically update the list cache to avoid full re-render
                            const folder = emailData.email.folder || 'inbox';
                            const listKey = `emails-${folder}`;
                            const cachedList = await getData<any[]>(listKey);

                            if (Array.isArray(cachedList)) {
                                const idx = cachedList.findIndex((e: any) => e.id === emailData.email.id);
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
                setLoading(false);
            }
        }
        fetchEmailAndLabels();
    }, [id, getData, setCacheData]);

    const handleUpdate = async (updates: any) => {
        if (!data) return;

        const previousData = { ...data };
        const newData = {
            ...previousData,
            email: { ...previousData.email, ...updates }
        };

        setLocalData(newData);
        setCacheData(`email-${data.email.id}-${ENABLE_THREAD_VIEW ? 'thread-v2' : 'single'}`, newData);

        try {
            const res = await fetch(`/api/emails/${data.email.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });

            if (!res.ok) throw new Error('Failed to update');

            if (updates.toggleLabelId) {
                const json = await res.json();
                const updatedData = { ...previousData, email: json };
                setLocalData(updatedData);
                setCacheData(`email-${data.email.id}-${ENABLE_THREAD_VIEW ? 'thread-v2' : 'single'}`, updatedData);
            }

            toast.success('Updated');
        } catch (error) {
            setLocalData(previousData);
            setCacheData(`email-${data.email.id}-${ENABLE_THREAD_VIEW ? 'thread-v2' : 'single'}`, previousData);
            toast.error('Failed to update');
        }
    };

    const toggleLabel = (labelId: string) => {
        handleUpdate({ toggleLabelId: labelId });
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

    const handleReply = () => {
        if (!data) return;
        const { email } = data; // Usually replies to the last one
        // If threading, we might want to reply to the specific visible message, but standard is last.
        // With reversed order (newest first), we target index 0.
        const targetEmail = (data.thread && data.thread.length > 0) ? data.thread[0].email : data.email;
        const targetContent = (data.thread && data.thread.length > 0) ? data.thread[0].content : data.content;

        const quoteHeader = `<div dir="ltr" class="gmail_attr">On ${formatDate(targetEmail.createdAt)}, ${targetEmail.from} wrote:<br></div>`;
        const quoteBody = `<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px #999 solid;padding-left:1ex">${targetContent}</blockquote>`;

        openCompose({
            id: crypto.randomUUID(),
            to: targetEmail.from,
            subject: targetEmail.subject.startsWith('Re:') ? targetEmail.subject : `Re: ${targetEmail.subject}`,
            body: `<p></p><br><div class="gmail_quote">${quoteHeader}${quoteBody}</div>`,
            minimized: false
        });
    };

    const handleForward = () => {
        if (!data) return;
        const { email } = data;
        // With reversed order (newest first), we target index 0.
        const targetEmail = (data.thread && data.thread.length > 0) ? data.thread[0].email : data.email;
        const targetContent = (data.thread && data.thread.length > 0) ? data.thread[0].content : data.content;

        openCompose({
            id: crypto.randomUUID(),
            to: '',
            subject: targetEmail.subject.startsWith('Fwd:') ? targetEmail.subject : `Fwd: ${targetEmail.subject}`,
            body: `<p></p><p>---------- Forwarded message ---------<br>From: ${targetEmail.from}<br>Date: ${formatDate(targetEmail.createdAt)}<br>Subject: ${targetEmail.subject}<br>To: ${targetEmail.to}</p><br>${targetContent}`,
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
        <div className="flex h-full flex-col bg-background">
            <div className="flex items-center gap-2 p-2 bg-background/95 backdrop-blur-sm sticky top-0 z-10 border-b">
                <button onClick={() => router.push('/')} className="md:hidden p-2"><ArrowLeft className="h-5 w-5" /></button>
                <div className="flex items-center gap-1">
                    <button onClick={() => {
                        const params = new URLSearchParams(searchParams);
                        params.delete('id');
                        router.push(`/?${params.toString()}`);
                    }} className="p-2 hover:bg-muted rounded-md hidden md:block" title="Close"><X className="h-4 w-4" /></button>
                    <div className="h-5 w-px bg-border mx-1 hidden md:block" />

                    <button onClick={() => handleUpdate({ folder: 'archive' })} className="p-2 hover:bg-muted rounded-md"><Archive className="h-4 w-4" /></button>
                    <button onClick={() => handleUpdate({ folder: 'spam' })} className="p-2 hover:bg-muted rounded-md"><ArchiveX className="h-4 w-4" /></button>
                    <button onClick={trashEmail} className="p-2 hover:bg-muted rounded-md"><Trash2 className="h-4 w-4" /></button>
                    <button onClick={handleReply} className="p-2 hover:bg-muted rounded-md"><Reply className="h-4 w-4 text-muted-foreground" /></button>
                    <button onClick={handleForward} className="p-2 hover:bg-muted rounded-md"><Forward className="h-4 w-4 text-muted-foreground" /></button>

                    {/* JSON Extensions Toolbar */}
                    <ExtensionLoader mountPoint="EMAIL_TOOLBAR" context={data?.email} />
                </div>
                <div className="h-5 w-px bg-border mx-1" />
                <button onClick={() => handleUpdate({ starred: !data.email?.starred })} className={cn("p-2 hover:bg-muted rounded-md", data.email?.starred && "text-yellow-500")}>
                    <Star className={cn("h-4 w-4", data.email?.starred && "fill-current")} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto">
                <div className="p-6 pb-2">
                    <h2 className="text-xl font-semibold leading-tight">{threadItems[0].email.subject || '(No Subject)'}</h2>
                </div>

                <div className="flex flex-col">
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
                                        onClick={(e) => {
                                            if (!isExpanded) {
                                                toggleExpand(item.email.id);
                                            } else {
                                                // Optional: Allow collapsing?
                                                toggleExpand(item.email.id);
                                            }
                                        }}
                                    >
                                        <div className="flex items-start justify-between gap-4 cursor-pointer">
                                            <div className="flex items-center gap-3">
                                                <div className={cn("flex h-8 w-8 items-center justify-center rounded-full font-semibold text-xs transition-colors", isExpanded ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                                                    {item.email.from.charAt(0).toUpperCase()}
                                                </div>
                                                <div className="flex flex-col">
                                                    <div className="flex items-baseline gap-2">
                                                        <span className={cn("text-sm font-medium transition-colors", !isExpanded && "text-muted-foreground")}>{item.email.from}</span>
                                                        <span className="text-xs text-muted-foreground">&lt;{item.email.to}&gt;</span>
                                                    </div>
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
                                            <div className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(item.email.createdAt)}</div>
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
                                                <div className="px-4 pb-8 pl-14">
                                                    <SafeIframe html={cleanHtml} />

                                                    <div className="mt-8 flex gap-2 opacity-100">
                                                        <button onClick={handleReply} className="inline-flex items-center gap-2 px-4 py-2 rounded-full border bg-background hover:bg-muted text-sm font-medium transition-colors">
                                                            <Reply className="h-4 w-4" /> Reply
                                                        </button>
                                                        <button onClick={handleForward} className="inline-flex items-center gap-2 px-4 py-2 rounded-full border bg-background hover:bg-muted text-sm font-medium transition-colors">
                                                            <Forward className="h-4 w-4" /> Forward
                                                        </button>
                                                    </div>

                                                    {item.email.attachments && item.email.attachments.length > 0 && (
                                                        <div className="mt-6 pt-4 border-t">
                                                            <div className="flex flex-wrap gap-3">
                                                                {item.email.attachments.map((att: any) => (
                                                                    <a key={att.id} href={att.url || '#'} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-2 rounded-lg border bg-background hover:bg-accent transition-colors">
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
