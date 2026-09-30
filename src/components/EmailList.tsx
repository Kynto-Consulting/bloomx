'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { Keyboard, Loader2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/I18nProvider';
import { useSession } from '@/components/SessionProvider';
import { VirtualMailRows, type VirtualMailRowsHandle } from '@/components/VirtualMailRows';
import { listItemAria, shouldVirtualize } from '@/lib/virtual-list';
import { useCompose } from '@/contexts/ComposeContext';
import { useCache } from '@/contexts/CacheContext';
import { useOffline } from '@/contexts/OfflineContext';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { fetchDeduped } from '@/lib/fetchdedupe';
import { AccountManager, type StoredAccount } from '@/lib/account-manager';
import { buildShortcutMap } from '@/lib/shortcuts';
import { MAIL_DND_TYPE, buildDragPayload, dragState } from '@/lib/mail-dnd';
import {
    type ListEmail,
    type LabelRef,
    SETTINGS_CACHE_KEY,
    shouldListRefresh,
    shouldListReloadSettings,
    emailsCacheKey,
    groupEmailsByThread,
    appendServerPage,
    mergeMailboxPages,
    planRequestGroups,
    type RequestGroup,
    type ListSort,
    labelSelectionState,
    unionLabels,
    buildQuickReply,
    nextFocusIndex,
} from '@/lib/mail-list';
import {
    type QuickFilter,
    attachmentSummary,
    filterGroups,
    flattenRows,
    flattenSections,
    focusAfterRemoval,
    headerIndexes,
    orderGroupsLike,
    ownAddressSet,
    quickFilterCounts,
    reduceListEvent,
    sectionsByDate,
    selectionSummary,
    sortGroups,
    threadParticipants,
} from '@/lib/mail-list-view';
import {
    type MailActionId,
    archiveShortcutAction,
    deleteShortcutAction,
    folderOfEmail,
    resolveSwipeAction,
    snoozeShortcutAction,
    spamShortcutAction,
} from '@/lib/mail-actions';
import { filterToApi, normalizeFilterCounts, sumFilterCounts, type FolderFilterCounts } from '@/lib/mail-query';
import { estimateRowHeight, densityClasses } from '@/lib/mail-prefs';
import { mailBus, mailNav } from '@/components/mail/mail-bus';
import { MailRow, type RowMenuKind } from '@/components/mail/MailRow';
import { BulkBar, SelectionBanner, type BulkMenuKind } from '@/components/mail/BulkBar';
import { MoveMenu } from '@/components/mail/MoveMenu';
import { SnoozeMenu } from '@/components/mail/SnoozeMenu';
import { QuickFilters } from '@/components/mail/QuickFilters';
import { ViewMenu } from '@/components/mail/ViewMenu';
import { SyncStatus } from '@/components/mail/SyncStatus';
import { EmptyState, type EmptyKind } from '@/components/mail/EmptyState';
import { ListSkeleton } from '@/components/mail/ListSkeleton';
import { ShortcutsOverlay } from '@/components/mail/ShortcutsOverlay';
import { ListSearch } from '@/components/mail/ListSearch';
import { IconButton } from '@/components/mail/ui';
import { useMailActions } from '@/components/mail/useMailActions';
import { useLabels } from '@/components/mail/useLabels';
import { useMailPrefs } from '@/components/mail/useMailPrefs';
import { usePullToRefresh } from '@/components/mail/usePullToRefresh';
import { DATE_BUCKET_KEYS } from '@/components/mail/date-buckets';

const ACCOUNT_FILTER_STORAGE_KEY = 'bloomx:mailbox:account-filter:v1';

// Los campos extra (to, cc, attachments, ...) viven en el index signature de ListEmail.
type Email = ListEmail;

/** Fecha + hora corta con el idioma de la interfaz (cita de respuesta rapida). */
function formatMobileDate(date: string, locale: string) {
    if (!date) return '';
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) return '';
    return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(parsed);
}

/** Nombre de carpeta traducido (inbox -> Bandeja de entrada); carpetas desconocidas se muestran tal cual. */
function folderLabel(t: (key: string) => string, folder: string) {
    const key = `sidebar.folders.${folder}`;
    const label = t(key);
    return label === key ? folder : label;
}

const LEGACY_NO_SUBJECT = '(No Subject)';

/** Tactil o pantalla estrecha: ahi se activan los gestos de swipe (en escritorio hay acciones al pasar el raton). */
function useSwipeEnabled() {
    const [enabled, setEnabled] = useState(false);
    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return;
        const mq = window.matchMedia('(pointer: coarse), (max-width: 767px)');
        const update = () => setEnabled(mq.matches);
        update();
        mq.addEventListener?.('change', update);
        return () => mq.removeEventListener?.('change', update);
    }, []);
    return enabled;
}

type OpenMenu = { kind: 'move' | 'label' | 'snooze' | 'reschedule'; ids: string[]; clearSelection: boolean; /** Mover aplicado a "toda la carpeta" (en el servidor). */ scope?: boolean } | null;

/** Correos por pagina del servidor (espejo de MAIL_PAGE_SIZE) y profundidad maxima de un refresco que conserva lo cargado. */
const PAGE_SIZE = 20;
const MAX_REFRESH_DEPTH = 5;

/** Clave del estado de paginacion de una peticion (sesion por cookie, cuenta con token propio o la union de buzones del servidor). */
const pageKey = (group: RequestGroup) => group.key;
const authInit = (group: RequestGroup): RequestInit | undefined => (group.token ? { headers: { Authorization: `Bearer ${group.token}` } } : undefined);

export function EmailList() {
    const { t, intlLocale } = useI18n();
    const searchParams = useSearchParams();
    const folder = searchParams.get('folder') || 'inbox';
    const selectedId = searchParams.get('id');
    const router = useRouter();
    const { openCompose } = useCompose();
    const { getData, setData, subscribe, invalidate } = useCache();
    const { data: session } = useSession();
    const { isOnline } = useOffline();
    const openDraft = useCallback((d: { id: string; from?: string; to?: string; cc?: string; bcc?: string; subject?: string; body?: string; attachments?: unknown[] }) => {
        openCompose({ id: d.id, draftId: d.id, from: d.from, to: d.to || '', cc: d.cc || '', bcc: d.bcc || '', subject: d.subject || '', body: d.body || '', minimized: false, attachments: (d.attachments as any[]) || [] });
    }, [openCompose]);
    const actions = useMailActions({ openDraft });
    const actionsRef = useRef(actions);
    actionsRef.current = actions;
    const { labels: availableLabels, loading: labelsLoading, ensure: ensureLabels } = useLabels();
    const [prefs, updatePrefs] = useMailPrefs();
    const swipeEnabled = useSwipeEnabled();

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

    const rootRef = useRef<HTMLDivElement | null>(null);
    const [emails, setEmails] = useState<Email[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const emailsRef = useRef<Email[]>([]);
    emailsRef.current = emails;
    const [storedAccounts, setStoredAccounts] = useState<StoredAccount[]>([]);
    const [multiAccountEnabled, setMultiAccountEnabled] = useState(false);
    const [lastSync, setLastSync] = useState<number | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [totalCount, setTotalCount] = useState<number | null>(null);
    // Conteos por filtro (hilos) devueltos por la propia lista: valen tambien en busquedas y etiquetas.
    const [listFilters, setListFilters] = useState<FolderFilterCounts | null>(null);
    // Buzones que la sesion puede leer (GET /api/mailboxes): las cuentas conectadas que esten ahi se piden como UNION en el servidor.
    const [accessibleIds, setAccessibleIds] = useState<Set<string> | null>(null);

    // Selection State
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [wholeFolder, setWholeFolder] = useState(false);
    const wholeFolderRef = useRef(false);
    wholeFolderRef.current = wholeFolder;
    const [focusedId, setFocusedId] = useState<string | null>(null); // For keyboard navigation
    const focusedIdRef = useRef<string | null>(null);
    focusedIdRef.current = focusedId;
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const [helpOpen, setHelpOpen] = useState(false);
    const [menu, setMenu] = useState<OpenMenu>(null);
    const menuAnchorRef = useRef<HTMLElement | null>(null);

    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    // Cursor de la siguiente pagina de cada buzon: el servidor pagina por cursor estable (orden y filtro incluidos).
    const pagingRef = useRef<Record<string, { cursor: string | null; hasMore: boolean }>>({});
    // Conteos EXACTOS por filtro rapido de la carpeta actual (GET /api/counts?folder=); null = aun no se conocen.
    const [folderCounts, setFolderCounts] = useState<FolderFilterCounts | null>(null);

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
            setMultiAccountEnabled(Boolean(settings?.['core-mailbox']?.unifiedRepliesEnabled));
        };
        const loadMailboxSetting = async () => {
            try {
                const cached = await getData<any>(SETTINGS_CACHE_KEY);
                if (cached) applyMailboxSetting(cached);
                const response = await fetch('/api/settings', { cache: 'no-store' });
                const data = await response.json().catch(() => null);
                applyMailboxSetting(data?.expansionSettings || {});
            } catch {
                if (!cancelled) setMultiAccountEnabled(false);
            }
        };
        loadMailboxSetting();
        return () => { cancelled = true; };
    }, [getData]);

    useEffect(() => {
        let cancelled = false;
        const syncMailboxSettingFromCache = async () => {
            try {
                const cached = await getData<any>(SETTINGS_CACHE_KEY);
                if (!cancelled && cached) setMultiAccountEnabled(Boolean(cached?.['core-mailbox']?.unifiedRepliesEnabled));
            } catch {
                // Ignore cache read errors.
            }
        };
        syncMailboxSettingFromCache();
        return () => { cancelled = true; };
    }, [settingsVersion, getData]);

    const [accountFilter, setAccountFilter] = useState('');
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
                if (!email.includes('@') || seen.has(email)) return false;
                seen.add(email);
                return true;
            })
            .map((email) => ({ value: email, label: email }));
    }, [storedAccounts]);

    const selectedAccountLabel = useMemo(() => {
        if (!effectiveAccountFilter) return t('emailList.allAccounts');
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
            if (activeAccount?.email && activeAccount.token) return [activeAccount];
            if (connectedAccounts.length > 0) return [connectedAccounts[0]];
            return [];
        }
        const selectedAccount = effectiveAccountFilter
            ? connectedAccounts.find((account) => String(account.email || '').trim().toLowerCase() === effectiveAccountFilter)
            : null;
        if (selectedAccount) return [selectedAccount];
        return connectedAccounts;
    }, [storedAccounts, effectiveAccountFilter, multiAccountEnabled]);

    useEffect(() => {
        if (!multiAccountEnabled || storedAccounts.length < 2) { setAccessibleIds(null); return; }
        let cancelled = false;
        void fetch('/api/mailboxes', { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (cancelled) return;
                const list: Array<{ id?: unknown }> = Array.isArray(data?.mailboxes) ? data.mailboxes : [];
                setAccessibleIds(list.length > 0 ? new Set(list.map((m) => String(m.id))) : null);
            })
            .catch(() => { if (!cancelled) setAccessibleIds(null); });
        return () => { cancelled = true; };
    }, [multiAccountEnabled, storedAccounts]);

    const requestGroups = useMemo(() => planRequestGroups(mailboxTargets, accessibleIds), [mailboxTargets, accessibleIds]);
    const requestGroupsRef = useRef(requestGroups);
    requestGroupsRef.current = requestGroups;

    const mailboxTargetSignature = useMemo(
        () => requestGroups.map((g) => g.key).sort().join(','),
        [requestGroups]
    );

    // Clave de NAVEGACION (carpeta, etiqueta, busqueda, cuenta): al cambiarla se descarta la lista y el filtro vuelve a "Todos".
    const navKey = useMemo(() => JSON.stringify({
        folder,
        label: labelFilter,
        q: searchFilter,
        from: fromFilter,
        hasAttachment: hasAttachmentFilter,
        since: sinceFilter,
        until: untilFilter,
        account: effectiveAccountFilter,
        mailboxTargetSignature,
    }), [folder, labelFilter, searchFilter, fromFilter, hasAttachmentFilter, sinceFilter, untilFilter, effectiveAccountFilter, mailboxTargetSignature]);
    const [filterState, setFilterState] = useState<{ nav: string; value: QuickFilter }>({ nav: '', value: 'all' });
    const quickFilter: QuickFilter = filterState.nav === navKey ? filterState.value : 'all';
    const setQuickFilter = useCallback((value: QuickFilter) => setFilterState({ nav: navKey, value }), [navKey]);
    // Orden y filtro rapido se resuelven en el SERVIDOR (los borradores, que se cargan enteros, los resuelve el cliente).
    const serverList = folder !== 'drafts';
    const serverSort: ListSort = serverList ? prefs.sort : 'newest';
    const serverFilter: QuickFilter = serverList ? quickFilter : 'all';
    const queryContextKey = useMemo(() => JSON.stringify({ nav: navKey, sort: serverSort, filter: serverFilter }), [navKey, serverSort, serverFilter]);
    /** Vista de UNA carpeta sin busqueda ni etiquetas: solo ahi existen los conteos por filtro y "toda la carpeta". */
    const plainView = !labelFilter && !searchFilter && !fromFilter && !hasAttachmentFilter && !sinceFilter && !untilFilter;

    useEffect(() => {
        if (!multiAccountEnabled) {
            setAccountFilter('');
            return;
        }
        if (accountFilterFromUrl) {
            setAccountFilter(accountFilterFromUrl);
            try { window.localStorage.setItem(ACCOUNT_FILTER_STORAGE_KEY, accountFilterFromUrl); } catch { /* sin almacenamiento */ }
            return;
        }
        // Sin parametro en la URL: se carga del localStorage (persiste al cambiar de carpeta).
        try {
            setAccountFilter((window.localStorage.getItem(ACCOUNT_FILTER_STORAGE_KEY) || '').trim().toLowerCase());
        } catch { /* sin almacenamiento */ }
    }, [accountFilterFromUrl, multiAccountEnabled]);

    useEffect(() => {
        if (multiAccountEnabled || !accountFilterFromUrl) return;
        const params = new URLSearchParams(searchParams);
        params.delete('account');
        params.delete('id');
        router.replace(`/?${params.toString()}`);
    }, [multiAccountEnabled, accountFilterFromUrl, router, searchParams]);

    const updateAccountFilter = useCallback((value: string) => {
        const normalized = value.trim().toLowerCase();
        setAccountFilter(normalized);
        try {
            if (normalized) window.localStorage.setItem(ACCOUNT_FILTER_STORAGE_KEY, normalized);
            else window.localStorage.removeItem(ACCOUNT_FILTER_STORAGE_KEY);
        } catch { /* sin almacenamiento */ }
        const params = new URLSearchParams(searchParams);
        if (normalized) params.set('account', normalized); else params.delete('account');
        params.delete('id');
        router.push(`/?${params.toString()}`);
    }, [router, searchParams]);

    // --- Vista: hilos, filtros rapidos, orden y encabezados por fecha (logica pura en lib/mail-list-view) ---------
    const ownAddresses = useMemo(
        () => ownAddressSet([session?.user?.email, AccountManager.getActiveAccount()?.email, ...storedAccounts.map((a) => a.email)]),
        [session?.user?.email, storedAccounts],
    );
    const allGroups = useMemo(() => groupEmailsByThread(emails), [emails]);
    // Carpetas del servidor: orden y filtro ya vienen aplicados (se respeta el orden recibido). Borradores: en el cliente.
    const groupedEmails = useMemo(
        () => (serverList ? orderGroupsLike(allGroups, emails) : sortGroups(filterGroups(allGroups, quickFilter, ownAddresses), prefs.sort)),
        [serverList, allGroups, emails, quickFilter, ownAddresses, prefs.sort],
    );
    // Conteos de los chips: EXACTOS (sin "+"). En busquedas/etiquetas solo se conoce el total del filtro activo (la consulta lo devuelve).
    const filterCounts = useMemo<Partial<Record<QuickFilter, number | null>>>(() => {
        if (!serverList) return quickFilterCounts(allGroups, ownAddresses);
        const known = folderCounts ?? listFilters;
        if (known) return { all: known.all, unread: known.unread, starred: known.starred, attachments: known.attachments, fromMe: known.from_me };
        return totalCount !== null && !loading ? { [quickFilter]: totalCount } : {};
    }, [serverList, allGroups, ownAddresses, folderCounts, listFilters, totalCount, loading, quickFilter]);
    const filteredEmails = useMemo(() => groupedEmails.flatMap((g) => g.allEmails), [groupedEmails]);
    const showHeaders = prefs.groupByDate && prefs.sort !== 'sender';
    const flatItems = useMemo(
        () => (showHeaders ? flattenSections(sectionsByDate(groupedEmails, Date.now())) : flattenRows(groupedEmails)),
        [groupedEmails, showHeaders],
    );

    // Refs con el estado "ultimo": los callbacks pasados a las filas memoizadas no pueden capturar valores viejos.
    const groupedRef = useRef(groupedEmails);
    groupedRef.current = groupedEmails;
    const flatRef = useRef(flatItems);
    flatRef.current = flatItems;
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const virtualHandleRef = useRef<VirtualMailRowsHandle | null>(null);
    const virtualizedRef = useRef(false);
    const selectedIdsRef = useRef(selectedIds);
    selectedIdsRef.current = selectedIds;
    const lastSelectedRef = useRef<string | null>(null);
    const searchParamsRef = useRef(searchParams);
    searchParamsRef.current = searchParams;
    const selectedIdRef = useRef(selectedId);
    selectedIdRef.current = selectedId;
    const latest = useRef({ folder, t, intlLocale, hasMore });
    latest.current = { folder, t, intlLocale, hasMore };
    const requestSeq = useRef(0);
    const viewRef = useRef({ folder, restrict: !labelFilter && !searchFilter });
    viewRef.current = { folder, restrict: !labelFilter && !searchFilter };

    // Orden visible de los hilos: lo usa el lector para "anterior/siguiente".
    useEffect(() => { mailNav.set(groupedEmails.map((g) => g.id)); }, [groupedEmails]);

    // --- Foco -------------------------------------------------------------------------------------------------
    const focusRow = useCallback((id: string) => {
        if (typeof document === 'undefined') return;
        // Lista virtualizada: la fila puede no estar montada; primero se desplaza hasta ella
        // (la fila con foco queda anclada en la ventana) y se reintenta unos frames hasta que exista.
        if (virtualizedRef.current) {
            const index = flatRef.current.findIndex((it) => it.id === id);
            if (index >= 0) virtualHandleRef.current?.scrollToIndex(index);
        }
        let attempts = virtualizedRef.current ? 8 : 3;
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

    // --- Seleccion -------------------------------------------------------------------------------------------
    const clearSelection = useCallback(() => {
        setSelectedIds(new Set());
        setWholeFolder(false);
    }, []);

    const toggleSelection = useCallback((e: { stopPropagation?: () => void; shiftKey?: boolean }, id: string) => {
        e.stopPropagation?.();
        const groups = groupedRef.current;
        const last = lastSelectedRef.current;
        const range = Boolean(e.shiftKey && last);
        if (!range) lastSelectedRef.current = id;
        setWholeFolder(false);

        // Updater puro (sin efectos secundarios: StrictMode lo ejecuta dos veces)
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (range) {
                const currentIndex = groups.findIndex(g => g.id === id);
                const lastIndex = groups.findIndex(g => g.id === last);
                if (currentIndex === -1 || lastIndex === -1) return next;
                const start = Math.min(currentIndex, lastIndex);
                const end = Math.max(currentIndex, lastIndex);
                for (let i = start; i <= end; i++) groups[i].allEmails.forEach(email => next.add(email.id));
            } else {
                const group = groups.find(g => g.id === id);
                const idsToToggle = group ? group.allEmails.map(x => x.id) : [id];
                const allSelected = idsToToggle.every(i => next.has(i));
                idsToToggle.forEach(i => (allSelected ? next.delete(i) : next.add(i)));
            }
            return next;
        });
    }, []);

    const loadedIds = useMemo(() => filteredEmails.map((e) => e.id), [filteredEmails]);
    const selection = useMemo(
        () => selectionSummary(selectedIds, loadedIds, totalCount, hasMore),
        [selectedIds, loadedIds, totalCount, hasMore],
    );
    const allSelected = selection.allLoadedSelected;

    const handleSelectAll = () => {
        setWholeFolder(false);
        if (allSelected) setSelectedIds(new Set());
        else setSelectedIds(new Set(loadedIds));
    };

    // --- URL de la lista ---------------------------------------------------------------------------------------
    const buildEmailUrl = (cursor: string | null, group: RequestGroup) => {
        const params = new URLSearchParams();
        if (group.mailboxes) params.set('mailboxes', group.mailboxes.join(','));
        // Las paginas siguientes no necesitan recontar (los conteos llegan con la primera pagina).
        if (cursor) params.set('counts', '0');
        params.set('folder', folder);
        if (labelFilter) params.set('label', labelFilter);
        if (searchFilter) params.set('q', searchFilter);
        if (fromFilter) params.set('from', fromFilter);
        if (hasAttachmentFilter) params.set('hasAttachment', 'true');
        if (sinceFilter) params.set('since', sinceFilter);
        if (untilFilter) params.set('until', untilFilter);
        // Orden y filtro rapido en el servidor + paginacion por cursor estable.
        params.set('sort', serverSort);
        if (serverFilter !== 'all') params.set('filter', filterToApi(serverFilter));
        if (cursor) params.set('cursor', cursor);
        return `/api/emails?${params.toString()}`;
    };

    // Seleccionar TODA la carpeta: no carga paginas ni ids. Marca lo cargado y la accion se resuelve en el servidor por alcance
    // (carpeta + filtro activo, hasta el tope por operacion) con el conteo real.
    const selectWholeFolder = () => {
        if (folder === 'drafts') return;
        setSelectedIds(new Set(loadedIds));
        setWholeFolder(true);
    };

    // --- Abrir correos ---------------------------------------------------------------------------------------
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

    // --- Acciones ---------------------------------------------------------------------------------------------
    /** Ejecuta una accion sobre correos concretos (la unica puerta de entrada: filas, barra masiva, teclado y gestos). */
    const runAction = useCallback(async (action: MailActionId, targets: Email[]) => {
        if (targets.length === 0) return;
        const view = latest.current.folder;
        const a = actionsRef.current;
        switch (action) {
            case 'archive': case 'unarchive': case 'trash': case 'restore': case 'spam': case 'notSpam':
                await a.moveEmails(targets, action, view);
                break;
            case 'deleteForever': case 'deleteDraft':
                await a.deleteForever(targets, view);
                break;
            case 'markRead': await a.setFlags(targets.filter((e) => !e.read), { read: true }); break;
            case 'markUnread': await a.setFlags(targets.filter((e) => e.read), { read: false }); break;
            case 'star': await a.setFlags(targets.filter((e) => !e.starred), { starred: true }); break;
            case 'unstar': await a.setFlags(targets.filter((e) => e.starred), { starred: false }); break;
            case 'cancelSchedule': await a.cancelSchedule(targets); break;
            case 'sendNow': await a.sendNow(targets); break;
            case 'editScheduled': await a.cancelSchedule(targets.slice(0, 1), { open: true }); break;
            case 'deleteScheduled': await a.deleteScheduled(targets); break;
            default: break;
        }
    }, []);

    const openMenu = useCallback((kind: 'move' | 'label' | 'snooze' | 'reschedule', ids: string[], anchor: HTMLElement | null, clearSel: boolean, scope = false) => {
        menuAnchorRef.current = anchor;
        if (kind === 'move' || kind === 'label') void ensureLabels();
        setMenu({ kind, ids, clearSelection: clearSel, scope });
    }, [ensureLabels]);

    const groupEmails = useCallback((id: string): Email[] => {
        const group = groupedRef.current.find((g) => g.id === id || g.allEmails.some((e) => e.id === id));
        return group ? group.allEmails : emailsRef.current.filter((e) => e.id === id);
    }, []);

    // Arrastrar una fila (o toda la seleccion si la fila esta marcada) a una carpeta / etiqueta del Sidebar
    const handleRowDragStart = useCallback((id: string, e: React.DragEvent) => {
        const sel = selectedIdsRef.current;
        const group = groupedRef.current.find((g) => g.id === id);
        const rowEmails = group ? group.allEmails : [];
        const useSelection = sel.size > 0 && rowEmails.length > 0 && rowEmails.every((x) => sel.has(x.id));
        const dragged = useSelection ? emailsRef.current.filter((x) => sel.has(x.id)) : rowEmails;
        if (dragged.length === 0) { e.preventDefault(); return; }
        const payload = buildDragPayload(dragged, latest.current.folder);
        e.dataTransfer.setData(MAIL_DND_TYPE, JSON.stringify(payload));
        e.dataTransfer.setData('text/plain', String(payload.emails.length));
        e.dataTransfer.effectAllowed = 'move';
        dragState.start(payload);
    }, []);
    const handleRowDragEnd = useCallback(() => dragState.end(), []);

    // Fila: accion directa / menu
    const handleRowAction = useCallback((action: MailActionId, id: string) => {
        void runAction(action, groupEmails(id));
    }, [runAction, groupEmails]);

    const handleRowMenu = useCallback((kind: RowMenuKind, id: string, anchor: HTMLElement) => {
        openMenu(kind, groupEmails(id).map((e) => e.id), anchor, false);
    }, [openMenu, groupEmails]);

    // Barra masiva. "Toda la carpeta": la accion la aplica el servidor por alcance (carpeta + filtro) con confirmacion y resultado.
    const scopeInfo = () => ({ folder, filter: filterToApi(serverFilter) });
    const scopeGroups = () => requestGroupsRef.current.map((g) => ({ token: g.token, mailboxes: g.mailboxes }));
    const runBulk = async (action: MailActionId) => {
        const ids = selectedIdsRef.current;
        const targets = emailsRef.current.filter((e) => ids.has(e.id));
        if (targets.length === 0) return;
        if (wholeFolderRef.current && plainView) {
            clearSelection();
            await actionsRef.current.applyToScope(action, scopeInfo(), targets, totalCount ?? targets.length, { groups: scopeGroups() });
            return;
        }
        clearSelection();
        await runAction(action, targets);
    };
    /** Acciones de teclado/gestos: con "toda la carpeta" seleccionada van por alcance; si no, sobre los correos indicados. */
    const dispatchAction = (action: MailActionId, targets: Email[]) => {
        if (wholeFolderRef.current && selectedIdsRef.current.size > 0) void runBulk(action);
        else void runAction(action, targets);
    };

    const handleBulkMenu = (kind: BulkMenuKind, anchor: HTMLElement) => {
        openMenu(kind, Array.from(selectedIdsRef.current), anchor, kind !== 'label', wholeFolder && plainView && kind === 'move');
    };

    // Menu abierto (mover / etiquetar / posponer) sobre los correos indicados
    const menuEmails = useMemo(
        () => (menu ? emails.filter((e) => menu.ids.includes(e.id)) : []),
        [menu, emails],
    );
    const closeMenu = useCallback(() => setMenu(null), []);
    const labelStateFor = useCallback(
        (labelId: string) => labelSelectionState(emails, menu?.ids ?? [], labelId),
        [emails, menu],
    );
    const menuFolder = menuEmails.length > 0 && menuEmails.every((e) => folderOfEmail(e, folder) === folderOfEmail(menuEmails[0], folder))
        ? folderOfEmail(menuEmails[0], folder)
        : folder;

    // --- Teclado ----------------------------------------------------------------------------------------------
    /** Solo la instancia visible atiende atajos (la lista se monta tambien oculta en el otro layout). */
    const isVisibleInstance = () => Boolean(rootRef.current && rootRef.current.offsetParent !== null);
    const guard = (fn: () => void) => () => { if (isVisibleInstance()) fn(); };

    const moveFocus = useCallback((delta: 1 | -1) => {
        const groups = groupedRef.current;
        if (groups.length === 0) return;
        const currentIndex = focusedIdRef.current ? groups.findIndex(g => g.id === focusedIdRef.current) : -1;
        const nextIndex = nextFocusIndex(currentIndex, groups.length, delta);
        if (nextIndex < 0) return;
        const nextId = groups[nextIndex].id;
        setFocusedId(nextId);
        focusRow(nextId);
        // Con un correo abierto, j/k lo cambian (como en Gmail).
        if (selectedIdRef.current && folder !== 'drafts') handleSelect(nextId);
    }, [focusRow, handleSelect, folder]);

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

    /** Correos sobre los que actua un atajo: la seleccion; si no, la fila con foco; si no, el correo abierto. */
    const shortcutTarget = (): { targets: Email[]; anchor: HTMLElement | null; gid: string | null } => {
        const sel = selectedIdsRef.current;
        if (sel.size > 0) {
            const targets = emailsRef.current.filter((e) => sel.has(e.id));
            return { targets, anchor: scrollRef.current, gid: null };
        }
        const gid = focusedIdRef.current || selectedIdRef.current;
        if (!gid) return { targets: [], anchor: null, gid: null };
        return { targets: groupEmails(gid), anchor: document.getElementById(`email-row-${gid}`) ?? scrollRef.current, gid };
    };

    const shortcutAction = (pick: (f: string) => MailActionId | null) => () => {
        const { targets, gid } = shortcutTarget();
        if (targets.length === 0) return;
        const effectiveFolder = folderOfEmail(targets[0], folder);
        const action = pick(effectiveFolder);
        if (!action) return;
        if (selectedIdsRef.current.size === 0 && gid) setFocusedId(gid);
        if (selectedIdsRef.current.size > 0 && !wholeFolderRef.current) clearSelection();
        dispatchAction(action, targets);
    };

    const manualRefresh = useCallback(async () => {
        setRefreshing(true);
        try { await syncRef.current('refresh', true); } finally { setRefreshing(false); }
    }, []);

    const shortcutHandlers = {
        compose: guard(() => openCompose()),
        search: guard(() => searchInputRef.current?.focus()),
        next: guard(() => moveFocus(1)),
        prev: guard(() => moveFocus(-1)),
        open: guard(() => { if (focusedIdRef.current) handleSelect(focusedIdRef.current); }),
        select: guard(() => { if (focusedIdRef.current) toggleSelection({}, focusedIdRef.current); }),
        refresh: guard(() => { void manualRefresh(); }),
        reply: guard(() => { void replyToFocused(); }),
        archive: guard(shortcutAction(archiveShortcutAction)),
        delete: guard(shortcutAction(deleteShortcutAction)),
        spam: guard(shortcutAction(spamShortcutAction)),
        undo: guard(() => { void actionsRef.current.undo(); }),
        move: guard(() => {
            const { targets, anchor } = shortcutTarget();
            if (targets.length > 0) openMenu('move', targets.map((e) => e.id), anchor, false);
        }),
        label: guard(() => {
            const { targets, anchor } = shortcutTarget();
            if (targets.length > 0) openMenu('label', targets.map((e) => e.id), anchor, false);
        }),
        snooze: guard(() => {
            const { targets, anchor } = shortcutTarget();
            if (targets.length === 0) return;
            // Posponer; en programados el mismo atajo reprograma.
            const kind = snoozeShortcutAction(folderOfEmail(targets[0], folder));
            if (kind === 'snooze' || kind === 'reschedule') openMenu(kind, targets.map((e) => e.id), anchor, false);
        }),
        star: guard(() => {
            const { targets } = shortcutTarget();
            if (targets.length === 0) return;
            dispatchAction(targets.every((e) => e.starred) ? 'unstar' : 'star', targets);
        }),
        toggleRead: guard(() => {
            const { targets } = shortcutTarget();
            if (targets.length === 0) return;
            dispatchAction(targets.every((e) => e.read) ? 'markUnread' : 'markRead', targets);
        }),
        help: guard(() => setHelpOpen(true)),
        escape: guard(() => {
            if (menu) { setMenu(null); return; }
            if (selectedIdsRef.current.size > 0) { clearSelection(); return; }
            if (closeOpenedEmail()) return;
            setFocusedId(null);
        }),
    };
    useKeyboardShortcuts(buildShortcutMap(shortcutHandlers));

    // --- Sincronizacion ---------------------------------------------------------------------------------------
    // `preserve`: refresco sobre la misma vista -> se pide de nuevo la MISMA profundidad (hasta MAX_REFRESH_DEPTH paginas) en el
    // orden del servidor; asi nada de lo ya cargado por scroll se pierde ni se reordena.
    const syncEmails = async (mode: 'refresh' | 'loadMore' = 'refresh', preserve = false) => {
        if (mode === 'loadMore' && (loading || loadingMore)) return;
        if (mode === 'loadMore' && !hasMore) return;
        if (mode === 'refresh' && loadingMore) return;
        const cacheKey = emailsCacheKey(mailboxTargetSignature, queryContextKey);
        const reqId = ++requestSeq.current;
        const isStale = () => reqId !== requestSeq.current;
        const targets: RequestGroup[] = requestGroupsRef.current;

        try {
            if (mode === 'refresh') {
                if (emailsRef.current.length === 0) setLoading(true);
            } else {
                setLoadingMore(true);
            }

            // 1. Cache primero (solo en la carga inicial)
            if (mode === 'refresh' && emailsRef.current.length === 0 && folder !== 'drafts') {
                const cached = await getData<Email[]>(cacheKey);
                if (cached && Array.isArray(cached) && cached.length > 0 && !isStale()) {
                    setEmails(cached);
                    emailsRef.current = cached;
                    setLoading(false); // Show cache immediately
                }
            }

            // 2. Borradores: se cargan enteros (orden y filtros en el cliente)
            if (folder === 'drafts') {
                if (mode === 'loadMore') return; // No pagination for drafts yet
                const res = await fetch('/api/drafts');
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                if (isStale()) return;
                if (data.drafts) {
                    const mapped = data.drafts.map((d: any) => ({
                        id: d.id,
                        folder: 'drafts',
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
                    setTotalCount(mapped.length);
                    setLastSync(Date.now());
                }
                setLoadError(false);
                setLoading(false);
                return;
            }

            // 3. Carpetas del servidor: una peticion por buzon (la sesion por cookie cuenta como uno), paginadas por cursor
            const depth = mode === 'refresh' && preserve
                ? Math.min(MAX_REFRESH_DEPTH, Math.max(1, Math.ceil(emailsRef.current.length / PAGE_SIZE)))
                : 1;
            const plan = targets
                .map((account) => ({ account, key: pageKey(account), paging: pagingRef.current[pageKey(account)] ?? { cursor: null, hasMore: true } }))
                .filter((p) => mode === 'refresh' || p.paging.hasMore);
            if (plan.length === 0) {
                setHasMore(false);
                return;
            }

            const settled = await Promise.allSettled(plan.map(async ({ account, key, paging }) => {
                const init = authInit(account);
                let cursor: string | null = mode === 'refresh' ? null : paging.cursor;
                const collected: Email[] = [];
                let total: number | null = null;
                let filters: FolderFilterCounts | null = null;
                let more = false;
                let nextCursor: string | null = null;
                for (let i = 0; i < depth; i++) {
                    const data = await fetchDeduped(buildEmailUrl(cursor, account), init);
                    collected.push(...(Array.isArray(data?.emails) ? data.emails : []));
                    if (typeof data?.totalThreads === 'number') total = data.totalThreads;
                    else if (typeof data?.total === 'number') total = data.total;
                    if (data?.filters && typeof data.filters === 'object') filters = normalizeFilterCounts(data.filters);
                    nextCursor = typeof data?.nextCursor === 'string' ? data.nextCursor : null;
                    more = Boolean(data?.hasMore) && Boolean(nextCursor);
                    if (!more) break;
                    cursor = nextCursor;
                }
                return { key, collected, total, filters, more, nextCursor };
            }));
            if (isStale()) return;

            const responses = settled
                .filter((r): r is PromiseFulfilledResult<{ key: string; collected: Email[]; total: number | null; filters: FolderFilterCounts | null; more: boolean; nextCursor: string | null }> => r.status === 'fulfilled')
                .map((r) => r.value);

            if (responses.length === 0) {
                if (mode === 'refresh' && emailsRef.current.length === 0) setLoadError(true);
                else if (mode === 'loadMore') setHasMore(false);
                return;
            }

            const single = targets.length === 1;
            const pages = responses.map((r) => r.collected);
            const merged: Email[] = mode === 'refresh'
                ? (single ? appendServerPage<Email>([], pages[0]) : mergeMailboxPages<Email>(serverSort, ...pages))
                : (single ? appendServerPage<Email>(emailsRef.current, pages[0]) : mergeMailboxPages<Email>(serverSort, emailsRef.current, ...pages));

            for (const r of responses) pagingRef.current[r.key] = { cursor: r.nextCursor, hasMore: r.more };
            setEmails(merged);
            setData(cacheKey, merged, { silent: true });
            setHasMore(targets.some((a) => pagingRef.current[pageKey(a)]?.hasMore ?? true));
            // Total exacto solo si respondieron todos los buzones pedidos.
            if (mode === 'refresh' && responses.length === plan.length && responses.every((r) => r.total !== null)) {
                setTotalCount(responses.reduce((sum, r) => sum + (r.total ?? 0), 0));
                setListFilters(responses.every((r) => r.filters) ? sumFilterCounts(responses.map((r) => r.filters as FolderFilterCounts)) : null);
            }
            setLoadError(false);
            setLastSync(Date.now());
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
    const syncRef = useRef(syncEmails);
    syncRef.current = syncEmails;

    const prefetchEmail = useCallback(async (id: string) => {
        // Match key with MailView
        const cacheKey = `email-${id}-thread-v2`;
        const cached = await getData(cacheKey);
        if (cached) return;
        try {
            const data = await fetchDeduped(`/api/emails/${id}?thread=true`);
            if (data?.email) setData(cacheKey, data, { silent: true });
        } catch (e) {
            // Siently fail for prefetch
            console.error('Prefetch failed', e);
        }
    }, [getData, setData]);

    // Track previous nav state to avoid clearing on cache updates
    const prevFolder = useRef(folder);
    const prevContextKey = useRef(queryContextKey);

    // Initial Sync on Mount/Folder Change/Label Change/Sort or filter change/Realtime invalidation
    useEffect(() => {
        const hasNavigated = folder !== prevFolder.current || queryContextKey !== prevContextKey.current;

        if (hasNavigated) {
            setEmails([]); // Reset only on navigation
            emailsRef.current = [];
            setHasMore(true);
            pagingRef.current = {};
            setTotalCount(null);
            setListFilters(null);
            setLoadError(false);
            setSelectedIds(new Set());
            setWholeFolder(false);
            setMenu(null);
            prevFolder.current = folder;
            prevContextKey.current = queryContextKey;
        }

        // Sin navegacion (invalidacion/realtime): refrescar sin perder la profundidad ya cargada.
        syncEmails('refresh', !hasNavigated);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [folder, queryContextKey, listVersion]);

    // Conteos exactos por filtro de la carpeta (solo en la vista de una carpeta; se vuelven a pedir tras cada cambio).
    const prevCountsNav = useRef(navKey);
    useEffect(() => {
        if (prevCountsNav.current !== navKey) { prevCountsNav.current = navKey; setFolderCounts(null); }
        if (!serverList || !plainView) { setFolderCounts(null); return; }
        let cancelled = false;
        const targets: RequestGroup[] = requestGroupsRef.current;
        void Promise.allSettled(targets.map((group) => fetchDeduped(
            `/api/counts?folder=${encodeURIComponent(folder)}${group.mailboxes ? `&mailboxes=${encodeURIComponent(group.mailboxes.join(','))}` : ''}`,
            authInit(group),
        ))).then((results) => {
            if (cancelled) return;
            const ok = results.filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value?.filters);
            // Si una cuenta no respondio, el total no seria exacto: sin conteos antes que conteos falsos.
            setFolderCounts(ok.length === targets.length ? sumFilterCounts(ok.map((r) => normalizeFilterCounts(r.value.filters))) : null);
        });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [navKey, folder, serverList, plainView, mailboxTargetSignature, listVersion]);

    // Cuando vuelve la conexion y se vacia la cola offline, se refresca la lista.
    useEffect(() => {
        const onSynced = () => { void syncRef.current('refresh', true); };
        window.addEventListener('bloomx:offline-synced', onSynced);
        return () => window.removeEventListener('bloomx:offline-synced', onSynced);
    }, []);

    // Abrir un correo lo marca como leido en la lista al instante (sin recargar ni reiniciar paginas).
    useEffect(() => {
        if (!selectedId || folder === 'drafts') return;
        setEmails(prev => (prev.some(e => e.id === selectedId && !e.read)
            ? prev.map(e => (e.id === selectedId ? { ...e, read: true } : e))
            : prev));
    }, [selectedId, folder]);

    // --- Eventos optimistas de acciones (lector, deshacer, filas) -----------------------------------------------
    useEffect(() => mailBus.subscribe((event) => {
        if (event.type === 'focus') {
            if (isVisibleInstance()) focusRow(event.id);
            return;
        }
        const view = viewRef.current;
        if (event.type === 'remove') {
            const removed = new Set(event.ids);
            // Hilos que desaparecen por completo (todos sus mensajes quitados).
            const goneGroups = new Set(groupedRef.current.filter((g) => g.allEmails.every((e) => removed.has(e.id))).map((g) => g.id));
            const rowIds = groupedRef.current.map((g) => g.id);
            const hadFocus = Boolean(rootRef.current?.contains(document.activeElement));
            const nextFocus = focusAfterRemoval(rowIds, goneGroups, focusedIdRef.current);
            const openGone = selectedIdRef.current ? goneGroups.has(selectedIdRef.current) : false;
            setEmails((prev) => reduceListEvent(prev, event, { viewFolder: view.folder, restrictToFolder: view.restrict }));
            setSelectedIds((prev) => {
                if (!event.ids.some((id) => prev.has(id))) return prev;
                const next = new Set(prev);
                event.ids.forEach((id) => next.delete(id));
                return next;
            });
            if (nextFocus && (hadFocus || openGone)) {
                setFocusedId(nextFocus);
                if (isVisibleInstance()) focusRow(nextFocus);
            } else if (goneGroups.has(focusedIdRef.current ?? '')) {
                setFocusedId(null);
            }
            // El correo abierto se ha ido (archivado, eliminado...): se cierra el lector.
            if (openGone) closeOpenedEmail();
            return;
        }
        setEmails((prev) => reduceListEvent(prev, event, { viewFolder: view.folder, restrictToFolder: view.restrict }));
    }), [focusRow, closeOpenedEmail]);

    // Scroll Handler for Infinite Scroll (solo para la lista sin virtualizar; la virtual usa onNearEnd)
    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
        if (scrollHeight - scrollTop <= clientHeight + 100) { // 100px threshold
            if (!loadingMore && hasMore && !loading) syncEmails('loadMore');
        }
    };

    const { indicator: pullIndicator } = usePullToRefresh(scrollRef, () => syncRef.current('refresh', true), swipeEnabled);

    // --- Render -------------------------------------------------------------------------------------------------
    const useVirtual = shouldVirtualize(groupedEmails.length);
    virtualizedRef.current = useVirtual;
    const virtualIds = useMemo(() => (useVirtual ? flatItems.map((it) => it.id) : []), [useVirtual, flatItems]);
    const stickyIndexes = useMemo(() => headerIndexes(flatItems), [flatItems]);
    const focusedIndex = useMemo(
        () => (useVirtual && focusedId ? flatItems.findIndex((it) => it.id === focusedId) : -1),
        [useVirtual, focusedId, flatItems]
    );
    const dim = densityClasses(prefs.density);

    const renderItem = (index: number, virtual: boolean) => {
        const item = flatItems[index];
        if (!item) return null;
        if (item.kind === 'header') {
            const titleKey = DATE_BUCKET_KEYS[item.bucket];
            return (
                <div role="listitem" data-date-header={item.bucket} className="bg-background px-2 py-1">
                    <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {t(titleKey)}
                        <span className="rounded-full bg-muted px-1.5 text-[10px] font-medium normal-case tabular-nums">{item.count}</span>
                    </h3>
                </div>
            );
        }
        const group = item.group;
        const email = group.latestEmail;
        const labels: LabelRef[] = unionLabels(group.allEmails);
        const isSelected = group.allEmails.every(e => selectedIds.has(e.id));
        const rowFolder = folderOfEmail(email, folder);
        const ctx = { allRead: Boolean(email.read), allStarred: Boolean(email.starred) };
        return (
            <MailRow
                key={email.id}
                email={email}
                index={item.rowIndex}
                virtual={virtual}
                ariaPos={virtual ? listItemAria(item.rowIndex, groupedEmails.length, hasMore) : undefined}
                threadCount={group.count}
                participants={threadParticipants(group.allEmails)}
                attachments={attachmentSummary(group.allEmails)}
                labels={labels}
                labelsKey={labels.map(l => `${l.id}:${l.name}:${l.color || ''}`).join('|')}
                folder={rowFolder}
                density={prefs.density}
                snippetLines={prefs.snippetLines}
                isSelected={isSelected}
                isFocused={focusedId === email.id}
                isOpen={selectedId === email.id}
                swipeRight={resolveSwipeAction(rowFolder, 'right', prefs.swipeRight, ctx)}
                swipeLeft={resolveSwipeAction(rowFolder, 'left', prefs.swipeLeft, ctx)}
                swipeEnabled={swipeEnabled}
                draggable={!swipeEnabled && rowFolder !== 'drafts'}
                onDragStartRow={handleRowDragStart}
                onDragEndRow={handleRowDragEnd}
                onFocusRow={setFocusedId}
                onSelect={handleSelect}
                onSelectToggle={toggleSelection}
                onPrefetch={prefetchEmail}
                onAction={handleRowAction}
                onMenu={handleRowMenu}
            />
        );
    };

    const isSearching = Boolean(searchFilter || fromFilter || hasAttachmentFilter || sinceFilter || untilFilter);
    const emptyKind: EmptyKind = loadError && emails.length === 0 ? 'error'
        : quickFilter !== 'all' && groupedEmails.length === 0 ? 'filter'
            : labelFilter ? 'label' : isSearching ? 'search' : 'folder';
    const accountSelect = {
        enabled: folder !== 'drafts' && multiAccountEnabled && storedAccounts.length > 0,
        options: accountOptions,
        selectedLabel: selectedAccountLabel,
        value: effectiveAccountFilter,
        onChange: updateAccountFilter,
    };

    const selectedEmails = emails.filter((e) => selectedIds.has(e.id));
    const bulkProps = {
        count: selectedIds.size,
        allSelected,
        folders: selectedEmails.map((e) => folderOfEmail(e, folder)),
        allRead: selectedEmails.length > 0 && selectedEmails.every((e) => e.read),
        allStarred: selectedEmails.length > 0 && selectedEmails.every((e) => e.starred),
        wholeFolder: wholeFolder && plainView,
        wholeCount: selection.wholeFolderCount,
        onSelectAll: handleSelectAll,
        onClear: clearSelection,
        onAction: (a: MailActionId) => { void runBulk(a); },
        onMenu: handleBulkMenu,
    };

    const listLabel = t('emailList.listLabel', { folder: folderLabel(t, folder) });
    const rowGap = dim.list;

    return (
        <div ref={rootRef} className="flex h-full flex-col bg-background/50" data-mail-list>
            {/* Cabecera de escritorio: titulo + sincronizacion + vista + ayuda; con seleccion, la barra masiva */}
            <div className="sticky top-0 z-10 hidden min-h-[60px] items-center justify-between gap-2 bg-header px-4 py-3 text-header-foreground md:flex">
                {selectedIds.size > 0 ? (
                    <BulkBar variant="header" {...bulkProps} />
                ) : (
                    <>
                        <div className="flex min-w-0 items-center gap-2">
                            <input
                                type="checkbox"
                                aria-label={t('emailList.selectAll')}
                                className="h-4 w-4 shrink-0 rounded border-input accent-primary"
                                checked={false}
                                disabled={loadedIds.length === 0}
                                onChange={handleSelectAll}
                            />
                            <h1 className="truncate text-xl font-bold tracking-tight">{folderLabel(t, folder)}</h1>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                            <SyncStatus lastSync={lastSync} refreshing={refreshing || loading} onRefresh={manualRefresh} />
                            <ViewMenu prefs={prefs} onChange={updatePrefs} />
                            <IconButton label={t('emailList.shortcuts.button')} onClick={() => setHelpOpen(true)}>
                                <Keyboard className="h-4 w-4" aria-hidden="true" />
                            </IconButton>
                        </div>
                    </>
                )}
            </div>

            <ListSearch inputRef={searchInputRef} account={accountSelect} />

            {/* Filtros rapidos (todos los tamanos) + vista/actualizar en movil */}
            <div className="flex items-center gap-2 border-b border-border bg-header px-3 py-2 text-header-foreground md:px-4">
                <QuickFilters value={quickFilter} onChange={setQuickFilter} counts={filterCounts} className="min-w-0 flex-1" />
                <div className="flex shrink-0 items-center gap-0.5 md:hidden">
                    <SyncStatus lastSync={lastSync} refreshing={refreshing || loading} onRefresh={manualRefresh} />
                    <ViewMenu prefs={prefs} onChange={updatePrefs} />
                </div>
            </div>

            {folder !== 'drafts' && plainView && (
                <SelectionBanner
                    loadedCount={loadedIds.length}
                    wholeCount={selection.wholeFolderCount}
                    canSelectWhole={selection.canSelectWholeFolder && !wholeFolder}
                    wholeSelected={wholeFolder}
                    loading={false}
                    onSelectWhole={selectWholeFolder}
                    onClear={clearSelection}
                />
            )}

            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto px-2 [overscroll-behavior-y:contain]"
                onScroll={useVirtual ? undefined : handleScroll}
            >
                {pullIndicator}
                {loading && emails.length === 0 ? (
                    <div className="pt-2"><ListSkeleton density={prefs.density} /></div>
                ) : groupedEmails.length === 0 ? (
                    <EmptyState
                        kind={emptyKind}
                        folder={folder}
                        query={searchFilter}
                        label={labelFilter}
                        onRetry={() => { setLoadError(false); setLoading(true); void syncRef.current('refresh'); }}
                        onClearFilter={() => setQuickFilter('all')}
                    />
                ) : useVirtual ? (
                    <div className="pb-24 md:pb-4">
                        <VirtualMailRows
                            scrollRef={scrollRef}
                            ids={virtualIds}
                            renderRow={(index) => renderItem(index, true)}
                            pinnedIndex={focusedIndex}
                            hasMore={hasMore}
                            onNearEnd={() => { if (!loadingMore && !loading) void syncEmails('loadMore'); }}
                            handleRef={virtualHandleRef}
                            label={listLabel}
                            estimateSize={estimateRowHeight(prefs.density, prefs.snippetLines)}
                            stickyIndexes={showHeaders ? stickyIndexes : undefined}
                            gap={prefs.density === 'compact' ? 2 : prefs.density === 'spacious' ? 8 : 4}
                        />
                        {loadingMore && (
                            <div className="flex justify-center py-4 text-muted-foreground" role="status" aria-label={t('common.loading')}>
                                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                            </div>
                        )}
                    </div>
                ) : (
                    <div role="list" aria-label={listLabel} className={cn('flex flex-col pb-24 md:pb-4', rowGap)}>
                        <AnimatePresence initial={false}>
                            {flatItems.map((item, index) => (
                                item.kind === 'header'
                                    ? <div key={item.id} className="sticky top-0 z-20">{renderItem(index, false)}</div>
                                    : renderItem(index, false)
                            ))}
                        </AnimatePresence>
                        {loadingMore && (
                            <div className="flex justify-center py-4 text-muted-foreground" role="status" aria-label={t('common.loading')}>
                                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Barra inferior de acciones masivas (movil) */}
            {selectedIds.size > 0 && (
                <div className="fixed inset-x-2 bottom-3 z-30 md:hidden">
                    <BulkBar variant="bottom" {...bulkProps} />
                </div>
            )}

            {/* FAB de redactar (movil) */}
            {!selectedId && selectedIds.size === 0 && (
                <div className="fixed bottom-6 right-6 z-30 md:hidden">
                    <button
                        type="button"
                        onClick={() => openCompose()}
                        aria-label={t('emailList.compose')}
                        className="flex h-14 items-center gap-2 rounded-2xl bg-primary px-5 text-primary-foreground shadow-lg transition-all hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
                    >
                        <Plus className="h-6 w-6" aria-hidden="true" />
                        <span className="text-base font-medium">{t('emailList.compose')}</span>
                    </button>
                </div>
            )}

            {/* Menus compartidos: mover / etiquetar / posponer */}
            {menu && (menu.kind === 'move' || menu.kind === 'label') && (
                <MoveMenu
                    open
                    mode={menu.kind}
                    onClose={closeMenu}
                    anchorRef={menuAnchorRef}
                    currentFolder={menuFolder}
                    labels={availableLabels}
                    loading={labelsLoading}
                    labelState={labelStateFor}
                    onMove={(to) => {
                        const targets = menuEmails;
                        if (menu.clearSelection) clearSelection();
                        if (menu.scope) void actionsRef.current.applyToScope('move', scopeInfo(), targets, totalCount ?? targets.length, { to, groups: scopeGroups() });
                        else void actionsRef.current.moveToFolder(targets, to, folder);
                    }}
                    onToggleLabel={(label) => { void actionsRef.current.applyLabel(menuEmails, label); }}
                />
            )}
            {menu && (menu.kind === 'snooze' || menu.kind === 'reschedule') && (
                <SnoozeMenu
                    open
                    variant={menu.kind}
                    onClose={closeMenu}
                    anchorRef={menuAnchorRef}
                    onSnooze={(until) => {
                        const targets = menuEmails;
                        if (menu.clearSelection) clearSelection();
                        if (menu.kind === 'reschedule') void actionsRef.current.reschedule(targets, until);
                        else void actionsRef.current.snoozeEmails(targets, until, folder);
                    }}
                />
            )}

            <ShortcutsOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
            {actions.dialog}

            <span className="sr-only" aria-live="polite">{!isOnline ? t('emailList.sync.offline') : ''}</span>
        </div>
    );
}

