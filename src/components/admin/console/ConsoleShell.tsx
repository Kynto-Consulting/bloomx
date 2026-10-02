'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronRight, Menu, Search, X } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useI18n } from '@/components/I18nProvider';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { useExtensionNav, useNavBadges } from '@/hooks/useExtensionNav';
import { ExtensionNavLinks, isNavItemActive } from '@/components/expansions/nav/ExtensionNavLinks';
import type { NavItemView } from '@/lib/expansions/nav-entries';
import { cn } from '@/lib/utils';
import { ApiError, useAdminQuery } from './api';
import { ConsoleContext, useConsole, type ConsoleContextValue, type ConsoleMe } from './ConsoleContext';
import { SessionEndedOverlay, useSessionEnded } from './SessionEnded';
import { NAV_GROUP_ORDER, NAV_ITEMS, isActiveHref, navItemFor, type NavItem } from './nav';
import { GlobalSearch } from './GlobalSearch';
import { ProfileMenu } from './ProfileMenu';
import { SystemStatus } from './SystemStatus';
import { useDensity } from './density';
import { LoadingState, btnOutline, btnPrimary } from './ui';

/**
 * Armazon de la consola de administracion: puerta de acceso (GET /api/admin/me), navegacion lateral por secciones
 * (cajon en movil), cabecera (breadcrumb, busqueda global, dominio activo, estado del sistema, menu del perfil) y
 * proteccion de cambios sin guardar. Landmarks: header, nav, main; enlace "saltar al contenido".
 */

function typingTarget(el: EventTarget | null): boolean {
    const n = el as HTMLElement | null;
    if (!n || !n.tagName) return false;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName) || n.isContentEditable;
}

function NavList({ pathname, onNavigate, extensionItems = [], badges = {} }: { pathname: string; onNavigate: (href: string) => void; extensionItems?: readonly NavItemView[]; badges?: Record<string, number | null> }) {
    const { t } = useI18n();
    // El menu oculta lo que el permission_level no permite (las rutas lo rechazan igualmente con 403). Sin nivel conocido: se muestra todo.
    const level = useConsole().me?.permission_level ?? 4;
    return (
        <nav aria-label={t('admin.console.shell.navLabel')} className="px-3 pb-4">
            {NAV_GROUP_ORDER.map((group) => {
                const items = NAV_ITEMS.filter((n) => n.group === group && n.minLevel <= level);
                if (items.length === 0) return null;
                return (
                    <div key={group} className="mt-4 first:mt-0">
                        <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(`admin.console.shell.groups.${group}`)}</p>
                        <ul className="space-y-0.5">
                            {items.map((item: NavItem) => {
                                const active = isActiveHref(pathname, item.href);
                                const Icon = item.icon;
                                return (
                                    <li key={item.id}>
                                        <Link
                                            href={item.href}
                                            aria-current={active ? 'page' : undefined}
                                            onClick={(e) => {
                                                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                                                e.preventDefault();
                                                onNavigate(item.href);
                                            }}
                                            className={cn(
                                                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                                active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
                                            )}
                                        >
                                            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                                            <span className="truncate">{t(`admin.console.shell.nav.${item.id}`)}</span>
                                        </Link>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                );
            })}
            {extensionItems.length > 0 && (
                <div className="mt-4" data-console-extension-nav="">
                    <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('extensionState.nav.adminGroup')}</p>
                    <ExtensionNavLinks items={extensionItems} badges={badges} pathname={pathname} onNavigate={() => undefined} onItemClick={onNavigate} />
                </div>
            )}
        </nav>
    );
}

function BrandMark({ name, logo }: { name: string; logo: string | null }) {
    return (
        <div className="flex min-w-0 items-center gap-2.5">
            {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} alt="" className="h-8 w-8 shrink-0 rounded-md object-cover" />
            ) : (
                <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
                    {(name || 'B').charAt(0).toUpperCase()}
                </span>
            )}
            <span className="truncate text-sm font-bold text-sidebar-foreground">{name}</span>
        </div>
    );
}

export function ConsoleShell({ children }: { children: React.ReactNode }) {
    const { t } = useI18n();
    const router = useRouter();
    const pathname = usePathname() || '/admin';
    const { config } = useDomainConfig();
    const [density] = useDensity();
    const gate = useAdminQuery<{ me: ConsoleMe }>('/api/admin/me', { revalidateOnFocus: false });
    const ended = useSessionEnded();
    // Entradas de menu de las extensiones (section "admin"): el servidor ya no envia las que el nivel no alcanza; aqui se vuelven a filtrar por el nivel real de la sesion.
    const extensionItems = useExtensionNav({ section: 'admin', level: gate.data?.me?.permission_level ?? null, signedIn: gate.data !== undefined });
    const extensionBadges = useNavBadges(extensionItems);

    const [menuOpen, setMenuOpen] = React.useState(false);
    const [searchOpen, setSearchOpen] = React.useState(false);
    const [crumbTail, setCrumbTail] = React.useState<string | null>(null);
    const dirtyRef = React.useRef(false);
    const [pendingHref, setPendingHref] = React.useState<string | null>(null);
    const mainRef = React.useRef<HTMLElement>(null);
    const firstRender = React.useRef(true);
    const menuId = React.useId();

    const setDirty = React.useCallback((d: boolean) => { dirtyRef.current = d; }, []);
    const cfg = config as { id?: string; name?: string; displayName?: string; logo?: string | null };
    const domain = React.useMemo(() => ({
        id: cfg.id,
        name: cfg.name || '',
        displayName: cfg.displayName || cfg.name || t('admin.console.shell.brandFallback'),
        logo: cfg.logo ?? null,
    }), [cfg.id, cfg.name, cfg.displayName, cfg.logo, t]);

    const ctx = React.useMemo<ConsoleContextValue>(() => ({
        me: gate.data?.me ?? null, domain, setDirty, setCrumbTail,
    }), [gate.data, domain, setDirty]);

    // Navegacion con proteccion de cambios sin guardar
    const navigate = React.useCallback((href: string) => {
        setMenuOpen(false);
        if (dirtyRef.current) { setPendingHref(href); return; }
        router.push(href);
    }, [router]);

    // Aviso del navegador al cerrar/recargar con cambios pendientes
    React.useEffect(() => {
        const onBefore = (e: BeforeUnloadEvent) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = ''; } };
        window.addEventListener('beforeunload', onBefore);
        return () => window.removeEventListener('beforeunload', onBefore);
    }, []);

    // Al volver a la pestana se revalida la sesion (consulta pasiva): una sesion reemplazada o caducada se detecta al instante.
    React.useEffect(() => {
        const onVisible = () => { if (document.visibilityState === 'visible') void gate.mutate(); };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', onVisible);
        return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); };
    }, [gate]);

    // Atajos: "/" o Ctrl/Cmd+K abren la busqueda global
    React.useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const isK = (e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey);
            const isSlash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !typingTarget(e.target);
            if (!isK && !isSlash) return;
            if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
            e.preventDefault();
            setSearchOpen(true);
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, []);

    // Al cambiar de seccion: el tail del breadcrumb se limpia y el foco pasa al contenido (lectores de pantalla)
    React.useEffect(() => {
        setCrumbTail(null);
        if (firstRender.current) { firstRender.current = false; return; }
        mainRef.current?.focus({ preventScroll: true });
    }, [pathname]);

    const error = gate.error as ApiError | undefined;
    if (!gate.data) {
        if (error) {
            const endedCode = error.code === 'SUPERSEDED' || error.code === 'EXPIRED' || error.code === 'ACCOUNT_LOCKED';
            if (error.status === 401 && !endedCode && typeof window !== 'undefined') {
                // Sin sesion: se manda al acceso de administracion (los admins de la app tambien pueden usar /login).
                window.location.replace('/admin/login');
            }
            const msg =
                error.code === 'MFA_REQUIRED' ? t('admin.console.shell.gate.mfaRequired')
                : error.status === 401 ? t('admin.console.shell.gate.needLogin')
                : error.status === 403 ? t('admin.console.shell.gate.forbidden')
                : error.status === 0 || error.status >= 500 ? t('admin.console.shell.gate.backendDown')
                : t('admin.console.shell.gate.forbidden');
            if (endedCode) return <SessionEndedOverlay detail={ended ?? { code: error.code as 'SUPERSEDED' | 'EXPIRED' | 'ACCOUNT_LOCKED' }} />;
            return (
                <main className="flex min-h-screen items-center justify-center bg-background p-6">
                    <div role="alert" className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-sm">
                        <h1 className="text-lg font-semibold text-foreground">{t('admin.console.shell.consoleName')}</h1>
                        <p className="mt-2 text-sm text-muted-foreground">{msg}</p>
                        <div className="mt-5 flex flex-wrap justify-center gap-2">
                            <a href="/admin/login" className={btnPrimary}>{t('admin.console.shell.gate.goLogin')}</a>
                            <a href="/" className={btnOutline}>{t('admin.console.shell.backToMail')}</a>
                        </div>
                    </div>
                </main>
            );
        }
        return <div className="min-h-screen bg-background"><LoadingState label={t('admin.console.shell.gate.checking')} className="min-h-screen" /></div>;
    }

    const current = navItemFor(pathname);
    const extensionCurrent = current ? undefined : extensionItems.find((item) => isNavItemActive(pathname, item.href));
    const sectionLabel = current ? t(`admin.console.shell.nav.${current.id}`) : extensionCurrent?.label ?? '';

    return (
        <ConsoleContext.Provider value={ctx}>
            <div data-density={density} className="group/console min-h-screen bg-background text-foreground lg:flex">
                <a href="#console-main" className="sr-only z-[200] rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
                    {t('admin.console.shell.skipToContent')}
                </a>

                {/* Barra lateral (escritorio) */}
                <aside className="hidden w-64 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
                    <div className="border-b border-sidebar-border px-4 py-4"><BrandMark name={domain.displayName} logo={domain.logo} /></div>
                    <div className="flex-1 overflow-y-auto py-4"><NavList pathname={pathname} onNavigate={navigate} extensionItems={extensionItems} badges={extensionBadges} /></div>
                </aside>

                {/* Cajon de navegacion (movil / tablet) */}
                <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} label={t('admin.console.shell.navLabel')} side="left" className="flex w-72 max-w-[85vw] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
                    <div id={menuId} className="flex items-center justify-between border-b border-sidebar-border px-4 py-4">
                        <BrandMark name={domain.displayName} logo={domain.logo} />
                        <button type="button" onClick={() => setMenuOpen(false)} aria-label={t('admin.console.shell.closeMenu')} className="rounded-md p-2 text-muted-foreground hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto py-4"><NavList pathname={pathname} onNavigate={navigate} extensionItems={extensionItems} badges={extensionBadges} /></div>
                </Drawer>

                <div className="flex min-w-0 flex-1 flex-col">
                    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-header px-3 text-header-foreground sm:px-4">
                        <button
                            type="button"
                            onClick={() => setMenuOpen(true)}
                            aria-label={t('admin.console.shell.openMenu')}
                            aria-expanded={menuOpen}
                            aria-controls={menuId}
                            className="rounded-md p-2 text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
                        >
                            <Menu className="h-5 w-5" aria-hidden="true" />
                        </button>

                        <nav aria-label={t('admin.console.shell.breadcrumbLabel')} className="min-w-0 flex-1">
                            <ol className="flex min-w-0 items-center gap-1 text-sm">
                                <li className="hidden shrink-0 sm:block">
                                    <Link href="/admin" onClick={(e) => { if (!(e.metaKey || e.ctrlKey || e.shiftKey)) { e.preventDefault(); navigate('/admin'); } }} className="rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                        {t('admin.console.shell.consoleName')}
                                    </Link>
                                </li>
                                {(current ? current.id !== 'overview' : Boolean(extensionCurrent)) && (
                                    <li className="flex min-w-0 items-center gap-1">
                                        <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
                                        <span className="truncate font-medium text-foreground" aria-current={crumbTail ? undefined : 'page'}>{sectionLabel}</span>
                                    </li>
                                )}
                                {current && current.id === 'overview' && (
                                    <li className="flex min-w-0 items-center gap-1 sm:hidden"><span className="truncate font-medium text-foreground" aria-current="page">{sectionLabel}</span></li>
                                )}
                                {crumbTail && (
                                    <li className="flex min-w-0 items-center gap-1">
                                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                                        <span className="truncate font-medium text-foreground" aria-current="page">{crumbTail}</span>
                                    </li>
                                )}
                            </ol>
                        </nav>

                        <button
                            type="button"
                            onClick={() => setSearchOpen(true)}
                            aria-label={t('admin.console.shell.search.open')}
                            aria-keyshortcuts="/"
                            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            <Search className="h-4 w-4" aria-hidden="true" />
                            <span className="hidden md:inline">{t('admin.console.shell.search.label')}</span>
                            <kbd aria-hidden="true" className="hidden rounded border border-border bg-muted px-1.5 text-[11px] font-medium md:inline">/</kbd>
                        </button>

                        <div className="hidden min-w-0 max-w-[14rem] items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1 md:flex" title={domain.name}>
                            <div className="min-w-0 leading-tight">
                                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('admin.console.shell.activeDomain')}</p>
                                <p className="truncate text-xs font-medium text-foreground">{domain.name || domain.displayName}</p>
                            </div>
                        </div>

                        <SystemStatus />
                        <ProfileMenu />
                    </header>

                    <main id="console-main" ref={mainRef} tabIndex={-1} className="min-w-0 flex-1 bg-muted/30 p-4 outline-none sm:p-6 lg:p-8">
                        {children}
                    </main>
                </div>

                {ended && <SessionEndedOverlay detail={ended} />}

                <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

                <ConfirmDialog
                    open={pendingHref !== null}
                    title={t('admin.console.shell.unsaved.title')}
                    description={t('admin.console.shell.unsaved.body')}
                    confirmLabel={t('admin.console.shell.unsaved.leave')}
                    cancelLabel={t('admin.console.shell.unsaved.stay')}
                    destructive
                    onCancel={() => setPendingHref(null)}
                    onConfirm={() => {
                        const href = pendingHref;
                        dirtyRef.current = false;
                        setPendingHref(null);
                        if (href) router.push(href);
                    }}
                />
            </div>
        </ConsoleContext.Provider>
    );
}
