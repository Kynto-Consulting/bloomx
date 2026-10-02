'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Puzzle, Search, User } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useI18n } from '@/components/I18nProvider';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { useExtensionNav } from '@/hooks/useExtensionNav';
import { useConsole } from './ConsoleContext';
import { adminFetch } from './api';
import { SEARCH_TARGETS, normalizeSearch } from './nav';
import { useDebounced } from './ui';
import { cn } from '@/lib/utils';

/**
 * Busqueda global (atajo "/" o Ctrl/Cmd+K): secciones y ajustes (locales), extensiones instaladas (locales) y usuarios
 * (remoto: GET /api/admin/search, solo id/nombre/correo). Patron combobox + listbox WAI-ARIA con foco en el campo
 * (aria-activedescendant): flechas, Intro abre, Escape cierra. Las respuestas obsoletas se descartan.
 */

interface Item {
    id: string;
    group: 'sections' | 'users' | 'extensions';
    label: string;
    hint?: string;
    href: string;
    icon: React.ReactNode;
}

export function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { t } = useI18n();
    const router = useRouter();
    const { extensions } = useDomainConfig();
    const consoleLevel = useConsole().me?.permission_level ?? null;
    // Paginas de administracion que aportan las extensiones (solo las que el nivel del usuario alcanza).
    const extensionPages = useExtensionNav({ section: 'admin', level: consoleLevel, signedIn: true });
    const [q, setQ] = React.useState('');
    const [active, setActive] = React.useState(0);
    const [users, setUsers] = React.useState<Array<{ id: string; name: string | null; email: string }>>([]);
    const [searching, setSearching] = React.useState(false);
    const uid = React.useId();
    const listId = `${uid}-list`;
    const dq = useDebounced(q, 250);

    React.useEffect(() => { if (!open) { setQ(''); setUsers([]); setActive(0); } }, [open]);

    React.useEffect(() => {
        const term = dq.trim();
        if (!open || term.length < 2) { setUsers([]); setSearching(false); return; }
        let cancelled = false;
        setSearching(true);
        adminFetch<{ users: Array<{ id: string; name: string | null; email: string }> }>(`/api/admin/search?q=${encodeURIComponent(term)}`)
            .then((r) => { if (!cancelled) setUsers(r.users ?? []); })
            .catch(() => { if (!cancelled) setUsers([]); })
            .finally(() => { if (!cancelled) setSearching(false); });
        return () => { cancelled = true; };
    }, [dq, open]);

    const items = React.useMemo<Item[]>(() => {
        const nq = normalizeSearch(q);
        const tokens = nq.split(/\s+/).filter(Boolean);
        const match = (haystack: string) => tokens.every((tk) => haystack.includes(tk));
        const sections: Item[] = SEARCH_TARGETS
            .map((s) => ({ s, label: t(s.labelKey) }))
            .filter(({ s, label }) => tokens.length === 0 ? s.id.startsWith('nav:') : match(normalizeSearch(`${label} ${s.keywords}`)))
            .slice(0, 8)
            .map(({ s, label }) => ({ id: s.id, group: 'sections' as const, label, href: s.href, icon: <s.icon className="h-4 w-4" aria-hidden="true" /> }));
        const pages: Item[] = extensionPages
            .filter((p) => p.href && !p.disabled && (tokens.length === 0 || match(normalizeSearch(`${p.label} ${p.extensionId}`))))
            .slice(0, 6)
            .map((p) => ({ id: `extpage:${p.key}`, group: 'sections' as const, label: p.label, hint: p.extensionId, href: p.href as string, icon: <Puzzle className="h-4 w-4" aria-hidden="true" /> }));
        const exts: Item[] = tokens.length === 0 ? [] : (extensions as any[])
            .filter((e) => match(normalizeSearch(`${e?.name ?? ''} ${e?.id ?? ''}`)))
            .slice(0, 5)
            .map((e) => ({ id: `ext:${e.id}`, group: 'extensions' as const, label: String(e.name || e.id), hint: String(e.id), href: `/admin/extensions?open=${encodeURIComponent(String(e.id))}`, icon: <Puzzle className="h-4 w-4" aria-hidden="true" /> }));
        const usr: Item[] = users.map((u) => ({ id: `user:${u.id}`, group: 'users' as const, label: u.name || u.email, hint: u.name ? u.email : undefined, href: `/admin/users?open=${encodeURIComponent(u.id)}`, icon: <User className="h-4 w-4" aria-hidden="true" /> }));
        return [...usr, ...sections, ...pages, ...exts];
    }, [q, t, extensions, users, extensionPages]);

    React.useEffect(() => { setActive(0); }, [items.length]);

    const go = (item: Item | undefined) => {
        if (!item) return;
        onClose();
        router.push(item.href);
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (items.length ? (i + 1) % items.length : 0)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (items.length ? (i - 1 + items.length) % items.length : 0)); }
        else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
        else if (e.key === 'End') { e.preventDefault(); setActive(Math.max(0, items.length - 1)); }
        else if (e.key === 'Enter') { e.preventDefault(); go(items[active]); }
    };

    const showTypeMore = q.trim().length > 0 && q.trim().length < 2;
    const groupLabel = (g: Item['group']) => t(`admin.console.shell.search.groups.${g}`);
    let lastGroup: Item['group'] | null = null;

    return (
        <Modal
            open={open}
            onClose={onClose}
            ariaLabel={t('admin.console.shell.search.title')}
            className="items-start pt-[10vh]"
            panelClassName="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
            dialogOptions={{ initialFocus: () => document.getElementById(`${uid}-input`) }}
        >
            <div onKeyDown={onKeyDown}>
                <div className="flex items-center gap-2 border-b border-border px-3">
                    <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    <input
                        id={`${uid}-input`}
                        role="combobox"
                        aria-expanded="true"
                        aria-controls={listId}
                        aria-autocomplete="list"
                        aria-activedescendant={items[active] ? `${uid}-opt-${active}` : undefined}
                        aria-label={t('admin.console.shell.search.label')}
                        placeholder={t('admin.console.shell.search.placeholder')}
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        className="h-12 w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                    />
                </div>
                <ul id={listId} role="listbox" aria-label={t('admin.console.shell.search.title')} className="max-h-[50vh] overflow-y-auto p-1.5">
                    {items.map((item, i) => {
                        const header = item.group !== lastGroup;
                        lastGroup = item.group;
                        return (
                            <React.Fragment key={item.id}>
                                {header && <li role="presentation" className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{groupLabel(item.group)}</li>}
                                <li
                                    id={`${uid}-opt-${i}`}
                                    role="option"
                                    aria-selected={i === active}
                                    onMouseEnter={() => setActive(i)}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => go(item)}
                                    className={cn('flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm', i === active ? 'bg-accent text-accent-foreground' : 'text-popover-foreground')}
                                >
                                    <span className="text-muted-foreground">{item.icon}</span>
                                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                                    {item.hint && <span className="hidden truncate text-xs text-muted-foreground sm:inline">{item.hint}</span>}
                                </li>
                            </React.Fragment>
                        );
                    })}
                </ul>
                <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground" role="status" aria-live="polite">
                    {searching ? t('admin.console.shell.search.searching')
                        : showTypeMore ? t('admin.console.shell.search.typeMore')
                        : q.trim() && items.length === 0 ? t('admin.console.shell.search.noResults', { q: q.trim() })
                        : items.length > 0 ? t('admin.console.shell.search.results', { count: items.length })
                        : t('admin.console.shell.search.hint')}
                </div>
            </div>
        </Modal>
    );
}
