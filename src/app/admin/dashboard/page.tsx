
'use client';

import { useState, useEffect } from 'react';
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
    Lock
} from 'lucide-react';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { ThemePreview } from '@/components/admin/ThemePreview';

interface Extension {
    id: string;
    name: string;
    description: string;
    isPaid: boolean;
    price: string;
    currency: string;
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

    if (configLoading) {
        return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin h-8 w-8 text-indigo-600" /></div>;
    }

    return (
        <div className="min-h-screen bg-gray-50 flex">
            {/* Sidebar */}
            <aside className="w-64 bg-white border-r border-gray-200 fixed h-full z-10 flex flex-col">
                <div className="p-6 border-b border-gray-100">
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
                        <span className="font-bold text-gray-900 truncate">{settings.displayName || settings.name || 'BloomX'}</span>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto py-4">
                    <nav className="px-4 space-y-1">
                        <button
                            onClick={() => setActiveTab('extensions')}
                            className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${activeTab === 'extensions'
                                ? 'bg-indigo-50 text-indigo-700'
                                : 'text-gray-600 hover:bg-gray-50'
                                }`}
                        >
                            <Puzzle className="w-5 h-5" />
                            Extensions
                        </button>
                        <button
                            onClick={() => setActiveTab('users')}
                            className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${activeTab === 'users'
                                ? 'bg-indigo-50 text-indigo-700'
                                : 'text-gray-600 hover:bg-gray-50'
                                }`}
                        >
                            <Users className="w-5 h-5" />
                            Users
                        </button>
                        <button
                            onClick={() => setActiveTab('settings')}
                            className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${activeTab === 'settings'
                                ? 'bg-indigo-50 text-indigo-700'
                                : 'text-gray-600 hover:bg-gray-50'
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
                    <h1 className="text-2xl font-bold text-gray-900 capitalize">
                        {activeTab} Management
                    </h1>
                    <p className="text-gray-500 mt-1">Manage your {activeTab} for {settings.displayName}</p>
                </header>

                {activeTab === 'extensions' && (
                    <div className="space-y-6">
                        <section>
                            <h2 className="text-lg font-semibold text-gray-900 mb-4">Installed Extensions</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {installedExtensions.map((ext: any) => (
                                    <div key={ext.extensionId || ext.id} className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                                        <div className="flex items-start justify-between mb-4">
                                            <div className="p-3 bg-indigo-50 rounded-lg">
                                                <Puzzle className="w-6 h-6 text-indigo-600" />
                                            </div>
                                            <span className="px-2 py-1 bg-green-50 text-green-700 text-xs font-medium rounded-full border border-green-100">
                                                Active
                                            </span>
                                        </div>
                                        <h3 className="font-semibold text-gray-900 mb-1">{ext.name}</h3>
                                        <p className="text-sm text-gray-500 mb-4">{ext.description || "No description"}</p>
                                        <div className="flex gap-2">
                                            <button className="flex-1 py-2 px-4 border border-gray-200 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
                                                Configure
                                            </button>
                                            <button
                                                onClick={() => handleUninstall(ext)}
                                                disabled={extensionActionId === (ext.extensionId || ext.id)}
                                                className="py-2 px-4 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {extensionActionId === (ext.extensionId || ext.id) ? '...' : 'Uninstall'}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                {installedExtensions.length === 0 && (
                                    <div className="col-span-3 text-center py-8 bg-white rounded-xl border border-dashed border-gray-300">
                                        <Puzzle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                                        <p className="text-gray-500 font-medium">No extensions installed.</p>
                                        <p className="text-gray-400 text-sm">Browse available extensions below.</p>
                                    </div>
                                )}
                            </div>
                        </section>

                        <section className="pt-8 border-t border-gray-200">
                            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                                <Search className="w-5 h-5 text-gray-500" />
                                Browse Catalog
                            </h2>
                            {loadingExtensions ? (
                                <div className="py-12 text-center"><Loader2 className="animate-spin h-8 w-8 mx-auto text-indigo-600" /></div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {availableExtensions.map(ext => (
                                        <div key={ext.id} className="bg-white rounded-lg border shadow-sm p-6 flex flex-col transition-all hover:shadow-md">
                                            <div className="flex justify-between items-start mb-2">
                                                <h3 className="font-bold text-gray-900 line-clamp-1">{ext.name}</h3>
                                                {ext.isPaid && (
                                                    <span className="text-xs font-medium bg-green-100 text-green-700 px-2 py-0.5 rounded">
                                                        {ext.price} {ext.currency}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-gray-500 text-sm mb-4 line-clamp-2 flex-1">{ext.description}</p>

                                            <div className="mt-auto pt-4 flex items-center justify-between border-t border-gray-100">
                                                <button className="text-gray-400 hover:text-gray-600 flex items-center gap-1 text-xs">
                                                    <Info className="w-3 h-3" /> Details
                                                </button>

                                                {!isInstalled(ext.id) && (
                                                    <button
                                                        onClick={() => handleInstall(ext)}
                                                        disabled={extensionActionId === ext.id}
                                                        className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm"
                                                    >
                                                        {extensionActionId === ext.id ? 'Working...' : ext.isPaid ? 'Buy & Install' : 'Install'}
                                                    </button>
                                                )}
                                                {isInstalled(ext.id) && (
                                                    <button disabled className="bg-gray-100 text-gray-400 px-4 py-2 rounded-lg text-sm font-medium cursor-not-allowed">
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
                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                                <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                                    <h2 className="text-lg font-semibold text-gray-900">All Users</h2>
                                    <div className="relative">
                                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                        <input
                                            type="text"
                                            placeholder="Search users..."
                                            className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none w-64"
                                        />
                                    </div>
                                </div>
                                {usersLoading ? (
                                    <div className="p-8 text-center"><Loader2 className="animate-spin h-6 w-6 mx-auto text-indigo-600" /></div>
                                ) : (
                                    <table className="w-full">
                                        <thead className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                            <tr>
                                                <th className="px-6 py-3">User</th>
                                                <th className="px-6 py-3">Email</th>
                                                <th className="px-6 py-3">Joined</th>
                                                <th className="px-6 py-3 text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {users.map((user: any) => (
                                                <tr key={user.id} className="hover:bg-gray-50">
                                                    <td className="px-6 py-4">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-xs uppercase">
                                                                {user.name?.[0] || user.email[0]}
                                                            </div>
                                                            <span className="font-medium text-gray-900">{user.name || 'Unnamed'}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 text-sm text-gray-600">{user.email}</td>
                                                    <td className="px-6 py-4 text-sm text-gray-500">
                                                        {new Date(user.createdAt).toLocaleDateString()}
                                                    </td>
                                                    <td className="px-6 py-4 text-right">
                                                        <button className="text-gray-400 hover:text-red-600 transition-colors">
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                            {users.length === 0 && (
                                                <tr>
                                                    <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
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
                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 sticky top-8">
                                <h2 className="text-lg font-semibold text-gray-900 mb-4">Create New User</h2>
                                <form onSubmit={handleCreateUser} className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                                        <input
                                            type="text"
                                            required
                                            className="w-full px-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                                            value={newUser.name}
                                            onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                                            placeholder="Jane Doe"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                                        <input
                                            type="email"
                                            required
                                            className="w-full px-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                                            value={newUser.email}
                                            onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                                            placeholder="jane@company.com"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                                        <input
                                            type="password"
                                            required
                                            className="w-full px-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                                            value={newUser.password}
                                            onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                                            placeholder="Min 8 characters"
                                        />
                                    </div>
                                    <button
                                        type="submit"
                                        disabled={creatingUser}
                                        className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50"
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
                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
                                <h2 className="text-xl font-semibold text-gray-900 mb-6">General Settings</h2>
                                <form onSubmit={handleSaveSettings} className="space-y-6">

                                    {/* Technical Domain */}
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Server Domain (Immutable)
                                        </label>
                                        <div className="flex items-center gap-2 relative">
                                            <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                            <input
                                                type="text"
                                                value={settings.name}
                                                readOnly
                                                className="w-full pl-9 pr-4 py-2 border border-gray-200 bg-gray-50 text-gray-500 rounded-lg outline-none cursor-not-allowed"
                                            />
                                        </div>
                                    </div>

                                    {/* Public Name */}
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Public Name
                                        </label>
                                        <input
                                            type="text"
                                            value={settings.displayName}
                                            onChange={(e) => setSettings({ ...settings, displayName: e.target.value })}
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Logo URL</label>
                                        <input
                                            type="url"
                                            value={settings.logo}
                                            onChange={(e) => setSettings({ ...settings, logo: e.target.value })}
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                        />
                                    </div>

                                    <hr className="my-6 border-gray-100" />

                                    <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
                                        <Palette className="w-5 h-5" /> Theme Configuration
                                    </h3>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Title Font</label>
                                            <select
                                                value={(settings as any).titleFont || 'Inter'}
                                                onChange={(e) => setSettings({ ...settings, titleFont: e.target.value } as any)}
                                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
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
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Body Font</label>
                                            <select
                                                value={(settings as any).bodyFont || 'Inter'}
                                                onChange={(e) => setSettings({ ...settings, bodyFont: e.target.value } as any)}
                                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
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
                                                    <label className="block text-sm font-medium text-gray-700 mb-2 capitalize">
                                                        {key.replace('Color', '').replace(/([A-Z])/g, ' $1').trim()}
                                                    </label>
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="color"
                                                            value={value as string}
                                                            onChange={(e) => setSettings({ ...settings, [key]: e.target.value })}
                                                            className="h-10 w-12 p-1 rounded border border-gray-300 cursor-pointer"
                                                        />
                                                        <input
                                                            type="text"
                                                            value={value as string}
                                                            onChange={(e) => setSettings({ ...settings, [key]: e.target.value })}
                                                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
                                                        />
                                                    </div>
                                                </div>
                                            ))}
                                    </div>

                                    <div className="pt-6 border-t border-gray-100 flex justify-end">
                                        <button
                                            type="submit"
                                            disabled={savingSettings}
                                            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50"
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
                            <h3 className="text-lg font-semibold text-gray-900 mb-4">Live Preview</h3>
                            <ThemePreview settings={settings} />
                            <p className="mt-4 text-sm text-gray-500">
                                This preview approximates how your theme will look in the Mail application.
                                Some OS-specific rendering may vary.
                            </p>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
