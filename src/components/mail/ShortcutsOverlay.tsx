'use client';

import { X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useI18n } from '@/components/I18nProvider';
import { SHORTCUT_DEFS, type ShortcutGroup } from '@/lib/shortcuts';

const GROUPS: ShortcutGroup[] = ['navigate', 'act', 'compose'];

interface Props { open: boolean; onClose: () => void }

/** Ayuda de atajos (?): la lista sale de SHORTCUT_DEFS, el mismo registro que usa el manejador de teclado. */
export function ShortcutsOverlay({ open, onClose }: Props) {
    const { t } = useI18n();
    return (
        <Modal open={open} onClose={onClose} panelClassName="w-full max-w-2xl rounded-xl border border-border p-5 shadow-xl max-h-[85vh] overflow-y-auto">
            {({ titleId }) => (
                <div>
                    <div className="flex items-start justify-between gap-3">
                        <h2 id={titleId} className="text-base font-semibold">{t('emailList.shortcuts.title')}</h2>
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label={t('common.close')}
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{t('emailList.shortcuts.hint')}</p>
                    <div className="mt-4 grid gap-6 sm:grid-cols-2">
                        {GROUPS.map((group) => (
                            <section key={group} aria-labelledby={`bx-sc-${group}`}>
                                <h3 id={`bx-sc-${group}`} className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    {t(`emailList.shortcuts.groups.${group}`)}
                                </h3>
                                <dl className="space-y-1.5">
                                    {SHORTCUT_DEFS.filter((d) => d.group === group).map((d) => (
                                        <div key={d.id} className="flex items-center justify-between gap-3 text-sm">
                                            <dt>{t(d.labelKey)}</dt>
                                            <dd className="flex shrink-0 items-center gap-1">
                                                {d.display.map((k) => (
                                                    <kbd key={k} className="min-w-6 rounded border border-border bg-muted px-1.5 py-0.5 text-center text-xs font-medium">{k}</kbd>
                                                ))}
                                            </dd>
                                        </div>
                                    ))}
                                </dl>
                            </section>
                        ))}
                    </div>
                </div>
            )}
        </Modal>
    );
}
