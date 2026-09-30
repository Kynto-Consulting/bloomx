'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { FileText, Loader2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useI18n } from '@/components/I18nProvider';
import { ElixirApiError, templatesApi, type SenderConfig, type TemplateDto } from '@/lib/elixir-campaigns-client';

export interface CurrentTemplate { subject: string; body: string; senderConfig: SenderConfig }

/** Biblioteca de plantillas persistentes: guardar la actual, sobrescribir, cargar y eliminar. */
export function TemplateLibrary({ open, onClose, current, onLoad }: {
    open: boolean;
    onClose: () => void;
    current: CurrentTemplate;
    onLoad: (t: TemplateDto) => void;
}) {
    const { t, intlLocale } = useI18n();
    const [items, setItems] = useState<TemplateDto[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [toDelete, setToDelete] = useState<TemplateDto | null>(null);
    const [delBusy, setDelBusy] = useState(false);
    const [delError, setDelError] = useState<string | null>(null);
    const nameId = useId();
    const errId = useId();

    const message = useCallback((e: unknown, fallback: string) => {
        if (e instanceof ElixirApiError) {
            if (e.code === 'elixir_tables_missing') return t('elixir.tablesMissing');
            if (e.code === 'duplicate_name') return t('elixir.templateDuplicate');
            if (e.status === 0) return t('common.networkError');
        }
        return fallback;
    }, [t]);

    const load = useCallback(async () => {
        setLoadError(null);
        try { setItems(await templatesApi().list()); }
        catch (e) { setItems([]); setLoadError(message(e, t('elixir.templatesLoadError'))); }
    }, [message, t]);

    useEffect(() => {
        if (!open) return;
        setItems(null); setFormError(null); setName('');
        void load();
    }, [open, load]);

    const save = async (existing?: TemplateDto) => {
        const finalName = (existing?.name ?? name).trim();
        if (!finalName || saving) return;
        setSaving(true); setFormError(null);
        try {
            const input = { name: finalName, subject: current.subject, body: current.body, senderConfig: current.senderConfig };
            if (existing) await templatesApi().update(existing.id, input); else await templatesApi().create(input);
            toast.success(t('elixir.templateSaved'));
            setName('');
            await load();
        } catch (e) {
            setFormError(message(e, t('elixir.templateSaveError')));
        } finally { setSaving(false); }
    };

    const confirmDelete = async () => {
        if (!toDelete || delBusy) return;
        setDelBusy(true); setDelError(null);
        try {
            await templatesApi().remove(toDelete.id);
            setItems(prev => (prev ?? []).filter(x => x.id !== toDelete.id));
            setToDelete(null);
            toast.success(t('elixir.templateDeleted'));
        } catch (e) { setDelError(message(e, t('elixir.templateDeleteError'))); }
        finally { setDelBusy(false); }
    };

    const fmt = (iso: string) => { try { return new Date(iso).toLocaleString(intlLocale, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso; } };

    return (
        <>
            <Modal
                open={open}
                onClose={onClose}
                panelClassName="w-full max-w-lg rounded-xl border border-border bg-background shadow-xl max-h-[90vh] flex flex-col"
            >
                {({ titleId }) => (
                    <div className="flex min-h-0 flex-1 flex-col p-5">
                        <div className="mb-1 flex items-center justify-between gap-3">
                            <h2 id={titleId} className="flex items-center gap-2 text-lg font-semibold"><FileText className="h-5 w-5 text-muted-foreground" aria-hidden="true" />{t('elixir.templatesTitle')}</h2>
                            <button type="button" onClick={onClose} aria-label={t('common.close')} className="rounded-full p-2 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" aria-hidden="true" /></button>
                        </div>
                        <p className="mb-4 text-sm text-muted-foreground">{t('elixir.templatesHelp')}</p>

                        <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="mb-4">
                            <label htmlFor={nameId} className="mb-1 block text-sm font-medium">{t('elixir.templateName')}</label>
                            <div className="flex flex-col gap-2 sm:flex-row">
                                <input
                                    id={nameId} value={name} onChange={(e) => { setName(e.target.value); setFormError(null); }}
                                    maxLength={120} placeholder={t('elixir.templateNamePlaceholder')} autoComplete="off"
                                    aria-invalid={formError ? true : undefined} aria-describedby={formError ? errId : undefined}
                                    className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                                />
                                <button type="submit" disabled={saving || !name.trim()} aria-busy={saving || undefined} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                                    {saving ? t('elixir.savingTemplate') : t('elixir.saveTemplate')}
                                </button>
                            </div>
                            {formError && <p id={errId} role="alert" className="mt-1 text-xs text-destructive">{formError}</p>}
                        </form>

                        <div className="min-h-[120px] flex-1 overflow-y-auto rounded-lg border border-border" aria-busy={items === null || undefined}>
                            {items === null && <p role="status" className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t('elixir.templatesLoading')}</p>}
                            {loadError && <p role="alert" className="p-4 text-sm text-destructive">{loadError}</p>}
                            {items && items.length === 0 && !loadError && <p className="p-6 text-center text-sm text-muted-foreground">{t('elixir.templatesEmpty')}</p>}
                            {items && items.length > 0 && (
                                <ul className="divide-y divide-border">
                                    {items.map(tpl => (
                                        <li key={tpl.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-sm font-medium">{tpl.name}</p>
                                                <p className="truncate text-xs text-muted-foreground">{tpl.subject || '—'} · {fmt(tpl.updatedAt)}</p>
                                            </div>
                                            <div className="flex shrink-0 items-center gap-1">
                                                <button type="button" onClick={() => { onLoad(tpl); toast.success(t('elixir.templateLoaded', { name: tpl.name })); onClose(); }} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">{t('elixir.loadTemplate')}</button>
                                                <button type="button" onClick={() => void save(tpl)} disabled={saving} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50">{t('elixir.updateTemplate')}</button>
                                                <button type="button" onClick={() => { setDelError(null); setToDelete(tpl); }} aria-label={`${t('elixir.deleteTemplate')}: ${tpl.name}`} className="rounded-full p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                )}
            </Modal>
            <ConfirmDialog
                open={!!toDelete} destructive busy={delBusy} error={delError}
                title={t('elixir.deleteTemplate')}
                description={t('elixir.deleteTemplateConfirm', { name: toDelete?.name ?? '' })}
                confirmLabel={t('elixir.deleteTemplate')} cancelLabel={t('common.cancel')}
                onConfirm={() => void confirmDelete()} onCancel={() => setToDelete(null)}
            />
        </>
    );
}
