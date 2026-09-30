'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppSidebar } from '@/components/layout/AppShell';
import { ExtensionLoader } from '@/components/expansions/ExtensionLoader';
import { ContactFormModal, type ContactRecord } from '@/components/contacts/ContactFormModal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Menu, Users, Search, Settings, Plus, Pencil, Trash2, Loader2, AlertCircle } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { useI18n } from '@/components/I18nProvider';
import { contactDisplayName, contactInitial, mergeContactPages, parsePageHeaders } from '@/lib/contacts';
import { toast } from 'sonner';

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

type LoadState = 'loading' | 'ready' | 'error';

export default function ContactsPage() {
    const { t } = useI18n();
    const [contacts, setContacts] = useState<ContactRecord[]>([]);
    const [total, setTotal] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [state, setState] = useState<LoadState>('loading');
    const [loadingMore, setLoadingMore] = useState(false);
    const [moreError, setMoreError] = useState(false);
    const [isGoogleLinked, setIsGoogleLinked] = useState(false);
    const { mode: sidebarMode, openDrawer } = useAppSidebar();
    const [isContactSidebarOpen, setIsContactSidebarOpen] = useState(false);
    const [searchInput, setSearchInput] = useState('');
    const [query, setQuery] = useState('');

    // Modales
    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<ContactRecord | null>(null);
    const [deleting, setDeleting] = useState<ContactRecord | null>(null);
    const [deleteBusy, setDeleteBusy] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    // Control de carreras: solo la ultima peticion puede escribir el estado.
    const reqSeq = useRef(0);
    const abortRef = useRef<AbortController | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const sentinelRef = useRef<HTMLDivElement>(null);
    const queryRef = useRef(query);
    queryRef.current = query;
    const contactsLenRef = useRef(0);
    contactsLenRef.current = contacts.length;

    const fetchPage = useCallback(async (q: string, offset: number): Promise<{ items: ContactRecord[]; total: number; hasMore: boolean } | null> => {
        abortRef.current?.abort();
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
        if (q) params.set('q', q);
        const res = await fetch(`/api/contacts?${params}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const items: ContactRecord[] = Array.isArray(data) ? data : [];
        return { items, ...parsePageHeaders(res.headers, offset + items.length) };
    }, []);

    /** Carga desde cero (busqueda nueva, sincronizacion o alta). */
    const reload = useCallback(async (q: string, opts: { silent?: boolean } = {}) => {
        const seq = ++reqSeq.current;
        if (!opts.silent) setState('loading');
        setMoreError(false);
        try {
            const page = await fetchPage(q, 0);
            if (!page || seq !== reqSeq.current) return;
            setContacts(page.items);
            setTotal(page.total);
            setHasMore(page.hasMore);
            setState('ready');
        } catch (e) {
            if ((e as Error)?.name === 'AbortError' || seq !== reqSeq.current) return;
            setState('error');
        }
    }, [fetchPage]);

    const loadMore = useCallback(async () => {
        if (loadingMore || !hasMore || state !== 'ready') return;
        const seq = ++reqSeq.current;
        setLoadingMore(true);
        setMoreError(false);
        try {
            const page = await fetchPage(queryRef.current, contactsLenRef.current);
            if (!page || seq !== reqSeq.current) return;
            setContacts(prev => mergeContactPages(prev, page.items));
            setTotal(page.total);
            setHasMore(page.hasMore && page.items.length > 0);
        } catch (e) {
            if ((e as Error)?.name !== 'AbortError' && seq === reqSeq.current) setMoreError(true);
        } finally {
            setLoadingMore(false);
        }
    }, [fetchPage, hasMore, loadingMore, state]);

    // Busqueda en servidor con debounce.
    useEffect(() => {
        const id = window.setTimeout(() => setQuery(searchInput.trim()), SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(id);
    }, [searchInput]);

    useEffect(() => {
        setLoadingMore(false);
        void reload(query);
        return () => abortRef.current?.abort();
    }, [query, reload]);

    // Estado de Google + sincronizacion completada (recarga silenciosa manteniendo la busqueda).
    useEffect(() => {
        let alive = true;
        fetch('/api/settings').then(r => (r.ok ? r.json() : null)).then(s => { if (alive) setIsGoogleLinked(Boolean(s?.isGoogleLinked)); }).catch(() => undefined);
        const onSync = () => { void reload(queryRef.current, { silent: true }); };
        window.addEventListener('bloomx:contacts-sync-complete', onSync);
        return () => { alive = false; window.removeEventListener('bloomx:contacts-sync-complete', onSync); };
    }, [reload]);

    // Scroll infinito.
    useEffect(() => {
        const el = sentinelRef.current;
        if (!el || !hasMore || state !== 'ready' || moreError || typeof IntersectionObserver === 'undefined') return;
        const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) void loadMore(); }, { root: scrollRef.current, rootMargin: '200px' });
        io.observe(el);
        return () => io.disconnect();
    }, [hasMore, state, moreError, loadMore, contacts.length]);

    // ── Acciones ──
    const openCreate = () => { setEditing(null); setFormOpen(true); };
    const openEdit = (c: ContactRecord) => { setEditing(c); setFormOpen(true); };

    const handleSaved = (saved: ContactRecord, created: boolean) => {
        setFormOpen(false);
        toast.success(created ? t('contacts.created') : t('contacts.saved'));
        if (created) { void reload(queryRef.current, { silent: true }); return; }
        setContacts(prev => prev.map(c => (c.id === saved.id ? { ...c, ...saved } : c)));
    };

    const confirmDelete = async () => {
        if (!deleting || deleteBusy) return;
        setDeleteBusy(true);
        setDeleteError(null);
        try {
            const res = await fetch(`/api/contacts/${encodeURIComponent(deleting.id)}`, { method: 'DELETE' });
            if (!res.ok) { setDeleteError(t('contacts.deleteFailed')); return; }
            const id = deleting.id;
            setContacts(prev => prev.filter(c => c.id !== id));
            setTotal(n => Math.max(0, n - 1));
            setDeleting(null);
            toast.success(t('contacts.deleted'));
        } catch {
            setDeleteError(t('common.networkError'));
        } finally {
            setDeleteBusy(false);
        }
    };

    const sourceLabel = (s: string) => (s === 'google' ? t('contacts.sourceGoogle') : s === 'local' ? t('contacts.sourceLocal') : s);

    const renderContactSidebarContent = () => (
        <>
            <div className="p-4 py-5 px-4 z-10 w-[256px]">
                <button type="button" onClick={() => { setIsContactSidebarOpen(false); openCreate(); }} className="flex items-center justify-center gap-2 bg-primary border border-primary/80 shadow-sm hover:bg-primary/90 hover:shadow-md transition-all rounded-md px-4 py-2.5 w-[calc(100%-1rem)] group">
                    <Plus className="w-5 h-5 text-primary-foreground" aria-hidden="true" />
                    <span className="text-sm font-medium text-primary-foreground transition-colors">{t('contacts.create')}</span>
                </button>
            </div>

            <div className="p-2 flex-1 overflow-y-auto w-[256px]">
                <div className="flex items-center gap-4 py-3 px-4 bg-primary/10 text-primary rounded-lg mx-2 font-medium">
                    <Users className="w-5 h-5" aria-hidden="true" />
                    <span className="text-sm flex-1">{t('contacts.title')}</span>
                    <span className="text-xs">{total}</span>
                </div>
                <hr className="my-3 border-border/50 mx-4" />
                <div className="px-4">
                    <ExtensionLoader mountPoint="CONTACTS_SIDEBAR" context={{ isGoogleLinked }} />
                </div>

                <div className="mt-4 px-4">
                    <ExtensionLoader mountPoint="CONTACTS_SIDEBAR_BOTTOM" context={{ isGoogleLinked }} />
                </div>
            </div>
        </>
    );

    const searchBox = (mobile: boolean) => (
        <div className={mobile
            ? 'flex items-center bg-muted rounded-lg px-3 py-2 focus-within:bg-background focus-within:ring-2 focus-within:ring-ring transition-all'
            : 'flex items-center bg-muted rounded-lg px-4 py-2 focus-within:bg-background focus-within:shadow-md focus-within:ring-2 focus-within:ring-ring transition-all'}>
            <Search className="w-5 h-5 text-muted-foreground mr-3 shrink-0" aria-hidden="true" />
            <input
                type="search"
                aria-label={t('contacts.searchPlaceholder')}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={t('contacts.searchPlaceholder')}
                className="bg-transparent border-none outline-none w-full text-foreground placeholder:text-muted-foreground"
            />
        </div>
    );

    return (
        <div className="flex h-full w-full bg-background overflow-hidden text-foreground font-sans">
            <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0">
                <header className="flex h-[64px] items-center justify-between px-4 border-b border-border">
                    <div className="flex items-center gap-4">
                        {sidebarMode === 'drawer' && (
                            <button type="button" onClick={openDrawer} aria-label={t('common.openMenu')} aria-haspopup="dialog" className="p-2.5 -ml-2 rounded-full hover:bg-muted">
                                <Menu className="w-6 h-6 text-foreground" aria-hidden="true" />
                            </button>
                        )}

                        <div className="flex items-center gap-2 pr-4 text-foreground">
                            <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground shadow-sm">
                                <Users className="w-5 h-5 text-primary-foreground" aria-hidden="true" />
                            </div>
                            <h1 className="text-xl font-normal tracking-tight hidden sm:block text-foreground">{t('contacts.title')}</h1>
                        </div>
                    </div>

                    <div className="flex-1 max-w-2xl px-4 lg:px-8 hidden sm:block">{searchBox(false)}</div>

                    <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
                        <ExtensionLoader mountPoint="CONTACTS_HEADER" context={{ isGoogleLinked, contactCount: total }} />
                        <ExtensionLoader mountPoint="CONTACTS_TOOLBAR" context={{ isGoogleLinked, contactCount: total, selectedIds: [] }} />
                        <button type="button" onClick={openCreate} aria-label={t('contacts.create')} className="p-2.5 hover:bg-muted rounded-full transition-colors text-foreground lg:hidden">
                            <Plus className="w-5 h-5" aria-hidden="true" />
                        </button>
                        <button type="button" onClick={() => setIsContactSidebarOpen(true)} aria-label={t('contacts.title')} aria-haspopup="dialog" className="p-2.5 hover:bg-muted rounded-full transition-colors text-muted-foreground lg:hidden">
                            <Settings className="w-5 h-5 text-foreground" aria-hidden="true" />
                        </button>
                    </div>
                </header>

                <div className="sm:hidden border-b border-border px-4 py-2">{searchBox(true)}</div>

                <div className="flex flex-1 overflow-hidden">
                    <main className="flex-1 min-w-0 bg-background border-t border-border flex flex-col relative z-0">
                        <div ref={scrollRef} className="flex-1 overflow-y-auto px-2 sm:px-4 lg:px-8 py-4" aria-busy={state === 'loading' || undefined}>
                            {state === 'loading' && (
                                <div role="status" className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3">
                                    <Loader2 className="w-8 h-8 animate-spin" aria-hidden="true" />
                                    <p>{t('contacts.loading')}</p>
                                </div>
                            )}

                            {state === 'error' && (
                                <div role="alert" className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3">
                                    <AlertCircle className="w-10 h-10 text-destructive" aria-hidden="true" />
                                    <p>{t('contacts.loadError')}</p>
                                    <button type="button" onClick={() => void reload(query)} className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted">
                                        {t('contacts.retry')}
                                    </button>
                                </div>
                            )}

                            {state === 'ready' && contacts.length === 0 && (
                                <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-center px-4">
                                    <Users className="w-12 h-12 mb-4 text-muted-foreground/40" aria-hidden="true" />
                                    <p>{query ? t('contacts.emptySearch', { q: query }) : t('contacts.empty')}</p>
                                </div>
                            )}

                            {state === 'ready' && contacts.length > 0 && (
                                <div className="w-full text-sm" role="table" aria-label={t('contacts.listLabel')} aria-rowcount={total}>
                                    <div role="row" className="grid-cols-[auto_1fr_1fr_auto_auto] gap-4 py-3 border-b border-border text-muted-foreground font-medium px-2 sticky top-0 bg-background z-10 hidden md:grid">
                                        <div role="columnheader" className="w-10"><span className="sr-only">{t('contacts.colName')}</span></div>
                                        <div role="columnheader">{t('contacts.colName')}</div>
                                        <div role="columnheader">{t('contacts.colEmail')}</div>
                                        <div role="columnheader" className="w-24 text-right">{t('contacts.colSource')}</div>
                                        <div role="columnheader" className="w-[76px] text-right"><span className="sr-only">{t('contacts.colActions')}</span></div>
                                    </div>
                                    {contacts.map((contact) => {
                                        const display = contactDisplayName(contact);
                                        return (
                                            <div role="row" key={contact.id} className="grid grid-cols-[auto_1fr_auto] md:grid-cols-[auto_1fr_1fr_auto_auto] gap-x-3 md:gap-4 py-2 md:py-3 border-b border-border/50 items-center px-2 hover:bg-muted/30 rounded-lg transition-colors">
                                                <div role="cell" className="w-10 flex items-center justify-center">
                                                    <div className="w-9 h-9 rounded-full bg-primary/10 text-primary font-medium flex items-center justify-center" aria-hidden="true">
                                                        {contactInitial(contact)}
                                                    </div>
                                                </div>
                                                <div role="cell" className="min-w-0 md:contents">
                                                    <button type="button" onClick={() => openEdit(contact)} className="block max-w-full text-left font-medium text-foreground truncate pr-2 md:pr-4 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                                        {display}
                                                    </button>
                                                    <div className="text-muted-foreground truncate text-xs md:text-sm md:block">
                                                        {contact.email}
                                                    </div>
                                                </div>
                                                <div role="cell" className="text-xs uppercase tracking-wider text-muted-foreground/70 hidden md:block text-right w-24">
                                                    {sourceLabel(contact.source)}
                                                </div>
                                                <div role="cell" className="flex items-center justify-end gap-1 md:w-[76px]">
                                                    <button type="button" onClick={() => openEdit(contact)} aria-label={t('contacts.editFor', { name: display })} className="p-2 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                                        <Pencil className="w-4 h-4" aria-hidden="true" />
                                                    </button>
                                                    <button type="button" onClick={() => { setDeleteError(null); setDeleting(contact); }} aria-label={t('contacts.deleteFor', { name: display })} className="p-2 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}

                                    <div ref={sentinelRef} aria-hidden="true" className="h-px" />
                                    <div className="flex flex-col items-center gap-2 py-4 text-xs text-muted-foreground" role="status">
                                        <span>{t('contacts.count', { shown: contacts.length, total })}</span>
                                        {moreError && <span role="alert" className="text-destructive">{t('contacts.loadError')}</span>}
                                        {(hasMore || moreError) && (
                                            <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60">
                                                {loadingMore ? t('contacts.loadingMore') : moreError ? t('contacts.retry') : t('contacts.loadMore')}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </main>

                    <aside className="hidden lg:flex bg-background flex-col flex-shrink-0 border-l border-border h-full w-[256px]">
                        {renderContactSidebarContent()}
                    </aside>

                    <Drawer open={isContactSidebarOpen} onClose={() => setIsContactSidebarOpen(false)} label={t('contacts.title')} side="right" className="flex flex-col border-l border-border w-[256px] lg:hidden">
                        {renderContactSidebarContent()}
                    </Drawer>
                </div>
            </div>

            <ContactFormModal open={formOpen} contact={editing} onClose={() => setFormOpen(false)} onSaved={handleSaved} />

            <ConfirmDialog
                open={!!deleting}
                destructive
                busy={deleteBusy}
                error={deleteError}
                title={t('contacts.deleteTitle')}
                description={t('contacts.deleteConfirm', { name: deleting ? contactDisplayName(deleting) : '' })}
                confirmLabel={deleteBusy ? t('contacts.deleting') : t('contacts.delete')}
                cancelLabel={t('contacts.cancel')}
                onConfirm={() => void confirmDelete()}
                onCancel={() => setDeleting(null)}
            />
        </div>
    );
}
