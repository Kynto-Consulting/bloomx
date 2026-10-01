'use client';

import { useClientVersion } from '@/lib/pwa/useClientVersion';
import { useI18n } from '@/components/I18nProvider';

/** Aviso discreto de version nueva; bloqueante solo cuando la actualizacion es obligatoria. */
export function ClientUpdateBanner() {
    const { status, apply, hasUnsavedWork, accepted } = useClientVersion();
    const { t } = useI18n();
    if (status === 'current') return null;

    if (status === 'mandatory') {
        return (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4" role="alertdialog" aria-modal="true" aria-labelledby="bx-update-title">
                <div role="status" className="max-w-sm rounded-lg border border-border bg-card text-card-foreground p-5 shadow-lg text-center">
                    <p id="bx-update-title" className="font-medium">{t('pwaUpdate.mandatory')}</p>
                    <button type="button" onClick={apply} className="mt-4 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                        {t('pwaUpdate.updateNow')}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div role="status" aria-live="polite" className="fixed bottom-4 left-1/2 z-[90] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-card px-4 py-2 text-sm text-card-foreground shadow-md">
            <span>{accepted && hasUnsavedWork ? t('pwaUpdate.waitingDraft') : t('pwaUpdate.available')}</span>
            {!accepted && (
                <button type="button" onClick={apply} className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                    {t('pwaUpdate.update')}
                </button>
            )}
        </div>
    );
}
