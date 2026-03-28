'use client';

import { useEffect, useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { ExtensionLoader } from '@/components/expansions/ExtensionLoader';
import { Menu, Users } from 'lucide-react';
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
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
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

    const createContact = async (event: React.FormEvent) => {
        event.preventDefault();
        await fetch('/api/contacts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, notes })
        });

        setName('');
        setEmail('');
        setNotes('');
        await loadContacts();
    };

    return (
        <div className="flex min-h-screen bg-background">
            <AnimatePresence>
                {isSidebarOpen && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setIsSidebarOpen(false)}
                            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
                        />
                        <motion.div
                            initial={{ x: '-100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '-100%' }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                            className="fixed inset-y-0 left-0 z-50 w-[80%] max-w-[300px] border-r bg-background shadow-2xl md:hidden"
                        >
                            <Sidebar onClose={() => setIsSidebarOpen(false)} />
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
            <div className="hidden w-[280px] border-r md:block">
                <Sidebar />
            </div>
            <main className="flex-1 p-6 md:p-8">
                <div className="mx-auto flex max-w-5xl flex-col gap-8">
                    <div className="sticky top-0 z-30 -mx-2 flex items-center justify-between rounded-2xl border bg-background/90 px-4 py-3 backdrop-blur md:hidden">
                        <button type="button" onClick={() => setIsSidebarOpen(true)} className="rounded-full p-2 text-muted-foreground hover:bg-muted">
                            <Menu className="h-5 w-5" />
                        </button>
                        <div className="text-sm font-semibold text-slate-900">Contacts</div>
                        <div className="w-9" />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 text-slate-900">
                        <div className="flex items-center gap-3">
                            <Users className="h-6 w-6" />
                            <h1 className="text-2xl font-semibold">Contacts</h1>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                            <ExtensionLoader
                                mountPoint="CONTACTS_HEADER"
                                context={{
                                    isGoogleLinked,
                                    contactCount: contacts.length,
                                }}
                            />
                        </div>
                    </div>
                    {!isGoogleLinked && (
                        <p className="text-sm text-muted-foreground">Vincula Google desde configuración para importar tu libreta de contactos.</p>
                    )}

                    <div className="grid gap-8 lg:grid-cols-[320px,1fr]">
                        <div className="space-y-4">
                            <ExtensionLoader
                                mountPoint="CONTACTS_SIDEBAR"
                                context={{
                                    isGoogleLinked,
                                    contactCount: contacts.length,
                                }}
                            />

                            <form onSubmit={createContact} className="rounded-3xl border bg-white p-5 shadow-sm">
                                <div className="space-y-3">
                                    <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" className="h-11 w-full rounded-xl border px-3 text-sm" />
                                    <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" className="h-11 w-full rounded-xl border px-3 text-sm" />
                                    <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notes" className="min-h-[120px] w-full rounded-xl border px-3 py-3 text-sm" />
                                    <button type="submit" className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground">Save contact</button>
                                </div>
                            </form>
                        </div>

                        <div className="space-y-3">
                            {contacts.length === 0 && (
                                <div className="rounded-3xl border border-dashed p-8 text-center text-sm text-muted-foreground">No contacts yet.</div>
                            )}
                            {contacts.map((contact) => (
                                <div key={contact.id} className="rounded-3xl border bg-white p-5 shadow-sm">
                                    <div className="font-medium text-slate-900">{contact.name || contact.email}</div>
                                    <div className="text-sm text-muted-foreground">{contact.email}</div>
                                    <div className="mt-2 text-xs uppercase tracking-wide text-muted-foreground">Source: {contact.source}</div>
                                    {contact.notes && <div className="mt-3 text-sm text-slate-700">{contact.notes}</div>}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}