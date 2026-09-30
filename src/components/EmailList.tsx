'use client';

import { useState, useEffect, useRef, memo, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Archive, Trash2, Star, Tag, MailOpen, RefreshCw } from 'lucide-react'; // Imports for icons
import { cn } from '@/lib/utils';
import { Loader2, Search, Menu, Plus, User, SlidersHorizontal, ChevronDown, Check } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { formatMailDate, pluralKey } from '@/lib/i18n/format';
import { VirtualMailRows, type VirtualMailRowsHandle } from '@/components/VirtualMailRows';
import { listItemAria, shouldVirtualize } from '@/lib/virtual-list';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { useCompose } from '@/contexts/ComposeContext';
import { useCache } from '@/contexts/CacheContext';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { fetchDeduped } from '@/lib/fetchdedupe';
import { useOffline } from '@/contexts/OfflineContext';
import { AccountManager, type StoredAccount } from '@/lib/account-manager';
import {
    type ListEmail,
    type LabelRef,
    LABELS_CACHE_KEY,
    EMAIL_LISTS_AND_COUNTS_PATTERN,
    emailsCacheKey,
    shouldListRefresh,
    shouldListReloadSettings,
    SETTINGS_CACHE_KEY,
    normalizeLabelList,
    groupEmailsByThread,
    mergeEmailLists,
    mergeFirstPage,
    applyOptimisticUpdate,
    restoreEmails,
    isPermanentDelete,
    classifyBulkResponse,
    planLabelToggles,
    applyLabelChange,
    labelSelectionState,
    unionLabels,
    buildQuickReply,
    nextFocusIndex,
} from '@/lib/mail-list';

const ACCOUNT_FILTER_STORAGE_KEY = 'bloomx:mailbox:account-filter:v1';

// Los campos extra (to, cc, attachments, ...) viven en el index signature de ListEmail.
type Email = ListEmail;

/** Fecha + hora corta con el idioma de la interfaz (fila movil y cita de respuesta rapida). */
function formatMobileDate(date: string, locale: string) {
    if (!date) return '';

    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) {
        return '';
    }

    return new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    }).format(parsed);
}

/** Nombre de carpeta traducido (inbox -> Bandeja de entrada); carpetas desconocidas se muestran tal cual. */
function folderLabel(t: (key: string) => string, folder: string) {
    const key = `sidebar.folders.${folder}`;
    const label = t(key);
    return label === key ? folder : label;
}

/** Marcas heredadas de versiones anteriores que guardaban texto en ingles dentro de los datos. */
const LEGACY_NO_SUBJECT = '(No Subject)';

export function EmailList() {
    const { t, intlLocale } = useI18n();
    const searchParams = useSearchParams();
    const folder = searchParams.get('folder') || 'inbox';
    const selectedId = searchParams.get('id');
    const router = useRouter();
    const { openCompose } = useCompose();
    const { getData, setData, subscribe, invalidate } = useCache(); // Use cache

    // Dos versiones separadas: abrir un correo (MailView escribe `email-<id>-...`) no debe
    // recargar la lista; solo avisos globales o cambios en claves `emails:*` la recargan.
    const [listVersion, setListVersion] = useState(0);
    const [settingsVersion, setSettingsVersion] = useState(0);

    useEffect(() => {
        const unsubscribe = subscribe((key) => {
            if (shouldListRefresh(key)) setListVersion(v => v + 1);
            if (shouldListReloadSettings(key)) setSettingsVersion(v => v + 1);
        });
        return unsubscribe;
    }, [subscribe]);

    const [emails, setEmails] = useState<Email[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const emailsRef = useRef<Email[]>([]);
    emailsRef.current = emails;
    const [activeTab, setActiveTab] = useState<'all' | 'unread'>('all');
    const [storedAccounts, setStoredAccounts] = useState<StoredAccount[]>([]);
    const [multiAccountEnabled, setMultiAccountEnabled] = useState(false);

    // Selection State
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [focusedId, setFocusedId] = useState<string | null>(null); // For keyboard navigation
    const focusedIdRef = useRef<string | null>(null);
    focusedIdRef.current = focusedId;
    const searchInputRef = useRef<HTMLInputElement | null>(null);

    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [nextPage, setNextPage] = useState(2);
    const [mailboxPaging, setMailboxPaging] = useState<Record<string, { nextPage: number; hasMore: boolean }>>({});

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const loadAccounts = () => setStoredAccounts(AccountManager.getAccounts());
        loadAccounts();

        const handleAccountChange = () => loadAccounts();
        window.addEventListener('account-change', handleAccountChange);
        return () => window.removeEventListener('account-change', handleAccountChange);
    }, []);

    useEffect(() => {
        let cancelled = false;

        const applyMailboxSetting = (settings: any) => {
            if (cancelled) return;
            const enabled = Boolean(settings?.['core-mailbox']?.unifiedRepliesEnabled);
            setMultiAccountEnabled(enabled);
        };

        const loadMailboxSetting = async () => {
            try {
                const cached = await getData<any>(SETTINGS_CACHE_KEY);
                if (cached) {
                    applyMailboxSetting(cached);
                }

                const response = await fetch('/api/settings', { cache: 'no-store' });
                const data = await response.json().catch(() => null);
                applyMailboxSetting(data?.expansionSettings || {});
            } catch {
                if (!cancelled) {
                    setMultiAccountEnabled(false);
                }
            }
        };

        loadMailboxSetting();

        return () => {
            cancelled = true;
        };
    }, [getData]);

    useEffect(() => {
        let cancelled = false;

        const syncMailboxSettingFromCache = async () => {
            try {
                const cached = await getData<any>(SETTINGS_CACHE_KEY);
                if (!cancelled && cached) {
                    setMultiAccountEnabled(Boolean(cached?.['core-mailbox']?.unifiedRepliesEnabled));
                }
            } catch {
                // Ignore cache read errors.
            }
        };

        syncMailboxSettingFromCache();

        return () => {
            cancelled = true;
        };
    }, [settingsVersion, getData]);

    const filteredEmails = useMemo(
        () => (activeTab === 'unread' ? emails.filter(e => !e.read) : emails),
        [emails, activeTab]
    );

    // --- Threading / Grouping Logic (pura, ver lib/mail-list) ---
    const groupedEmails = useMemo(() => groupEmailsByThread(filteredEmails), [filteredEmails]);

    // Advanced Search State
    const [showFilters, setShowFilters] = useState(false);
    const [filterFrom, setFilterFrom] = useState('');
    const [filterHasAttachment, setFilterHasAttachment] = useState(false);
    const [filterSince, setFilterSince] = useState('');
    const [filterUntil, setFilterUntil] = useState('');
    const [accountFilter, setAccountFilter] = useState('');
    const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
    const accountMenuRef = useRef<HTMLDivElement | null>(null);

    const labelFilter = searchParams.get('label') || '';
    const searchFilter = searchParams.get('q') || '';
    const fromFilter = searchParams.get('from') || '';
    const hasAttachmentFilter = searchParams.get('hasAttachment') === 'true';
    const sinceFilter = searchParams.get('since') || '';
    const untilFilter = searchParams.get('until') || '';
    const accountFilterFromUrl = (searchParams.get('account') || '').trim().toLowerCase();
    const resolvedAccountFilter = accountFilterFromUrl || accountFilter;
    const effectiveAccountFilter = multiAccountEnabled ? resolvedAccountFilter : '';
    const accountOptions = useMemo(() => {
        const seen = new Set<string>();

        return storedAccounts
            .map((account) => String(account?.email || '').trim().toLowerCase())
            .filter((email) => {
                if (!email.includes('@') || seen.has(email)) {
                    return false;
                }

                seen.add(email);
                return true;
            })
            .map((email) => ({ value: email, label: email }));
    }, [storedAccounts]);

    const selectedAccountLabel = useMemo(() => {
        if (!effectiveAccountFilter) {
            return t('emailList.allAccounts');
        }

        const selected = accountOptions.find((option) => option.value === effectiveAccountFilter);
        return selected?.label || effectiveAccountFilter;
    }, [accountOptions, effectiveAccountFilter, t]);

    const mailboxTargets = useMemo(() => {
        const connectedAccounts = storedAccounts.filter((account) => {
            const email = String(account?.email || '').trim().toLowerCase();
            return email.includes('@') && Boolean(account?.token);
        });

        const activeAccount = AccountManager.getActiveAccount();

        if (!multiAccountEnabled) {
            if (activeAccount?.email && activeAccount.token) {
                return [activeAccount];
            }

            if (connectedAccounts.length > 0) {
                return [connectedAccounts[0]];
            }

            return [];
        }

        const selectedAccount = effectiveAccountFilter
            ? connectedAccounts.find((account) => String(account.email || '').trim().toLowerCase() === effectiveAccountFilter)
            : null;

        if (selectedAccount) {
            return [selectedAccount];
        }

        return connectedAccounts;
    }, [storedAccounts, effectiveAccountFilter, multiAccountEnabled]);

    const mailboxTargetSignature = useMemo(
        () => mailboxTargets.map((account) => String(account.email || '').trim().toLowerCase()).sort().join(','),
        [mailboxTargets]
    );

    const queryContextKey = useMemo(() => {
        return JSON.stringify({
            folder,
            label: labelFilter,
            q: searchFilter,
            from: fromFilter,
            hasAttachment: hasAttachmentFilter,
            since: sinceFilter,
            until: untilFilter,
            account: effectiveAccountFilter,
            mailboxTargetSignature,
        });
    }, [
        folder,
        labelFilter,
        searchFilter,
        fromFilter,
        hasAttachmentFilter,
        sinceFilter,
        untilFilter,
        effectiveAccountFilter,
        mailboxTargetSignature,
    ]);

    // Initialize filters from URL
    useEffect(() => {
        setFilterFrom(searchParams.get('from') || '');
        setFilterHasAttachment(searchParams.get('hasAttachment') === 'true');
        setFilterSince(searchParams.get('since') || '');
        setFilterUntil(searchParams.get('until') || '');
    }, [searchParams]);

    useEffect(() => {
        if (!multiAccountEnabled) {
            setAccountFilter('');
            return;
        }

        const urlAccount = accountFilterFromUrl;
        
        if (urlAccount) {
            const normalized = urlAccount.trim().toLowerCase();
            setAccountFilter(normalized);
            if (typeof window !== 'undefined') {
                window.localStorage.setItem(ACCOUNT_FILTER_STORAGE_KEY, normalized);
            }
            return;
        }

        // Si no hay URL param, cargar del localStorage (persiste al cambiar carpetas)
        if (typeof window !== 'undefined') {
            const storedAccount = window.localStorage.getItem(ACCOUNT_FILTER_STORAGE_KEY) || '';
            setAccountFilter(storedAccount.trim().toLowerCase());
        }
    }, [accountFilterFromUrl, multiAccountEnabled]);

    useEffect(() => {
        if (multiAccountEnabled || !accountFilterFromUrl) {
            return;
        }

        const params = new URLSearchParams(searchParams);
        params.delete('account');
        params.delete('id');
        router.replace(`/?${params.toString()}`);
    }, [multiAccountEnabled, accountFilterFromUrl, router, searchParams]);

    useEffect(() => {
        if (!isAccountMenuOpen) {
            return;
        }

        const handleOutsideClick = (event: MouseEvent) => {
            if (!accountMenuRef.current?.contains(event.target as Node)) {
                setIsAccountMenuOpen(false);
            }
        };

        document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, [isAccountMenuOpen]);

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

    const { addToQueue, isOnline } = useOffline();

    // Refs con el estado "ultimo": los callbacks pasados a las filas memoizadas (comparador
    // personalizado) no se re-crean, asi que no pueden capturar valores viejos.
    const groupedRef = useRef(groupedEmails);
    groupedRef.current = groupedEmails;
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const virtualHandleRef = useRef<VirtualMailRowsHandle | null>(null);
    const virtualizedRef = useRef(false);
    const selectedIdsRef = useRef(selectedIds);
    selectedIdsRef.current = selectedIds;
    const lastSelectedRef = useRef<string | null>(null);
    const searchParamsRef = useRef(searchParams);
    searchParamsRef.current = searchParams;
    const latest = useRef({ folder, isOnline, addToQueue, invalidate, t, intlLocale });
    latest.current = { folder, isOnline, addToQueue, invalidate, t, intlLocale };
    const requestSeq = useRef(0);

    // --- Etiquetado masivo -------------------------------------------------
    const [labelPickerOpen, setLabelPickerOpen] = useState(false);
    const [availableLabels, setAvailableLabels] = useState<LabelRef[]>([]);
    const [labelsLoading, setLabelsLoading] = useState(false);

    const toggleLabelPicker = useCallback(async () => {
        if (labelPickerOpen) {
            setLabelPickerOpen(false);
            return;
        }
        setLabelPickerOpen(true);
        setLabelsLoading(true);
        try {
            const cached = normalizeLabelList(await getData<unknown>(LABELS_CACHE_KEY));
            if (cached.length > 0) setAvailableLabels(cached);
            // Contrato de la API de labels: GET /api/labels -> Label[] (con id).
            const res = await fetch('/api/labels', { cache: 'no-store' });
            if (res.ok) {
                setAvailableLabels(normalizeLabelList(await res.json().catch(() => null)));
            }
        } catch (err) {
            console.error('Failed to load labels', err);
        } finally {
            setLabelsLoading(false);
        }
    }, [getData, labelPickerOpen]);

    const handleApplyLabel = useCallback(async (label: LabelRef) => {
        const ids = Array.from(selectedIdsRef.current);
        if (ids.length === 0) return;
        if (!latest.current.isOnline) {
            toast.error(latest.current.t('emailList.toast.labelOffline'));
            return;
        }

        // toggleLabelId ALTERNA: decidimos por correo para no quitar el label a quien ya lo tiene.
        const { mode, toggleIds } = planLabelToggles(emailsRef.current, ids, label.id);
        if (toggleIds.length === 0) return;

        const snapshot = emailsRef.current.filter((e) => toggleIds.includes(e.id));
        setEmails((prev) => applyLabelChange(prev, toggleIds, label, mode));

        const failed: string[] = [];
        const CHUNK = 5;
        for (let i = 0; i < toggleIds.length; i += CHUNK) {
            const chunk = toggleIds.slice(i, i + CHUNK);
            const results = await Promise.allSettled(
                chunk.map((id) =>
                    fetch(`/api/emails/${id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ toggleLabelId: label.id }),
                    })
                )
            );
            results.forEach((r, idx) => {
                if (r.status !== 'fulfilled' || !r.value.ok) failed.push(chunk[idx]);
            });
        }

        if (failed.length > 0) {
            setEmails((prev) => restoreEmails(prev, snapshot.filter((e) => failed.includes(e.id))));
            toast.error(latest.current.t('emailList.toast.labelPartial', { failed: failed.length, total: toggleIds.length }));
        } else {
            toast.success(latest.current.t(mode === 'add' ? 'emailList.toast.labelApplied' : 'emailList.toast.labelRemoved', { name: label.name }));
        }
        setLabelPickerOpen(false);
        void latest.current.invalidate(EMAIL_LISTS_AND_COUNTS_PATTERN);
    }, []);

    const labelStateFor = useCallback(
        (labelId: string) => labelSelectionState(emails, Array.from(selectedIds), labelId),
        [emails, selectedIds]
    );

    // --- Acciones masivas: optimista + res.ok + reversion -------------------
    const handleBulkAction = useCallback(async (updates: any) => {
        const { folder: currentFolder, isOnline: online, addToQueue: enqueue, invalidate: doInvalidate, t: tr } = latest.current;
        // Support explicit IDs passed in updates (for Swipe actions), otherwise use selectedIds
        const ids: string[] = updates.ids || Array.from(selectedIdsRef.current);
        if (ids.length === 0) return;

        // Cleanup explicit IDs from updates object before sending to API/State
        const { ids: _explicitIds, ...actualUpdates } = updates;

        const permanent = isPermanentDelete(currentFolder, actualUpdates);

        if (currentFolder === 'drafts' && !permanent) {
            toast.info(tr('emailList.toast.notForDrafts'));
            return;
        }

        // Borrado permanente (atajo, boton o swipe): siempre con confirmacion.
        if (permanent && typeof window !== 'undefined') {
            const confirmKey = pluralKey(currentFolder === 'drafts' ? 'emailList.confirmDeleteDrafts' : 'emailList.confirmDeleteEmails', ids.length);
            if (!window.confirm(tr(confirmKey, { n: ids.length }))) {
                return;
            }
        }

        // `label` se muestra en la cola offline: se traduce al idioma activo al encolar.
        const request = currentFolder === 'drafts'
            ? { url: '/api/drafts/batch', method: 'POST', body: { ids, action: 'delete' }, label: tr('emailList.queue.deleteDrafts') }
            : permanent
                ? { url: '/api/emails/batch', method: 'DELETE', body: { ids }, label: tr('emailList.queue.deleteEmails') }
                : {
                    url: '/api/emails/batch',
                    method: 'PATCH',
                    body: { ids, updates: actualUpdates },
                    label: actualUpdates.folder
                        ? tr('emailList.queue.moveTo', { folder: folderLabel(tr, actualUpdates.folder) })
                        : tr('emailList.queue.update'),
                };

        // Optimistic UI (con copia para poder revertir)
        const snapshot = emailsRef.current.filter((e) => ids.includes(e.id));
        setEmails((prev) => applyOptimisticUpdate(prev, ids, actualUpdates));
        setSelectedIds(new Set()); // Clear selection after action

        if (!online) {
            enqueue(request.url, request.method as any, request.body, request.label);
            return;
        }

        try {
            const res = await fetch(request.url, {
                method: request.method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request.body),
            });
            if (classifyBulkResponse(res.status) === 'revert') {
                // 4xx/5xx: el servidor NO aplico el cambio -> se revierte lo optimista.
                setEmails((prev) => restoreEmails(prev, snapshot));
                toast.error(
                    res.status >= 500
                        ? tr('emailList.toast.serverFailed')
                        : tr('emailList.toast.actionFailed')
                );
                return;
            }
        } catch (err) {
            // Error de red: se conserva el cambio optimista y se reintenta desde la cola offline.
            console.error(err);
            enqueue(request.url, request.method as any, request.body, tr('emailList.queue.retry', { label: request.label }));
            toast.warning(tr('emailList.toast.retryLater'));
            return;
        }

        // Invalida TODAS las listas (`emails:<sig>:<ctx>`) y los contadores con un solo aviso.
        await doInvalidate(EMAIL_LISTS_AND_COUNTS_PATTERN);
    }, []);

    // Stable Swipe Handler (aplica a todo el hilo)
    const handleSwipe = useCallback(async (id: string, updates: any) => {
        const group = groupedRef.current.find(g => g.id === id);
        const ids = group ? group.allEmails.map(e => e.id) : [id];
        await handleBulkAction({ ids, ...updates });
    }, [handleBulkAction]);

    const toggleSelection = useCallback((e: { stopPropagation?: () => void; shiftKey?: boolean }, id: string) => {
        e.stopPropagation?.();
        const groups = groupedRef.current;
        const last = lastSelectedRef.current;
        const range = Boolean(e.shiftKey && last);
        if (!range) lastSelectedRef.current = id;

        // Updater puro (sin efectos secundarios: StrictMode lo ejecuta dos veces)
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (range) {
                const currentIndex = groups.findIndex(g => g.id === id);
                const lastIndex = groups.findIndex(g => g.id === last);
                if (currentIndex === -1 || lastIndex === -1) return next;
                const start = Math.min(currentIndex, lastIndex);
                const end = Math.max(currentIndex, lastIndex);
                for (let i = start; i <= end; i++) {
                    groups[i].allEmails.forEach(email => next.add(email.id));
                }
            } else {
                const group = groups.find(g => g.id === id);
                const idsToToggle = group ? group.allEmails.map(x => x.id) : [id];
                const allSelected = idsToToggle.every(i => next.has(i));
                idsToToggle.forEach(i => (allSelected ? next.delete(i) : next.add(i)));
            }
            return next;
        });
    }, []);

    const allSelected = filteredEmails.length > 0 && filteredEmails.every(e => selectedIds.has(e.id));

    const handleSelectAll = () => {
        if (allSelected) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredEmails.map(e => e.id)));
        }
    };

    const handleSelect = useCallback((id: string) => {
        if (latest.current.folder === 'drafts') {
            // For drafts, open in Compose
            const draft = emailsRef.current.find(e => e.id === id);
            if (draft) {
                openCompose({
                    id: draft.id,
                    draftId: draft.id,
                    from: draft.draftFrom || undefined,
                    to: draft.to || '',
                    cc: draft.cc || '',
                    bcc: draft.bcc || '',
                    subject: draft.subject === LEGACY_NO_SUBJECT ? '' : draft.subject,
                    body: draft.originalBody || '',
                    minimized: false,
                    attachments: draft.attachments || []
                });
                return;
            }
        }

        const params = new URLSearchParams(searchParamsRef.current.toString());
        params.set('id', id);
        router.push(`/?${params.toString()}`);
    }, [openCompose, router]);

    const closeOpenedEmail = useCallback(() => {
        const params = new URLSearchParams(searchParamsRef.current.toString());
        if (!params.has('id')) return false;
        params.delete('id');
        router.push(`/?${params.toString()}`);
        return true;
    }, [router]);

    const focusRow = useCallback((id: string, index?: number) => {
        if (typeof document === 'undefined') return;
        // Lista virtualizada: la fila puede no estar montada; primero se desplaza hasta ella
        // (la fila con foco queda anclada en la ventana) y se reintenta unos frames hasta que exista.
        if (virtualizedRef.current && index !== undefined && index >= 0) {
            virtualHandleRef.current?.scrollToIndex(index);
        }
        let attempts = virtualizedRef.current ? 8 : 1;
        const tryFocus = () => {
            const el = document.getElementById(`email-row-${id}`);
            if (el) {
                el.scrollIntoView({ block: 'nearest' });
                el.focus({ preventScroll: true });
                return;
            }
            if (--attempts > 0) requestAnimationFrame(tryFocus);
        };
        requestAnimationFrame(tryFocus);
    }, []);

    const moveFocus = useCallback((delta: 1 | -1) => {
        const groups = groupedRef.current;
        if (groups.length === 0) return;
        const currentIndex = focusedIdRef.current ? groups.findIndex(g => g.id === focusedIdRef.current) : -1;
        const nextIndex = nextFocusIndex(currentIndex, groups.length, delta);
        if (nextIndex < 0) return;
        const nextId = groups[nextIndex].id;
        setFocusedId(nextId);
        focusRow(nextId, nextIndex);
    }, [focusRow]);

    const replyToFocused = useCallback(async () => {
        const targetId = focusedIdRef.current || searchParamsRef.current.get('id');
        if (!targetId || latest.current.folder === 'drafts') return;
        try {
            const res = await fetch(`/api/emails/${targetId}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (!data?.email) throw new Error('empty');
            const { t: tr, intlLocale: loc } = latest.current;
            const reply = buildQuickReply(
                data.email,
                data.content || '',
                formatMobileDate(data.email.createdAt, loc),
                (date, from) => tr('emailList.quoteHeader', { date, from }),
            );
            openCompose({ id: crypto.randomUUID(), ...reply, minimized: false });
        } catch (err) {
            console.error('Quick reply failed', err);
            toast.error(latest.current.t('emailList.toast.replyFailed'));
        }
    }, [openCompose]);

    // Keyboard Shortcuts (listener global estable: los handlers se leen desde una ref)
    const deleteFocusedOrSelected = () => {
        if (selectedIdsRef.current.size > 0) void handleBulkAction({ folder: 'trash' });
        else if (focusedIdRef.current) void handleSwipe(focusedIdRef.current, { folder: 'trash' });
    };

    useKeyboardShortcuts({
        'c': () => openCompose(),
        '/': (e) => {
            e.preventDefault();
            searchInputRef.current?.focus();
        },
        'j': () => moveFocus(1),
        'k': () => moveFocus(-1),
        'enter': () => { if (focusedIdRef.current) handleSelect(focusedIdRef.current); },
        'o': () => { if (focusedIdRef.current) handleSelect(focusedIdRef.current); },
        'r': () => { void replyToFocused(); },
        'escape': () => {
            if (labelPickerOpen) { setLabelPickerOpen(false); return; }
            if (selectedIdsRef.current.size > 0) { setSelectedIds(new Set()); return; }
            if (closeOpenedEmail()) return;
            setFocusedId(null);
        },
        'x': () => {
            if (focusedIdRef.current) toggleSelection({}, focusedIdRef.current);
        },
        'e': () => {
            // Archive
            if (selectedIdsRef.current.size > 0) void handleBulkAction({ folder: 'archive' });
            else if (focusedIdRef.current) void handleSwipe(focusedIdRef.current, { folder: 'archive' });
        },
        // Borrar: en trash/borradores pide confirmacion (ver handleBulkAction).
        // '#' exige Shift+3 (en teclados ES-LATAM se genera distinto): Delete/Backspace son la via portable.
        '#': deleteFocusedOrSelected,
        'delete': deleteFocusedOrSelected,
        'backspace': deleteFocusedOrSelected,
    });

    // Main Sync Logic
    // `preserve`: refresco sobre la misma vista -> no descartar las paginas ya cargadas.
    const syncEmails = async (mode: 'refresh' | 'loadMore' = 'refresh', preserve = false) => {
        if (mode === 'loadMore' && (loading || loadingMore)) return;
        if (mode === 'loadMore' && !hasMore) return;
        if (mode === 'refresh' && loadingMore) return;
        const cacheKey = emailsCacheKey(mailboxTargetSignature, queryContextKey);
        const reqId = ++requestSeq.current;
        const isStale = () => reqId !== requestSeq.current;

        const requestParams = new URLSearchParams();
        requestParams.set('folder', folder);
        if (labelFilter) requestParams.set('label', labelFilter);
        if (searchFilter) requestParams.set('q', searchFilter);
        if (fromFilter) requestParams.set('from', fromFilter);
        if (hasAttachmentFilter) requestParams.set('hasAttachment', 'true');
        if (sinceFilter) requestParams.set('since', sinceFilter);
        if (untilFilter) requestParams.set('until', untilFilter);

        const buildEmailUrl = (page: number) => {
            const params = new URLSearchParams(requestParams);
            params.set('page', String(page));
            return `/api/emails?${params.toString()}`;
        };

        const targetAccounts = mailboxTargets;
        const canUseTokenRequests = targetAccounts.length > 0;

        try {
            if (mode === 'refresh') {
                if (emailsRef.current.length === 0) setLoading(true);
            } else {
                setLoadingMore(true);
            }

            // 1. Initial Load / Refresh
            if (mode === 'refresh') {
                // Try Cache first if we haven't loaded yet
                if (emailsRef.current.length === 0 && folder !== 'drafts') {
                    const cached = await getData<Email[]>(cacheKey);
                    if (cached && Array.isArray(cached) && cached.length > 0 && !isStale()) {
                        setEmails(cached);
                        emailsRef.current = cached;
                        setLoading(false); // Show cache immediately
                    }
                }
            }

            if (folder === 'drafts' || !canUseTokenRequests) {
                if (folder === 'drafts') {
                    if (mode === 'loadMore') return; // No pagination for drafts yet
                    const res = await fetch('/api/drafts');
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const data = await res.json();
                    if (isStale()) return;
                    if (data.drafts) {
                        const mapped = data.drafts.map((d: any) => ({
                            id: d.id,
                            // Sin texto en ingles dentro de los datos: la fila traduce "Para: x" / "(sin destinatarios)".
                            from: '',
                            draftFrom: d.from,
                            cleanTo: d.to,
                            subject: d.subject || '',
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
                    setLoadError(false);
                    setLoading(false);
                    return;
                }

                const url = buildEmailUrl(mode === 'loadMore' ? nextPage : 1);
                const data = await fetchDeduped(url);
                if (isStale()) return;

                if (data.emails) {
                    if (mode === 'refresh') {
                        const fresh = Array.isArray(data.emails) ? data.emails : [];
                        const currentPage = Number(data.page || 1);
                        const totalPages = Number(data.pages || 1);
                        const serverHasMore = currentPage < totalPages;

                        const { emails: merged, preservedTail } = preserve
                            ? mergeFirstPage(emailsRef.current, fresh, serverHasMore)
                            : { emails: fresh, preservedTail: false };
                        setEmails(merged);
                        setData(cacheKey, merged, { silent: true });

                        // Con cola conservada el estado de paginacion sigue siendo valido.
                        if (!preservedTail) {
                            setHasMore(serverHasMore);
                            setNextPage(Math.max(currentPage + 1, 2));
                        }
                    } else {
                        const incoming = Array.isArray(data.emails) ? data.emails : [];
                        if (incoming.length > 0) {
                            const merged = mergeEmailLists(emailsRef.current, incoming);
                            setEmails(merged);
                            setData(cacheKey, merged, { silent: true });

                            const currentPage = Number(data.page || nextPage);
                            const totalPages = Number(data.pages || currentPage);
                            setHasMore(currentPage < totalPages);
                            setNextPage(currentPage + 1);
                        } else {
                            setHasMore(false);
                        }
                    }
                    setLoadError(false);
                }
                return;
            }

            const fetchPlan = targetAccounts.map((account) => {
                const paging = mailboxPaging[account.email] || { nextPage: 1, hasMore: true };
                // En refresco con cola conservada solo se pide la primera pagina de cada cuenta.
                const page = mode === 'refresh' ? 1 : paging.nextPage;
                return { account, page, hasMore: paging.hasMore };
            }).filter((plan) => mode === 'refresh' || plan.hasMore);

            if (fetchPlan.length === 0) {
                setHasMore(false);
                return;
            }

            const settled = await Promise.allSettled(fetchPlan.map(async ({ account, page }) => {
                const url = buildEmailUrl(page);
                const data = await fetchDeduped(url, {
                    headers: {
                        Authorization: `Bearer ${account.token}`,
                    },
                });

                return {
                    accountEmail: account.email,
                    page,
                    data,
                };
            }));
            if (isStale()) return;

            const responses = settled
                .filter((result): result is PromiseFulfilledResult<{ accountEmail: string; page: number; data: any }> => result.status === 'fulfilled')
                .map((result) => result.value);

            const nextPaging: Record<string, { nextPage: number; hasMore: boolean }> = {};
            const collectedEmails: Email[] = [];
            let anyHasMoreAfterFirst = false;

            responses.forEach(({ accountEmail, data }) => {
                const incoming = Array.isArray(data?.emails) ? data.emails : [];
                collectedEmails.push(...incoming);

                const currentPage = Number(data?.page || 1);
                const totalPages = Number(data?.pages || 1);
                if (currentPage < totalPages) anyHasMoreAfterFirst = true;
                nextPaging[accountEmail] = {
                    nextPage: Math.max(currentPage + 1, 2),
                    hasMore: currentPage < totalPages,
                };
            });

            if (responses.length === 0 && mode === 'refresh' && emailsRef.current.length === 0) {
                setLoadError(true);
            }

            if (responses.length > 0) {
                let merged: Email[];
                let preservedTail = false;
                if (mode === 'refresh') {
                    const freshMerged = mergeEmailLists(collectedEmails);
                    if (preserve) {
                        const res = mergeFirstPage(emailsRef.current, freshMerged, anyHasMoreAfterFirst);
                        merged = res.emails;
                        preservedTail = res.preservedTail;
                    } else {
                        merged = freshMerged;
                    }
                } else {
                    merged = mergeEmailLists(emailsRef.current, collectedEmails);
                }

                setEmails(merged);
                setData(cacheKey, merged, { silent: true });
                setLoadError(false);

                if (!preservedTail) {
                    setMailboxPaging((previous) => ({ ...previous, ...nextPaging }));
                    setHasMore(Object.values(nextPaging).some((entry) => entry.hasMore));
                    if (mode === 'refresh') {
                        setNextPage(2);
                    }
                }
            } else if (mode === 'loadMore') {
                setHasMore(false);
            }
        } catch (e) {
            console.error(e);
            // Sin correos cargados: mostrar error con reintento (no "bandeja vacia").
            if (mode === 'refresh' && emailsRef.current.length === 0) setLoadError(true);
        } finally {
            if (!isStale()) {
                setLoading(false);
                setLoadingMore(false);
            }
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
    const prevContextKey = useRef(queryContextKey);

    // Initial Sync on Mount/Folder Change/Label Change/Realtime invalidation
    useEffect(() => {
        const hasNavigated = folder !== prevFolder.current || queryContextKey !== prevContextKey.current;

        if (hasNavigated) {
            setEmails([]); // Reset only on navigation
            emailsRef.current = [];
            setHasMore(true);
            setNextPage(2);
            setMailboxPaging({});
            setLoadError(false);
            setSelectedIds(new Set());
            prevFolder.current = folder;
            prevContextKey.current = queryContextKey;
        }

        // Sin navegacion (invalidacion/realtime): refrescar sin perder paginas cargadas.
        syncEmails('refresh', !hasNavigated);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [folder, queryContextKey, listVersion]);

    // Abrir un correo lo marca como leido en la lista al instante (sin recargar ni reiniciar paginas).
    useEffect(() => {
        if (!selectedId || folder === 'drafts') return;
        setEmails(prev => (prev.some(e => e.id === selectedId && !e.read)
            ? prev.map(e => (e.id === selectedId ? { ...e, read: true } : e))
            : prev));
    }, [selectedId, folder]);

    // Scroll Handler for Infinite Scroll
    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
        if (scrollHeight - scrollTop <= clientHeight + 100) { // 100px threshold
            if (!loadingMore && hasMore && !loading) {
                syncEmails('loadMore');
            }
        }
    };

    const updateAccountFilter = useCallback((value: string) => {
        const normalized = value.trim().toLowerCase();
        setAccountFilter(normalized);
        setIsAccountMenuOpen(false);

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

    // --- Virtualizacion (solo listas largas; las cortas se renderizan completas, igual que siempre) ---
    const useVirtual = shouldVirtualize(groupedEmails.length);
    virtualizedRef.current = useVirtual;
    const virtualIds = useMemo(() => (useVirtual ? groupedEmails.map((g) => g.id) : []), [useVirtual, groupedEmails]);
    const focusedIndex = useMemo(
        () => (useVirtual && focusedId ? groupedEmails.findIndex((g) => g.id === focusedId) : -1),
        [useVirtual, focusedId, groupedEmails]
    );

    const renderRow = (index: number, virtual: boolean) => {
        const group = groupedEmails[index];
        if (!group) return null;
        const email = group.latestEmail;
        // Labels reales (union de todo el hilo), sin badges de demostracion
        const labels = unionLabels(group.allEmails);
        const isSelected = group.allEmails.every(e => selectedIds.has(e.id));

        return (
            <SwipeableEmailItem
                key={email.id}
                email={email}
                index={index}
                virtual={virtual}
                ariaPos={virtual ? listItemAria(index, groupedEmails.length, hasMore) : undefined}
                isSelected={isSelected}
                isFocused={focusedId === email.id}
                onFocusRow={setFocusedId}
                onSelect={handleSelect}
                onSelectToggle={toggleSelection}
                onPrefetch={prefetchEmail}
                onSwipeAction={handleSwipe}
                labels={labels}
                labelsKey={labels.map(l => `${l.id}:${l.name}:${l.color || ''}`).join('|')}
                folder={folder}
                threadCount={group.count}
            />
        );
    };

    return (
        <div className="flex h-full flex-col bg-background/50">
            {/* Desktop Header */}
            <div className="hidden md:flex items-center justify-between px-4 py-3 bg-background/95 backdrop-blur-sm sticky top-0 z-10  min-h-[60px]">
                {selectedIds.size > 0 ? (
                    <div className="flex items-center gap-2 w-full animate-in fade-in slide-in-from-top-2 duration-200">
                        <div className="flex items-center gap-2 mr-2">
                            <input
                                type="checkbox"
                                aria-label={t('emailList.selectAll')}
                                className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
                                checked={allSelected}
                                onChange={handleSelectAll}
                            />
                            <span className="text-sm font-medium" aria-live="polite">{t('emailList.selectedCount', { n: selectedIds.size })}</span>
                        </div>
                        <div className="flex items-center gap-1 ml-auto">
                            <button type="button" onClick={() => handleBulkAction({ starred: true })} className="p-2 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground" title={t('emailList.bulk.star')} aria-label={t('emailList.bulk.starSelected')}>
                                <Star className="h-4 w-4" />
                            </button>
                            <LabelBulkButton
                                open={labelPickerOpen}
                                loading={labelsLoading}
                                labels={availableLabels}
                                stateFor={labelStateFor}
                                onToggle={toggleLabelPicker}
                                onPick={handleApplyLabel}
                                onClose={() => setLabelPickerOpen(false)}
                                buttonClassName="p-2 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground"
                                iconClassName="h-4 w-4"
                            />
                            <button type="button" onClick={() => handleBulkAction({ read: true })} className="p-2 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground" title={t('emailList.bulk.markRead')} aria-label={t('emailList.bulk.markReadSelected')}>
                                <MailOpen className="h-4 w-4" />
                            </button>
                            <button type="button" onClick={() => handleBulkAction({ folder: 'archive' })} className="p-2 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground" title={t('emailList.bulk.archive')} aria-label={t('emailList.bulk.archiveSelected')}>
                                <Archive className="h-4 w-4" />
                            </button>
                            <button type="button" onClick={() => handleBulkAction({ folder: 'trash' })} className="p-2 hover:bg-destructive/10 hover:text-destructive rounded-md text-muted-foreground" title={t('emailList.bulk.trash')} aria-label={t('emailList.bulk.trashSelected')}>
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        <h1 className="text-xl font-bold capitalize tracking-tight">{folderLabel(t, folder)}</h1>
                        <div className="inline-flex h-8 items-center justify-center rounded-lg bg-muted/50 p-1">
                            <button
                                type="button"
                                aria-pressed={activeTab === 'all'}
                                onClick={() => setActiveTab('all')}
                                className={cn(
                                    "inline-flex h-full items-center justify-center rounded-md px-3 text-xs font-medium transition-all",
                                    activeTab === 'all'
                                        ? "bg-background text-foreground shadow-sm"
                                        : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                {t('emailList.tabs.all')}
                            </button>
                            <button
                                type="button"
                                aria-pressed={activeTab === 'unread'}
                                onClick={() => setActiveTab('unread')}
                                className={cn(
                                    "inline-flex h-full items-center justify-center rounded-md px-3 text-xs font-medium transition-all",
                                    activeTab === 'unread'
                                        ? "bg-background text-foreground shadow-sm"
                                        : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                {t('emailList.tabs.unread')}
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
                        ref={searchInputRef}
                        aria-label={t('emailList.search.label')}
                        placeholder={t('emailList.search.placeholder')}
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
                        type="button"
                        aria-label={t('emailList.search.advancedToggle')}
                        aria-expanded={showFilters}
                        onClick={() => setShowFilters(!showFilters)}
                        className={cn("absolute right-2 top-1.5 p-1.5 rounded-md hover:bg-background/80 transition-colors", (filterFrom || filterHasAttachment || filterSince || filterUntil) && "text-primary")}
                    >
                        <SlidersHorizontal className="h-4 w-4" />
                    </button>

                    {/* Search Filters Popover */}
                    {showFilters && (
                        <div className="absolute top-11 right-0 w-72 bg-popover/95 backdrop-blur-md border shadow-lg rounded-xl p-4 z-50 flex flex-col gap-3">
                            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('emailList.search.advancedTitle')}</h3>

                            <div className="space-y-1">
                                <label className="text-xs font-medium">{t('emailList.search.from')}</label>
                                <input
                                    className="w-full h-8 rounded-md border bg-background px-2 text-sm"
                                    placeholder={t('emailList.search.fromPlaceholder')}
                                    value={filterFrom}
                                    onChange={(e) => setFilterFrom(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                    <label className="text-xs font-medium">{t('emailList.search.dateStart')}</label>
                                    <input
                                        type="date"
                                        className="w-full h-8 rounded-md border bg-background px-2 text-sm"
                                        value={filterSince}
                                        onChange={(e) => setFilterSince(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-medium">{t('emailList.search.dateEnd')}</label>
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
                                    className="h-4 w-4 rounded border-input"
                                    checked={filterHasAttachment}
                                    onChange={(e) => setFilterHasAttachment(e.target.checked)}
                                />
                                <label htmlFor="hasAttachment" className="text-sm">{t('emailList.search.hasAttachment')}</label>
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
                                    {t('emailList.search.clear')}
                                </button>
                                <button
                                    onClick={applyFilters}
                                    className="px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-md shadow-sm hover:bg-primary/90"
                                >
                                    {t('common.search')}
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {folder !== 'drafts' && multiAccountEnabled && storedAccounts.length > 0 && (
                    <div className="mt-2 flex items-center gap-2">
                        <label className="text-xs font-medium text-muted-foreground shrink-0">{t('emailList.account')}</label>
                        <div ref={accountMenuRef} className="relative min-w-[220px] max-w-full">
                            <button
                                type="button"
                                aria-haspopup="listbox"
                                aria-expanded={isAccountMenuOpen}
                                onClick={() => setIsAccountMenuOpen((previous) => !previous)}
                                className="group h-9 w-full rounded-xl border border-border bg-gradient-to-b from-background to-muted/40 pl-3 pr-9 text-left text-sm shadow-sm transition-all hover:border-primary/40 hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                            >
                                <span className="line-clamp-1 pr-1 text-foreground">{selectedAccountLabel}</span>
                                <ChevronDown className={cn(
                                    'pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-transform',
                                    isAccountMenuOpen && 'rotate-180 text-foreground'
                                )} />
                            </button>

                            {isAccountMenuOpen && (
                                <div className="absolute top-11 z-50 w-full overflow-hidden rounded-xl border border-border/70 bg-popover/95 shadow-xl backdrop-blur">
                                    <div className="max-h-64 overflow-y-auto p-1">
                                        <button
                                            type="button"
                                            role="option"
                                            aria-selected={!effectiveAccountFilter}
                                            onClick={() => updateAccountFilter('')}
                                            className={cn(
                                                'flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm transition-colors',
                                                !effectiveAccountFilter
                                                    ? 'bg-primary text-primary-foreground'
                                                    : 'text-foreground hover:bg-muted'
                                            )}
                                        >
                                            <span>{t('emailList.allAccounts')}</span>
                                            {!effectiveAccountFilter && <Check className="h-4 w-4" />}
                                        </button>

                                        {accountOptions.map((option) => {
                                            const isSelected = effectiveAccountFilter === option.value;
                                            return (
                                                <button
                                                    key={option.value}
                                                    type="button"
                                                    role="option"
                                                    aria-selected={isSelected}
                                                    onClick={() => updateAccountFilter(option.value)}
                                                    className={cn(
                                                        'mt-1 flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm transition-colors',
                                                        isSelected
                                                            ? 'bg-primary text-primary-foreground'
                                                            : 'text-foreground hover:bg-muted'
                                                    )}
                                                >
                                                    <span className="line-clamp-1 text-left">{option.label}</span>
                                                    {isSelected && <Check className="h-4 w-4 shrink-0" />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-2" onScroll={handleScroll}>
                {loading ? (
                    <div className="flex items-center justify-center h-40" role="status" aria-label={t('common.loading')}>
                        <Loader2 className="animate-spin h-6 w-6 text-primary/40" />
                    </div>
                ) : loadError && emails.length === 0 ? (
                    <div role="alert" className="flex flex-col items-center justify-center h-64 text-center p-4 gap-3">
                        <p className="text-sm font-medium text-foreground">{t('emailList.loadError.title')}</p>
                        <p className="text-xs text-muted-foreground">{t('emailList.loadError.help')}</p>
                        <button
                            type="button"
                            onClick={() => { setLoadError(false); setLoading(true); syncEmails('refresh'); }}
                            className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                        >
                            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> {t('emailList.loadError.retry')}
                        </button>
                    </div>
                ) : filteredEmails.length === 0 ? (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ type: "spring", stiffness: 300, damping: 20 }}
                        className="flex flex-col items-center justify-center h-64 text-center p-4"
                    >
                        <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                            <Search className="h-6 w-6 text-muted-foreground/50" aria-hidden="true" />
                        </div>
                        <p className="text-sm font-medium text-foreground">{t('emailList.empty.title')}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                            {searchParams.get('label')
                                ? t('emailList.empty.withLabel', { label: searchParams.get('label') || '', folder: folderLabel(t, folder).toLowerCase() })
                                : t('emailList.empty.folder', { folder: folderLabel(t, folder).toLowerCase() })}
                        </p>
                    </motion.div>
                ) : useVirtual ? (
                    <div className="pb-20 md:pb-4">
                        <VirtualMailRows
                            scrollRef={scrollRef}
                            ids={virtualIds}
                            renderRow={(index) => renderRow(index, true)}
                            pinnedIndex={focusedIndex}
                            hasMore={hasMore}
                            onNearEnd={() => { if (!loadingMore && !loading) void syncEmails('loadMore'); }}
                            handleRef={virtualHandleRef}
                            label={t('emailList.listLabel', { folder: folderLabel(t, folder) })}
                        />
                        {loadingMore && (
                            <div className="py-4 flex justify-center text-muted-foreground" role="status" aria-label={t('common.loading')}>
                                <Loader2 className="h-5 w-5 animate-spin" />
                            </div>
                        )}
                    </div>
                ) : (
                    <div role="list" aria-label={t('emailList.listLabel', { folder: folderLabel(t, folder) })} className="flex flex-col gap-1.5 pb-20 md:pb-4">
                        <AnimatePresence>
                            {groupedEmails.map((group, index) => renderRow(index, false))}
                        </AnimatePresence>
                        {loadingMore && (
                            <div className="py-4 flex justify-center text-muted-foreground" role="status" aria-label={t('common.loading')}>
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
                            <button type="button" onClick={() => setSelectedIds(new Set())} className="text-muted-foreground text-sm">{t('common.cancel')}</button>
                        </div>
                        <div className="flex items-center gap-1">
                            <button type="button" onClick={() => handleBulkAction({ starred: true })} className="p-2 hover:bg-muted rounded-full" title={t('emailList.bulk.star')} aria-label={t('emailList.bulk.starSelected')}>
                                <Star className="h-5 w-5" />
                            </button>
                            <LabelBulkButton
                                open={labelPickerOpen}
                                loading={labelsLoading}
                                labels={availableLabels}
                                stateFor={labelStateFor}
                                onToggle={toggleLabelPicker}
                                onPick={handleApplyLabel}
                                onClose={() => setLabelPickerOpen(false)}
                                buttonClassName="p-2 hover:bg-muted rounded-full"
                                iconClassName="h-5 w-5"
                            />
                            <button type="button" onClick={() => handleBulkAction({ read: true })} className="p-2 hover:bg-muted rounded-full" title={t('emailList.bulk.markRead')} aria-label={t('emailList.bulk.markReadSelected')}>
                                <MailOpen className="h-5 w-5" />
                            </button>
                            <button type="button" onClick={() => handleBulkAction({ folder: 'archive' })} className="p-2 hover:bg-muted rounded-full" title={t('emailList.bulk.archive')} aria-label={t('emailList.bulk.archiveSelected')}>
                                <Archive className="h-5 w-5" />
                            </button>
                            <button type="button" onClick={() => handleBulkAction({ folder: 'trash' })} className="p-2 hover:bg-destructive/10 text-destructive rounded-full" title={t('emailList.bulk.trash')} aria-label={t('emailList.bulk.trashSelected')}>
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
                        type="button"
                        onClick={() => openCompose()}
                        className="h-14 px-5 rounded-2xl bg-secondary text-secondary-foreground shadow-lg hover:shadow-xl transition-all active:scale-95 flex items-center gap-2 border border-border/10"
                    >
                        <Plus className="h-6 w-6" />
                        <span className="font-medium text-base">{t('emailList.compose')}</span>
                    </button>
                </div>
            )}
        </div>
    );
}

// Extracted Swipeable Component
const SwipeableEmailItem = memo(function SwipeableEmailItem({
    email, index, virtual = false, ariaPos, isSelected, isFocused, onFocusRow, onSelect, onSelectToggle, onPrefetch, onSwipeAction, labels, folder, threadCount
}: any) {
    // useI18n (contexto) re-renderiza la fila al cambiar de idioma aunque `memo` bloquee las props.
    const { t, intlLocale } = useI18n();
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

    // Remitente/destinatario mostrado: en enviados y borradores es el destinatario.
    const legacySubject = email.subject === LEGACY_NO_SUBJECT;
    const subjectText = !email.subject || legacySubject ? t('emailList.noSubject') : email.subject;
    const senderText = folder === 'drafts'
        ? (email.to ? t('emailList.toPrefix', { to: email.to }) : t('emailList.noRecipients'))
        : folder === 'sent' && email.to
            ? t('emailList.toPrefix', { to: email.to })
            : email.from;
    const ariaLabel = [
        email.read ? '' : `${t('emailList.unread')}. `,
        `${senderText}. ${subjectText}`,
        threadCount > 1 ? `. ${t('emailList.threadMessages', { n: threadCount })}` : '',
    ].join('');

    return (
        <div
            role="listitem"
            {...(ariaPos || {})}
            className="relative overflow-hidden rounded-xl"
        >
            {/* Background Layers */}
            <div
                className="absolute inset-0 bg-success flex items-center justify-start pl-6 transition-colors"
                style={{ opacity: archiveOpacity }}
            >
                <Archive className="text-success-foreground h-6 w-6" />
            </div>
            <div
                className="absolute inset-0 bg-destructive flex items-center justify-end pr-6 transition-colors"
                style={{ opacity: trashOpacity }}            >
                <Trash2 className="text-destructive-foreground h-6 w-6" />
            </div>

            <motion.div
                id={`email-row-${email.id}`}
                tabIndex={0}
                aria-label={ariaLabel}
                aria-selected={isSelected}
                onFocus={(e: React.FocusEvent) => { if (e.target === e.currentTarget) onFocusRow?.(email.id); }}
                // En la lista virtualizada las filas viven en posiciones absolutas: `layout` (proyeccion) animaria
                // saltos falsos al medir/reposicionar, asi que se sustituye por un fundido de opacidad.
                {...(virtual ? {} : { layout: true })}
                drag="x"
                dragConstraints={{ left: 0, right: 0 }} // Snap back
                dragElastic={0.2} // Resistance
                onDrag={(e, info) => setDragX(info.offset.x)}
                onDragEnd={(e, info) => {
                    handleDragEnd(e, info);
                    setDragX(0); // Reset visual immediately, optimistic UI handles removal
                }}
                initial={virtual ? { opacity: 0 } : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0, x: 0 }} // Ensure x resets
                exit={virtual ? { opacity: 0 } : { opacity: 0, height: 0, marginBottom: 0, overflow: 'hidden' }}
                // Sin retardo escalonado por indice en la lista virtual (con miles de filas seria eterno).
                transition={virtual ? { duration: 0.12 } : { duration: 0.2, delay: index * 0.03 }}
                className={cn(
                    "group relative flex items-start gap-3 p-3 text-left text-sm transition-colors border border-transparent select-none cursor-pointer bg-background z-10",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    isFocused && "ring-2 ring-ring ring-inset z-20", // Focused State
                    isSelected
                        ? "bg-primary/5 hover:bg-primary/10 border-primary/20"
                        : "hover:bg-muted/50 hover:shadow-sm border-border/60",
                    !email.read && !isSelected && "border-l-4 border-l-blue-500 shadow-sm"
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
                {/* Checkbox: siempre visible en tactil (hover:none) y con foco de teclado; en desktop al pasar el raton */}
                <button
                    type="button"
                    role="checkbox"
                    aria-checked={isSelected}
                    aria-label={isSelected ? t('emailList.row.deselect') : t('emailList.row.select')}
                    className={cn(
                        "pt-1 shrink-0 transition-opacity focus-visible:opacity-100 focus-visible:outline-none",
                        isSelected
                            ? "opacity-100"
                            : "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
                    )}
                    onClick={(e) => onSelectToggle(e, email.id)}
                >
                    <div className={cn(
                        "h-5 w-5 rounded border flex items-center justify-center transition-colors",
                        isSelected ? "bg-primary border-primary" : "border-input bg-background hover:border-input"
                    )}>
                        {isSelected && <svg className="h-3.5 w-3.5 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                    </div>
                </button>

                <button
                    type="button"
                    aria-pressed={Boolean(email.starred)}
                    aria-label={email.starred ? t('emailList.row.unstar') : t('emailList.row.star')}
                    className="pt-1 shrink-0 z-20 cursor-pointer"
                    onClick={(e) => {
                        e.stopPropagation();
                        onSwipeAction(email.id, { starred: !email.starred });
                    }}
                >
                    <Star className={cn("h-5 w-5 transition-colors", email.starred ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/60 hover:text-yellow-400")} />
                </button>

                <div className="flex-1 min-w-0">
                    <div className="flex w-full items-start sm:items-center justify-between gap-2">
                        <div className={cn(
                            "font-semibold truncate",
                            "text-foreground",
                            !email.read && "text-primary"
                        )}>
                            {senderText}
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
                            {formatMailDate(email.createdAt, intlLocale)}
                        </div>
                    </div>

                    <div className="sm:hidden text-[10px] text-muted-foreground mt-0.5 truncate">
                        {formatMobileDate(email.createdAt, intlLocale)}
                    </div>

                    <div className={cn(
                        "font-medium text-xs leading-none mt-0.5",
                        "text-foreground/90",
                        !email.read && "font-bold"
                    )}>
                        {subjectText}
                    </div>

                    <div className={cn(
                        "line-clamp-2 text-xs w-full mt-1",
                        "text-muted-foreground"
                    )}>
                        {email.snippet}
                    </div>

                    {labels.length > 0 && (
                        <ul className="flex flex-wrap items-center gap-1.5 mt-2" aria-label={t('emailList.row.labels')}>
                            {labels.map((label: LabelRef) => (
                                <li
                                    key={label.id}
                                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium border border-border/60 bg-muted text-muted-foreground"
                                >
                                    <span
                                        aria-hidden="true"
                                        className="h-1.5 w-1.5 rounded-full"
                                        style={{ backgroundColor: label.color || undefined }}
                                    />
                                    {label.name}
                                </li>
                            ))}
                        </ul>
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
        prevProps.email.cleanTo !== nextProps.email.cleanTo ||
        prevProps.email.to !== nextProps.email.to ||
        prevProps.email.from !== nextProps.email.from ||
        prevProps.email.subject !== nextProps.email.subject ||
        prevProps.email.snippet !== nextProps.email.snippet ||
        prevProps.email.createdAt !== nextProps.email.createdAt ||
        prevProps.labelsKey !== nextProps.labelsKey ||
        prevProps.folder !== nextProps.folder;

    const selectionChanged = prevProps.isSelected !== nextProps.isSelected;

    const focusChanged = prevProps.isFocused !== nextProps.isFocused;

    const threadChanged = prevProps.threadCount !== nextProps.threadCount;

    // Posicion/tamano del conjunto (aria-posinset/setsize) y modo virtual.
    const positionChanged =
        prevProps.virtual !== nextProps.virtual ||
        prevProps.ariaPos?.['aria-posinset'] !== nextProps.ariaPos?.['aria-posinset'] ||
        prevProps.ariaPos?.['aria-setsize'] !== nextProps.ariaPos?.['aria-setsize'];

    return !emailChanged && !selectionChanged && !focusChanged && !threadChanged && !positionChanged;
});

// Boton + popover del etiquetado masivo. El estado 'some' se muestra como mixto.
function LabelBulkButton({
    open, loading, labels, stateFor, onToggle, onPick, onClose, buttonClassName, iconClassName,
}: {
    open: boolean;
    loading: boolean;
    labels: LabelRef[];
    stateFor: (labelId: string) => 'all' | 'some' | 'none';
    onToggle: () => void;
    onPick: (label: LabelRef) => void;
    onClose: () => void;
    buttonClassName: string;
    iconClassName: string;
}) {
    const { t } = useI18n();
    return (
        <div className="relative">
            <button
                type="button"
                onClick={onToggle}
                className={buttonClassName}
                title={t('emailList.bulk.label')}
                aria-label={t('emailList.bulk.labelSelected')}
                aria-haspopup="menu"
                aria-expanded={open}
            >
                <Tag className={iconClassName} />
            </button>
            {open && (
                <>
                    <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
                    <div
                        role="menu"
                        aria-label={t('emailList.row.labels')}
                        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
                        className="absolute right-0 top-full mt-1 z-50 w-56 max-h-64 overflow-y-auto rounded-xl border bg-popover p-1 shadow-lg"
                    >
                        {loading && labels.length === 0 && (
                            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> {t('common.loading')}
                            </div>
                        )}
                        {!loading && labels.length === 0 && (
                            <div className="px-3 py-2 text-xs text-muted-foreground">
                                {t('emailList.bulk.noLabels')}
                            </div>
                        )}
                        {labels.map((label) => {
                            const state = stateFor(label.id);
                            return (
                                <button
                                    key={label.id}
                                    type="button"
                                    role="menuitemcheckbox"
                                    aria-checked={state === 'all' ? true : state === 'some' ? 'mixed' : false}
                                    onClick={() => onPick(label)}
                                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted"
                                >
                                    <span
                                        aria-hidden="true"
                                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                                        style={{ backgroundColor: label.color || undefined }}
                                    />
                                    <span className="flex-1 truncate">{label.name}</span>
                                    {state === 'all' && <Check className="h-3.5 w-3.5 text-primary" />}
                                    {state === 'some' && <span className="text-xs text-muted-foreground">–</span>}
                                </button>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
}
