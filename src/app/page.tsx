'use client';

import { Suspense, useState, useEffect } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { Sidebar } from '@/components/Sidebar';
import { EmailList } from '@/components/EmailList';
import { MailView } from '@/components/MailView';
import { Loader2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';

function DesktopLayout() {
    const searchParams = useSearchParams();
    const selectedId = searchParams.get('id');

    return (
        <div className="h-screen w-full hidden md:block">
            <Group orientation="horizontal" className="h-full">
                {/* Panel Sidebar */}
                <Panel defaultSize={20} minSize={15} maxSize={305}>
                    <Sidebar />
                </Panel>

                <Separator className="w-px bg-border hover:bg-primary transition-colors cursor-col-resize active:bg-primary" />

                {/* Panel Lista de Correos */}
                <Panel defaultSize={32} minSize={30}>
                    <EmailList />
                </Panel>

                {selectedId && (
                    <>
                        <Separator className="w-px bg-border hover:bg-primary transition-colors cursor-col-resize active:bg-primary" />

                        {/* Panel Vista de Mensaje */}
                        <Panel defaultSize={48} >
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
    const searchParams = useSearchParams();
    const router = useRouter();
    const selectedId = searchParams.get('id');
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [showSettings, setShowSettings] = useState(false);

    // Gmail Mobile Logic (Refined):
    // 1. Mobile Header (Search/Menu Pill) persists at top.
    // 2. Sidebar is a Drawer/Overlay.
    // 3. Main Content switches:
    //    - If NO ID: Show EmailList.
    //    - If ID: Show MailView (replacing EmailList).

    return (
        <div className="h-screen w-full md:hidden flex flex-col relative overflow-hidden bg-background">
            {/* Sidebar Drawer */}
            <AnimatePresence>
                {isSidebarOpen && (
                    <>
                        {/* Backdrop */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setIsSidebarOpen(false)}
                            className="absolute inset-0 bg-black/50 z-40 backdrop-blur-sm"
                        />
                        {/* Sidebar */}
                        <motion.div
                            initial={{ x: '-100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '-100%' }}
                            transition={{ type: "spring", damping: 25, stiffness: 300 }}
                            className="absolute top-0 bottom-0 left-0 w-[80%] max-w-[300px] z-50 bg-background shadow-2xl border-r"
                        >
                            <Sidebar onClose={() => setIsSidebarOpen(false)} />
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            {/* Persistent Mobile Header */}
            {/* When reading an email, usually header changes (Back Button), but user asked to NOT hide navbar? 
                Actually user said "no esconda el navbar... sino que remplaze la lista". 
                If we keep this search bar, we need to handle "Back" somewhere else (MailView toolbar).
            */}
            <div className="p-2 sticky top-0 z-30 bg-background/50 backdrop-blur-md shrink-0">
                <div className="flex items-center gap-2 h-12 bg-muted/20 border border-border/50 rounded-full px-4 shadow-sm backdrop-blur-xl">
                    <button onClick={() => setIsSidebarOpen(true)} className="p-1 -ml-1 text-muted-foreground hover:text-foreground">
                        <Menu className="h-6 w-6" />
                    </button>
                    <input
                        placeholder="Search mail"
                        defaultValue={searchParams.get('q') || ''}
                        className="flex-1 bg-transparent border-none outline-none text-base placeholder:text-muted-foreground/70"
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
                    <button onClick={() => setShowSettings(true)}>
                        <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-blue-500 to-cyan-500 text-white flex items-center justify-center font-bold text-xs ring-2 ring-background">
                            <User className="h-4 w-4" />
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

function MainApp() {
    return (
        <>
            <DesktopLayout />
            <MobileLayout />
        </>
    );
}

export default function Home() {
    return (
        <Suspense fallback={<div className="flex h-screen w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div>}>
            <MainApp />
        </Suspense>
    );
}