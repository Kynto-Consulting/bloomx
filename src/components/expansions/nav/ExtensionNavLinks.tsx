'use client';

import * as React from 'react';
import Link from 'next/link';
import { useI18n } from '@/components/I18nProvider';
import { KitIcon } from '../kit/Icon';
import { cn } from '@/lib/utils';
import { formatBadge, type NavItemView } from '@/lib/expansions/nav-entries';

export interface ExtensionNavLinksProps {
    items: readonly NavItemView[];
    /** Valores de las insignias (clave de la entrada -> numero). */
    badges?: Record<string, number | null>;
    pathname: string;
    onNavigate?: () => void;
    /** Navegacion controlada por quien llama (la consola pide confirmar cambios sin guardar): recibe el destino y se cancela la navegacion por defecto. */
    onItemClick?: (href: string) => void;
    className?: string;
}

/** La entrada esta activa si la ruta actual es su pagina o cuelga de ella. */
export function isNavItemActive(pathname: string, href: string | null): boolean {
    if (!href) return false;
    return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Enlaces de las entradas de navegacion de extensiones, con el aspecto de la barra lateral del correo. Una entrada deshabilitada (IA apagada,
 * dependencia que falta) no es un enlace: se muestra atenuada con el motivo como texto y tooltip. La insignia se anuncia a lectores de pantalla.
 */
export function ExtensionNavLinks({ items, badges = {}, pathname, onNavigate, onItemClick, className }: ExtensionNavLinksProps) {
    const { t } = useI18n();
    if (items.length === 0) return null;
    return (
        <ul className={cn('m-0 flex list-none flex-col gap-1 p-0', className)} data-extension-nav="">
            {items.map((item) => {
                const active = isNavItemActive(pathname, item.href);
                const badge = formatBadge(badges[item.key]);
                const pending = badge ? t('extensionState.nav.pending', { n: badges[item.key] as number }) : '';
                const body = (
                    <>
                        <KitIcon name={item.icon ?? 'Puzzle'} size="md" className="shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {badge && (
                            <span aria-hidden="true" className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold tabular-nums text-primary-foreground">{badge}</span>
                        )}
                    </>
                );
                if (item.disabled) {
                    return (
                        <li key={item.key}>
                            <span
                                role="link"
                                aria-disabled="true"
                                title={item.disabled.text}
                                data-nav-disabled={item.disabled.reason}
                                className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground opacity-70"
                            >
                                {body}
                                <span className="sr-only">{item.disabled.text}</span>
                            </span>
                        </li>
                    );
                }
                return (
                    <li key={item.key}>
                        <Link
                            href={item.href as string}
                            onClick={(e) => {
                                if (onItemClick && !(e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)) { e.preventDefault(); onItemClick(item.href as string); return; }
                                onNavigate?.();
                            }}
                            aria-current={active ? 'page' : undefined}
                            aria-label={pending ? `${item.label}, ${pending}` : undefined}
                            className={cn(
                                'flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                            )}
                        >
                            {body}
                        </Link>
                    </li>
                );
            })}
        </ul>
    );
}
