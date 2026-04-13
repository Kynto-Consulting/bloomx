'use client';

import { useState, useEffect, useRef, memo, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Archive, Trash2, Star, Tag } from 'lucide-react'; // Imports for icons
import { formatDate, cn } from '@/lib/utils';
import { Loader2, Search, Menu, Plus, User, SlidersHorizontal } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useCompose } from '@/contexts/ComposeContext';
import { useCache } from '@/contexts/CacheContext';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { fetchDeduped } from '@/lib/fetchdedupe';
import { useOffline } from '@/contexts/OfflineContext';
import { AccountManager } from '@/lib/account-manager';

const ACCOUNT_FILTER_STORAGE_KEY = 'bloomx:mailbox:account-filter:v1';

interface Email {
    id: string;
    from: string;
    accountEmail?: string | null;
    draftFrom?: string;
    subject: string;
    snippet: string;
    createdAt: string;
    read: boolean;
    to?: string;
    cc?: string;
    bcc?: string;
    originalBody?: string;
    attachments?: any[];
    starred?: boolean;
    labels?: string[];
}

function formatMobileDate(date: string) {
    if (!date) return '';

    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) {
        return '';
    }

    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    }).format(parsed);
}

export function EmailList() {
    const searchParams = useSearchParams();
    const folder = searchParams.get('folder') || 'inbox';
    const selectedId = searchParams.get('id');
    const router = useRouter();
    const { openCompose } = useCompose();
    const { getData, setData, subscribe, invalidate } = useCache(); // Use cache

    useEffect(() => {
        // Subscribe to cache changes from OTHER components (e.g. MailView updates)
        const unsubscribe = subscribe(() => {
            setCacheVersion(v => v + 1);
        });
        return unsubscribe;
    }, [subscribe]);

    const [cacheVersion, setCacheVersion] = useState(0);

    const [emails, setEmails] = useState<Email[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'all' | 'unread'>('all');
    const [availableAccounts, setAvailableAccounts] = useState<string[]>([]);

    // Selection State
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [lastSelectedId, setLastSelectedId] = useState<string | null>(null); // For shift-click
    const [focusedId, setFocusedId] = useState<string | null>(null); // For keyboard navigation

    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);

    const filteredEmails = activeTab === 'unread' ? emails.filter(e => !e.read) : emails;

    // --- Threading / Grouping Logic ---
    const normalizeSubject = (subject: string) => {
        if (!subject) return '';
        // Remove Re:, Fwd:, Invitation:, etc. (Case insensitive)
        return subject.replace(/^((re|fwd|rv|enc|invitaci[oó]n|invitaci[oó]n actualizada|accepted|declined|tentative|cancelado|canceled|updated): ?)+/gi, '').trim();
    };

    const groupedEmails = useMemo(() => {
        const groups: { [key: string]: Email[] } = {};

        filteredEmails.forEach(email => {
            const rawSubject = email.subject || '';
            const normalized = normalizeSubject(rawSubject);
            const accountKey = String(email.accountEmail || '').toLowerCase();

            // Don't group "No Subject" or very short subjects to avoid false positives
            if (!normalized || normalized.length < 3 || normalized === '(No Subject)') {
                // Treat as unique key using ID to avoid collision
                groups[`__unique_${email.id}`] = [email];
                return;
            }

            const threadKey = `${accountKey}::${normalized}`;
            if (!groups[threadKey]) {
                groups[threadKey] = [];
            }
            groups[threadKey].push(email);
        });

        // Convert back to array for rendering
        // We want to sort the GROUPS by the 'latest' email in that group (which determines position)
        const groupList = Object.values(groups).map(groupEmails => {
            // Sort emails within group by date desc (newest first)
            groupEmails.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            return {
                id: groupEmails[0].id, // Use latest email ID as group ID
                latestEmail: groupEmails[0],
                allEmails: groupEmails,
                count: groupEmails.length
            };
        });

        // Sort groups by their latest email's date
        groupList.sort((a, b) => new Date(b.latestEmail.createdAt).getTime() - new Date(a.latestEmail.createdAt).getTime());

        return groupList;
    }, [filteredEmails]);

    // Advanced Search State
    const [showFilters, setShowFilters] = useState(false);
    const [filterFrom, setFilterFrom] = useState('');
    const [filterHasAttachment, setFilterHasAttachment] = useState(false);
    const [filterSince, setFilterSince] = useState('');
    const [filterUntil, setFilterUntil] = useState('');
    const [accountFilter, setAccountFilter] = useState('');

    // Initialize filters from URL
    useEffect(() => {
        setFilterFrom(searchParams.get('from') || '');
        setFilterHasAttachment(searchParams.get('hasAttachment') === 'true');
        setFilterSince(searchParams.get('since') || '');
        setFilterUntil(searchParams.get('until') || '');
    }, [searchParams]);

    useEffect(() => {
        const urlAccount = searchParams.get('account') || '';
        const currentFolder = searchParams.get('folder') || 'inbox';
        
        if (urlAccount) {
            const normalized = urlAccount.trim().toLowerCase();
            setAccountFilter(normalized);
            if (typeof window !== 'undefined') {
                window.localStorage.setItem(ACCOUNT_FILTER_STORAGE_KEY, normalized);
            }
            return;
        }

        // Clear account filter if explicitly removed from URL
        // But only load from localStorage if we're staying in the same context
        const storedFolder = typeof window !== 'undefined' ? window.localStorage.getItem('bloomx:current-folder-context') : null;
        
        if (storedFolder === currentFolder && typeof window !== 'undefined') {
            const storedAccount = window.localStorage.getItem(ACCOUNT_FILTER_STORAGE_KEY) || '';
            setAccountFilter(storedAccount.trim().toLowerCase());
        } else {
            // Clear filter when navigating to different folder without explicit account param
            setAccountFilter('');
            if (typeof window !== 'undefined') {
                window.localStorage.removeItem(ACCOUNT_FILTER_STORAGE_KEY);
            }
        }
        
        // Remember current folder context
        if (typeof window !== 'undefined') {
            window.localStorage.setItem('bloomx:current-folder-context', currentFolder);
        }
    }, [searchParams]);

    useEffect(() => {
        const accountSet = new Set<string>();

        try {
            const storedAccounts = AccountManager.getAccounts();
            storedAccounts.forEach((account) => {
                const email = String(account?.email || '').trim().toLowerCase();
                if (email.includes('@')) {
                    accountSet.add(email);
                }
            });
        } catch {
            // Ignore local storage parsing errors.
        }

        emails.forEach((email) => {
            const account = String(email.accountEmail || '').trim().toLowerCase();
            if (account.includes('@')) {
                accountSet.add(account);
            }
        });

        if (accountFilter) {
            accountSet.add(accountFilter.toLowerCase());
        }

        setAvailableAccounts(Array.from(accountSet));
    }, [emails, accountFilter]);

    const applyFilters = () => {
        const params = new URLSearchParams(searchParams);
        if (filterFrom) params.set('from', filterFrom);
        else params.delete('from');

        if (filterHasAttachment) params.set('hasAttachment', 'true');
        else params.delete('hasAttachment');

        if (filterSince) params.set('since', filterSince);
        else params.delete('since');

        if (filterUntil) params.set('until', filterUntil);
        else params.delete('until');

        setShowFilters(false);
        router.push(`/?${params.toString()}`);
    };

    // Keyboard Shortcuts
    useKeyboardShortcuts({
        'c': () => openCompose(),
        '/': (e) => {
            e.preventDefault();
            document.querySelector<HTMLInputElement>('input[placeholder="Search emails..."]')?.focus();
        },
        'j': () => {
            if (groupedEmails.length === 0) return;
            const currentIndex = focusedId ? groupedEmails.findIndex(g => g.id === focusedId) : -1;
            const nextIndex = Math.min(currentIndex + 1, groupedEmails.length - 1);
            setFocusedId(groupedEmails[nextIndex].id);
            // Optional: Scroll into view logic here
        },
        'k': () => {
            if (groupedEmails.length === 0) return;
            const currentIndex = focusedId ? groupedEmails.findIndex(g => g.id === focusedId) : 0;
            const prevIndex = Math.max(currentIndex - 1, 0);
            setFocusedId(groupedEmails[prevIndex].id);
        },
        'x': () => {
            if (focusedId) {
                // Toggle selection of focused
                toggleSelection({ stopPropagation: () => { } } as any, focusedId);
            }
        },
        'e': () => {
            // Archive
            if (selectedIds.size > 0) handleBulkAction({ folder: 'archive' });
            else if (focusedId) handleBulkAction({ ids: [focusedId], folder: 'archive' });
        },
        '#': () => { // Shift+3 basically
            // Delete
            if (selectedIds.size > 0) handleBulkAction({ folder: 'trash' });
            else if (focusedId) handleBulkAction({ ids: [focusedId], folder: 'trash' });
        },
        'delete': () => {
            if (selectedIds.size > 0) handleBulkAction({ folder: 'trash' });
            else if (focusedId) handleBulkAction({ ids: [focusedId], folder: 'trash' });
        },
        'backspace': () => {
            if (selectedIds.size > 0) handleBulkAction({ folder: 'trash' });
            else if (focusedId) handleBulkAction({ ids: [focusedId], folder: 'trash' });
        }
    });

    // Main Sync Logic
    const syncEmails = async (mode: 'refresh' | 'loadMore' = 'refresh') => {
        if (mode === 'loadMore' && (loading || loadingMore)) return;
        if (mode === 'refresh' && loadingMore) return;
        const labelParam = searchParams.get('label');
        const cacheKeyBase = labelParam ? `emails-label-${labelParam}` : `emails-${folder}`;
        const accountParam = searchParams.get('account');
        const effectiveAccount = accountFilter || accountParam || '';
        const cacheKey = effectiveAccount ? `${cacheKeyBase}-account-${effectiveAccount}` : cacheKeyBase;

        try {
            if (mode === 'refresh') {
                if (emails.length === 0) setLoading(true);
            } else {
                setLoadingMore(true);
            }

            let currentEmails = [...emails];
            let url = `/api/emails?folder=${folder}`;
            if (labelParam) {
                url += `&label=${labelParam}`;
            }
            if (effectiveAccount) {
                url += `&account=${encodeURIComponent(effectiveAccount)}`;
            }

            // 1. Initial Load / Refresh
            if (mode === 'refresh') {
                // Try Cache first if we haven't loaded yet
                if (emails.length === 0 && folder !== 'drafts') {
                    const cached = await getData<{ emails: Email[] }>(cacheKey);
                    if (cached && Array.isArray(cached) && cached.length > 0) {
                        currentEmails = cached;
                        setEmails(cached);
                        setLoading(false); // Show cache immediately
                    }
                }
                // Reload from cache if version changed (external update)
                else if (emails.length > 0) {
                    const cached = await getData<{ emails: Email[] }>(cacheKey);
                    if (cached && Array.isArray(cached) && cached.length > 0) {
                        currentEmails = cached;
                        setEmails(cached);
                        // Don't setLoading(false) here, we might still fetch new stuff
                    } else {
                        // Cache invalidated or empty -> Force full refresh
                        currentEmails = [];
                        setEmails([]);
                        setLoading(true); // Force loading if cache cleared
                    }
                }

                // Smart Fetch (Since)
                if (currentEmails.length > 0) {
                    const latest = currentEmails[0].createdAt;
                    url += `&since=${latest}`;
                }
            }
            // 2. Load More (Pagination)
            else if (mode === 'loadMore' && emails.length > 0) {
                const oldest = emails[emails.length - 1].createdAt;
                url += `&until=${oldest}`;
            }

            // Drafts special case (no sync logic yet, just full fetch)
            if (folder === 'drafts') {
                if (mode === 'loadMore') return; // No pagination for drafts yet
                const res = await fetch('/api/drafts');
                const data = await res.json();
                if (data.drafts) {
                    const mapped = data.drafts.map((d: any) => ({
                        id: d.id,
                        from: d.to ? `To: ${d.to}` : '(No Recipients)',
                        draftFrom: d.from,
                        accountEmail: d.from,
                        subject: d.subject || '(No Subject)',
                        snippet: d.body ? d.body.replace(/<[^>]+>/g, '') : '',
                        createdAt: d.updatedAt,
                        read: true,
                        to: d.to,
                        cc: d.cc,
                        bcc: d.bcc,
                        originalBody: d.body,
                        attachments: d.attachments
                    }));
                    setEmails(mapped);
                    setData(cacheKey, mapped, { silent: true });
                    setHasMore(false);
                }
                setLoading(false);
                return;
            }

            // Fetch
            const data = await fetchDeduped(url);

            if (data.emails) {
                if (mode === 'refresh') {
                    if (data.emails.length > 0) {
                        // Merge New + Current
                        const newIds = new Set(data.emails.map((e: any) => e.id));
                        const merged = [...data.emails, ...currentEmails.filter(e => !newIds.has(e.id))];
                        setEmails(merged);
                        setData(cacheKey, merged, { silent: true });
                    }
                    // If refresh returns 0, we are up to date.
                } else {
                    // Load More
                    if (data.emails.length > 0) {
                        const merged = [...emails, ...data.emails];
                        setEmails(merged);
                        setData(cacheKey, merged, { silent: true }); // Update cache with extended list
                    } else {
                        setHasMore(false); // End of list
                    }
                }
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    };

    const prefetchEmail = useCallback(async (id: string) => {
        // Match key with MailView
        const cacheKey = `email-${id}-thread-v2`;
        // Check if already in cache
        const cached = await getData(cacheKey);
        if (cached) return;

        try {
            const data = await fetchDeduped(`/api/emails/${id}?thread=true`);
            if (data?.email) {
                setData(cacheKey, data, { silent: true });
            }
        } catch (e) {
            // Siently fail for prefetch
            console.error('Prefetch failed', e);
        }
    }, [getData, setData]);

    // Track previous nav state to avoid clearing on cache updates
    const prevFolder = useRef(folder);
    const prevLabel = useRef(searchParams.get('label'));
    const prevAccount = useRef(searchParams.get('account'));

    // Initial Sync on Mount/Folder Change/Label Change
    useEffect(() => {
        const currentLabel = searchParams.get('label');
        const currentAccount = searchParams.get('account');
        const hasNavigated = folder !== prevFolder.current || currentLabel !== prevLabel.current || currentAccount !== prevAccount.current;

        if (hasNavigated) {
            setEmails([]); // Reset only on navigation
            setHasMore(true);
            prevFolder.current = folder;
            prevLabel.current = currentLabel;
            prevAccount.current = currentAccount;
        }

        syncEmails('refresh');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [folder, searchParams.get('label'), accountFilter, cacheVersion]);

    // Scroll Handler for Infinite Scroll
    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
        if (scrollHeight - scrollTop <= clientHeight + 100) { // 100px threshold
            if (!loadingMore && hasMore && !loading) {
                syncEmails('loadMore');
            }
        }
    };

    const handleSelect = useCallback((id: string) => {
        if (folder === 'drafts') {
            // For drafts, open in Compose
            const draft = emails.find(e => e.id === id);
            if (draft) {
                openCompose({
                    id: draft.id,
                    draftId: draft.id,
                    from: draft.draftFrom || undefined,
                    to: draft.to || '',
                    cc: draft.cc || '',
                    bcc: draft.bcc || '',
                    subject: draft.subject === '(No Subject)' ? '' : draft.subject,
                    body: draft.originalBody || '',
                    minimized: false,
                    attachments: draft.attachments || []
                });
                return;
            }
        }

        const params = new URLSearchParams(searchParams);
        params.set('id', id);
        router.push(`/?${params.toString()}`);
    }, [folder, emails, openCompose, searchParams, router]);

    const updateAccountFilter = useCallback((value: string) => {
        const normalized = value.trim().toLowerCase();
        setAccountFilter(normalized);

        if (typeof window !== 'undefined') {
            if (normalized) {
                window.localStorage.setItem(ACCOUNT_FILTER_STORAGE_KEY, normalized);
            } else {
                window.localStorage.removeItem(ACCOUNT_FILTER_STORAGE_KEY);
            }
        }

        const params = new URLSearchParams(searchParams);
        if (normalized) {
            params.set('account', normalized);
        } else {
            params.delete('account');
        }
        params.delete('id');
        router.push(`/?${params.toString()}`);
    }, [router, searchParams]);

    const toggleSelection = useCallback((e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        // Use functional state update to avoid dependency on selectedIds
        setSelectedIds(prev => {
            const newSelected = new Set(prev);
            // Note: lastSelectedId is tricky inside callback if we want to avoid dependency,
            // but for shift-click we need it. Let's include lastSelectedId dependency.

            // To properly handle shift-click with functional state, we likely need access to groupedEmails too.
            // Since this function is complex and depends on many things, let's just use standard deps.

            if (e.shiftKey && lastSelectedId) {
                const currentIndex = groupedEmails.findIndex(g => g.id === id);
                const lastIndex = groupedEmails.findIndex(g => g.id === lastSelectedId);
                const start = Math.min(currentIndex, lastIndex);
                const end = Math.max(currentIndex, lastIndex);

                for (let i = start; i <= end; i++) {
                    // Select ALL emails in the group
                    groupedEmails[i].allEmails.forEach(email => newSelected.add(email.id));
                }
            } else {
                const group = groupedEmails.find(g => g.id === id);
                const idsToToggle = group ? group.allEmails.map(e => e.id) : [id];

                const isSelected = newSelected.has(id);

                if (isSelected) {
                    idsToToggle.forEach(i => newSelected.delete(i));
                } else {
                    idsToToggle.forEach(i => newSelected.add(i));
                }
                setLastSelectedId(id);
            }
            return newSelected;
        });
    }, [groupedEmails, lastSelectedId]);

    const handleSelectAll = () => {
        if (selectedIds.size === filteredEmails.length && filteredEmails.length > 0) {
            setSelectedIds(new Set());
        } else {
            // Select ALL emails (flattened)
            setSelectedIds(new Set(emails.map(e => e.id)));
        }
    };

    const { addToQueue, isOnline } = useOffline();

    const handleBulkAction = useCallback(async (updates: any) => {
        // Support explicit IDs passed in updates (for Swipe actions), otherwise use selectedIds
        const ids = updates.ids || Array.from(selectedIds);

        if (ids.length === 0) return;

        // Cleanup explicit IDs from updates object before sending to API/State
        const { ids: _explicitIds, ...actualUpdates } = updates;

        // Optimistic UI
        // We use functional update to be safe, but typically we want to trigger this AFTER state is updated.
        // Actually here we depend on 'emails' and 'selectedIds' which change frequently.
        // This is the hardest one to memoize effectively without refactoring to use reducers or refs.
        // But let's try.

        setEmails(prev => prev.map(e => ids.includes(e.id) ? { ...e, ...actualUpdates } : e));

        // If moving folder, remove from current view locally
        if (actualUpdates.folder || actualUpdates.folder === 'trash') {
            setEmails(prev => prev.filter(e => !ids.includes(e.id)));
        }

        setSelectedIds(new Set()); // Clear selection after action

        const execute = async () => {
            if (folder === 'drafts') {
                // Drafts Handling
                if (actualUpdates.folder === 'trash') {
                    await fetch('/api/drafts/batch', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ids, action: 'delete' })
                    });
                } else {
                    // Drafts don't support other bulk actions yet (star, label, etc on Draft model)
                    console.warn('Action not supported for drafts');
                    // Revert optimistic? Or just ignore.
                }
            } else {
                // Standard Emails
                const isPermanentDelete = folder === 'trash' && actualUpdates.folder === 'trash';

                if (isPermanentDelete) {
                    await fetch('/api/emails/batch', {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ids })
                    });
                } else {
                    await fetch('/api/emails/batch', {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ids, updates: actualUpdates })
                    });
                }
            }
            router.refresh();
        };

        // --- Update Sidebar Counts & List Cache ---
        // By invalidating, we force Sidebar to re-fetch counts and EmailList to re-fetch list
        const invalidation = async () => {
            await invalidate('stats-counts');
            await invalidate(`emails-${folder}`);
            if (actualUpdates.folder) {
                await invalidate(`emails-${actualUpdates.folder}`);
            }
            if (folder === 'trash' || actualUpdates.folder === 'trash') {
                await invalidate('emails-trash');
            }
        };

        if (isOnline) {
            try {
                await execute();
                await invalidation();
            } catch (err) {
                console.error(err);
                // ... queue logic ...
                if (folder === 'drafts' && actualUpdates.folder === 'trash') {
                    addToQueue('/api/drafts/batch', 'POST', { ids, action: 'delete' }, 'Delete Drafts');
                } else if (folder === 'trash' && actualUpdates.folder === 'trash') {
                    addToQueue('/api/emails/batch', 'DELETE', { ids }, 'Delete Emails Permanently');
                } else if (folder !== 'drafts') {
                    addToQueue('/api/emails/batch', 'PATCH', { ids, updates: actualUpdates }, 'Bulk update (Retry)');
                }
            }
        } else {
            // ... queue logic ...
            if (folder === 'drafts' && actualUpdates.folder === 'trash') {
                addToQueue('/api/drafts/batch', 'POST', { ids, action: 'delete' }, 'Delete Drafts');
            } else if (folder === 'trash' && actualUpdates.folder === 'trash') {
                addToQueue('/api/emails/batch', 'DELETE', { ids }, 'Delete Emails Permanently');
            } else if (folder !== 'drafts') {
                addToQueue('/api/emails/batch', 'PATCH', { ids, updates: actualUpdates },
                    actualUpdates.folder ? `Move to ${actualUpdates.folder}` : 'Update emails'
                );
            }
            // Even offline, we might want to invalidate to show "empty" or optimistic state if we handled it in UI?
            // "execute" already did optimistic setEmails.
            // But stats-counts won't change offline unless we calculate it incorrectly.
            // Let's rely on Optimistic setEmails for List, and wait for online for Counts update, 
            // OR manually update counts cache? 
            // We previously had manual update logic, let's keep it if we want immediate feedback offline.
            // But relying on invalidation is simpler for Online.
        }

        // Keep the specific draft logic if valid, but invalidation covers it for online.
        if (actualUpdates.folder === 'trash' && folder === 'drafts') {
            // Only keep this for offline/instant feedback if needed, 
            // but 'invalidate' is safer. Let's rely on invalidate for consistency.
        }
    }, [selectedIds, folder, isOnline, router, invalidate, addToQueue]);

    // Stable Swipe Handler
    const handleSwipe = useCallback(async (id: string, updates: any) => {
        // We find all emails in this thread/group to apply action to all
        // We need 'groupedEmails' to be in dependency or utilize functional approach if possible
        const group = groupedEmails.find(g => g.id === id);
        if (group) {
            const ids = group.allEmails.map(e => e.id);
            await handleBulkAction({ ids, ...updates });
        } else {
            // Fallback if not grouped or found?
            await handleBulkAction({ ids: [id], ...updates });
        }
    }, [groupedEmails, handleBulkAction]);


    // Remove duplicate filteredEmails declaration here since it was moved up

    // Mock badges for demo
    const getBadges = (email: Email) => {
        const badges = [];
        if (email.from.toLowerCase().includes('work')) badges.push({ label: 'work', variant: 'outline' });
        if (email.subject.toLowerCase().includes('meeting')) badges.push({ label: 'meeting', variant: 'secondary' });
        return badges;
    };

    return (
        <div className="flex h-full flex-col bg-background/50">
            {/* ... Desktop Header & Search kept implicitly by Context/Code ... 
                Wait, I am replacing a huge chunk. I should target specific lines to avoid deleting Header/Search.
                The duplicate declaration is around line 350.
                The render loop is around 420.
                SwipeableEmailItem is at 511.
                
                I should use MULTI_REPLACE or be very careful with big replace.
                Since I need to delete one line and modify another area, multi_replace is better.
            */}

            {/* Desktop Header */}
            <div className="hidden md:flex items-center justify-between px-4 py-3 bg-background/95 backdrop-blur-sm sticky top-0 z-10  min-h-[60px]">
                {selectedIds.size > 0 ? (
                    <div className="flex items-center gap-2 w-full animate-in fade-in slide-in-from-top-2 duration-200">
                        <div className="flex items-center gap-2 mr-2">
                            <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                checked={selectedIds.size === filteredEmails.length && filteredEmails.length > 0}
                                onChange={handleSelectAll}
                            />
                            <span className="text-sm font-medium">{selectedIds.size} selected</span>
                        </div>
                        <div className="flex items-center gap-1 ml-auto">
                            <button onClick={() => handleBulkAction({ starred: true })} className="p-2 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground" title="Star">
                                <Star className="h-4 w-4" />
                            </button>
                            <button className="p-2 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground" title="Label">
                                <Tag className="h-4 w-4" />
                            </button>
                            <button onClick={() => handleBulkAction({ read: true })} className="p-2 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground" title="Mark Read">
                                <Search className="h-4 w-4" />
                            </button>
                            <button onClick={() => handleBulkAction({ folder: 'archive' })} className="p-2 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground" title="Archive">
                                <Archive className="h-4 w-4" />
                            </button>
                            <button onClick={() => handleBulkAction({ folder: 'trash' })} className="p-2 hover:bg-red-50 hover:text-red-600 rounded-md text-muted-foreground" title="Trash">
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        <h1 className="text-xl font-bold capitalize tracking-tight">{folder}</h1>
                        <div className="inline-flex h-8 items-center justify-center rounded-lg bg-muted/50 p-1">
                            <button
                                onClick={() => setActiveTab('all')}
                                className={cn(
                                    "inline-flex h-full items-center justify-center rounded-md px-3 text-xs font-medium transition-all",
                                    activeTab === 'all'
                                        ? "bg-white text-foreground shadow-sm"
                                        : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                All
                            </button>
                            <button
                                onClick={() => setActiveTab('unread')}
                                className={cn(
                                    "inline-flex h-full items-center justify-center rounded-md px-3 text-xs font-medium transition-all",
                                    activeTab === 'unread'
                                        ? "bg-white text-foreground shadow-sm"
                                        : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                Unread
                            </button>
                        </div>
                    </>
                )}
            </div>

            {/* Desktop Search */}
            <div className="hidden md:block px-4 py-2">
                <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground opacity-50" />
                    <input
                        placeholder="Search emails..."
                        defaultValue={searchParams.get('q') || ''}
                        className="h-9 w-full rounded-xl border border-input bg-muted/30 pl-9 pr-3 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring/50 transition-all placeholder:text-muted-foreground/60"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                const val = (e.target as HTMLInputElement).value;
                                const params = new URLSearchParams(searchParams);
                                if (val) params.set('q', val);
                                else params.delete('q');
                                router.push(`/?${params.toString()}`);
                            }
                        }}
                    />
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className={cn("absolute right-2 top-1.5 p-1.5 rounded-md hover:bg-background/80 transition-colors", (filterFrom || filterHasAttachment || filterSince || filterUntil) && "text-blue-600")}
                    >
                        <SlidersHorizontal className="h-4 w-4" />
                    </button>

                    {/* Search Filters Popover */}
                    {showFilters && (
                        <div className="absolute top-11 right-0 w-72 bg-popover/95 backdrop-blur-md border shadow-lg rounded-xl p-4 z-50 flex flex-col gap-3">
                            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Advanced Search</h3>

                            <div className="space-y-1">
                                <label className="text-xs font-medium">From</label>
                                <input
                                    className="w-full h-8 rounded-md border bg-background px-2 text-sm"
                                    placeholder="sender@example.com"
                                    value={filterFrom}
                                    onChange={(e) => setFilterFrom(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                    <label className="text-xs font-medium">Date (Start)</label>
                                    <input
                                        type="date"
                                        className="w-full h-8 rounded-md border bg-background px-2 text-sm"
                                        value={filterSince}
                                        onChange={(e) => setFilterSince(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-medium">Date (End)</label>
                                    <input
                                        type="date"
                                        className="w-full h-8 rounded-md border bg-background px-2 text-sm"
                                        value={filterUntil}
                                        onChange={(e) => setFilterUntil(e.target.value)}
                                    />
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="hasAttachment"
                                    className="h-4 w-4 rounded border-gray-300"
                                    checked={filterHasAttachment}
                                    onChange={(e) => setFilterHasAttachment(e.target.checked)}
                                />
                                <label htmlFor="hasAttachment" className="text-sm">Has Attachment</label>
                            </div>

                            <div className="flex justify-end gap-2 mt-1">
                                <button
                                    onClick={() => {
                                        setFilterFrom('');
                                        setFilterHasAttachment(false);
                                        setFilterSince('');
                                        setFilterUntil('');
                                        setShowFilters(false);
                                        const params = new URLSearchParams(searchParams);
                                        params.delete('from');
                                        params.delete('hasAttachment');
                                        params.delete('since');
                                        params.delete('until');
                                        router.push(`/?${params.toString()}`);
                                    }}
                                    className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                                >
                                    Clear
                                </button>
                                <button
                                    onClick={applyFilters}
                                    className="px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-md shadow-sm hover:bg-primary/90"
                                >
                                    Search
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {availableAccounts.length > 0 && folder !== 'drafts' && (
                    <div className="mt-2 flex items-center gap-2">
                        <label className="text-xs font-medium text-muted-foreground">Account</label>
                        <select
                            value={accountFilter}
                            onChange={(event) => updateAccountFilter(event.target.value)}
                            className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
                        >
                            <option value="">All accounts</option>
                            {availableAccounts.map((account) => (
                                <option key={account} value={account}>{account}</option>
                            ))}
                        </select>
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto px-2" onScroll={handleScroll}>
                {loading ? (
                    <div className="flex items-center justify-center h-40">
                        <Loader2 className="animate-spin h-6 w-6 text-primary/40" />
                    </div>
                ) : filteredEmails.length === 0 ? (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ type: "spring", stiffness: 300, damping: 20 }}
                        className="flex flex-col items-center justify-center h-64 text-center p-4"
                    >
                        <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                            <Search className="h-6 w-6 text-muted-foreground/50" />
                        </div>
                        <p className="text-sm font-medium text-foreground">No emails found</p>
                        <p className="text-xs text-muted-foreground mt-1">
                            {searchParams.get('label')
                                ? `No emails with label "${searchParams.get('label')}" in ${folder}`
                                : `Your ${folder} is empty.`}
                        </p>
                    </motion.div>
                ) : (
                    <div className="flex flex-col gap-1.5 pb-20 md:pb-4">
                        <AnimatePresence>
                            {groupedEmails.map((group, index) => {
                                const email = group.latestEmail;
                                const badges = getBadges(email);
                                const isSelected = selectedIds.has(email.id); // Check if latest is selected (proxy for group)

                                return (
                                    <SwipeableEmailItem
                                        key={email.id}
                                        email={email}
                                        index={index}
                                        isSelected={isSelected}
                                        isFocused={focusedId === email.id}
                                        selectedIds={selectedIds}
                                        onSelect={handleSelect}
                                        onSelectToggle={toggleSelection}
                                        onPrefetch={prefetchEmail}
                                        onSwipeAction={handleSwipe}
                                        badges={badges}
                                        folder={folder}
                                        threadCount={group.count}
                                    />
                                );
                            })}
                        </AnimatePresence>
                        {loadingMore && (
                            <div className="py-4 flex justify-center text-muted-foreground">
                                <Loader2 className="h-5 w-5 animate-spin" />
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Mobile Bulk Actions */}
            {selectedIds.size > 0 && (
                <div className="md:hidden absolute top-0 left-0 right-0 p-2 z-30">
                    <div className="flex items-center justify-between gap-2 h-14 bg-background border border-border shadow-lg rounded-xl px-4 animate-in fade-in slide-in-from-top-2">
                        <div className="flex items-center gap-2">
                            <span className="font-bold text-lg">{selectedIds.size}</span>
                            <button onClick={() => setSelectedIds(new Set())} className="text-muted-foreground text-sm">Cancel</button>
                        </div>
                        <div className="flex items-center gap-1">
                            <button onClick={() => handleBulkAction({ starred: true })} className="p-2 hover:bg-muted rounded-full" title="Star">
                                <Star className="h-5 w-5" />
                            </button>
                            <button className="p-2 hover:bg-muted rounded-full" title="Label">
                                <Tag className="h-5 w-5" />
                            </button>
                            <button onClick={() => handleBulkAction({ read: true })} className="p-2 hover:bg-muted rounded-full" title="Mark Read">
                                <Search className="h-5 w-5" />
                            </button>
                            <button onClick={() => handleBulkAction({ folder: 'archive' })} className="p-2 hover:bg-muted rounded-full" title="Archive">
                                <Archive className="h-5 w-5" />
                            </button>
                            <button onClick={() => handleBulkAction({ folder: 'trash' })} className="p-2 hover:bg-red-50 text-red-600 rounded-full" title="Trash">
                                <Trash2 className="h-5 w-5" />
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Mobile FAB */}
            {!selectedId && selectedIds.size === 0 && (
                <div className="md:hidden fixed bottom-6 right-6 z-30">
                    <button
                        onClick={() => openCompose()}
                        className="h-14 px-5 rounded-2xl bg-secondary text-secondary-foreground shadow-lg hover:shadow-xl transition-all active:scale-95 flex items-center gap-2 border border-border/10"
                    >
                        <Plus className="h-6 w-6" />
                        <span className="font-medium text-base">Compose</span>
                    </button>
                </div>
            )}
        </div>
    );
}

// Extracted Swipeable Component
const SwipeableEmailItem = memo(function SwipeableEmailItem({
    email, index, isSelected, isFocused, selectedIds, onSelect, onSelectToggle, onPrefetch, onSwipeAction, badges, folder, threadCount
}: any) {
    const [dragX, setDragX] = useState(0);

    // Threshold used to determine if action should fire
    const SWIPE_THRESHOLD = 100;

    const handleDragEnd = async (e: any, info: any) => {
        const offset = info.offset.x;

        if (offset > SWIPE_THRESHOLD) { // Swipe Right -> Archive
            await onSwipeAction(email.id, { folder: 'archive' });
        } else if (offset < -SWIPE_THRESHOLD) { // Swipe Left -> Trash
            await onSwipeAction(email.id, { folder: 'trash' });
        }
    };

    // Calculate background opacity/color based on drag
    const archiveOpacity = Math.min(Math.max(dragX / SWIPE_THRESHOLD, 0), 1);
    const trashOpacity = Math.min(Math.max(-dragX / SWIPE_THRESHOLD, 0), 1);

    const hoverTimer = useRef<NodeJS.Timeout | null>(null);

    return (
        <div className="relative overflow-hidden rounded-xl">
            {/* Background Layers */}
            <div
                className="absolute inset-0 bg-green-500 flex items-center justify-start pl-6 transition-colors"
                style={{ opacity: archiveOpacity }}
            >
                <Archive className="text-white h-6 w-6" />
            </div>
            <div
                className="absolute inset-0 bg-red-500 flex items-center justify-end pr-6 transition-colors"
                style={{ opacity: trashOpacity }}            >
                <Trash2 className="text-white h-6 w-6" />
            </div>

            <motion.div
                layout
                drag="x"
                dragConstraints={{ left: 0, right: 0 }} // Snap back
                dragElastic={0.2} // Resistance
                onDrag={(e, info) => setDragX(info.offset.x)}
                onDragEnd={(e, info) => {
                    handleDragEnd(e, info);
                    setDragX(0); // Reset visual immediately, optimistic UI handles removal
                }}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0, x: 0 }} // Ensure x resets
                exit={{ opacity: 0, height: 0, marginBottom: 0, overflow: 'hidden' }}
                transition={{ duration: 0.2, delay: index * 0.03 }}
                className={cn(
                    "group relative flex items-start gap-3 p-3 text-left text-sm transition-colors border border-transparent select-none cursor-pointer bg-white z-10",
                    isFocused && "ring-2 ring-blue-500 ring-inset z-20", // Focused State
                    isSelected || selectedIds.has(email.id)
                        ? "bg-blue-50/50 hover:bg-blue-50 border-blue-100"
                        : "hover:bg-gray-50 hover:shadow-sm border-gray-100",
                    !email.read && !isSelected && !selectedIds.has(email.id) && "border-l-4 border-l-blue-500 shadow-sm"
                )}
                onMouseEnter={() => {
                    hoverTimer.current = setTimeout(() => {
                        onPrefetch(email.id);
                    }, 500);
                }}
                onMouseLeave={() => {
                    if (hoverTimer.current) {
                        clearTimeout(hoverTimer.current);
                        hoverTimer.current = null;
                    }
                }}
                onClick={() => onSelect(email.id)}
                style={{ x: dragX }} // Bind motion x
            >
                <div
                    className={cn(
                        "pt-1 shrink-0 transition-opacity",
                        selectedIds.has(email.id) ? "opacity-100" : "opacity-0 group-hover:opacity-100 md:opacity-0"
                    )}
                    onClick={(e) => onSelectToggle(e, email.id)}
                >
                    <div className={cn(
                        "h-5 w-5 rounded border flex items-center justify-center transition-colors",
                        selectedIds.has(email.id) ? "bg-blue-600 border-blue-600" : "border-gray-300 bg-white hover:border-gray-400"
                    )}>
                        {selectedIds.has(email.id) && <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                    </div>
                </div>

                <div
                    className="pt-1 shrink-0 z-20 cursor-pointer"
                    onClick={(e) => {
                        e.stopPropagation();
                        onSwipeAction(email.id, { starred: !email.starred });
                    }}
                >
                    <Star className={cn("h-5 w-5 transition-colors", email.starred ? "fill-yellow-400 text-yellow-400" : "text-gray-300 hover:text-yellow-400")} />
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex w-full items-start sm:items-center justify-between gap-2">
                        <div className={cn(
                            "font-semibold truncate",
                            "text-foreground",
                            !email.read && "text-blue-600"
                        )}>
                            {folder === 'sent' && email.to ? `To: ${email.to}` : email.from}
                            {threadCount > 1 && (
                                <span className="ml-2 inline-flex items-center justify-center bg-muted text-muted-foreground text-[10px] font-bold h-5 min-w-[20px] px-1 rounded-full border border-border/50">
                                    {threadCount}
                                </span>
                            )}
                        </div>
                        <div className={cn(
                            "hidden sm:block text-[10px] whitespace-nowrap shrink-0",
                            "text-muted-foreground"
                        )}>
                            {formatDate(email.createdAt)}
                        </div>
                    </div>

                    {email.accountEmail && (
                        <div className="mt-1">
                            <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                                {email.accountEmail}
                            </span>
                        </div>
                    )}

                    <div className="sm:hidden text-[10px] text-muted-foreground mt-0.5 truncate">
                        {formatMobileDate(email.createdAt)}
                    </div>

                    <div className={cn(
                        "font-medium text-xs leading-none mt-0.5",
                        "text-foreground/90",
                        !email.read && "font-bold"
                    )}>
                        {email.subject || '(No Subject)'}
                    </div>

                    <div className={cn(
                        "line-clamp-2 text-xs w-full mt-1",
                        "text-muted-foreground"
                    )}>
                        {email.snippet}
                    </div>

                    {badges.length > 0 && (
                        <div className="flex items-center gap-1.5 mt-2">
                            {badges.map((badge: any, idx: number) => (
                                <span
                                    key={idx}
                                    className={cn(
                                        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium border ring-1 ring-inset",
                                        badge.variant === 'secondary'
                                            ? "border-transparent bg-secondary text-secondary-foreground ring-transparent"
                                            : "border-transparent bg-muted text-muted-foreground ring-transparent"
                                    )}
                                >
                                    {badge.label}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            </motion.div>
        </div>
    );
}, (prevProps, nextProps) => {
    const emailChanged =
        prevProps.email.id !== nextProps.email.id ||
        prevProps.email.read !== nextProps.email.read ||
        prevProps.email.starred !== nextProps.email.starred ||
        prevProps.email.accountEmail !== nextProps.email.accountEmail ||
        prevProps.email.subject !== nextProps.email.subject ||
        prevProps.email.snippet !== nextProps.email.snippet ||
        prevProps.email.createdAt !== nextProps.email.createdAt;

    const selectionChanged =
        prevProps.isSelected !== nextProps.isSelected ||
        prevProps.selectedIds.has(prevProps.email.id) !== nextProps.selectedIds.has(nextProps.email.id);

    const focusChanged = prevProps.isFocused !== nextProps.isFocused;

    const threadChanged = prevProps.threadCount !== nextProps.threadCount;

    return !emailChanged && !selectionChanged && !focusChanged && !threadChanged;
});
