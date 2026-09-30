'use client';

import { AlertTriangle, Archive, File, Filter, Inbox, Clock, RefreshCw, Search, Send, ShieldCheck, Tag, Trash2, type LucideIcon } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';

const FOLDER_ICON: Record<string, LucideIcon> = {
    inbox: Inbox, sent: Send, drafts: File, scheduled: Clock, archive: Archive, trash: Trash2, spam: ShieldCheck,
};

export type EmptyKind = 'folder' | 'search' | 'label' | 'filter' | 'error';

interface Props {
    kind: EmptyKind;
    folder: string;
    query?: string;
    label?: string;
    onRetry?: () => void;
    onClearFilter?: () => void;
}

/** Estado vacio ilustrado (icono de lucide, sin imagenes externas) con texto util segun carpeta/busqueda/filtro. */
export function EmptyState({ kind, folder, query, label, onRetry, onClearFilter }: Props) {
    const { t } = useI18n();
    const folderName = t(`sidebar.folders.${folder}`);
    let Icon: LucideIcon = FOLDER_ICON[folder] ?? Inbox;
    let title: string;
    let hint: string;
    if (kind === 'error') {
        Icon = AlertTriangle;
        title = t('emailList.loadError.title');
        hint = t('emailList.loadError.help');
    } else if (kind === 'search') {
        Icon = Search;
        title = t('emailList.empty.title');
        hint = t('emailList.empty.search', { q: query || '' });
    } else if (kind === 'label') {
        Icon = Tag;
        title = t('emailList.empty.title');
        hint = t('emailList.empty.withLabel', { label: label || '', folder: folderName.toLowerCase() });
    } else if (kind === 'filter') {
        Icon = Filter;
        title = t('emailList.empty.filterTitle');
        hint = t('emailList.empty.filterHint');
    } else {
        title = t(`emailList.empty.folders.${folder}.title`);
        hint = t(`emailList.empty.folders.${folder}.hint`);
        if (title === `emailList.empty.folders.${folder}.title`) {
            title = t('emailList.empty.title');
            hint = t('emailList.empty.folder', { folder: folderName.toLowerCase() });
        }
    }
    return (
        <div
            role={kind === 'error' ? 'alert' : 'status'}
            data-empty-kind={kind}
            className="flex min-h-64 flex-col items-center justify-center gap-1 px-6 py-10 text-center"
        >
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Icon className="h-7 w-7" aria-hidden="true" />
            </div>
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="max-w-xs text-xs text-muted-foreground">{hint}</p>
            {kind === 'error' && onRetry && (
                <button type="button" onClick={onRetry} className="mt-3 inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> {t('emailList.loadError.retry')}
                </button>
            )}
            {kind === 'filter' && onClearFilter && (
                <button type="button" onClick={onClearFilter} className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {t('emailList.filters.clear')}
                </button>
            )}
        </div>
    );
}
