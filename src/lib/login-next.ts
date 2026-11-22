/**
 * Destino tras el login para "Entrar con Bloomx" de apps externas. Modulo sin dependencias de Node (lo importa la pagina de login).
 * SOLO se acepta /api/auth/authorize[?...] relativo a este mismo origen: nada de rutas arbitrarias, //host ni \host (open redirect).
 */
const BACKSLASH = String.fromCharCode(92);

export function safeLoginNext(next: unknown): string | null {
    if (typeof next !== 'string' || next.length === 0 || next.length > 1500) return null;
    if (!next.startsWith('/') || next.startsWith('//') || next.includes(BACKSLASH) || /[\u0000-\u001f\u007f]/.test(next)) return null;
    return next === '/api/auth/authorize' || next.startsWith('/api/auth/authorize?') ? next : null;
}
