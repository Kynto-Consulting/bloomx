'use client';

import { useMemo, useRef, useState } from 'react';
import { LayoutList } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { DENSITIES, SORTS, type MailPrefs, type SnippetLines } from '@/lib/mail-prefs';
import { ActionMenu, type MenuItemDef } from './ActionMenu';
import { IconButton } from './ui';

interface Props {
    prefs: MailPrefs;
    onChange: (patch: Partial<MailPrefs>) => void;
    className?: string;
}

const SNIPPET_OPTIONS: SnippetLines[] = [0, 1, 2];

/** Menu "Vista": densidad, vista previa del cuerpo (0/1/2 lineas), orden y encabezados por fecha. Se guarda solo. */
export function ViewMenu({ prefs, onChange, className }: Props) {
    const { t } = useI18n();
    const [open, setOpen] = useState(false);
    const anchorRef = useRef<HTMLButtonElement | null>(null);

    const items = useMemo<MenuItemDef[]>(() => {
        const list: MenuItemDef[] = [];
        DENSITIES.forEach((d, i) => list.push({
            id: `density:${d}`,
            label: t(`emailList.view.density.${d}`),
            radio: true,
            checked: prefs.density === d,
            groupLabel: i === 0 ? t('emailList.view.densityTitle') : undefined,
            keepOpen: true,
            onSelect: () => onChange({ density: d }),
        }));
        SNIPPET_OPTIONS.forEach((n, i) => list.push({
            id: `snippet:${n}`,
            label: t(`emailList.view.preview.${n}`),
            radio: true,
            checked: prefs.snippetLines === n,
            groupLabel: i === 0 ? t('emailList.view.previewTitle') : undefined,
            separatorBefore: i === 0,
            keepOpen: true,
            onSelect: () => onChange({ snippetLines: n }),
        }));
        SORTS.forEach((s, i) => list.push({
            id: `sort:${s}`,
            label: t(`emailList.view.sort.${s}`),
            radio: true,
            checked: prefs.sort === s,
            groupLabel: i === 0 ? t('emailList.view.sortTitle') : undefined,
            separatorBefore: i === 0,
            keepOpen: true,
            onSelect: () => onChange({ sort: s }),
        }));
        list.push({
            id: 'group-by-date',
            label: t('emailList.view.groupByDate'),
            checkbox: true,
            checked: prefs.groupByDate,
            separatorBefore: true,
            keepOpen: true,
            onSelect: () => onChange({ groupByDate: !prefs.groupByDate }),
        });
        return list;
    }, [prefs, onChange, t]);

    return (
        <>
            <IconButton
                ref={anchorRef}
                label={t('emailList.view.title')}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className={className}
            >
                <LayoutList className="h-4 w-4" aria-hidden="true" />
            </IconButton>
            <ActionMenu open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} label={t('emailList.view.title')} heading={t('emailList.view.title')} items={items} />
        </>
    );
}
