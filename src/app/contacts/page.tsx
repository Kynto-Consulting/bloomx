'use client';

import { useEffect, useState, useMemo } from 'react';
import { Sidebar as AppSidebar } from '@/components/Sidebar';
import { ExtensionLoader } from '@/components/expansions/ExtensionLoader';
import { Menu, Users, Search, HelpCircle, Settings, User, Plus, MoreVertical, Archive, Phone, Mail, FileText } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

type ContactRecord = {
    id: string;
    email: string;
    name?: string | null;
    source: string;
    notes?: string | null;
};

export default function ContactsPage() {
    const [contacts, setContacts] = useState<ContactRecord[]>([]);
    const [isGoogleLinked, setIsGoogleLinked] = useState(false);
    const [isAppSidebarOpen, setIsAppSidebarOpen] = useState(false);
    const [isContactSidebarOpen, setIsContactSidebarOpen] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    
    // Form
    const [isCreating, setIsCreating] = useState(false);
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [notes, setNotes] = useState('');

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

    const createContact = async (event: React.FormEvent) => {
        event.preventDefault();
        await fetch('/api/contacts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, notes })
        });

        setName(''); setEmail(''); setNotes(''); setIsCreating(false);
        await loadContacts();
    };

    return (
        <div className="flex h-screen w-full bg-white overflow-hidden text-slate-900 font-sans">
            <AnimatePresence>
                {isAppSidebarOpen && (
                    <>
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsAppSidebarOpen(false)} className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm xl:hidden" />
                        <motion.div initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }} className="fixed inset-y-0 left-0 z-[70] w-[80%] max-w-[300px] bg-background xl:hidden shadow-2xl">
                            <AppSidebar onClose={() => setIsAppSidebarOpen(false)} />
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            <div className="hidden border-r border-slate-200 xl:block w-[260px] flex-shrink-0 h-full overflow-hidden">
                <AppSidebar />
            </div>

            <div className="flex-1 flex flex-col h-full overflow-hidden">
                <header className="flex h-[64px] items-center justify-between px-4 border-b border-slate-200">
                    <div className="flex items-center gap-4">
                        <button onClick={() => setIsAppSidebarOpen(true)} className="p-2 -ml-2 rounded-full hover:bg-slate-100 xl:hidden">
                            <Menu className="w-6 h-6 text-slate-700" />
                        </button>
                        
                        <div className="flex items-center gap-2 pr-4 text-slate-700">
                            <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center text-white shadow-sm">
                                <Users className="w-5 h-5 text-white" />
                            </div>
                            <span className="text-xl font-normal tracking-tight hidden sm:block text-slate-700">Contacts</span>
                        </div>
                    </div>

                    <div className="flex-1 max-w-2xl px-4 lg:px-8 hidden sm:block">
                        <div className="flex items-center bg-slate-100 rounded-lg px-4 py-2 focus-within:bg-white focus-within:shadow-md focus-within:ring-1 focus-within:ring-slate-200 transition-all">
                            <Search className="w-5 h-5 text-slate-500 mr-3" />
                            <input 
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search" 
                                className="bg-transparent border-none outline-none w-full text-slate-700 placeholder:text-slate-500"
                            />
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <ExtensionLoader mountPoint="CONTACTS_HEADER" context={{ isGoogleLinked, contactCount: contacts.length }} />
                        <button onClick={() => setIsContactSidebarOpen(!isContactSidebarOpen)} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-600 hidden xl:block">
                            <Settings className="w-5 h-5 text-slate-700" />
                        </button>
                        <button onClick={() => setIsContactSidebarOpen(true)} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-600 xl:hidden">
                            <Settings className="w-5 h-5 text-slate-700" />
                        </button>
                        <button className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-600 sm:hidden"><Search className="w-6 h-6" /></button>
                    </div>
                </header>

                <div className="flex flex-1 overflow-hidden">
                    <main className="flex-1 bg-white border-t border-slate-200 flex flex-col relative z-0">
                        {isCreating && (
                            <div className="absolute top-4 left-4 z-40 w-[450px] bg-white shadow-[0_4px_24px_rgba(0,0,0,0.15)] rounded-2xl border flex flex-col animate-in fade-in zoom-in-95 overflow-hidden">
                                <div className="flex items-center justify-between p-3 border-b bg-slate-50/50">
                                    <div className="flex items-center gap-2 text-slate-600"><User className="w-4 h-4"/><span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Create Contact</span></div>
                                    <button onClick={() => setIsCreating(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-200">×</button>
                                </div>
                                <form onSubmit={createContact} className="p-5 space-y-4">
                                    <div className="flex items-center gap-4 mb-4">
                                        <div className="w-16 h-16 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center">
                                           <User className="w-8 h-8" />
                                        </div>
                                        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Name" className="flex-1 border-b-2 border-slate-100 focus:border-blue-600 focus:outline-none pb-2 text-xl placeholder:text-slate-400" />
                                    </div>
                                    <div className="space-y-4 pt-2">
                                        <div className="flex items-center gap-3">
                                            <Mail className="w-5 h-5 text-slate-400" />
                                            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="flex-1 w-full text-sm border-b border-slate-200 focus:border-blue-600 outline-none pb-1 placeholder:text-slate-400" />
                                        </div>
                                        <div className="flex flex-col gap-1 pl-8">
                                            <label className="text-xs font-medium text-slate-500 flex items-center gap-2 mt-2"><FileText className="w-4 h-4 text-slate-400"/> Notes</label>
                                            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full text-sm border-b border-transparent bg-slate-50 hover:bg-slate-100 focus:bg-slate-100 py-2 px-3 rounded transition-colors outline-none focus:border-blue-600 min-h-[80px]" placeholder="Add notes..."></textarea>
                                        </div>
                                    </div>
                                    <div className="flex justify-end pt-4">
                                        <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium px-6 py-2 transition-colors">Save</button>
                                    </div>
                                </form>
                            </div>
                        )}

                        <div className="flex-1 overflow-y-auto px-4 lg:px-8 py-4">
                            {filteredContacts.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-slate-500">
                                    <Users className="w-12 h-12 mb-4 text-slate-300" />
                                    <p>No contacts found.</p>
                                </div>
                            ) : (
                                <div className="w-full text-sm">
                                    <div className="grid grid-cols-[auto_1fr_1fr_auto_auto] gap-4 py-3 border-b border-slate-200 text-slate-500 font-medium px-2 sticky top-0 bg-white z-10 hidden md:grid">
                                        <div className="w-10"></div>
                                        <div>Name</div>
                                        <div>Email</div>
                                        <div className="w-24 text-right">Source</div>
                                        <div className="w-8"></div>
                                    </div>
                                    {filteredContacts.map((contact) => (
                                        <div key={contact.id} className="grid grid-cols-[auto_1fr] md:grid-cols-[auto_1fr_1fr_auto_auto] gap-4 py-3 border-b border-slate-100 items-center px-2 hover:bg-slate-50 group cursor-pointer rounded-lg transition-colors">
                                            <div className="w-10 flex items-center justify-center">
                                                <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 font-medium flex items-center justify-center">
                                                    {getInitial(contact.name, contact.email)}
                                                </div>
                                            </div>
                                            <div className="font-medium text-slate-900 truncate pr-4">
                                                {contact.name || contact.email}
                                            </div>
                                            <div className="text-slate-600 truncate hidden md:block">
                                                {contact.email}
                                            </div>
                                            <div className="text-xs uppercase tracking-wider text-slate-400 hidden md:block text-right w-24">
                                                {contact.source}
                                            </div>
                                            <div className="w-8 hidden md:flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                                                <MoreVertical className="w-4 h-4 text-slate-400 hover:text-slate-600" />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </main>

                    <AnimatePresence initial={false}>
                        {isContactSidebarOpen && (
                            <>
                                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsContactSidebarOpen(false)} className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm xl:hidden" />
                                <motion.aside 
                                    initial={{ width: 0, opacity: 0 }} 
                                    animate={{ width: 256, opacity: 1 }} 
                                    exit={{ width: 0, opacity: 0 }} 
                                    className="bg-white flex flex-col flex-shrink-0 border-l border-slate-200 fixed right-0 top-0 bottom-0 z-[70] h-full xl:relative xl:z-auto"
                                >
                                    <div className="p-4 py-5 px-4 z-10 w-[256px]">
                                    <button onClick={() => setIsCreating(!isCreating)} className="flex items-center justify-center gap-2 bg-blue-600 border border-blue-700 shadow-sm hover:bg-blue-700 hover:shadow-md transition-all rounded-md px-4 py-2.5 w-[calc(100%-1rem)] group">
                                        <Plus className="w-5 h-5 text-white" />
                                        <span className="text-sm font-medium text-white transition-colors">Create contact</span>
                                    </button>
                                </div>

                                <div className="p-2 flex-1 overflow-y-auto w-[256px]">
                                    <div className="flex items-center gap-4 py-3 px-4 cursor-pointer bg-blue-50 text-blue-700 rounded-lg mx-2 font-medium">
                                        <Users className="w-5 h-5" />
                                        <span className="text-sm flex-1">Contacts</span>
                                        <span className="text-xs">{contacts.length}</span>
                                    </div>
                                    <hr className="my-3 border-slate-100 mx-4" />
                                    <div className="px-4">
                                       <ExtensionLoader mountPoint="CONTACTS_SIDEBAR" context={{ isGoogleLinked }} />
                                    </div>
                                    
                                    <div className="mt-4 px-4">
                                        <ExtensionLoader mountPoint="CONTACTS_SIDEBAR_BOTTOM" context={{ isGoogleLinked }} />
                                    </div>
                                </div>
                            </motion.aside>
                            </>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );
}