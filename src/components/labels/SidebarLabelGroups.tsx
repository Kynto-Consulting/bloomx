'use client';

import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Folder, HelpCircle, Plus, Tag } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { Popover } from '@/components/ui/Popover';
import { cn } from '@/lib/utils';
import type { LabelRef } from '@/lib/mail-list';
import { groupLabelIds, type LabelGroupKey } from '@/lib/labels/groups';
import { LabelTree } from './LabelTree';

const COLLAPSED_KEY = 'bloomx.labelGroups.collapsed';
export const LABELS_DOCS_HREF = '/docs/features#folders-labels';

/** Boton "?" con el popover "Carpeta o etiqueta?". */
export function LabelsHelp() {
    const { t } = useI18n();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLButtonElement>(null);
    return (
        <>
            <button ref={ref} type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="dialog" aria-expanded={open}
                title={t('labelTree.groups.help.button')} aria-label={t('labelTree.groups.help.button')}
                className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <HelpCircle aria-hidden="true" className="h-3 w-3" />
            </button>
            <Popover trigger={ref} isOpen={open} onClose={() => setOpen(false)} width={288}>
                <div role="dialog" aria-label={t('labelTree.groups.help.title')} className="space-y-2 p-3 text-xs">
                    <p className="text-sm font-semibold">{t('labelTree.groups.help.title')}</p>
                    <p className="flex gap-2"><Folder aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{t('labelTree.groups.help.folder')}</span></p>
                    <p className="flex gap-2"><Tag aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{t('labelTree.groups.help.tag')}</span></p>
                    <p className="text-muted-foreground">{t('labelTree.groups.help.same')}</p>
                    <p className="text-muted-foreground">{t('labelTree.groups.help.example')}</p>
                    <div className="flex items-center justify-between pt-1">
                        <Link href={LABELS_DOCS_HREF} className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('labelTree.groups.help.docs')}</Link>
                        <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 py-1 text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('labelTree.groups.help.close')}</button>
                    </div>
                </div>
            </Popover>
        </>
    );
}

/** Menu "+": Nueva etiqueta / Nueva carpeta, con una linea que explica la diferencia. */
export function NewLabelMenu({ onPick, active }: { onPick: (kind: LabelGroupKey) => void; active?: LabelGroupKey | null }) {
    const { t } = useI18n();
    const [open, setOpen] = useState(false);
    const wrap = useRef<HTMLDivElement>(null);
    const items: Array<{ kind: LabelGroupKey; title: string; desc: string; Icon: typeof Tag }> = [
        { kind: 'tag', title: t('labelTree.groups.newTag'), desc: t('labelTree.groups.newTagDesc'), Icon: Tag },
        { kind: 'folder', title: t('labelTree.groups.newFolder'), desc: t('labelTree.groups.newFolderDesc'), Icon: Folder },
    ];
    useEffect(() => {
        if (!open) return;
        wrap.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
        const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
        document.addEventListener('mousedown', away);
        return () => document.removeEventListener('mousedown', away);
    }, [open]);
    const onKey = (e: React.KeyboardEvent) => {
        const els = Array.from(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
        const i = els.indexOf(document.activeElement as HTMLElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); wrap.current?.querySelector<HTMLElement>('button[aria-haspopup]')?.focus(); }
    };
    return (
        <div ref={wrap} className="relative" onKeyDown={onKey}>
            <button type="button" aria-haspopup="menu" aria-expanded={open || !!active} onClick={() => setOpen((v) => !v)}
                title={t('labelTree.groups.newMenu')} aria-label={t('labelTree.groups.newMenu')}
                className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Plus aria-hidden="true" className="h-3 w-3" />
            </button>
            {open && (
                <div role="menu" aria-label={t('labelTree.groups.newMenu')} className="absolute right-0 top-full z-50 mt-1 w-64 max-w-[calc(100vw-1.5rem)] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg">
                    {items.map(({ kind, title, desc, Icon }) => (
                        <button key={kind} type="button" role="menuitem" onClick={() => { setOpen(false); onPick(kind); }}
                            className="flex w-full items-start gap-2 rounded-md px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none">
                            <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                            <span className="min-w-0"><span className="block text-sm font-medium">{title}</span><span className="block text-xs text-muted-foreground">{desc}</span></span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

type TreeProps = Omit<ComponentProps<typeof LabelTree>, 'group' | 'labels' | 'mode'>;

/** Dos grupos colapsables dentro de la seccion: Carpetas (behavior folder) y Etiquetas (behavior tag). */
export function SidebarLabelGroups({ labels, onCreate, ...tree }: TreeProps & { labels: LabelRef[]; onCreate: (kind: LabelGroupKey) => void }) {
    const { t } = useI18n();
    const [collapsed, setCollapsed] = useState<Record<LabelGroupKey, boolean>>({ folder: false, tag: false });
    useEffect(() => {
        try { const v = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) || '{}'); setCollapsed({ folder: !!v.folder, tag: !!v.tag }); } catch { /* sin almacenamiento */ }
    }, []);
    const toggle = (k: LabelGroupKey) => setCollapsed((c) => {
        const n = { ...c, [k]: !c[k] };
        try { window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(n)); } catch { /* sin almacenamiento */ }
        return n;
    });
    const groups = useMemo(() => groupLabelIds(labels), [labels]);
    const defs: Array<{ key: LabelGroupKey; title: string; empty: string; cta: string }> = [
        { key: 'folder', title: t('labelTree.groups.folders'), empty: t('labelTree.groups.emptyFolders'), cta: t('labelTree.groups.createFolder') },
        { key: 'tag', title: t('labelTree.groups.tags'), empty: t('labelTree.groups.emptyTags'), cta: t('labelTree.groups.createTag') },
    ];
    return (
        <div className="space-y-2">
            {defs.map(({ key, title, empty, cta }) => {
                const n = groups[key].size;
                const isCollapsed = collapsed[key];
                const bodyId = `label-group-${key}`;
                return (
                    <section key={key} data-label-group={key} aria-label={title}>
                        <button type="button" onClick={() => toggle(key)} aria-expanded={!isCollapsed} aria-controls={bodyId}
                            title={t(isCollapsed ? 'labelTree.groups.expand' : 'labelTree.groups.collapse', { name: title })}
                            className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            {isCollapsed ? <ChevronRight aria-hidden="true" className="h-3 w-3 shrink-0" /> : <ChevronDown aria-hidden="true" className="h-3 w-3 shrink-0" />}
                            <span className="truncate">{title}</span>
                            <span className="ml-auto tabular-nums" aria-label={t('labelTree.groups.items', { n })}>{n}</span>
                        </button>
                        <div id={bodyId} hidden={isCollapsed}>
                            {!isCollapsed && (n === 0 ? (
                                <div className="mx-2 mt-1 rounded border border-dashed border-sidebar-border px-3 py-3 text-center text-xs text-muted-foreground">
                                    <p>{empty}</p>
                                    <button type="button" onClick={() => onCreate(key)} className="mt-2 rounded-md bg-sidebar-accent px-2 py-1 font-medium text-sidebar-accent-foreground hover:bg-sidebar-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{cta}</button>
                                </div>
                            ) : (
                                <LabelTree {...tree} labels={labels} group={key} />
                            ))}
                        </div>
                    </section>
                );
            })}
        </div>
    );
}
