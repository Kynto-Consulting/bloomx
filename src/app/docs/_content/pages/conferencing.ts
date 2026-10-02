import type { DocPageContent } from '../types';

const flow = `UI (selector de reuniones, evento, composer, citas)
   |  POST /api/calendar/conferencing/{google-meet|zoom|custom}   sesion + limite + Idempotency-Key + zod
   v
Host (frontend): registro ConferenceMeeting (idempotencia y propiedad) --> puente firmado
   v
Backend compartido  POST /api/extension/execute   (modo firmado = con credenciales del dominio)
   v
Extension core-zoom | core-google-meet   --safe-fetch https-->  api.zoom.us | googleapis.com
   ^
Panel de administracion (manager dueno del dominio) --> credenciales cifradas del dominio (ENV_READ)`;

const flowEn = `UI (meeting picker, event, composer, appointments)
   |  POST /api/calendar/conferencing/{google-meet|zoom|custom}   session + rate limit + Idempotency-Key + zod
   v
Host (frontend): ConferenceMeeting registry (idempotency and ownership) --> signed bridge
   v
Shared backend  POST /api/extension/execute   (signed mode = with the domain credentials)
   v
Extension core-zoom | core-google-meet   --safe-fetch https-->  api.zoom.us | googleapis.com
   ^
Admin panel (manager who owns the domain) --> encrypted domain credentials (ENV_READ)`;

const settings = `// Zoom Server-to-Server (Ajustes -> Integraciones -> Zoom, o "Credenciales" de la extension)
ZOOM_AUTH_MODE=server-to-server
ZOOM_ACCOUNT_ID=<id-de-cuenta>
ZOOM_CLIENT_ID=<client-id>
ZOOM_CLIENT_SECRET=<client-secret>

// Google: cuenta de servicio con delegacion de todo el dominio (Workspace)
GOOGLE_AUTH_MODE=service-account
GOOGLE_SERVICE_ACCOUNT_JSON=<JSON completo, una linea>
GOOGLE_IMPERSONATE_USER=organizador@tu-dominio.com

// Google: cuenta organizadora (boton "Conectar cuenta de Google")
GOOGLE_AUTH_MODE=google-account
GOOGLE_ORGANIZER_REFRESH_TOKEN=<lo guarda el callback, nunca lo veras>`;

const settingsEn = settings
    .replace('// Zoom Server-to-Server (Ajustes -> Integraciones -> Zoom, o "Credenciales" de la extension)', '// Zoom Server-to-Server (Settings -> Integrations -> Zoom, or the extension "Credentials" dialog)')
    .replace('<id-de-cuenta>', '<account-id>')
    .replace('// Google: cuenta de servicio con delegacion de todo el dominio (Workspace)', '// Google: service account with domain-wide delegation (Workspace)')
    .replace('<JSON completo, una linea>', '<full JSON, one line>')
    .replace('organizador@tu-dominio.com', 'organizer@your-domain.com')
    .replace('// Google: cuenta organizadora (boton "Conectar cuenta de Google")', '// Google: organizer account ("Connect Google account" button)')
    .replace('<lo guarda el callback, nunca lo veras>', '<saved by the callback, you will never see it>');

const page: DocPageContent = {
    es: [
        { t: 'p', text: 'Crear una reunión de **Zoom** o **Google Meet** (o pegar un enlace propio) funciona igual desde el **calendario**, el **composer** (`/zoom`, `/meet`), las **citas** y el lector de correo. La lógica de cada proveedor vive en su **extensión** (`core-zoom`, `core-google-meet`; `core-calendar` orquesta eventos e invitaciones); el frontend aporta la capacidad de núcleo `conferencing`: registro de proveedores, API única, selector compartido, idempotencia y validación de enlaces.' },
        { t: 'code', lang: 'text', title: 'Flujo', code: flow },
        { t: 'h2', id: 'modes', text: 'Modos de autenticación' },
        { t: 'table', head: ['Proveedor', 'Modo', 'Qué usa', 'Quién lo configura'], rows: [
            ['Zoom', '`server-to-server`', '`ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` de una app Server-to-Server', 'Administrador (panel)'],
            ['Zoom', '`user-oauth`', 'La cuenta Zoom del propio usuario (Ajustes → Integraciones → Conectar)', 'Cada usuario; requiere `ZOOM_CLIENT_ID/SECRET` (app OAuth) en el frontend'],
            ['Zoom 2.x (ZoomLib)', '`user-oauth` y `server-to-server`', 'Las credenciales viven cifradas en la instancia, en los ajustes de `core-zoomlib`: app OAuth de usuario (`ZOOM_CLIENT_ID/SECRET`) y app S2S propia (`ZOOM_ACCOUNT_ID`, `ZOOM_S2S_CLIENT_ID/SECRET`, `ZOOM_HOST_EMAIL`). La extensión no ve tokens ni usa `ENV_READ`. Exige clave de dominio; sin ella se sirve `core-zoom` 1.4.1', 'Administrador (ajustes de ZoomLib) y cada usuario (Ajustes → Integraciones → Conectar)'],
            ['Microsoft Teams', '`microsoft-account`', 'La cuenta Microsoft de trabajo o escuela del propio usuario, vinculada con MicrosoftLib (`core-microsoftlib`, ajustes `MICROSOFT_CLIENT_ID/SECRET/TENANT`); las reuniones se crean con Graph (`onlineMeetings` o evento con Teams). Exige clave de dominio', 'Administrador (ajustes de MicrosoftLib) y cada usuario'],
            ['Google', '`service-account`', 'JSON de cuenta de servicio (máx. 16 KB) + `GOOGLE_IMPERSONATE_USER` (delegación en Workspace)', 'Administrador (panel)'],
            ['Google', '`google-account`', 'Cuenta organizadora de la instancia (OAuth, scopes mínimos `calendar.events openid email`) o la cuenta Google vinculada de cada usuario', 'Administrador o usuario'],
            ['Enlace propio', '`custom-link`', 'Enlace https pegado por el usuario; sin credenciales', 'Nadie'],
        ] },
        { t: 'p', text: 'Sin `*_AUTH_MODE` explícito el modo es automático: Zoom usa Server-to-Server si hay credenciales y, si no, la cuenta del usuario; Google usa la cuenta de servicio si hay JSON, luego la cuenta organizadora y, por último, la cuenta vinculada del usuario. La fuente activa (instancia / cuenta del usuario / ninguna) aparece en Ajustes → Integraciones.' },
        { t: 'callout', kind: 'note', title: 'Compatibilidad', text: 'Lo que ya funcionaba sigue funcionando: `GOOGLE_MEET_ADMIN_REFRESH_TOKEN` equivale a la cuenta organizadora, `ZOOM_ACCOUNT_ID/CLIENT_ID/CLIENT_SECRET` siguen siendo los nombres de las credenciales S2S, la ruta antigua `POST /api/calendar/conferencing/meet` es un alias de la nueva y, si la extensión no está instalada o el backend no responde, un adaptador fino del frontend usa la cuenta vinculada del propio usuario.' },
        { t: 'h2', id: 'operator', text: 'Qué debe configurar el operador' },
        { t: 'ol', items: [
            '**Instalar** `core-zoom` y/o `core-google-meet` (y `core-calendar`) desde Extensiones y pulsar **Credenciales**, o usar Ajustes → Integraciones (solo el manager dueño del dominio puede escribirlas).',
            'Elegir el **modo** y completar los valores (siempre enmascarados; el servidor nunca los devuelve). Pulsar **Probar conexión**: llama al proveedor y muestra OK o el motivo legible.',
            'Para modo por usuario: definir en el frontend `GOOGLE_CLIENT_ID/SECRET` (scopes Calendar + Meet en `/api/auth/google`) y/o `ZOOM_CLIENT_ID/SECRET` con `{NEXT_PUBLIC_APP_URL}/api/auth/callback/zoom` como redirect.',
            'Para la cuenta organizadora: registrar `{NEXT_PUBLIC_APP_URL}/api/auth/callback/google-organizer` como redirect autorizado en Google Cloud y pulsar **Conectar cuenta de Google**.',
            '**Dominio firmado**: las credenciales del dominio solo llegan a las extensiones si la instancia firma sus peticiones (`BLOOMX_DOMAIN_PRIVATE_KEY`, ver [Arquitectura](/docs/architecture)). En un dominio legado solo funciona el modo por usuario.',
        ] },
        { t: 'code', lang: 'text', title: 'Claves de credencial (ENV_READ)', code: settings },
        { t: 'h2', id: 'api', text: 'API' },
        { t: 'table', head: ['Ruta', 'Uso'], rows: [
            ['`GET /api/calendar/conferencing/providers`', 'Estado por proveedor para el usuario: `configured`, `connected`, `mode`, `source`, `reason`, `connect`'],
            ['`POST /api/calendar/conferencing/[provider]`', 'Crear: cuerpo `{ topic, startsAt, endsAt, timeZone, attendees, customUrl, attachToEventId }`, cabecera `Idempotency-Key`. Devuelve `{ meeting: { provider, joinUrl, hostUrl, meetingId, passcode, dialIn, attachment? } }`'],
            ['`DELETE /api/calendar/conferencing/[provider]?meetingId=`', 'Borrar; solo reuniones creadas por el mismo usuario'],
            ['`POST /api/calendar/conferencing/[provider]/test`', 'Probar conexión (solo admin)'],
            ['`POST /api/calendar/conferencing/meet`', 'Alias compatible de `google-meet` (`{ title, startsAt, endsAt }` → `{ meetUrl }`)'],
            ['`GET /api/admin/conferencing`', 'Panel: instalaciones y claves configuradas (solo admin)'],
        ] },
        { t: 'table', head: ['Código', 'HTTP', 'Significado y acción'], rows: [
            ['`not_connected`', '409', 'Falta conectar: botón Conectar (OAuth o Ajustes)'],
            ['`token_revoked`', '401', 'Token revocado o caducado: Reconectar'],
            ['`invalid_credentials`', '424', 'Credenciales de la instancia inválidas: avisar al administrador'],
            ['`rate_limited`', '429', 'Demasiadas peticiones; `retryAfter` en segundos'],
            ['`provider_error`', '502', 'Fallo del proveedor o de red: reintentar (misma `Idempotency-Key`)'],
            ['`invalid_input` / `unavailable` / `not_supported`', '400 / 503 / 501', 'Entrada inválida, extensión o backend no disponible, operación no soportada'],
        ] },
        { t: 'h2', id: 'guarantees', text: 'Garantías' },
        { t: 'ul', items: [
            '**Propiedad estricta**: la cuenta usada sale de la sesión del servidor; nunca se usa la cuenta de otro usuario y un `context.auth` del navegador se descarta. Solo se puede borrar una reunión creada por uno mismo (tabla `ConferenceMeeting`; en modo instancia el token es de toda la cuenta).',
            '**Idempotencia persistente**: la misma `Idempotency-Key` devuelve la misma reunión (también con peticiones simultáneas y varias instancias). En Google además se envía un `requestId` derivado.',
            '**Enlaces validados**: el resultado de una extensión se valida (https, sin credenciales, sin puertos raros) antes de llegar al navegador.',
            '**Secretos**: el JSON de la cuenta de servicio y los tokens se cifran en reposo y nunca vuelven al navegador ni a los registros; los mensajes de error se sanean.',
            '**Cuenta Zoom**: los tokens son de un solo uso (se rota el par al refrescar); si Zoom responde `invalid_grant` la cuenta queda marcada y se pide reconectar.',
        ] },
        { t: 'h2', id: 'mail', text: 'Correo: invitaciones y botón Unirse' },
        { t: 'ul', items: [
            'Las invitaciones `.ics` llevan `LOCATION`, `URL`, `CONFERENCE` (RFC 7986), `X-GOOGLE-CONFERENCE` / `X-ZOOM-JOIN-URL` según el **host** exacto del enlace y el código de acceso y números de marcación en la descripción; todo con saneo de CR/LF (CWE-93).',
            'El cuerpo incluye un botón **Unirse** (con datos de marcación si existen) solo para enlaces https válidos.',
            'El lector muestra **Unirse a la reunión** con el icono del proveedor para Meet, Zoom, Teams, Webex y Jitsi. Un enlace https de otro host se muestra como texto con un aviso, sin botón de confianza.',
            'Responder (RSVP), actualizar o cancelar **no crea reuniones nuevas**: el `UID` es estable, `SEQUENCE` solo crece y una cancelación marca el evento cancelado. Al borrar un evento o cancelar una cita se cancela también la reunión del proveedor (mejor esfuerzo).',
        ] },
        { t: 'h2', id: 'data', text: 'Datos y eventos existentes' },
        { t: 'p', text: '`CalendarEvent` gana tres columnas opcionales (`conferenceUrl`, `conferenceProvider`, `conferenceMeetingId`, creadas por `npm run db:ensure`). Los eventos anteriores solo guardaban el enlace en `location`: al leerlos, el enlace reconocido se deriva de `location`, así que nada se migra ni se rompe. `npm run meet:fix` y `POST /api/google/fix-meet-rooms` consideran ambas columnas.' },
        { t: 'h2', id: 'testing', text: 'Pruebas' },
        { t: 'ul', items: [
            '`npx vitest run src/lib/conferencing src/components/conferencing` (proveedores y rutas con dobles, selector con jsdom) y `npm run test:pg` (registro, idempotencia concurrente y descifrado de `Account.refresh_token` con Postgres real).',
            '`npm test` en `bloomx-extensions` (Zoom, Meet y Calendar con `fetch` simulado, ambos modos, JWT de cuenta de servicio, errores tipados) y en `bloomx-backend` (`crypto.signRs256` del sandbox).',
            'E2E local con servidores falsos: `scripts/fake-conferencing.mjs` (Google y Zoom falsos), `scripts/fake-backend.mjs` (ejecuta las extensiones reales) y `scripts/e2e-conferencing-seed.ts`. Las bases `GOOGLE_API_BASE`, `MEET_API_BASE`, `GOOGLE_TOKEN_URL`, `ZOOM_API_BASE` y `ZOOM_OAUTH_BASE` solo se aceptan con `NODE_ENV` distinto de `production` o hacia localhost.',
        ] },
        { t: 'h2', id: 'limits', text: 'Límites' },
        { t: 'ul', items: [
            'Nada se probó contra Google o Zoom reales; el E2E usa servidores falsos.',
            'El sandbox de extensiones solo ofrece `crypto.signRs256` desde esta versión del backend; con un backend antiguo la cuenta de servicio responde `not_supported`.',
            'El modo cuenta de servicio necesita delegación de todo el dominio (Workspace): una cuenta de servicio sin ella no puede crear enlaces de Meet.',
            'Si el límite de una credencial en el backend sigue en 4096 caracteres, un JSON de cuenta de servicio con clave de 2048 bits (≈2,5 KB minificado) cabe; uno mayor requiere el límite de 16 KB.',
            'Las agendas (`AppointmentSchedule.conferencing`) solo admiten `meet` y `zoom`; Teams y el enlace propio solo existen en eventos y en el composer.',
            'Quitar una reunión ya guardada en un evento solo borra el enlace del formulario; la reunión se cancela en el proveedor al borrar el evento.',
        ] },
    ],
    en: [
        { t: 'p', text: 'Creating a **Zoom** or **Google Meet** meeting (or pasting your own link) works the same from the **calendar**, the **composer** (`/zoom`, `/meet`), **appointments** and the mail reader. Each provider\'s logic lives in its **extension** (`core-zoom`, `core-google-meet`; `core-calendar` orchestrates events and invitations); the frontend provides the core `conferencing` capability: provider registry, a single API, a shared picker, idempotency and link validation.' },
        { t: 'code', lang: 'text', title: 'Flow', code: flowEn },
        { t: 'h2', id: 'modes', text: 'Authentication modes' },
        { t: 'table', head: ['Provider', 'Mode', 'What it uses', 'Who configures it'], rows: [
            ['Zoom', '`server-to-server`', '`ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` of a Server-to-Server app', 'Administrator (panel)'],
            ['Zoom', '`user-oauth`', 'The user\'s own Zoom account (Settings → Integrations → Connect)', 'Each user; needs `ZOOM_CLIENT_ID/SECRET` (OAuth app) on the frontend'],
            ['Zoom 2.x (ZoomLib)', '`user-oauth` and `server-to-server`', 'Credentials live encrypted on the instance, in the `core-zoomlib` settings: user OAuth app (`ZOOM_CLIENT_ID/SECRET`) and its own S2S app (`ZOOM_ACCOUNT_ID`, `ZOOM_S2S_CLIENT_ID/SECRET`, `ZOOM_HOST_EMAIL`). The extension sees no tokens and uses no `ENV_READ`. Needs a domain key; without one `core-zoom` 1.4.1 is served', 'Administrator (ZoomLib settings) and each user (Settings → Integrations → Connect)'],
            ['Microsoft Teams', '`microsoft-account`', 'The user\'s own Microsoft work or school account, linked through MicrosoftLib (`core-microsoftlib`, settings `MICROSOFT_CLIENT_ID/SECRET/TENANT`); meetings are created with Graph (`onlineMeetings` or an event with Teams). Needs a domain key', 'Administrator (MicrosoftLib settings) and each user'],
            ['Google', '`service-account`', 'Service account JSON (max. 16 KB) + `GOOGLE_IMPERSONATE_USER` (Workspace delegation)', 'Administrator (panel)'],
            ['Google', '`google-account`', 'The instance organizer account (OAuth, minimal scopes `calendar.events openid email`) or each user\'s linked Google account', 'Administrator or user'],
            ['Own link', '`custom-link`', 'An https link pasted by the user; no credentials', 'Nobody'],
        ] },
        { t: 'p', text: 'Without an explicit `*_AUTH_MODE` the mode is automatic: Zoom uses Server-to-Server when credentials exist and otherwise the user\'s account; Google uses the service account when a JSON exists, then the organizer account and finally the user\'s linked account. The active source (instance / user account / none) shows in Settings → Integrations.' },
        { t: 'callout', kind: 'note', title: 'Compatibility', text: 'What already worked keeps working: `GOOGLE_MEET_ADMIN_REFRESH_TOKEN` is equivalent to the organizer account, `ZOOM_ACCOUNT_ID/CLIENT_ID/CLIENT_SECRET` remain the S2S credential names, the old `POST /api/calendar/conferencing/meet` route is an alias of the new one and, if the extension is not installed or the backend does not answer, a thin frontend adapter uses the user\'s own linked account.' },
        { t: 'h2', id: 'operator', text: 'What the operator must configure' },
        { t: 'ol', items: [
            '**Install** `core-zoom` and/or `core-google-meet` (and `core-calendar`) from Extensions and press **Credentials**, or use Settings → Integrations (only the manager who owns the domain can write them).',
            'Pick the **mode** and fill in the values (always masked; the server never returns them). Press **Test connection**: it calls the provider and shows OK or a readable reason.',
            'For per-user mode: set `GOOGLE_CLIENT_ID/SECRET` on the frontend (Calendar + Meet scopes in `/api/auth/google`) and/or `ZOOM_CLIENT_ID/SECRET` with `{NEXT_PUBLIC_APP_URL}/api/auth/callback/zoom` as the redirect.',
            'For the organizer account: register `{NEXT_PUBLIC_APP_URL}/api/auth/callback/google-organizer` as an authorised redirect in Google Cloud and press **Connect Google account**.',
            '**Signed domain**: domain credentials only reach extensions if the instance signs its requests (`BLOOMX_DOMAIN_PRIVATE_KEY`, see [Architecture](/docs/architecture)). On a legacy domain only per-user mode works.',
        ] },
        { t: 'code', lang: 'text', title: 'Credential keys (ENV_READ)', code: settingsEn },
        { t: 'h2', id: 'api', text: 'API' },
        { t: 'table', head: ['Route', 'Use'], rows: [
            ['`GET /api/calendar/conferencing/providers`', 'Per-provider status for the user: `configured`, `connected`, `mode`, `source`, `reason`, `connect`'],
            ['`POST /api/calendar/conferencing/[provider]`', 'Create: body `{ topic, startsAt, endsAt, timeZone, attendees, customUrl, attachToEventId }`, `Idempotency-Key` header. Returns `{ meeting: { provider, joinUrl, hostUrl, meetingId, passcode, dialIn, attachment? } }`'],
            ['`DELETE /api/calendar/conferencing/[provider]?meetingId=`', 'Delete; only meetings created by the same user'],
            ['`POST /api/calendar/conferencing/[provider]/test`', 'Connection test (admin only)'],
            ['`POST /api/calendar/conferencing/meet`', 'Compatible alias of `google-meet` (`{ title, startsAt, endsAt }` → `{ meetUrl }`)'],
            ['`GET /api/admin/conferencing`', 'Panel: installations and configured keys (admin only)'],
        ] },
        { t: 'table', head: ['Code', 'HTTP', 'Meaning and action'], rows: [
            ['`not_connected`', '409', 'Not connected yet: Connect button (OAuth or Settings)'],
            ['`token_revoked`', '401', 'Revoked or expired token: Reconnect'],
            ['`invalid_credentials`', '424', 'Invalid instance credentials: tell the administrator'],
            ['`rate_limited`', '429', 'Too many requests; `retryAfter` in seconds'],
            ['`provider_error`', '502', 'Provider or network failure: retry (same `Idempotency-Key`)'],
            ['`invalid_input` / `unavailable` / `not_supported`', '400 / 503 / 501', 'Invalid input, extension or backend unavailable, unsupported operation'],
        ] },
        { t: 'h2', id: 'guarantees', text: 'Guarantees' },
        { t: 'ul', items: [
            '**Strict ownership**: the account used comes from the server session; another user\'s account is never used and a browser-sent `context.auth` is discarded. You can only delete a meeting you created (`ConferenceMeeting` table; in instance mode the token belongs to the whole account).',
            '**Persistent idempotency**: the same `Idempotency-Key` returns the same meeting (also with simultaneous requests and several instances). For Google a derived `requestId` is sent as well.',
            '**Validated links**: an extension\'s result is validated (https, no credentials, no odd ports) before it reaches the browser.',
            '**Secrets**: the service account JSON and tokens are encrypted at rest and never return to the browser or the logs; error messages are sanitised.',
            '**Zoom account**: tokens are single-use (the pair is rotated on refresh); if Zoom answers `invalid_grant` the account is marked and a reconnect is requested.',
        ] },
        { t: 'h2', id: 'mail', text: 'Mail: invitations and the Join button' },
        { t: 'ul', items: [
            '`.ics` invitations carry `LOCATION`, `URL`, `CONFERENCE` (RFC 7986), `X-GOOGLE-CONFERENCE` / `X-ZOOM-JOIN-URL` according to the exact link **host**, and the access code and dial-in numbers in the description; everything is CR/LF-sanitised (CWE-93).',
            'The body includes a **Join** button (with dial-in data when present) only for valid https links.',
            'The reader shows **Join the meeting** with the provider icon for Meet, Zoom, Teams, Webex and Jitsi. An https link to another host is shown as text with a warning, with no trusted button.',
            'Replying (RSVP), updating or cancelling **never creates new meetings**: the `UID` is stable, `SEQUENCE` only grows and a cancellation marks the event cancelled. Deleting an event or cancelling an appointment also cancels the provider meeting (best effort).',
        ] },
        { t: 'h2', id: 'data', text: 'Data and existing events' },
        { t: 'p', text: '`CalendarEvent` gains three optional columns (`conferenceUrl`, `conferenceProvider`, `conferenceMeetingId`, created by `npm run db:ensure`). Older events only stored the link in `location`: when read, the recognised link is derived from `location`, so nothing is migrated or broken. `npm run meet:fix` and `POST /api/google/fix-meet-rooms` consider both columns.' },
        { t: 'h2', id: 'testing', text: 'Testing' },
        { t: 'ul', items: [
            '`npx vitest run src/lib/conferencing src/components/conferencing` (providers and routes with doubles, picker with jsdom) and `npm run test:pg` (registry, concurrent idempotency and `Account.refresh_token` decryption with a real Postgres).',
            '`npm test` in `bloomx-extensions` (Zoom, Meet and Calendar with simulated `fetch`, both modes, service account JWT, typed errors) and in `bloomx-backend` (the sandbox `crypto.signRs256`).',
            'Local E2E with fake servers: `scripts/fake-conferencing.mjs` (fake Google and Zoom), `scripts/fake-backend.mjs` (runs the real extensions) and `scripts/e2e-conferencing-seed.ts`. The `GOOGLE_API_BASE`, `MEET_API_BASE`, `GOOGLE_TOKEN_URL`, `ZOOM_API_BASE` and `ZOOM_OAUTH_BASE` bases are only accepted with `NODE_ENV` other than `production` or towards localhost.',
        ] },
        { t: 'h2', id: 'limits', text: 'Limits' },
        { t: 'ul', items: [
            'Nothing was tested against real Google or Zoom; the E2E uses fake servers.',
            'The extension sandbox only offers `crypto.signRs256` from this backend version; with an older backend the service account answers `not_supported`.',
            'Service account mode needs domain-wide delegation (Workspace): a service account without it cannot create Meet links.',
            'If a credential limit on the backend is still 4096 characters, a service account JSON with a 2048-bit key (≈2.5 KB minified) fits; a larger one needs the 16 KB limit.',
            'Schedules (`AppointmentSchedule.conferencing`) only accept `meet` and `zoom`; Teams and the own link only exist in events and the composer.',
            'Removing a meeting already saved on an event only removes the link from the form; the meeting is cancelled at the provider when the event is deleted.',
        ] },
    ],
};

export default page;
