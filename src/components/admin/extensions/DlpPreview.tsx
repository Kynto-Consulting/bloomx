'use client';

import { useId, useMemo, useState } from 'react';
import { Card, btnOutline, inputClass } from '@/components/admin/console';
import { useI18n } from '@/components/I18nProvider';
import { runDlpPreview, type DlpPreviewResult } from '@/lib/admin/dlp-preview';
import type { FormState } from '@/lib/admin/extensions-config';
import { splitListInput } from '@/lib/expansions/settings-schema';

const asList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? splitListInput(v) : []);

/**
 * "Probar con texto de ejemplo": ejecuta en el navegador una vista previa APROXIMADA del DLP con la configuracion del formulario
 * (incluidos los cambios sin guardar). El texto no se envia a ningun sitio y el resultado solo lista categorias.
 */
export function DlpPreview({ form }: { form: FormState }) {
    const { t } = useI18n();
    const id = useId();
    const [text, setText] = useState('');
    const [result, setResult] = useState<DlpPreviewResult | null>(null);

    const config = useMemo(() => ({ keywords: asList(form.keywords), detectors: asList(form.detectors), customPatterns: asList(form.customPatterns) }), [form]);

    return (
        <Card title={t('admin.console.extensions.config.dlp.title')} headingLevel={3}>
            <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{t('admin.console.extensions.config.dlp.help')}</p>
                <div className="space-y-1">
                    <label htmlFor={`${id}-text`} className="block text-sm font-medium text-foreground">{t('admin.console.extensions.config.dlp.label')}</label>
                    <textarea
                        id={`${id}-text`}
                        rows={4}
                        value={text}
                        onChange={(e) => { setText(e.target.value); setResult(null); }}
                        maxLength={20000}
                        autoComplete="off"
                        spellCheck={false}
                        className={`${inputClass} h-auto py-2 font-mono`}
                    />
                </div>
                <button type="button" className={btnOutline} disabled={text.trim() === ''} onClick={() => setResult(runDlpPreview(text, config))}>
                    {t('admin.console.extensions.config.dlp.run')}
                </button>
                <div role="status" aria-live="polite" className="text-sm">
                    {result && (result.categories.length === 0 ? (
                        <p className="text-foreground">{t('admin.console.extensions.config.dlp.none')}</p>
                    ) : (
                        <div>
                            <p className="font-medium text-foreground">{t('admin.console.extensions.config.dlp.found')}</p>
                            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-foreground">
                                {result.categories.map((c) => (
                                    <li key={c.id}>{t(`admin.console.extensions.config.dlp.cat.${c.id}`, { count: c.count })}</li>
                                ))}
                            </ul>
                        </div>
                    ))}
                    {result && result.ignoredPatterns.length > 0 && (
                        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                            {result.ignoredPatterns.map((p) => (
                                <li key={p.index}>{t('admin.console.extensions.config.dlp.ignored', { n: p.index + 1, problem: p.problem })}</li>
                            ))}
                        </ul>
                    )}
                </div>
                <p className="text-xs text-muted-foreground">{t('admin.console.extensions.config.dlp.note')}</p>
            </div>
        </Card>
    );
}
