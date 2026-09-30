'use client';

import { useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { EmailList } from '@/components/EmailList';
import { MailView } from '@/components/MailView';
import { Loader2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useI18n } from '@/components/I18nProvider';
import { useAppSidebar } from '@/components/layout/AppShell';

/**
 * Bandeja en escritorio: lista + lector (la barra lateral y su ancho viven en el shell compartido, `layout/AppShell`).
 * Los tamanos son EXPLICITOS: en react-resizable-panels v4 un numero son PIXELES (antes `defaultSize={20}` se leia como 20 px y
 * `maxSize={305}` fijaba el tope de la barra en 305 px), asi que los porcentajes van como texto y los minimos en px.
 */
export const LIST_PANEL = { defaultSize: '40%', minSize: '320px' } as const;
export const READER_PANEL = { defaultSize: '60%', minSize: '360px' } as const;

function DesktopLayout() {
    const searchParams = useSearchParams();
    const selectedId = searchParams.get('id');

    return (
        <div className="h-full w-full">
            <Group orientation="horizontal" className="h-full" resizeTargetMinimumSize={{ coarse: 24, fine: 8 }}>
                <Panel id="mail-list" defaultSize={LIST_PANEL.defaultSize} minSize={LIST_PANEL.minSize}>
                    <EmailList />
                </Panel>

                {selectedId && (
                    <>
                        <Separator className="w-px bg-border outline-none transition-colors hover:bg-primary focus-visible:bg-ring data-[separator=active]:bg-primary" />
                        <Panel id="mail-reader" defaultSize={READER_PANEL.defaultSize} minSize={READER_PANEL.minSize}>
                            <MailView />
                        </Panel>
                    </>
                )}
            </Group>
        </div>
    );
}

import { Menu, User, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SettingsModal } from '@/components/SettingsModal';

function MobileLayout() {
    const { t } = useI18n();
    const searchParams = useSearchParams();
    const router = useRouter();
    const { openDrawer, drawerOpen } = useAppSidebar();
    const selectedId = searchParams.get('id');
    const [showSettings, setShowSettings] = useState(false);

    // Movil: cabecera (menu + busqueda) fija; el menu abre el cajon del shell. Sin id: lista; con id: lector en su lugar.

    return (
        <div className="h-full w-full flex flex-col relative overflow-hidden bg-background">
            {/* Persistent Mobile Header */}
            {/* When reading an email, usually header changes (Back Button), but user asked to NOT hide navbar? 
                Actually user said "no esconda el navbar... sino que remplaze la lista". 
                If we keep this search bar, we need to handle "Back" somewhere else (MailView toolbar).
            */}
            <div className="p-2 sticky top-0 z-30 bg-background/80 backdrop-blur-md shrink-0">
                <div className="flex items-center gap-2 h-12 bg-header text-header-foreground border border-border rounded-full px-4 shadow-sm backdrop-blur-xl">
                    <button
                        type="button"
                        onClick={openDrawer}
                        aria-label={t('emailList.mobile.openMenu')}
                        aria-haspopup="dialog"
                        aria-expanded={drawerOpen}
                        className="-ml-1 flex h-11 w-11 items-center justify-center opacity-80 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
                    >
                        <Menu className="h-6 w-6" aria-hidden="true" />
                    </button>
                    <input
                        type="search"
                        enterKeyHint="search"
                        aria-label={t('emailList.mobile.searchLabel')}
                        placeholder={t('emailList.mobile.searchPlaceholder')}
                        defaultValue={searchParams.get('q') || ''}
                        className="flex-1 bg-transparent border-none outline-none text-base placeholder:text-muted-foreground"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                const val = (e.target as HTMLInputElement).value;
                                const params = new URLSearchParams(searchParams);
                                if (val) params.set('q', val);
                                else params.delete('q');
                                router.push(`/?${params.toString()}`);
                            }
                        }}
                    />
                    <button
                        type="button"
                        onClick={() => setShowSettings(true)}
                        aria-label={t('emailList.mobile.openSettings')}
                        className="flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-xs ring-2 ring-background">
                            <User className="h-4 w-4" aria-hidden="true" />
                        </div>
                    </button>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 h-full overflow-hidden relative">
                {!selectedId ? (
                    <EmailList />
                ) : (
                    <div className="absolute inset-0 z-10 bg-background flex flex-col">
                        <MailView />
                    </div>
                )}
            </div>

            <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
        </div>
    );
}

export function LoadingScreen() {
    return <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
}

/** Contenido de la bandeja segun el modo del shell: movil (cajon) o escritorio/riel (lista + lector). */
export function MainApp() {
    const { mode } = useAppSidebar();
    return mode === 'drawer' ? <MobileLayout /> : <DesktopLayout />;
}
