import type { DeepString } from './types';

/**
 * Textos de la vista "Permisos" (permission_level 0..4), del selector de nivel en la ficha de usuario, de la sesion privilegiada unica
 * (consola web + CLI) y de los avisos de sesion cerrada (namespace admin.console.perms). Las descripciones de cada nivel salen de la API
 * (lib/admin-levels.ts, es/en).
 */
export const permsEs = {
    title: 'Permisos',
    description: 'Niveles de permisos de administración (0-4). El nivel decide qué ve y qué puede hacer cada cuenta en esta consola y en la CLI. ADMIN_EMAILS es la semilla/rescate: esas cuentas son nivel 4 fijado por entorno.',
    levels: { title: 'Escala de niveles', level: 'Nivel', name: 'Nombre', can: 'Qué permite' },
    accounts: {
        title: 'Cuentas con acceso al admin', description: 'Cuentas con nivel 1 o superior. Todas deben tener MFA activo.', empty: 'Ninguna cuenta con nivel asignado.',
        email: 'Correo', name: 'Nombre', level: 'Nivel', source: 'Origen', grantedBy: 'Concedido por', grantedAt: 'Fecha', mfa: 'MFA', locked: 'Estado',
        sourceEnv: 'Fijado por entorno', sourceConsole: 'Consola', lockedYes: 'Bloqueada', lockedNo: 'Activa', you: '(tú)', unlock: 'Desbloquear', unlockHint: 'Levanta el bloqueo por reemplazos de sesión repetidos (requiere MFA).',
        unlocked: 'Cuenta desbloqueada.', mfaOn: 'Activo', mfaOff: 'Sin MFA', mfaUnknown: 'Sin cuenta',
    },
    locked: { title: 'Modo solo-entorno (ADMIN_EMAILS_LOCKED)', body: 'La gestión de niveles por consola y CLI está desactivada: solo cuentan los correos de ADMIN_EMAILS (nivel 4). Para volver a gestionarlos desde aquí, quita ADMIN_EMAILS_LOCKED y vuelve a desplegar.' },
    set: {
        title: 'Asignar nivel', description: 'Solo puedes asignar niveles menores al tuyo (un superadmin puede asignar 0-4; conceder el 4 exige confirmación). El cambio exige verificar tu identidad con MFA, se audita y avisa por correo a la cuenta y a los superadmins.',
        email: 'Correo de la cuenta', level: 'Nivel', note: 'Nota (opcional)', confirmSuper: 'Confirmo que concedo el nivel 4 (superadmin): control total de la instancia.', apply: 'Asignar nivel', applying: 'Asignando...',
        applied: '{email}: nivel {from} → {to}.', pick: 'Elige un nivel',
    },
    errors: {
        permissions_locked: 'La gestión por consola está desactivada (ADMIN_EMAILS_LOCKED).',
        invalid_level: 'El nivel debe ser un entero de 0 a 4.',
        cannot_target_self: 'No puedes cambiar tu propio nivel.',
        fixed_by_env: 'Esta cuenta está fijada por entorno (ADMIN_EMAILS): solo se cambia quitándola de la variable.',
        cannot_modify_peer_or_higher: 'No puedes modificar a una cuenta de nivel igual o superior al tuyo.',
        level_not_assignable: 'Solo puedes asignar niveles menores al tuyo.',
        account_required: 'La cuenta debe existir en esta instancia.',
        mfa_required_for_level: 'La cuenta debe tener MFA activo antes de recibir un nivel.',
        privileged_limit: 'Se alcanzó el máximo de cuentas con nivel 3 o superior.',
        confirm_super_required: 'Conceder el nivel 4 exige marcar la confirmación.',
        no_change: 'La cuenta ya tiene ese nivel.',
        insufficient_level: 'Tu nivel no permite esta acción.',
        reauth_required: 'Verifica tu identidad con un código MFA para continuar.',
        user_not_found: 'No existe esa cuenta.',
        generic: 'No se pudo completar la acción.',
    },
    history: { title: 'Historial de cambios', empty: 'Sin cambios registrados.', when: 'Cuándo', email: 'Cuenta', change: 'Cambio', by: 'Hecho por', ip: 'IP', note: 'Nota' },
    drawer: {
        title: 'Nivel de permisos', current: 'Nivel {level} · {name}', fromEnv: 'fijado por entorno (ADMIN_EMAILS)', fromConsole: 'concedido desde la consola', none: 'sin acceso al admin', fromManager: 'propietaria del dominio',
        select: 'Nuevo nivel', change: 'Cambiar nivel', cannotChange: 'No puedes cambiar el nivel de esta cuenta (igual o superior al tuyo, tu propia cuenta o fijada por entorno).',
        help: 'Solo se asigna un nivel menor al tuyo. El cambio exige MFA, se audita y avisa por correo; al bajar el nivel se invalidan sus tokens de CLI.',
        confirmTitle: 'Cambiar nivel de permisos', confirmBody: '¿Cambiar el nivel de {email} de {from} a {to}?',
    },
    session: {
        title: 'Sesión privilegiada', description: 'Solo puede haber UNA sesión de administración abierta a la vez (consola web y CLI juntas). Iniciar otra cierra esta en el acto.',
        none: 'No hay ninguna sesión privilegiada abierta.', kind: 'Dónde', kindWeb: 'Consola web', kindCli: 'CLI (bloomx)', device: 'Dispositivo', ip: 'IP', since: 'Desde', lastActivity: 'Última actividad',
        idleExpires: 'Caduca por inactividad', absoluteExpires: 'Caduca (tope absoluto)', thisOne: 'Es esta sesión', yes: 'Sí', no: 'No', close: 'Cerrar sesión privilegiada', closing: 'Cerrando...',
        closeConfirm: '¿Cerrar la sesión privilegiada? Si es esta, tendrás que volver a iniciar sesión.', closed: 'Sesión privilegiada cerrada.',
        lockedTitle: 'Acceso privilegiado bloqueado', lockedBody: 'Se detectaron demasiados reemplazos de sesión seguidos ({count}). Un superadmin debe desbloquear la cuenta.',
        policy: { title: 'Política de la instancia', idle: 'Cierre por inactividad (minutos, 5-60)', threshold: 'Reemplazos que bloquean (2-10)', window: 'Ventana de reemplazos (minutos, 1-60)', save: 'Guardar política', saved: 'Política guardada.', absolute: 'Tope absoluto: {hours} h (fijo).' },
    },
    ended: {
        title: 'Sesión cerrada',
        superseded: 'Tu sesión de administración se cerró porque iniciaste otra desde {device} ({ip}) a las {time}.',
        supersededNoInfo: 'Tu sesión de administración se cerró porque iniciaste otra.',
        expired_idle: 'Tu sesión de administración caducó por inactividad.',
        expired_absolute: 'Tu sesión de administración alcanzó su duración máxima (12 h).',
        locked: 'El acceso privilegiado de tu cuenta está bloqueado por reemplazos de sesión repetidos. Cambia tu contraseña, rota tu MFA y pide a un superadmin que te desbloquee.',
        notYou: 'Si no fuiste tú: cambia tu contraseña y cierra todas las sesiones.', security: 'Ir a Seguridad', signIn: 'Iniciar sesión', redirecting: 'Te llevamos al acceso en unos segundos...',
    },
} as const;

export const permsEn: DeepString<typeof permsEs> = {
    title: 'Permissions',
    description: 'Administration permission levels (0-4). The level decides what each account sees and can do in this console and in the CLI. ADMIN_EMAILS is the seed/rescue: those accounts are level 4 fixed by the environment.',
    levels: { title: 'Level scale', level: 'Level', name: 'Name', can: 'What it allows' },
    accounts: {
        title: 'Accounts with admin access', description: 'Accounts with level 1 or higher. All of them must have MFA enabled.', empty: 'No account has a level assigned.',
        email: 'Email', name: 'Name', level: 'Level', source: 'Source', grantedBy: 'Granted by', grantedAt: 'Date', mfa: 'MFA', locked: 'State',
        sourceEnv: 'Fixed by environment', sourceConsole: 'Console', lockedYes: 'Locked', lockedNo: 'Active', you: '(you)', unlock: 'Unlock', unlockHint: 'Lifts the lock caused by repeated session replacements (requires MFA).',
        unlocked: 'Account unlocked.', mfaOn: 'On', mfaOff: 'No MFA', mfaUnknown: 'No account',
    },
    locked: { title: 'Environment-only mode (ADMIN_EMAILS_LOCKED)', body: 'Managing levels from the console and CLI is disabled: only the ADMIN_EMAILS addresses count (level 4). To manage them from here again, remove ADMIN_EMAILS_LOCKED and redeploy.' },
    set: {
        title: 'Set level', description: 'You can only assign levels lower than yours (a super admin can assign 0-4; granting 4 needs confirmation). The change requires verifying your identity with MFA, is audited and notifies the account and the super admins by email.',
        email: 'Account email', level: 'Level', note: 'Note (optional)', confirmSuper: 'I confirm I am granting level 4 (super admin): full control of the instance.', apply: 'Set level', applying: 'Applying...',
        applied: '{email}: level {from} → {to}.', pick: 'Pick a level',
    },
    errors: {
        permissions_locked: 'Console management is disabled (ADMIN_EMAILS_LOCKED).',
        invalid_level: 'The level must be an integer from 0 to 4.',
        cannot_target_self: 'You cannot change your own level.',
        fixed_by_env: 'This account is fixed by the environment (ADMIN_EMAILS): it can only be changed by removing it from the variable.',
        cannot_modify_peer_or_higher: 'You cannot modify an account at or above your own level.',
        level_not_assignable: 'You can only assign levels lower than yours.',
        account_required: 'The account must exist on this instance.',
        mfa_required_for_level: 'The account must have MFA enabled before it gets a level.',
        privileged_limit: 'The maximum number of accounts with level 3 or higher was reached.',
        confirm_super_required: 'Granting level 4 requires ticking the confirmation.',
        no_change: 'The account already has that level.',
        insufficient_level: 'Your level does not allow this action.',
        reauth_required: 'Verify your identity with an MFA code to continue.',
        user_not_found: 'That account does not exist.',
        generic: 'The action could not be completed.',
    },
    history: { title: 'Change history', empty: 'No changes recorded.', when: 'When', email: 'Account', change: 'Change', by: 'Done by', ip: 'IP', note: 'Note' },
    drawer: {
        title: 'Permission level', current: 'Level {level} · {name}', fromEnv: 'fixed by environment (ADMIN_EMAILS)', fromConsole: 'granted from the console', none: 'no admin access', fromManager: 'domain owner',
        select: 'New level', change: 'Change level', cannotChange: 'You cannot change this account\'s level (equal or higher than yours, your own account or fixed by the environment).',
        help: 'You can only assign a level lower than yours. The change requires MFA, is audited and notified by email; lowering the level invalidates its CLI tokens.',
        confirmTitle: 'Change permission level', confirmBody: 'Change the level of {email} from {from} to {to}?',
    },
    session: {
        title: 'Privileged session', description: 'Only ONE administration session can be open at a time (web console and CLI together). Starting another closes this one immediately.',
        none: 'No privileged session is open.', kind: 'Where', kindWeb: 'Web console', kindCli: 'CLI (bloomx)', device: 'Device', ip: 'IP', since: 'Since', lastActivity: 'Last activity',
        idleExpires: 'Expires when idle', absoluteExpires: 'Expires (absolute cap)', thisOne: 'This session', yes: 'Yes', no: 'No', close: 'Close privileged session', closing: 'Closing...',
        closeConfirm: 'Close the privileged session? If it is this one, you will have to sign in again.', closed: 'Privileged session closed.',
        lockedTitle: 'Privileged access locked', lockedBody: 'Too many session replacements in a row were detected ({count}). A super admin must unlock the account.',
        policy: { title: 'Instance policy', idle: 'Idle timeout (minutes, 5-60)', threshold: 'Replacements that lock (2-10)', window: 'Replacement window (minutes, 1-60)', save: 'Save policy', saved: 'Policy saved.', absolute: 'Absolute cap: {hours} h (fixed).' },
    },
    ended: {
        title: 'Session closed',
        superseded: 'Your administration session was closed because you started another from {device} ({ip}) at {time}.',
        supersededNoInfo: 'Your administration session was closed because you started another.',
        expired_idle: 'Your administration session expired due to inactivity.',
        expired_absolute: 'Your administration session reached its maximum duration (12 h).',
        locked: 'Privileged access for your account is locked because of repeated session replacements. Change your password, rotate your MFA and ask a super admin to unlock you.',
        notYou: 'If this was not you: change your password and sign out of all sessions.', security: 'Go to Security', signIn: 'Sign in', redirecting: 'Taking you to the sign-in page in a few seconds...',
    },
};
