import type { Locale } from './types';

/**
 * Variables de entorno documentadas. FUENTE DE VERDAD de las tablas de /docs/env-variables.
 * El test docs.test.ts comprueba que cada nombre exista en algun .env.example o en el codigo (src/ del frontend o del backend),
 * para que la documentacion no describa variables inexistentes. Nunca pongas aqui valores reales.
 */
export type EnvScope = 'frontend' | 'backend' | 'both';
export type EnvRequired = 'required' | 'optional' | 'conditional';

export interface EnvVar {
    name: string;
    scope: EnvScope;
    group: string;
    required: EnvRequired;
    default?: string;
    desc: Record<Locale, string>;
}

export const ENV_GROUPS: Array<{ id: string; title: Record<Locale, string>; intro?: Record<Locale, string> }> = [
    { id: 'core', title: { es: 'Frontend: núcleo', en: 'Frontend: core' }, intro: { es: 'Sin `DATABASE_URL`, `NEXTAUTH_SECRET` y `RESEND_API_KEY` el frontend no funciona.', en: 'Without `DATABASE_URL`, `NEXTAUTH_SECRET` and `RESEND_API_KEY` the frontend does not work.' } },
    { id: 'signing', title: { es: 'Frontend: conexión con el backend compartido', en: 'Frontend: connection to the shared backend' } },
    { id: 'auth', title: { es: 'Sesiones y MFA', en: 'Sessions and MFA' } },
    { id: 'encryption', title: { es: 'Cifrado, assets, adjuntos y retención', en: 'Encryption, assets, attachments and retention' } },
    { id: 'mail', title: { es: 'Correo, webhooks y cron', en: 'Mail, webhooks and cron' } },
    { id: 'ratelimit', title: { es: 'Rate limit (Upstash)', en: 'Rate limit (Upstash)' } },
    { id: 'storage', title: { es: 'Almacenamiento', en: 'Storage' } },
    { id: 'ai', title: { es: 'IA', en: 'AI' } },
    { id: 'oauth', title: { es: 'OAuth y push', en: 'OAuth and push' } },
    { id: 'limits', title: { es: 'Límites de envío y Elixir', en: 'Sending limits and Elixir' } },
    { id: 'brand', title: { es: 'Marca y desarrollo', en: 'Brand and development' } },
    { id: 'backend', title: { es: 'Backend compartido', en: 'Shared backend' } },
];

const v = (
    name: string, scope: EnvScope, group: string, required: EnvRequired, def: string | undefined, es: string, en: string,
): EnvVar => ({ name, scope, group, required, default: def, desc: { es, en } });

export const ENV_VARS: EnvVar[] = [
    // ---------------- Frontend: nucleo ----------------
    v('DATABASE_URL', 'frontend', 'core', 'required', undefined, 'Cadena de conexión PostgreSQL (`pg` y Prisma). Sin ella `db:ensure` solo avisa y el pool lanza error.', 'PostgreSQL connection string (`pg` and Prisma). Without it `db:ensure` only warns and the pool throws.'),
    v('NEXTAUTH_SECRET', 'frontend', 'core', 'required', undefined, 'Secreto **propio de esta instancia**. Firma el JWT de sesión y de él se derivan por HKDF la clave interna, las URLs firmadas, los tokens de baja y cancelación y (como reserva) el cifrado. En producción sin él, falla.', 'Secret **owned by this instance**. Signs the session JWT and, through HKDF, derives the internal key, signed URLs, unsubscribe/cancellation tokens and (as a fallback) encryption. Fails in production without it.'),
    v('RESEND_API_KEY', 'frontend', 'core', 'required', undefined, 'Clave de la API de Resend: envío, lectura del correo entrante y adjuntos.', 'Resend API key: sending, reading inbound mail and attachments.'),
    v('NEXT_PUBLIC_APP_URL', 'frontend', 'core', 'optional', 'https://bloomx.arubik.dev', 'URL pública https de esta instancia. Callbacks OAuth, enlaces de baja y de mensajes sellados, cadena de cron y origen firmado hacia el backend. Fíjala siempre en producción.', 'Public https URL of this instance. OAuth callbacks, unsubscribe and sealed-message links, cron chaining and the signed origin towards the backend. Always set it in production.'),
    v('NEXT_PUBLIC_BACKEND_URL', 'frontend', 'core', 'optional', 'https://backend.bloomx.arubik.dev', 'URL del backend compartido (configuración, extensiones, login de admin, registro de dominio). Ponla siempre con https.', 'Shared backend URL (configuration, extensions, admin login, domain registration). Always use https.'),
    v('TOP_DOMAIN', 'both', 'core', 'optional', 'cabecera Host', 'Dominio (tenant) de esta instancia y dominio del correo del sistema (`noreply@…`). En el backend, si existe, prevalece sobre `?domain` en `/api/config`.', 'This instance\'s domain (tenant) and the system mail domain (`noreply@…`). On the backend, if set, it overrides `?domain` in `/api/config`.'),
    v('REGISTRATION_KEY', 'frontend', 'core', 'conditional', 'dev-secret', 'Clave que exige `/api/register`. En producción, si falta o vale `dev-secret`, el registro responde 403.', 'Key required by `/api/register`. In production, if missing or `dev-secret`, sign-up answers 403.'),
    v('ADMIN_EMAILS', 'frontend', 'auth', 'optional', undefined, 'Semilla y rescate de administración (correos separados por coma): esas cuentas son `permission_level` 4 «fijado por entorno», con MFA obligatorio; no se pueden degradar desde la consola ni la CLI (solo quitándolas de la variable). Los demás niveles 0-4 se gestionan desde `/admin/permissions` y `bloomx perms` ([Admin CLI](/docs/admin-cli#permission-levels)). Retrocompatible: si solo defines esta variable, todo funciona como antes.', 'Administration seed and rescue (comma-separated emails): those accounts are `permission_level` 4 "fixed by environment", with mandatory MFA; they cannot be demoted from the console or the CLI (only by removing them from the variable). Levels 0-4 for everyone else are managed from `/admin/permissions` and `bloomx perms` ([Admin CLI](/docs/admin-cli#permission-levels)). Backwards compatible: if you only set this variable, everything works as before.'),
    v('ADMIN_EMAILS_LOCKED', 'frontend', 'auth', 'optional', 'false', '`true` = modo solo-entorno: la consola y la CLI no gestionan niveles; el nivel efectivo es 4 si el correo está en `ADMIN_EMAILS` y 0 si no (las concesiones de consola se ignoran).', '`true` = environment-only mode: the console and CLI do not manage levels; the effective level is 4 if the email is in `ADMIN_EMAILS` and 0 otherwise (console grants are ignored).'),
    v('ADMIN_LOCKOUT_RESET', 'frontend', 'auth', 'optional', undefined, 'Rescate: correos (coma) cuyo bloqueo de acceso privilegiado por «pelea de sesiones» se levanta al siguiente acceso. Úsalo si queda bloqueado el único superadmin y quita la variable después ([Admin CLI](/docs/admin-cli#privileged-session)).', 'Rescue: emails (comma) whose privileged-access lockout caused by a "session fight" is lifted at the next access. Use it if the only super admin gets locked and remove the variable afterwards ([Admin CLI](/docs/admin-cli#privileged-session)).'),

    // ---------------- Firma / backend ----------------
    v('BLOOMX_DOMAIN_PRIVATE_KEY', 'frontend', 'signing', 'optional', undefined, 'Clave privada Ed25519 (PEM PKCS8 en una línea o base64). Con ella los proxies al backend van firmados; sin ella se usa el modo legado. Genérala con `node scripts/gen-domain-keypair.mjs`.', 'Ed25519 private key (single-line PKCS8 PEM or base64). With it the proxies to the backend are signed; without it legacy mode is used. Generate it with `node scripts/gen-domain-keypair.mjs`.'),
    v('BLOOMX_BACKEND_PUBLIC_KEY', 'frontend', 'signing', 'optional', 'descubrimiento', 'Clave pública del backend para verificar `/api/internal/mail`. Si falta se descubre en `/.well-known/bloomx-backend-key.json` (caché). Fijarla es lo más seguro.', 'Backend public key to verify `/api/internal/mail`. If absent it is discovered at `/.well-known/bloomx-backend-key.json` (cached). Pinning it is safest.'),
    v('INTERNAL_SECRET', 'frontend', 'signing', 'optional', 'derivada de NEXTAUTH_SECRET', 'Solo compatibilidad: si la defines se acepta como clave interna. No hace falta.', 'Compatibility only: if you define it, it is accepted as the internal key. Not needed.'),
    v('EXTENSION_HOOKS_DISABLED', 'frontend', 'signing', 'optional', 'false', '`true` desactiva la llamada a hooks `EMAIL_PRE_SEND` del backend.', '`true` disables the call to the backend `EMAIL_PRE_SEND` hooks.'),
    v('EXTENSION_HOOKS_FAIL_CLOSED', 'frontend', 'signing', 'optional', 'false', '`true`: si el backend no responde, el correo **no** se envía (por defecto se envía y se registra el fallo).', '`true`: if the backend does not answer, the mail is **not** sent (by default it is sent and the failure logged).'),

    // ---------------- Sesiones / MFA ----------------
    v('SESSION_TTL_SECONDS', 'frontend', 'auth', 'optional', '86400', 'Inactividad de la sesión (deslizante). Mín. 300, máx. 30 días.', 'Session inactivity (sliding). Min 300, max 30 days.'),
    v('SESSION_ABSOLUTE_MAX_SECONDS', 'frontend', 'auth', 'optional', '1209600', 'Tope absoluto desde el login (14 días). Mín. 3600, máx. 90 días.', 'Absolute cap from login (14 days). Min 3600, max 90 days.'),
    v('SESSION_ALLOW_LEGACY_TOKENS', 'frontend', 'auth', 'optional', 'true', '`false` rechaza ya los tokens antiguos sin `jti`.', '`false` rejects old tokens without `jti` immediately.'),
    v('SESSION_REVOCATION_CACHE_MS', 'frontend', 'auth', 'optional', '5000', 'Caché por instancia de la comprobación de revocación.', 'Per-instance cache of the revocation check.'),
    v('SESSION_COOKIE_HOST_PREFIX', 'frontend', 'auth', 'optional', 'activo en producción', 'Cookie `__Host-next-auth.session-token`. Pon `0` para desactivar el prefijo.', 'Cookie `__Host-next-auth.session-token`. Set `0` to disable the prefix.'),
    v('SESSION_COOKIE_LEGACY_READ', 'frontend', 'auth', 'optional', 'true', 'Sigue leyendo la cookie antigua sin prefijo. Pon `0` cuando ya no queden sesiones previas (máx. 30 días).', 'Keeps reading the old unprefixed cookie. Set `0` once no earlier sessions remain (max 30 days).'),
    v('MFA_ENFORCE_ADMIN', 'frontend', 'auth', 'optional', 'true', '`false` no exige MFA a `ADMIN_EMAILS`.', '`false` does not require MFA for `ADMIN_EMAILS`.'),
    v('MFA_REQUIRED_ALL', 'frontend', 'auth', 'optional', 'false', '`true` exige MFA a todos los usuarios.', '`true` requires MFA for every user.'),
    v('MFA_ISSUER', 'frontend', 'auth', 'optional', 'BRAND_NAME o Bloomx', 'Nombre del emisor en la app TOTP.', 'Issuer name in the TOTP app.'),
    v('MFA_RECOVERY_PEPPER', 'frontend', 'auth', 'optional', 'NEXTAUTH_SECRET', 'Pepper de los códigos de recuperación. Fíjalo si vas a rotar `NEXTAUTH_SECRET`.', 'Pepper for recovery codes. Pin it if you will rotate `NEXTAUTH_SECRET`.'),
    v('GOOGLE_ALLOW_SIGNUP', 'frontend', 'auth', 'optional', 'false', 'En producción, permite crear cuentas nuevas mediante Google.', 'In production, allows creating new accounts through Google.'),
    v('MOLT_SIGNING_KEY', 'frontend', 'auth', 'optional', 'derivada de NEXTAUTH_SECRET', 'Clave de los tokens de la API `molt`.', 'Key for the `molt` API tokens.'),
    v('MOLT_CONNECT_SECRET', 'frontend', 'auth', 'optional', undefined, 'Si se define, `/api/molt/auth/connect` exige este secreto en el cuerpo.', 'If set, `/api/molt/auth/connect` requires this secret in the body.'),

    // ---------------- Cifrado / assets / adjuntos ----------------
    v('DATA_ENCRYPTION_KEY', 'both', 'encryption', 'optional', 'NEXTAUTH_SECRET (frontend)', 'Clave de cifrado en reposo. Frontend: AES-256-GCM v3 (reserva `NEXTAUTH_SECRET`). Backend: 64 hex o base64 de 32 bytes; sin ella los secretos se guardan **sin cifrar**.', 'Encryption-at-rest key. Frontend: AES-256-GCM v3 (falls back to `NEXTAUTH_SECRET`). Backend: 64 hex or 32-byte base64; without it secrets are stored **unencrypted**.'),
    v('DATA_ENCRYPTION_KEY_ID', 'frontend', 'encryption', 'optional', 'k1', 'Id de la clave vigente (rotación).', 'Id of the current key (rotation).'),
    v('DATA_ENCRYPTION_KEYS_PREVIOUS', 'frontend', 'encryption', 'optional', undefined, 'Claves anteriores para descifrar: `k0:secreto,k1:otro`.', 'Previous keys for decryption: `k0:secret,k1:other`.'),
    v('ENCRYPTION_REQUIRE_DEDICATED_KEY', 'frontend', 'encryption', 'optional', 'false', '`true` obliga a definir `DATA_ENCRYPTION_KEY` en producción.', '`true` forces `DATA_ENCRYPTION_KEY` in production.'),
    v('ENCRYPTION_WRITE_FORMAT', 'frontend', 'encryption', 'optional', 'v3', 'Formato de escritura (`v2` = rollback).', 'Write format (`v2` = rollback).'),
    v('ACCOUNT_TOKENS_LAZY_MIGRATE', 'frontend', 'encryption', 'optional', 'true', '`false` desactiva la migración perezosa de tokens OAuth al formato vigente.', '`false` disables lazy migration of OAuth tokens to the current format.'),
    v('ASSET_SIGNING_KEY', 'frontend', 'encryption', 'optional', 'derivada de NEXTAUTH_SECRET', 'Clave HMAC de las URLs firmadas de `/api/assets`.', 'HMAC key for signed `/api/assets` URLs.'),
    v('ASSET_URL_TTL_SECONDS', 'frontend', 'encryption', 'optional', '3600', 'Vigencia de URLs de adjuntos recibidos.', 'Lifetime of received-attachment URLs.'),
    v('ASSET_UPLOAD_URL_TTL_SECONDS', 'frontend', 'encryption', 'optional', '2592000', 'Vigencia de URLs de subidas (30 días).', 'Lifetime of upload URLs (30 days).'),
    v('ASSET_UNSIGNED_INBOUND', 'frontend', 'encryption', 'optional', 'owner', 'Política de enlaces sin firma de adjuntos entrantes: `allow | owner | deny`.', 'Unsigned-link policy for inbound attachments: `allow | owner | deny`.'),
    v('ASSET_UNSIGNED_UPLOADS', 'frontend', 'encryption', 'optional', 'allow', 'Política de enlaces sin firma de subidas: `allow | owner | deny`.', 'Unsigned-link policy for uploads: `allow | owner | deny`.'),
    v('AV_SCAN_URL', 'frontend', 'encryption', 'optional', undefined, 'URL del antivirus (ClamAV REST). Sin ella no hay escaneo.', 'Antivirus URL (ClamAV REST). Without it there is no scanning.'),
    v('AV_SCAN_TOKEN', 'frontend', 'encryption', 'optional', undefined, 'Bearer del antivirus.', 'Antivirus bearer token.'),
    v('AV_SCAN_FIELD', 'frontend', 'encryption', 'optional', 'file', 'Nombre del campo multipart.', 'Multipart field name.'),
    v('AV_SCAN_TIMEOUT_MS', 'frontend', 'encryption', 'optional', '8000', 'Timeout del escaneo.', 'Scan timeout.'),
    v('AV_SCAN_MAX_BYTES', 'frontend', 'encryption', 'optional', '26214400', 'Tamaño máximo escaneable (25 MB); mayores se omiten.', 'Maximum scannable size (25 MB); larger files are skipped.'),
    v('AV_FAIL_MODE', 'frontend', 'encryption', 'optional', 'open', '`open`: acepta si el AV falla; `closed`: bloquea.', '`open`: accept if the AV fails; `closed`: block.'),
    v('INBOUND_BLOCK_DANGEROUS_EXT', 'frontend', 'encryption', 'optional', 'true', '`false` no bloquea extensiones peligrosas en el correo entrante.', '`false` does not block dangerous extensions in inbound mail.'),
    v('RETENTION_SPAM_DAYS', 'frontend', 'encryption', 'optional', '30', 'Días de retención de spam (0 = no purga).', 'Spam retention days (0 = no purge).'),
    v('RETENTION_TRASH_DAYS', 'frontend', 'encryption', 'optional', '0', 'Retención de la papelera (0 = desactivado).', 'Trash retention (0 = off).'),
    v('RETENTION_RAW_DAYS', 'frontend', 'encryption', 'optional', '0', 'Retención del `raw.json` del webhook (0 = desactivado).', 'Retention of the webhook `raw.json` (0 = off).'),
    v('AUDIT_RETENTION_DAYS', 'frontend', 'encryption', 'optional', '365', 'Retención de `AuditEvent` (0 = no purga).', '`AuditEvent` retention (0 = no purge).'),
    v('AUDIT_DB', 'frontend', 'encryption', 'optional', 'activo', '`off` audita solo a stdout.', '`off` audits to stdout only.'),
    v('RETENTION_BATCH', 'frontend', 'encryption', 'optional', '200', 'Lote por pasada (tope 1000).', 'Batch per pass (cap 1000).'),
    v('SECURE_MESSAGE_TTL_DAYS', 'frontend', 'encryption', 'optional', '30', 'TTL máximo de mensajes sellados.', 'Maximum sealed-message TTL.'),
    v('SECURE_MESSAGE_ENABLED', 'frontend', 'encryption', 'optional', 'true', '`false` desactiva los mensajes sellados.', '`false` disables sealed messages.'),

    // ---------------- Correo / webhooks / cron ----------------
    v('WEBHOOK_SECRET', 'frontend', 'mail', 'optional', undefined, 'Secreto `whsec_…` del webhook entrante de Resend. **Opcional por organizador**: con él se exige firma Svix válida en `/api/webhooks/resend`; sin él se acepta sin firma (solo un aviso en el log).', 'Resend inbound webhook `whsec_…` secret. **Optional per organiser**: with it a valid Svix signature is required at `/api/webhooks/resend`; without it requests are accepted unsigned (log warning only).'),
    v('RESEND_WEBHOOK_SECRET', 'frontend', 'mail', 'optional', undefined, 'Igual para el webhook de eventos (rebotes y quejas) `/api/webhooks/resend-events`. **Opcional por organizador.**', 'Same for the events webhook (bounces and complaints) `/api/webhooks/resend-events`. **Optional per organiser.**'),
    v('CRON_SECRET', 'frontend', 'mail', 'optional', undefined, 'Bearer de los crons (`/api/cron/run` global, `/api/cron/elixir`, `/api/admin/retention`). Vercel lo envía solo si la variable existe en el proyecto.', 'Bearer for cron endpoints (global `/api/cron/run`, `/api/cron/elixir`, `/api/admin/retention`). Vercel sends it only if the variable exists in the project.'),
    v('UNSUBSCRIBE_SECRET', 'frontend', 'mail', 'optional', 'NEXTAUTH_SECRET', 'Secreto de los tokens de baja (RFC 8058).', 'Secret for unsubscribe tokens (RFC 8058).'),
    v('APPOINTMENT_CANCEL_SECRET', 'frontend', 'mail', 'optional', 'NEXTAUTH_SECRET', 'Secreto de los enlaces de cancelación de citas.', 'Secret for appointment cancellation links.'),
    v('MAX_SENDS_PER_HOUR', 'frontend', 'mail', 'optional', '200', 'Máximo de envíos normales por hora y usuario (429 si se supera).', 'Maximum normal sends per hour per user (429 when exceeded).'),
    v('SPAM_SCORE_THRESHOLD', 'both', 'mail', 'optional', '60', 'Umbral inicial del filtro de spam mientras no haya configuración guardada en la consola (`/admin/spam`); entonces el nivel pasa a «personalizado».', 'Initial spam filter threshold while nothing is saved in the console (`/admin/spam`); the level then becomes "custom".'),
    v('ENABLE_AUTO_SPAM_DETECTION', 'frontend', 'mail', 'optional', 'true', '`false` desactiva el filtro de spam mientras no haya configuración guardada en la consola (la lista de bloqueo sigue activa).', '`false` turns the spam filter off while nothing is saved in the console (the blocklist stays active).'),

    // ---------------- Rate limit ----------------
    v('UPSTASH_REDIS_REST_URL', 'frontend', 'ratelimit', 'optional', undefined, 'URL REST de Upstash Redis. Con la URL **y** el token el rate limit es global; sin ellos es por instancia.', 'Upstash Redis REST URL. With the URL **and** token the rate limit is global; without them it is per instance.'),
    v('UPSTASH_REDIS_REST_TOKEN', 'frontend', 'ratelimit', 'optional', undefined, 'Token REST de Upstash.', 'Upstash REST token.'),
    v('RATE_LIMIT_ON_ERROR', 'frontend', 'ratelimit', 'optional', 'memory', 'Si Redis falla: `memory` cuenta en memoria; `open` deja pasar.', 'If Redis fails: `memory` counts in memory; `open` lets requests through.'),
    v('RATE_LIMIT_REDIS_TIMEOUT_MS', 'frontend', 'ratelimit', 'optional', '800', 'Timeout de Redis (100–5000).', 'Redis timeout (100–5000).'),

    // ---------------- Almacenamiento ----------------
    v('S3_ENDPOINT', 'frontend', 'storage', 'conditional', undefined, 'Endpoint S3-compatible (AWS, R2, MinIO, B2). Sin `S3_ACCESS_KEY` o `S3_BUCKET` el almacenamiento cae a disco local (`.gemini/storage`): solo para desarrollo.', 'S3-compatible endpoint (AWS, R2, MinIO, B2). Without `S3_ACCESS_KEY` or `S3_BUCKET` storage falls back to local disk (`.gemini/storage`): development only.'),
    v('S3_REGION', 'frontend', 'storage', 'conditional', 'us-east-1', 'Región (o `auto`).', 'Region (or `auto`).'),
    v('S3_ACCESS_KEY', 'frontend', 'storage', 'conditional', undefined, 'Access key ID.', 'Access key ID.'),
    v('S3_SECRET_KEY', 'frontend', 'storage', 'conditional', undefined, 'Secret access key.', 'Secret access key.'),
    v('S3_BUCKET', 'frontend', 'storage', 'conditional', undefined, 'Nombre del bucket.', 'Bucket name.'),
    v('S3_SSE', 'frontend', 'storage', 'optional', undefined, 'Cifrado del lado del proveedor: `AES256` o `aws:kms`.', 'Provider-side encryption: `AES256` or `aws:kms`.'),
    v('B2_ENDPOINT', 'both', 'storage', 'conditional', undefined, 'Endpoint de Backblaze B2. Frontend: alias heredado de `S3_*`. **Backend: obligatorio** para almacenar extensiones y archivos.', 'Backblaze B2 endpoint. Frontend: legacy alias of `S3_*`. **Backend: required** to store extensions and files.'),
    v('B2_REGION', 'both', 'storage', 'conditional', undefined, 'Región de B2.', 'B2 region.'),
    v('B2_BUCKET', 'both', 'storage', 'conditional', undefined, 'Bucket de B2.', 'B2 bucket.'),
    v('B2_ACCESS_KEY', 'both', 'storage', 'conditional', undefined, 'Access key de B2.', 'B2 access key.'),
    v('B2_SECRET_KEY', 'both', 'storage', 'conditional', undefined, 'Secret key de B2.', 'B2 secret key.'),

    // ---------------- IA ----------------
    v('AI_PROVIDER', 'both', 'ai', 'optional', 'openai', '**HEREDADA/DEPRECADA.** Proveedor del respaldo heredado; solo se usa si no hay configuración en `/admin/ai`. Migra: [IA](/docs/ai#migration).', '**LEGACY/DEPRECATED.** Provider of the legacy fallback; used only when nothing is configured in `/admin/ai`. Migrate: [AI](/docs/ai#migration).'),
    v('AI_KEY', 'both', 'ai', 'optional', undefined, '**HEREDADA/DEPRECADA.** Clave del respaldo heredado; solo si no hay configuración en `/admin/ai` (se muestra aviso y nunca se mezcla). La clave se gestiona ahora cifrada desde la interfaz. Migra: [IA](/docs/ai#migration).', '**LEGACY/DEPRECATED.** Key of the legacy fallback; only when nothing is configured in `/admin/ai` (a notice is shown and it is never mixed). The key is now managed encrypted from the UI. Migrate: [AI](/docs/ai#migration).'),
    v('AI_MODEL', 'both', 'ai', 'optional', 'gpt-3.5-turbo (frontend), gpt-4o-mini (backend)', '**HEREDADA/DEPRECADA.** Modelo del respaldo heredado; se elige ahora en `/admin/ai`. Migra: [IA](/docs/ai#migration).', '**LEGACY/DEPRECATED.** Model of the legacy fallback; now chosen in `/admin/ai`. Migrate: [AI](/docs/ai#migration).'),

    // ---------------- OAuth / push ----------------
    v('NEXTAUTH_URL', 'frontend', 'oauth', 'conditional', undefined, 'Origen público para construir el redirect URI de Google. Necesaria si activas el login o la sincronización de Google.', 'Public origin used to build the Google redirect URI. Needed if you enable Google login or sync.'),
    v('GOOGLE_CLIENT_ID', 'frontend', 'oauth', 'optional', undefined, 'OAuth de Google (login, Meet, calendario, contactos).', 'Google OAuth (login, Meet, calendar, contacts).'),
    v('GOOGLE_CLIENT_SECRET', 'frontend', 'oauth', 'optional', undefined, 'Secreto OAuth de Google.', 'Google OAuth secret.'),
    v('ZOOM_CLIENT_ID', 'frontend', 'oauth', 'optional', undefined, 'OAuth de Zoom.', 'Zoom OAuth.'),
    v('ZOOM_CLIENT_SECRET', 'frontend', 'oauth', 'optional', undefined, 'Secreto OAuth de Zoom.', 'Zoom OAuth secret.'),
    v('GOOGLE_API_BASE', 'frontend', 'oauth', 'optional', undefined, 'SOLO pruebas locales: base de la API de Google (también `MEET_API_BASE`, `GOOGLE_TOKEN_URL`, `ZOOM_API_BASE`, `ZOOM_OAUTH_BASE`). Se ignora en producción salvo hacia localhost. Ver [Reuniones](/docs/conferencing#testing).', 'Local testing ONLY: Google API base (also `MEET_API_BASE`, `GOOGLE_TOKEN_URL`, `ZOOM_API_BASE`, `ZOOM_OAUTH_BASE`). Ignored in production except towards localhost. See [Meetings](/docs/conferencing#testing).'),
    v('SLACK_CLIENT_ID', 'frontend', 'oauth', 'optional', undefined, 'OAuth de Slack.', 'Slack OAuth.'),
    v('SLACK_CLIENT_SECRET', 'frontend', 'oauth', 'optional', undefined, 'Secreto OAuth de Slack.', 'Slack OAuth secret.'),
    v('NOTION_CLIENT_ID', 'frontend', 'oauth', 'optional', undefined, 'OAuth de Notion.', 'Notion OAuth.'),
    v('NOTION_CLIENT_SECRET', 'frontend', 'oauth', 'optional', undefined, 'Secreto OAuth de Notion.', 'Notion OAuth secret.'),
    v('HUBSPOT_CLIENT_ID', 'frontend', 'oauth', 'optional', undefined, 'OAuth de HubSpot.', 'HubSpot OAuth.'),
    v('HUBSPOT_CLIENT_SECRET', 'frontend', 'oauth', 'optional', undefined, 'Secreto OAuth de HubSpot.', 'HubSpot OAuth secret.'),
    v('TRELLO_API_KEY', 'frontend', 'oauth', 'optional', undefined, 'Application Key de Trello.', 'Trello Application Key.'),
    v('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'frontend', 'oauth', 'optional', 'se genera y guarda en BD', 'Clave pública VAPID (notificaciones push). Con la pública y la privada se usan; si falta alguna se genera un par y se guarda en la tabla `push_vapid_config`.', 'VAPID public key (push notifications). With both keys they are used; if either is missing a pair is generated and stored in `push_vapid_config`.'),
    v('VAPID_PRIVATE_KEY', 'frontend', 'oauth', 'optional', undefined, 'Clave privada VAPID.', 'VAPID private key.'),
    v('VAPID_SUBJECT', 'frontend', 'oauth', 'optional', 'https://<dominio de la instancia>', 'Sujeto VAPID (`mailto:` o URL https).', 'VAPID subject (`mailto:` or https URL).'),

    // ---------------- Limites / Elixir ----------------
    v('ELIXIR_BATCH_MAX', 'frontend', 'limits', 'optional', '50', 'Filas por petición de envío (tope 100).', 'Rows per send request (cap 100).'),
    v('ELIXIR_BATCH_BUDGET_MS', 'frontend', 'limits', 'optional', '45000', 'Presupuesto de tiempo por lote.', 'Time budget per batch.'),
    v('ELIXIR_SEND_INTERVAL_MS', 'frontend', 'limits', 'optional', '550', 'Pausa entre envíos.', 'Pause between sends.'),
    v('ELIXIR_MAX_ROWS_PER_HOUR', 'frontend', 'limits', 'optional', '5000', 'Cuota de filas por hora (por instancia, en memoria).', 'Rows-per-hour quota (per instance, in memory).'),
    v('MAX_BULK_ROWS', 'frontend', 'limits', 'optional', '5000', 'Alias antiguo de `ELIXIR_MAX_ROWS_PER_HOUR` (es **por hora**, no por petición).', 'Old alias of `ELIXIR_MAX_ROWS_PER_HOUR` (it is **per hour**, not per request).'),
    v('ELIXIR_MAX_CAMPAIGN_ROWS', 'frontend', 'limits', 'optional', '20000', 'Filas máximas por campaña.', 'Maximum rows per campaign.'),

    // ---------------- Marca / dev ----------------
    v('BRAND_NAME', 'frontend', 'brand', 'optional', undefined, 'Nombre de marca en build (se copia a `NEXT_PUBLIC_BRAND_NAME`); también lo usa MFA.', 'Brand name at build time (copied to `NEXT_PUBLIC_BRAND_NAME`); MFA also uses it.'),
    v('BRAND_COLOR', 'frontend', 'brand', 'optional', undefined, 'Color de marca en build (`NEXT_PUBLIC_BRAND_COLOR`).', 'Brand colour at build time (`NEXT_PUBLIC_BRAND_COLOR`).'),
    v('BRAND_LOGO', 'frontend', 'brand', 'optional', undefined, 'Logo en build (`NEXT_PUBLIC_BRAND_LOGO`).', 'Logo at build time (`NEXT_PUBLIC_BRAND_LOGO`).'),
    v('NEXT_PUBLIC_DEFAULT_TIMEZONE', 'frontend', 'brand', 'optional', 'America/Lima', 'Zona horaria de las plantillas de calendario (también `DEFAULT_TIMEZONE`).', 'Time zone for calendar templates (also `DEFAULT_TIMEZONE`).'),
    v('NEXT_PUBLIC_BLOOMX_THEME_OVERRIDE', 'frontend', 'brand', 'optional', undefined, 'Solo desarrollo: JSON de tema que sustituye el de `/api/config`. Ignorado en producción.', 'Development only: theme JSON that replaces the one from `/api/config`. Ignored in production.'),

    // ---------------- Backend ----------------
    v('DATABASE_URL', 'backend', 'backend', 'required', undefined, 'PostgreSQL del backend (Prisma). También lo necesita `sync-extensions.mjs`.', 'Backend PostgreSQL (Prisma). `sync-extensions.mjs` needs it too.'),
    v('ADMIN_EMAIL', 'backend', 'backend', 'optional', undefined, 'Super-admin de plataforma (Basic Auth de `/api/admin/extensions`). Sin ambas variables, siempre falla.', 'Platform super-admin (Basic Auth for `/api/admin/extensions`). Without both variables it always fails.'),
    v('ADMIN_PASSWORD', 'backend', 'backend', 'optional', undefined, 'Contraseña del super-admin de plataforma.', 'Platform super-admin password.'),
    v('ALLOW_OPEN_REGISTRATION', 'backend', 'backend', 'optional', 'abierto', '`false` cierra `/api/auth/register` (despliegue privado).', '`false` closes `/api/auth/register` (private deployment).'),
    v('BACKEND_SIGNING_PRIVATE_KEY', 'backend', 'backend', 'optional', undefined, 'Clave privada Ed25519 **del backend**. Habilita `services.mail` y publica su clave pública en `/.well-known/bloomx-backend-key.json`.', 'The **backend\'s** Ed25519 private key. Enables `services.mail` and publishes its public key at `/.well-known/bloomx-backend-key.json`.'),
    v('BACKEND_CRON_SECRET', 'backend', 'backend', 'optional', undefined, 'Bearer del cron global de hooks `CRON`. Sin definir no existe esa vía.', 'Bearer for the global `CRON` hooks cron. Without it that path does not exist.'),
    v('EXTENSION_GLOBAL_ENV_FALLBACK', 'backend', 'backend', 'optional', undefined, 'Endurecimiento opcional del uso de variables globales por las extensiones: `none` lo desactiva, una lista separada por comas lo limita a esos nombres; sin definir, cualquier `ENV_READ` no reservado de plataforma.', 'Optional hardening of how extensions use global variables: `none` disables it, a comma-separated list limits it to those names; unset means any `ENV_READ` that is not a reserved platform variable.'),
    v('EXTENSION_ALLOW_HTTP', 'backend', 'backend', 'optional', 'false', '`true` permite http en el fetch de extensiones (no recomendado).', '`true` allows http in extension fetch (not recommended).'),
    v('EXT_SANDBOX_MAX_WORKERS', 'backend', 'backend', 'optional', '8', 'Workers simultáneos del sandbox (1–64).', 'Concurrent sandbox workers (1–64).'),
    v('STORAGE_PUBLIC_PREFIXES', 'backend', 'backend', 'optional', 'sin lista blanca', 'Prefijos del bucket servibles por `/api/storage` (coma). Recomendado en producción.', 'Bucket prefixes served by `/api/storage` (comma-separated). Recommended in production.'),
    v('MP_ACCESS_TOKEN', 'backend', 'backend', 'optional', undefined, 'Token de Mercado Pago. Sin él los pagos responden 503.', 'Mercado Pago token. Without it payments answer 503.'),
    v('MP_WEBHOOK_SECRET', 'backend', 'backend', 'optional', undefined, 'Secreto de firma del webhook de Mercado Pago (recomendado).', 'Mercado Pago webhook signing secret (recommended).'),
    v('PAYMENT_REDIRECT_ALLOWED_ORIGINS', 'backend', 'backend', 'optional', undefined, 'Orígenes extra permitidos como `redirectUrl` tras un pago (coma).', 'Extra origins allowed as post-payment `redirectUrl` (comma-separated).'),
    v('OPENAI_API_KEY', 'backend', 'backend', 'optional', undefined, '**HEREDADA/DEPRECADA.** El backend compartido ya no usa clave de IA global: su uso emite un aviso en logs y solo se conserva por compatibilidad con instancias antiguas sin el endpoint del puente. Migra cada instancia a `/admin/ai`: [IA](/docs/ai#migration).', '**LEGACY/DEPRECATED.** The shared backend no longer uses a global AI key: using it logs a warning and is kept only for old instances without the bridge endpoint. Migrate each instance to `/admin/ai`: [AI](/docs/ai#migration).'),
];

export function envNames(): string[] {
    return Array.from(new Set(ENV_VARS.map((e) => e.name)));
}
