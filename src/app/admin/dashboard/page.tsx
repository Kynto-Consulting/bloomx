
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    Users,
    Puzzle,
    Settings,
    Plus,
    Trash2,
    Loader2,
    Search,
    Save,
    LayoutDashboard,
    Globe,
    Info,
    Palette,
    Lock,
    X
} from 'lucide-react';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { ThemePreview } from '@/components/admin/ThemePreview';

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

export default function AdminDashboard() {
    const router = useRouter();
    const { config: domainConfig, extensions: installedExtensions, isLoading: configLoading } = useDomainConfig();

    const [activeTab, setActiveTab] = useState<'extensions' | 'users' | 'settings'>('extensions');

    // Users State
    const [users, setUsers] = useState<any[]>([]);
    const [usersLoading, setUsersLoading] = useState(false);
    const [newUser, setNewUser] = useState({ email: '', name: '', password: '' });
    const [creatingUser, setCreatingUser] = useState(false);

    // Extensions State
    const [availableExtensions, setAvailableExtensions] = useState<Extension[]>([]);
    const [loadingExtensions, setLoadingExtensions] = useState(false);
    const [extensionActionId, setExtensionActionId] = useState<string | null>(null);
    const [selectedExtension, setSelectedExtension] = useState<Extension | null>(null);

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
    const [settings, setSettings] = useState({
        name: '', // Technical Domain (Read-only)
        displayName: '', // Public Name (Editable)
        logo: '',
        primaryColor: '#000000',
        secondaryColor: '#ffffff',
        backgroundColor: '#f9fafb',
        textColor: '#111827',
        accentColor: '#d8d8e5ff',
        mutedColor: '#f3f4f6',
        borderColor: '#e5e7eb',
        cardColor: '#ffffff',
        titleFont: 'Inter',
        bodyFont: 'Inter'
    });
    const [savingSettings, setSavingSettings] = useState(false);

    useEffect(() => {
        const fetchDomainSettings = async () => {
            try {
                const res = await fetch('/api/admin/domain');
                if (res.ok) {
                    const domainData = await res.json();
                    setSettings({
                        name: domainData.name || '',
                        displayName: domainData.displayName || domainData.name || '',
                        logo: domainData.logo || '',
                        primaryColor: domainData.theme?.primaryColor || '#000000',
                        secondaryColor: domainData.theme?.secondaryColor || '#ffffff',
                        backgroundColor: domainData.theme?.backgroundColor || '#f9fafb',
                        textColor: domainData.theme?.textColor || '#111827',
                        accentColor: domainData.theme?.accentColor || '#4f46e5',
                        mutedColor: domainData.theme?.mutedColor || '#f3f4f6',
                        borderColor: domainData.theme?.borderColor || '#e5e7eb',
                        cardColor: domainData.theme?.cardColor || '#ffffff',
                        titleFont: domainData.theme?.titleFont || 'Inter',
                        bodyFont: domainData.theme?.bodyFont || 'Inter'
                    });
                }
            } catch (error) {
                console.error("Failed to fetch domain settings", error);
            }
        };

        fetchDomainSettings();
    }, []);





    useEffect(() => {
        if (activeTab === 'users') fetchUsers();
        if (activeTab === 'extensions') fetchPublicExtensions();
    }, [activeTab]);

    const fetchUsers = async () => {
        setUsersLoading(true);
        try {
            const res = await fetch('/api/admin/users');
            if (res.ok) {
                const data = await res.json();
                setUsers(data);
            }
        } catch (error) {
            console.error("Failed to fetch users", error);
        } finally {
            setUsersLoading(false);
        }
    };

    const fetchPublicExtensions = async () => {
        setLoadingExtensions(true);
        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'https://backend.bloomx.arubik.dev'}/api/admin/extensions/public-list`);
            if (res.ok) {
                const data = await res.json();
                setAvailableExtensions(data);
            }
        } catch (error) {
            console.error("Failed to fetch extensions", error);
        } finally {
            setLoadingExtensions(false);
        }
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
                fetchUsers();
                alert("User created successfully");
            } else {
                const err = await res.json();
                alert(`Error: ${err.error}`);
            }
        } catch (error) {
            console.error("Failed to create user", error);
        } finally {
            setCreatingUser(false);
        }
    };

    const handleSaveSettings = async (e: React.FormEvent) => {
        e.preventDefault();
        setSavingSettings(true);
        try {
            const res = await fetch('/api/admin/domain', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    // name: settings.name, // Do NOT send name
                    displayName: settings.displayName,
                    logo: settings.logo,
                    theme: {
                        primaryColor: settings.primaryColor,
                        secondaryColor: settings.secondaryColor,
                        backgroundColor: settings.backgroundColor,
                        textColor: settings.textColor,
                        accentColor: settings.accentColor,
                        mutedColor: settings['mutedColor' as keyof typeof settings],
                        borderColor: settings['borderColor' as keyof typeof settings],
                        cardColor: settings['cardColor' as keyof typeof settings],
                        titleFont: settings['titleFont' as keyof typeof settings],
                        bodyFont: settings['bodyFont' as keyof typeof settings]
                    }
                })
            });

            if (res.ok) {
                alert("Settings saved successfully! Please refresh to see changes.");
                window.location.reload();
            } else {
                alert("Failed to save settings");
            }
        } catch (e) {
            console.error(e);
            alert("Error saving settings");
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
                    alert(pref.error || "Payment initialization failed");
                }
            } catch (e) {
                console.error("Payment error", e);
                alert("Payment initialization failed");
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

            const result = await res.json();
            if (res.ok) {
                alert("Extension installed successfully!");
                window.location.reload();
            } else {
                alert(result.error || "Installation failed");
            }
        } catch (e) {
            console.error("Install fatal error", e);
            alert("Installation failed");
        } finally {
            setExtensionActionId(null);
        }
    };

    const handleUninstall = async (ext: { id?: string; extensionId?: string; name?: string }) => {
        const extensionId = ext.extensionId || ext.id;
        if (!extensionId || !domainConfig?.id) return;

        const confirmed = window.confirm(`Uninstall ${ext.name || 'this extension'}?`);
        if (!confirmed) return;

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

            const result = await res.json();
            if (res.ok) {
                alert('Extension uninstalled successfully!');
                window.location.reload();
            } else {
                alert(result.error || 'Uninstall failed');
            }
        } catch (e) {
            console.error('Uninstall fatal error', e);
            alert('Uninstall failed');
        } finally {
            setExtensionActionId(null);
        }
    };

    const requiredEnvVars = inferRequiredEnvVars(selectedExtension);

    if (configLoading) {
        return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin h-8 w-8 text-primary" /></div>;
    }

    return (
        <div className="min-h-screen bg-muted/50 flex">
            {/* Sidebar */}
            <aside className="w-64 bg-background border-r border-border fixed h-full z-10 flex flex-col">
                <div className="p-6 border-b border-border/60">
                    <div className="flex items-center gap-3">
                        {settings.logo ? (
                            <img src={settings.logo} alt="Logo" className="w-8 h-8 rounded-md object-cover" />
                        ) : (
                            <div
                                className="w-8 h-8 rounded-md flex items-center justify-center text-white font-bold"
                                style={{ backgroundColor: settings.primaryColor }}
                            >
                                {settings.displayName ? settings.displayName.charAt(0) : 'B'}
                            </div>
                        )}
                        <span className="font-bold text-foreground truncate">{settings.displayName || settings.name || 'BloomX'}</span>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto py-4">
                    <nav className="px-4 space-y-1">
                        <button
                            onClick={() => setActiveTab('extensions')}
                            className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${activeTab === 'extensions'
                                ? 'bg-primary/10 text-primary'
                                : 'text-muted-foreground hover:bg-muted/50'
                                }`}
                        >
                            <Puzzle className="w-5 h-5" />
                            Extensions
                        </button>
                        <button
                            onClick={() => setActiveTab('users')}
                            className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${activeTab === 'users'
                                ? 'bg-primary/10 text-primary'
                                : 'text-muted-foreground hover:bg-muted/50'
                                }`}
                        >
                            <Users className="w-5 h-5" />
                            Users
                        </button>
                        <button
                            onClick={() => setActiveTab('settings')}
                            className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${activeTab === 'settings'
                                ? 'bg-primary/10 text-primary'
                                : 'text-muted-foreground hover:bg-muted/50'
                                }`}
                        >
                            <Settings className="w-5 h-5" />
                            Settings
                        </button>
                    </nav>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 ml-64 p-8">
                <header className="mb-8">
                    <h1 className="text-2xl font-bold text-foreground capitalize">
                        {activeTab} Management
                    </h1>
                    <p className="text-muted-foreground mt-1">Manage your {activeTab} for {settings.displayName}</p>
                </header>

                {activeTab === 'extensions' && (
                    <div className="space-y-6">
                        <section>
                            <h2 className="text-lg font-semibold text-foreground mb-4">Installed Extensions</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {installedExtensions.map((ext: any) => (
                                    <div key={ext.extensionId || ext.id} className="bg-card p-6 rounded-xl border border-border shadow-sm hover:shadow-md transition-shadow">
                                        <div className="flex items-start justify-between mb-4">
                                            <div className="p-3 bg-primary/10 rounded-lg">
                                                <Puzzle className="w-6 h-6 text-primary" />
                                            </div>
                                            <span className="px-2 py-1 bg-success/10 text-success text-xs font-medium rounded-full border border-success/30">
                                                Active
                                            </span>
                                        </div>
                                        <h3 className="font-semibold text-foreground mb-1">{ext.name}</h3>
                                        <p className="text-sm text-muted-foreground mb-4">{ext.description || "No description"}</p>
                                        <div className="flex gap-2">
                                            <button className="flex-1 py-2 px-4 border border-border text-muted-foreground rounded-lg text-sm font-medium hover:bg-muted/50 disabled:opacity-50">
                                                Configure
                                            </button>
                                            <button
                                                onClick={() => handleUninstall(ext)}
                                                disabled={extensionActionId === (ext.extensionId || ext.id)}
                                                className="py-2 px-4 border border-destructive/30 text-destructive rounded-lg text-sm font-medium hover:bg-destructive/10 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {extensionActionId === (ext.extensionId || ext.id) ? '...' : 'Uninstall'}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                {installedExtensions.length === 0 && (
                                    <div className="col-span-3 text-center py-8 bg-card rounded-xl border border-dashed border-input">
                                        <Puzzle className="w-12 h-12 text-muted-foreground/60 mx-auto mb-3" />
                                        <p className="text-muted-foreground font-medium">No extensions installed.</p>
                                        <p className="text-muted-foreground text-sm">Browse available extensions below.</p>
                                    </div>
                                )}
                            </div>
                        </section>

                        <section className="pt-8 border-t border-border">
                            <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                                <Search className="w-5 h-5 text-muted-foreground" />
                                Browse Catalog
                            </h2>
                            {loadingExtensions ? (
                                <div className="py-12 text-center"><Loader2 className="animate-spin h-8 w-8 mx-auto text-primary" /></div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {availableExtensions.map(ext => (
                                        <div key={ext.id} className="bg-card rounded-lg border shadow-sm p-6 flex flex-col transition-all hover:shadow-md">
                                            <div className="flex justify-between items-start mb-2">
                                                <h3 className="font-bold text-foreground line-clamp-1">{ext.name}</h3>
                                                {ext.isPaid && (
                                                    <span className="text-xs font-medium bg-success/15 text-success px-2 py-0.5 rounded">
                                                        {ext.price} {ext.currency}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-muted-foreground text-sm mb-4 line-clamp-2 flex-1">{ext.description}</p>

                                            <div className="mt-auto pt-4 flex items-center justify-between border-t border-border/60">
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedExtension(buildExtensionDetails(ext))}
                                                    className="text-muted-foreground hover:text-muted-foreground flex items-center gap-1 text-xs"
                                                >
                                                    <Info className="w-3 h-3" /> Details
                                                </button>

                                                {!isInstalled(ext.id) && (
                                                    <button
                                                        onClick={() => handleInstall(ext)}
                                                        disabled={extensionActionId === ext.id}
                                                        className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm"
                                                    >
                                                        {extensionActionId === ext.id ? 'Working...' : ext.isPaid ? 'Buy & Install' : 'Install'}
                                                    </button>
                                                )}
                                                {isInstalled(ext.id) && (
                                                    <button disabled className="bg-muted text-muted-foreground px-4 py-2 rounded-lg text-sm font-medium cursor-not-allowed">
                                                        Installed
                                                    </button>
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
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <div className="lg:col-span-2 space-y-6">
                            <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
                                <div className="p-6 border-b border-border/60 flex justify-between items-center">
                                    <h2 className="text-lg font-semibold text-foreground">All Users</h2>
                                    <div className="relative">
                                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                        <input
                                            type="text"
                                            placeholder="Search users..."
                                            className="pl-9 pr-4 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-ring focus:border-transparent outline-none w-64"
                                        />
                                    </div>
                                </div>
                                {usersLoading ? (
                                    <div className="p-8 text-center"><Loader2 className="animate-spin h-6 w-6 mx-auto text-primary" /></div>
                                ) : (
                                    <table className="w-full">
                                        <thead className="bg-muted/50 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                            <tr>
                                                <th className="px-6 py-3">User</th>
                                                <th className="px-6 py-3">Email</th>
                                                <th className="px-6 py-3">Joined</th>
                                                <th className="px-6 py-3 text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border/60">
                                            {users.map((user: any) => (
                                                <tr key={user.id} className="hover:bg-muted/50">
                                                    <td className="px-6 py-4">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center text-primary font-bold text-xs uppercase">
                                                                {user.name?.[0] || user.email[0]}
                                                            </div>
                                                            <span className="font-medium text-foreground">{user.name || 'Unnamed'}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 text-sm text-muted-foreground">{user.email}</td>
                                                    <td className="px-6 py-4 text-sm text-muted-foreground">
                                                        {new Date(user.createdAt).toLocaleDateString()}
                                                    </td>
                                                    <td className="px-6 py-4 text-right">
                                                        <button className="text-muted-foreground hover:text-destructive transition-colors">
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                            {users.length === 0 && (
                                                <tr>
                                                    <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">
                                                        No users found. Create one to get started.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>

                        <div className="lg:col-span-1">
                            <div className="bg-background rounded-xl border border-border shadow-sm p-6 sticky top-8">
                                <h2 className="text-lg font-semibold text-foreground mb-4">Create New User</h2>
                                <form onSubmit={handleCreateUser} className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-foreground/80 mb-1">Full Name</label>
                                        <input
                                            type="text"
                                            required
                                            className="w-full px-4 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-ring focus:border-transparent outline-none"
                                            value={newUser.name}
                                            onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                                            placeholder="Jane Doe"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-foreground/80 mb-1">Email Address</label>
                                        <input
                                            type="email"
                                            required
                                            className="w-full px-4 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-ring focus:border-transparent outline-none"
                                            value={newUser.email}
                                            onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                                            placeholder="jane@company.com"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-foreground/80 mb-1">Password</label>
                                        <input
                                            type="password"
                                            required
                                            className="w-full px-4 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-ring focus:border-transparent outline-none"
                                            value={newUser.password}
                                            onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                                            placeholder="Min 8 characters"
                                        />
                                    </div>
                                    <button
                                        type="submit"
                                        disabled={creatingUser}
                                        className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50"
                                    >
                                        {creatingUser ? <Loader2 className="animate-spin w-4 h-4" /> : <Plus className="w-4 h-4" />}
                                        Create User
                                    </button>
                                </form>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'settings' && (
                    <div className="flex flex-col xl:flex-row gap-8">
                        {/* Left: Form */}
                        <div className="flex-1 max-w-2xl">
                            <div className="bg-card rounded-xl border border-border shadow-sm p-8">
                                <h2 className="text-xl font-semibold text-foreground mb-6">General Settings</h2>
                                <form onSubmit={handleSaveSettings} className="space-y-6">

                                    {/* Technical Domain */}
                                    <div>
                                        <label className="block text-sm font-medium text-foreground/80 mb-2">
                                            Server Domain (Immutable)
                                        </label>
                                        <div className="flex items-center gap-2 relative">
                                            <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                            <input
                                                type="text"
                                                value={settings.name}
                                                readOnly
                                                className="w-full pl-9 pr-4 py-2 border border-border bg-muted/50 text-muted-foreground rounded-lg outline-none cursor-not-allowed"
                                            />
                                        </div>
                                    </div>

                                    {/* Public Name */}
                                    <div>
                                        <label className="block text-sm font-medium text-foreground/80 mb-2">
                                            Public Name
                                        </label>
                                        <input
                                            type="text"
                                            value={settings.displayName}
                                            onChange={(e) => setSettings({ ...settings, displayName: e.target.value })}
                                            className="w-full px-4 py-2 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-primary outline-none"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-foreground/80 mb-2">Logo URL</label>
                                        <input
                                            type="url"
                                            value={settings.logo}
                                            onChange={(e) => setSettings({ ...settings, logo: e.target.value })}
                                            className="w-full px-4 py-2 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-primary outline-none"
                                        />
                                    </div>

                                    <hr className="my-6 border-border/60" />

                                    <h3 className="text-lg font-medium text-foreground mb-4 flex items-center gap-2">
                                        <Palette className="w-5 h-5" /> Theme Configuration
                                    </h3>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                                        <div>
                                            <label className="block text-sm font-medium text-foreground/80 mb-2">Title Font</label>
                                            <select
                                                value={(settings as any).titleFont || 'Inter'}
                                                onChange={(e) => setSettings({ ...settings, titleFont: e.target.value } as any)}
                                                className="w-full px-4 py-2 border border-input rounded-lg focus:ring-2 focus:ring-ring outline-none"
                                            >
                                                <option value="Inter">Inter (Default)</option>
                                                <option value="Arial">Arial</option>
                                                <option value="Helvetica">Helvetica</option>
                                                <option value="Times New Roman">Times New Roman</option>
                                                <option value="Georgia">Georgia</option>
                                                <option value="Courier New">Courier New</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-foreground/80 mb-2">Body Font</label>
                                            <select
                                                value={(settings as any).bodyFont || 'Inter'}
                                                onChange={(e) => setSettings({ ...settings, bodyFont: e.target.value } as any)}
                                                className="w-full px-4 py-2 border border-input rounded-lg focus:ring-2 focus:ring-ring outline-none"
                                            >
                                                <option value="Inter">Inter (Default)</option>
                                                <option value="Arial">Arial</option>
                                                <option value="Helvetica">Helvetica</option>
                                                <option value="Times New Roman">Times New Roman</option>
                                                <option value="Georgia">Georgia</option>
                                                <option value="Courier New">Courier New</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        {Object.entries(settings)
                                            .filter(([key]) => key.includes('Color'))
                                            .map(([key, value]) => (
                                                <div key={key}>
                                                    <label className="block text-sm font-medium text-foreground/80 mb-2 capitalize">
                                                        {key.replace('Color', '').replace(/([A-Z])/g, ' $1').trim()}
                                                    </label>
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="color"
                                                            value={value as string}
                                                            onChange={(e) => setSettings({ ...settings, [key]: e.target.value })}
                                                            className="h-10 w-12 p-1 rounded border border-input cursor-pointer"
                                                        />
                                                        <input
                                                            type="text"
                                                            value={value as string}
                                                            onChange={(e) => setSettings({ ...settings, [key]: e.target.value })}
                                                            className="flex-1 px-3 py-2 border border-input rounded-lg text-sm focus:ring-2 focus:ring-ring outline-none font-mono"
                                                        />
                                                    </div>
                                                </div>
                                            ))}
                                    </div>

                                    <div className="pt-6 border-t border-border/60 flex justify-end">
                                        <button
                                            type="submit"
                                            disabled={savingSettings}
                                            className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50"
                                        >
                                            {savingSettings ? <Loader2 className="animate-spin w-4 h-4" /> : <Save className="w-4 h-4" />}
                                            Save Changes
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>

                        {/* Right: Preview */}
                        <div className="flex-1 lg:max-w-md sticky top-8 h-fit">
                            <h3 className="text-lg font-semibold text-foreground mb-4">Live Preview</h3>
                            <ThemePreview settings={settings} />
                            <p className="mt-4 text-sm text-muted-foreground">
                                This preview approximates how your theme will look in the Mail application.
                                Some OS-specific rendering may vary.
                            </p>
                        </div>
                    </div>
                )}
            </main>

            {selectedExtension && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
                    <button
                        type="button"
                        className="absolute inset-0 bg-black/40"
                        onClick={() => setSelectedExtension(null)}
                        aria-label="Close details"
                    />

                    <div className="relative z-[121] w-full max-w-2xl rounded-2xl border border-border bg-card shadow-2xl">
                        <div className="flex items-start justify-between px-6 py-5 border-b border-border/60">
                            <div>
                                <h3 className="text-lg font-semibold text-foreground">{selectedExtension.name}</h3>
                                <p className="text-xs text-muted-foreground mt-1">{selectedExtension.id}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelectedExtension(null)}
                                className="rounded-lg p-2 text-muted-foreground hover:text-foreground/80 hover:bg-muted"
                                aria-label="Close"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="px-6 py-5 space-y-5 max-h-[75vh] overflow-y-auto">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div className="rounded-lg border border-border bg-muted/50 p-3">
                                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Version</div>
                                    <div className="text-sm font-medium text-foreground mt-1">{selectedExtension.version || normalizeTemplate(selectedExtension.template)?.version || 'N/A'}</div>
                                </div>
                                <div className="rounded-lg border border-border bg-muted/50 p-3">
                                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Auth Type</div>
                                    <div className="text-sm font-medium text-foreground mt-1">{selectedExtension.authType || normalizeTemplate(selectedExtension.template)?.auth?.type || 'NONE'}</div>
                                </div>
                                <div className="rounded-lg border border-border bg-muted/50 p-3">
                                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Manifest Version</div>
                                    <div className="text-sm font-medium text-foreground mt-1">{normalizeTemplate(selectedExtension.template)?.manifestVersion || 'N/A'}</div>
                                </div>
                            </div>

                            <div>
                                <h4 className="text-sm font-semibold text-foreground">Description</h4>
                                <p className="text-sm text-muted-foreground mt-1">{selectedExtension.description || 'No description provided.'}</p>
                            </div>

                            <div>
                                <h4 className="text-sm font-semibold text-foreground">Required Environment Variables</h4>
                                <p className="text-xs text-muted-foreground mt-1">Detected from extension manifest and auth configuration.</p>

                                {requiredEnvVars.length > 0 ? (
                                    <div className="mt-3 rounded-lg border border-border bg-muted/50 p-3">
                                        <div className="space-y-1 font-mono text-xs text-foreground/80">
                                            {requiredEnvVars.map((envVar) => (
                                                <div key={envVar}>{envVar}=</div>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="mt-3 rounded-lg border border-dashed border-input bg-muted/50 p-3 text-xs text-muted-foreground">
                                        No required environment variables were detected for this extension.
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
