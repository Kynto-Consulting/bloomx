'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { useI18n } from '@/components/I18nProvider';
import { cn } from '@/lib/utils';

/**
 * Panel de detalle lateral (derecha) sobre el Drawer accesible del proyecto (role="dialog", foco atrapado, Escape,
 * restauracion de foco). Cabecera fija con titulo y boton de cierre, cuerpo con scroll y pie opcional.
 * En movil ocupa todo el ancho.
 */
export function DetailDrawer({
    open, onClose, title, subtitle, children, footer, className,
}: {
    open: boolean; onClose: () => void; title: string; subtitle?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; className?: string;
}) {
    const { t } = useI18n();
    return (
        <Drawer open={open} onClose={onClose} label={title} side="right" className={cn('flex w-full max-w-xl flex-col border-l border-border', className)}>
            <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
                <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold text-foreground">{title}</h2>
                    {subtitle && <div className="mt-0.5 text-sm text-muted-foreground">{subtitle}</div>}
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label={t('admin.console.common.close')}
                    className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <X className="h-4 w-4" aria-hidden="true" />
                </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">{children}</div>
            {footer && <footer className="border-t border-border px-4 py-3 sm:px-6">{footer}</footer>}
        </Drawer>
    );
}
