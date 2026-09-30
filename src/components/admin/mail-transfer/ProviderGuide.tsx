'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { formatBytes } from '@/components/admin/console';

const PROVIDERS = [
    { id: 'gmail', steps: 4 },
    { id: 'titan', steps: 3 },
    { id: 'outlook', steps: 3 },
    { id: 'thunderbird', steps: 3 },
    { id: 'apple', steps: 2 },
] as const;

/** Guia por proveedor (Gmail/Takeout, Titan, Outlook/Hotmail, Thunderbird, Apple Mail): como obtener el archivo. */
export function ProviderGuide({ pstMaxBytes }: { pstMaxBytes: number }) {
    const { t, intlLocale } = useI18n();
    return (
        <section aria-labelledby="mt-guide-title" className="rounded-lg border border-border bg-card">
            <h3 id="mt-guide-title" className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">{t('admin.console.transfer.guide.title')}</h3>
            <div className="divide-y divide-border">
                {PROVIDERS.map((p) => (
                    <details key={p.id} className="group px-4 py-2">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded py-1 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            {t(`admin.console.transfer.guide.${p.id}.name`)}
                            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
                        </summary>
                        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                            {Array.from({ length: p.steps }, (_, i) => (
                                <li key={i}>{t(`admin.console.transfer.guide.${p.id}.s${i + 1}`, { pstMax: formatBytes(pstMaxBytes, intlLocale) })}</li>
                            ))}
                        </ol>
                    </details>
                ))}
            </div>
            <div className="space-y-1 border-t border-border px-4 py-3 text-xs text-muted-foreground">
                <p><span className="font-medium text-foreground">{t('admin.console.transfer.guide.formatsTitle')}: </span>{t('admin.console.transfer.guide.formats')}</p>
                <p>{t('admin.console.transfer.guide.notSupported')}</p>
            </div>
        </section>
    );
}
