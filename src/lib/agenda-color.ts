/**
 * Colores de agenda / eventos / citas.
 *
 * Los colores de calendario y de horarios de citas los elige el usuario, asi que
 * NO se puede asumir que el texto blanco sea legible encima (un amarillo o un
 * turquesa claro con texto blanco da ~1.5:1). Estas funciones puras calculan:
 *   - un color de texto legible (>= 4.5:1, WCAG AA) para un relleno solido,
 *   - un tinte suave de un color sobre una superficie del tema,
 *   - un color de texto "de acento" que se mantiene legible sobre esas superficies.
 *
 * Solo aceptan hex (#rgb / #rrggbb): cualquier otro valor cae al color de respaldo,
 * lo que tambien evita inyectar CSS arbitrario desde datos del servidor.
 */
import { contrast, ensureContrast, mix, normalizeHex, readableOn } from './color';

export const DEFAULT_AGENDA_COLOR = '#2563eb';
/** Contraste minimo AA para texto normal. */
export const AGENDA_MIN_CONTRAST = 4.5;

/** Devuelve un hex valido (#rrggbb) o el respaldo. */
export function safeAgendaColor(value: unknown, fallback: string = DEFAULT_AGENDA_COLOR): string {
    return normalizeHex(value) ?? normalizeHex(fallback) ?? DEFAULT_AGENDA_COLOR;
}

/**
 * Color de texto con el mejor contraste sobre `bg`: blanco, casi negro y, solo si ninguno llega a 4.5
 * (grises medios: con #0a0a0a el peor caso queda en ~4.48), negro puro. Siempre >= 4.5:1.
 */
export function agendaTextOn(bg: unknown): string {
    const color = safeAgendaColor(bg);
    const first = readableOn(color);
    if (contrast(first, color) >= AGENDA_MIN_CONTRAST) return first;
    return contrast('#000000', color) >= contrast('#ffffff', color) ? '#000000' : '#ffffff';
}

/** Relleno solido + texto legible encima. */
export function agendaSolid(color: unknown, fallback?: string): { background: string; foreground: string } {
    const background = safeAgendaColor(color, fallback);
    return { background, foreground: agendaTextOn(background) };
}

/**
 * Tinte del color sobre una superficie (sin transparencia, para poder calcular contraste).
 * amount 0 = superficie, 1 = color puro.
 */
export function agendaTint(color: unknown, surface: string, amount = 0.12): string {
    const c = safeAgendaColor(color);
    const s = normalizeHex(surface) ?? '#ffffff';
    return mix(s, c, Math.max(0, Math.min(1, amount)));
}

/**
 * Texto del color de acento pero garantizando >= minRatio contra las superficies
 * indicadas (p. ej. fondo de pagina y tinte). Conserva el tono cuando puede.
 */
export function agendaAccentText(
    color: unknown,
    surfaces: string | string[],
    minRatio: number = AGENDA_MIN_CONTRAST,
): string {
    const list = (Array.isArray(surfaces) ? surfaces : [surfaces]).map((s) => normalizeHex(s) ?? '#ffffff');
    return ensureContrast(safeAgendaColor(color), list, minRatio);
}

/**
 * Chip "suave": fondo = tinte del color sobre la superficie; texto = acento
 * corregido para leerse sobre ese tinte y sobre la superficie.
 */
export function agendaSoft(
    color: unknown,
    surface: string,
    amount = 0.14,
): { background: string; foreground: string; border: string } {
    const background = agendaTint(color, surface, amount);
    return {
        background,
        foreground: agendaAccentText(color, [background, normalizeHex(surface) ?? '#ffffff']),
        border: agendaTint(color, surface, Math.min(1, amount + 0.25)),
    };
}

/** Contraste del texto elegido sobre el relleno (util para tests y avisos). */
export function agendaContrast(color: unknown): number {
    const bg = safeAgendaColor(color);
    return contrast(agendaTextOn(bg), bg);
}
