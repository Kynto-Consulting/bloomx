'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Puzzle, ShieldCheck } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background';
const LINK = `inline-flex w-fit items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 ${FOCUS}`;
const LINK_SECONDARY = `inline-flex w-fit items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted ${FOCUS}`;

/** ¿Es administrador de esta instancia? /api/admin/me responde 200 solo a admins (401/403 = no). Un fallo se trata como "no". */
export function useIsInstanceAdmin(fetchImpl: typeof fetch = fetch): boolean {
    const [admin, setAdmin] = useState(false);
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetchImpl('/api/admin/me', { cache: 'no-store' });
                if (!cancelled) setAdmin(res.status === 200);
            } catch {
                if (!cancelled) setAdmin(false);
            }
        })();
        return () => { cancelled = true; };
    }, [fetchImpl]);
    return admin;
}

/**
 * Enlace "Gestionar extensiones" de Ajustes: lleva a /extensions (activar, ordenar, revisar) y, solo para administradores,
 * a la seccion Extensiones de la consola (/admin/extensions). Navegable con teclado (son enlaces); `onNavigate` cierra el modal.
 */
export function ManageExtensionsLink({ onNavigate, isAdmin }: { onNavigate?: () => void; isAdmin?: boolean }) {
    const { t } = useI18n();
    const detected = useIsInstanceAdmin();
    const admin = isAdmin ?? detected;
    return (
        <section aria-labelledby="settings-manage-extensions-title" data-testid="manage-extensions-link" className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
            <div className="flex items-start gap-3">
                <span aria-hidden="true" className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-foreground"><Puzzle className="h-[18px] w-[18px]" /></span>
                <div className="min-w-0 space-y-1">
                    <h3 id="settings-manage-extensions-title" className="text-base font-semibold text-foreground">{t('extensionState.settingsLink.title')}</h3>
                    <p className="text-sm text-muted-foreground">{t('extensionState.settingsLink.description')}</p>
                    <p className="text-xs text-muted-foreground">{t('extensionState.settingsLink.hint')}</p>
                </div>
            </div>
            <div className="flex flex-wrap gap-2">
                <Link href="/extensions" onClick={onNavigate} className={LINK} data-testid="manage-extensions-open">
                    {t('extensionState.settingsLink.open')}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
            </div>
            {admin && (
                <div className="space-y-2 border-t border-border/60 pt-3" data-testid="manage-extensions-admin">
                    <p className="text-sm font-medium text-foreground">{t('extensionState.settingsLink.adminTitle')}</p>
                    <p className="text-sm text-muted-foreground">{t('extensionState.settingsLink.adminDescription')}</p>
                    <Link href="/admin/extensions" onClick={onNavigate} className={LINK_SECONDARY} data-testid="manage-extensions-open-admin">
                        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                        {t('extensionState.settingsLink.openAdmin')}
                    </Link>
                </div>
            )}
        </section>
    );
}
