'use client';

import React, { useState } from 'react';
import { User, Mail, FileText } from 'lucide-react';

export function CreateContactForm({ 
    onSaved,
    onClose
}: { 
    onSaved: () => void;
    onClose?: () => void;
}) {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [notes, setNotes] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    const createContact = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!email && !name) return;
        
        setIsSaving(true);
        try {
            await fetch('/api/contacts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, notes })
            });

            setName(''); 
            setEmail(''); 
            setNotes('');
            onSaved();
        } catch (error) {
            console.error(error);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <form onSubmit={createContact} className="p-5 flex flex-col h-full overflow-y-auto">
            <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center flex-shrink-0 text-slate-400">
                    <User className="w-6 h-6" />
                </div>
                <input 
                    value={name} 
                    onChange={(e) => setName(e.target.value)} 
                    autoFocus 
                    placeholder="Name" 
                    className="w-full border-b-2 border-slate-100 focus:border-blue-600 focus:outline-none pb-2 text-[22px] placeholder:text-slate-400" 
                />
            </div>
            
            <div className="space-y-4 flex-1 mt-4">
                <div className="flex items-center gap-3">
                    <Mail className="w-4 h-4 text-slate-400 mt-1" />
                    <input 
                        value={email} 
                        onChange={(e) => setEmail(e.target.value)} 
                        placeholder="Email" 
                        type="email"
                        className="w-full border-b border-transparent hover:border-slate-200 focus:border-blue-600 focus:outline-none py-2 px-1 text-sm bg-slate-50 transition-colors" 
                    />
                </div>
                
                <div className="flex items-start gap-3 pt-2">
                    <FileText className="w-4 h-4 text-slate-400 mt-2.5" />
                    <textarea 
                        value={notes} 
                        onChange={(e) => setNotes(e.target.value)} 
                        placeholder="Notes..." 
                        rows={3}
                        className="w-full border-b border-slate-200 focus:border-blue-600 focus:outline-none py-2 px-1 text-sm resize-none bg-slate-50 transition-colors" 
                    />
                </div>
            </div>

            <div className="flex justify-end pt-6 mt-auto border-t">
                {onClose && (
                    <button 
                        type="button" 
                        onClick={onClose}
                        className="text-slate-500 hover:text-slate-700 font-medium px-4 py-2 mr-2"
                    >
                        Cancel
                    </button>
                )}
                <button 
                    type="submit" 
                    disabled={isSaving || (!email && !name)}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md text-sm font-medium px-6 py-2 transition-colors"
                >
                    {isSaving ? 'Saving...' : 'Save'}
                </button>
            </div>
        </form>
    );
}
