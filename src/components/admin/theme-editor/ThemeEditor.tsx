'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Image as ImageIcon, LayoutTemplate, Loader2, Moon, Palette, Redo2, RotateCcw, Save, SlidersHorizontal, Sun, Type, Undo2 } from 'lucide-react';
import type { ThemeMode } from '@/lib/theme-config';
import { useI18n } from '@/components/I18nProvider';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LandingPreview } from '@/components/admin/LandingPreview';
import { AdvancedTab } from './AdvancedTab';
import { ColorsTab } from './ColorsTab';
import { LandingTab } from './LandingTab';
import { LogosTab } from './LogosTab';
import { ThemeLivePreview } from './ThemeLivePreview';
import { Tabs, panelId, tabId, type TabDef } from './Tabs';
import { TypographyTab } from './TypographyTab';
import { getLanding, resetThemeDefaults } from './model';
import { useThemeEditor } from './useThemeEditor';
import { Segmented, btnClass, btnPrimaryClass } from './ui';

export type EditorTab = 'colors' | 'typography' | 'logos' | 'landing' | 'advanced';

interface Props {
    /** Avisa al contenedor si hay cambios sin guardar (para confirmar al salir de la pestana). */
    onDirtyChange?: (dirty: boolean) => void;
    initialTab?: EditorTab;
}

/**
 * Editor de tema de empresa del panel admin: paleta completa por modo, tipografia y forma, logos, landing y politica,
 * con vista previa fiel en vivo y un unico "Guardar" (PUT /api/admin/domain con el tema completo).
 */
export function ThemeEditor({ onDirtyChange, initialTab = 'colors' }: Props) {
    const { t, locale } = useI18n();
    const uid = useId();
    const ed = useThemeEditor();
    const [tab, setTab] = useState<EditorTab>(initialTab);
    const [mode, setMode] = useState<ThemeMode>('light');
    const [confirmReset, setConfirmReset] = useState(false);
    const [attempted, setAttempted] = useState(false);
    const [savedNote, setSavedNote] = useState(false);
    const { dirty, doc } = ed;

    useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
    useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

    // Confirmacion al cerrar/recargar la pagina con cambios sin guardar.
    useEffect(() => {
        if (!dirty) return;
        const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [dirty]);

    const save = useCallback(async () => {
        setAttempted(true);
        const r = await ed.save();
        if (r.ok) {
            setAttempted(false);
            setSavedNote(true);
            toast.success(t('themeEditor.toolbar.saved'));
            setTimeout(() => setSavedNote(false), 4000);
        } else if (r.reason === 'server') {
            toast.error(t('themeEditor.toolbar.saveFailed'));
        } else if (r.reason === 'network') {
            toast.error(t('themeEditor.toolbar.saveNetwork'));
        }
    }, [ed, t]);

    const tabs: TabDef<EditorTab>[] = useMemo(() => [
        { id: 'colors', label: t('themeEditor.tabs.colors'), icon: <Palette className="h-4 w-4" aria-hidden="true" /> },
        { id: 'typography', label: t('themeEditor.tabs.typography'), icon: <Type className="h-4 w-4" aria-hidden="true" /> },
        { id: 'logos', label: t('themeEditor.tabs.logos'), icon: <ImageIcon className="h-4 w-4" aria-hidden="true" /> },
        { id: 'landing', label: t('themeEditor.tabs.landing'), icon: <LayoutTemplate className="h-4 w-4" aria-hidden="true" /> },
        { id: 'advanced', label: t('themeEditor.tabs.advanced'), icon: <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> },
    ], [t]);

    if (ed.status === 'loading') {
        return <div role="status" className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t('themeEditor.loading')}</div>;
    }
    if (ed.status === 'error') {
        return (
            <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                <p>{t('themeEditor.loadError')}</p>
                <button type="button" className={`${btnClass} mt-3`} onClick={() => void ed.reload()}>{t('themeEditor.retry')}</button>
            </div>
        );
    }

    const errorEntries = Object.entries(ed.errors);
    const showErrors = (attempted || !!ed.formError) && (errorEntries.length > 0 || !!ed.formError);
    const isLanding = tab === 'landing';

    return (
        <div data-testid="theme-editor" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="text-xl font-semibold text-foreground">{t('themeEditor.title')}</h2>
                    <p className="text-sm text-muted-foreground">
                        {ed.domainName && <span className="font-mono">{ed.domainName}</span>}
                        {ed.domainName && ' · '}
                        <span data-testid="dirty-state" aria-live="polite">
                            {dirty ? t('themeEditor.toolbar.dirty') : savedNote ? t('themeEditor.toolbar.saved') : t('themeEditor.toolbar.clean')}
                        </span>
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Segmented<ThemeMode>
                        label={t('themeEditor.mode.label')}
                        value={mode}
                        onChange={setMode}
                        options={[
                            { id: 'light', label: t('themeEditor.mode.light'), icon: <Sun className="h-4 w-4" aria-hidden="true" /> },
                            { id: 'dark', label: t('themeEditor.mode.dark'), icon: <Moon className="h-4 w-4" aria-hidden="true" /> },
                        ]}
                    />
                    <button type="button" className={btnClass} onClick={ed.undo} disabled={!ed.canUndo} aria-label={t('themeEditor.toolbar.undo')} title={t('themeEditor.toolbar.undo')}><Undo2 className="h-4 w-4" aria-hidden="true" /></button>
                    <button type="button" className={btnClass} onClick={ed.redo} disabled={!ed.canRedo} aria-label={t('themeEditor.toolbar.redo')} title={t('themeEditor.toolbar.redo')}><Redo2 className="h-4 w-4" aria-hidden="true" /></button>
                    <button type="button" className={btnClass} onClick={() => setConfirmReset(true)}><RotateCcw className="h-4 w-4" aria-hidden="true" />{t('themeEditor.toolbar.reset')}</button>
                    <button type="button" className={btnPrimaryClass} onClick={() => void save()} disabled={!dirty || ed.saving} aria-busy={ed.saving || undefined}>
                        {ed.saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                        {ed.saving ? t('common.saving') : t('themeEditor.toolbar.save')}
                    </button>
                </div>
            </div>

            <div role="alert" aria-live="assertive">
                {showErrors && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" data-testid="save-errors">
                        <p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" aria-hidden="true" />{t('themeEditor.errors.summary')}</p>
                        <ul className="mt-1 list-disc pl-6 text-xs">
                            {errorEntries.map(([path, code]) => <li key={path}><span className="font-mono">{path}</span>: {t(`themeEditor.errors.${code}`)}</li>)}
                            {ed.formError && errorEntries.length === 0 && <li>{ed.formError === 'network' ? t('themeEditor.toolbar.saveNetwork') : ed.formError}</li>}
                        </ul>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
                <div className="min-w-0 space-y-4">
                    <Tabs tabs={tabs} value={tab} onChange={setTab} label={t('themeEditor.tabs.label')} idPrefix={uid} />
                    <div id={panelId(uid, tab)} role="tabpanel" aria-labelledby={tabId(uid, tab)} tabIndex={0} className="outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {tab === 'colors' && <ColorsTab doc={doc} mode={mode} onDoc={ed.set} />}
                        {tab === 'typography' && <TypographyTab doc={doc} onDoc={ed.set} />}
                        {tab === 'logos' && <LogosTab doc={doc} errors={ed.errors} onDoc={ed.set} />}
                        {tab === 'landing' && <LandingTab doc={doc} onDoc={ed.set} />}
                        {tab === 'advanced' && <AdvancedTab doc={doc} onDoc={ed.set} />}
                    </div>
                </div>

                <aside aria-label={t('themeEditor.preview.title')} className="min-w-0 xl:sticky xl:top-4 xl:self-start">
                    <h3 className="mb-3 text-lg font-semibold text-foreground">{t('themeEditor.preview.title')}</h3>
                    {isLanding ? (
                        <LandingPreview
                            value={getLanding(doc)}
                            locale={locale}
                            brandName={doc.displayName}
                            brandLogo={doc.logo || null}
                            themeConfig={doc.theme}
                            mode={mode}
                            onModeChange={setMode}
                        />
                    ) : (
                        <ThemeLivePreview theme={doc.theme} name={doc.displayName} logo={doc.logo || undefined} mode={mode} onModeChange={setMode} />
                    )}
                </aside>
            </div>

            <ConfirmDialog
                open={confirmReset}
                title={t('themeEditor.reset.title')}
                description={t('themeEditor.reset.body')}
                confirmLabel={t('themeEditor.reset.confirm')}
                cancelLabel={t('common.cancel')}
                destructive
                onCancel={() => setConfirmReset(false)}
                onConfirm={() => { ed.set(resetThemeDefaults(doc)); setConfirmReset(false); }}
            />
        </div>
    );
}
