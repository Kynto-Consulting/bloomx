'use client';

import { useEffect, useState, useMemo } from 'react';
import { Sidebar as AppSidebar } from '@/components/Sidebar';
import { ExtensionLoader } from '@/components/expansions/ExtensionLoader';
import { useGlobalWindow } from '@/contexts/GlobalWindowContext';
import { CreateContactForm } from '@/components/contacts/CreateContactForm';
import { Menu, Users, Search, Settings, User, Plus } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { useI18n } from '@/components/I18nProvider';
import { useDomainConfig } from '@/hooks/useDomainConfig';

type ContactRecord = {
    id: string;
    email: string;
    name?: string | null;
    source: string;
    notes?: string | null;
};

export default function ContactsPage() {
    const { t } = useI18n();
    const [contacts, setContacts] = useState<ContactRecord[]>([]);
    const [isGoogleLinked, setIsGoogleLinked] = useState(false);
    const [isAppSidebarOpen, setIsAppSidebarOpen] = useState(false);
    const [isContactSidebarOpen, setIsContactSidebarOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    
    const { config: domainConfig } = useDomainConfig();
    const brandColor = domainConfig.theme?.primaryColor;

    // Form
    const { openWindow, closeWindow } = useGlobalWindow();
    
    const handleOpenCreateContact = () => {
        openWindow({
            id: 'create-contact',
            type: 'contact',
            title: 'Create Contact',
            icon: <User className="w-4 h-4"/>,
            content: (
                <CreateContactForm
                    onSaved={() => {
                        closeWindow('create-contact');
                        void loadContacts();
                    }}
                    onClose={() => closeWindow('create-contact')}
                />
            )
        });
    };

    const loadContacts = async () => {
        const [contactsResponse, settingsResponse] = await Promise.all([
            fetch('/api/contacts'),
            fetch('/api/settings'),
        ]);
        const contactsData = await contactsResponse.json();
        const settingsData = await settingsResponse.json();
        setContacts(Array.isArray(contactsData) ? contactsData : []);
        setIsGoogleLinked(Boolean(settingsData?.isGoogleLinked));
    };

    useEffect(() => {
        void loadContacts();

        const handleSyncComplete = () => {
            void loadContacts();
        };

        window.addEventListener('bloomx:contacts-sync-complete', handleSyncComplete);
        return () => window.removeEventListener('bloomx:contacts-sync-complete', handleSyncComplete);
    }, []);

    const filteredContacts = useMemo(() => {
        return contacts.filter(c => 
            (c.name || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
            (c.email || '').toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [contacts, searchQuery]);

    const getInitial = (name?: string | null, email?: string | null) => {
        if (name && name.length > 0) return name[0].toUpperCase();
        if (email && email.length > 0) return email[0].toUpperCase();
        return '?';
    };

    const renderContactSidebarContent = () => (
        <>
            <div className="p-4 py-5 px-4 z-10 w-[256px]">
                <button type="button" onClick={handleOpenCreateContact} className="flex items-center justify-center gap-2 bg-primary border border-primary/80 shadow-sm hover:bg-primary/90 hover:shadow-md transition-all rounded-md px-4 py-2.5 w-[calc(100%-1rem)] group">
                    <Plus className="w-5 h-5 text-primary-foreground" aria-hidden="true" />
                    <span className="text-sm font-medium text-primary-foreground transition-colors">Create contact</span>
                </button>
            </div>

            <div className="p-2 flex-1 overflow-y-auto w-[256px]">
                <div className="flex items-center gap-4 py-3 px-4 cursor-pointer bg-primary/10 text-primary rounded-lg mx-2 font-medium">
                    <Users className="w-5 h-5" />
                    <span className="text-sm flex-1">Contacts</span>
                    <span className="text-xs">{contacts.length}</span>
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

    return (
        <div className="flex h-screen w-full bg-background overflow-hidden text-foreground font-sans">
            <Drawer open={isAppSidebarOpen} onClose={() => setIsAppSidebarOpen(false)} label={t('common.openMenu')} side="left" className="w-[80%] max-w-[300px] lg:hidden">
                <AppSidebar onClose={() => setIsAppSidebarOpen(false)} />
            </Drawer>

            <div className="hidden border-r border-border lg:block w-[260px] flex-shrink-0 h-full overflow-hidden">
                <AppSidebar />
            </div>

            <div className="flex-1 flex flex-col h-full overflow-hidden">
                <header className="flex h-[64px] items-center justify-between px-4 border-b border-border">
                    <div className="flex items-center gap-4">
                        <button type="button" onClick={() => setIsAppSidebarOpen(true)} aria-label={t('common.openMenu')} aria-haspopup="dialog" className="p-2.5 -ml-2 rounded-full hover:bg-muted lg:hidden">
                            <Menu className="w-6 h-6 text-foreground" aria-hidden="true" />
                        </button>
                        
                        <div className="flex items-center gap-2 pr-4 text-foreground">
                            <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground shadow-sm">
                                <Users className="w-5 h-5 text-primary-foreground" aria-hidden="true" />
                            </div>
                            <h1 className="text-xl font-normal tracking-tight hidden sm:block text-foreground">Contacts</h1>
                        </div>
                    </div>

                    <div className="flex-1 max-w-2xl px-4 lg:px-8 hidden sm:block">
                        <div className="flex items-center bg-muted rounded-lg px-4 py-2 focus-within:bg-background focus-within:shadow-md focus-within:ring-1 focus-within:ring-border transition-all">
                            <Search className="w-5 h-5 text-muted-foreground mr-3" aria-hidden="true" />
                            <input
                                type="search"
                                aria-label={t('common.search')}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search" 
                                className="bg-transparent border-none outline-none w-full text-foreground placeholder:text-muted-foreground"
                            />
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <ExtensionLoader mountPoint="CONTACTS_HEADER" context={{ isGoogleLinked, contactCount: contacts.length }} />
                        <button type="button" onClick={() => setIsContactSidebarOpen(true)} aria-label="Contacts" aria-haspopup="dialog" className="p-2.5 hover:bg-muted rounded-full transition-colors text-muted-foreground lg:hidden">
                            <Settings className="w-5 h-5 text-foreground" aria-hidden="true" />
                        </button>
                    </div>
                </header>

                {/* Busqueda en movil (antes era un boton sin accion) */}
                <div className="sm:hidden border-b border-border px-4 py-2">
                    <div className="flex items-center bg-muted rounded-lg px-3 py-2 focus-within:bg-background focus-within:ring-2 focus-within:ring-ring transition-all">
                        <Search className="w-5 h-5 text-muted-foreground mr-3" aria-hidden="true" />
                        <input
                            type="search"
                            aria-label={t('common.search')}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder={t('common.search')}
                            className="bg-transparent border-none outline-none w-full text-foreground placeholder:text-muted-foreground"
                        />
                    </div>
                </div>

                <div className="flex flex-1 overflow-hidden">
                    <main className="flex-1 bg-background border-t border-border flex flex-col relative z-0">
                        {/* Global window context handles 'isCreating' modal now */}

                        <div className="flex-1 overflow-y-auto px-4 lg:px-8 py-4">
                            {filteredContacts.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                                    <Users className="w-12 h-12 mb-4 text-muted-foreground/40" />
                                    <p>No contacts found.</p>
                                </div>
                            ) : (
                                <div className="w-full text-sm">
                                    <div className="grid grid-cols-[auto_1fr_1fr_auto_auto] gap-4 py-3 border-b border-border text-muted-foreground font-medium px-2 sticky top-0 bg-background z-10 hidden md:grid">
                                        <div className="w-10"></div>
                                        <div>Name</div>
                                        <div>Email</div>
                                        <div className="w-24 text-right">Source</div>
                                        <div className="w-8"></div>
                                    </div>
                                    {filteredContacts.map((contact) => (
                                        <div key={contact.id} className="grid grid-cols-[auto_1fr] md:grid-cols-[auto_1fr_1fr_auto_auto] gap-4 py-3 border-b border-border/50 items-center px-2 hover:bg-muted/30 group cursor-pointer rounded-lg transition-colors">
                                            <div className="w-10 flex items-center justify-center">
                                                <div className="w-9 h-9 rounded-full bg-primary/10 text-primary font-medium flex items-center justify-center">
                                                    {getInitial(contact.name, contact.email)}
                                                </div>
                                            </div>
                                            <div className="font-medium text-foreground truncate pr-4">
                                                {contact.name || contact.email}
                                            </div>
                                            <div className="text-muted-foreground truncate hidden md:block">
                                                {contact.email}
                                            </div>
                                            <div className="text-xs uppercase tracking-wider text-muted-foreground/60 hidden md:block text-right w-24">
                                                {contact.source}
                                            </div>
                                            <div className="w-8 hidden md:block" aria-hidden="true" />
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </main>

                    <aside className="hidden lg:flex bg-background flex-col flex-shrink-0 border-l border-border h-full w-[256px]">
                        {renderContactSidebarContent()}
                    </aside>

                    <Drawer open={isContactSidebarOpen} onClose={() => setIsContactSidebarOpen(false)} label="Contacts" side="right" className="flex flex-col border-l border-border w-[256px] lg:hidden">
                        {renderContactSidebarContent()}
                    </Drawer>
                </div>
            </div>
        </div>
    );
}