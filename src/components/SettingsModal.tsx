'use client';

import { useState, useRef, useEffect } from 'react';
import { useSession, signOut } from '@/components/SessionProvider';
import { X, Loader2, Camera, Lock, User, LogOut, PenTool, Puzzle, Grid } from 'lucide-react';
import { useCache } from '@/contexts/CacheContext';
import { cn } from '@/lib/utils';
import { Editor } from './Editor';
import { clientExpansionRegistry } from '@/lib/expansions/client/registry';

interface SettingsModalProps {
    open: boolean;
    onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
    const { data: session, update: updateSession } = useSession();
    const { setData } = useCache();

    // Reset state when opening
    useEffect(() => {
        if (open) {
            setName(session?.user?.name || '');
            setAvatar(session?.user?.avatar || '');
            setMessage(null);

            // Load Settings
            fetch('/api/settings')
                .then(res => res.json())
                .then(data => {
                    // setSignature(data.signature || '');
                    setExpansionSettings(data.expansionSettings || {});
                })
                .catch(console.error);
        }
    }, [open, session]);

    const [name, setName] = useState('');
    const [avatar, setAvatar] = useState('');
    // const [signature, setSignature] = useState(''); // Legacy signature state removed in favor of expansion settings
    const [expansionSettings, setExpansionSettings] = useState<any>({});
    const mailboxSettings = expansionSettings['core-mailbox'] || {};

    const [activeTab, setActiveTab] = useState<'profile' | 'extensions'>('profile');

    // Password fields
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        try {
            setLoading(true);
            const res = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (data.url) {
                setAvatar(data.url);
            }
        } catch (err) {
            console.error('Upload failed', err);
            setMessage({ type: 'error', text: 'Failed to upload avatar' });
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setMessage(null);
        setLoading(true);

        if (newPassword && newPassword !== confirmPassword) {
            setMessage({ type: 'error', text: 'New passwords do not match' });
            setLoading(false);
            return;
        }

        try {
            // Update Profile
            const res = await fetch('/api/profile', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    avatar,
                    currentPassword: currentPassword || undefined,
                    newPassword: newPassword || undefined
                })
            });

            // Update Settings (Extensions)
            await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ expansionSettings })
            });

            // Update Cache
            await setData('system:expansion-settings-full', expansionSettings);

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Failed to update profile');
            }

            // Update session explicitly
            await updateSession();

            setMessage({ type: 'success', text: 'Settings updated successfully' });
            // Clear password fields
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');

        } catch (err: any) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setLoading(false);
        }
    };

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-0 md:p-4">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in" onClick={onClose} />

            {/* Modal Content */}
            <div className="relative w-full h-full md:h-auto md:max-h-[85vh] md:max-w-2xl bg-background md:rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 slide-in-from-bottom-5 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 shrink-0 bg-background/80 backdrop-blur-md sticky top-0 z-10 w-full overflow-x-auto">
                    <div className="flex items-center gap-4">
                        <h2 className="text-xl font-bold tracking-tight">Settings</h2>
                        <div className="flex bg-muted rounded-lg p-1 shrink-0">
                            <button
                                onClick={() => setActiveTab('profile')}
                                className={cn("px-3 py-1 text-xs font-medium rounded-md transition-all whitespace-nowrap", activeTab === 'profile' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
                            >
                                Profile
                            </button>
                            {clientExpansionRegistry.getByMountPoint('CUSTOM_SETTINGS_TAB').map(tab => {
                                const Icon = tab.icon;
                                return (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveTab(tab.id as any)}
                                        // @ts-ignore
                                        className={cn("px-3 py-1 text-xs font-medium rounded-md transition-all whitespace-nowrap flex items-center gap-1.5", activeTab === tab.id ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
                                    >
                                        {Icon && <Icon className="h-3.5 w-3.5" />}
                                        {/* @ts-ignore */}
                                        {tab.title || tab.id}
                                    </button>
                                );
                            })}
                            <button
                                onClick={() => setActiveTab('extensions')}
                                className={cn("px-3 py-1 text-xs font-medium rounded-md transition-all whitespace-nowrap", activeTab === 'extensions' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
                            >
                                Extensions
                            </button>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 -mr-2 text-muted-foreground hover:bg-muted rounded-full transition-colors shrink-0">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Scrollable Body */}
                <div className="flex-1 overflow-y-auto p-6 md:p-8">
                    {/* Check for Custom Tabs first */}
                    {clientExpansionRegistry.getByMountPoint('CUSTOM_SETTINGS_TAB').map(tab => {
                        if (activeTab === tab.id) {
                            const Component = tab.Component as any;
                            if (!Component) return null;
                            const currentSettings = expansionSettings[tab.id] || {};
                            return (
                                <div key={tab.id} className="space-y-6 animate-in fade-in duration-300">
                                    <div>
                                        {/* @ts-ignore */}
                                        <h3 className="text-lg font-medium">{tab.title || tab.id} Settings</h3>
                                        <p className="text-sm text-muted-foreground">Manage your configuration for this extension.</p>
                                    </div>
                                    <div className="bg-muted/30 rounded-xl p-4">
                                        <Component
                                            settings={currentSettings}
                                            onSave={(newSettings: any) => {
                                                setExpansionSettings((prev: any) => ({
                                                    ...prev,
                                                    [tab.id]: newSettings
                                                }));
                                            }}
                                        />
                                    </div>
                                </div>
                            );
                        }
                        return null;
                    })}

                    {/* Profile Tab */}
                    {activeTab === 'profile' && (
                        <form onSubmit={handleSubmit} className="space-y-8 animate-in fade-in duration-300">
                            {/* Profile Section */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                                    <User className="h-4 w-4" /> Profile
                                </h3>
                                <div className="bg-muted/30 rounded-xl p-4">
                                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
                                        <div className="relative group shrink-0 mx-auto sm:mx-0">
                                            <div className="w-24 h-24 rounded-full bg-muted overflow-hidden border-2 border-background ring-2 ring-border/50">
                                                {avatar ? (
                                                    <img src={avatar} alt="Avatar" className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-muted-foreground text-3xl font-medium bg-muted">
                                                        {(name?.[0] || session?.user?.email?.[0] || '?').toUpperCase()}
                                                    </div>
                                                )}
                                            </div>
                                            <label className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-all cursor-pointer text-white font-medium text-xs rounded-full gap-1">
                                                <Camera className="h-5 w-5" />
                                                <span>Change</span>
                                                <input type="file" className="hidden" accept="image/*" onChange={handleAvatarUpload} />
                                            </label>
                                        </div>
                                        <div className="flex-1 w-full space-y-4">
                                            <div className="grid gap-2">
                                                <label className="text-sm font-medium">Display Name</label>
                                                <input
                                                    type="text"
                                                    value={name}
                                                    onChange={(e) => setName(e.target.value)}
                                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-all"
                                                    placeholder="Your name"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                                    <PenTool className="h-4 w-4" /> Mailbox
                                </h3>
                                <div className="bg-muted/30 rounded-xl p-4 space-y-4">
                                    <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-border/50 bg-background p-4">
                                        <input
                                            type="checkbox"
                                            checked={Boolean(mailboxSettings.unifiedRepliesEnabled)}
                                            onChange={(event) => {
                                                setExpansionSettings((prev: any) => ({
                                                    ...prev,
                                                    'core-mailbox': {
                                                        ...(prev['core-mailbox'] || {}),
                                                        unifiedRepliesEnabled: event.target.checked,
                                                    }
                                                }));
                                            }}
                                            className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                                        />
                                        <div>
                                            <div className="text-sm font-medium">Unified multi-account replies</div>
                                            <div className="text-xs text-muted-foreground">
                                                When enabled, Bloomx replies from the original mailbox of each thread and shows your connected account count instead of the active email.
                                            </div>
                                        </div>
                                    </label>
                                </div>
                            </div>


                            {/* Security Section */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                                    <Lock className="h-4 w-4" /> Security
                                </h3>
                                <div className="bg-muted/30 rounded-xl p-4 space-y-4">
                                    <div className="grid gap-2">
                                        <label className="text-sm font-medium">Current Password</label>
                                        <input
                                            type="password"
                                            value={currentPassword}
                                            onChange={(e) => setCurrentPassword(e.target.value)}
                                            placeholder="Required to set new password"
                                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-all"
                                        />
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className="grid gap-2">
                                            <label className="text-sm font-medium">New Password</label>
                                            <input
                                                type="password"
                                                value={newPassword}
                                                onChange={(e) => setNewPassword(e.target.value)}
                                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-all"
                                            />
                                        </div>
                                        <div className="grid gap-2">
                                            <label className="text-sm font-medium">Confirm Password</label>
                                            <input
                                                type="password"
                                                value={confirmPassword}
                                                onChange={(e) => setConfirmPassword(e.target.value)}
                                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-all"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </form>
                    )}

                    {/* Generic Extensions Tab */}
                    {activeTab === 'extensions' && (
                        <div className="space-y-8 animate-in fade-in duration-300">
                            <div className="space-y-4">
                                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                                    <Grid className="h-4 w-4" /> Attributes
                                </h3>
                                <div className="grid gap-4">
                                    {clientExpansionRegistry.getAll().map(expansion => {
                                        // Ignore expansions that have a CUSTOM_SETTINGS_TAB since they are rendered elsewhere
                                        const hasCustomTab = expansion.mounts.some((m: any) => m.point === 'CUSTOM_SETTINGS_TAB');
                                        if (hasCustomTab) return null;

                                        const Settings = expansion.SettingsComponent;
                                        if (!Settings) return null;

                                        const currentSettings = expansionSettings[expansion.id] || expansion.defaultSettings || {};

                                        return (
                                            <div key={expansion.id} className="bg-muted/30 rounded-xl p-4">
                                                <div className="flex items-center gap-2 mb-4 pb-2 border-b border-border/40">
                                                    <Puzzle className="h-4 w-4 text-primary" />
                                                    <h4 className="font-medium text-sm">{expansion.label || expansion.id}</h4>
                                                </div>
                                                <Settings
                                                    settings={currentSettings}
                                                    onSave={(newSettings: any) => {
                                                        setExpansionSettings((prev: any) => ({
                                                            ...prev,
                                                            [expansion.id]: newSettings
                                                        }));
                                                    }}
                                                />
                                            </div>
                                        );
                                    })}

                                    {clientExpansionRegistry.getAll().filter(e => !!e.SettingsComponent && !e.mounts.some((m: any) => m.point === 'CUSTOM_SETTINGS_TAB')).length === 0 && (
                                        <div className="p-8 text-center text-muted-foreground bg-muted/20 rounded-xl border border-dashed">
                                            No configurable extensions found.
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4  bg-muted/20 flex items-center justify-between shrink-0">
                    <button
                        type="button"
                        onClick={() => signOut({ callbackUrl: '/login' })}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 font-medium rounded-lg transition-colors"
                    >
                        <LogOut className="h-4 w-4" />
                        <span className="hidden sm:inline">Sign Out</span>
                    </button>

                    <button
                        onClick={handleSubmit}
                        disabled={loading}
                        className="px-6 py-2 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-all disabled:opacity-50 shadow-sm flex items-center gap-2"
                    >
                        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                        {loading ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            </div>
        </div>
    );
}
