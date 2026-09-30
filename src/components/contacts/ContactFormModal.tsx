'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { FileText, Mail, User, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useI18n } from '@/components/I18nProvider';
import { isValidContactEmail } from '@/lib/contacts';

export type ContactRecord = {
    id: string;
    email: string;
    name?: string | null;
    source: string;
    notes?: string | null;
};

/** Crear (contact = null) o editar un contacto. Accesible: dialogo modal con foco atrapado y errores anunciados. */
export function ContactFormModal({
    open, contact, onClose, onSaved,
}: {
    open: boolean;
    contact: ContactRecord | null;
    onClose: () => void;
    onSaved: (saved: ContactRecord, created: boolean) => void;
}) {
    const { t } = useI18n();
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [emailError, setEmailError] = useState<string | null>(null);
    const ids = { name: useId(), email: useId(), notes: useId(), emailErr: useId() };
    const emailRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return;
        setName(contact?.name ?? '');
        setEmail(contact?.email ?? '');
        setNotes(contact?.notes ?? '');
        setError(null);
        setEmailError(null);
        setSaving(false);
    }, [open, contact]);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (saving) return;
        if (!isValidContactEmail(email)) {
            setEmailError(t('contacts.emailInvalid'));
            emailRef.current?.focus();
            return;
        }
        setEmailError(null);
        setError(null);
        setSaving(true);
        try {
            const res = await fetch(contact ? `/api/contacts/${encodeURIComponent(contact.id)}` : '/api/contacts', {
                method: contact ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, notes }),
            });
            if (!res.ok) {
                if (res.status === 409) setEmailError(t('contacts.emailExists'));
                else if (res.status === 400) setEmailError(t('contacts.emailInvalid'));
                else setError(t('contacts.saveFailed'));
                if (res.status === 409 || res.status === 400) emailRef.current?.focus();
                return;
            }
            const saved = (await res.json()) as ContactRecord;
            onSaved(saved, !contact);
        } catch {
            setError(t('common.networkError'));
        } finally {
            setSaving(false);
        }
    };

    const field = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';

    return (
        <Modal
            open={open}
            onClose={saving ? () => undefined : onClose}
            closeOnBackdrop={!saving}
            dialogOptions={{ disableEscape: saving }}
            panelClassName="w-full max-w-md rounded-xl border border-border bg-background shadow-xl max-h-[90vh] overflow-y-auto"
        >
            {({ titleId }) => (
                <form onSubmit={submit} noValidate className="p-5">
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <h2 id={titleId} className="flex items-center gap-2 text-lg font-semibold text-foreground">
                            <User className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                            {contact ? t('contacts.editTitle') : t('contacts.createTitle')}
                        </h2>
                        <button type="button" onClick={onClose} disabled={saving} aria-label={t('common.close')} className="rounded-full p-2 text-muted-foreground hover:bg-muted">
                            <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label htmlFor={ids.name} className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground">
                                <User className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{t('contacts.nameLabel')}
                            </label>
                            <input id={ids.name} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('contacts.namePlaceholder')} autoComplete="off" maxLength={200} className={field} />
                        </div>
                        <div>
                            <label htmlFor={ids.email} className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground">
                                <Mail className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{t('contacts.emailLabel')}
                            </label>
                            <input
                                ref={emailRef}
                                id={ids.email}
                                type="email"
                                value={email}
                                onChange={(e) => { setEmail(e.target.value); if (emailError) setEmailError(null); }}
                                placeholder={t('contacts.emailPlaceholder')}
                                autoComplete="off"
                                required
                                aria-invalid={emailError ? true : undefined}
                                aria-describedby={emailError ? ids.emailErr : undefined}
                                className={field}
                            />
                            {emailError && <p id={ids.emailErr} role="alert" className="mt-1 text-xs text-destructive">{emailError}</p>}
                        </div>
                        <div>
                            <label htmlFor={ids.notes} className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground">
                                <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{t('contacts.notesLabel')}
                            </label>
                            <textarea id={ids.notes} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('contacts.notesPlaceholder')} rows={3} maxLength={5000} className={`${field} resize-none`} />
                        </div>
                        {contact?.source === 'google' && <p className="text-xs text-muted-foreground">{t('contacts.googleEditNote')}</p>}
                    </div>

                    {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}

                    <div className="mt-6 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
                        <button type="button" onClick={onClose} disabled={saving} className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50">
                            {t('contacts.cancel')}
                        </button>
                        <button type="submit" disabled={saving || !email.trim()} aria-busy={saving || undefined} className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                            {saving ? t('contacts.saving') : t('contacts.save')}
                        </button>
                    </div>
                </form>
            )}
        </Modal>
    );
}
