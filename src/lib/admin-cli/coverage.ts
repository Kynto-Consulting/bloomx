/**
 * Rutas de /api/admin/** SIN comando equivalente, con el motivo tecnico concreto (es/en). Las usa el test de cobertura
 * (catalog.test.ts: toda ruta del admin esta cubierta por un comando o excluida aqui) y la documentacion (/docs/admin-cli).
 */
export const EXCLUDED: Record<string, { es: string; en: string }> = {
    'GET /api/admin/extensions/stars': {
        es: 'Favoritas del marketplace: preferencia personal de la interfaz web de cada administrador (ligada a su sesion de usuario), sin sentido para un token de CLI ni efecto en la instancia.',
        en: 'Marketplace stars: a personal web-UI preference of each administrator (tied to their user session), meaningless for a CLI token and with no effect on the instance.',
    },
    'PUT /api/admin/extensions/stars': {
        es: 'Favoritas del marketplace: preferencia personal de la interfaz web de cada administrador (ligada a su sesion de usuario), sin sentido para un token de CLI ni efecto en la instancia.',
        en: 'Marketplace stars: a personal web-UI preference of each administrator (tied to their user session), meaningless for a CLI token and with no effect on the instance.',
    },
    'POST /api/admin/login': {
        es: 'Es el login web del manager (fija la cookie auth_session). La CLI usa POST /api/admin/cli/login (token) y la consola web ya esta autenticada.',
        en: 'It is the manager web login (it sets the auth_session cookie). The CLI uses POST /api/admin/cli/login (token) and the web console is already authenticated.',
    },
    'POST /api/admin/logout': {
        es: 'Cierra la cookie de la sesion web; en la CLI el equivalente es `bloomx logout` (revoca el token) y `tokens revoke`.',
        en: 'It clears the web session cookie; in the CLI the equivalents are `bloomx logout` (revokes the token) and `tokens revoke`.',
    },
    'GET /api/admin/retention': {
        es: 'Endpoint del cron de Vercel (CRON_SECRET) que ejecuta la purga; el equivalente manual es `retention run` (simulacro por defecto, --apply para borrar), que usa POST /api/admin/retention/run.',
        en: 'Vercel cron endpoint (CRON_SECRET) that runs the purge; the manual equivalent is `retention run` (dry run by default, --apply to delete), which uses POST /api/admin/retention/run.',
    },
    'POST /api/admin/retention': {
        es: 'Alias POST del cron anterior; cubierto por `retention run`.',
        en: 'POST alias of the cron endpoint above; covered by `retention run`.',
    },
    'POST /api/admin/reprocess-attachments': {
        es: 'Autentica con la cookie de SESION de usuario (getCurrentUser) y reprocesa correos del propio usuario o por id: no es una accion del guardia de admin y un token de CLI no tiene cookie de usuario. Para administradores existe el script `npm run attachments:reprocess`.',
        en: 'It authenticates with the USER session cookie (getCurrentUser) and reprocesses the caller\'s own mail or given ids: it is not an admin-guard action and a CLI token has no user cookie. Administrators have the `npm run attachments:reprocess` script.',
    },
    'PUT /api/admin/profile/password': {
        es: 'Cambia la contrasena y REEMITE la cookie de sesion del navegador (setSessionCookie): no tiene sentido con un token. Alternativas: la consola web (/admin/profile) y, para otros usuarios, `users password-reset` / `users force-password-change`.',
        en: 'It changes the password and RE-ISSUES the browser session cookie (setSessionCookie): meaningless with a token. Alternatives: the web console (/admin/profile) and, for other users, `users password-reset` / `users force-password-change`.',
    },
    'GET /api/admin/profile': {
        es: 'Depende de la cookie de usuario (getCurrentUser); el comando `profile` entrega lo mismo (identidad, MFA, sesiones) desde el actor autenticado.',
        en: 'It depends on the user cookie (getCurrentUser); the `profile` command returns the same data (identity, MFA, sessions) from the authenticated actor.',
    },
    'GET /api/admin/profile/sessions': {
        es: 'Marca "esta sesion" con la cookie del navegador; equivalente: `users sessions me`.',
        en: 'It flags "this session" using the browser cookie; equivalent: `users sessions me`.',
    },
    'DELETE /api/admin/profile/sessions': {
        es: 'Reemite la cookie de este navegador tras revocar; equivalente: `users sessions revoke me`.',
        en: 'It re-issues this browser\'s cookie after revoking; equivalent: `users sessions revoke me`.',
    },
    'DELETE /api/admin/profile/sessions/[jti]': {
        es: 'Compara con la cookie actual para no cerrar "esta sesion"; equivalente: `users sessions revoke me --jti <jti>`.',
        en: 'It compares against the current cookie so it does not close "this session"; equivalent: `users sessions revoke me --jti <jti>`.',
    },
};
