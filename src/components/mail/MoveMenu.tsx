'use client';

import { useMemo, type RefObject } from 'react';
import { Archive, Inbox, Plus, ShieldAlert, Trash2, type LucideIcon } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { labelDisplayName } from '@/lib/organizer/labels';
import type { LabelRef } from '@/lib/mail-list';
import { moveTargets } from '@/lib/mail-actions';
import { ActionMenu, type MenuItemDef } from './ActionMenu';

const FOLDER_ICONS: Record<string, LucideIcon> = { inbox: Inbox, archive: Archive, spam: ShieldAlert, trash: Trash2 };

interface Props {
    open: boolean;
    onClose: () => void;
    anchorRef: RefObject<HTMLElement | null>;
    /** `move`: carpetas + etiquetas ("Mover a..."). `label`: solo etiquetas. */
    mode: 'move' | 'label';
    /** Carpeta actual (se omite de los destinos). */
    currentFolder: string;
    labels: LabelRef[];
    loading?: boolean;
    /** Estado de una etiqueta sobre la seleccion: todos / algunos / ninguno. */
    labelState: (labelId: string) => 'all' | 'some' | 'none';
    onMove?: (folder: string) => void;
    onToggleLabel: (label: LabelRef) => void;
    onCreateLabel?: () => void;
}

/** Menu "Mover a..." con todas las carpetas de destino y las etiquetas (con casilla), o solo las etiquetas. */
export function MoveMenu({ open, onClose, anchorRef, mode, currentFolder, labels, loading, labelState, onMove, onToggleLabel, onCreateLabel }: Props) {
    const { t } = useI18n();

    const items = useMemo<MenuItemDef[]>(() => {
        const list: MenuItemDef[] = [];
        if (mode === 'move') {
            for (const folder of moveTargets(currentFolder)) {
                const Icon = FOLDER_ICONS[folder] ?? Inbox;
                list.push({
                    id: `folder:${folder}`,
                    label: t(`sidebar.folders.${folder}`),
                    icon: <Icon className="h-4 w-4" />,
                    onSelect: () => onMove?.(folder),
                });
            }
        }
        labels.forEach((label, i) => {
            const state = labelState(label.id);
            list.push({
                id: `label:${label.id}`,
                label: labelDisplayName(label.name, t),
                dot: label.color || '',
                checkbox: true,
                checked: state === 'all' ? true : state === 'some' ? 'mixed' : false,
                keepOpen: true,
                separatorBefore: mode === 'move' && i === 0,
                onSelect: () => onToggleLabel(label),
            });
        });
        if (onCreateLabel) {
            list.push({
                id: 'create-label',
                label: t('emailList.menu.createLabel'),
                icon: <Plus className="h-4 w-4" />,
                separatorBefore: true,
                onSelect: onCreateLabel,
            });
        }
        return list;
    }, [mode, currentFolder, labels, labelState, onMove, onToggleLabel, onCreateLabel, t]);

    return (
        <ActionMenu
            open={open}
            onClose={onClose}
            anchorRef={anchorRef}
            label={mode === 'move' ? t('emailList.menu.moveTo') : t('emailList.menu.labels')}
            heading={mode === 'move' ? t('emailList.menu.moveTo') : t('emailList.menu.labels')}
            items={items}
            loading={loading}
            loadingText={t('common.loading')}
            emptyText={t('emailList.bulk.noLabels')}
        />
    );
}
