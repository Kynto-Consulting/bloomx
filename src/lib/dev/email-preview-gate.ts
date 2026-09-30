/**
 * Puerta de la pagina de desarrollo `/dev/email-preview` (revision visual de los correos de reuniones).
 *
 *  - NODE_ENV === 'production'  -> NUNCA (404), aunque haya override o sesion de administrador.
 *  - Desarrollo + NEXT_PUBLIC_BLOOMX_THEME_OVERRIDE definida -> si, sin sesion (misma condicion que el playground de extensiones).
 *  - Desarrollo sin override -> solo un administrador con sesion valida (MFA incluido), la misma comprobacion de la consola.
 * Cualquier error al comprobar la sesion equivale a "no".
 */
export async function canOpenEmailPreviewLab(deps: { isAdmin?: () => Promise<boolean> } = {}): Promise<boolean> {
    if (process.env.NODE_ENV === 'production') return false;
    if (process.env.NEXT_PUBLIC_BLOOMX_THEME_OVERRIDE) return true;
    try {
        const isAdmin = deps.isAdmin ?? (async () => (await import('@/lib/admin-auth')).isAdminUserSession());
        return (await isAdmin()) === true;
    } catch {
        return false;
    }
}
