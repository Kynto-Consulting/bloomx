'use client';

import { useRef, useState } from 'react';
import { Loader2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { useI18n } from '@/components/I18nProvider';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { rulesApi } from '@/lib/rules/client';
import { validateConditionsV2, type ConditionsV2 } from '@/lib/rules/conditions';

interface Props {
    conditions: ConditionsV2;
    /** La regla debe estar guardada para aplicarse. */
    ruleId?: string | null;
    labelId?: string | null;
    onApplied?: () => void;
}

type Phase = { kind: 'idle' } | { kind: 'counting'; scanned: number } | { kind: 'confirm'; scanned: number; matched: number; unknown: number }
    | { kind: 'applying'; scanned: number; changed: number } | { kind: 'done'; batchId: string | null; scanned: number; changed: number } | { kind: 'undone'; restored: number };

/** "Aplicar a correos existentes": cuenta coincidencias (vista previa), pide confirmacion, aplica por paginas con progreso y permite DESHACER. */
export function RuleApplyPanel({ conditions, ruleId, labelId, onApplied }: Props) {
    const { t } = useI18n();
    const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
    const [error, setError] = useState<string | null>(null);
    const cancel = useRef(false);

    const count = async () => {
        setError(null);
        const v = validateConditionsV2(conditions);
        if (!v.ok) { setError(v.error); return; }
        if (!ruleId && !labelId) { setError(t('ruleBuilder.apply.saveFirst')); return; }
        cancel.current = false;
        let cursor: string | null = null;
        let scanned = 0; let matched = 0; let unknown = 0;
        setPhase({ kind: 'counting', scanned });
        for (;;) {
            const r = await rulesApi.countPage(v.value, cursor);
            if (!r.ok || !r.data) { setPhase({ kind: 'idle' }); setError(r.status === 429 ? t('ruleBuilder.test.tooMany') : t('ruleBuilder.test.failed')); return; }
            scanned += r.data.processed; matched += r.data.matched; unknown += r.data.unknown;
            setPhase({ kind: 'counting', scanned });
            if (r.data.done || cancel.current) break;
            cursor = r.data.nextCursor;
        }
        setPhase({ kind: 'confirm', scanned, matched, unknown });
    };

    const apply = async () => {
        cancel.current = false;
        let cursor: string | null = null;
        let batchId: string | null = null;
        let scanned = 0; let changed = 0;
        setPhase({ kind: 'applying', scanned, changed });
        for (;;) {
            const r = await rulesApi.applyPage({ ruleId: ruleId ?? undefined, labelId: ruleId ? undefined : labelId ?? undefined, cursor, batchId });
            if (!r.ok || !r.data) { setPhase({ kind: 'done', batchId, scanned, changed }); setError(t('ruleBuilder.apply.failed')); return; }
            batchId = r.data.batchId ?? batchId;
            scanned += r.data.processed; changed += r.data.changed;
            setPhase({ kind: 'applying', scanned, changed });
            if (r.data.done || cancel.current) break;
            cursor = r.data.nextCursor;
        }
        setPhase({ kind: 'done', batchId, scanned, changed });
        toast.success(t('ruleBuilder.apply.done', { n: changed }));
        onApplied?.();
    };

    const undo = async (batchId: string) => {
        const r = await rulesApi.undo(batchId);
        if (!r.ok) { setError(t('ruleBuilder.apply.undoFailed')); return; }
        setPhase({ kind: 'undone', restored: r.data?.restored ?? 0 });
        onApplied?.();
    };

    const busy = phase.kind === 'counting' || phase.kind === 'applying';
    return (
        <section aria-label={t('ruleBuilder.apply.title')} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
                <button type="button" disabled={busy} onClick={() => { void count(); }} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50">
                    {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} {t('ruleBuilder.apply.button')}
                </button>
                {busy && <button type="button" onClick={() => { cancel.current = true; }} className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted">{t('ruleBuilder.apply.stop')}</button>}
                {phase.kind === 'done' && phase.batchId && (
                    <button type="button" onClick={() => { void undo(phase.batchId!); }} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted">
                        <Undo2 className="h-4 w-4" aria-hidden="true" /> {t('ruleBuilder.apply.undo')}
                    </button>
                )}
            </div>
            <div role="status" aria-live="polite" className="text-sm text-muted-foreground">
                {phase.kind === 'counting' && t('ruleBuilder.apply.counting', { n: phase.scanned })}
                {phase.kind === 'applying' && t('ruleBuilder.apply.applying', { n: phase.scanned, changed: phase.changed })}
                {phase.kind === 'done' && t('ruleBuilder.apply.summary', { scanned: phase.scanned, changed: phase.changed })}
                {phase.kind === 'undone' && t('ruleBuilder.apply.undone', { n: phase.restored })}
            </div>
            {busy && <div role="progressbar" aria-label={t('ruleBuilder.apply.title')} className="h-1.5 w-full overflow-hidden rounded bg-muted"><div className="h-full w-1/3 animate-pulse rounded bg-primary" /></div>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <ConfirmDialog
                open={phase.kind === 'confirm'}
                title={t('ruleBuilder.apply.confirmTitle')}
                description={phase.kind === 'confirm' ? (
                    <>
                        <p>{t('ruleBuilder.apply.confirmBody', { matched: phase.matched, scanned: phase.scanned })}</p>
                        {phase.unknown > 0 && <p className="mt-2">{t('ruleBuilder.test.unknown', { n: phase.unknown })}</p>}
                        <p className="mt-2">{t('ruleBuilder.apply.undoable')}</p>
                    </>
                ) : null}
                confirmLabel={t('ruleBuilder.apply.confirm')}
                cancelLabel={t('labelTree.cancel')}
                onConfirm={() => { void apply(); }}
                onCancel={() => setPhase({ kind: 'idle' })}
            />
        </section>
    );
}
