'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Check } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { LABEL_ICONS, descendantsOf, type LabelIcon, type LabelRow } from '@/lib/labels/model';
import { LABEL_PALETTE } from '@/lib/labels/palette';
import { cn } from '@/lib/utils';
import { ICON_COMPONENTS } from './labelIcons';

export interface LabelMenuActions {
    rename: () => void;
    newSub: () => void;
    setColor: (c: string) => void;
    setIcon: (i: LabelIcon | null) => void;
    setBehavior: (b: 'tag' | 'folder') => void;
    moveTo: (parentId: string | null) => void;
    toggleSidebar: () => void;
    autoAssign?: () => void;
    remove: () => void;
}

interface Props {
    label: LabelRow;
    labels: LabelRow[];
    at: { x: number; y: number };
    actions: LabelMenuActions;
    onClose: () => void;
}

type View = 'main' | 'move' | 'color' | 'icon';

export function LabelMenu({ label, labels, at, actions, onClose }: Props) {
    const { t } = useI18n();
    const ref = useRef<HTMLDivElement>(null);
    const [view, setView] = useState<View>('main');
    const [pos, setPos] = useState(at);

    // Mantiene el menu dentro de la ventana.
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        setPos({ x: Math.max(8, Math.min(at.x, window.innerWidth - r.width - 8)), y: Math.max(8, Math.min(at.y, window.innerHeight - r.height - 8)) });
    }, [at, view]);

    useEffect(() => { ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(); }, [view]);
    useEffect(() => {
        const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
        document.addEventListener('mousedown', away);
        return () => document.removeEventListener('mousedown', away);
    }, [onClose]);

    const blocked = useMemo(() => new Set([label.id, ...descendantsOf(label.id, labels)]), [label.id, labels]);
    const targets = useMemo(() => {
        const byId = new Map(labels.map((l) => [l.id, l]));
        const depth = (l: LabelRow) => { let d = 0; let c: LabelRow | undefined = l; const seen = new Set<string>(); while (c?.parentId && !seen.has(c.id)) { seen.add(c.id); d++; c = byId.get(c.parentId); } return d; };
        return [...labels].sort((a, b) => a.fullPath.localeCompare(b.fullPath)).filter((l) => !blocked.has(l.id)).map((l) => ({ l, depth: depth(l) }));
    }, [labels, blocked]);

    const onKey = (e: React.KeyboardEvent) => {
        const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
        const i = items.indexOf(document.activeElement as HTMLElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
        else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); }
        else if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (view === 'main') onClose(); else setView('main'); }
        else if (e.key === 'Tab') onClose();
    };

    const item = 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-popover-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:bg-accent';
    const run = (fn: () => void) => () => { fn(); onClose(); };

    return (
        <div
            ref={ref}
            role="menu"
            aria-label={t('labelTree.menu.title', { name: label.name })}
            onKeyDown={onKey}
            style={{ position: 'fixed', left: pos.x, top: pos.y }}
            className="z-50 max-h-[70vh] w-60 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
            {view !== 'main' && (
                <button type="button" role="menuitem" className={cn(item, 'font-medium')} onClick={() => setView('main')}>
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" /> {t('labelTree.menu.back')}
                </button>
            )}
            {view === 'main' && (
                <>
                    <button type="button" role="menuitem" className={item} onClick={run(actions.rename)}>{t('labelTree.menu.rename')}</button>
                    <button type="button" role="menuitem" className={item} onClick={run(actions.newSub)}>{t('labelTree.menu.newSub')}</button>
                    <button type="button" role="menuitem" className={item} onClick={() => setView('color')}>{t('labelTree.menu.color')}</button>
                    <button type="button" role="menuitem" className={item} onClick={() => setView('icon')}>{t('labelTree.menu.icon')}</button>
                    <button type="button" role="menuitem" className={item} onClick={run(() => actions.setBehavior(label.behavior === 'folder' ? 'tag' : 'folder'))}>
                        {label.behavior === 'folder' ? t('labelTree.menu.asTag') : t('labelTree.menu.asFolder')}
                    </button>
                    <button type="button" role="menuitem" className={item} onClick={() => setView('move')}>{t('labelTree.menu.moveTo')}</button>
                    <button type="button" role="menuitem" className={item} onClick={run(actions.toggleSidebar)}>
                        {label.showInSidebar ? t('labelTree.menu.hide') : t('labelTree.menu.show')}
                    </button>
                    {actions.autoAssign && <button type="button" role="menuitem" className={item} onClick={run(actions.autoAssign)}>{t('labelTree.menu.autoAssign')}</button>}
                    <div role="separator" className="my-1 h-px bg-border" />
                    <button type="button" role="menuitem" className={cn(item, 'text-destructive hover:text-destructive')} onClick={run(actions.remove)}>{t('labelTree.menu.delete')}</button>
                </>
            )}
            {view === 'color' && (
                <div role="group" aria-label={t('labelTree.menu.color')} className="grid grid-cols-6 gap-1 p-2">
                    {LABEL_PALETTE.map((c) => (
                        <button key={c} type="button" role="menuitem" aria-label={c} aria-current={label.color === c ? 'true' : undefined}
                            onClick={run(() => actions.setColor(c))}
                            className="flex h-7 w-7 items-center justify-center rounded-full ring-1 ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            style={{ backgroundColor: c }}>
                            {label.color?.toLowerCase() === c && <Check className="h-3 w-3 text-background" aria-hidden="true" />}
                        </button>
                    ))}
                </div>
            )}
            {view === 'icon' && (
                <div role="group" aria-label={t('labelTree.menu.icon')} className="grid grid-cols-6 gap-1 p-2">
                    <button type="button" role="menuitem" className={cn(item, 'col-span-6 justify-center')} onClick={run(() => actions.setIcon(null))}>{t('labelTree.menu.iconDefault')}</button>
                    {LABEL_ICONS.map((id) => {
                        const Icon = ICON_COMPONENTS[id];
                        return (
                            <button key={id} type="button" role="menuitem" aria-label={t(`labelTree.icons.${id}`)} title={t(`labelTree.icons.${id}`)}
                                aria-current={label.icon === id ? 'true' : undefined} onClick={run(() => actions.setIcon(id))}
                                className={cn('flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:bg-accent', label.icon === id && 'bg-accent')}>
                                <Icon className="h-4 w-4" aria-hidden="true" />
                            </button>
                        );
                    })}
                </div>
            )}
            {view === 'move' && (
                <div role="group" aria-label={t('labelTree.menu.moveTo')}>
                    <button type="button" role="menuitem" className={item} disabled={!label.parentId} onClick={run(() => actions.moveTo(null))}>{t('labelTree.menu.moveToRoot')}</button>
                    {targets.map(({ l, depth }) => (
                        <button key={l.id} type="button" role="menuitem" disabled={l.id === label.parentId} className={cn(item, 'disabled:opacity-50')}
                            style={{ paddingLeft: 12 + depth * 12 }} onClick={run(() => actions.moveTo(l.id))}>
                            <span className="truncate">{l.name}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
