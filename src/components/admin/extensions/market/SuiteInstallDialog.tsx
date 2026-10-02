'use client';

import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Badge } from '@/components/admin/console';
import { useI18n } from '@/components/I18nProvider';
import type { SuitePlan } from '@/lib/admin/marketplace/market-model';
import { PermissionsList } from '../PermissionsList';

export interface SuiteInstallProgress { done: number; total: number; name: string }

/**
 * Confirmacion de «Instalar la suite»: muestra, ANTES de tocar nada, el orden de instalacion (dependencias primero), todos los permisos que
 * se concederan, las aprobaciones explicitas que hagan falta y lo que no se instalara y por que. Nada se instala sin pulsar el boton.
 */
export function SuiteInstallDialog({
    open, suiteName, plan, approved, onApprove, busy, progress, error, onCancel, onConfirm,
}: {
    open: boolean; suiteName: string; plan: SuitePlan | null; approved: boolean; onApprove: (value: boolean) => void;
    busy: boolean; progress: SuiteInstallProgress | null; error: string | null; onCancel: () => void; onConfirm: () => void;
}) {
    const { t } = useI18n();
    const m = (k: string, p?: Record<string, string | number>) => t(`admin.console.extensions.market.suiteInstall.${k}`, p);
    const needsApproval = (plan?.approvals.length ?? 0) > 0;
    const body = !plan ? null : (
        <div className="space-y-3">
            {plan.steps.length === 0 ? (
                <p>{m('nothing')}</p>
            ) : (
                <>
                    <p>{m('intro')}</p>
                    <ol className="list-decimal space-y-1 pl-5" data-testid="suite-steps">
                        {plan.steps.map((s) => (
                            <li key={s.id}>
                                <span className="font-medium text-foreground">{s.name}</span>{' '}
                                <span className="text-muted-foreground">({s.action === 'install' ? m('stepInstall') : m('stepActivate')}{s.viaDependency ? ` · ${m('viaDependency')}` : ''})</span>
                            </li>
                        ))}
                    </ol>
                    {plan.permissions.length > 0 && (
                        <div>
                            <p className="mb-1 font-medium text-foreground">{m('permissionsIntro')}</p>
                            <div className="max-h-56 overflow-y-auto"><PermissionsList template={{ permissions: plan.permissions.map((p) => p.permission) }} compact /></div>
                        </div>
                    )}
                    {needsApproval && (
                        <label className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-destructive">
                            <input type="checkbox" className="mt-1" checked={approved} onChange={(e) => onApprove(e.target.checked)} />
                            <span>
                                {m('approvalsIntro')} <strong>{plan.approvals.join(', ')}</strong>. {m('approve')}
                            </span>
                        </label>
                    )}
                </>
            )}
            {plan.skipped.filter((s) => s.reason !== 'installed').length > 0 && (
                <div className="rounded-lg border border-border bg-muted/40 p-3">
                    <p className="font-medium text-foreground">{m('skippedIntro')}</p>
                    <ul className="mt-1 list-disc pl-5">
                        {plan.skipped.filter((s) => s.reason !== 'installed').map((s) => <li key={s.id}>{s.name}: {m(`skipReasons.${s.reason}`)}</li>)}
                    </ul>
                </div>
            )}
            {progress && (
                <p role="status" aria-live="polite" className="flex items-center gap-2 text-foreground">
                    <Badge tone="info">{progress.done}/{progress.total}</Badge>{m('progress', { done: progress.done + 1, total: progress.total, name: progress.name })}
                </p>
            )}
        </div>
    );
    return (
        <ConfirmDialog
            open={open}
            title={m('title', { name: suiteName })}
            description={body}
            confirmLabel={m('confirm', { count: plan?.steps.length ?? 0 })}
            cancelLabel={t('admin.console.common.cancel')}
            busy={busy}
            confirmDisabled={!plan || plan.steps.length === 0 || (needsApproval && !approved)}
            error={error}
            onCancel={onCancel}
            onConfirm={onConfirm}
        />
    );
}
