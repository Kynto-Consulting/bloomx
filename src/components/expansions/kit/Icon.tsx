'use client';

import * as React from 'react';
import * as LucideIcons from 'lucide-react';
import { ICON_PX, type SizeXl } from './tokens';

/** Iconos de marca que no existen en Lucide -> equivalente generico. */
const ICON_ALIASES: Record<string, string> = { GoogleDrive: 'Cloud', Drive: 'Cloud', HubSpot: 'Briefcase', Notion: 'BookOpen', Zoom: 'Video', Trello: 'Trello' };

/** Resuelve un nombre Lucide (con alias). Devuelve null si no existe. */
export function resolveIcon(name: unknown): React.ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }> | null {
    if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(name)) return null;
    const icon = (LucideIcons as unknown as Record<string, unknown>)[ICON_ALIASES[name] ?? name];
    // Los iconos de Lucide son objetos forwardRef (no funciones): se comprueba que sean renderizables.
    return icon && (typeof icon === 'function' || typeof icon === 'object') ? (icon as React.ComponentType<{ size?: number; className?: string }>) : null;
}

export interface KitIconProps {
    name?: string;
    size?: SizeXl;
    /** Nombre accesible. Sin el, el icono es decorativo (aria-hidden). */
    label?: string;
    className?: string;
}

/**
 * Icono Lucide del kit. Un nombre desconocido muestra un circulo de ayuda (nunca rompe) y un texto corto
 * (p. ej. un emoji heredado) se muestra como texto.
 */
export function KitIcon({ name, size = 'md', label, className }: KitIconProps) {
    if (!name) return null;
    const px = ICON_PX[size] ?? 16;
    const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const };
    const Icon = resolveIcon(name);
    if (Icon) return <span className={`inline-flex shrink-0 items-center justify-center ${className ?? ''}`} {...a11y}><Icon size={px} aria-hidden={true} /></span>;
    if (name.length <= 4 && !/^[A-Za-z0-9]+$/.test(name)) return <span className={`inline-flex shrink-0 items-center justify-center leading-none ${className ?? ''}`} style={{ fontSize: px }} {...a11y}>{name}</span>;
    const Fallback = LucideIcons.CircleHelp;
    return <span className={`inline-flex shrink-0 items-center justify-center ${className ?? ''}`} {...a11y}><Fallback size={px} aria-hidden={true} /></span>;
}
