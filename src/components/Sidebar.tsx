'use client';

import { Suspense, useState, useEffect } from 'react';
import Link from 'next/link';

import { useSearchParams, usePathname } from 'next/navigation';
import { Inbox, File, Send, ArchiveX, Trash2, Archive, Plus, Tag, Check, X, Clock, Sparkles, LogOut, UserPlus, Settings, ChevronUp, ChevronDown, ArrowUp, ArrowDown, MoreHorizontal, CalendarDays, Users, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import * as Icons from 'lucide-react';
import { useExpansions } from '@/hooks/useExpansions';
import { cn } from '@/lib/utils';
import { ExtensionLoader } from './expansions/ExtensionLoader';
import { CronTrigger } from '@/components/CronTrigger';
import { useCompose } from '@/contexts/ComposeContext';
import { useCache } from '@/contexts/CacheContext';
import { useSession } from '@/components/SessionProvider';
import { AccountManager, StoredAccount } from '@/lib/account-manager';
import { toast } from 'sonner';
import { SettingsModal } from './SettingsModal';
import { useDomainConfig } from '@/hooks/useDomainConfig';

// Init

interface SidebarProps {
    onClose?: () => void;
}

type SidebarSectionKey = 'main' | 'workspace' | 'labels';

const SIDEBAR_SECTION_STATE_KEY = 'bloomx:sidebar:sections:v1';
const SIDEBAR_SECTION_ORDER_KEY = 'bloomx:sidebar:section-order:v1';
const DEFAULT_SECTION_STATE: Record<SidebarSectionKey, boolean> = {
    main: false,
    workspace: false,
    labels: false,
};
const DEFAULT_SECTION_ORDER: SidebarSectionKey[] = ['main', 'workspace', 'labels'];

export function Sidebar({ onClose }: SidebarProps) {
    return (
        <Suspense fallback={<div className="h-full bg-muted/10" />}>
            <SidebarContent onClose={onClose} />
        </Suspense>
    );
}

function SidebarContent({ onClose }: SidebarProps) {
    const { status } = useSession();
    const searchParams = useSearchParams();
    const pathname = usePathname();
    const currentFolder = searchParams.get('folder') || 'inbox';
    const { openCompose } = useCompose();
    const { getData, setData, subscribe } = useCache();
    const [counts, setCounts] = useState({
        inbox: 0,
        drafts: 0,
        sent: 0,
        spam: 0,
        trash: 0,
        archive: 0,
        scheduled: 0
    });
    const [labels, setLabels] = useState<any[]>([]);
    const [unifiedReplyModeEnabled, setUnifiedReplyModeEnabled] = useState(false);

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
    const [isCreatingLabel, setIsCreatingLabel] = useState(false);
    const [newLabelName, setNewLabelName] = useState('');
    const [isSubmittingLabel, setIsSubmittingLabel] = useState(false);

    const [showSettings, setShowSettings] = useState(false);
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

    const moveSection = (section: SidebarSectionKey, direction: -1 | 1) => {
        setSectionOrder((prev) => {
            const currentIndex = prev.indexOf(section);
            if (currentIndex === -1) return prev;

            const nextIndex = currentIndex + direction;
            if (nextIndex < 0 || nextIndex >= prev.length) return prev;

            const updated = [...prev];
            const [entry] = updated.splice(currentIndex, 1);
            updated.splice(nextIndex, 0, entry);
            return updated;
        });
    };

    const sectionMeta: Record<SidebarSectionKey, { title: string }> = {
        main: { title: 'Mailboxes' },
        workspace: { title: 'Workspace' },
        labels: { title: 'Labels' },
    };

    const renderSectionHeader = (section: SidebarSectionKey, extraAction?: React.ReactNode) => {
        const isCollapsed = collapsedSections[section];
        const index = sectionOrder.indexOf(section);

        return (
            <div className="px-2 mb-1 flex items-center gap-1">
                <button
                    type="button"
                    onClick={() => toggleSection(section)}
                    className="flex flex-1 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-[0.16em] hover:bg-muted/60"
                >
                    {isCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
                    <span>{sectionMeta[section].title}</span>
                </button>

                {extraAction}

                <button
                    type="button"
                    onClick={() => moveSection(section, -1)}
                    disabled={index <= 0}
                    className="p-1 rounded-sm text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Move up"
                >
                    <ArrowUp className="h-3 w-3" />
                </button>
                <button
                    type="button"
                    onClick={() => moveSection(section, 1)}
                    disabled={index >= sectionOrder.length - 1}
                    className="p-1 rounded-sm text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Move down"
                >
                    <ArrowDown className="h-3 w-3" />
                </button>
            </div>
        );
    };

    useEffect(() => {
        async function loadData() {
            // Load Counts
            const countsKey = 'stats-counts';
            const cachedCounts = await getData<typeof counts>(countsKey);

            if (cachedCounts) {
                setCounts(cachedCounts);
            }

            // Load Labels
            const labelsKey = 'labels-all';
            const cachedLabels = await getData<any[]>(labelsKey);

            if (cachedLabels) {
                setLabels(cachedLabels);
            }

            // Background Refresh
            try {
                const [countsResponse, settingsResponse] = await Promise.all([
                    fetch('/api/counts'),
                    fetch('/api/settings', { cache: 'no-store' }),
                ]);

                const data = await countsResponse.json();
                const settingsData = await settingsResponse.json().catch(() => null);

                if (data.counts) {
                    setCounts(data.counts);
                    setData(countsKey, data.counts, { silent: true });
                }
                if (data.labels) {
                    setLabels(data.labels);
                    setData(labelsKey, data.labels, { silent: true });
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
        const unsubscribe = subscribe(() => {
            if (status === 'authenticated') loadData();
        });

        // Poll every 30s
        const interval = setInterval(() => {
            if (status === 'authenticated') loadData();
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
                body: JSON.stringify({ name: newLabelName.trim() })
            });

            if (res.ok) {
                const label = await res.json();
                setLabels(prev => [...prev, { ...label, count: 0 }]); // Optimistic add

                // Update global cache for MailView
                const cachedLabels = await getData<any[]>('labels-all') || [];
                // Check if already exists to be safe
                if (!cachedLabels.some((l: any) => l.id === label.id)) {
                    await setData('labels-all', [...cachedLabels, label], { silent: true });
                }

                setNewLabelName('');
                setIsCreatingLabel(false);
                toast.success('Label created successfully');
            } else {
                toast.error('Failed to create label');
            }
        } catch (error) {
            console.error(error);
            toast.error('Something went wrong');
        } finally {
            setIsSubmittingLabel(false);
        }
    };

    const mainNav = [
        { name: 'Inbox', icon: Inbox, id: 'inbox', count: counts.inbox },
        { name: 'Drafts', icon: File, id: 'drafts', count: counts.drafts },
        { name: 'Sent', icon: Send, id: 'sent', count: counts.sent },
        { name: 'Scheduled', icon: Clock, id: 'scheduled', count: counts.scheduled || 0 },
        { name: 'Junk', icon: ArchiveX, id: 'spam', count: counts.spam },
        { name: 'Trash', icon: Trash2, id: 'trash', count: counts.trash },
        { name: 'Archive', icon: Archive, id: 'archive', count: counts.archive },
    ];

    const workspaceNav = [
        { name: 'Calendar', icon: CalendarDays, href: '/calendar', active: pathname === '/calendar' },
        { name: 'Contacts', icon: Users, href: '/contacts', active: pathname === '/contacts' },
        { name: 'Appointments', icon: Clock, href: '/appointments', active: pathname === '/appointments' },
        { name: 'Elixir', icon: Zap, href: '/elixir', active: pathname === '/elixir' },
    ];

    const { config: domainConfig } = useDomainConfig();
    const brandName = domainConfig.displayName || domainConfig.name;
    const brandLogo = domainConfig.logo;
    const brandColor = domainConfig.theme?.primaryColor;

    return (
        <div className="flex h-full min-h-0 flex-col bg-muted/10 group">
            {/* Account / Compose */}
            <div className="flex px-4 py-4 items-center justify-between">
                <div className="flex items-center gap-2 text-primary font-bold text-lg tracking-tight">
                    {brandLogo ? (
                        <img src={brandLogo} alt={brandName} className="h-7 w-7 rounded-lg object-contain" />
                    ) : (
                        <div
                            className="h-7 w-7 text-primary-foreground rounded-lg flex items-center justify-center transition-colors"
                            style={{ backgroundColor: brandColor }}
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
                    <button onClick={onClose} className="md:hidden p-2 text-muted-foreground hover:text-foreground">
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
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium hover:bg-primary/90 transition-all shadow-sm active:scale-[0.98]"
                >
                    <Plus className="h-4 w-4" />
                    <span>New Message</span>
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
                                            return (
                                                <div key={item.id} className="relative">
                                                    {isActive && (
                                                        <motion.div
                                                            layoutId="sidebar-nav-active"
                                                            className="absolute inset-0 bg-primary/10 rounded-lg"
                                                            initial={false}
                                                            transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                                        />
                                                    )}
                                                    <Link
                                                        href={getFolderUrl(item.id)}
                                                        onClick={() => onClose?.()}
                                                        className={cn(
                                                            "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors group/item",
                                                            isActive
                                                                ? "text-primary"
                                                                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                                                        )}
                                                    >
                                                        <item.icon className={cn("h-4 w-4 transition-colors", isActive ? "text-primary" : "text-muted-foreground group-hover/item:text-foreground")} />
                                                        {item.name}
                                                        {item.count > 0 && (
                                                            <motion.span
                                                                key={item.count}
                                                                initial={{ scale: 0.8, opacity: 0 }}
                                                                animate={{ scale: 1, opacity: 1 }}
                                                                className={cn(
                                                                    "ml-auto text-xs font-semibold px-2 py-0.5 rounded-full",
                                                                    "bg-primary text-primary-foreground"
                                                                )}
                                                            >
                                                                {item.count}
                                                            </motion.span>
                                                        )}
                                                    </Link>
                                                </div>
                                            );
                                        })}
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
                                                    item.active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                                                )}
                                            >
                                                <item.icon className="h-4 w-4" />
                                                {item.name}
                                            </Link>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    }

                    return (
                        <div key={section} className="mt-5">
                            {renderSectionHeader(
                                'labels',
                                <div className="flex items-center gap-1">
                                    <ExtensionLoader mountPoint="SIDEBAR_HEADER" />
                                    <button
                                        type="button"
                                        onClick={() => setIsCreatingLabel(!isCreatingLabel)}
                                        className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-sm hover:bg-muted"
                                        title="Create Label"
                                    >
                                        <Plus className="h-3 w-3" />
                                    </button>
                                </div>
                            )}

                            {!collapsedSections.labels && (
                                <>
                                    {isCreatingLabel && (
                                        <motion.div
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: 'auto' }}
                                            exit={{ opacity: 0, height: 0 }}
                                            className="mb-2 px-2 pb-2 bg-muted/30 rounded-lg p-2 border border-border/50 overflow-hidden"
                                        >
                                            <div className="flex items-center gap-1">
                                                <input
                                                    autoFocus
                                                    type="text"
                                                    placeholder="Label name..."
                                                    value={newLabelName}
                                                    onChange={(e) => setNewLabelName(e.target.value)}
                                                    className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') handleCreateLabel();
                                                        if (e.key === 'Escape') setIsCreatingLabel(false);
                                                    }}
                                                />
                                                <button onClick={handleCreateLabel} disabled={isSubmittingLabel} className="p-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90">
                                                    <Check className="h-3 w-3" />
                                                </button>
                                                <button onClick={() => setIsCreatingLabel(false)} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground">
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </div>
                                        </motion.div>
                                    )}

                                    <nav className="grid gap-0.5">
                                        {labels.length === 0 && !isCreatingLabel && (
                                            <div className="px-4 py-4 text-xs text-muted-foreground/60 text-center border mr-2 ml-2 rounded border-dashed">No labels</div>
                                        )}
                                        {labels.map((label: any) => {
                                            const isActive = activeLabels.includes(label.name.toLowerCase());
                                            return (
                                                <Link
                                                    key={label.name}
                                                    href={getLabelUrl(label.name)}
                                                    className={cn(
                                                        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                                                        isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                                    )}
                                                >
                                                    <div className="flex items-center justify-center w-4 relative">
                                                        <span
                                                            className="h-2.5 w-2.5 rounded-full ring-2 ring-transparent group-hover:ring-border transition-all"
                                                            style={{ backgroundColor: label.color }}
                                                        />
                                                        {isActive && (
                                                            <div className="absolute inset-0 flex items-center justify-center">
                                                                <div className="h-4 w-4 bg-primary/20 rounded-full animate-pulse" />
                                                            </div>
                                                        )}
                                                    </div>
                                                    <span className={cn("flex-1", isActive && "font-bold")}>{label.name}</span>
                                                    {label.count > 0 && (
                                                        <span className="ml-auto text-xs text-muted-foreground">{label.count}</span>
                                                    )}
                                                    {isActive && <Check className="h-3 w-3 text-primary ml-1" />}
                                                </Link>
                                            );
                                        })}
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

            {/* User Profile / Settings stub - Hidden on Mobile */}
            <div className="p-4 mt-auto hidden md:block">
                <AccountSwitcher
                    onOpenSettings={() => setShowSettings(true)}
                    showConnectedCount={unifiedReplyModeEnabled}
                />
            </div>

            <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
            <CronTrigger />
        </div>
    );
}

function AccountSwitcher({ onOpenSettings, showConnectedCount }: { onOpenSettings: () => void; showConnectedCount: boolean }) {
    const { data: session } = useSession();
    const [isOpen, setIsOpen] = useState(false);
    const [accounts, setAccounts] = useState<StoredAccount[]>([]);

    useEffect(() => {
        setAccounts(AccountManager.getAccounts());

        // Listen for changes
        const handler = () => setAccounts(AccountManager.getAccounts());
        window.addEventListener('account-change', handler); // We might need to dispatch this on storage event too
        return () => window.removeEventListener('account-change', handler);
    }, []);

    const handleSwitch = async (account: StoredAccount) => {
        if (account.id === session?.user?.id) return;

        const toastId = toast.loading('Switching account...');
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
            toast.error('Failed to switch', { id: toastId });
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
                toast.success('Account removed');
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
        ? `Estas conectado a ${connectedCount} cuenta${connectedCount === 1 ? '' : 's'}`
        : (session.user.email || '');

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex w-full items-center gap-3 hover:bg-muted/50 p-2 rounded-lg transition-colors -mx-2 text-left"
            >
                <div className="h-9 w-9 rounded-full bg-gradient-to-tr from-pink-500 to-violet-500 flex items-center justify-center text-white font-medium text-xs shrink-0 border border-border">
                    {(session.user.name?.[0] || session.user.email?.[0] || '?').toUpperCase()}
                </div>
                <div className="flex flex-col overflow-hidden flex-1">
                    <span className="text-sm font-medium truncate">{session.user.name || 'User'}</span>
                    <span className="text-xs text-muted-foreground truncate">{profileText}</span>
                </div>
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
            </button>

            <AnimatePresence>
                {isOpen && (
                    <>
                        <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
                        <motion.div
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            transition={{ duration: 0.2 }}
                            className="absolute bottom-full left-0 w-64 mb-2 bg-popover/95 backdrop-blur-md shadow-lg rounded-xl p-2 z-50 flex flex-col gap-1 ring-1 ring-border/10"
                        >
                            <div className="px-2 py-1.5 text-xs text-muted-foreground font-semibold uppercase tracking-wider">
                                My Accounts
                            </div>

                            {accounts.map(acc => {
                                const isActive = acc.id === session.user?.id;
                                return (
                                    <div key={acc.id} className="group flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer" onClick={() => handleSwitch(acc)}>
                                        <div className={cn("h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0",
                                            isActive ? "bg-primary" : "bg-muted-foreground/40")}>
                                            {acc.name?.[0] || acc.email[0]}
                                        </div>
                                        <div className="flex flex-col overflow-hidden flex-1">
                                            <span className={cn("text-sm font-medium truncate", isActive && "text-primary")}>{acc.name}</span>
                                            <span className="text-xs text-muted-foreground truncate">{acc.email}</span>
                                        </div>
                                        {isActive && <Check className="h-4 w-4 text-primary" />}
                                        {!isActive && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleLogout(acc.id); }}
                                                className="p-1.5 text-muted-foreground hover:bg-red-100 hover:text-red-600 rounded-md opacity-0 group-hover:opacity-100 transition-all"
                                                title="Forget account"
                                            >
                                                <LogOut className="h-3.5 w-3.5" />
                                            </button>
                                        )}
                                    </div>
                                );
                            })}

                            <div className="h-px bg-border my-1" />

                            <button onClick={handleAddAccount} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted text-sm font-medium">
                                <UserPlus className="h-4 w-4 text-muted-foreground" />
                                Add another account
                            </button>

                            <button onClick={onOpenSettings} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted text-sm font-medium">
                                <Settings className="h-4 w-4 text-muted-foreground" />
                                Settings
                            </button>

                            <button onClick={() => handleLogout(session.user?.id)} className="flex items-center gap-2 p-2 rounded-lg hover:bg-red-50 text-red-600 text-sm font-medium">
                                <LogOut className="h-4 w-4" />
                                Sign out
                            </button>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}
