'use client';

import * as React from 'react';
import * as LucideIcons from 'lucide-react';
import { ICON_PX, type SizeXl } from './tokens';
import { resolveIcon } from './resolve-icon';
import { ExtensionIcon, nearestIconSize } from '../ExtensionIcon';
import { resolveIconRef } from '@/lib/expansions/icon-ref';

export { resolveIcon } from './resolve-icon';

export interface KitIconProps {
    /** Nombre Lucide, `lucide:<Nombre>`, `brand:<slug>` (logotipo de una app integrada) o `initials:<XY>`. */
    name?: string;
    size?: SizeXl;
    /** Nombre accesible. Sin el, el icono es decorativo (aria-hidden). */
    label?: string;
    className?: string;
}

/**
 * Icono del kit. Un nombre Lucide (con o sin `lucide:`) se pinta con Lucide; `brand:<slug>` / `initials:<XY>` (y los nombres antiguos
 * de apps, p. ej. "Zoom") con ExtensionIcon. Un nombre desconocido muestra un circulo de ayuda (nunca rompe) y un texto corto
 * (p. ej. un emoji heredado) se muestra como texto.
 */
export function KitIcon({ name, size = 'md', label, className }: KitIconProps) {
    if (!name) return null;
    const px = ICON_PX[size] ?? 16;
    const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const };
    const ref = resolveIconRef(name);
    if (ref && ref.kind !== 'lucide') {
        return <span className={`inline-flex shrink-0 items-center justify-center ${className ?? ''}`} {...a11y}><ExtensionIcon icon={name} size={nearestIconSize(px)} /></span>;
    }
    const Icon = resolveIcon(name);
    if (Icon) return <span className={`inline-flex shrink-0 items-center justify-center ${className ?? ''}`} {...a11y}><Icon size={px} aria-hidden={true} /></span>;
    if (name.length <= 4 && !/^[A-Za-z0-9]+$/.test(name)) return <span className={`inline-flex shrink-0 items-center justify-center leading-none ${className ?? ''}`} style={{ fontSize: px }} {...a11y}>{name}</span>;
    const Fallback = LucideIcons.CircleHelp;
    return <span className={`inline-flex shrink-0 items-center justify-center ${className ?? ''}`} {...a11y}><Fallback size={px} aria-hidden={true} /></span>;
}
