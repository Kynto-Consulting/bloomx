/**
 * URL de accion de un toast de extension. Modulo SIN dependencias de servidor: lo usan el servicio (validacion) y el
 * hook de cliente (defensa en profundidad antes de navegar).
 * Solo se aceptan rutas internas ("/x", nunca "//host" ni "\") o https sin credenciales.
 */
export const MAX_TOAST_URL_LENGTH = 2000;

export function safeToastUrl(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const v = raw.trim();
    if (!v || v.length > MAX_TOAST_URL_LENGTH || /[\u0000-\u001f\u007f\s]/.test(v)) return null;
    if (v.startsWith('/')) return v.startsWith('//') || v.includes('\\') ? null : v;
    try {
        const u = new URL(v);
        if (u.protocol !== 'https:' || u.username || u.password || !u.hostname) return null;
        return u.toString();
    } catch {
        return null;
    }
}
