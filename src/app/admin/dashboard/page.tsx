'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { mutate as mutateSWR } from 'swr';
import { toast } from 'sonner';
import {
    Users,
    Puzzle,
    Settings,
    Plus,
    Loader2,
    Search,
    Save,
    Info,
    Palette,
    Lock,
    X,
    AlertTriangle,
    CheckCircle2,
    KeyRound,
} from 'lucide-react';
import { declaredCredentialKeys } from '@/lib/extension-credentials';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { ThemePreview } from '@/components/admin/ThemePreview';
import { Modal } from '@/components/ui/Modal';
import { ExtensionCredentialsModal } from '@/components/admin/ExtensionCredentialsModal';
import { useI18n } from '@/components/I18nProvider';
import { agendaTextOn } from '@/lib/agenda-color';
import { analyzeBrand, type BrandIssue } from '@/lib/brand-check';
import { normalizeHex } from '@/lib/color';
import type { DomainThemeConfig } from '@/lib/themes';

interface Extension {
    id: string;
    name: string;
    description?: string;
    version?: string;
    authType?: string;
    template?: any;
    isPaid: boolean;
    price: string;
    currency: string;
}

function normalizeTemplate(template: any) {
    if (!template) return null;
    if (typeof template === 'string') {
        try {
            return JSON.parse(template);
        } catch {
            return null;
        }
    }
    if (typeof template === 'object') {
        return template;
    }
    return null;
}

function inferRequiredEnvVars(extension: Extension | null) {
    if (!extension) return [] as string[];

    const vars = new Set<string>();
    const template = normalizeTemplate(extension.template) || {};

    if (Array.isArray(template?.permissions)) {
        for (const permission of template.permissions) {
            if (typeof permission === 'string' && permission.startsWith('ENV_READ:')) {
                const envKey = permission.slice('ENV_READ:'.length).trim();
                if (envKey) vars.add(envKey);
            }
        }
    }

    const authType = String(extension.authType || template?.auth?.type || '').toUpperCase();
    const provider = String(template?.auth?.provider || '').toLowerCase();

    if (authType === 'OAUTH2') {
        if (provider === 'google') {
            vars.add('GOOGLE_CLIENT_ID');
            vars.add('GOOGLE_CLIENT_SECRET');
        } else if (provider === 'hubspot') {
            vars.add('HUBSPOT_CLIENT_ID');
            vars.add('HUBSPOT_CLIENT_SECRET');
        } else if (provider === 'notion') {
            vars.add('NOTION_CLIENT_ID');
            vars.add('NOTION_CLIENT_SECRET');
        } else if (provider) {
            vars.add(`${provider.toUpperCase()}_CLIENT_ID`);
            vars.add(`${provider.toUpperCase()}_CLIENT_SECRET`);
        } else {
            vars.add('OAUTH_CLIENT_ID');
            vars.add('OAUTH_CLIENT_SECRET');
        }
    }

    if (authType === 'API_KEY') {
        vars.add('API_KEY');
    }

    if (Array.isArray(template?.requiredEnv)) {
        for (const envKey of template.requiredEnv) {
            if (typeof envKey === 'string' && envKey.trim()) {
                vars.add(envKey.trim());
            }
        }
    }

    return Array.from(vars).sort((a, b) => a.localeCompare(b));
}

type Tab = 'extensions' | 'users' | 'settings';
const TABS: { id: Tab; icon: typeof Puzzle }[] = [
    { id: 'extensions', icon: Puzzle },
    { id: 'users', icon: Users },
    { id: 'settings', icon: Settings },
];

/** Campos de color del tema del dominio. `optional`: vacio = "automatico" (lo decide el tema). */
const COLOR_FIELDS = [
    { key: 'primaryColor', label: 'primary' },
    { key: 'secondaryColor', label: 'secondary' },
    { key: 'backgroundColor', label: 'background' },
    { key: 'textColor', label: 'text' },
    { key: 'accentColor', label: 'accent' },
    { key: 'mutedColor', label: 'muted' },
    { key: 'borderColor', label: 'border' },
    { key: 'cardColor', label: 'card' },
    { key: 'inputColor', label: 'input', optional: true },
    { key: 'ringColor', label: 'ring', optional: true },
] as const;
type ColorKey = (typeof COLOR_FIELDS)[number]['key'];

const FONT_OPTIONS = ['Inter', 'Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Courier New'];

const DEFAULT_SETTINGS = {
    name: '', // Dominio tecnico (solo lectura)
    displayName: '', // Nombre publico (editable)
    logo: '',
    primaryColor: '#000000',
    secondaryColor: '#ffffff',
    backgroundColor: '#f9fafb',
    textColor: '#111827',
    accentColor: '#4f46e5',
    mutedColor: '#f3f4f6',
    borderColor: '#e5e7eb',
    cardColor: '#ffffff',
    inputColor: '',
    ringColor: '',
    titleFont: 'Inter',
    bodyFont: 'Inter',
};
type SettingsState = typeof DEFAULT_SETTINGS;

const fieldClass =
    'w-full px-4 py-2 border border-input bg-background text-foreground rounded-lg text-sm focus:ring-2 focus:ring-ring focus:border-primary outline-none';

export default function AdminDashboard() {
    const router = useRouter();
    const { t, intlLocale } = useI18n();
    const uid = useId();
    const { config: domainConfig, extensions: installedExtensions, isLoading: configLoading } = useDomainConfig();

    const [activeTab, setActiveTab] = useState<Tab>('extensions');

    // Users State
    const [users, setUsers] = useState<any[]>([]);
    const [usersLoading, setUsersLoading] = useState(false);
    const [usersError, setUsersError] = useState(false);
    const [userQuery, setUserQuery] = useState('');
    const [newUser, setNewUser] = useState({ email: '', name: '', password: '' });
    const [creatingUser, setCreatingUser] = useState(false);

    // Extensions State
    const [availableExtensions, setAvailableExtensions] = useState<Extension[]>([]);
    const [loadingExtensions, setLoadingExtensions] = useState(false);
    const [catalogError, setCatalogError] = useState(false);
    const [extensionActionId, setExtensionActionId] = useState<string | null>(null);
    const [selectedExtension, setSelectedExtension] = useState<Extension | null>(null);
    const [uninstallTarget, setUninstallTarget] = useState<{ id?: string; extensionId?: string; name?: string } | null>(null);
    const [credentialsTarget, setCredentialsTarget] = useState<{ id: string; name: string } | null>(null);

    const installedExtensionsById = useMemo(() => {
        const map = new Map<string, any>();
        for (const ext of installedExtensions as any[]) {
            const id = ext?.id || ext?.extensionId || ext?.template?.id;
            if (typeof id === 'string' && id.trim()) {
                map.set(id.trim(), ext);
            }
        }
        return map;
    }, [installedExtensions]);

    const buildExtensionDetails = (catalogExtension: Extension): Extension => {
        const installedExt = installedExtensionsById.get(catalogExtension.id);

        const catalogTemplate = normalizeTemplate(catalogExtension.template);
        const installedTemplate = normalizeTemplate(installedExt?.template);
        const template = catalogTemplate || installedTemplate || undefined;

        const version =
            catalogExtension.version ||
            installedExt?.version ||
            template?.version ||
            undefined;

        const authType =
            catalogExtension.authType ||
            installedExt?.authType ||
            template?.auth?.type ||
            undefined;

        const description =
            catalogExtension.description ||
            installedExt?.description ||
            template?.description ||
            '';

        return {
            ...catalogExtension,
            description,
            version,
            authType,
            template,
        };
    };

    // Settings State
    const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
    const [savingSettings, setSavingSettings] = useState(false);

    useEffect(() => {
        const fetchDomainSettings = async () => {
            try {
                const res = await fetch('/api/admin/domain');
                if (res.ok) {
                    const domainData = await res.json();
                    const th = domainData.theme || {};
                    setSettings({
                        name: domainData.name || '',
                        displayName: domainData.displayName || domainData.name || '',
                        logo: domainData.logo || '',
                        primaryColor: th.primaryColor || DEFAULT_SETTINGS.primaryColor,
                        secondaryColor: th.secondaryColor || DEFAULT_SETTINGS.secondaryColor,
                        backgroundColor: th.backgroundColor || DEFAULT_SETTINGS.backgroundColor,
                        textColor: th.textColor || DEFAULT_SETTINGS.textColor,
                        accentColor: th.accentColor || DEFAULT_SETTINGS.accentColor,
                        mutedColor: th.mutedColor || DEFAULT_SETTINGS.mutedColor,
                        borderColor: th.borderColor || DEFAULT_SETTINGS.borderColor,
                        cardColor: th.cardColor || DEFAULT_SETTINGS.cardColor,
                        inputColor: th.inputColor || '',
                        ringColor: th.ringColor || '',
                        titleFont: th.titleFont || 'Inter',
                        bodyFont: th.bodyFont || 'Inter',
                    });
                }
            } catch (error) {
                console.error('Failed to fetch domain settings', error);
            }
        };

        fetchDomainSettings();
    }, []);

    const fetchUsers = useCallback(async () => {
        setUsersLoading(true);
        setUsersError(false);
        try {
            const res = await fetch('/api/admin/users');
            if (res.ok) {
                const data = await res.json();
                setUsers(Array.isArray(data) ? data : []);
            } else {
                setUsersError(true);
            }
        } catch (error) {
            console.error('Failed to fetch users', error);
            setUsersError(true);
        } finally {
            setUsersLoading(false);
        }
    }, []);

    const fetchPublicExtensions = useCallback(async () => {
        setLoadingExtensions(true);
        setCatalogError(false);
        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'https://backend.bloomx.arubik.dev'}/api/admin/extensions/public-list`);
            if (res.ok) {
                const data = await res.json();
                setAvailableExtensions(Array.isArray(data) ? data : []);
            } else {
                setCatalogError(true);
            }
        } catch (error) {
            console.error('Failed to fetch extensions', error);
            setCatalogError(true);
        } finally {
            setLoadingExtensions(false);
        }
    }, []);

    useEffect(() => {
        if (activeTab === 'users') void fetchUsers();
        if (activeTab === 'extensions') void fetchPublicExtensions();
    }, [activeTab, fetchUsers, fetchPublicExtensions]);

    const refreshDomainConfig = async () => {
        await mutateSWR('/api/config');
        router.refresh();
    };

    const handleCreateUser = async (e: React.FormEvent) => {
        e.preventDefault();
        setCreatingUser(true);
        try {
            const res = await fetch('/api/admin/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newUser)
            });
            if (res.ok) {
                setNewUser({ email: '', name: '', password: '' });
                void fetchUsers();
                toast.success(t('admin.users.created'));
            } else {
                const err = await res.json().catch(() => ({}));
                toast.error(err.error || t('admin.users.createFailed'));
            }
        } catch (error) {
            console.error('Failed to create user', error);
            toast.error(t('admin.users.createFailed'));
        } finally {
            setCreatingUser(false);
        }
    };

    const themeConfig = useMemo<DomainThemeConfig>(() => {
        const cfg: Record<string, string> = {};
        for (const f of COLOR_FIELDS) if (settings[f.key]) cfg[f.key] = settings[f.key];
        return { ...cfg, titleFont: settings.titleFont, bodyFont: settings.bodyFont } as DomainThemeConfig;
    }, [settings]);

    const brandIssues = useMemo(() => analyzeBrand(themeConfig), [themeConfig]);
    const brandWarnings = brandIssues.filter((i) => !i.ok);
    const invalidFields = COLOR_FIELDS.filter((f) => settings[f.key] && !normalizeHex(settings[f.key]));

    const handleSaveSettings = async (e: React.FormEvent) => {
        e.preventDefault();
        if (invalidFields.length > 0) {
            toast.error(t('admin.settings.invalidHex'));
            return;
        }
        setSavingSettings(true);
        try {
            const theme: Record<string, string | undefined> = {};
            for (const f of COLOR_FIELDS) {
                const v = normalizeHex(settings[f.key]);
                theme[f.key] = v ?? undefined;
            }
            theme.titleFont = settings.titleFont;
            theme.bodyFont = settings.bodyFont;
            const res = await fetch('/api/admin/domain', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    // name: settings.name, // Do NOT send name
                    displayName: settings.displayName,
                    logo: settings.logo,
                    theme,
                })
            });

            if (res.ok) {
                toast.success(t('admin.settings.saved'));
                await refreshDomainConfig();
            } else {
                toast.error(t('admin.settings.saveFailed'));
            }
        } catch (err) {
            console.error(err);
            toast.error(t('admin.settings.saveFailed'));
        } finally {
            setSavingSettings(false);
        }
    };

    const isInstalled = (extId: string) => {
        return installedExtensions.some((e: any) => e.id === extId || e.extensionId === extId);
    };

    const handleInstall = async (ext: Extension) => {
        setExtensionActionId(ext.id);

        if (ext.isPaid && !isInstalled(ext.id)) {
            try {
                const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'https://backend.bloomx.arubik.dev'}/api/payments/create-preference`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        domainId: domainConfig?.id,
                        extensionId: ext.id,
                        redirectUrl: window.location.href
                    })
                });
                const pref = await res.json();
                if (pref.init_point) {
                    window.location.href = pref.init_point;
                    return;
                } else {
                    toast.error(pref.error || t('admin.extensions.paymentFailed'));
                }
            } catch (e) {
                console.error('Payment error', e);
                toast.error(t('admin.extensions.paymentFailed'));
            } finally {
                setExtensionActionId(null);
            }
            return;
        }

        try {
            const res = await fetch('/api/admin/extensions/install', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    domainId: domainConfig?.id,
                    extensionId: ext.id
                })
            });

            const result = await res.json().catch(() => ({}));
            if (res.ok) {
                toast.success(t('admin.extensions.installedOk'));
                await refreshDomainConfig();
            } else {
                toast.error(result.error || t('admin.extensions.installFailed'));
            }
        } catch (e) {
            console.error('Install fatal error', e);
            toast.error(t('admin.extensions.installFailed'));
        } finally {
            setExtensionActionId(null);
        }
    };

    const handleUninstall = async (ext: { id?: string; extensionId?: string; name?: string }) => {
        const extensionId = ext.extensionId || ext.id;
        if (!extensionId || !domainConfig?.id) return;

        setExtensionActionId(extensionId);

        try {
            const res = await fetch('/api/admin/extensions/uninstall', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    domainId: domainConfig.id,
                    extensionId,
                })
            });

            const result = await res.json().catch(() => ({}));
            if (res.ok) {
                toast.success(t('admin.extensions.uninstalled'));
                await refreshDomainConfig();
            } else {
                toast.error(result.error || t('admin.extensions.uninstallFailed'));
            }
        } catch (e) {
            console.error('Uninstall fatal error', e);
            toast.error(t('admin.extensions.uninstallFailed'));
        } finally {
            setExtensionActionId(null);
            setUninstallTarget(null);
        }
    };

    const requiredEnvVars = inferRequiredEnvVars(selectedExtension);

    const filteredUsers = useMemo(() => {
        const q = userQuery.trim().toLowerCase();
        if (!q) return users;
        return users.filter((u: any) => `${u.name || ''} ${u.email || ''}`.toLowerCase().includes(q));
    }, [users, userQuery]);

    if (configLoading) {
        return <div className="min-h-screen flex items-center justify-center" role="status" aria-label={t('common.loading')}><Loader2 className="animate-spin h-8 w-8 text-primary" /></div>;
    }

    const brandName = settings.displayName || settings.name || t('admin.brandFallback');
    const sectionName = t(`admin.sectionNames.${activeTab}`);

    const navButtons = (
        <>
            {TABS.map(({ id, icon: Icon }) => {
                const active = activeTab === id;
                return (
                    <button
                        key={id}
                        type="button"
                        onClick={() => setActiveTab(id)}
                        aria-current={active ? 'page' : undefined}
                        className={`flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors whitespace-nowrap md:w-full ${active
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                            }`}
                    >
                        <Icon className="w-5 h-5" aria-hidden="true" />
                        {t(`admin.nav.${id}`)}
                    </button>
                );
            })}
        </>
    );

    const brandMark = (
        <div className="flex items-center gap-3 min-w-0">
            {settings.logo ? (
                <img src={settings.logo} alt="" className="w-8 h-8 rounded-md object-cover shrink-0" />
            ) : (
                <div
                    className="w-8 h-8 rounded-md flex items-center justify-center font-bold shrink-0"
                    style={{ backgroundColor: normalizeHex(settings.primaryColor) ?? '#000000', color: agendaTextOn(settings.primaryColor) }}
                    aria-hidden="true"
                >
                    {brandName.charAt(0).toUpperCase()}
                </div>
            )}
            <span className="font-bold text-foreground truncate">{brandName}</span>
        </div>
    );

    return (
        <div className="min-h-screen bg-muted/50 md:flex">
            {/* Barra superior (movil) */}
            <header className="md:hidden sticky top-0 z-20 bg-background border-b border-border">
                <div className="px-4 py-3">{brandMark}</div>
                <nav aria-label={t('admin.nav.label')} className="flex gap-1 overflow-x-auto px-3 pb-2">
                    {navButtons}
                </nav>
            </header>

            {/* Sidebar (escritorio) */}
            <aside className="hidden md:flex w-64 bg-background border-r border-border fixed h-full z-10 flex-col">
                <div className="p-6 border-b border-border/60">{brandMark}</div>
                <div className="flex-1 overflow-y-auto py-4">
                    <nav aria-label={t('admin.nav.label')} className="px-4 space-y-1">
                        {navButtons}
                    </nav>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 min-w-0 md:ml-64 p-4 sm:p-6 md:p-8">
                <header className="mb-6 md:mb-8">
                    <h1 className="text-2xl font-bold text-foreground">
                        {t(`admin.heading.${activeTab}`)}
                    </h1>
                    <p className="text-muted-foreground mt-1">{t('admin.subheading', { section: sectionName, domain: settings.displayName || settings.name })}</p>
                </header>

                {activeTab === 'extensions' && (
                    <div className="space-y-6">
                        <section aria-labelledby={`${uid}-installed`}>
                            <h2 id={`${uid}-installed`} className="text-lg font-semibold text-foreground mb-4">{t('admin.extensions.installed')}</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                                {installedExtensions.map((ext: any) => {
                                    const busy = extensionActionId === (ext.extensionId || ext.id);
                                    return (
                                        <div key={ext.extensionId || ext.id} className="bg-card p-6 rounded-xl border border-border shadow-sm hover:shadow-md transition-shadow">
                                            <div className="flex items-start justify-between mb-4">
                                                <div className="p-3 bg-primary/10 rounded-lg">
                                                    <Puzzle className="w-6 h-6 text-primary" aria-hidden="true" />
                                                </div>
                                                <span className="px-2 py-1 bg-success/10 text-success text-xs font-medium rounded-full border border-success/30">
                                                    {t('admin.extensions.active')}
                                                </span>
                                            </div>
                                            <h3 className="font-semibold text-foreground mb-1">{ext.name}</h3>
                                            <p className="text-sm text-muted-foreground mb-4">{ext.description || t('admin.extensions.noDescription')}</p>
                                            <div className="flex flex-wrap gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedExtension(buildExtensionDetails(ext as Extension))}
                                                    className="flex-1 py-2 px-4 border border-border text-muted-foreground rounded-lg text-sm font-medium hover:bg-accent hover:text-accent-foreground"
                                                >
                                                    {t('admin.extensions.details')}
                                                </button>
                                                {declaredCredentialKeys(ext.template).length > 0 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setCredentialsTarget({ id: ext.extensionId || ext.id, name: ext.name })}
                                                        aria-label={t('admin.extensions.credentials.buttonLabel', { name: ext.name })}
                                                        className="inline-flex items-center gap-1.5 py-2 px-4 border border-border text-muted-foreground rounded-lg text-sm font-medium hover:bg-accent hover:text-accent-foreground"
                                                    >
                                                        <KeyRound className="w-4 h-4" aria-hidden="true" />
                                                        {t('admin.extensions.credentials.button')}
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => setUninstallTarget(ext)}
                                                    disabled={busy}
                                                    className="py-2 px-4 border border-destructive/30 text-destructive rounded-lg text-sm font-medium hover:bg-destructive/10 disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {busy ? '...' : t('admin.extensions.uninstall')}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                                {installedExtensions.length === 0 && (
                                    <div className="md:col-span-2 lg:col-span-3 text-center py-8 bg-card rounded-xl border border-dashed border-input">
                                        <Puzzle className="w-12 h-12 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
                                        <p className="text-muted-foreground font-medium">{t('admin.extensions.none')}</p>
                                        <p className="text-muted-foreground text-sm">{t('admin.extensions.browseBelow')}</p>
                                    </div>
                                )}
                            </div>
                        </section>

                        <section className="pt-8 border-t border-border" aria-labelledby={`${uid}-catalog`}>
                            <h2 id={`${uid}-catalog`} className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                                <Search className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
                                {t('admin.extensions.catalog')}
                            </h2>
                            {loadingExtensions ? (
                                <div className="py-12 text-center" role="status" aria-label={t('common.loading')}><Loader2 className="animate-spin h-8 w-8 mx-auto text-primary" /></div>
                            ) : catalogError ? (
                                <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                                    <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                                    <span>{t('admin.extensions.catalogError')}</span>
                                    <button type="button" onClick={() => void fetchPublicExtensions()} className="ml-auto rounded-md border border-destructive/40 px-3 py-1 font-medium hover:bg-destructive/10">
                                        {t('admin.extensions.retry')}
                                    </button>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                                    {availableExtensions.map(ext => (
                                        <div key={ext.id} className="bg-card rounded-lg border border-border shadow-sm p-6 flex flex-col transition-all hover:shadow-md">
                                            <div className="flex justify-between items-start mb-2 gap-2">
                                                <h3 className="font-bold text-foreground line-clamp-1">{ext.name}</h3>
                                                {ext.isPaid && (
                                                    <span className="text-xs font-medium bg-success/15 text-success px-2 py-0.5 rounded whitespace-nowrap">
                                                        {ext.price} {ext.currency}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-muted-foreground text-sm mb-4 line-clamp-2 flex-1">{ext.description}</p>

                                            <div className="mt-auto pt-4 flex items-center justify-between border-t border-border/60">
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedExtension(buildExtensionDetails(ext))}
                                                    className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs min-h-[36px]"
                                                >
                                                    <Info className="w-3 h-3" aria-hidden="true" /> {t('admin.extensions.details')}
                                                </button>

                                                {!isInstalled(ext.id) && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleInstall(ext)}
                                                        disabled={extensionActionId === ext.id}
                                                        className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50"
                                                    >
                                                        {extensionActionId === ext.id ? t('admin.extensions.working') : ext.isPaid ? t('admin.extensions.buyInstall') : t('admin.extensions.install')}
                                                    </button>
                                                )}
                                                {isInstalled(ext.id) && (
                                                    <span className="bg-muted text-muted-foreground px-4 py-2 rounded-lg text-sm font-medium">
                                                        {t('admin.extensions.installedBadge')}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    </div>
                )}

                {activeTab === 'users' && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
                        <div className="lg:col-span-2 space-y-6">
                            <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
                                <div className="p-4 sm:p-6 border-b border-border/60 flex flex-wrap gap-3 justify-between items-center">
                                    <h2 className="text-lg font-semibold text-foreground">{t('admin.users.all')}</h2>
                                    <div className="relative w-full sm:w-64">
                                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                                        <input
                                            type="search"
                                            value={userQuery}
                                            onChange={(e) => setUserQuery(e.target.value)}
                                            placeholder={t('admin.users.searchPlaceholder')}
                                            aria-label={t('admin.users.searchLabel')}
                                            className="w-full pl-9 pr-4 py-2 border border-input bg-background text-foreground rounded-lg text-sm focus:ring-2 focus:ring-ring outline-none"
                                        />
                                    </div>
                                </div>
                                {usersLoading ? (
                                    <div className="p-8 text-center" role="status" aria-label={t('common.loading')}><Loader2 className="animate-spin h-6 w-6 mx-auto text-primary" /></div>
                                ) : usersError ? (
                                    <div role="alert" className="p-6 text-sm text-destructive flex items-center gap-3">
                                        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                                        {t('admin.users.loadFailed')}
                                        <button type="button" onClick={() => void fetchUsers()} className="ml-auto rounded-md border border-destructive/40 px-3 py-1 font-medium hover:bg-destructive/10">
                                            {t('admin.extensions.retry')}
                                        </button>
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full min-w-[480px]">
                                            <thead className="bg-muted/50 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                                <tr>
                                                    <th scope="col" className="px-4 sm:px-6 py-3">{t('admin.users.colUser')}</th>
                                                    <th scope="col" className="px-4 sm:px-6 py-3">{t('admin.users.colEmail')}</th>
                                                    <th scope="col" className="px-4 sm:px-6 py-3">{t('admin.users.colJoined')}</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border/60">
                                                {filteredUsers.map((user: any) => (
                                                    <tr key={user.id} className="hover:bg-muted/50">
                                                        <td className="px-4 sm:px-6 py-4">
                                                            <div className="flex items-center gap-3">
                                                                <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center text-primary font-bold text-xs uppercase shrink-0" aria-hidden="true">
                                                                    {user.name?.[0] || user.email?.[0]}
                                                                </div>
                                                                <span className="font-medium text-foreground">{user.name || t('admin.users.unnamed')}</span>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 sm:px-6 py-4 text-sm text-muted-foreground">{user.email}</td>
                                                        <td className="px-4 sm:px-6 py-4 text-sm text-muted-foreground whitespace-nowrap">
                                                            {new Date(user.createdAt).toLocaleDateString(intlLocale)}
                                                        </td>
                                                    </tr>
                                                ))}
                                                {filteredUsers.length === 0 && (
                                                    <tr>
                                                        <td colSpan={3} className="px-6 py-8 text-center text-muted-foreground">
                                                            {users.length === 0 ? t('admin.users.empty') : t('admin.users.noMatches')}
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="lg:col-span-1">
                            <div className="bg-card rounded-xl border border-border shadow-sm p-6 lg:sticky lg:top-8">
                                <h2 className="text-lg font-semibold text-foreground mb-4">{t('admin.users.createTitle')}</h2>
                                <form onSubmit={handleCreateUser} className="space-y-4">
                                    <div>
                                        <label htmlFor={`${uid}-u-name`} className="block text-sm font-medium text-foreground mb-1">{t('admin.users.fullName')}</label>
                                        <input
                                            id={`${uid}-u-name`}
                                            type="text"
                                            required
                                            autoComplete="off"
                                            className={fieldClass}
                                            value={newUser.name}
                                            onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                                            placeholder="Jane Doe"
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor={`${uid}-u-email`} className="block text-sm font-medium text-foreground mb-1">{t('admin.users.email')}</label>
                                        <input
                                            id={`${uid}-u-email`}
                                            type="email"
                                            required
                                            autoComplete="off"
                                            className={fieldClass}
                                            value={newUser.email}
                                            onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                                            placeholder="jane@company.com"
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor={`${uid}-u-pass`} className="block text-sm font-medium text-foreground mb-1">{t('admin.users.password')}</label>
                                        <input
                                            id={`${uid}-u-pass`}
                                            type="password"
                                            required
                                            minLength={8}
                                            autoComplete="new-password"
                                            className={fieldClass}
                                            value={newUser.password}
                                            onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                                            placeholder={t('admin.users.passwordPlaceholder')}
                                        />
                                    </div>
                                    <button
                                        type="submit"
                                        disabled={creatingUser}
                                        className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50"
                                    >
                                        {creatingUser ? <Loader2 className="animate-spin w-4 h-4" aria-hidden="true" /> : <Plus className="w-4 h-4" aria-hidden="true" />}
                                        {t('admin.users.create')}
                                    </button>
                                </form>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'settings' && (
                    <div className="flex flex-col xl:flex-row gap-6 xl:gap-8">
                        {/* Left: Form */}
                        <div className="flex-1 max-w-2xl">
                            <div className="bg-card rounded-xl border border-border shadow-sm p-4 sm:p-8">
                                <h2 className="text-xl font-semibold text-foreground mb-6">{t('admin.settings.general')}</h2>
                                <form onSubmit={handleSaveSettings} className="space-y-6" noValidate>

                                    {/* Technical Domain */}
                                    <div>
                                        <label htmlFor={`${uid}-s-domain`} className="block text-sm font-medium text-foreground mb-2">
                                            {t('admin.settings.serverDomain')}
                                        </label>
                                        <div className="flex items-center gap-2 relative">
                                            <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                                            <input
                                                id={`${uid}-s-domain`}
                                                type="text"
                                                value={settings.name}
                                                readOnly
                                                className="w-full pl-9 pr-4 py-2 border border-border bg-muted text-muted-foreground rounded-lg outline-none cursor-not-allowed"
                                            />
                                        </div>
                                    </div>

                                    {/* Public Name */}
                                    <div>
                                        <label htmlFor={`${uid}-s-name`} className="block text-sm font-medium text-foreground mb-2">
                                            {t('admin.settings.publicName')}
                                        </label>
                                        <input
                                            id={`${uid}-s-name`}
                                            type="text"
                                            value={settings.displayName}
                                            onChange={(e) => setSettings({ ...settings, displayName: e.target.value })}
                                            className={fieldClass}
                                        />
                                    </div>

                                    <div>
                                        <label htmlFor={`${uid}-s-logo`} className="block text-sm font-medium text-foreground mb-2">{t('admin.settings.logoUrl')}</label>
                                        <input
                                            id={`${uid}-s-logo`}
                                            type="url"
                                            value={settings.logo}
                                            onChange={(e) => setSettings({ ...settings, logo: e.target.value })}
                                            className={fieldClass}
                                        />
                                    </div>

                                    <hr className="my-6 border-border/60" />

                                    <h3 className="text-lg font-medium text-foreground mb-4 flex items-center gap-2">
                                        <Palette className="w-5 h-5" aria-hidden="true" /> {t('admin.settings.themeConfig')}
                                    </h3>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                                        {(['titleFont', 'bodyFont'] as const).map((fk) => (
                                            <div key={fk}>
                                                <label htmlFor={`${uid}-${fk}`} className="block text-sm font-medium text-foreground mb-2">
                                                    {t(fk === 'titleFont' ? 'admin.settings.titleFont' : 'admin.settings.bodyFont')}
                                                </label>
                                                <select
                                                    id={`${uid}-${fk}`}
                                                    value={settings[fk] || 'Inter'}
                                                    onChange={(e) => setSettings({ ...settings, [fk]: e.target.value })}
                                                    className={fieldClass}
                                                >
                                                    {FONT_OPTIONS.map((f) => (
                                                        <option key={f} value={f}>{f === 'Inter' ? t('admin.settings.fontDefault') : f}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                        {COLOR_FIELDS.map((field) => {
                                            const key: ColorKey = field.key;
                                            const value = settings[key];
                                            const label = t(`admin.settings.colors.${field.label}`);
                                            const invalid = !!value && !normalizeHex(value);
                                            const optional = 'optional' in field && field.optional;
                                            return (
                                                <div key={key}>
                                                    <label htmlFor={`${uid}-${key}`} className="block text-sm font-medium text-foreground mb-2">
                                                        {label}
                                                        {optional && <span className="ml-1 text-xs font-normal text-muted-foreground">{t('common.optional')}</span>}
                                                    </label>
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="color"
                                                            value={normalizeHex(value) ?? '#000000'}
                                                            onChange={(e) => setSettings({ ...settings, [key]: e.target.value })}
                                                            aria-label={t('admin.settings.colorPicker', { name: label })}
                                                            className="h-10 w-12 p-1 rounded border border-input bg-background cursor-pointer"
                                                        />
                                                        <input
                                                            id={`${uid}-${key}`}
                                                            type="text"
                                                            value={value}
                                                            placeholder={optional ? 'auto' : '#000000'}
                                                            onChange={(e) => setSettings({ ...settings, [key]: e.target.value.trim() })}
                                                            aria-invalid={invalid || undefined}
                                                            aria-describedby={invalid ? `${uid}-${key}-err` : undefined}
                                                            spellCheck={false}
                                                            maxLength={7}
                                                            className={`flex-1 min-w-0 px-3 py-2 border rounded-lg text-sm bg-background text-foreground focus:ring-2 focus:ring-ring outline-none font-mono ${invalid ? 'border-destructive' : 'border-input'}`}
                                                        />
                                                        {optional && value && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setSettings({ ...settings, [key]: '' })}
                                                                aria-label={`${label}: auto`}
                                                                className="p-2 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                                                            >
                                                                <X className="h-4 w-4" aria-hidden="true" />
                                                            </button>
                                                        )}
                                                    </div>
                                                    {invalid && (
                                                        <p id={`${uid}-${key}-err`} role="alert" className="mt-1 text-xs text-destructive">{t('admin.settings.invalidHex')}</p>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Contraste de la marca (WCAG AA) */}
                                    <BrandContrastPanel
                                        issues={brandIssues}
                                        warnings={brandWarnings}
                                        onUseCorrected={(issue) => setSettings((prev) => ({ ...prev, [issue.field]: issue.applied }))}
                                    />

                                    <div className="pt-6 border-t border-border/60 flex justify-end">
                                        <button
                                            type="submit"
                                            disabled={savingSettings}
                                            className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50"
                                        >
                                            {savingSettings ? <Loader2 className="animate-spin w-4 h-4" aria-hidden="true" /> : <Save className="w-4 h-4" aria-hidden="true" />}
                                            {t('admin.settings.save')}
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>

                        {/* Right: Preview */}
                        <div className="flex-1 xl:max-w-md xl:sticky xl:top-8 h-fit">
                            <h3 className="text-lg font-semibold text-foreground mb-4">{t('admin.settings.livePreview')}</h3>
                            <ThemePreview settings={settings} />
                            <p className="mt-4 text-sm text-muted-foreground">
                                {t('admin.settings.previewNote')}
                            </p>
                        </div>
                    </div>
                )}
            </main>

            {/* Detalles de extension */}
            <Modal
                open={!!selectedExtension}
                onClose={() => setSelectedExtension(null)}
                panelClassName="w-full max-w-2xl rounded-2xl border border-border bg-card shadow-2xl"
            >
                {({ titleId }) => selectedExtension && (
                    <>
                        <div className="flex items-start justify-between px-6 py-5 border-b border-border/60">
                            <div className="min-w-0">
                                <h3 id={titleId} className="text-lg font-semibold text-foreground">{selectedExtension.name}</h3>
                                <p className="text-xs text-muted-foreground mt-1 break-all">{selectedExtension.id}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelectedExtension(null)}
                                className="rounded-lg p-2 text-muted-foreground hover:text-foreground hover:bg-muted"
                                aria-label={t('admin.extensions.detailsClose')}
                            >
                                <X className="w-4 h-4" aria-hidden="true" />
                            </button>
                        </div>

                        <div className="px-6 py-5 space-y-5 max-h-[75vh] overflow-y-auto">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div className="rounded-lg border border-border bg-muted/50 p-3">
                                    <div className="text-xs uppercase tracking-wider text-muted-foreground">{t('admin.extensions.version')}</div>
                                    <div className="text-sm font-medium text-foreground mt-1">{selectedExtension.version || normalizeTemplate(selectedExtension.template)?.version || t('admin.extensions.na')}</div>
                                </div>
                                <div className="rounded-lg border border-border bg-muted/50 p-3">
                                    <div className="text-xs uppercase tracking-wider text-muted-foreground">{t('admin.extensions.authType')}</div>
                                    <div className="text-sm font-medium text-foreground mt-1">{selectedExtension.authType || normalizeTemplate(selectedExtension.template)?.auth?.type || 'NONE'}</div>
                                </div>
                                <div className="rounded-lg border border-border bg-muted/50 p-3">
                                    <div className="text-xs uppercase tracking-wider text-muted-foreground">{t('admin.extensions.manifestVersion')}</div>
                                    <div className="text-sm font-medium text-foreground mt-1">{normalizeTemplate(selectedExtension.template)?.manifestVersion || t('admin.extensions.na')}</div>
                                </div>
                            </div>

                            <div>
                                <h4 className="text-sm font-semibold text-foreground">{t('admin.extensions.description')}</h4>
                                <p className="text-sm text-muted-foreground mt-1">{selectedExtension.description || t('admin.extensions.noDescriptionProvided')}</p>
                            </div>

                            <div>
                                <h4 className="text-sm font-semibold text-foreground">{t('admin.extensions.requiredEnv')}</h4>
                                <p className="text-xs text-muted-foreground mt-1">{t('admin.extensions.requiredEnvHelp')}</p>

                                {requiredEnvVars.length > 0 ? (
                                    <div className="mt-3 rounded-lg border border-border bg-muted/50 p-3">
                                        <div className="space-y-1 font-mono text-xs text-foreground">
                                            {requiredEnvVars.map((envVar) => (
                                                <div key={envVar}>{envVar}=</div>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="mt-3 rounded-lg border border-dashed border-input bg-muted/50 p-3 text-xs text-muted-foreground">
                                        {t('admin.extensions.noRequiredEnv')}
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </Modal>

            {/* Credenciales por dominio (ENV_READ del manifest; valores enmascarados, nunca se devuelven) */}
            <ExtensionCredentialsModal
                open={!!credentialsTarget}
                onClose={() => setCredentialsTarget(null)}
                domainId={domainConfig?.id}
                extension={credentialsTarget}
            />

            {/* Confirmar desinstalacion (reemplaza window.confirm) */}
            <Modal
                open={!!uninstallTarget}
                onClose={() => setUninstallTarget(null)}
                panelClassName="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl"
            >
                {({ titleId }) => uninstallTarget && (
                    <>
                        <h3 id={titleId} className="text-base font-semibold text-foreground">
                            {t('admin.extensions.uninstallConfirm', { name: uninstallTarget.name || t('admin.extensions.thisExtension') })}
                        </h3>
                        <p className="mt-2 text-sm text-muted-foreground">{t('admin.extensions.uninstallWipes')}</p>
                        <div className="mt-6 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setUninstallTarget(null)}
                                className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
                            >
                                {t('common.cancel')}
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleUninstall(uninstallTarget)}
                                disabled={extensionActionId !== null}
                                className="rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                            >
                                {t('admin.extensions.uninstall')}
                            </button>
                        </div>
                    </>
                )}
            </Modal>
        </div>
    );
}

/**
 * Aviso de contraste: applyBrand corrige en silencio los colores de marca que no cumplen AA.
 * Aqui se muestra que se elegio, que se aplicara (con vista previa del color) y un boton para adoptarlo.
 */
function BrandContrastPanel({
    issues,
    warnings,
    onUseCorrected,
}: {
    issues: BrandIssue[];
    warnings: BrandIssue[];
    onUseCorrected: (issue: BrandIssue) => void;
}) {
    const { t } = useI18n();
    if (issues.length === 0) return null;

    if (warnings.length === 0) {
        return (
            <div role="status" className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                {t('admin.settings.brandCheckOk')}
            </div>
        );
    }

    return (
        <div role="alert" className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
            <div className="flex items-start gap-2 font-medium text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{t('admin.settings.brandCheckTitle')}</span>
            </div>
            <p className="mt-1 text-foreground">{t('admin.settings.brandCheckWarn', { min: '4.5' })}</p>
            <ul className="mt-3 space-y-3">
                {warnings.map((issue) => (
                    <li key={issue.field} className="rounded-md border border-border bg-card p-3">
                        <div className="font-medium text-foreground">{issue.label}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1.5">
                                <span className="inline-block h-5 w-5 rounded border border-border" style={{ backgroundColor: issue.chosen }} aria-hidden="true" />
                                {t('admin.settings.chosen')} <code className="font-mono text-foreground">{issue.chosen}</code> ({issue.chosenRatio}:1)
                            </span>
                            <span aria-hidden="true">→</span>
                            <span className="flex items-center gap-1.5">
                                <span className="inline-block h-5 w-5 rounded border border-border" style={{ backgroundColor: issue.applied }} aria-hidden="true" />
                                {t('admin.settings.applied')} <code className="font-mono text-foreground">{issue.applied}</code> ({issue.appliedRatio}:1)
                            </span>
                            {issue.corrected && (
                                <button
                                    type="button"
                                    onClick={() => onUseCorrected(issue)}
                                    className="ml-auto rounded-md border border-border px-2.5 py-1 font-medium text-foreground hover:bg-accent hover:text-accent-foreground"
                                >
                                    {t('admin.settings.useCorrected')}
                                </button>
                            )}
                        </div>
                        <div
                            className="mt-3 rounded-md px-3 py-2 text-sm font-medium"
                            style={{ backgroundColor: issue.against, color: issue.applied }}
                        >
                            Aa — {issue.label}
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}
