'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronDown, LogOut, Mail, UserCircle } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { LOCALES, LOCALE_LABELS } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useConsole } from './ConsoleContext';
import { initials } from './format';

/**
 * Menu del perfil (patron WAI-ARIA "menu button"): flechas para moverse, Inicio/Fin, Escape cierra y devuelve el foco
 * al boton, clic fuera cierra. Incluye Mi perfil, idioma, volver al correo y cerrar sesion de administracion.
 */
export function ProfileMenu() {
    const { t, locale, setLocale } = useI18n();
    const { me } = useConsole();
    const [open, setOpen] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const wrapRef = React.useRef<HTMLDivElement>(null);
    const btnRef = React.useRef<HTMLButtonElement>(null);
    const menuId = React.useId();

    const items = () => Array.from(wrapRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"],[role="menuitemradio"]') ?? []);

    React.useEffect(() => {
        if (!open) return;
        items()[0]?.focus();
        const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const close = (restoreFocus = true) => {
        setOpen(false);
        if (restoreFocus) btnRef.current?.focus();
    };

    const onMenuKey = (e: React.KeyboardEvent) => {
        const list = items();
        const i = list.indexOf(document.activeElement as HTMLElement);
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
        else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
        else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
        else if (e.key === 'Tab') setOpen(false);
    };

    const signOut = async () => {
        if (busy) return;
        setBusy(true);
        try {
            if (me?.kind === 'manager') {
                await fetch('/api/admin/logout', { method: 'POST' });
                window.location.href = '/admin/login';
            } else {
                await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
                window.location.href = '/login';
            }
        } catch {
            setBusy(false);
        }
    };

    const itemCls = 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-popover-foreground hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none';
    const email = me?.email ?? '';

    return (
        <div ref={wrapRef} className="relative">
            <button
                ref={btnRef}
                type="button"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? menuId : undefined}
                aria-label={t('admin.console.shell.profileMenu')}
                onClick={() => setOpen((v) => !v)}
                onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background pl-1.5 pr-2 text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
                <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{initials(null, email)}</span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            </button>
            {open && (
                <div id={menuId} role="menu" aria-label={t('admin.console.shell.profileMenu')} onKeyDown={onMenuKey} className="absolute right-0 z-40 mt-2 w-64 rounded-lg border border-border bg-popover p-1.5 shadow-lg">
                    <div className="px-3 py-2">
                        <p className="truncate text-sm font-medium text-foreground">{email || t('admin.console.shell.roleAdmin')}</p>
                        <p className="text-xs text-muted-foreground">{me?.kind === 'manager' ? t('admin.console.shell.roleManager') : t('admin.console.shell.roleAdmin')}</p>
                    </div>
                    <div role="separator" className="my-1 h-px bg-border" />
                    <Link href="/admin/profile" role="menuitem" tabIndex={-1} className={itemCls} onClick={() => close(false)}>
                        <UserCircle className="h-4 w-4" aria-hidden="true" />{t('admin.console.shell.myProfile')}
                    </Link>
                    <div role="group" aria-label={t('admin.console.shell.language')} className="px-3 py-1.5">
                        <p className="mb-1 text-xs text-muted-foreground" aria-hidden="true">{t('admin.console.shell.language')}</p>
                        <div className="flex gap-1">
                            {LOCALES.map((l) => (
                                <button
                                    key={l}
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={locale === l}
                                    tabIndex={-1}
                                    onClick={() => setLocale(l)}
                                    className={cn('flex-1 rounded-md border px-2 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', locale === l ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground hover:bg-accent')}
                                >
                                    {LOCALE_LABELS[l]}
                                </button>
                            ))}
                        </div>
                    </div>
                    <Link href="/" role="menuitem" tabIndex={-1} className={itemCls} onClick={() => close(false)}>
                        <Mail className="h-4 w-4" aria-hidden="true" />{t('admin.console.shell.backToMail')}
                    </Link>
                    <div role="separator" className="my-1 h-px bg-border" />
                    <button type="button" role="menuitem" tabIndex={-1} className={itemCls} onClick={() => void signOut()} disabled={busy}>
                        <LogOut className="h-4 w-4" aria-hidden="true" />{t('admin.console.shell.signOut')}
                    </button>
                </div>
            )}
        </div>
    );
}
