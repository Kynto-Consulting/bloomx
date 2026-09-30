'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { useCache } from '@/contexts/CacheContext';
import { useI18n } from '@/components/I18nProvider';
import { LABELS_CACHE_KEY } from '@/lib/mail-list';
import { labelDisplayName } from '@/lib/organizer/labels';

interface ProposalRow {
    emailId: string;
    from: string;
    subject: string;
    category: string;
    labelName: string | null;
    confidence: number;
    method: string;
}

/** Propuestas de baja confianza del Organizer: el usuario decide. No se muestra nada si no hay propuestas. */
export function OrganizerProposals() {
    const { t } = useI18n();
    const { invalidate } = useCache();
    const [rows, setRows] = useState<ProposalRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/organizer/proposals', { cache: 'no-store' });
            if (res.ok) setRows(((await res.json()).proposals as ProposalRow[]) || []);
        } catch {
            // best-effort: sin propuestas visibles
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const act = async (emailId: string, action: 'accept' | 'dismiss') => {
        setBusy(emailId);
        setError(null);
        try {
            const res = await fetch(`/api/organizer/proposals/${encodeURIComponent(emailId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action }),
            });
            if (res.ok || res.status === 404) {
                setRows((prev) => prev.filter((r) => r.emailId !== emailId));
                if (action === 'accept' && res.ok) {
                    await invalidate(LABELS_CACHE_KEY);
                    await invalidate(/^emails-/);
                }
            } else {
                setError(t('organizer.proposals.failed'));
            }
        } catch {
            setError(t('organizer.proposals.failed'));
        } finally {
            setBusy(null);
        }
    };

    if (loading || rows.length === 0) return null;

    return (
        <section className="mt-8 space-y-3" aria-labelledby="organizer-proposals-title">
            <div>
                <h3 id="organizer-proposals-title" className="text-lg font-medium">{t('organizer.proposals.title')}</h3>
                <p className="text-sm text-muted-foreground">{t('organizer.proposals.description')}</p>
            </div>
            {error && <div role="alert" className="text-sm text-destructive">{error}</div>}
            <ul className="divide-y rounded-lg border">
                {rows.map((r) => {
                    const canAccept = !!r.labelName;
                    const label = r.labelName ? labelDisplayName(r.labelName, t) : t('organizer.labels.spam');
                    return (
                        <li key={r.emailId} className="flex items-center gap-3 p-3">
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium">{r.subject || t('organizer.proposals.noSubject')}</div>
                                <div className="truncate text-xs text-muted-foreground">{r.from}</div>
                                <div className="mt-1 text-xs">
                                    <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{label}</span>
                                    <span className="ml-2 text-muted-foreground">{t('organizer.proposals.confidence', { pct: Math.round(r.confidence * 100) })}</span>
                                </div>
                            </div>
                            {canAccept && (
                                <button
                                    type="button"
                                    disabled={busy === r.emailId}
                                    onClick={() => act(r.emailId, 'accept')}
                                    aria-label={t('organizer.proposals.acceptAria', { label })}
                                    className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                                >
                                    {busy === r.emailId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                    {t('organizer.proposals.accept')}
                                </button>
                            )}
                            <button
                                type="button"
                                disabled={busy === r.emailId}
                                onClick={() => act(r.emailId, 'dismiss')}
                                className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium disabled:opacity-50"
                            >
                                <X className="h-3.5 w-3.5" />
                                {t('organizer.proposals.dismiss')}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
