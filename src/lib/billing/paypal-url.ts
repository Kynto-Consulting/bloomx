/**
 * Redirecciones permitidas hacia PayPal. El backend devuelve `approveUrl` (compra) y `authorizeUrl` (Log in with PayPal); el navegador
 * solo sigue una URL https cuyo host este en esta lista FIJA (nunca derivada de la respuesta) y sin credenciales embebidas.
 */
export const PAYPAL_HOSTS: readonly string[] = ['www.paypal.com', 'www.sandbox.paypal.com', 'paypal.com'];

export function safePayPalUrl(value: unknown): string | null {
    if (typeof value !== 'string' || value.length > 2048) return null;
    let u: URL;
    try {
        u = new URL(value);
    } catch {
        return null;
    }
    if (u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    if (u.port && u.port !== '443') return null;
    if (!PAYPAL_HOSTS.includes(u.hostname.toLowerCase())) return null;
    return u.toString();
}
