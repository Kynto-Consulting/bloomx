import type { PermissionLevel } from './permissions-core';

/**
 * UNICA fuente de verdad de "que nivel de permisos (permission_level) hace falta para cada cosa" en la administracion:
 *   - SCOPE_LEVELS:   rutas /api/admin/** hechas con adminRoute (por su `scope`).
 *   - DIRECT_ROUTES:  rutas que no usan adminRoute (guardia directo).
 *   - COMMAND_LEVELS: comandos de la consola web / CLI (cada comando del catalogo DEBE figurar aqui; lo comprueba un test).
 * La comprobacion se hace en UN solo sitio: requireLevel(n) en admin-auth.ts (rutas) y exec.ts (comandos). Las rutas siguen
 * aplicandola aunque se llamen directamente, asi que ocultar algo en el menu nunca es la unica barrera.
 *
 * Criterio: 1 = lectura (support) · 2 = gestion de cuentas y listas de spam (operator) · 3 = configuracion de la instancia (admin) ·
 * 4 = seguridad critica y acciones destructivas globales (superadmin).
 */
type L = PermissionLevel;

export const SCOPE_LEVELS: Record<string, L> = {
    // lectura
    me: 1, overview: 1, system: 1, search: 1, 'users.list': 1, 'users.detail': 1, 'users.quota.read': 1, 'accounts.list': 1, 'audit.read': 1,
    'mail.metrics': 1, 'mail.dns': 1, 'mail.webhooks': 1, 'mail.suppressions': 1, 'retention.settings.read': 1, 'retention.quota.read': 1, 'retention.storage': 1,
    'spam.config.read': 1, 'spam.events.read': 1, 'spam.stats.read': 1, 'spam.lists.read': 1, 'extensions.catalog': 1, 'extensions.status': 1, 'extensions.stars': 1, 'ai.read': 1,
    'profile.get': 1, 'profile.sessions': 1, 'profile.sessions.revoke': 1,
    // gestion de cuentas (operator)
    'users.create': 2, 'users.update': 2, 'users.bulk': 2, 'users.export': 2, 'users.sessions': 2, 'users.quota.write': 2,
    'accounts.unlink': 2, 'accounts.reconnect': 2, 'oauth.providers': 3, 'oauth.approve': 3, 'oauth.secret': 4, 'mail.suppressions.write': 2,
    'spam.lists.write': 2, 'spam.lists.import': 2, 'spam.lists.export': 2, 'spam.simulate': 2, 'spam.test': 2,
    // configuracion (admin)
    'users.password': 3, 'audit.export': 3, 'security.status': 3, 'retention.settings.write': 3, 'retention.quota.write': 3, 'spam.config.write': 3,
    'extensions.installed': 3, 'extensions.install': 3, 'extensions.update': 3, 'extensions.uninstall': 3, 'extensions.toggle': 3, 'extensions.order': 3, 'extensions.test': 3,
    // IA: ajustes no criticos 3; la rama critica (enabled/provider/baseUrl/apiKey) exige 4 + step-up dentro del handler
    'ai.write': 3, 'ai.test': 3, 'ai.purge': 3,
    'permissions.read': 3, 'permissions.write': 3, 'permissions.history': 3, 'profile.password': 1, 'privileged.read': 1, 'privileged.close': 1,
    // seguridad critica / destructivo global (superadmin)
    'users.mfa_reset': 4, 'permissions.unlock': 4, 'privileged.policy': 4, 'retention.run.dry': 4, 'extensions.mandatory': 4, 'domain-key.get': 4, 'signing.status': 1, 'domain-key.write': 4,
    // pagos y portal de desarrolladores (dueno del dominio; el step-up lo aplica el proxy por ruta)
    'billing.read': 4, 'billing.write': 4, 'developer.read': 4, 'developer.write': 4,
};

/** Un scope desconocido exige nivel 3 (equivale al antiguo requireAdmin). */
export const levelForScope = (scope: string): L => SCOPE_LEVELS[scope] ?? 3;

/** Rutas con guardia directo (sin adminRoute): metodo + ruta -> nivel. */
export const DIRECT_ROUTES: Record<string, L> = {
    'GET /api/admin/domain': 1,
    'PUT /api/admin/domain': 3,
    'GET /api/admin/conferencing': 3,
    'GET /api/admin/extensions/settings': 3,
    'PUT /api/admin/extensions/settings': 4,
    'POST /api/admin/extensions/settings': 4,
    'GET /api/admin/extensions/config': 3,
    'PUT /api/admin/extensions/config': 4,
    'POST /api/admin/extensions/config': 4,
    'GET /api/admin/retention': 4,
    'POST /api/admin/retention': 4,
    'ALL /api/admin/mail-transfer/**': 3,
};

export const COMMAND_LEVELS: Record<string, L> = {
    // sesion y cuenta
    help: 1, whoami: 1, domains: 1, use: 1, profile: 1, limits: 1, 'tokens list': 1, 'tokens create': 1, 'tokens revoke': 1, 'tokens revoke-all': 1,
    // usuarios
    'users list': 1, 'users show': 1, 'users sessions': 1, 'users quota': 1, 'users rules': 1, 'users labels': 1, search: 1,
    'users create': 2, 'users rename': 2, 'users disable': 2, 'users enable': 2, 'users bulk': 2, 'users export': 2, 'users sessions revoke': 2, 'users quota set': 2,
    'users password-reset': 3, 'users force-password-change': 3, 'users mfa-reset': 4,
    'accounts list': 1, 'accounts unlink': 2, 'accounts reconnect': 2, 'jobs rules': 2,
    // sistema
    overview: 1, 'system status': 1, 'system version': 1, 'system queues': 3, 'system schema': 3, 'config list': 3, 'config get': 3,
    // correo
    'mail metrics': 1, 'mail dns': 1, 'mail webhooks': 1, 'mail queue': 1, 'mail config': 1, 'mail suppressions': 1, 'mail suppressions remove': 2,
    // auditoria y seguridad
    audit: 1, 'audit events': 1, 'audit export': 3,
    'security status': 3, 'security admins': 3, 'security events': 3, 'security policies': 1,
    'security keys': 4, 'security keys register': 4, 'security keys require-signature': 4,
    'oauth providers': 3, 'oauth approve': 3, 'security signing': 1, 'oauth secret set': 4, 'oauth secret clear': 4,
    // retencion y cuotas
    'retention show': 1, 'retention storage': 1, 'quota show': 1, 'retention set': 3, 'quota set': 3, 'retention run': 4,
    // marca
    'domain show': 1, 'theme list': 1, 'theme show': 1, 'theme export': 1, 'theme validate': 1, 'landing show': 1, 'landing export': 1, 'landing validate': 1,
    'domain set': 3, 'theme import': 3, 'theme apply': 3, 'theme policy': 3, 'landing import': 3, 'landing set': 3, 'landing reset': 3,
    // extensiones
    'extensions catalog': 1, 'extensions status': 1,
    'extensions list': 3, 'extensions install': 3, 'extensions update': 3, 'extensions uninstall': 3, 'extensions enable': 3, 'extensions disable': 3, 'extensions order': 3,
    'extensions test': 3, 'extensions credentials': 3, 'extensions conferencing': 3,
    'extensions mandatory': 4, 'extensions credentials set': 4, 'extensions credentials unset': 4, 'extensions credentials migrate': 4,
    'extensions config': 3, 'extensions config set': 4, 'extensions config reset': 4, 'extensions config import-env': 4, 'extensions config action': 4,
    // IA de la instancia
    'ai status': 1, 'ai usage': 1, 'ai audit': 1, 'ai test': 3, 'ai set': 3, 'ai purge': 3,
    'ai enable': 4, 'ai disable': 4, 'ai connection set': 4, 'ai key set': 4, 'ai key clear': 4,
    // spam
    'spam config': 1, 'spam events': 1, 'spam stats': 1, 'spam list': 1,
    'spam simulate': 2, 'spam test': 2, 'spam list add': 2, 'spam list remove': 2, 'spam list import': 2, 'spam list export': 2,
    'spam config set': 3, 'spam config reset': 3,
    // facturacion y portal de desarrollador (solo lectura; dueno del dominio)
    'billing status': 4, 'billing subscriptions': 4, 'billing summary': 4, 'developer overview': 4,
    // importar / exportar correo (buzones)
    jobs: 3, 'jobs show': 3, 'jobs watch': 3,
    'transfer config': 3, 'transfer mailboxes': 3, 'transfer jobs': 3, 'transfer job': 3, 'transfer report': 3, 'transfer preview': 3, 'transfer cancel': 3, 'transfer resume': 3,
    'transfer delete': 3, 'transfer export': 3, 'transfer download-link': 3, 'transfer import-create': 3, 'transfer import-complete': 3, 'transfer import-password': 3,
    'transfer mailboxes-create': 3, 'transfer import-confirm': 3,
    // permisos
    'perms levels': 1, 'perms list': 3, 'perms history': 3, 'perms set': 3, 'perms unlock': 4,
    // sesion privilegiada
    'session show': 1, 'session close': 1, 'session policy': 1, 'session policy set': 4,
};

export const commandLevel = (name: string): L => COMMAND_LEVELS[name] ?? 4; // sin entrada: el nivel mas restrictivo (falla cerrado)

/** Ambito (scope) maximo de un token segun el nivel de la cuenta: read desde 1, write desde 2, security desde 2 (sus comandos exigen su propio nivel). */
export const SCOPE_MIN_LEVEL = { read: 1, write: 2, security: 2 } as const;

/** Descripcion de la escala (docs, help y UI). */
export const LEVEL_DOCS: Record<L, { es: { name: string; can: string }; en: { name: string; can: string } }> = {
    0: { es: { name: 'user', can: 'Usuario normal: sin acceso al admin.' }, en: { name: 'user', can: 'Regular user: no admin access.' } },
    1: {
        es: { name: 'support', can: 'Solo lectura: usuarios, auditoría, estado del sistema, correo, spam y marca en lectura. Nada que escriba.' },
        en: { name: 'support', can: 'Read only: users, audit, system status, mail, spam and brand (read). Nothing that writes.' },
    },
    2: {
        es: { name: 'operator', can: 'Gestiona cuentas: crear, deshabilitar y reactivar usuarios, cuotas, sesiones (revocar), supresiones y listas de spam. No toca configuración global ni seguridad.' },
        en: { name: 'operator', can: 'Manages accounts: create, disable and re-enable users, quotas, sessions (revoke), suppressions and spam lists. No global configuration or security.' },
    },
    3: {
        es: { name: 'admin', can: 'Configuración de la instancia: marca/temas/landing, extensiones, retención, cuotas del dominio, política de spam, transferencias de buzones, restablecer contraseñas. Gestiona niveles 0-2.' },
        en: { name: 'admin', can: 'Instance configuration: brand/themes/landing, extensions, retention, domain quotas, spam policy, mailbox transfers, password resets. Manages levels 0-2.' },
    },
    4: {
        es: { name: 'superadmin', can: 'Todo: claves de firma, extensiones obligatorias y credenciales, restablecer MFA, purga de retención real y niveles de otros (0-4). Conceder el 4 exige confirmación y step-up con MFA.' },
        en: { name: 'superadmin', can: 'Everything: signing keys, mandatory extensions and credentials, MFA resets, real retention purge and others\' levels (0-4). Granting 4 needs confirmation and an MFA step-up.' },
    },
};
