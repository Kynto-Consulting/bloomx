'use client';

import { useState, useRef, useEffect } from 'react';
import { useSession, signOut } from '@/components/SessionProvider';
import { X, Loader2, Camera, Lock, User, LogOut, PenTool, Puzzle, Grid } from 'lucide-react';
import { useCache } from '@/contexts/CacheContext';
import { cn } from '@/lib/utils';
import { Editor } from './Editor';
import { clientExpansionRegistry } from '@/lib/expansions/client/registry';
import { useTheme } from '@/components/ThemeProvider';
import { AppearanceSettings } from '@/components/settings/AppearanceSettings';
import { LabelsSettings } from '@/components/settings/LabelsSettings';
import { RulesSettings } from '@/components/settings/RulesSettings';
import { APPEARANCE_SETTINGS_KEY } from '@/lib/themes';
import { useI18n } from '@/components/I18nProvider';
import { useDialog } from '@/components/ui/useDialog';

interface SettingsModalProps {
    open: boolean;
    onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
    const { data: session, update: updateSession } = useSession();
    const { setData } = useCache();
    const { getAppearance } = useTheme();
    const { t } = useI18n();
    // Modal accesible: foco atrapado, Escape, aria-modal, restauracion de foco y scroll bloqueado.
    const { ref: dialogRef, titleId } = useDialog<HTMLDivElement>(open, onClose);

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

    const [activeTab, setActiveTab] = useState<'profile' | 'appearance' | 'labels' | 'rules' | 'extensions'>('profile');

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
            setMessage({ type: 'error', text: t('settings.uploadFailed') });
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setMessage(null);
        setLoading(true);

        if (newPassword && newPassword !== confirmPassword) {
            setMessage({ type: 'error', text: t('settings.passwordMismatch') });
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

            // Update Settings (Extensions). La apariencia se guarda al elegir tema; aqui se re-inyecta
            // la version actual para que este guardado (objeto completo) no restaure una copia vieja.
            const fullSettings = { ...expansionSettings, [APPEARANCE_SETTINGS_KEY]: getAppearance() };
            await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ expansionSettings: fullSettings })
            });

            // Update Cache
            await setData('system:expansion-settings-full', fullSettings);

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || t('settings.updateFailed'));
            }

            // Update session explicitly
            await updateSession();

            setMessage({ type: 'success', text: t('settings.saved') });
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
            {/* Backdrop (no enfocable: se cierra con clic o Escape) */}
            <div aria-hidden="true" className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in" onMouseDown={onClose} />

            {/* Modal Content */}
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                className="relative w-full h-full md:h-auto md:max-h-[85vh] md:max-w-2xl bg-background text-foreground md:rounded-2xl shadow-2xl overflow-hidden flex flex-col outline-none animate-in zoom-in-95 slide-in-from-bottom-5 duration-200"
            >
                {/* Header */}
                <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-4 shrink-0 bg-background/80 backdrop-blur-md sticky top-0 z-10 w-full">
                    <div className="flex min-w-0 items-center gap-4">
                        <h2 id={titleId} className="text-xl font-bold tracking-tight">{t('settings.title')}</h2>
                        <div role="tablist" aria-label={t('settings.tabsLabel')} className="flex min-w-0 overflow-x-auto bg-muted rounded-lg p-1">
                            {([
                                ['profile', t('settings.tabs.profile')],
                                ['appearance', t('settings.tabs.appearance')],
                                ['labels', t('settings.tabs.labels')],
                                ['rules', t('settings.tabs.rules')],
                            ] as const).map(([id, label]) => (
                                <button
                                    key={id}
                                    type="button"
                                    role="tab"
                                    id={`settings-tab-${id}`}
                                    aria-selected={activeTab === id}
                                    aria-controls="settings-panel"
                                    onClick={() => setActiveTab(id)}
                                    className={cn("px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap", activeTab === id ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
                                >
                                    {label}
                                </button>
                            ))}
                            {clientExpansionRegistry.getByMountPoint('CUSTOM_SETTINGS_TAB').map(tab => {
                                const Icon = tab.icon;
                                return (
                                    <button
                                        key={tab.id}
                                        type="button"
                                        role="tab"
                                        id={`settings-tab-${tab.id}`}
                                        aria-selected={activeTab === tab.id}
                                        aria-controls="settings-panel"
                                        onClick={() => setActiveTab(tab.id as any)}
                                        // @ts-ignore
                                        className={cn("px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap flex items-center gap-1.5", activeTab === tab.id ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
                                    >
                                        {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
                                        {/* @ts-ignore */}
                                        {tab.title || tab.id}
                                    </button>
                                );
                            })}
                            <button
                                type="button"
                                role="tab"
                                id="settings-tab-extensions"
                                aria-selected={activeTab === 'extensions'}
                                aria-controls="settings-panel"
                                onClick={() => setActiveTab('extensions')}
                                className={cn("px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap", activeTab === 'extensions' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
                            >
                                {t('settings.tabs.extensions')}
                            </button>
                        </div>
                    </div>
                    <button type="button" onClick={onClose} aria-label={t('settings.close')} className="p-2 -mr-2 text-muted-foreground hover:bg-muted rounded-full transition-colors shrink-0">
                        <X className="h-5 w-5" aria-hidden="true" />
                    </button>
                </div>

                {/* Scrollable Body */}
                <div
                    id="settings-panel"
                    role="tabpanel"
                    aria-labelledby={`settings-tab-${activeTab}`}
                    className="flex-1 overflow-y-auto p-6 md:p-8"
                >
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
                                        <h3 className="text-lg font-medium">{t('settings.extensionSettingsTitle', { name: String(tab.title || tab.id) })}</h3>
                                        <p className="text-sm text-muted-foreground">{t('settings.extensionSettingsHelp')}</p>
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
                                    <User className="h-4 w-4" aria-hidden="true" /> {t('settings.profileSection')}
                                </h3>
                                <div className="bg-muted/30 rounded-xl p-4">
                                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
                                        <div className="relative group shrink-0 mx-auto sm:mx-0">
                                            <div className="w-24 h-24 rounded-full bg-muted overflow-hidden border-2 border-background ring-2 ring-border/50">
                                                {avatar ? (
                                                    <img src={avatar} alt={t('settings.avatarAlt')} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-muted-foreground text-3xl font-medium bg-muted">
                                                        {(name?.[0] || session?.user?.email?.[0] || '?').toUpperCase()}
                                                    </div>
                                                )}
                                            </div>
                                            <label
                                                title={t('settings.changeAvatarLabel')}
                                                className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 has-[:focus-visible]:opacity-100 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring transition-all cursor-pointer text-white font-medium text-xs rounded-full gap-1"
                                            >
                                                <Camera className="h-5 w-5" aria-hidden="true" />
                                                <span>{t('settings.changeAvatar')}</span>
                                                <input type="file" className="sr-only" accept="image/*" aria-label={t('settings.changeAvatarLabel')} onChange={handleAvatarUpload} />
                                            </label>
                                        </div>
                                        <div className="flex-1 w-full space-y-4">
                                            <div className="grid gap-2">
                                                <label htmlFor="settings-display-name" className="text-sm font-medium">{t('settings.displayName')}</label>
                                                <input
                                                    id="settings-display-name"
                                                    type="text"
                                                    autoComplete="name"
                                                    value={name}
                                                    onChange={(e) => setName(e.target.value)}
                                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-all"
                                                    placeholder={t('settings.displayNamePlaceholder')}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                                    <PenTool className="h-4 w-4" aria-hidden="true" /> {t('settings.mailboxSection')}
                                </h3>
                                <div className="bg-muted/30 rounded-xl p-4 space-y-4">
                                    <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-border/50 bg-background p-4">
                                        <input
                                            type="checkbox"
                                            checked={Boolean(mailboxSettings.unifiedRepliesEnabled)}
                                            onChange={(event) => {
                                                // When disabling multi-account, clear the account filter
                                                if (!event.target.checked && typeof window !== 'undefined') {
                                                    window.localStorage.removeItem('bloomx:mailbox:account-filter:v1');
                                                }
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
                                            <div className="text-sm font-medium">{t('settings.unifiedReplies')}</div>
                                            <div className="text-xs text-muted-foreground">
                                                {t('settings.unifiedRepliesHelp')}
                                            </div>
                                        </div>
                                    </label>
                                </div>
                            </div>


                            {/* Security Section */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                                    <Lock className="h-4 w-4" aria-hidden="true" /> {t('settings.securitySection')}
                                </h3>
                                <div className="bg-muted/30 rounded-xl p-4 space-y-4">
                                    <div className="grid gap-2">
                                        <label htmlFor="settings-current-password" className="text-sm font-medium">{t('settings.currentPassword')}</label>
                                        <input
                                            id="settings-current-password"
                                            type="password"
                                            autoComplete="current-password"
                                            value={currentPassword}
                                            onChange={(e) => setCurrentPassword(e.target.value)}
                                            placeholder={t('settings.currentPasswordPlaceholder')}
                                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-all"
                                        />
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className="grid gap-2">
                                            <label htmlFor="settings-new-password" className="text-sm font-medium">{t('settings.newPassword')}</label>
                                            <input
                                                id="settings-new-password"
                                                type="password"
                                                autoComplete="new-password"
                                                value={newPassword}
                                                onChange={(e) => setNewPassword(e.target.value)}
                                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-all"
                                            />
                                        </div>
                                        <div className="grid gap-2">
                                            <label htmlFor="settings-confirm-password" className="text-sm font-medium">{t('settings.confirmPassword')}</label>
                                            <input
                                                id="settings-confirm-password"
                                                type="password"
                                                autoComplete="new-password"
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

                    {/* Appearance Tab */}
                    {activeTab === 'appearance' && <AppearanceSettings />}
                    {activeTab === 'labels' && <LabelsSettings />}
                    {activeTab === 'rules' && <RulesSettings />}

                    {/* Generic Extensions Tab */}
                    {activeTab === 'extensions' && (
                        <div className="space-y-8 animate-in fade-in duration-300">
                            <div className="space-y-4">
                                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                                    <Grid className="h-4 w-4" aria-hidden="true" /> {t('settings.attributes')}
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
                                            {t('settings.noConfigurable')}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Mensaje de estado (anunciado por lectores de pantalla) */}
                <div aria-live="polite" className={message ? 'px-4 pb-2 shrink-0' : 'sr-only'}>
                    {message && (
                        <p role={message.type === 'error' ? 'alert' : 'status'} className={cn('rounded-md border px-3 py-2 text-sm', message.type === 'error' ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'border-success/30 bg-success/10 text-success')}>
                            {message.text}
                        </p>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4  bg-muted/20 flex items-center justify-between shrink-0">
                    <button
                        type="button"
                        onClick={() => signOut({ callbackUrl: '/login' })}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-destructive hover:bg-destructive/10 font-medium rounded-lg transition-colors"
                    >
                        <LogOut className="h-4 w-4" aria-hidden="true" />
                        <span className="hidden sm:inline">{t('settings.signOut')}</span>
                        <span className="sr-only sm:hidden">{t('settings.signOut')}</span>
                    </button>

                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={loading}
                        className="px-6 py-2 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-all disabled:opacity-50 shadow-sm flex items-center gap-2"
                    >
                        {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                        {loading ? t('settings.saving') : t('settings.save')}
                    </button>
                </div>
            </div>
        </div>
    );
}
