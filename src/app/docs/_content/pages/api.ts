import type { Block, DocPageContent } from '../types';

const curlLogin = `# 1) Iniciar sesión y guardar la cookie (use https en producción: la cookie es Secure y __Host-)
curl -sS -c cookies.txt -X POST "$APP/api/auth/login" \\
  -H 'content-type: application/json' \\
  -d '{"email":"ana@mi-empresa.com","password":"<contraseña>"}'
# => {"success":true,"token":"...","user":{"id":"...","email":"...","name":"..."}}
# Con MFA activo/obligatorio: {"mfaRequired":true,"mfaToken":"..."} (sin cookie) -> POST /api/auth/mfa/verify

curl -sS -b cookies.txt -c cookies.txt -X POST "$APP/api/auth/mfa/verify" \\
  -H 'content-type: application/json' -d '{"mfaToken":"<mfaToken>","code":"123456"}'`;

const curlLoginEn = curlLogin
    .replace('# 1) Iniciar sesión y guardar la cookie (use https en producción: la cookie es Secure y __Host-)', '# 1) Sign in and store the cookie (use https in production: the cookie is Secure and __Host-)')
    .replace('"password":"<contraseña>"', '"password":"<password>"')
    .replace('# Con MFA activo/obligatorio: {"mfaRequired":true,"mfaToken":"..."} (sin cookie) -> POST /api/auth/mfa/verify', '# With MFA enabled/required: {"mfaRequired":true,"mfaToken":"..."} (no cookie) -> POST /api/auth/mfa/verify');

const curlMail = `# Listar bandeja (20 por página; q admite operadores: from: to: subject: label: has:attachment is:unread)
curl -sS -b cookies.txt "$APP/api/emails?folder=inbox&page=1&q=from:ana%20is:unread"
# => {"emails":[...],"total":123,"page":1,"pages":7}

# Enviar (Idempotency-Key evita duplicados en reintentos)
curl -sS -b cookies.txt -X POST "$APP/api/emails" \\
  -H 'content-type: application/json' -H 'Idempotency-Key: envio-2026-09-29-0001' \\
  -d '{"to":"luis@ejemplo.com","subject":"Hola","html":"<p>Hola Luis</p>"}'
# => {"success":true,"id":"<id de Resend>"}     duplicado: {"success":true,"id":"...","duplicate":true}

# Marcar como leído / mover
curl -sS -b cookies.txt -X PATCH "$APP/api/emails/<id>" -H 'content-type: application/json' -d '{"read":true,"folder":"archive"}'`;

const curlMailEn = curlMail
    .replace('# Listar bandeja (20 por página; q admite operadores: from: to: subject: label: has:attachment is:unread)', '# List the inbox (20 per page; q accepts operators: from: to: subject: label: has:attachment is:unread)')
    .replace('# Enviar (Idempotency-Key evita duplicados en reintentos)', '# Send (Idempotency-Key prevents duplicates on retries)')
    .replace('"subject":"Hola","html":"<p>Hola Luis</p>"', '"subject":"Hello","html":"<p>Hello Luis</p>"')
    .replace('"id":"<id de Resend>"}     duplicado:', '"id":"<Resend id>"}     duplicate:')
    .replace('# Marcar como leído / mover', '# Mark as read / move');

const curlUpload = `# Subir un adjunto (hasta 200 MB) y usarlo en un envío
curl -sS -b cookies.txt -X POST "$APP/api/upload" -F 'file=@informe.pdf'
# => {"url":"/api/assets/attachments/...?exp=...&sig=...","key":"attachments/ana@mi-empresa.com/...","filename":"informe.pdf","size":123456,"mimeType":"application/pdf"}

curl -sS -b cookies.txt -X POST "$APP/api/emails" -H 'content-type: application/json' \\
  -d '{"to":"luis@ejemplo.com","subject":"Informe","text":"Adjunto","attachments":[{"key":"attachments/ana@mi-empresa.com/..."}]}'`;

const curlUploadEn = curlUpload.replace('# Subir un adjunto (hasta 200 MB) y usarlo en un envío', '# Upload an attachment (up to 200 MB) and use it in a send').replace('"subject":"Informe","text":"Adjunto"', '"subject":"Report","text":"Attached"');

const curlCron = `curl -sS "$APP/api/cron/run"    -H "Authorization: Bearer $CRON_SECRET"   # modo global
curl -sS "$APP/api/cron/elixir" -H "Authorization: Bearer $CRON_SECRET"   # campañas Elixir
curl -sS "$APP/api/admin/retention?dryRun=1" -H "Authorization: Bearer $CRON_SECRET"`;

const curlWebhook = `# Resend firma con Svix (cabeceras svix-id, svix-timestamp, svix-signature). Solo se exige si WEBHOOK_SECRET está definido.
POST /api/webhooks/resend         # email.received y estados de entrega
POST /api/webhooks/resend-events  # rebotes y quejas (RESEND_WEBHOOK_SECRET)
GET  /api/webhooks/unsubscribe?t=<token>   # página de confirmación (no da de baja)
POST /api/webhooks/unsubscribe?t=<token>   # baja de un clic (RFC 8058)`;

const curlMolt = `# API para clientes externos (Bearer): sin cookie, sin CSRF
curl -sS -X POST "$APP/api/molt/auth/connect" -H 'content-type: application/json' \\
  -d '{"email":"ana@mi-empresa.com","password":"<contraseña>"}'
# => {"success":true,"user":{...},"accessToken":"...","refreshToken":"...","expiresAt":...}   (el access token dura 1 h)

curl -sS "$APP/api/molt/messages?limit=10&folder=inbox" -H "Authorization: Bearer $ACCESS"
curl -sS -X POST "$APP/api/molt/messages" -H "Authorization: Bearer $ACCESS" -H 'content-type: application/json' \\
  -d '{"to":"luis@ejemplo.com","subject":"Hola","text":"..."}'   # 60/h por usuario`;

const curlMoltEn = curlMolt.replace('# API para clientes externos (Bearer): sin cookie, sin CSRF', '# API for external clients (Bearer): no cookie, no CSRF').replace('"password":"<contraseña>"', '"password":"<password>"').replace('(el access token dura 1 h)', '(the access token lasts 1 h)').replace('"subject":"Hola"', '"subject":"Hello"').replace('60/h por usuario', '60/h per user');

const head = (es: boolean) => es ? ['Ruta', 'Autenticación', 'Detalle, límites y errores'] : ['Route', 'Authentication', 'Detail, limits and errors'];

function endpoints(es: boolean): Record<string, string[][]> {
    const S = es ? 'Sesión' : 'Session';
    return {
        auth: [
            ['`POST /api/auth/login`', es ? 'Pública' : 'Public', es ? '`{email, password}`. 20/15 min por IP y 10/15 min por cuenta (429 + `Retry-After`). 401 `Invalid credentials`; 503 si MFA es obligatorio y falta la tabla. Devuelve `{success, token, user}` y la cookie; con MFA, `mfaRequired`/`mfaEnrollRequired` + `mfaToken` (5 min) sin cookie' : '`{email, password}`. 20/15 min per IP and 10/15 min per account (429 + `Retry-After`). 401 `Invalid credentials`; 503 if MFA is mandatory and the table is missing. Returns `{success, token, user}` and the cookie; with MFA, `mfaRequired`/`mfaEnrollRequired` + `mfaToken` (5 min) and no cookie'],
            ['`POST /api/register`', es ? 'Pública' : 'Public', es ? '`{email, password, name?, key}`. 5/h por IP. 403 si `key` no coincide con `REGISTRATION_KEY` (o en producción falta/`dev-secret`); 400 política de contraseña o `User already exists`' : '`{email, password, name?, key}`. 5/h per IP. 403 if `key` does not match `REGISTRATION_KEY` (or in production it is missing/`dev-secret`); 400 password policy or `User already exists`'],
            ['`POST /api/auth/mfa/{setup,confirm,verify,disable,recovery-codes}` · `GET …/status`', es ? 'Sesión o `mfaToken`' : 'Session or `mfaToken`', es ? 'Alta de TOTP (devuelve `otpauthUri`), confirmación (10 códigos de recuperación), verificación, baja (`403 MFA is required` si es obligatorio) y regeneración. 6/5 min por usuario y 40/15 min por IP' : 'TOTP enrolment (returns `otpauthUri`), confirmation (10 recovery codes), verification, disable (`403 MFA is required` if mandatory) and regeneration. 6/5 min per user and 40/15 min per IP'],
            ['`POST /api/auth/logout` · `POST /api/auth/refresh` · `POST /api/auth/set-cookie` · `GET /api/auth/me`', S, es ? '`logout` revoca la sesión (`{all:true}` cierra todas). `refresh` renueva (120/min; 503 si falla la infraestructura). `me` siempre 200 (`{user:null}` sin sesión)' : '`logout` revokes the session (`{all:true}` ends all). `refresh` renews (120/min; 503 on infrastructure failure). `me` always 200 (`{user:null}` without a session)'],
            ['`GET /api/auth/google` · `/api/auth/callback/google` · `/api/auth/[provider]`', es ? 'Pública / sesión' : 'Public / session', es ? 'OAuth con `state`. Redirigen a `/login?error=…` o `/settings?error=…` en fallos (`InvalidState`, `NoEmail`, `SignupDisabled`, `MfaRequiredUsePassword`…). Proveedores: `slack`, `hubspot`, `notion`, `zoom`, `trello`' : 'OAuth with `state`. Redirect to `/login?error=…` or `/settings?error=…` on failure (`InvalidState`, `NoEmail`, `SignupDisabled`, `MfaRequiredUsePassword`…). Providers: `slack`, `hubspot`, `notion`, `zoom`, `trello`'],
        ],
        mail: [
            ['`GET /api/emails`', S, es ? 'Query: `folder`, `q`, `label` (coma, máx. 20), `page` (≤ 10000), `since`, `until`, `from`, `hasAttachment=true`, `account`. 20 por página. Devuelve `{emails, total, page, pages}`' : 'Query: `folder`, `q`, `label` (comma, max 20), `page` (≤ 10000), `since`, `until`, `from`, `hasAttachment=true`, `account`. 20 per page. Returns `{emails, total, page, pages}`'],
            ['`POST /api/emails`', S, es ? '`{to, cc?, bcc?, subject, html?, text?, from?, replyTo?, attachments?, scheduledAt?}`. ≤100 destinatarios, asunto ≤998, ≤25 adjuntos, inline ≤35 MB (413), remitente propio o vinculado (401), `MAX_SENDS_PER_HOUR` (429 sin `Retry-After`), hook bloquea (**422** `EXTENSION_BLOCKED`), `Idempotency-Key` (425 si hay otra en curso, `Retry-After: 2`)' : '`{to, cc?, bcc?, subject, html?, text?, from?, replyTo?, attachments?, scheduledAt?}`. ≤100 recipients, subject ≤998, ≤25 attachments, inline ≤35 MB (413), own or linked sender (401), `MAX_SENDS_PER_HOUR` (429 without `Retry-After`), a hook may block (**422** `EXTENSION_BLOCKED`), `Idempotency-Key` (425 if another is in flight, `Retry-After: 2`)'],
            ['`GET/PATCH /api/emails/[id]` · `DELETE /api/emails/[id]/delete`', S, es ? '`GET ?thread=true`; `PATCH {starred?, read?, folder?, labelIds?, toggleLabelId?}` (400 `Invalid folder`). 404 si no es tuyo (no revela existencia). `delete` es borrado completo (`{success, storage}`)' : '`GET ?thread=true`; `PATCH {starred?, read?, folder?, labelIds?, toggleLabelId?}` (400 `Invalid folder`). 404 if not yours (existence not revealed). `delete` is a complete deletion (`{success, storage}`)'],
            ['`PATCH/DELETE /api/emails/batch`', S, es ? '`{ids[], updates:{read,starred,folder}}` → `{count}`; `DELETE {ids[]}` (borrado completo). 400 `Invalid IDs`' : '`{ids[], updates:{read,starred,folder}}` → `{count}`; `DELETE {ids[]}` (complete deletion). 400 `Invalid IDs`'],
            ['`POST /api/emails/[id]/{snooze,rsvp,cancel}`', S, es ? '`snooze {snoozeUntil}` y `cancel` (programados) **sin interfaz**; `rsvp {response: accepted|tentative|declined}`' : '`snooze {snoozeUntil}` and `cancel` (scheduled) **without UI**; `rsvp {response: accepted|tentative|declined}`'],
            ['`GET/POST /api/drafts` · `DELETE /api/drafts/[id]` · `POST /api/drafts/batch`', S, es ? 'Máx. 50 borradores en la lista; lote ≤500 ids. Propiedad por remitente autorizado' : 'Max 50 drafts in the list; batch ≤500 ids. Ownership by authorised sender'],
            ['`POST /api/upload`', S, es ? 'Multipart `file`. ≤200 MB, 120/10 min. 400 `File type not allowed`/`File content not allowed`, 422 antivirus, 503 si no se pudo escanear con `AV_FAIL_MODE=closed`' : 'Multipart `file`. ≤200 MB, 120/10 min. 400 `File type not allowed`/`File content not allowed`, 422 antivirus, 503 if it could not be scanned with `AV_FAIL_MODE=closed`'],
            ['`GET /api/assets/<clave>?exp&sig&filename`', es ? 'Firma HMAC o propietario' : 'HMAC signature or owner', es ? 'Descarga con `Range`. 404 para todo rechazo (nunca 403). `sig = HMAC-SHA256(secreto, "asset:v1\\n"+clave+"\\n"+exp)`. Ver [Seguridad](/docs/security#assets)' : 'Download with `Range`. 404 for every rejection (never 403). `sig = HMAC-SHA256(secret, "asset:v1\\n"+key+"\\n"+exp)`. See [Security](/docs/security#assets)'],
            ['`GET /api/counts` · `GET /api/sse`', S, es ? 'Contadores por carpeta y etiqueta. SSE: máx. 3 conexiones por usuario (429 `Retry-After: 30`), vida 50 s, `Last-Event-ID` para reanudar' : 'Counters per folder and label. SSE: max 3 connections per user (429 `Retry-After: 30`), 50 s lifetime, `Last-Event-ID` to resume'],
        ],
        org: [
            ['`GET/POST /api/labels` · `PATCH/DELETE /api/labels/[id]`', S, es ? '`{name ≤50, color?, aliasSuffix?, filterRegex?}`. ≤500 etiquetas; 409 `Alias already in use` / nombre repetido; 404 `Label not found`' : '`{name ≤50, color?, aliasSuffix?, filterRegex?}`. ≤500 labels; 409 `Alias already in use` / duplicate name; 404 `Label not found`'],
            ['`GET/POST /api/rules` · `PATCH/DELETE /api/rules/[id]` · `POST /api/rules/apply`', S, es ? '≤100 reglas; 400 `Etiqueta no encontrada`; 503 si las tablas no están migradas. `apply` → `{processed, changed}` (últimos 500 de inbox y archive)' : '≤100 rules; 400 `Etiqueta no encontrada`; 503 if the tables are not migrated. `apply` → `{processed, changed}` (last 500 of inbox and archive)'],
            ['`GET/POST /api/contacts` · `GET/PUT/DELETE /api/contacts/[id]` · `GET /api/contacts/suggestions`', S, es ? '`limit` ≤1000, `q` ≤100, cabeceras `X-Total-Count`/`X-Has-More`. POST duplicado: **409** `CONTACT_EXISTS`' : '`limit` ≤1000, `q` ≤100, `X-Total-Count`/`X-Has-More` headers. Duplicate POST: **409** `CONTACT_EXISTS`'],
            ['`GET/POST /api/organizer/proposals` · `POST /api/organizer/proposals/[emailId]`', S, es ? '`{action: accept|dismiss}`; 120/min y 300/min; 404 `not_found`; 422 con la razón' : '`{action: accept|dismiss}`; 120/min and 300/min; 404 `not_found`; 422 with the reason'],
            ['`GET/PUT /api/settings` · `PUT /api/profile`', S, es ? '`profile`: cambiar contraseña exige `currentPassword` (400 `Incorrect current password`), revoca todas las sesiones y devuelve un `token` nuevo' : '`profile`: changing the password requires `currentPassword` (400 `Incorrect current password`), revokes all sessions and returns a new `token`'],
            ['`GET/POST/DELETE /api/notifications/subscriptions`', es ? '`GET` público, resto sesión' : '`GET` public, rest session', es ? '`GET` devuelve la clave VAPID pública (503 `{enabled:false}` si no hay)' : '`GET` returns the public VAPID key (503 `{enabled:false}` if none)'],
        ],
        cal: [
            ['`GET/POST /api/calendars` · `GET/POST /api/calendar/events` · `PUT/DELETE /api/calendar/events/[id]`', S, es ? '`start`/`end`/`calendarId`. 404 `Calendar not found`; 400 `This calendar is read-only`. Con asistentes envía invitación `.ics`; `DELETE` envía cancelación' : '`start`/`end`/`calendarId`. 404 `Calendar not found`; 400 `This calendar is read-only`. With attendees it sends an `.ics` invitation; `DELETE` sends a cancellation'],
            ['`GET /api/calendar/domain-availability` · `POST /api/google/sync`', S, es ? 'Disponibilidad solo del mismo dominio; sync unidireccional (409 `SYNC_IN_PROGRESS`)' : 'Availability of the same domain only; one-way sync (409 `SYNC_IN_PROGRESS`)'],
            ['`GET /api/calendar/conferencing/providers` · `POST|DELETE /api/calendar/conferencing/[provider]` · `POST …/[provider]/test` (admin) · `POST …/meet` (alias)', S, es ? 'Reuniones Zoom / Google Meet / enlace propio: estado por proveedor, crear (cabecera `Idempotency-Key`, 20/min), borrar (solo las propias) y probar conexión. Errores tipados `{ error: { code, message, retryAfter? } }`. Ver [Reuniones](/docs/conferencing)' : 'Zoom / Google Meet / own-link meetings: per-provider status, create (`Idempotency-Key` header, 20/min), delete (own meetings only) and connection test. Typed errors `{ error: { code, message, retryAfter? } }`. See [Meetings](/docs/conferencing)'],
            ['`GET/POST /api/appointments/schedules` · `GET/PUT/DELETE …/[id]` · `GET /api/appointments/bookings`', S, es ? 'CRUD de agendas del anfitrión. Estas rutas están exentas del control CSRF por `Origin`' : 'Host schedule CRUD. These routes are exempt from the `Origin` CSRF check'],
            ['`GET …/schedules/[id]/public` · `GET …/[id]/slots?date=` · `POST /api/appointments/book/[id]`', es ? 'Pública' : 'Public', es ? '`slots`: 120/min por IP, 7 días, horizonte 365 (400 fecha inválida). `book {guestName, guestEmail, startsAt, guestNotes?}`: 10/h por IP y 3/h por correo; **409** `This slot is no longer available`' : '`slots`: 120/min per IP, 7 days, 365-day horizon (400 invalid date). `book {guestName, guestEmail, startsAt, guestNotes?}`: 10/h per IP and 3/h per email; **409** `This slot is no longer available`'],
            ['`GET/POST /api/appointments/book/[id]/cancel?token=`', es ? 'Token firmado' : 'Signed token', es ? '410 enlace caducado; 404 inválido; 60/h (GET) y 20/h (POST) por IP' : '410 expired link; 404 invalid; 60/h (GET) and 20/h (POST) per IP'],
        ],
        elixir: [
            ['`POST /api/elixir/send`', S, es ? 'Lotes ≤ `ELIXIR_BATCH_MAX`. 422 `template_error`, 503 `suppression_unavailable`, 429. Ver [Elixir](/docs/elixir#direct)' : 'Batches ≤ `ELIXIR_BATCH_MAX`. 422 `template_error`, 503 `suppression_unavailable`, 429. See [Elixir](/docs/elixir#direct)'],
            ['`GET/POST /api/elixir/campaigns` · `GET/PATCH/DELETE …/[id]` · `POST …/[id]/rows` · `POST …/[id]/tick`', S, es ? '409 `invalid_transition`/`nothing_to_retry`/`running`; 422 `no_recipients`; 413 `limit_reached`; `tick` 1 cada 10 s (429 `rate_limited`)' : '409 `invalid_transition`/`nothing_to_retry`/`running`; 422 `no_recipients`; 413 `limit_reached`; `tick` 1 per 10 s (429 `rate_limited`)'],
            ['`GET/POST /api/elixir/templates` · `GET/PUT/DELETE …/[id]`', S, es ? '≤200 plantillas; 409 nombre repetido' : '≤200 templates; 409 duplicate name'],
        ],
        secure: [
            ['`POST /api/secure-message`', S, es ? 'Cuerpo ≤ 1 100 000 (413); `{v:1, envelope, maxViews?, ttlDays?}`; 403 si `SECURE_MESSAGE_ENABLED=false`; 30/h' : 'Body ≤ 1,100,000 (413); `{v:1, envelope, maxViews?, ttlDays?}`; 403 if `SECURE_MESSAGE_ENABLED=false`; 30/h'],
            ['`GET/POST /api/secure-message/[id]`', es ? 'Pública' : 'Public', es ? '`GET` metadatos (no cuenta vista); `POST` con `X-Sealed-Reveal: 1` consume una vista. 404 igual para inexistente/caducado/agotado' : '`GET` metadata (no view counted); `POST` with `X-Sealed-Reveal: 1` consumes a view. 404 identical for nonexistent/expired/exhausted'],
        ],
        system: [
            ['`GET /api/config`', es ? 'Pública' : 'Public', es ? 'Proxy al backend (`/api/config?domain=`): `{config, extensions}` con marca, tema (con `landing`) y extensiones del dominio. Si el backend falla devuelve su mismo estado (`{error:"Backend error"}`) o 500' : 'Proxy to the backend (`/api/config?domain=`): `{config, extensions}` with the domain\'s brand, theme (with `landing`) and extensions. If the backend fails it returns its status (`{error:"Backend error"}`) or 500'],
            ['`GET/POST /api/expansions`', S, es ? 'Proxy **firmado** al backend (`/api/extensions`, `/api/extension/execute`). El navegador no puede inyectar `context.auth`' : '**Signed** proxy to the backend (`/api/extensions`, `/api/extension/execute`). The browser cannot inject `context.auth`'],
            ['`POST /api/internal/mail`', es ? 'Firma Ed25519 del backend' : 'Backend Ed25519 signature', es ? 'Puente `services.mail`: `op` = `listRecent|getEmail|applyBatch|undoRun`. Cuerpo ≤256 KiB; 503 `Backend key unavailable`; 401 firma inválida; 300/min. No es para uso manual' : '`services.mail` bridge: `op` = `listRecent|getEmail|applyBatch|undoRun`. Body ≤256 KiB; 503 `Backend key unavailable`; 401 invalid signature; 300/min. Not for manual use'],
            ['`GET|POST /api/cron/run` · `GET|POST /api/cron/elixir`', es ? '`Bearer CRON_SECRET`' : '`Bearer CRON_SECRET`', es ? '`run`: global con Bearer; `POST` con sesión para el usuario; 401 si el Bearer es inválido. `elixir`: Bearer o clave interna; `?campaign=<id>` (400 `campaign inválido`). Ver [Despliegue](/docs/deployment#cron)' : '`run`: global with Bearer; `POST` with session for the user; 401 for an invalid Bearer. `elixir`: Bearer or internal key; `?campaign=<id>` (400 `campaign inválido`). See [Deployment](/docs/deployment#cron)'],
            ['`POST /api/webhooks/resend` · `…/resend-events` · `GET|POST …/unsubscribe`', es ? 'Firma Svix (opcional) / token' : 'Svix signature (optional) / token', es ? 'Ver [Correo: Resend y DNS](/docs/email-setup#webhooks). Firma inválida: 400 `Invalid signature`; `resend-events` >512 000 caracteres: 413; 500 para que Resend reintente' : 'See [Email: Resend and DNS](/docs/email-setup#webhooks). Invalid signature: 400 `Invalid signature`; `resend-events` >512,000 characters: 413; 500 so Resend retries'],
        ],
        admin: [
            ['`GET/POST /api/admin/users`', 'requireAdmin', es ? 'Listar y crear usuarios (`{email, name, password}`; 409 `User already exists`)' : 'List and create users (`{email, name, password}`; 409 `User already exists`)'],
            ['`GET/PUT /api/admin/domain` · `/api/admin/extensions/{install,uninstall,settings}` · `POST /api/admin/login`', 'requireAdmin / manager', es ? 'Proxies al backend con la cookie del manager (`login` es público, 10/15 min)' : 'Proxies to the backend with the manager cookie (`login` is public, 10/15 min)'],
            ['`GET|POST /api/admin/retention`', es ? '`Bearer CRON_SECRET` o admin' : '`Bearer CRON_SECRET` or admin', es ? '`?dryRun=1`; `{ok, config, report}`; 500 `Retention run failed`' : '`?dryRun=1`; `{ok, config, report}`; 500 `Retention run failed`'],
            ['`POST /api/admin/reprocess-attachments`', S, es ? 'Un usuario normal solo reprocesa sus correos; un admin con MFA, cualquiera (`{dryRun?, emailIds?, since?, limit≤500, force?}`)' : 'A normal user only reprocesses their own mail; an admin with MFA, any (`{dryRun?, emailIds?, since?, limit≤500, force?}`)'],
        ],
        molt: [
            ['`POST /api/molt/auth/connect` · `POST /api/molt/auth/refresh`', es ? 'Pública' : 'Public', es ? '10/15 min por IP. 403 `Invalid connect secret` si `MOLT_CONNECT_SECRET`; 401 `MFA code required` (`mfaRequired:true`); `refresh` rota tokens (401 si inválido)' : '10/15 min per IP. 403 `Invalid connect secret` if `MOLT_CONNECT_SECRET`; 401 `MFA code required` (`mfaRequired:true`); `refresh` rotates tokens (401 if invalid)'],
            ['`GET/POST /api/molt/messages`', 'Bearer', es ? '`GET ?limit&folder` (sin tope de `limit`); `POST {to, subject, text|html, cc, bcc, reply_to, scheduled_at}` ≤100 destinatarios, 60/h' : '`GET ?limit&folder` (no cap on `limit`); `POST {to, subject, text|html, cc, bcc, reply_to, scheduled_at}` ≤100 recipients, 60/h'],
        ],
    };
}

function sections(es: boolean): Block[] {
    const e = endpoints(es);
    const T = (id: string, title: string, key: string, caption: string): Block[] => [
        { t: 'h3', id, text: title },
        { t: 'table', head: head(es), rows: e[key], caption },
    ];
    return [
        ...T('e-auth', es ? 'Autenticación y cuenta' : 'Authentication and account', 'auth', es ? 'Autenticación' : 'Authentication'),
        ...T('e-mail', es ? 'Correo' : 'Mail', 'mail', es ? 'Correo' : 'Mail'),
        ...T('e-org', es ? 'Etiquetas, reglas, contactos y ajustes' : 'Labels, rules, contacts and settings', 'org', es ? 'Organización' : 'Organisation'),
        ...T('e-cal', es ? 'Calendario y citas' : 'Calendar and appointments', 'cal', es ? 'Calendario' : 'Calendar'),
        ...T('e-elixir', 'Elixir', 'elixir', 'Elixir'),
        ...T('e-secure', es ? 'Mensajes sellados' : 'Sealed messages', 'secure', es ? 'Sellados' : 'Sealed'),
        ...T('e-system', es ? 'Sistema, cron y webhooks' : 'System, cron and webhooks', 'system', es ? 'Sistema' : 'System'),
        ...T('e-admin', es ? 'Administración' : 'Administration', 'admin', es ? 'Administración' : 'Administration'),
        ...T('e-molt', es ? 'API para clientes externos (molt)' : 'External-client API (molt)', 'molt', 'molt'),
    ];
}

const es: Block[] = [
    { t: 'p', text: 'API HTTP de **cada frontend** (rutas `/api/*`). Para el backend compartido (registro de dominios, extensiones, firma) ve a [API del backend y firma](/docs/api-backend). Cuerpos y respuestas son JSON salvo indicación; los errores son `{"error": "..."}`.' },
    { t: 'h2', id: 'conventions', text: 'Convenciones' },
    { t: 'ul', items: [
        '**Autenticación**: cookie de sesión (`__Host-next-auth.session-token` en producción). Usa un *cookie jar* (`curl -c/-b`) sobre https. Una ruta protegida **sin cookie válida responde un `307` a `/login?callbackUrl=…`**, no `401`. Los `401` JSON aparecen cuando el JWT es válido pero la sesión fue revocada o el usuario ya no existe.',
        '**`Authorization: Bearer <jwt>`** solo omite el control CSRF y lo aceptan las rutas que leen la sesión, pero el middleware exige la cookie en las rutas protegidas. Para clientes programáticos usa la API `molt` (Bearer propio) ([abajo](#e-molt)).',
        '**CSRF**: en métodos que cambian estado, si el navegador envía `Origin`, su host debe coincidir con `Host` (403 `Forbidden`). Exentas: webhooks, cron, molt, `/api/config`, `/api/register`, reservas públicas, `/api/appointments/schedules/*` y parte de `/api/auth`.',
        '**Rate limit**: 429 con `Retry-After` en la mayoría de rutas (ver [Seguridad](/docs/security#rate-limit)). `POST /api/emails` usa un tope por hora en BD, sin `Retry-After`.',
        '**Propiedad**: los recursos ajenos responden 404 (no se revela su existencia).',
        '**Públicas** (sin sesión): `/login`, `/register`, `/api/register`, `/api/auth/*`, `/api/cron*`, `/api/config*`, `/api/webhooks*`, `/api/molt*`, `/api/assets*`, `/api/internal/*`, `/api/secure-message*`, `/secure/*`, `/api/admin*` (auth en cada ruta), `/docs`, `/book` y las rutas públicas de citas.',
    ] },
    { t: 'h2', id: 'examples', text: 'Ejemplos con curl' },
    { t: 'code', lang: 'bash', title: 'Sesión y MFA', code: curlLogin },
    { t: 'code', lang: 'bash', title: 'Leer y enviar correo', code: curlMail },
    { t: 'code', lang: 'bash', title: 'Adjuntos', code: curlUpload },
    { t: 'code', lang: 'bash', title: 'Crons (con CRON_SECRET)', code: curlCron },
    { t: 'code', lang: 'text', title: 'Webhooks', code: curlWebhook },
    { t: 'code', lang: 'bash', title: 'API para clientes externos (molt)', code: curlMolt },
    { t: 'h2', id: 'endpoints', text: 'Referencia de endpoints' },
    ...sections(true),
    { t: 'h2', id: 'errors', text: 'Códigos de error' },
    { t: 'table', head: ['Código', 'Cuándo'], rows: [
        ['307', 'Ruta protegida sin cookie de sesión válida (redirige a `/login`)'],
        ['400', 'Cuerpo o parámetros inválidos; firma de webhook inválida'],
        ['401', 'JWT revocado o usuario inexistente; credenciales inválidas; `MFA code required`'],
        ['403', 'Origen cruzado (CSRF), sin permiso (no admin / MFA requerido), clave de registro inválida, módulo desactivado'],
        ['404', 'No existe o no es tuyo; rechazo de asset'],
        ['409', 'Conflicto: contacto o etiqueta repetidos, transición inválida, sincronización en curso, hueco de cita ocupado'],
        ['413', 'Cuerpo o adjuntos demasiado grandes; límite de filas'],
        ['422', 'Envío bloqueado por una extensión (`EXTENSION_BLOCKED`), plantilla Liquid inválida, adjunto con virus'],
        ['425', '`IDEMPOTENCY_IN_PROGRESS`: hay un envío idéntico en curso (reintenta tras `Retry-After`)'],
        ['429', 'Rate limit o tope de envíos'],
        ['503', 'Tabla o servicio no disponible (MFA sin `UserMfa`, supresión no disponible, AV cerrado, reglas sin migrar)'],
    ] },
    { t: 'callout', kind: 'note', title: 'Algunas rutas exponen `error.message`', text: 'Varias rutas devuelven en 500 el mensaje interno (`emails/[id]/rsvp`, `calendar/events/[id]/attach-invite`, `molt/messages`, `molt/auth/refresh`). No dependas de ese texto.' },
];

const en: Block[] = [
    { t: 'p', text: 'HTTP API of **each frontend** (`/api/*` routes). For the shared backend (domain registration, extensions, signing) see [Backend API and signing](/docs/api-backend). Bodies and responses are JSON unless noted; errors are `{"error": "..."}`.' },
    { t: 'h2', id: 'conventions', text: 'Conventions' },
    { t: 'ul', items: [
        '**Authentication**: session cookie (`__Host-next-auth.session-token` in production). Use a *cookie jar* (`curl -c/-b`) over https. A protected route **without a valid cookie answers a `307` to `/login?callbackUrl=…`**, not `401`. JSON `401`s appear when the JWT is valid but the session was revoked or the user no longer exists.',
        '**`Authorization: Bearer <jwt>`** only skips the CSRF check and is accepted by routes that read the session, but the middleware requires the cookie on protected routes. For programmatic clients use the `molt` API (its own Bearer) ([below](#e-molt)).',
        '**CSRF**: on state-changing methods, if the browser sends `Origin`, its host must match `Host` (403 `Forbidden`). Exempt: webhooks, cron, molt, `/api/config`, `/api/register`, public bookings, `/api/appointments/schedules/*` and part of `/api/auth`.',
        '**Rate limit**: 429 with `Retry-After` on most routes (see [Security](/docs/security#rate-limit)). `POST /api/emails` uses an hourly DB cap, without `Retry-After`.',
        '**Ownership**: other users\' resources answer 404 (existence is not revealed).',
        '**Public** (no session): `/login`, `/register`, `/api/register`, `/api/auth/*`, `/api/cron*`, `/api/config*`, `/api/webhooks*`, `/api/molt*`, `/api/assets*`, `/api/internal/*`, `/api/secure-message*`, `/secure/*`, `/api/admin*` (auth in each route), `/docs`, `/book` and public appointment routes.',
    ] },
    { t: 'h2', id: 'examples', text: 'curl examples' },
    { t: 'code', lang: 'bash', title: 'Session and MFA', code: curlLoginEn },
    { t: 'code', lang: 'bash', title: 'Reading and sending mail', code: curlMailEn },
    { t: 'code', lang: 'bash', title: 'Attachments', code: curlUploadEn },
    { t: 'code', lang: 'bash', title: 'Crons (with CRON_SECRET)', code: curlCron },
    { t: 'code', lang: 'text', title: 'Webhooks', code: curlWebhook.replace('# Resend firma con Svix (cabeceras svix-id, svix-timestamp, svix-signature). Solo se exige si WEBHOOK_SECRET está definido.', '# Resend signs with Svix (svix-id, svix-timestamp, svix-signature headers). Only required if WEBHOOK_SECRET is set.').replace('# email.received y estados de entrega', '# email.received and delivery states').replace('# rebotes y quejas', '# bounces and complaints').replace('# página de confirmación (no da de baja)', '# confirmation page (does not unsubscribe)').replace('# baja de un clic (RFC 8058)', '# one-click unsubscribe (RFC 8058)') },
    { t: 'code', lang: 'bash', title: 'External-client API (molt)', code: curlMoltEn },
    { t: 'h2', id: 'endpoints', text: 'Endpoint reference' },
    ...sections(false),
    { t: 'h2', id: 'errors', text: 'Error codes' },
    { t: 'table', head: ['Code', 'When'], rows: [
        ['307', 'Protected route without a valid session cookie (redirects to `/login`)'],
        ['400', 'Invalid body or parameters; invalid webhook signature'],
        ['401', 'Revoked JWT or unknown user; invalid credentials; `MFA code required`'],
        ['403', 'Cross-origin (CSRF), no permission (not admin / MFA required), invalid sign-up key, module disabled'],
        ['404', 'Does not exist or is not yours; asset rejection'],
        ['409', 'Conflict: duplicate contact or label, invalid transition, sync in progress, appointment slot taken'],
        ['413', 'Body or attachments too large; row limit'],
        ['422', 'Send blocked by an extension (`EXTENSION_BLOCKED`), invalid Liquid template, infected attachment'],
        ['425', '`IDEMPOTENCY_IN_PROGRESS`: an identical send is in flight (retry after `Retry-After`)'],
        ['429', 'Rate limit or send cap'],
        ['503', 'Table or service unavailable (MFA without `UserMfa`, suppression unavailable, closed AV, rules not migrated)'],
    ] },
    { t: 'callout', kind: 'note', title: 'Some routes expose `error.message`', text: 'Several routes return the internal message on 500 (`emails/[id]/rsvp`, `calendar/events/[id]/attach-invite`, `molt/messages`, `molt/auth/refresh`). Do not depend on that text.' },
];

const page: DocPageContent = { es, en };
export default page;
