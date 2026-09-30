'use client';

/**
 * Barra de acciones de extensiones (EMAIL_TOOLBAR, COMPOSER_TOOLBAR, CALENDAR_TOOLBAR, CONTACTS_TOOLBAR). Un solo componente para las cuatro:
 *
 *   - Solo las acciones ANCLADAS aparecen en la barra, como botones de icono de 32 px (ghost, neutros, con tooltip). Cuantas caben lo
 *     decide un ResizeObserver; el resto queda en el menu.
 *   - Un boton "Extensiones" (destellos + numero) abre un menu con TODAS las acciones, agrupadas por extension, con buscador (mas de 7),
 *     teclado completo y un boton de chincheta por fila para anclar/desanclar. Se guarda por usuario (localStorage + ajustes cifrados).
 *   - Nunca se usa el color primario en una accion de extension.
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Pin, PinOff, Puzzle, Search, Settings2 } from 'lucide-react';
import { JsonRenderer } from '../renderer/JsonRenderer';
import { formatKit, useKitStrings } from '../kit/strings';
import { useExtensionPrefs } from '@/hooks/useExtensionPrefs';
import {
    SEARCH_THRESHOLD, TOOLBAR_BUTTON_COARSE_PX, TOOLBAR_BUTTON_PX, TOOLBAR_GAP_PX, clampLabel, fitPinnedCount, groupByExtension, matchesQuery,
    readLastUsed, resolvePinnedKeys, sortItems, toolbarItemKey, writeLastUsed, type ToolbarItem,
} from '@/lib/expansions/client/toolbar';
import { TOOLBAR_FOCUS, TOOLBAR_ICON_BUTTON_CLASS } from './ToolbarButtons';
import { ToolbarTooltip } from './ToolbarTooltip';
import { ExtensionIcon } from '../ExtensionIcon';

export interface ToolbarMount {
    id?: string;
    priority?: number | string;
    extensionId: string;
    extensionName?: string;
    extensionDescription?: string;
    /** Icono de la extension (manifest.icon): respaldo cuando la accion no declara el suyo. */
    extensionIcon?: string;
    initialState?: Record<string, any>;
    overlays?: Record<string, any>;
    component?: any;
}

interface Props {
    mountPoint: string;
    mounts: ToolbarMount[];
    context: Record<string, any>;
}

const ACTION_TYPES = new Set(['BUTTON', 'ICON_BUTTON']);
const MENU_WIDTH = 320;

const numeric = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback);

/** Convierte los mounts en acciones anclables (BUTTON/ICON_BUTTON) y en piezas "a medida" (cualquier otro tipo), que se pintan tal cual. */
export function buildToolbarItems(mountPoint: string, mounts: ToolbarMount[]): { items: Array<ToolbarItem & { mount: ToolbarMount }>; custom: ToolbarMount[] } {
    const items: Array<ToolbarItem & { mount: ToolbarMount }> = [];
    const custom: ToolbarMount[] = [];
    const seen = new Set<string>();
    mounts.forEach((mount, index) => {
        const type = mount.component?.type;
        const props = mount.component?.props ?? {};
        if (!ACTION_TYPES.has(type)) { if (mount.component) custom.push(mount); return; }
        const hint = props.toolbar && typeof props.toolbar === 'object' ? props.toolbar : {};
        const rawLabel = typeof props.label === 'string' && !props.label.includes('${') ? props.label : '';
        const extensionName = clampLabel(mount.extensionName, mount.extensionId);
        const label = clampLabel(hint.label, clampLabel(rawLabel, extensionName));
        const target = props.onClick && typeof props.onClick === 'object' ? (props.onClick.targetId || props.onClick.function || props.onClick.action) : '';
        // La clave debe sobrevivir a que se instalen/quiten OTRAS extensiones: id del mount, o el nombre; nunca la posicion.
        let key = toolbarItemKey(mount.extensionId, mountPoint, String(mount.id || rawLabel || target || label));
        for (let n = 2; seen.has(key); n++) key = toolbarItemKey(mount.extensionId, mountPoint, `${mount.id || rawLabel || target || label}-${n}`);
        seen.add(key);
        items.push({
            key,
            extensionId: mount.extensionId,
            extensionName,
            label,
            description: clampLabel(hint.description, '') || undefined,
            icon: typeof props.icon === 'string' && props.icon ? props.icon : mount.extensionIcon,
            extensionIcon: mount.extensionIcon,
            manifestPinned: hint.pinned === true,
            priority: numeric(hint.priority, numeric(mount.priority, 500)),
            order: index,
            mount,
        });
    });
    // Una extension con UNA sola accion y sin descripcion propia usa la descripcion de la extension como linea del menu.
    const perExtension = new Map<string, number>();
    items.forEach((i) => perExtension.set(i.extensionId, (perExtension.get(i.extensionId) ?? 0) + 1));
    for (const i of items) {
        if (!i.description && perExtension.get(i.extensionId) === 1 && i.mount.extensionDescription) i.description = clampLabel(i.mount.extensionDescription, '') || undefined;
    }
    return { items, custom };
}

export function ExtensionToolbar({ mountPoint, mounts, context }: Props) {
    const s = useKitStrings();
    const { prefs, setPinned } = useExtensionPrefs();
    const { items: unsorted, custom } = React.useMemo(() => buildToolbarItems(mountPoint, mounts), [mountPoint, mounts]);
    const items = React.useMemo(() => sortItems(unsorted), [unsorted]);
    const pinnedKeys = React.useMemo(() => resolvePinnedKeys(items, prefs.pins), [items, prefs.pins]);

    // ---- ancho disponible
    // Ref como ESTADO: la barra puede montarse vacia (extensiones aun cargando) y pintar su contenedor despues; el observador
    // debe engancharse cuando el contenedor exista, no solo al primer render.
    const [rootEl, setRootEl] = React.useState<HTMLDivElement | null>(null);
    const [available, setAvailable] = React.useState<number | null>(null);
    const [coarse, setCoarse] = React.useState(false);
    React.useEffect(() => {
        const el = rootEl;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const update = () => setAvailable(el.clientWidth);
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, [rootEl]);
    React.useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const mq = window.matchMedia('(pointer: coarse)');
        const update = () => setCoarse(mq.matches);
        update();
        mq.addEventListener?.('change', update);
        return () => mq.removeEventListener?.('change', update);
    }, []);

    const button = coarse ? TOOLBAR_BUTTON_COARSE_PX : TOOLBAR_BUTTON_PX;
    const fit = available === null
        ? pinnedKeys.length
        : fitPinnedCount({ available: available - custom.length * button, count: pinnedKeys.length, button, gap: TOOLBAR_GAP_PX, reserved: button + TOOLBAR_GAP_PX + 9 });
    const visibleKeys = new Set(pinnedKeys.slice(0, fit));
    const visible = items.filter((i) => visibleKeys.has(i.key));

    // ---- ultima usada (un solo indicador discreto por barra)
    const [lastUsed, setLastUsed] = React.useState<string | null>(null);
    React.useEffect(() => { setLastUsed(readLastUsed(mountPoint)); }, [mountPoint]);
    const markUsed = React.useCallback((key: string) => { setLastUsed(key); writeLastUsed(mountPoint, key); }, [mountPoint]);

    // ---- menu
    const [open, setOpen] = React.useState(false);
    const [everOpened, setEverOpened] = React.useState(false);
    const triggerRef = React.useRef<HTMLButtonElement | null>(null);
    const closeMenu = React.useCallback((returnFocus: boolean) => {
        setOpen(false);
        if (returnFocus) requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
    }, []);
    const toggleMenu = () => { setEverOpened(true); setOpen((v) => !v); };

    const renderAction = (item: ToolbarItem & { mount: ToolbarMount }, mode: 'compact' | 'menu') => (
        <JsonRenderer
            component={item.mount.component}
            initialState={item.mount.initialState}
            context={{
                ...context,
                extensionId: item.mount.extensionId,
                overlays: item.mount.overlays,
                toolbarButtonMode: mode,
                toolbarMeta: { key: item.key, label: item.label, description: item.description, extensionIcon: item.extensionIcon, dot: mode === 'compact' && lastUsed === item.key },
            }}
        />
    );

    if (items.length === 0 && custom.length === 0) return null;
    const count = items.length;

    return (
        <div
            ref={setRootEl}
            role="group"
            aria-label={s.extensions}
            data-extension-toolbar={mountPoint}
            className="flex min-w-0 flex-1 items-center justify-end gap-0.5"
        >
            <span role="separator" aria-orientation="vertical" className="mx-1 h-5 w-px shrink-0 bg-border" />
            {custom.map((mount, i) => (
                <div key={`${mount.extensionId}-c${i}`} className="shrink-0">
                    <JsonRenderer component={mount.component} initialState={mount.initialState} context={{ ...context, extensionId: mount.extensionId, overlays: mount.overlays, toolbarButtonMode: 'compact' }} />
                </div>
            ))}
            {visible.map((item) => (
                <div key={item.key} data-toolbar-slot={item.key} className="shrink-0" onClickCapture={() => markUsed(item.key)}>
                    {renderAction(item, 'compact')}
                </div>
            ))}
            {count > 0 && (
                <>
                    <ToolbarTooltip label={s.extensions} hint={formatKit(s.actionsCount, { n: count })}>
                        {(aria) => (
                            <button
                                ref={triggerRef}
                                type="button"
                                aria-label={`${s.extensions} (${count})`}
                                aria-haspopup="menu"
                                aria-expanded={open}
                                aria-describedby={aria['aria-describedby']}
                                data-extensions-menu-trigger=""
                                onClick={toggleMenu}
                                onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setEverOpened(true); setOpen(true); } }}
                                className={`${TOOLBAR_ICON_BUTTON_CLASS} ${open ? 'bg-accent text-accent-foreground' : ''}`}
                            >
                                <Puzzle size={16} aria-hidden={true} />
                                <span aria-hidden="true" className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border border-border bg-muted px-1 text-[10px] font-semibold leading-none text-muted-foreground">{count}</span>
                            </button>
                        )}
                    </ToolbarTooltip>
                    {everOpened && (
                        <ExtensionsMenu
                            open={open}
                            anchorRef={triggerRef}
                            items={items}
                            pinnedKeys={pinnedKeys}
                            visibleKeys={visibleKeys}
                            onClose={closeMenu}
                            onTogglePin={(key, next) => setPinned(key, next)}
                            onUsed={markUsed}
                            renderAction={(item) => renderAction(item as ToolbarItem & { mount: ToolbarMount }, 'menu')}
                        />
                    )}
                </>
            )}
        </div>
    );
}

// ------------------------------------------------------------------ menu "Extensiones"
interface MenuProps {
    open: boolean;
    anchorRef: React.RefObject<HTMLElement | null>;
    items: ToolbarItem[];
    pinnedKeys: string[];
    visibleKeys: Set<string>;
    onClose: (returnFocus: boolean) => void;
    onTogglePin: (key: string, pinned: boolean) => void;
    onUsed: (key: string) => void;
    renderAction: (item: ToolbarItem) => React.ReactNode;
}

function ExtensionsMenu({ open, anchorRef, items, pinnedKeys, visibleKeys, onClose, onTogglePin, onUsed, renderAction }: MenuProps) {
    const s = useKitStrings();
    const panelRef = React.useRef<HTMLDivElement | null>(null);
    const searchRef = React.useRef<HTMLInputElement | null>(null);
    const [query, setQuery] = React.useState('');
    const [pos, setPos] = React.useState<{ left: number; top?: number; bottom?: number; width: number }>({ left: 8, top: 0, width: MENU_WIDTH });
    const showSearch = items.length > SEARCH_THRESHOLD;
    const groups = React.useMemo(() => groupByExtension(items), [items]);
    const pinned = React.useMemo(() => new Set(pinnedKeys), [pinnedKeys]);
    const matching = React.useMemo(() => new Set(items.filter((i) => matchesQuery(i, query)).map((i) => i.key)), [items, query]);

    // Posicion fija junto al boton (portal): ninguna barra con overflow la recorta.
    React.useEffect(() => {
        if (!open) return;
        const place = () => {
            const rect = anchorRef.current?.getBoundingClientRect();
            if (!rect) return;
            const width = Math.min(MENU_WIDTH, window.innerWidth - 16);
            const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
            const below = window.innerHeight - rect.bottom;
            if (below < 240 && rect.top > below) setPos({ left, bottom: window.innerHeight - rect.top + 6, width });
            else setPos({ left, top: rect.bottom + 6, width });
        };
        place();
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
    }, [open, anchorRef]);

    // Foco al abrir (buscador o primera accion) y cierre al pulsar fuera.
    React.useEffect(() => {
        if (!open) return;
        setQuery('');
        const id = requestAnimationFrame(() => {
            const first = searchRef.current ?? panelRef.current?.querySelector<HTMLElement>('[data-toolbar-menu-item]:not(:disabled)');
            (first ?? panelRef.current)?.focus({ preventScroll: true });
        });
        const onDown = (e: MouseEvent) => {
            const t = e.target as Node;
            if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
            onClose(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => { cancelAnimationFrame(id); document.removeEventListener('mousedown', onDown); };
    }, [open, anchorRef, onClose]);

    const rows = (): HTMLElement[] => Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[data-menu-row]:not([hidden])') ?? []);
    const focusColumn = (row: HTMLElement | undefined, col: 'main' | 'pin') => {
        const target = row?.querySelector<HTMLElement>(col === 'pin' ? '[data-toolbar-pin]' : '[data-toolbar-menu-item]');
        target?.focus({ preventScroll: false });
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        e.stopPropagation(); // los atajos globales de la bandeja no deben dispararse aqui
        const active = document.activeElement as HTMLElement | null;
        const inSearch = active === searchRef.current;
        const list = rows();
        const footer = panelRef.current?.querySelector<HTMLElement>('[data-menu-footer]');
        const inFooter = active === footer;
        const row = active?.closest<HTMLElement>('[data-menu-row]') ?? null;
        const idx = row ? list.indexOf(row) : -1;
        const col: 'main' | 'pin' = active?.hasAttribute('data-toolbar-pin') ? 'pin' : 'main';
        switch (e.key) {
            case 'Escape': e.preventDefault(); onClose(true); break;
            case 'Tab': onClose(false); break;
            case 'ArrowDown':
                e.preventDefault();
                if (inFooter) break;
                if (!inSearch && idx === list.length - 1) footer?.focus(); else focusColumn(list[inSearch ? 0 : Math.min(list.length - 1, idx + 1)], col);
                break;
            case 'ArrowUp':
                e.preventDefault();
                if (inFooter) focusColumn(list[list.length - 1], 'main');
                else if (idx <= 0 && showSearch) searchRef.current?.focus();
                else focusColumn(list[Math.max(0, idx - 1)], col);
                break;
            case 'Home': if (!inSearch) { e.preventDefault(); focusColumn(list[0], col); } break;
            case 'End': if (!inSearch) { e.preventDefault(); focusColumn(list[list.length - 1], col); } break;
            case 'ArrowRight': if (!inSearch && col === 'main') { e.preventDefault(); focusColumn(row ?? undefined, 'pin'); } break;
            case 'ArrowLeft': if (!inSearch && col === 'pin') { e.preventDefault(); focusColumn(row ?? undefined, 'main'); } break;
            case 'p': case 'P': {
                if (inSearch || !row) break;
                e.preventDefault();
                const key = row.getAttribute('data-menu-row')!;
                onTogglePin(key, !pinned.has(key));
                break;
            }
            default: break;
        }
    };

    if (typeof document === 'undefined') return null;
    const anyMatch = items.some((i) => matching.has(i.key));

    return createPortal(
        <div
            ref={panelRef}
            role="menu"
            aria-label={s.extensions}
            aria-orientation="vertical"
            hidden={!open}
            tabIndex={-1}
            data-extensions-menu=""
            onKeyDown={onKeyDown}
            onClickCapture={(e) => {
                const main = (e.target as HTMLElement).closest('[data-toolbar-menu-item]');
                const rowEl = (e.target as HTMLElement).closest<HTMLElement>('[data-menu-row]');
                if (main && rowEl && !(main as HTMLButtonElement).disabled) { onUsed(rowEl.getAttribute('data-menu-row')!); onClose(true); }
            }}
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width }}
            className="fixed z-[150] flex max-h-[min(70vh,28rem)] flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xl outline-none"
        >
            {showSearch && (
                <div role="none" className="flex items-center gap-2 border-b border-border px-3 py-2">
                    <Search size={14} aria-hidden={true} className="shrink-0 text-muted-foreground" />
                    <input
                        ref={searchRef}
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        aria-label={s.searchActions}
                        placeholder={s.searchActions}
                        className={`min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground ${TOOLBAR_FOCUS} rounded`}
                    />
                </div>
            )}
            <div role="none" className="min-h-0 flex-1 overflow-y-auto p-1">
                {groups.map((group) => {
                    const groupVisible = group.items.some((i) => matching.has(i.key));
                    return (
                        <div key={group.extensionId} role="group" aria-label={group.extensionName} hidden={!groupVisible}>
                            <div role="presentation" className="flex items-center gap-1.5 px-2 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                {group.items[0]?.extensionIcon && <ExtensionIcon icon={group.items[0].extensionIcon} size={16} mode="mono" />}
                                <span className="min-w-0 truncate">{group.extensionName}</span>
                            </div>
                            {group.items.map((item) => {
                                const isPinned = pinned.has(item.key);
                                const hiddenByWidth = isPinned && !visibleKeys.has(item.key);
                                return (
                                    <div key={item.key} role="none" data-menu-row={item.key} hidden={!matching.has(item.key)} className="flex items-center gap-1">
                                        {renderAction(item)}
                                        <button
                                            type="button"
                                            role="menuitemcheckbox"
                                            aria-checked={isPinned}
                                            tabIndex={-1}
                                            data-toolbar-pin=""
                                            aria-label={`${isPinned ? s.unpinFromBar : s.pinToBar}: ${item.label}`}
                                            aria-keyshortcuts="P"
                                            title={isPinned ? s.unpinFromBar : s.pinToBar}
                                            onClick={() => onTogglePin(item.key, !isPinned)}
                                            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10 ${isPinned ? 'text-foreground' : 'text-muted-foreground'} ${TOOLBAR_FOCUS}`}
                                            data-hidden-by-width={hiddenByWidth || undefined}
                                        >
                                            {isPinned ? <Pin size={14} aria-hidden={true} className="fill-current" /> : <PinOff size={14} aria-hidden={true} />}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
                {!anyMatch && <div role="presentation" className="px-3 py-3 text-sm text-muted-foreground">{s.noResults}</div>}
            </div>
            <div role="none" className="border-t border-border p-1">
                <Link
                    href="/extensions"
                    role="menuitem"
                    tabIndex={-1}
                    data-toolbar-menu-item=""
                    data-menu-footer=""
                    onClick={() => onClose(false)}
                    className={`flex min-h-9 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-card-foreground hover:bg-accent hover:text-accent-foreground ${TOOLBAR_FOCUS}`}
                >
                    <Settings2 size={16} aria-hidden={true} className="shrink-0 text-muted-foreground" />
                    {s.manageExtensions}
                </Link>
            </div>
        </div>,
        document.body,
    );
}
