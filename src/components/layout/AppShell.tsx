'use client';

/**
 * Shell unico de la aplicacion: barra lateral + contenido. Lo monta `src/app/(app)/layout.tsx`, asi que la barra NO se
 * desmonta ni cambia de tamano al navegar entre bandeja, calendario, contactos, citas y Elixir.
 *
 *  - full   (>= 900 px): barra fija redimensionable (ancho compartido y persistido: localStorage + cookie).
 *  - rail   (768-899):   riel de iconos (menu + redactar) y la barra completa en un cajon.
 *  - drawer (< 768):     solo cajon; las pantallas ofrecen su boton de menu con `useAppSidebar().openDrawer`.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Loader2, Menu, Plus } from 'lucide-react';
import { Sidebar } from '@/components/Sidebar';
import { Drawer } from '@/components/ui/Drawer';
import { useI18n } from '@/components/I18nProvider';
import { useCompose } from '@/contexts/ComposeContext';
import { SidebarResizer } from './SidebarResizer';
import { sidebarModeFor, useViewportWidth, type SidebarMode } from './useViewportWidth';
import {
    RAIL_PX, SIDEBAR_STORAGE_KEY, clampSidebarWidth, readStoredSidebarWidth, resolveSidebarWidth, sanitizeStoredWidth, sidebarBounds,
    sidebarCssWidth, writeSidebarCookie, writeStoredSidebarWidth,
} from '@/lib/layout/sidebar-width';

export interface AppSidebarApi {
    mode: SidebarMode;
    /** Ancho efectivo en px de la barra fija (ya recortado al viewport). */
    width: number;
    drawerOpen: boolean;
    openDrawer: () => void;
    closeDrawer: () => void;
    setWidth: (width: number, persist?: boolean) => void;
    resetWidth: () => void;
}

const FALLBACK: AppSidebarApi = { mode: 'full', width: 256, drawerOpen: false, openDrawer: () => undefined, closeDrawer: () => undefined, setWidth: () => undefined, resetWidth: () => undefined };
const AppSidebarContext = createContext<AppSidebarApi>(FALLBACK);

/** Estado compartido de la barra lateral (modo, ancho, cajon). Fuera del shell devuelve un valor inerte seguro. */
export function useAppSidebar(): AppSidebarApi {
    return useContext(AppSidebarContext);
}

function Skeleton({ initialWidth }: { initialWidth: number | null }) {
    return (
        <div className="flex h-screen w-full overflow-hidden bg-background">
            <aside aria-hidden="true" className="hidden h-full shrink-0 border-r border-sidebar-border bg-sidebar md:block" style={{ width: sidebarCssWidth(initialWidth) }} />
            <div className="flex min-w-0 flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" /></div>
        </div>
    );
}

function Rail({ onOpen, open }: { onOpen: () => void; open: boolean }) {
    const { t } = useI18n();
    const { openCompose } = useCompose();
    const btn = 'flex h-11 w-11 items-center justify-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
    return (
        <nav aria-label={t('sidebar.rail')} data-app-rail="" style={{ width: RAIL_PX }} className="flex h-full shrink-0 flex-col items-center gap-2 border-r border-sidebar-border bg-sidebar py-3 text-sidebar-foreground">
            <button type="button" onClick={onOpen} aria-label={t('emailList.mobile.openMenu')} aria-haspopup="dialog" aria-expanded={open} className={`${btn} hover:bg-sidebar-accent`}>
                <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => openCompose()} aria-label={t('sidebar.newMessage')} className={`${btn} bg-primary text-primary-foreground hover:bg-primary/90`}>
                <Plus className="h-5 w-5" aria-hidden="true" />
            </button>
        </nav>
    );
}

export function AppShell({ children, initialSidebarWidth = null }: { children: ReactNode; initialSidebarWidth?: number | null }) {
    const { t } = useI18n();
    const viewport = useViewportWidth();
    const [stored, setStored] = useState<number | null>(initialSidebarWidth);
    const [drawerOpen, setDrawerOpen] = useState(false);

    // Reconcilia con localStorage (fuente de verdad si la cookie falta) y sincroniza entre pestanas.
    useEffect(() => {
        const fromLs = readStoredSidebarWidth();
        if (fromLs != null) setStored((cur) => (cur === fromLs ? cur : fromLs));
        const onStorage = (e: StorageEvent) => {
            if (e.key !== null && e.key !== SIDEBAR_STORAGE_KEY) return;
            const next = sanitizeStoredWidth(e.newValue);
            setStored(next);
            writeSidebarCookie(next);
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);

    const vw = viewport ?? 1280;
    const mode: SidebarMode = viewport === null ? 'full' : sidebarModeFor(viewport);
    const width = resolveSidebarWidth(stored, vw);
    const { min, max } = sidebarBounds(vw);

    const setWidth = useCallback((next: number, persist = true) => {
        const w = clampSidebarWidth(next, vw);
        setStored(w);
        if (persist) { writeStoredSidebarWidth(w); writeSidebarCookie(w); }
    }, [vw]);
    const resetWidth = useCallback(() => { setStored(null); writeStoredSidebarWidth(null); writeSidebarCookie(null); }, []);
    const openDrawer = useCallback(() => setDrawerOpen(true), []);
    const closeDrawer = useCallback(() => setDrawerOpen(false), []);

    // El cajon solo existe fuera del modo "full".
    useEffect(() => { if (mode === 'full') setDrawerOpen(false); }, [mode]);

    // Elemento estable: arrastrar el separador no vuelve a renderizar la barra (ni su contenido).
    const sidebarEl = useMemo(() => <Sidebar />, []);

    const api = useMemo<AppSidebarApi>(
        () => ({ mode, width, drawerOpen, openDrawer, closeDrawer, setWidth, resetWidth }),
        [mode, width, drawerOpen, openDrawer, closeDrawer, setWidth, resetWidth],
    );

    if (viewport === null) return <Skeleton initialWidth={stored} />;

    return (
        <AppSidebarContext.Provider value={api}>
            <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
                {mode === 'full' && (
                    <aside data-app-sidebar="" style={{ width }} className="h-full shrink-0 overflow-hidden bg-sidebar">
                        {sidebarEl}
                    </aside>
                )}
                {mode === 'full' && <SidebarResizer width={width} min={min} max={max} viewportWidth={vw} onResize={setWidth} onReset={resetWidth} />}
                {mode === 'rail' && <Rail onOpen={openDrawer} open={drawerOpen} />}
                <div data-app-content="" className="h-full min-w-0 flex-1 overflow-hidden">{children}</div>
            </div>
            <Drawer open={drawerOpen && mode !== 'full'} onClose={closeDrawer} label={t('emailList.mobile.openMenu')} side="left" className="w-[80%] max-w-[300px] bg-sidebar text-sidebar-foreground">
                <Sidebar onClose={closeDrawer} />
            </Drawer>
        </AppSidebarContext.Provider>
    );
}
