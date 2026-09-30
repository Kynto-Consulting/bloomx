import type * as React from 'react';
import * as LucideIcons from 'lucide-react';

/** Iconos de marca antiguos (sin esquema) que no existen en Lucide -> equivalente generico (solo si no se pueden pintar como marca). */
const ICON_ALIASES: Record<string, string> = { GoogleDrive: 'Cloud', Drive: 'Cloud', HubSpot: 'Briefcase', Notion: 'BookOpen', Zoom: 'Video', Trello: 'Trello' };

/** Resuelve un nombre Lucide (con alias; acepta el prefijo `lucide:`). Devuelve null si no existe. */
export function resolveIcon(name: unknown): React.ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }> | null {
    if (typeof name !== 'string') return null;
    const bare = name.startsWith('lucide:') ? name.slice(7) : name;
    if (!/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(bare)) return null;
    const icon = (LucideIcons as unknown as Record<string, unknown>)[ICON_ALIASES[bare] ?? bare];
    // Los iconos de Lucide son objetos forwardRef (no funciones): se comprueba que sean renderizables.
    return icon && (typeof icon === 'function' || typeof icon === 'object') ? (icon as React.ComponentType<{ size?: number; className?: string }>) : null;
}
