'use client';

import { useState } from 'react';
import { useI18n } from '@/components/I18nProvider';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { descendantsOf, type LabelRow } from '@/lib/labels/model';
import { labelsApi } from '@/lib/labels/client';

interface Props {
    label: LabelRow | null;
    labels: LabelRow[];
    onClose: () => void;
    onDeleted: (r: { deleted: string[] }) => void;
}

/** Confirmacion de borrado: explica que pasa con los correos (nunca se borran) y con las subetiquetas. */
export function DeleteLabelDialog({ label, labels, onClose, onDeleted }: Props) {
    const { t } = useI18n();
    const [mode, setMode] = useState<'reparent' | 'delete'>('reparent');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const kids = label ? descendantsOf(label.id, labels) : [];
    const direct = label ? labels.filter((l) => l.parentId === label.id).length : 0;
    const folderLike = label?.behavior === 'folder' || kids.some((k) => labels.find((l) => l.id === k)?.behavior === 'folder');

    const confirm = async () => {
        if (!label) return;
        setBusy(true);
        setError(null);
        const r = await labelsApi.remove(label.id, mode);
        setBusy(false);
        if (!r.ok) { setError(t('labelTree.errors.generic')); return; }
        onDeleted({ deleted: r.data?.deleted ?? [label.id] });
    };

    return (
        <ConfirmDialog
            open={!!label}
            title={t('labelTree.del.title', { name: label?.name ?? '' })}
            description={
                <div className="space-y-3">
                    <p>{t('labelTree.del.emailsSafe')}</p>
                    {folderLike && <p>{t('labelTree.del.folderReturns')}</p>}
                    {direct > 0 && (
                        <fieldset className="space-y-2">
                            <legend className="text-foreground">{t('labelTree.del.hasChildren', { n: kids.length })}</legend>
                            <label className="flex items-start gap-2 text-foreground">
                                <input type="radio" name="del-children" checked={mode === 'reparent'} onChange={() => setMode('reparent')} className="mt-1" />
                                <span>{t('labelTree.del.keepChildren')}</span>
                            </label>
                            <label className="flex items-start gap-2 text-foreground">
                                <input type="radio" name="del-children" checked={mode === 'delete'} onChange={() => setMode('delete')} className="mt-1" />
                                <span>{t('labelTree.del.deleteChildren')}</span>
                            </label>
                        </fieldset>
                    )}
                </div>
            }
            confirmLabel={t('labelTree.del.confirm')}
            cancelLabel={t('labelTree.cancel')}
            destructive
            busy={busy}
            error={error}
            onConfirm={() => { void confirm(); }}
            onCancel={onClose}
        />
    );
}
