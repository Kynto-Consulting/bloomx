'use client';

import { Suspense, useState, useEffect, useRef, type DragEvent } from 'react';
import Link from 'next/link';

import { useSearchParams, usePathname } from 'next/navigation';
import { Inbox, File, Send, ArchiveX, Trash2, Archive, Plus, Tag, Check, X, Clock, Sparkles, LogOut, UserPlus, Settings, ChevronUp, ChevronDown, ArrowUp, ArrowDown, MoreHorizontal, CalendarDays, Users, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import * as Icons from 'lucide-react';
import { useExpansions } from '@/hooks/useExpansions';
import { cn } from '@/lib/utils';
import { ExtensionLoader } from './expansions/ExtensionLoader';
import { ExtensionNavLinks } from './expansions/nav/ExtensionNavLinks';
import { useExtensionNav, useNavBadges } from '@/hooks/useExtensionNav';
import { CronTrigger } from '@/components/CronTrigger';
import { useCompose } from '@/contexts/ComposeContext';
import { useCache } from '@/contexts/CacheContext';
import { useSession } from '@/components/SessionProvider';
import { AccountManager, StoredAccount } from '@/lib/account-manager';
import { toast } from 'sonner';
import { SettingsModal } from './SettingsModal';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { useI18n } from '@/components/I18nProvider';
import { labelDisplayName } from '@/lib/organizer/labels';
import {
    LABELS_CACHE_KEY,
    COUNTS_CACHE_KEY,
    normalizeLabelList,
    mergeLabelCounts,
    shouldSidebarRefresh,
    type LabelRef,
} from '@/lib/mail-list';
import { MAIL_DND_TYPE, canDropOnFolder, dragState, parseDragPayload } from '@/lib/mail-dnd';
import { useMailActions } from '@/components/mail/useMailActions';
import { Avatar } from '@/components/mail/ui';
import { QuotaMeter } from '@/components/mail/QuotaMeter';
import { LabelsHelp, NewLabelMenu, SidebarLabelGroups } from '@/components/labels/SidebarLabelGroups';
import type { LabelGroupKey } from '@/lib/labels/groups';

// Init

interface SidebarProps {
    onClose?: () => void;
}

type SidebarSectionKey = 'main' | 'workspace' | 'tools' | 'labels';

const SIDEBAR_SECTION_STATE_KEY = 'bloomx:sidebar:sections:v1';
const SIDEBAR_SECTION_ORDER_KEY = 'bloomx:sidebar:section-order:v1';
const DEFAULT_SECTION_STATE: Record<SidebarSectionKey, boolean> = {
    main: false,
    workspace: false,
    tools: false,
    labels: false,
};
const DEFAULT_SECTION_ORDER: SidebarSectionKey[] = ['main', 'workspace', 'tools', 'labels'];

export function Sidebar({ onClose }: SidebarProps) {
    return (
        <Suspense fallback={<div className="h-full bg-sidebar" />}>
            <SidebarContent onClose={onClose} />
        </Suspense>
    );
}

function SidebarContent({ onClose }: SidebarProps) {
    const { status } = useSession();
    const { t } = useI18n();
    const searchParams = useSearchParams();
    const pathname = usePathname();
    const currentFolder = searchParams.get('folder') || 'inbox';
    const { openCompose } = useCompose();
    const { getData, setData, subscribe, invalidate } = useCache();
    const [counts, setCounts] = useState({
        inbox: 0,
        drafts: 0,
        sent: 0,
        spam: 0,
        trash: 0,
        archive: 0,
        scheduled: 0
    });
    // Totales (leidos + no leidos) por carpeta: `counts` son los NO LEIDOS.
    const [totals, setTotals] = useState<Record<string, number>>({});
    const [labels, setLabels] = useState<LabelRef[]>([]);
    const [unifiedReplyModeEnabled, setUnifiedReplyModeEnabled] = useState(false);

    // Arrastrar correos de la lista a una carpeta o etiqueta (la alternativa accesible es el menu "Mover a..." / tecla V).
    const mailActions = useMailActions();
    const [dropTarget, setDropTarget] = useState<string | null>(null);
    const isMailDrag = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes(MAIL_DND_TYPE);
    const handleFolderDragOver = (e: DragEvent, folderId: string) => {
        if (!isMailDrag(e) || !canDropOnFolder(folderId, dragState.get())) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dropTarget !== `folder:${folderId}`) setDropTarget(`folder:${folderId}`);
    };
    const handleLabelDragOver = (e: DragEvent, labelId: string) => {
        if (!isMailDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (dropTarget !== `label:${labelId}`) setDropTarget(`label:${labelId}`);
    };
    const handleDragLeave = (targetKey: string) => {
        setDropTarget((current) => (current === targetKey ? null : current));
    };
    const handleDrop = async (e: DragEvent, target: { kind: 'folder'; id: string } | { kind: 'label'; label: LabelRef }) => {
        const payload = parseDragPayload(e.dataTransfer.getData(MAIL_DND_TYPE));
        setDropTarget(null);
        dragState.end();
        if (!payload) return;
        e.preventDefault();
        const emails = payload.emails.map((m) => ({ ...m })) as any[];
        if (target.kind === 'folder') {
            if (!canDropOnFolder(target.id, payload)) return;
            await mailActions.moveToFolder(emails.filter((m) => m.folder !== target.id), target.id, payload.source);
        } else {
            await mailActions.applyLabel(emails, target.label, { onlyAdd: true });
        }
    };

    const activeLabels = searchParams.get('label')?.split(',') || [];

    const getLabelUrl = (labelName: string) => {
        const name = labelName.toLowerCase();
        let newLabels = [...activeLabels];
        if (newLabels.includes(name)) {
            newLabels = newLabels.filter(l => l !== name);
        } else {
            newLabels.push(name);
        }

        const params = new URLSearchParams(searchParams.toString());
        if (newLabels.length > 0) {
            params.set('label', newLabels.join(','));
            params.set('folder', currentFolder); // Ensure folder stays current
        } else {
            params.delete('label');
        }
        const account = searchParams.get('account');
        if (account) {
            params.set('account', account);
        }
        if (params.has('id')) params.delete('id'); // Deselect email on nav

        return `/?${params.toString()}`;
    };

    const getFolderUrl = (folderId: string) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('folder', folderId);
        params.delete('id');
        return `/?${params.toString()}`;
    };

    // Label creation state
    const [creatingKind, setCreatingKind] = useState<LabelGroupKey | null>(null);
    const [newLabelName, setNewLabelName] = useState('');
    const [isSubmittingLabel, setIsSubmittingLabel] = useState(false);

    const [showSettings, setShowSettings] = useState(false);
    const [settingsTab, setSettingsTab] = useState<'integrations' | 'spam' | undefined>(undefined);
    // Otros componentes (selector de videoconferencia) piden abrir Ajustes -> Integraciones con este evento.
    useEffect(() => {
        const onOpen = (event: Event) => {
            const tab = (event as CustomEvent<{ tab?: string }>).detail?.tab;
            setSettingsTab(tab === 'integrations' || tab === 'spam' ? tab : undefined);
            setShowSettings(true);
        };
        window.addEventListener('bloomx:open-settings', onOpen);
        return () => window.removeEventListener('bloomx:open-settings', onOpen);
    }, []);
    const [collapsedSections, setCollapsedSections] = useState<Record<SidebarSectionKey, boolean>>(DEFAULT_SECTION_STATE);
    const [sectionOrder, setSectionOrder] = useState<SidebarSectionKey[]>(DEFAULT_SECTION_ORDER);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        try {
            const storedState = window.localStorage.getItem(SIDEBAR_SECTION_STATE_KEY);
            if (storedState) {
                const parsed = JSON.parse(storedState);
                setCollapsedSections((prev) => ({
                    ...prev,
                    main: Boolean(parsed?.main),
                    workspace: Boolean(parsed?.workspace),
                    tools: Boolean(parsed?.tools),
                    labels: Boolean(parsed?.labels),
                }));
            }
        } catch {
            // Ignore malformed localStorage value.
        }

        try {
            const storedOrder = window.localStorage.getItem(SIDEBAR_SECTION_ORDER_KEY);
            if (storedOrder) {
                const parsed = JSON.parse(storedOrder);
                if (Array.isArray(parsed)) {
                    const nextOrder = parsed.filter((value: string) => DEFAULT_SECTION_ORDER.includes(value as SidebarSectionKey));
                    // Una seccion nueva (herramientas de extensiones) entra justo despues del espacio de trabajo, respetando el orden que el usuario ya eligio.
                    if (!nextOrder.includes('tools')) nextOrder.splice(nextOrder.includes('workspace') ? nextOrder.indexOf('workspace') + 1 : nextOrder.length, 0, 'tools');
                    const missing = DEFAULT_SECTION_ORDER.filter((key) => !nextOrder.includes(key));
                    const merged = [...nextOrder, ...missing] as SidebarSectionKey[];
                    if (merged.length > 0) {
                        setSectionOrder(merged);
                    }
                }
            }
        } catch {
            // Ignore malformed localStorage value.
        }
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(SIDEBAR_SECTION_STATE_KEY, JSON.stringify(collapsedSections));
    }, [collapsedSections]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(SIDEBAR_SECTION_ORDER_KEY, JSON.stringify(sectionOrder));
    }, [sectionOrder]);

    const toggleSection = (section: SidebarSectionKey) => {
        setCollapsedSections((prev) => ({
            ...prev,
            [section]: !prev[section],
        }));
    };

    // "Herramientas" solo existe si alguna extension aporta entradas: el resto de secciones no deben notar el hueco.
    const isMobileDrawer = Boolean(onClose);
    const extensionNav = useExtensionNav({ mobileOnly: isMobileDrawer });
    const navMain = extensionNav.filter((item) => item.section === 'main');
    const navWorkspace = extensionNav.filter((item) => item.section === 'workspace');
    const navTools = extensionNav.filter((item) => item.section === 'tools');
    const navBadges = useNavBadges(extensionNav);
    const visibleOrder = sectionOrder.filter((key) => key !== 'tools' || navTools.length > 0);

    const moveSection = (section: SidebarSectionKey, direction: -1 | 1) => {
        setSectionOrder((prev) => {
            const visible = prev.filter((key) => key !== 'tools' || navTools.length > 0);
            const target = visible[visible.indexOf(section) + direction];
            const currentIndex = prev.indexOf(section);
            const nextIndex = target ? prev.indexOf(target) : -1;
            if (currentIndex === -1 || nextIndex === -1) return prev;

            const updated = [...prev];
            const [entry] = updated.splice(currentIndex, 1);
            updated.splice(nextIndex, 0, entry);
            return updated;
        });
    };

    const sectionMeta: Record<SidebarSectionKey, { title: string }> = {
        main: { title: t('sidebar.sections.mailboxes') },
        workspace: { title: t('sidebar.sections.workspace') },
        tools: { title: t('extensionState.nav.sectionTools') },
        labels: { title: t('sidebar.sections.labels') },
    };

    const renderSectionHeader = (section: SidebarSectionKey, extraAction?: React.ReactNode) => {
        const isCollapsed = collapsedSections[section];
        const index = visibleOrder.indexOf(section);

        return (
            <div className="px-2 mb-1 flex items-center gap-1">
                <button
                    type="button"
                    onClick={() => toggleSection(section)}
                    aria-expanded={!isCollapsed}
                    className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-[0.16em] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                >
                    {isCollapsed ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronUp className="h-3.5 w-3.5 shrink-0" />}
                    <span className="truncate">{sectionMeta[section].title}</span>
                </button>

                {extraAction}

                <button
                    type="button"
                    onClick={() => moveSection(section, -1)}
                    disabled={index <= 0}
                    className="p-1 rounded-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                    title={t('sidebar.moveUp')}
                    aria-label={t('sidebar.moveSectionUp', { name: sectionMeta[section].title })}
                >
                    <ArrowUp className="h-3 w-3" />
                </button>
                <button
                    type="button"
                    onClick={() => moveSection(section, 1)}
                    disabled={index >= visibleOrder.length - 1}
                    className="p-1 rounded-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                    title={t('sidebar.moveDown')}
                    aria-label={t('sidebar.moveSectionDown', { name: sectionMeta[section].title })}
                >
                    <ArrowDown className="h-3 w-3" />
                </button>
            </div>
        );
    };

    useEffect(() => {
        async function loadData() {
            // Load Counts
            const cachedCounts = await getData<typeof counts>(COUNTS_CACHE_KEY);

            if (cachedCounts) {
                setCounts(cachedCounts);
            }

            // Load Labels (forma unica del cache: siempre con id)
            const cachedLabels = normalizeLabelList(await getData<unknown>(LABELS_CACHE_KEY));
            if (cachedLabels.length > 0) {
                setLabels(cachedLabels);
            }

            // Background Refresh
            try {
                const [countsResponse, settingsResponse] = await Promise.all([
                    fetch('/api/counts'),
                    fetch('/api/settings', { cache: 'no-store' }),
                ]);

                const data = countsResponse.ok ? await countsResponse.json().catch(() => null) : null;
                const settingsData = settingsResponse.ok ? await settingsResponse.json().catch(() => null) : null;

                if (data?.counts) {
                    setCounts(data.counts);
                    setData(COUNTS_CACHE_KEY, data.counts, { silent: true });
                }
                if (data?.totals && typeof data.totals === 'object') setTotals(data.totals);
                if (Array.isArray(data?.labels)) {
                    let normalized = normalizeLabelList(data.labels);
                    if (normalized.length < data.labels.length) {
                        // /api/counts sin id (servidor antiguo): completamos con /api/labels
                        const labelsRes = await fetch('/api/labels', { cache: 'no-store' }).catch(() => null);
                        if (labelsRes?.ok) {
                            const full = normalizeLabelList(await labelsRes.json().catch(() => null));
                            normalized = mergeLabelCounts(full, data.labels);
                        }
                    }
                    setLabels(normalized);
                    setData(LABELS_CACHE_KEY, normalized, { silent: true });
                }

                const mailboxSettings = settingsData?.expansionSettings?.['core-mailbox'] || {};
                setUnifiedReplyModeEnabled(Boolean(mailboxSettings.unifiedRepliesEnabled));
            } catch (error) {
                console.error('Failed to refresh counts:', error);
            }
        }

        if (status === 'authenticated') {
            loadData();
        }

        // Subscription for immediate updates
        // Solo claves relevantes (contadores, labels, ajustes) o avisos globales:
        // abrir un correo ya no dispara counts + settings.
        const unsubscribe = subscribe((key) => {
            if (status === 'authenticated' && shouldSidebarRefresh(key)) loadData();
        });

        // Poll every 30s (en pausa con la pestana oculta)
        const interval = setInterval(() => {
            if (status === 'authenticated' && document.visibilityState !== 'hidden') loadData();
        }, 30000);
        return () => {
            clearInterval(interval);
            unsubscribe();
        };
    }, [getData, setData, subscribe, status]);

    const handleCreateLabel = async () => {
        if (!newLabelName.trim()) return;
        setIsSubmittingLabel(true);
        try {
            const res = await fetch('/api/labels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newLabelName.trim(), behavior: creatingKind ?? 'tag' })
            });

            if (res.ok) {
                const [label] = normalizeLabelList([await res.json()]);
                if (label) {
                    const created = { ...label, behavior: creatingKind ?? label.behavior ?? 'tag', count: 0 };
                    setLabels(prev => (prev.some(l => l.id === created.id) ? prev : [...prev, created])); // Optimistic add

                    // Update global cache for MailView (misma forma: siempre con id)
                    const cachedLabels = normalizeLabelList(await getData<unknown>(LABELS_CACHE_KEY));
                    if (!cachedLabels.some((l) => l.id === created.id)) {
                        await setData(LABELS_CACHE_KEY, [...cachedLabels, created], { silent: true });
                    }
                }

                setNewLabelName('');
                setCreatingKind(null);
                toast.success(t(creatingKind === 'folder' ? 'labelTree.groups.createdFolder' : 'labelTree.groups.createdTag'));
            } else {
                toast.error(t('sidebar.labelCreateFailed'));
            }
        } catch (error) {
            console.error(error);
            toast.error(t('common.unexpectedError'));
        } finally {
            setIsSubmittingLabel(false);
        }
    };

    const mainNav = [
        { name: t('sidebar.folders.inbox'), icon: Inbox, id: 'inbox', count: counts.inbox },
        { name: t('sidebar.folders.drafts'), icon: File, id: 'drafts', count: counts.drafts },
        { name: t('sidebar.folders.sent'), icon: Send, id: 'sent', count: counts.sent },
        { name: t('sidebar.folders.scheduled'), icon: Clock, id: 'scheduled', count: counts.scheduled || 0 },
        { name: t('sidebar.folders.spam'), icon: ArchiveX, id: 'spam', count: counts.spam },
        { name: t('sidebar.folders.trash'), icon: Trash2, id: 'trash', count: counts.trash },
        { name: t('sidebar.folders.archive'), icon: Archive, id: 'archive', count: counts.archive },
    ];

    const workspaceNav = [
        { name: t('sidebar.workspace.calendar'), icon: CalendarDays, href: '/calendar', active: pathname === '/calendar' },
        { name: t('sidebar.workspace.contacts'), icon: Users, href: '/contacts', active: pathname === '/contacts' },
        { name: t('sidebar.workspace.appointments'), icon: Clock, href: '/appointments', active: pathname === '/appointments' },
        { name: t('sidebar.workspace.elixir'), icon: Zap, href: '/elixir', active: pathname === '/elixir' },
    ];

    const { config: domainConfig } = useDomainConfig();
    const brandName = domainConfig.displayName || domainConfig.name;
    const brandLogo = domainConfig.logo;

    return (
        <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground group">
            {/* Account / Compose */}
            <div className="flex px-4 py-4 items-center justify-between">
                <div className="flex items-center gap-2 text-sidebar-foreground font-bold text-lg tracking-tight">
                    {brandLogo ? (
                        <img src={brandLogo} alt={brandName} className="h-7 w-7 rounded-lg object-contain" />
                    ) : (
                        <div
                            className="h-7 w-7 bg-primary text-primary-foreground rounded-lg flex items-center justify-center transition-colors"
                        >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                        </div>
                    )}
                    <span>{brandName}</span>
                </div>
                {/* Mobile Close Button */}
                {onClose && (
                    <button onClick={onClose} aria-label={t('sidebar.close')} className="p-2 text-muted-foreground hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md">
                        <X className="h-5 w-5" />
                    </button>
                )}
            </div>

            <div className="px-3 mb-4">
                <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                        openCompose();
                        onClose?.();
                    }}
                    aria-keyshortcuts="C"
                    className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground px-4 py-3 text-sm font-semibold hover:bg-primary/90 transition-all shadow-md active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
                >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    <span>{t('sidebar.newMessage')}</span>
                    <kbd aria-hidden="true" className="ml-1 hidden rounded border border-primary-foreground/40 px-1 text-[10px] font-semibold opacity-80 md:inline">C</kbd>
                </motion.button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-4">
                {sectionOrder.map((section) => {
                    if (section === 'main') {
                        return (
                            <div key={section} className="mt-1">
                                {renderSectionHeader('main')}
                                {!collapsedSections.main && (
                                    <div className="flex flex-col gap-1">
                                        {mainNav.map((item) => {
                                            const isActive = currentFolder === item.id;
                                            const dropKey = `folder:${item.id}`;
                                            const isDropTarget = dropTarget === dropKey;
                                            const unread = item.id === 'drafts' || item.id === 'scheduled' ? 0 : item.count;
                                            const total = item.id === 'drafts' ? counts.drafts : (totals[item.id] ?? 0);
                                            const countLabel = unread > 0
                                                ? t('sidebar.counts.unreadOfTotal', { unread, total: Math.max(total, unread) })
                                                : total > 0 ? t('sidebar.counts.total', { total }) : '';
                                            return (
                                                <div
                                                    key={item.id}
                                                    className={cn('relative rounded-lg', isDropTarget && 'ring-2 ring-ring bg-sidebar-accent')}
                                                    data-drop-folder={item.id}
                                                    onDragOver={(e) => handleFolderDragOver(e, item.id)}
                                                    onDragLeave={() => handleDragLeave(dropKey)}
                                                    onDrop={(e) => { void handleDrop(e, { kind: 'folder', id: item.id }); }}
                                                >
                                                    {isActive && (
                                                        <motion.div
                                                            layoutId="sidebar-nav-active"
                                                            className="absolute inset-0 bg-sidebar-accent rounded-lg"
                                                            initial={false}
                                                            transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                                        />
                                                    )}
                                                    <Link
                                                        href={getFolderUrl(item.id)}
                                                        onClick={() => onClose?.()}
                                                        aria-current={isActive ? 'page' : undefined}
                                                        aria-label={countLabel ? `${item.name}, ${countLabel}` : undefined}
                                                        className={cn(
                                                            "relative flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors group/item",
                                                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                                            isActive
                                                                ? "text-sidebar-accent-foreground"
                                                                : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                                                        )}
                                                    >
                                                        <item.icon className={cn("h-4 w-4 transition-colors", isActive ? "opacity-100" : "opacity-70 group-hover/item:opacity-100")} aria-hidden="true" />
                                                        <span className="min-w-0 flex-1 truncate">{item.name}</span>
                                                        {unread > 0 && (
                                                            <motion.span
                                                                key={unread}
                                                                initial={{ scale: 0.8, opacity: 0 }}
                                                                animate={{ scale: 1, opacity: 1 }}
                                                                aria-hidden="true"
                                                                className={cn(
                                                                    "text-xs font-semibold px-2 py-0.5 rounded-full tabular-nums",
                                                                    "bg-primary text-primary-foreground"
                                                                )}
                                                            >
                                                                {unread}
                                                            </motion.span>
                                                        )}
                                                        {total > 0 && (
                                                            <span aria-hidden="true" className={cn('min-w-[1.5rem] text-right text-xs tabular-nums', isActive ? 'opacity-80' : 'text-muted-foreground')}>{total}</span>
                                                        )}
                                                    </Link>
                                                </div>
                                            );
                                        })}
                                        <ExtensionNavLinks items={navMain} badges={navBadges} pathname={pathname} onNavigate={onClose} />
                                    </div>
                                )}
                            </div>
                        );
                    }

                    if (section === 'workspace') {
                        return (
                            <div key={section} className="mt-5">
                                {renderSectionHeader('workspace')}
                                {!collapsedSections.workspace && (
                                    <div className="mt-1 flex flex-col gap-1">
                                        {workspaceNav.map((item) => (
                                            <Link
                                                key={item.href}
                                                href={item.href}
                                                onClick={() => onClose?.()}
                                                className={cn(
                                                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                                                    item.active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                                                )}
                                            >
                                                <item.icon className="h-4 w-4" />
                                                {item.name}
                                            </Link>
                                        ))}
                                        <ExtensionNavLinks items={navWorkspace} badges={navBadges} pathname={pathname} onNavigate={onClose} />
                                    </div>
                                )}
                            </div>
                        );
                    }

                    if (section === 'tools') {
                        if (navTools.length === 0) return null;
                        return (
                            <div key={section} className="mt-5">
                                {renderSectionHeader('tools')}
                                {!collapsedSections.tools && (
                                    <div className="mt-1 flex flex-col gap-1">
                                        <ExtensionNavLinks items={navTools} badges={navBadges} pathname={pathname} onNavigate={onClose} />
                                    </div>
                                )}
                            </div>
                        );
                    }

                    return (
                        <div key={section} className="mt-5">
                            {renderSectionHeader(
                                'labels',
                                <div className="flex shrink-0 items-center gap-0.5">
                                    <ExtensionLoader mountPoint="SIDEBAR_HEADER" />
                                    <LabelsHelp />
                                    <NewLabelMenu active={creatingKind} onPick={(k) => { setCreatingKind(k); setNewLabelName(''); }} />
                                </div>
                            )}

                            {!collapsedSections.labels && (
                                <>
                                    {creatingKind && (
                                        <motion.div
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: 'auto' }}
                                            exit={{ opacity: 0, height: 0 }}
                                            className="mb-2 px-2 pb-2 bg-sidebar-accent/50 rounded-lg p-2 border border-sidebar-border overflow-hidden"
                                        >
                                            <div className="flex items-center gap-1">
                                                <input
                                                    autoFocus
                                                    type="text"
                                                    placeholder={t(creatingKind === 'folder' ? 'labelTree.groups.namePlaceholderFolder' : 'labelTree.groups.namePlaceholderTag')}
                                                    aria-label={t(creatingKind === 'folder' ? 'labelTree.groups.nameFolder' : 'labelTree.groups.nameTag')}
                                                    value={newLabelName}
                                                    onChange={(e) => setNewLabelName(e.target.value)}
                                                    className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') handleCreateLabel();
                                                        if (e.key === 'Escape') setCreatingKind(null);
                                                    }}
                                                />
                                                <button type="button" aria-label={t(creatingKind === 'folder' ? 'labelTree.groups.saveFolder' : 'labelTree.groups.saveTag')} onClick={handleCreateLabel} disabled={isSubmittingLabel} className="p-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90">
                                                    <Check className="h-3 w-3" />
                                                </button>
                                                <button type="button" aria-label={t('common.cancel')} onClick={() => setCreatingKind(null)} className="p-1.5 rounded-md hover:bg-sidebar-accent text-muted-foreground">
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </div>
                                        </motion.div>
                                    )}

                                    <nav aria-label={t('labelTree.treeLabel')}>
                                        <SidebarLabelGroups
                                            labels={labels}
                                            onCreate={(k) => { setCreatingKind(k); setNewLabelName(''); }}
                                            activePaths={activeLabels}
                                            getHref={(l) => getLabelUrl(l.fullPath || l.name)}
                                            onChanged={() => { void invalidate(LABELS_CACHE_KEY); void invalidate(COUNTS_CACHE_KEY); }}
                                            dropTarget={dropTarget}
                                            onMailDragOver={(e, l) => handleLabelDragOver(e, l.id)}
                                            onMailDragLeave={(l) => handleDragLeave(`label:${l.id}`)}
                                            onMailDrop={(e, l) => { void handleDrop(e, { kind: 'label', label: l }); }}
                                        />
                                    </nav>
                                </>
                            )}
                        </div>
                    );
                })}

                <div className="mt-4">
                    <ExtensionLoader mountPoint="SIDEBAR_FOOTER" />
                </div>
            </div>

            <div className="mt-auto"><QuotaMeter /></div>

            {/* User Profile / Settings stub - Hidden on Mobile */}
            <div className="p-4 pt-2">
                <AccountSwitcher
                    onOpenSettings={() => setShowSettings(true)}
                    showConnectedCount={unifiedReplyModeEnabled}
                />
            </div>

            <SettingsModal open={showSettings} onClose={() => { setShowSettings(false); setSettingsTab(undefined); }} initialTab={settingsTab} />
            <CronTrigger />
        </div>
    );
}

function AccountSwitcher({ onOpenSettings, showConnectedCount }: { onOpenSettings: () => void; showConnectedCount: boolean }) {
    const { data: session } = useSession();
    const { t } = useI18n();
    const [isOpen, setIsOpen] = useState(false);
    const [accounts, setAccounts] = useState<StoredAccount[]>([]);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);

    // Al abrir, el foco va a la cuenta activa; al cerrar vuelve al boton (teclado y lector de pantalla).
    const wasOpen = useRef(false);
    useEffect(() => {
        if (isOpen) {
            wasOpen.current = true;
            const id = requestAnimationFrame(() => {
                const items = menuRef.current?.querySelectorAll<HTMLElement>('[data-menu-item]');
                const active = menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]');
                (active ?? items?.[0] ?? menuRef.current)?.focus();
            });
            return () => cancelAnimationFrame(id);
        }
        if (wasOpen.current) { wasOpen.current = false; triggerRef.current?.focus(); }
    }, [isOpen]);

    const onMenuKeyDown = (e: React.KeyboardEvent) => {
        e.stopPropagation();
        const nodes = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[data-menu-item]') ?? []);
        const current = nodes.indexOf(document.activeElement as HTMLElement);
        const focusAt = (i: number) => nodes[(i + nodes.length) % nodes.length]?.focus();
        if (e.key === 'Escape') { e.preventDefault(); setIsOpen(false); }
        else if (e.key === 'Tab') setIsOpen(false);
        else if (e.key === 'ArrowDown') { e.preventDefault(); focusAt(current + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); focusAt(current < 0 ? -1 : current - 1); }
        else if (e.key === 'Home') { e.preventDefault(); focusAt(0); }
        else if (e.key === 'End') { e.preventDefault(); focusAt(nodes.length - 1); }
    };

    useEffect(() => {
        setAccounts(AccountManager.getAccounts());

        // Listen for changes
        const handler = () => setAccounts(AccountManager.getAccounts());
        window.addEventListener('account-change', handler); // We might need to dispatch this on storage event too
        return () => window.removeEventListener('account-change', handler);
    }, []);

    const handleSwitch = async (account: StoredAccount) => {
        if (account.id === session?.user?.id) return;

        const toastId = toast.loading(t('sidebar.switching'));
        try {
            // Swap Cookie
            await fetch('/api/auth/set-cookie', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: account.token })
            });

            AccountManager.setActive(account.id);
            window.location.reload();
        } catch (e) {
            toast.error(t('sidebar.switchFailed'), { id: toastId });
        }
    };

    const handleLogout = async (accountId?: string) => {
        try {
            if (!accountId || accountId === session?.user?.id) {
                // Logout Current
                await fetch('/api/auth/logout', { method: 'POST' });
                if (accountId) AccountManager.removeAccount(accountId);

                // If there are other accounts, switch to one?
                const others = AccountManager.getAccounts().filter(a => a.id !== accountId);
                if (others.length > 0) {
                    handleSwitch(others[0]);
                } else {
                    window.location.href = '/login';
                }
            } else {
                // Forget other account
                AccountManager.removeAccount(accountId);
                setAccounts(AccountManager.getAccounts()); // Update local state
                toast.success(t('sidebar.accountRemoved'));
            }
        } catch (e) {
            console.error(e);
        }
    };

    const handleAddAccount = () => {
        window.location.href = '/login';
    };

    if (!session?.user) return null;

    const connectedCount = accounts.length;
    const profileText = showConnectedCount
        ? t(connectedCount === 1 ? 'sidebar.connectedOne' : 'sidebar.connectedMany', { n: connectedCount })
        : (session.user.email || '');

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                aria-label={t('sidebar.accountMenu')}
                ref={triggerRef}
                className="flex min-h-11 w-full items-center gap-3 hover:bg-sidebar-accent p-2 rounded-lg transition-colors -mx-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
                <Avatar from={session.user.name || session.user.email} className="h-9 w-9 text-xs border border-sidebar-border" />
                <div className="flex flex-col overflow-hidden flex-1">
                    <span className="text-sm font-medium truncate">{session.user.name || t('sidebar.userFallback')}</span>
                    <span className="text-xs text-muted-foreground truncate">{profileText}</span>
                </div>
                <ChevronUp className={cn('h-4 w-4 text-muted-foreground transition-transform', !isOpen && 'rotate-180')} aria-hidden="true" />
            </button>

            <AnimatePresence>
                {isOpen && (
                    <>
                        <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
                        <motion.div
                            ref={menuRef}
                            role="menu"
                            aria-label={t('sidebar.myAccounts')}
                            tabIndex={-1}
                            onKeyDown={onMenuKeyDown}
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            transition={{ duration: 0.2 }}
                            className="absolute bottom-full left-0 w-64 mb-2 bg-popover text-popover-foreground shadow-lg rounded-xl p-2 z-50 flex flex-col gap-1 ring-1 ring-border/10 outline-none"
                        >
                            <div className="px-2 py-1.5 text-xs text-muted-foreground font-semibold uppercase tracking-wider">
                                {t('sidebar.myAccounts')}
                            </div>

                            {accounts.map(acc => {
                                const isActive = acc.id === session.user?.id;
                                return (
                                    <div key={acc.id} role="none" className="group flex items-center gap-1 rounded-lg hover:bg-muted/50 transition-colors">
                                        <button
                                            type="button"
                                            role="menuitemradio"
                                            aria-checked={isActive}
                                            data-menu-item
                                            tabIndex={-1}
                                            onClick={() => handleSwitch(acc)}
                                            className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg p-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        >
                                            <Avatar from={acc.email} className={cn('h-8 w-8 text-xs', isActive && 'ring-2 ring-ring ring-offset-1 ring-offset-popover')} />
                                            <span className="flex min-w-0 flex-1 flex-col">
                                                <span className={cn('text-sm font-medium truncate', isActive && 'font-bold')}>{acc.name || acc.email}</span>
                                                <span className="text-xs text-muted-foreground truncate">{acc.email}</span>
                                            </span>
                                            {isActive && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
                                        </button>
                                        {!isActive && (
                                            <button
                                                type="button"
                                                role="menuitem"
                                                data-menu-item
                                                tabIndex={-1}
                                                onClick={() => handleLogout(acc.id)}
                                                className="mr-1 rounded-md p-1.5 text-muted-foreground outline-none transition-all hover:bg-destructive/15 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100"
                                                title={t('sidebar.forgetAccount')}
                                                aria-label={t('sidebar.forgetAccountNamed', { email: acc.email })}
                                            >
                                                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                                            </button>
                                        )}
                                    </div>
                                );
                            })}

                            <div className="h-px bg-border my-1" />

                            <button type="button" role="menuitem" data-menu-item tabIndex={-1} onClick={handleAddAccount} className="flex min-h-11 items-center gap-2 p-2 rounded-lg hover:bg-muted text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                <UserPlus className="h-4 w-4 text-muted-foreground" />
                                {t('sidebar.addAccount')}
                            </button>

                            <button type="button" role="menuitem" data-menu-item tabIndex={-1} onClick={onOpenSettings} className="flex min-h-11 items-center gap-2 p-2 rounded-lg hover:bg-muted text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                <Settings className="h-4 w-4 text-muted-foreground" />
                                {t('sidebar.settings')}
                            </button>

                            <button type="button" role="menuitem" data-menu-item tabIndex={-1} onClick={() => handleLogout(session.user?.id)} className="flex min-h-11 items-center gap-2 p-2 rounded-lg hover:bg-destructive/10 text-destructive text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                <LogOut className="h-4 w-4" />
                                {t('sidebar.signOut')}
                            </button>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}
