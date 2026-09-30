// Preferencias de la bandeja (densidad, vista previa, orden, gestos). Logica pura: sanea lo guardado y no toca el DOM.
import { SWIPE_PREFS, type SwipePref } from '@/lib/mail-actions';

export const MAIL_PREFS_KEY = 'bloomx:mail:prefs:v1';

export type MailDensity = 'comfortable' | 'compact' | 'spacious';
export type SnippetLines = 0 | 1 | 2;
export type MailSort = 'newest' | 'oldest' | 'sender';

export const DENSITIES: readonly MailDensity[] = ['comfortable', 'compact', 'spacious'];
export const SORTS: readonly MailSort[] = ['newest', 'oldest', 'sender'];

export interface MailPrefs {
    density: MailDensity;
    /** Lineas de vista previa del cuerpo (0 = sin vista previa). */
    snippetLines: SnippetLines;
    sort: MailSort;
    /** Encabezados de fecha (Hoy, Ayer...). Solo aplican al orden por fecha. */
    groupByDate: boolean;
    swipeRight: SwipePref;
    swipeLeft: SwipePref;
}

export const DEFAULT_MAIL_PREFS: MailPrefs = {
    density: 'comfortable',
    snippetLines: 1,
    sort: 'newest',
    groupByDate: true,
    swipeRight: 'auto',
    swipeLeft: 'auto',
};

/** Valida lo que venga de localStorage: cualquier campo invalido vuelve a su valor por defecto. */
export function parseMailPrefs(raw: unknown): MailPrefs {
    let value: unknown = raw;
    if (typeof raw === 'string') {
        try { value = JSON.parse(raw); } catch { value = null; }
    }
    const o = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
        typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
    const lines = o.snippetLines === 0 || o.snippetLines === 1 || o.snippetLines === 2 ? o.snippetLines : DEFAULT_MAIL_PREFS.snippetLines;
    return {
        density: pick(o.density, DENSITIES, DEFAULT_MAIL_PREFS.density),
        snippetLines: lines,
        sort: pick(o.sort, SORTS, DEFAULT_MAIL_PREFS.sort),
        groupByDate: typeof o.groupByDate === 'boolean' ? o.groupByDate : DEFAULT_MAIL_PREFS.groupByDate,
        swipeRight: pick(o.swipeRight, SWIPE_PREFS, DEFAULT_MAIL_PREFS.swipeRight),
        swipeLeft: pick(o.swipeLeft, SWIPE_PREFS, DEFAULT_MAIL_PREFS.swipeLeft),
    };
}

/** Geometria de la fila segun densidad (clases de espaciado; nunca colores). */
export function densityClasses(density: MailDensity): { row: string; avatar: string; gap: string; list: string; subjectLine: boolean } {
    switch (density) {
        case 'compact':
            return { row: 'py-1.5 px-2.5 md:min-h-[44px]', avatar: 'h-7 w-7 text-[11px]', gap: 'gap-2', list: 'gap-0.5', subjectLine: true };
        case 'spacious':
            return { row: 'py-4 px-4', avatar: 'h-11 w-11 text-sm', gap: 'gap-4', list: 'gap-2', subjectLine: false };
        default:
            return { row: 'py-3 px-3', avatar: 'h-9 w-9 text-xs', gap: 'gap-3', list: 'gap-1', subjectLine: false };
    }
}

/** Altura estimada de fila para la virtualizacion (px), segun densidad y lineas de vista previa. */
export function estimateRowHeight(density: MailDensity, snippetLines: SnippetLines): number {
    const base = density === 'compact' ? 48 : density === 'spacious' ? 92 : 76;
    if (density === 'compact') return base;
    return base + snippetLines * 16;
}
