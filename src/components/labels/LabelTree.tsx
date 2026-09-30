'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { useI18n } from '@/components/I18nProvider';
import { cn } from '@/lib/utils';
import type { LabelRef } from '@/lib/mail-list';
import { labelDisplayName } from '@/lib/organizer/labels';
import { DEFAULT_LABEL_COLOR } from '@/lib/labels/palette';
import { buildTree, flattenVisible, type LabelIcon, type LabelRow } from '@/lib/labels/model';
import { applyPlan, planDrop, planIndent, planMoveSibling, planOutdent, planPlace, type DropZone, type Plan } from '@/lib/labels/tree-ops';
import { labelsApi } from '@/lib/labels/client';
import { LabelGlyph } from './labelIcons';
import { LabelMenu } from './LabelMenu';
import { DeleteLabelDialog } from './DeleteLabelDialog';

export const LABEL_DND_TYPE = 'application/x-bloomx-label';
const EXPANDED_KEY = 'bloomx.labelTree.expanded';

export function toRows(labels: LabelRef[]): Array<LabelRow & LabelRef> {
    return labels.map((l) => ({
        ...l,
        color: l.color ?? DEFAULT_LABEL_COLOR,
        userId: '',
        parentId: l.parentId ?? null,
        behavior: l.behavior === 'folder' ? 'folder' : 'tag',
        sortOrder: l.sortOrder ?? 0,
        icon: (l.icon as LabelIcon | null | undefined) ?? null,
        showInSidebar: l.showInSidebar !== false,
        showUnread: l.showUnread !== false,
        fullPath: l.fullPath || l.name,
    }));
}

export interface LabelTreeProps {
    labels: LabelRef[];
    /** Rutas completas activas en minuscula (?label=). */
    activePaths?: string[];
    /** Sidebar: enlace que filtra por la etiqueta. Sin el, la fila no navega (Ajustes). */
    getHref?: (label: LabelRef) => string;
    mode?: 'sidebar' | 'settings';
    /** Se llama tras cualquier cambio confirmado por el servidor (recargar etiquetas y contadores). */
    onChanged: () => void;
    /** Arrastrar correos sobre una etiqueta (Sidebar). */
    dropTarget?: string | null;
    onMailDragOver?: (e: DragEvent, label: LabelRef) => void;
    onMailDragLeave?: (label: LabelRef) => void;
    onMailDrop?: (e: DragEvent, label: LabelRef) => void;
    /** Abre el editor completo de la etiqueta (reglas de "Asignar automaticamente"). */
    onEdit?: (label: LabelRef) => void;
    selectedId?: string | null;
}

function loadExpanded(): Set<string> {
    try { return new Set<string>(JSON.parse(window.localStorage.getItem(EXPANDED_KEY) || '[]')); } catch { return new Set(); }
}

export function LabelTree(props: LabelTreeProps) {
    const { labels, activePaths = [], getHref, mode = 'sidebar', onChanged, dropTarget, onMailDragOver, onMailDragLeave, onMailDrop, onEdit, selectedId } = props;
    const { t } = useI18n();
    const [pending, setPending] = useState<LabelRow[] | null>(null);
    const rows = useMemo(() => pending ?? toRows(labels), [pending, labels]);
    useEffect(() => setPending(null), [labels]);

    const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
    const [focusId, setFocusId] = useState<string | null>(null);
    const [menu, setMenu] = useState<{ id: string; at: { x: number; y: number } } | null>(null);
    const [renaming, setRenaming] = useState<string | null>(null);
    const [creating, setCreating] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [hint, setHint] = useState<{ id: string; zone: DropZone } | null>(null);
    const [announce, setAnnounce] = useState('');
    const treeRef = useRef<HTMLDivElement>(null);

    useEffect(() => { setExpanded(loadExpanded()); }, []);
    const persist = (next: Set<string>) => { setExpanded(next); try { window.localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next])); } catch { /* sin almacenamiento */ } };
    const toggle = (id: string, open?: boolean) => { const n = new Set(expanded); if (open ?? !n.has(id)) n.add(id); else n.delete(id); persist(n); };

    // Las ancestras de una etiqueta activa o seleccionada se muestran abiertas.
    const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
    const shownExpanded = useMemo(() => {
        const s = new Set(expanded);
        for (const r of rows) {
            if (activePaths.includes(r.fullPath.toLowerCase()) || r.id === selectedId) {
                let p = r.parentId ? byId.get(r.parentId) : undefined;
                const seen = new Set<string>();
                while (p && !seen.has(p.id)) { seen.add(p.id); s.add(p.id); p = p.parentId ? byId.get(p.parentId) : undefined; }
            }
        }
        if (creating && creating !== 'root') s.add(creating);
        return s;
    }, [expanded, rows, byId, activePaths, selectedId, creating]);

    const visibleRows = useMemo(() => {
        if (mode === 'settings') return rows;
        // Ocultas de la barra: se omiten salvo que tengan descendientes visibles.
        const kids = new Map<string | null, LabelRow[]>();
        for (const r of rows) kids.set(r.parentId && byId.has(r.parentId) ? r.parentId : null, [...(kids.get(r.parentId && byId.has(r.parentId) ? r.parentId : null) ?? []), r]);
        const keep = new Set<string>();
        const visit = (r: LabelRow): boolean => { const any = (kids.get(r.id) ?? []).map(visit).some(Boolean); if (r.showInSidebar || any) keep.add(r.id); return keep.has(r.id); };
        (kids.get(null) ?? []).forEach(visit);
        return rows.filter((r) => keep.has(r.id));
    }, [rows, byId, mode]);

    const flat = useMemo(() => flattenVisible(buildTree(visibleRows), shownExpanded), [visibleRows, shownExpanded]);
    const current = focusId && flat.some((f) => f.node.label.id === focusId) ? focusId : flat[0]?.node.label.id ?? null;
    const focusRow = useCallback((id: string | null) => {
        if (!id) return;
        setFocusId(id);
        requestAnimationFrame(() => treeRef.current?.querySelector<HTMLElement>(`[data-label-id="${CSS.escape(id)}"]`)?.focus());
    }, []);

    const fail = (code?: string) => toast.error(t(`labelTree.errors.${['cycle', 'depth', 'conflict', 'limit', 'network'].includes(code ?? '') ? code : 'generic'}`));

    const runPlan = async (plan: Plan, label: LabelRow, doneKey: 'movedNested' | 'reordered', parentName?: string) => {
        if (!plan.ok) { if (plan.code !== 'noop' && plan.code !== 'self') fail(plan.code); return; }
        setPending(applyPlan(rows, plan.items));
        const r = await labelsApi.reorder(plan.items);
        if (!r.ok) { setPending(null); fail(r.code); return; }
        setAnnounce(t(`labelTree.dnd.${doneKey}`, { name: label.name, parent: parentName ?? '' }));
        onChanged();
    };
    const patch = async (id: string, body: Record<string, unknown>) => {
        const r = await labelsApi.patch(id, body);
        if (!r.ok) { fail(r.code); return false; }
        onChanged();
        return true;
    };

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (renaming || creating) return;
        const target = (e.target as HTMLElement).closest<HTMLElement>('[data-label-id]');
        if (!target || (e.target as HTMLElement).tagName === 'INPUT') return;
        const id = target.dataset.labelId!;
        const i = flat.findIndex((f) => f.node.label.id === id);
        const row = flat[i];
        const label = byId.get(id);
        if (!row || !label) return;
        const go = (j: number) => { e.preventDefault(); focusRow(flat[Math.max(0, Math.min(flat.length - 1, j))]?.node.label.id ?? null); };
        if (e.altKey && !e.ctrlKey && !e.metaKey) {
            const plan = e.key === 'ArrowUp' ? planMoveSibling(rows, id, -1) : e.key === 'ArrowDown' ? planMoveSibling(rows, id, 1)
                : e.key === 'ArrowRight' ? planIndent(rows, id) : e.key === 'ArrowLeft' ? planOutdent(rows, id) : null;
            if (plan) { e.preventDefault(); const np = plan.ok ? plan.items.find((x) => x.id === id)?.parentId : null; void runPlan(plan, label, np ? 'movedNested' : 'reordered', np ? byId.get(np)?.name : ''); }
            return;
        }
        switch (e.key) {
            case 'ArrowDown': go(i + 1); break;
            case 'ArrowUp': go(i - 1); break;
            case 'Home': go(0); break;
            case 'End': go(flat.length - 1); break;
            case 'ArrowRight':
                e.preventDefault();
                if (row.hasChildren && !row.expanded) toggle(id, true); else if (row.hasChildren) go(i + 1);
                break;
            case 'ArrowLeft':
                e.preventDefault();
                if (row.hasChildren && row.expanded) toggle(id, false); else if (row.parentId) focusRow(row.parentId);
                break;
            case 'Enter': case ' ':
                e.preventDefault();
                target.querySelector<HTMLElement>('a[href]')?.click();
                if (mode === 'settings') onEdit?.(label);
                break;
            case 'F2': e.preventDefault(); setRenaming(id); break;
            case 'Delete': e.preventDefault(); setDeleting(id); break;
            case 'ContextMenu': e.preventDefault(); { const r = target.getBoundingClientRect(); setMenu({ id, at: { x: r.left + 24, y: r.bottom } }); } break;
            case 'F10': if (e.shiftKey) { e.preventDefault(); const r = target.getBoundingClientRect(); setMenu({ id, at: { x: r.left + 24, y: r.bottom } }); } break;
            default:
                if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey) {
                    const n = flat.length;
                    for (let k = 1; k <= n; k++) { const f = flat[(i + k) % n]; if (f.node.label.name.toLowerCase().startsWith(e.key.toLowerCase())) { go((i + k) % n); break; } }
                }
        }
    };

    const onDragOver = (e: DragEvent, label: LabelRow) => {
        if (Array.from(e.dataTransfer?.types ?? []).includes(LABEL_DND_TYPE)) {
            e.preventDefault();
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const y = (e.clientY - r.top) / Math.max(1, r.height);
            setHint({ id: label.id, zone: y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside' });
        } else onMailDragOver?.(e, label);
    };
    const onDrop = (e: DragEvent, label: LabelRow) => {
        const dragId = e.dataTransfer?.getData(LABEL_DND_TYPE);
        if (dragId) {
            e.preventDefault();
            const zone = hint?.id === label.id ? hint.zone : 'inside';
            setHint(null);
            const dragged = byId.get(dragId);
            if (dragged) void runPlan(planDrop(rows, dragId, label.id, zone), dragged, zone === 'inside' ? 'movedNested' : 'reordered', label.name);
        } else onMailDrop?.(e, label);
    };

    const submitName = async (kind: 'rename' | 'create', id: string, name: string) => {
        const value = name.trim();
        if (kind === 'rename') {
            setRenaming(null);
            if (value && value !== byId.get(id)?.name) await patch(id, { name: value });
        } else {
            setCreating(null);
            if (!value) return;
            const r = await labelsApi.create({ name: value, parentId: id === 'root' ? null : id });
            if (!r.ok) fail(r.code); else { if (id !== 'root') toggle(id, true); onChanged(); }
        }
    };

    if (rows.length === 0 && mode === 'sidebar') {
        return <div className="mx-2 rounded border border-dashed border-sidebar-border px-4 py-4 text-center text-xs text-muted-foreground">{t('sidebar.noLabels')}</div>;
    }

    const menuLabel = menu ? byId.get(menu.id) : null;
    return (
        <div>
            <div ref={treeRef} role="tree" aria-label={t('labelTree.treeLabel')} aria-describedby="label-tree-hint" onKeyDown={onKeyDown} className="grid gap-0.5">
                {flat.map((f) => {
                    const l = f.node.label as LabelRow & LabelRef;
                    const isActive = activePaths.includes(l.fullPath.toLowerCase());
                    const isSel = mode === 'settings' && selectedId === l.id;
                    const unread = l.showUnread ? (l.count ?? 0) : 0;
                    const total = l.total ?? 0;
                    const name = labelDisplayName(l.name, t);
                    const countLabel = mode === 'sidebar' && unread > 0 ? t('labelTree.unread', { n: unread }) : '';
                    const isDrop = dropTarget === `label:${l.id}`;
                    const hintHere = hint?.id === l.id ? hint.zone : null;
                    const inner = (
                        <>
                            <LabelGlyph behavior={l.behavior} icon={l.icon} color={l.color} open={f.expanded} />
                            <span className={cn('min-w-0 flex-1 truncate', isActive && 'font-bold', !l.showInSidebar && 'italic opacity-70')} title={l.fullPath}>{name}</span>
                            {mode === 'sidebar' && unread > 0 && <span aria-hidden="true" className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold tabular-nums text-primary-foreground">{unread}</span>}
                            {mode === 'sidebar' && total > 0 && <span aria-hidden="true" className={cn('min-w-[1.5rem] text-right text-xs tabular-nums', !isActive && 'text-muted-foreground')}>{total}</span>}
                        </>
                    );
                    const rowCls = 'flex min-h-10 min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-sm font-medium transition-colors focus-visible:outline-none';
                    return (
                        <div key={l.id}>
                            <div
                                role="treeitem"
                                data-label-id={l.id}
                                data-drop-label={l.id}
                                aria-level={f.node.depth}
                                aria-posinset={f.posInSet}
                                aria-setsize={f.setSize}
                                aria-expanded={f.hasChildren ? f.expanded : undefined}
                                aria-selected={isActive || isSel}
                                aria-label={countLabel ? `${name}, ${countLabel}` : undefined}
                                tabIndex={current === l.id ? 0 : -1}
                                draggable={renaming !== l.id}
                                onFocus={() => setFocusId(l.id)}
                                onDragStart={(e) => { e.dataTransfer.setData(LABEL_DND_TYPE, l.id); e.dataTransfer.effectAllowed = 'move'; }}
                                onDragEnd={() => setHint(null)}
                                onDragOver={(e) => onDragOver(e, l)}
                                onDragLeave={() => { setHint((h) => (h?.id === l.id ? null : h)); onMailDragLeave?.(l); }}
                                onDrop={(e) => onDrop(e, l)}
                                onContextMenu={(e) => { e.preventDefault(); setMenu({ id: l.id, at: { x: e.clientX, y: e.clientY } }); }}
                                className={cn(
                                    'group relative flex items-center rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                                    (isActive || isSel) ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent/60',
                                    isDrop && 'ring-2 ring-ring bg-sidebar-accent',
                                    hintHere === 'inside' && 'ring-2 ring-ring bg-sidebar-accent',
                                    hintHere === 'before' && 'before:absolute before:inset-x-2 before:top-0 before:h-0.5 before:bg-primary',
                                    hintHere === 'after' && 'after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-primary',
                                )}
                                style={{ paddingLeft: 4 + (f.node.depth - 1) * 14 }}
                            >
                                {f.hasChildren ? (
                                    <button type="button" tabIndex={-1} aria-label={t(f.expanded ? 'labelTree.collapse' : 'labelTree.expand', { name })}
                                        onClick={() => toggle(l.id)} className="flex h-6 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-sidebar-accent-foreground">
                                        <ChevronRight aria-hidden="true" className={cn('h-3.5 w-3.5 transition-transform', f.expanded && 'rotate-90')} />
                                    </button>
                                ) : <span className="w-5 shrink-0" aria-hidden="true" />}
                                {renaming === l.id ? (
                                    <NameInput initial={l.name} label={t('labelTree.menu.rename')} onDone={(v) => { void submitName('rename', l.id, v); }} onCancel={() => { setRenaming(null); focusRow(l.id); }} />
                                ) : getHref && mode === 'sidebar' ? (
                                    <Link href={getHref(l)} tabIndex={-1} aria-current={isActive ? 'page' : undefined} className={rowCls}>{inner}</Link>
                                ) : (
                                    <button type="button" tabIndex={-1} onClick={() => onEdit?.(l)} className={cn(rowCls, 'text-left')}>{inner}</button>
                                )}
                                <button type="button" tabIndex={-1} aria-haspopup="menu" aria-label={t('labelTree.menu.open', { name })}
                                    onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ id: l.id, at: { x: r.left - 200, y: r.bottom } }); }}
                                    className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-sidebar-accent focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100">
                                    <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
                                </button>
                            </div>
                            {creating === l.id && (
                                <div style={{ paddingLeft: 4 + f.node.depth * 14 + 20 }} className="py-1 pr-2">
                                    <NameInput initial="" label={t('labelTree.newSubPlaceholder')} onDone={(v) => { void submitName('create', l.id, v); }} onCancel={() => { setCreating(null); focusRow(l.id); }} />
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            <p id="label-tree-hint" className="sr-only">{t('labelTree.dnd.hint')}</p>
            <div role="status" aria-live="polite" className="sr-only">{announce}</div>

            {menu && menuLabel && (
                <LabelMenu
                    label={menuLabel}
                    labels={rows}
                    at={menu.at}
                    onClose={() => { const id = menu.id; setMenu(null); focusRow(id); }}
                    actions={{
                        rename: () => setRenaming(menuLabel.id),
                        newSub: () => setCreating(menuLabel.id),
                        setColor: (c) => { void patch(menuLabel.id, { color: c }); },
                        setIcon: (i) => { void patch(menuLabel.id, { icon: i }); },
                        setBehavior: (b) => { void patch(menuLabel.id, { behavior: b }); },
                        moveTo: (p) => { void runPlan(planPlace(rows, menuLabel.id, p, null), menuLabel, 'movedNested', p ? byId.get(p)?.name : ''); },
                        toggleSidebar: () => { void patch(menuLabel.id, { showInSidebar: !menuLabel.showInSidebar }); },
                        autoAssign: onEdit ? () => onEdit(menuLabel) : undefined,
                        remove: () => setDeleting(menuLabel.id),
                    }}
                />
            )}
            <DeleteLabelDialog
                label={deleting ? byId.get(deleting) ?? null : null}
                labels={rows}
                onClose={() => setDeleting(null)}
                onDeleted={() => { setDeleting(null); toast.success(t('labelTree.toast.deleted')); onChanged(); }}
            />
        </div>
    );
}

function NameInput({ initial, label, onDone, onCancel }: { initial: string; label: string; onDone: (v: string) => void; onCancel: () => void }) {
    const [v, setV] = useState(initial);
    const done = useRef(false);
    const finish = (fn: () => void) => { if (done.current) return; done.current = true; fn(); };
    return (
        <input
            autoFocus
            aria-label={label}
            value={v}
            maxLength={50}
            onChange={(e) => setV(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => finish(() => onDone(v))}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') { e.preventDefault(); finish(() => onDone(v)); }
                if (e.key === 'Escape') { e.preventDefault(); finish(onCancel); }
            }}
            className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
    );
}
