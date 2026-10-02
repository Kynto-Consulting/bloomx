'use client';

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Plus, Search, Trash2, UserX, X } from 'lucide-react';
import { Badge, Switch, btnOutline, inputClass, selectClass } from '@/components/admin/console';
import { useI18n } from '@/components/I18nProvider';
import { isUserMap, type UserMapValue } from '@/lib/admin/extensions-config';
import { SETTINGS_LIMITS, localizedText, type SettingField, type UserFilter } from '@/lib/expansions/settings-schema';

/**
 * Controles de los ajustes `user`, `users` y `userMap` (los edita el ADMIN de la organizacion; guardan ids estables, nunca correos).
 *
 * Fuente: GET /api/admin/extensions/users (directorio del dominio ACTUAL; nivel >= 3). Los ids guardados se resuelven a nombre/correo con
 * `?ids=`; los que ya no existen se muestran como "usuario eliminado" y se pueden quitar. El servidor del panel vuelve a comprobar existencia,
 * estado y filtro al guardar (esto es solo la ayuda de la UI).
 */

export interface DirUser { id: string; email: string; name: string | null; disabled: boolean; level: number; levelName: string }
type Page = { users: DirUser[]; total: number; page: number; limit: number; hasMore: boolean };

const ENDPOINT = '/api/admin/extensions/users';

export async function fetchUserPage(opts: { q?: string; page?: number; limit?: number; filter?: UserFilter }, signal?: AbortSignal): Promise<Page> {
    const p = new URLSearchParams();
    if (opts.q) p.set('q', opts.q);
    p.set('page', String(opts.page ?? 0));
    p.set('limit', String(opts.limit ?? 20));
    if (opts.filter?.minLevel !== undefined) p.set('minLevel', String(opts.filter.minLevel));
    if (opts.filter?.role) p.set('role', opts.filter.role);
    const res = await fetch(`${ENDPOINT}?${p}`, { cache: 'no-store', signal });
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as Page;
}

export async function fetchUsersByIds(ids: string[], signal?: AbortSignal): Promise<{ users: DirUser[]; missing: string[] }> {
    const out = { users: [] as DirUser[], missing: [] as string[] };
    for (let i = 0; i < ids.length; i += 100) {
        const res = await fetch(`${ENDPOINT}?ids=${encodeURIComponent(ids.slice(i, i + 100).join(','))}`, { cache: 'no-store', signal });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        out.users.push(...(Array.isArray(data.users) ? data.users : []));
        out.missing.push(...(Array.isArray(data.missing) ? data.missing : []));
    }
    return out;
}

/** Fuente del directorio. Por defecto la API real del panel; la documentacion publica inyecta uno en memoria (sin red ni sesion). */
export interface UserDirectory { page: typeof fetchUserPage; byIds: typeof fetchUsersByIds }
export const UserDirectoryContext = createContext<UserDirectory>({ page: fetchUserPage, byIds: fetchUsersByIds });

/** Resuelve ids guardados a usuarios del dominio; `missing` = ya no existen. */
export function useResolvedUsers(ids: string[]): { byId: Map<string, DirUser>; missing: Set<string>; loading: boolean; failed: boolean } {
    const [byId, setById] = useState<Map<string, DirUser>>(new Map());
    const [missing, setMissing] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);
    const known = useRef<Set<string>>(new Set());
    const dir = useContext(UserDirectoryContext);
    const key = ids.join(',');
    useEffect(() => {
        const todo = ids.filter((id) => !known.current.has(id));
        if (todo.length === 0) return;
        const controller = new AbortController();
        setLoading(true);
        dir.byIds(todo, controller.signal)
            .then((r) => {
                todo.forEach((id) => known.current.add(id));
                setById((prev) => { const next = new Map(prev); r.users.forEach((u) => next.set(u.id, u)); return next; });
                setMissing((prev) => { const next = new Set(prev); r.missing.forEach((id) => next.add(id)); r.users.forEach((u) => next.delete(u.id)); return next; });
                setFailed(false);
            })
            .catch((e) => { if (e?.name !== 'AbortError') setFailed(true); })
            .finally(() => setLoading(false));
        return () => controller.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
    return { byId, missing, loading, failed };
}

const label = (u: DirUser) => (u.name ? `${u.name} (${u.email})` : u.email);

/** Buscador asincrono con lista paginada. Excluye `exclude`; los usuarios desactivados salen marcados y no se pueden elegir. */
export function UserSearch({ filter, exclude, disabled, onPick, inputId, describedBy, invalid }: {
    filter?: UserFilter; exclude?: ReadonlySet<string>; disabled?: boolean; onPick: (user: DirUser) => void; inputId?: string; describedBy?: string; invalid?: boolean;
}) {
    const { t } = useI18n();
    const uid = useId();
    const dir = useContext(UserDirectoryContext);
    const [q, setQ] = useState('');
    const [open, setOpen] = useState(false);
    const [results, setResults] = useState<DirUser[]>([]);
    const [page, setPage] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);

    const run = useCallback(async (query: string, nextPage: number, append: boolean, signal?: AbortSignal) => {
        setLoading(true);
        setFailed(false);
        try {
            const r = await dir.page({ q: query, page: nextPage, limit: 10, filter }, signal);
            setResults((prev) => (append ? [...prev, ...r.users] : r.users));
            setPage(nextPage);
            setHasMore(r.hasMore);
        } catch (e: any) {
            if (e?.name !== 'AbortError') setFailed(true);
        } finally {
            setLoading(false);
        }
    }, [filter, dir]);

    useEffect(() => {
        if (!open) return;
        const controller = new AbortController();
        const timer = setTimeout(() => void run(q.trim(), 0, false, controller.signal), q ? 250 : 0);
        return () => { clearTimeout(timer); controller.abort(); };
    }, [q, open, run]);

    const visible = results.filter((u) => !exclude?.has(u.id));
    return (
        <div className="relative">
            <div className="relative">
                <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                    id={inputId}
                    type="search"
                    role="combobox"
                    aria-expanded={open}
                    aria-controls={`${uid}-list`}
                    aria-autocomplete="list"
                    aria-invalid={invalid || undefined}
                    aria-describedby={describedBy}
                    autoComplete="off"
                    disabled={disabled}
                    value={q}
                    placeholder={t('admin.console.extensions.config.users.searchPlaceholder')}
                    onFocus={() => setOpen(true)}
                    onChange={(e) => { setQ(e.target.value); setOpen(true); }}
                    onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
                    className={`${inputClass} pl-8`}
                />
            </div>
            {open && !disabled && (
                <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-popover p-1 shadow-lg" data-testid="user-results">
                    <ul id={`${uid}-list`} role="listbox" aria-label={t('admin.console.extensions.config.users.results')} className="max-h-64 overflow-y-auto">
                        {visible.map((u) => (
                            <li key={u.id} role="option" aria-selected={false} aria-disabled={u.disabled || undefined}>
                                <button
                                    type="button"
                                    disabled={u.disabled}
                                    onClick={() => { onPick(u); setOpen(false); setQ(''); }}
                                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    <span className="min-w-0 truncate">{label(u)}</span>
                                    {u.disabled && <Badge tone="warning">{t('admin.console.extensions.config.users.disabled')}</Badge>}
                                </button>
                            </li>
                        ))}
                    </ul>
                    {!loading && !failed && visible.length === 0 && <p role="status" className="px-2 py-2 text-xs text-muted-foreground">{t('admin.console.extensions.config.users.noResults')}</p>}
                    {loading && <p role="status" className="px-2 py-2 text-xs text-muted-foreground">{t('admin.console.extensions.config.users.loading')}</p>}
                    {failed && <p role="alert" className="px-2 py-2 text-xs text-destructive">{t('admin.console.extensions.config.users.loadFailed')}</p>}
                    <div className="flex items-center justify-between gap-2 border-t border-border/60 px-1 pt-1">
                        {hasMore && !loading ? <button type="button" className="text-xs text-primary hover:underline" onClick={() => void run(q.trim(), page + 1, true)}>{t('admin.console.extensions.config.users.loadMore')}</button> : <span />}
                        <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setOpen(false)}>{t('admin.console.extensions.config.users.close')}</button>
                    </div>
                </div>
            )}
        </div>
    );
}

function UserBadge({ id, user, deleted, onRemove, disabled }: { id: string; user?: DirUser; deleted: boolean; onRemove?: () => void; disabled?: boolean }) {
    const { t } = useI18n();
    return (
        <li className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/50 py-0.5 pl-2.5 pr-1 text-sm" data-testid={`user-chip-${id}`}>
            {deleted ? (
                <span className="inline-flex items-center gap-1 text-destructive"><UserX aria-hidden="true" className="h-3.5 w-3.5" />{t('admin.console.extensions.config.users.deleted')}<span className="font-mono text-xs text-muted-foreground">{id.slice(0, 12)}</span></span>
            ) : (
                <span className="truncate">{user ? label(user) : id}</span>
            )}
            {user?.disabled && <Badge tone="warning">{t('admin.console.extensions.config.users.disabled')}</Badge>}
            {onRemove && (
                <button type="button" disabled={disabled} onClick={onRemove} aria-label={t('admin.console.extensions.config.users.remove', { name: user ? label(user) : id })} className="rounded-full p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50">
                    <X aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
            )}
        </li>
    );
}

/** `user` (un usuario) y `users` (varios): chips + buscador. */
export function UserSelect({ field, value, multi, onChange, editable, inputId, describedBy, invalid }: {
    field: SettingField; value: string | string[] | undefined; multi: boolean; onChange: (next: string | string[]) => void; editable: boolean; inputId: string; describedBy?: string; invalid?: boolean;
}) {
    const { t, locale } = useI18n();
    const ids = useMemo(() => (Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : []), [value]);
    const { byId, missing, failed } = useResolvedUsers(ids);
    const max = Math.min(field.maxItems ?? SETTINGS_LIMITS.maxUsers, SETTINGS_LIMITS.maxUsers);
    const full = multi ? ids.length >= max : ids.length >= 1;
    const pick = (u: DirUser) => onChange(multi ? [...ids, u.id] : u.id);
    const drop = (id: string) => onChange(multi ? ids.filter((x) => x !== id) : '');
    return (
        <div className="space-y-2" data-testid={`user-select-${field.key}`}>
            {ids.length > 0 && (
                <ul className="flex flex-wrap gap-1.5" aria-label={localizedText(field.label, locale, field.key)}>
                    {ids.map((id) => <UserBadge key={id} id={id} user={byId.get(id)} deleted={missing.has(id)} disabled={!editable} onRemove={editable ? () => drop(id) : undefined} />)}
                </ul>
            )}
            {ids.length === 0 && <p className="text-xs text-muted-foreground">{t('admin.console.extensions.config.users.none')}</p>}
            {failed && <p role="alert" className="text-xs text-destructive">{t('admin.console.extensions.config.users.loadFailed')}</p>}
            {editable && !full && <UserSearch inputId={inputId} describedBy={describedBy} invalid={invalid} filter={field.filter} exclude={new Set(ids)} onPick={pick} />}
            {multi && <p className="text-xs text-muted-foreground">{t('admin.console.extensions.config.users.count', { count: ids.length, max })}</p>}
        </div>
    );
}

const PAGE = 10;

/** `userMap`: tabla buscable/paginada { usuario -> valor }; quien no tiene entrada usa `default`. */
export function UserMapEditor({ field, value, onChange, editable, error, inputId, describedBy }: {
    field: SettingField; value: UserMapValue | undefined; onChange: (next: UserMapValue) => void; editable: boolean; error?: string | null; inputId: string; describedBy?: string;
}) {
    const { t, locale } = useI18n();
    const dir = useContext(UserDirectoryContext);
    const map: UserMapValue = isUserMap(value) ? value : {};
    const ids = useMemo(() => Object.keys(map), [map]);
    const { byId, missing, failed } = useResolvedUsers(ids);
    const [filterText, setFilterText] = useState('');
    const [page, setPage] = useState(0);
    const [bulkBusy, setBulkBusy] = useState(false);
    const [bulkNote, setBulkNote] = useState<string | null>(null);
    const vt = field.valueType ?? 'boolean';
    const max = Math.min(field.maxItems ?? SETTINGS_LIMITS.maxUserMapEntries, SETTINGS_LIMITS.maxUserMapEntries);
    const defaultValue = field.default;
    const initialFor = (): string | boolean => (vt === 'boolean' ? (typeof defaultValue === 'boolean' ? !defaultValue : true) : vt === 'select' ? (field.options?.[0]?.value ?? '') : defaultValue !== undefined ? String(defaultValue) : '');

    const entries = ids.filter((id) => {
        const q = filterText.trim().toLowerCase();
        if (!q) return true;
        const u = byId.get(id);
        return id.toLowerCase().includes(q) || (!!u && (u.email.toLowerCase().includes(q) || (u.name ?? '').toLowerCase().includes(q)));
    });
    const pages = Math.max(1, Math.ceil(entries.length / PAGE));
    const current = Math.min(page, pages - 1);
    const shown = entries.slice(current * PAGE, current * PAGE + PAGE);
    const deletedIds = ids.filter((id) => missing.has(id));

    const setEntry = (id: string, v: string | boolean) => onChange({ ...map, [id]: v });
    const removeEntry = (id: string) => { const { [id]: _drop, ...rest } = map; onChange(rest); };
    const addUser = (u: DirUser) => { if (ids.length < max) { setBulkNote(null); onChange({ ...map, [u.id]: initialFor() }); } };

    const setAll = (v: boolean) => { setBulkNote(null); onChange(Object.fromEntries(ids.map((id) => [id, v]))); };
    /** Anade a TODOS los usuarios activos del dominio (paginando el directorio) con el valor dado (solo boolean), hasta el tope. */
    const addEveryone = async (v: boolean) => {
        setBulkBusy(true);
        setBulkNote(null);
        try {
            const next: UserMapValue = { ...map };
            let p = 0;
            for (let guard = 0; guard < 120; guard++) {
                const r = await dir.page({ page: p, limit: 50, filter: field.filter });
                for (const u of r.users) if (!u.disabled && Object.keys(next).length < max) next[u.id] = v;
                if (!r.hasMore || Object.keys(next).length >= max) break;
                p++;
            }
            onChange(next);
            setBulkNote(t('admin.console.extensions.config.users.bulkDone', { count: Object.keys(next).length }));
        } catch {
            setBulkNote(t('admin.console.extensions.config.users.loadFailed'));
        } finally {
            setBulkBusy(false);
        }
    };

    const control = (id: string) => {
        const v = map[id];
        const common = { disabled: !editable, 'aria-label': t('admin.console.extensions.config.users.valueFor', { name: byId.get(id) ? label(byId.get(id)!) : id }) };
        if (vt === 'boolean') return <Switch checked={v === true} label={common['aria-label']} disabled={!editable} onChange={(b) => setEntry(id, b)} />;
        if (vt === 'select') {
            return (
                <select {...common} className={selectClass} value={typeof v === 'string' ? v : ''} onChange={(e) => setEntry(id, e.target.value)}>
                    {(field.options ?? []).map((o) => <option key={o.value} value={o.value}>{localizedText(o.label, locale, o.value)}</option>)}
                </select>
            );
        }
        return (
            <input
                {...common}
                type={vt === 'number' ? 'number' : 'text'}
                inputMode={vt === 'number' ? (field.integer ? 'numeric' : 'decimal') : undefined}
                min={field.min}
                max={field.max}
                step={vt === 'number' ? (field.integer ? 1 : 'any') : undefined}
                maxLength={vt === 'string' ? field.maxLength ?? SETTINGS_LIMITS.maxStringLength : undefined}
                autoComplete="off"
                value={typeof v === 'string' ? v : ''}
                onChange={(e) => setEntry(id, e.target.value)}
                className={inputClass}
            />
        );
    };

    const defaultText = defaultValue === undefined ? t('admin.console.extensions.config.users.noDefault') : vt === 'boolean' ? (defaultValue ? t('admin.console.extensions.config.users.yes') : t('admin.console.extensions.config.users.no')) : String(defaultValue);

    return (
        <div className="space-y-3" data-testid={`usermap-${field.key}`}>
            <p className="text-xs text-muted-foreground">{t('admin.console.extensions.config.users.mapDefault', { value: defaultText })}</p>
            {editable && ids.length < max && <UserSearch inputId={inputId} describedBy={describedBy} invalid={!!error} filter={field.filter} exclude={new Set(ids)} onPick={addUser} />}
            {editable && (
                <div className="flex flex-wrap items-center gap-2">
                    {vt === 'boolean' && ids.length > 0 && (
                        <>
                            <button type="button" className={btnOutline} onClick={() => setAll(true)}>{t('admin.console.extensions.config.users.allYes')}</button>
                            <button type="button" className={btnOutline} onClick={() => setAll(false)}>{t('admin.console.extensions.config.users.allNo')}</button>
                        </>
                    )}
                    {vt === 'boolean' && (
                        <button type="button" className={btnOutline} disabled={bulkBusy || ids.length >= max} onClick={() => void addEveryone(true)}>
                            <Plus aria-hidden="true" className="mr-1 h-4 w-4" />{bulkBusy ? t('admin.console.extensions.config.users.loading') : t('admin.console.extensions.config.users.addEveryone')}
                        </button>
                    )}
                    {deletedIds.length > 0 && (
                        <button type="button" className={btnOutline} onClick={() => onChange(Object.fromEntries(Object.entries(map).filter(([id]) => !missing.has(id))))}>
                            <UserX aria-hidden="true" className="mr-1 h-4 w-4" />{t('admin.console.extensions.config.users.cleanDeleted', { count: deletedIds.length })}
                        </button>
                    )}
                </div>
            )}
            {bulkNote && <p role="status" className="text-xs text-muted-foreground">{bulkNote}</p>}
            {failed && <p role="alert" className="text-xs text-destructive">{t('admin.console.extensions.config.users.loadFailed')}</p>}

            {ids.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">{t('admin.console.extensions.config.users.mapEmpty')}</p>
            ) : (
                <div className="space-y-2">
                    {ids.length > PAGE && (
                        <input type="search" value={filterText} onChange={(e) => { setFilterText(e.target.value); setPage(0); }} placeholder={t('admin.console.extensions.config.users.filterEntries')} aria-label={t('admin.console.extensions.config.users.filterEntries')} className={inputClass} />
                    )}
                    <div className="overflow-x-auto rounded-lg border border-border">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                                <tr>
                                    <th scope="col" className="px-3 py-2 font-medium">{t('admin.console.extensions.config.users.colUser')}</th>
                                    <th scope="col" className="px-3 py-2 font-medium">{t('admin.console.extensions.config.users.colValue')}</th>
                                    <th scope="col" className="w-10 px-2 py-2"><span className="sr-only">{t('admin.console.extensions.config.users.colActions')}</span></th>
                                </tr>
                            </thead>
                            <tbody>
                                {shown.map((id) => {
                                    const u = byId.get(id);
                                    const gone = missing.has(id);
                                    return (
                                        <tr key={id} className="border-t border-border/60" data-testid={`usermap-row-${id}`}>
                                            <td className="px-3 py-2">
                                                {gone ? <span className="inline-flex items-center gap-1 text-destructive"><UserX aria-hidden="true" className="h-4 w-4" />{t('admin.console.extensions.config.users.deleted')} <span className="font-mono text-xs text-muted-foreground">{id.slice(0, 12)}</span></span> : <span className="break-all">{u ? label(u) : id}</span>}
                                                {u?.disabled && <span className="ml-2"><Badge tone="warning">{t('admin.console.extensions.config.users.disabled')}</Badge></span>}
                                            </td>
                                            <td className="px-3 py-2">{control(id)}</td>
                                            <td className="px-2 py-2 text-right">
                                                {editable && <button type="button" onClick={() => removeEntry(id)} aria-label={t('admin.console.extensions.config.users.remove', { name: u ? label(u) : id })} className="rounded-md p-1.5 text-destructive hover:bg-destructive/10"><Trash2 aria-hidden="true" className="h-4 w-4" /></button>}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>{t('admin.console.extensions.config.users.mapCount', { count: ids.length, max })}</span>
                        {pages > 1 && (
                            <span className="inline-flex items-center gap-2">
                                <button type="button" className="rounded px-2 py-1 hover:bg-accent disabled:opacity-50" disabled={current === 0} onClick={() => setPage(current - 1)}>{t('admin.console.extensions.config.users.prev')}</button>
                                <span aria-live="polite">{current + 1} / {pages}</span>
                                <button type="button" className="rounded px-2 py-1 hover:bg-accent disabled:opacity-50" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>{t('admin.console.extensions.config.users.next')}</button>
                            </span>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
