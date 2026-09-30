'use client';

import { useState } from 'react';
import { Loader2, Play } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { rulesApi, type PreviewData } from '@/lib/rules/client';
import { validateConditionsV2, type ConditionsV2 } from '@/lib/rules/conditions';
import { inputCls } from './ConditionInputs';

/** Pestana "Probar": evalua las condiciones contra los ultimos 50/200 correos reales (solo lectura, sin ningun efecto). */
export function RuleTester({ conditions }: { conditions: ConditionsV2 }) {
    const { t } = useI18n();
    const [limit, setLimit] = useState<50 | 200>(50);
    const [busy, setBusy] = useState(false);
    const [data, setData] = useState<PreviewData | null>(null);
    const [error, setError] = useState<string | null>(null);

    const run = async () => {
        setError(null);
        const v = validateConditionsV2(conditions);
        if (!v.ok) { setData(null); setError(v.error); return; }
        setBusy(true);
        const r = await rulesApi.preview(v.value, limit);
        setBusy(false);
        if (!r.ok) { setError(r.status === 429 ? t('ruleBuilder.test.tooMany') : r.error || t('ruleBuilder.test.failed')); return; }
        setData(r.data!);
    };
    const fmt = (iso: string | null) => (iso ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso)) : '');

    return (
        <section aria-label={t('ruleBuilder.test.title')} className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('ruleBuilder.test.help')}</p>
            <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-sm text-foreground">
                    {t('ruleBuilder.test.last')}
                    <select value={limit} onChange={(e) => setLimit(Number(e.target.value) as 50 | 200)} className={`${inputCls} pr-7`}>
                        <option value={50}>50</option>
                        <option value={200}>200</option>
                    </select>
                </label>
                <button type="button" onClick={() => { void run(); }} disabled={busy} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />} {t('ruleBuilder.test.run')}
                </button>
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {data && (
                <div aria-live="polite">
                    <p className="text-sm font-medium text-foreground">{t('ruleBuilder.test.summary', { matched: data.matched, evaluated: data.evaluated })}</p>
                    {data.unknown > 0 && <p className="text-xs text-muted-foreground">{t('ruleBuilder.test.unknown', { n: data.unknown })}</p>}
                    {data.samples.length === 0 ? (
                        <p className="mt-2 text-sm text-muted-foreground">{t('ruleBuilder.test.none')}</p>
                    ) : (
                        <ul className="mt-2 max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
                            {data.samples.map((s) => (
                                <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                                    <span className={s.state === 'match' ? 'rounded bg-success/15 px-2 py-0.5 text-xs text-success' : 'rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground'}>
                                        {s.state === 'match' ? t('ruleBuilder.test.match') : t('ruleBuilder.test.noData')}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-foreground">{s.subject || t('ruleBuilder.test.noSubject')}</span>
                                        <span className="block truncate text-xs text-muted-foreground">{s.from}</span>
                                    </span>
                                    <span className="shrink-0 text-xs text-muted-foreground">{fmt(s.date)}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </section>
    );
}
