import type { Block, DocPageContent } from '../types';

const manifestEx = `{
  "id": "core-googlelib",
  "version": "1.0.0",
  "requires": { "clientApi": 5, "capabilities": ["oauth.provider.v1", "oauth.broker.v1"] },
  "oauthProviders": [{
    "id": "google",
    "displayName": "Google",
    "authorizeUrl": "https://accounts.google.com/o/oauth2/v2/auth",
    "tokenUrl": "https://oauth2.googleapis.com/token",
    "apiBase": "https://www.googleapis.com",
    "allowedHosts": ["accounts.google.com", "oauth2.googleapis.com", "www.googleapis.com"],
    "pkce": true,
    "clientIdSetting": "GOOGLE_CLIENT_ID",
    "clientSecretCredential": "GOOGLE_CLIENT_SECRET",
    "redirectPath": "/api/auth/callback/google",
    "scopes": [{ "id": "https://www.googleapis.com/auth/calendar.events", "group": "calendar", "es": "Eventos", "en": "Events", "risk": "medium" }],
    "actions": [{ "id": "calendar.events.list", "group": "calendar", "method": "GET", "path": "/calendar/v3/calendars/{calendarId}/events", "requiresScopes": ["https://www.googleapis.com/auth/calendar.events"] }]
  }]
}`;

const dependentEx = `{
  "id": "core-calendar",
  "requires": { "extensions": { "core-googlelib": "^1.0.0" } },
  "permissions": ["OAUTH_ACCOUNT:google:calendar", "OAUTH_SHARED:google"]
}

// server.js
const events = await ctx.libs.google.calendar.events.list({ calendarId: 'primary' });`;

const msEx = `{
  "id": "core-microsoftlib", "version": "1.0.0",
  "requires": { "clientApi": 9, "capabilities": ["oauth.provider.v1", "oauth.provider.v2", "oauth.broker.v1", "settings.schema.v1"] },
  "oauthProviders": [{
    "id": "microsoft", "displayName": "Microsoft",
    "authorizeUrl": "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize",
    "tokenUrl": "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
    "jwksUri": "https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys",
    "issuer": "https://login.microsoftonline.com/{claim:tid}/v2.0",
    "userinfoUrl": "https://graph.microsoft.com/oidc/userinfo", "apiBase": "https://graph.microsoft.com",
    "allowedHosts": ["login.microsoftonline.com", "graph.microsoft.com"],
    "variables": { "tenant": { "setting": "MICROSOFT_TENANT", "default": "common", "pattern": "^(common|organizations|consumers|[0-9a-fA-F-]{36})$" } },
    "pkce": true, "clientIdSetting": "MICROSOFT_CLIENT_ID", "clientSecretCredential": "MICROSOFT_CLIENT_SECRET",
    "actions": [{ "id": "calendar.events.list", "group": "calendar", "method": "GET", "path": "/v1.0/me/events", "requiresScopes": ["Calendars.Read"],
      "params": { "top": { "in": "query", "type": "integer", "min": 1, "max": 100, "queryName": "$top" } } }]
  }]
}`;

const zoomEx = `{
  "id": "core-zoomlib", "version": "1.0.0",
  "oauthProviders": [{
    "id": "zoom", "displayName": "Zoom",
    "authorizeUrl": "https://zoom.us/oauth/authorize", "tokenUrl": "https://zoom.us/oauth/token", "revokeUrl": "https://zoom.us/oauth/revoke",
    "userinfoUrl": "https://api.zoom.us/v2/users/me", "apiBase": "https://api.zoom.us", "allowedHosts": ["zoom.us", "api.zoom.us"],
    "pkce": true, "tokenAuth": "basic", "revokeToken": "access",
    "serviceCredentials": { "grant": "account_credentials", "accountIdSetting": "ZOOM_ACCOUNT_ID", "clientIdSetting": "ZOOM_S2S_CLIENT_ID", "clientSecretCredential": "ZOOM_S2S_CLIENT_SECRET" },
    "clientIdSetting": "ZOOM_CLIENT_ID", "clientSecretCredential": "ZOOM_CLIENT_SECRET"
  }]
}

// core-zoom 2.0.0 (conferencing): "requires": { "extensions": { "core-zoomlib": "^1.0.0" } }, "permissions": ["OAUTH_ACCOUNT:zoom:meetings", "OAUTH_SHARED:zoom"]
await ctx.libs.zoom.meetings.create({ userId: "me", meeting: { topic: "Demo", type: 2 } });                    // cuenta del usuario
await ctx.libs.zoom.meetings.create({ userId: "host@acme.com", meeting: { topic: "Demo" } }, { principal: "service" }); // Server-to-Server`;

const slackEx = `{
  "id": "core-slacklib", "version": "1.0.0",
  "oauthProviders": [{
    "id": "slack", "displayName": "Slack", "tokenFormat": "slack-v2", "pkce": false,
    "authorizeUrl": "https://slack.com/oauth/v2/authorize", "tokenUrl": "https://slack.com/api/oauth.v2.access", "revokeUrl": "https://slack.com/api/auth.revoke",
    "apiBase": "https://slack.com", "allowedHosts": ["slack.com"],
    "scopes": [{ "id": "chat:write", "group": "chat", "es": "Publicar mensajes", "en": "Post messages", "risk": "medium" },
               { "id": "user:chat:write", "group": "chat", "es": "Publicar como tú", "en": "Post as you", "risk": "medium" }],
    "actions": [{ "id": "chat.postMessage", "group": "chat", "method": "POST", "path": "/api/chat.postMessage", "write": true, "quotaPerHour": 120, "requiresScopes": ["chat:write"],
      "params": { "channel": { "in": "body", "type": "string", "required": true, "pattern": "^[CG][A-Z0-9]{2,20}$", "allowedFromSetting": "SLACK_ALLOWED_CHANNELS" },
                  "text": { "in": "body", "type": "string", "maxLength": 3000 } } }]
  }]
}

// slack-notify: "permissions": ["OAUTH_ACCOUNT:slack:chat"]
await ctx.libs.slack.chat.postMessage({ channel: ctx.settings.channel, text: "Nuevo correo de Ana" });`;

const generatorEx = `cd bloomx-extensions
npm run new:oauth-provider -- mi-crm                 # crea mi-crmlib/ y la prueba de flujo del frontend
npm run new:oauth-provider -- github --core          # extension OFICIAL de un id reservado (core-githublib)
node --experimental-strip-types _shared/sdk/build-manifest.mjs mi-crmlib/manifest.src.mjs
node --experimental-strip-types _shared/validate.mjs mi-crmlib
node --experimental-strip-types --test mi-crmlib/tests/*.test.mjs
cd ../bloomx && npx vitest run src/lib/oauth/__tests__/mi-crm.flow.test.ts`;

const routeEx = `"backendRoutes": [
  { "path": "/hook/:id", "method": "POST", "handler": "onHook", "auth": "hmac", "hmac": { "header": "X-Signature", "secretSetting": "HOOK_SECRET" } },
  { "path": "/status", "method": "GET", "handler": "status", "auth": "admin", "minLevel": 2, "stepUp": true }
]`;

const es: Block[] = [
    { t: 'p', text: 'Un proveedor OAuth (Google, Microsoft, Zoom o Slack, o el tuyo) es una **extensión**: declara `oauthProviders` en su manifest y el núcleo de la instancia ejecuta el flujo. Las demás extensiones lo usan por dependencia y **nunca ven tokens**.' },
    { t: 'h2', id: 'model', text: 'Modelo' },
    { t: 'ul', items: [
        '**Núcleo** (`/api/oauth/[provider]/start|callback|reconnect|unlink`): PKCE S256, `state` opaco de un solo uso, verificación del `id_token` OIDC por JWKS, comprobación de `iss` (RFC 9207), `returnTo` saneado, refresh con bloqueo y rotación, revocación RFC 7009 al desvincular. Los alias de Google (`/api/auth/google`, `/api/auth/callback/google`) usan el mismo flujo.',
        '**Registro**: los proveedores salen de los manifests instalados. Si no hay extensión, Google sigue funcionando con las variables `GOOGLE_*` solo cuando todos los endpoints son hosts oficiales de Google.',
        '**Credenciales**: el client secret y las credenciales compartidas se guardan cifradas (AES-256-GCM v3) en la tabla de la instancia `OAuthProviderConfig`, ancladas a los hosts aprobados. Si cambia un host, el proveedor pasa a `needs_reapproval`.',
        '**Broker**: el backend llama a la instancia (`/api/internal/host/oauth`) presentando la `executionGrant` que la propia instancia firmó (ver "Concesiones de ejecución") y expone `services.oauth` y `ctx.libs.<proveedor>.<acción>`. Los grupos de scopes y el acceso compartido los deriva la INSTANCIA de la concesión. Permisos: `OAUTH_ACCOUNT:<proveedor>:<grupo>` y `OAUTH_SHARED:<proveedor>`.',
        '**Principales**: `user` (cuenta del usuario), `organizer` (cuenta compartida) y `service` (cuenta de servicio; el JWT lo firma el núcleo).',
    ] },
    { t: 'h2', id: 'write', text: 'Escribir un proveedor OAuth como extensión' },
    { t: 'ol', items: [
        'Declara `oauthProviders` con endpoints https, puerto 443, DNS público y `allowedHosts` (regla anti-SSRF).',
        'Cataloga los `scopes` con `group`, texto es/en y `risk`.',
        'Declara `actions` (método, ruta con parámetros, scopes requeridos, `fixedQuery`, `bodyFrom`, `upload`, `write`). Nada que no esté declarado se puede llamar.',
        'Pon `requires.capabilities` con `oauth.provider.v1` y `requires.clientApi` 5 (con funciones v2: `oauth.provider.v2` y clientApi 9).',
        'Publica; el administrador introduce el client id y el secreto en la consola (`/admin/extensions`, o `oauth secret set` en la CLI de administración) y aprueba los hosts del proveedor.',
        'Atajo: `npm run new:oauth-provider -- <id>` genera el esqueleto, las pruebas y la prueba de flujo (ver "Plantilla y generador").',
    ] },
    { t: 'code', lang: 'json', title: 'Proveedor en el manifest', code: manifestEx },
    { t: 'h2', id: 'dependencies', text: 'Dependencias entre extensiones' },
    { t: 'p', text: '`requires.extensions` acepta rangos semver (`^`, `~`, comparadores y `*`). Instalar una extensión instala o propone sus dependencias; si una dependencia se pausa o desinstala, las dependientes se **pausan** (no se borran) y se reanudan al volver. Los ciclos se rechazan al publicar. Capacidad: `ext.dependencies.v1` (clientApi 3).' },
    { t: 'code', lang: 'json', title: 'Extensión que usa GoogleLib', code: dependentEx },
    { t: 'h2', id: 'routes', text: 'Rutas y páginas de extensiones: modos de autenticación' },
    { t: 'p', text: 'Las rutas `backendRoutes` se sirven en `/api/ext/<id>/...` y las páginas públicas en `/p/**`. Cada ruta declara `auth`:' },
    { t: 'table', head: ['Modo', 'Quién puede llamar', 'Detalle'], rows: [
        ['`session`', 'Usuario con sesión', 'Predeterminado. Respeta `minLevel`.'],
        ['`admin`', 'Administrador', '`minLevel` y `stepUp` (MFA reciente) opcionales. Las páginas lo comprueban en `/api/expansions/page-access`.'],
        ['`signature`', 'Backend compartido', 'Solo llamadas directas firmadas Ed25519 a la instancia; el borde nunca firma `signature`.'],
        ['`hmac`', 'Sistema externo', 'HMAC con secreto de dominio (nunca global), comparación en tiempo constante y anti-replay.'],
        ['`none`', 'Cualquiera', 'Requiere el permiso `PUBLIC_ROUTE` aprobado explícitamente por el administrador (`approvedPermissions`). Las páginas `auth: none` solo bajo `/p/**` con CSP estricta.'],
    ] },
    { t: 'code', lang: 'json', title: 'backendRoutes', code: routeEx },
    { t: 'p', text: 'Capacidades: `ext.routes.v1`, `ext.routes.auth.v1`, `ext.pages.auth.v1` (clientApi 4). El borde de la instancia firma dentro de la URL el origen, nivel, usuario e IP; el backend los verifica.' },
    { t: 'h2', id: 'security', text: 'Seguridad: modelo de amenazas STRIDE' },
    { t: 'table', head: ['Amenaza', 'Riesgo', 'Mitigación'], rows: [
        ['Suplantación (S)', 'Callback forjado, llamada falsa al broker o a una ruta; backend suplantado', '`state` opaco de un solo uso, PKCE S256, `iss` e `id_token` verificados; el broker solo acepta la `executionGrant` firmada con la clave de ESTA instancia (jti, caducidad, dominio, extensión, usuario); HMAC por ruta con secreto de dominio; registro de proveedores por https a URL fija y esquema estricto, y aprobación del admin para los no integrados.'],
        ['Manipulación (T)', 'Cambiar endpoints, scopes o parámetros', 'Endpoints anclados a hosts aprobados (`needs_reapproval`); acciones validadas contra el manifest; `grantedGroups` firmado por el backend.'],
        ['Repudio (R)', 'Negar una vinculación o un cambio de credencial', 'Auditoría `oauth.*` con proveedor y nombre de credencial, nunca valores.'],
        ['Divulgación (I)', 'Fuga de tokens o secretos', 'Tokens cifrados en reposo; los tokens nunca llegan a las extensiones (el ejecutor retira `context.auth`); respuestas `no-store`; el backend compartido no guarda secretos del proveedor.'],
        ['Denegación (D)', 'Agotar refresh, SSRF o respuestas enormes', 'Bloqueo de refresh (advisory lock + dedupe), `providerFetch` sin redirecciones, DNS público, tope de tamaño y de tiempo.'],
        ['Elevación (E)', 'Extensión que accede a cuentas ajenas', 'Permisos por grupo; compartido solo con `OAUTH_SHARED`; `PUBLIC_ROUTE` requiere aprobación; rutas `admin` con nivel y MFA reciente.'],
    ] },
    { t: 'h2', id: 'domain-key', text: 'Requisito: la clave de dominio de la instancia' },
    { t: 'p', text: 'GoogleLib, la IA por puente, los servicios del host y las rutas propias de extensiones (`ext.grants.v1`, `oauth.*`, `ext.routes*`) **solo funcionan si la instancia firma sus peticiones** con su `BLOOMX_DOMAIN_PRIVATE_KEY`. Una instancia sin clave sigue en modo legado y recibe exactamente las versiones de extensiones de siempre (google-sync, meet, calendar y drive 1.x, con tokens por `context.auth`): anuncia al backend `clientApi` 3 y solo las capacidades que funcionan sin firmar. Al registrar la clave pasa sola a las versiones nuevas, sin tocar nada más.' },
    { t: 'ol', items: [
        'Genera el par en tu equipo: `node scripts/gen-domain-keypair.mjs` (la clave privada no se genera ni viaja por el navegador).',
        'Guarda la privada como variable de entorno secreta `BLOOMX_DOMAIN_PRIVATE_KEY` de la instancia y vuelve a desplegar.',
        'Registra la clave pública en el backend: `bloomx-admin security keys register` (sesión de gestor, nivel 4 con reautenticación), la pantalla `/admin/register` o `POST /api/manager/domain-key`.',
        'Comprueba con `bloomx-admin security signing` (`signed: true`): el aviso del panel de Extensiones, IA y Cuentas vinculadas desaparece y las extensiones se pueden actualizar.',
    ] },
    { t: 'table', head: ['Capacidad', 'Sin clave', 'Motivo'], rows: [
        ['`ext.grants.v1`', 'No se anuncia', 'La instancia emite la `executionGrant` con su clave.'],
        ['`oauth.provider.v1`, `oauth.broker.v1`', 'No se anuncian', 'El intermediario lo llama el backend con la concesión; GoogleLib exige ambas.'],
        ['`ext.routes.v1`, `ext.routes.auth.v1`', 'No se anuncian', 'El borde firma `_bx_src`, nivel e IP en la URL.'],
        ['`oauth.provider.v2`', 'No se anuncia', 'MicrosoftLib, ZoomLib y SlackLib: mismo intermediario firmado más las funciones del flujo que solo conoce este núcleo.'],
        ['`oauth.provider.v3`', 'No se anuncia', 'DiscordLib 1.1.0: credencial de bot y rutas con dispatch, sobre el mismo intermediario firmado.'],
        ['`ext.dependencies.v1`', 'Se anuncia', 'Lógica del backend independiente de la firma.'],
        ['`ai.*`, `services.host.v1`, `lifecycle.events.v1`, `settings.schema.v1`, UI', 'Se anuncian', 'Ya las anunciaba la versión desplegada; sin clave degradan (camino heredado) en lugar de romper. Cambiarlas alteraría las versiones que hoy reciben.'],
    ] },
    { t: 'h2', id: 'grants', text: 'Concesiones de ejecución (sin clave global del backend)' },
    { t: 'p', text: 'El backend compartido no tiene ninguna clave propia ni firma nada. Cuando una instancia le pide ejecutar una extensión, hook o ruta, adjunta una `executionGrant`: un mensaje Ed25519 firmado con la clave de dominio de la instancia (`BLOOMX_DOMAIN_PRIVATE_KEY`, la misma que ya firma sus peticiones). Lleva dominio (`iss`/`aud`), extensión y versión, usuario (`sub`, null en rutas públicas), la lista cerrada de permisos de esa ejecución, `jti`, `iat/exp` (120 s por defecto, `BLOOMX_GRANT_TTL_SECONDS`), nonce y tope de usos (`BLOOMX_GRANT_MAX_USES`).' },
    { t: 'ul', items: [
        '**El backend solo la reenvía**: comprueba que corresponde a la ejecución (dominio autenticado de la petición, extensión, versión, usuario, no caducada) y la presenta tal cual a `/api/internal/host/*`. El sandbox nunca la ve.',
        '**La instancia la verifica sola**, con la clave pública derivada de su privada y sin red: firma, `exp`, `aud`, extensión y usuario del cuerpo, servicio dentro de los permisos y tope de usos por `jti` (la misma ejecución hace N llamadas hasta `exp`). Una extensión no puede ampliar permisos ni cambiar de usuario o dominio porque rompería la firma.',
        '**Versionado**: capacidad `ext.grants.v1` (clientApi 6). Si la instancia la anuncia y no hay concesión válida, el backend NO ofrece servicios del host (nunca cae a una clave global); una concesión mal formada o de otro dominio, extensión, versión o usuario se rechaza con `INVALID_GRANT`.',
        '**Legado deprecado**: instancias y backends antiguos que usan la firma del backend (`BACKEND_SIGNING_PRIVATE_KEY`, `BLOOMX_BACKEND_PUBLIC_KEY`, `/.well-known/bloomx-backend-key.json`) siguen funcionando durante la transición; la instancia lo avisa en el log y en `/admin`. Para apagarlo: `BLOOMX_ACCEPT_BACKEND_SIGNATURE=false`. Se retirará en una versión futura.',
        '**Migración de credenciales**: sin entrega automática. `migrate-googlelib` solo informa de los nombres de las credenciales; guárdalas en cada instancia con `oauth secret set`.',
    ] },
    { t: 'h2', id: 'hardening', text: 'Reglas de seguridad adicionales' },
    { t: 'ul', items: [
        '**Tokens como permiso**: `context.auth` y `getToken()` solo llegan a extensiones cuyo manifest declara `OAUTH_READ` o a una lista cerrada de versiones antiguas (google-meet, calendar, google-drive, google-sync, zoom y hubspot, hasta su última versión legada). Cualquier otra extensión no los recibe. Está **deprecado**: usa `OAUTH_ACCOUNT:*`.',
        '**Ids reservados**: `google`, `microsoft`, `zoom`, `slack`, `github` y similares solo los registra su extensión oficial (`core-googlelib`, `core-microsoftlib`, `core-zoomlib`, `core-slacklib`...); ni siquiera una oficial puede registrar el id de otra. Se valida al publicar y de nuevo en la instancia.',
        '**Rutas de acciones**: un parámetro de ruta nunca puede ser `.` ni `..` y la ruta final tras normalizar la URL debe ser exactamente la construida; un id con `%2e%2e`, `/` o `?` no sale del servidor.',
        '**Límites por acción**: cuota por minuto y usuario/extensión/proveedor (120 lecturas, 30 escrituras) y, si la acción lo declara, `quotaPerHour` (tope duro por hora fijado por el manifest, no por la extensión). `allowedFromSetting` limita un parámetro a una lista que fija el admin (p. ej. canales de Slack).',
        '**Cuenta atada a su proveedor**: cada cuenta guarda el hash de los endpoints del proveedor que la emitió; si otro proveedor usara el mismo id, sus tokens no se envían ni se refrescan.',
        '**Aprobación de proveedores no integrados**: quedan en `pending_approval` hasta que un administrador (nivel 3 + step-up) aprueba sus hosts (`POST /api/admin/oauth/providers/<id>/approve` o `oauth approve`). El inicio de sesión solo funciona con el Google oficial y exige `email_verified` explícito.',
        '**Aprobaciones al instalar/actualizar**: cada ruta pública (`PUBLIC_ROUTE:<MÉTODO> <ruta>` o `PUBLIC_ROUTE:PAGE <ruta>`), `OAUTH_SHARED:*` y `OAUTH_ACCOUNT:*` de grupos de riesgo alto (gmail, drive...) se aprueban una a una; una versión nueva que añade alguna queda pendiente.',
        '**Cuentas compartidas**: el organizador y la cuenta de servicio solo conceden los scopes de una lista fija (Google: calendario y Meet).',
        '**Transporte**: la conexión al proveedor fija la IP validada (sin ventana de DNS rebinding) e incluye 6to4, NAT64 e IPv6 compatible como direcciones privadas. `NEXT_PUBLIC_BACKEND_URL` debe ser https en producción y es FIJA por instancia: el registro de proveedores no sigue redirecciones, se valida por esquema estricto y los proveedores no integrados exigen la aprobación del administrador. No existe ninguna clave global del backend.',
        '**Patrones**: los `pattern` de acciones y rutas se validan contra ReDoS al publicar y se ejecutan con control de errores.',
        '**HMAC**: `timestampHeader` es obligatorio salvo `allowReplay: true`; sin timestamp el detector de repeticiones es por proceso y no es una defensa fuerte en serverless.',
        '**GET con efectos**: una ruta `session`/`admin` con `sideEffects: true` rechaza peticiones `Sec-Fetch-Site: cross-site`.',
        '**Páginas `admin` en el servidor**: sin el nivel, el navegador no recibe el árbol de componentes de esas páginas y las acciones que invocan (y su handler) responden 403. El `state` inicial solo se oculta si la extensión no conserva otros mounts con componente: no pongas datos sensibles en `state`.',
        '**Sin tabla `OAuthFlow` en producción** el flujo falla cerrado en lugar de degradar a memoria.',
    ] },
    { t: 'h2', id: 'compliance', text: 'Cumplimiento (verificado por código y pruebas)' },
    { t: 'callout', kind: 'warn', text: 'Mapeo hecho leyendo el código y ejecutando las pruebas; no es una certificación. Las pruebas usan un servidor OAuth falso local; **no se ha probado contra Google real** (requiere credenciales).' },
    { t: 'table', head: ['Referencia', 'Control', 'Estado y verificación'], rows: [
        ['RFC 6749', 'Flujo de código, `state`, refresh', 'CUMPLE: pruebas de flujo, state de un solo uso y rotación.'],
        ['RFC 7636', 'PKCE', 'CUMPLE: solo S256; prueba de verificador.'],
        ['RFC 9700 (BCP)', 'Sin implícito, redirect exacto, rotación de refresh', 'CUMPLE: redirect fijo por proveedor, `invalid_grant` marca reconectar.'],
        ['RFC 9207', 'Parámetro `iss`', 'CUMPLE: se comprueba si el proveedor lo envía.'],
        ['RFC 8252', 'Apps nativas', 'N/A: flujo web en navegador; sin esquemas personalizados.'],
        ['RFC 7009', 'Revocación', 'CUMPLE: al desvincular, si el proveedor la ofrece.'],
        ['OIDC Core', '`id_token`, nonce, JWKS', 'CUMPLE: firma, `iss`, `aud`, `exp` y caché JWKS con gracia.'],
        ['OWASP ASVS V3/V4/V8/V13', 'Sesión, control de acceso, datos, API', 'PARCIAL: pruebas por punto de seguridad; sin auditoría externa.'],
        ['OWASP API Top 10', 'BOLA, auth rota, SSRF, recursos', 'CUMPLE en las rutas nuevas: validación de entrada, límites y SSRF probados.'],
        ['NIST SP 800-53 / 800-63B', 'IA-5, SC-8, SC-12, SC-28', 'PARCIAL: cifrado AES-256-GCM y TLS; sin KMS (ver [Mapeo CIS / NIST / ISO](/docs/compliance)).'],
        ['ISO/IEC 27001 A.8.5, A.8.24', 'Autenticación segura y criptografía', 'PARCIAL: igual que arriba.'],
    ] },
    { t: 'h2', id: 'providers', text: 'Proveedores incluidos: MicrosoftLib, ZoomLib y SlackLib' },
    { t: 'p', text: 'Los tres siguen el patrón de GoogleLib: un manifest con `oauthProviders`, un `server.js` solo de estado (sin red ni secretos) y extensiones dependientes con `OAUTH_ACCOUNT:<proveedor>:<grupo>`. Requieren `oauth.provider.v2` (clientApi 9) y clave de dominio en la instancia. Los tokens nunca llegan a una extensión.' },
    { t: 'table', head: ['Proveedor (extensión)', 'Flujo y particularidades', 'Scopes', 'Acciones y consumidoras'], rows: [
        ['`microsoft` (`core-microsoftlib`)', 'OAuth2/OIDC Microsoft identity platform v2, PKCE S256. Tenant `common`, `organizations`, `consumers` o GUID en el ajuste `MICROSOFT_TENANT` (variable `{tenant}`). El `iss` del id_token es `https://login.microsoftonline.com/{tid}/v2.0`: se valida la firma con el JWKS y se compara con el `tid` del propio token (con un tenant GUID fijado, solo ese tenant). Hosts: login.microsoftonline.com y graph.microsoft.com.', '17 en 7 grupos (userinfo, calendar, meetings, contacts, mail, files, directory). Riesgo alto: Calendars.ReadWrite, Contacts.ReadWrite, Mail.*, Files.ReadWrite. Aprobación del admin: grupos mail, files y directory. Por defecto: openid, profile, email, offline_access, User.Read, Calendars.ReadWrite, OnlineMeetings.ReadWrite.', '30 acciones sobre Graph v1.0: perfil, calendarios y eventos (list/create/update/delete, vista, disponibilidad), reunión de Teams (`meetings.onlineMeetings.*`), contactos, correo (lectura y envío), archivos y directorio. Consumidora: `microsoft-teams` (selector de ubicación del evento).'],
        ['`zoom` (`core-zoomlib`)', 'OAuth por usuario con PKCE y `client_secret_basic` (cabecera Basic), revocación por access token y modo Server-to-Server (`account_credentials`) con la app S2S propia (ajustes `ZOOM_ACCOUNT_ID`, `ZOOM_S2S_CLIENT_ID`, secreto `ZOOM_S2S_CLIENT_SECRET`). Hosts: zoom.us y api.zoom.us.', '7 granulares en 2 grupos (meetings, userinfo): meeting:write/update/delete/read, meeting:read:list_meetings, user:read:user, user:read:email. Por defecto los cinco primeros.', '6 acciones: `meetings.create/update/delete/get/list` y `users.me.get`. Consumidora: `zoom` 2.0.0 (contrato de conferencing intacto). Los clientes antiguos y las instancias sin clave siguen recibiendo `zoom` 1.4.1.'],
        ['`slack` (`core-slacklib`)', 'OAuth v2 de Slack (`tokenFormat: slack-v2`): token de BOT y de USUARIO como dos cuentas independientes, scopes de usuario con prefijo `user:`, errores `{ok:false}`, rotación opcional y revocación con `auth.revoke`. Sin PKCE (Slack no lo usa): secreto obligatorio. Host: slack.com.', '9 en 3 grupos (chat, channels, users): chat:write, chat:write.public, channels:read, groups:read, users:read, users:read.email y user:chat:write, user:channels:read, user:users:read. Por defecto: chat:write, channels:read, users:read.', '7 acciones: `chat.postMessage` (solo a los canales de `SLACK_ALLOWED_CHANNELS`, tope duro de 120/hora), `conversations.list/listPrivate/info`, `users.list/info` y `auth.test`; ninguna lee mensajes. Consumidora: `slack-notify` (avisos de correo con filtros, sin cuerpos por defecto).'],
    ] },
    { t: 'code', lang: 'json', title: 'MicrosoftLib (extracto)', code: msEx },
    { t: 'code', lang: 'js', title: 'ZoomLib (extracto) y uso desde zoom 2.0', code: zoomEx },
    { t: 'code', lang: 'js', title: 'SlackLib (extracto) y uso desde slack-notify', code: slackEx },
    { t: 'h2', id: 'v3', text: 'Funciones v3 (oauth.provider.v3): credencial de bot y rutas con dispatch' },
    { t: 'p', text: 'DiscordLib 1.1.0 añade, bajo la capacidad `oauth.provider.v3` (clientApi 12), solo campos nuevos: una **credencial de bot** del proveedor (`botCredential`, token write-only que solo guarda el núcleo), acciones con `credential: "bot"` (cabecera `Authorization: Bot` inyectada por el núcleo, nunca devuelta), `moderation` (acciones apagadas salvo ajuste del admin), `guild` (restricción a servidores permitidos), `pathSettings` y rutas con `dispatch` (tras verificar una firma `hmac` Ed25519 el router entrega el evento a los hooks de otras extensiones). Las instancias sin la capacidad siguen recibiendo la versión anterior. Detalle y ejemplos en [DiscordLib: bot de Discord](/docs/extension-tools/discordlib).' },
    { t: 'h2', id: 'v2', text: 'Funciones v2 (oauth.provider.v2)' },
    { t: 'table', head: ['Necesidad', 'Campo', 'Quién lo usa'], rows: [
        ['Tenant o región en la URL', '`variables` (`{nombre}` solo en la ruta; el valor sale de un ajuste, validado por `pattern` y por un juego de caracteres fijo del núcleo que impide salir del segmento)', 'MicrosoftLib'],
        ['Emisor OIDC que depende del token', '`issuer` con `{claim:tid}` (comparación exacta tras verificar la firma; el parámetro `iss` de la respuesta también se acota)', 'MicrosoftLib'],
        ['Cliente con cabecera Basic', '`tokenAuth: "basic"` (ni el id ni el secreto van en el cuerpo)', 'ZoomLib'],
        ['Revocar por access token', '`revokeToken: "access"` (se refresca antes si caducó)', 'ZoomLib'],
        ['Servidor a servidor', '`serviceCredentials` + `principal: "service"` + permiso `OAUTH_SHARED` (el token S2S lo canjea y cachea el núcleo; los scopes `:admin` se normalizan)', 'ZoomLib'],
        ['Respuesta de token no estándar', '`tokenFormat: "slack-v2"`', 'SlackLib'],
        ['Query con `$`', '`queryName` en el parámetro (`top` → `$top`)', 'MicrosoftLib'],
        ['Valores que fija el admin', '`allowedFromSetting` (lista vacía = nada permitido; lo aplica el núcleo)', 'SlackLib'],
        ['Tope duro por hora', '`quotaPerHour` en la acción', 'SlackLib'],
    ] },
    { t: 'h2', id: 'unlink', text: 'Desvincular y revocar, por proveedor' },
    { t: 'table', head: ['Proveedor', 'Qué hace el núcleo al desvincular', 'Qué debe hacer además el usuario o el admin'], rows: [
        ['Google', 'Revoca el refresh token (RFC 7009) y borra las filas.', 'Nada.'],
        ['Microsoft', 'No existe endpoint estándar de revocación para aplicaciones: el núcleo borra los tokens locales (resultado `not_supported`). No se usa `revokeSignInSessions` porque invalidaría las sesiones del usuario en TODAS sus aplicaciones.', 'El usuario puede retirar el consentimiento en myaccount.microsoft.com → Aplicaciones (cuentas personales: account.live.com/consent/Manage); el admin del tenant, en Entra ID → Aplicaciones empresariales → Permisos, o eliminar la aplicación.'],
        ['Zoom', 'Revoca el access token con Basic (refresca antes si caducó) y borra la cuenta; un fallo de Zoom no impide desvincular.', 'Nada (el usuario también puede quitar la app en Zoom Marketplace → Manage → Added Apps).'],
        ['Slack', 'Revoca con `auth.revoke` el token de usuario; el token de bot solo si ningún otro usuario del espacio conserva una copia (resultado `shared`), para no dejar sin bot a los demás. Borra bot y usuario.', 'Para quitar la app del espacio: administración de Slack → Apps.'],
    ] },
    { t: 'h2', id: 'template', text: 'Plantilla y generador' },
    { t: 'p', text: '`bloomx-extensions/_oauth-provider-template/` es un ejemplo documentado y probado ("Acme"): `manifest.src.mjs` comentado, `server.js` de estado, README paso a paso y pruebas. Como `_template`, empieza por `_` y su JSON se llama `manifest.template.json`: **no es publicable** y los sincronizadores, la validación y el control de versiones la ignoran. `npm run new:oauth-provider -- <id>` crea `<id>lib/` con los datos ficticios sustituidos (los hosts quedan como `<id>-todo-replace.com` para que no se olviden) y la prueba de flujo contra un servidor OAuth falso. Un id reservado exige `--core` y solo vale para su extensión oficial.' },
    { t: 'code', lang: 'bash', title: 'Crear un proveedor', code: generatorEx },
    { t: 'h2', id: 'real-credentials', text: 'Probar con credenciales reales' },
    { t: 'p', text: 'Las pruebas automáticas usan servidores OAuth falsos y manifests reales; **no se han ejecutado contra Microsoft, Zoom ni Slack reales** (requiere credenciales). Para comprobarlo en una instancia con clave de dominio:' },
    { t: 'ol', items: [
        '**Microsoft**: en Entra ID registra una aplicación web con redirect `https://<instancia>/api/oauth/microsoft/callback`, crea un secreto y concede los permisos delegados del catálogo. Guarda `MICROSOFT_CLIENT_ID`, `MICROSOFT_TENANT` (`organizations` o el GUID de tu tenant; `common` admite cuentas personales, pero las reuniones de Teams exigen cuenta de trabajo o escuela) y el secreto en los ajustes de MicrosoftLib.',
        '**Zoom**: crea una app *General* (OAuth de usuario) con redirect `https://<instancia>/api/oauth/zoom/callback` y los scopes granulares; guarda `ZOOM_CLIENT_ID` y `ZOOM_CLIENT_SECRET`. Para S2S crea otra app *Server-to-Server OAuth* y guarda `ZOOM_ACCOUNT_ID`, `ZOOM_S2S_CLIENT_ID`, `ZOOM_S2S_CLIENT_SECRET` y `ZOOM_HOST_EMAIL`.',
        '**Slack**: crea la app en api.slack.com/apps con redirect `https://<instancia>/api/oauth/slack/callback`, scopes de bot `chat:write`, `channels:read`, `users:read`; guarda `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` y los ids de canal en `SLACK_ALLOWED_CHANNELS`, e invita al bot al canal (`/invite @app`).',
        'Como administrador, aprueba los hosts del proveedor (`/admin/extensions` o `oauth approve <id>`) y guarda el secreto (`oauth secret set`); como usuario, vincula la cuenta en Ajustes → Integraciones o con `/api/oauth/<id>/start` y revisa Cuentas vinculadas en `/admin/accounts`.',
        'Prueba: crear una reunión de Teams o Zoom desde el selector de ubicación de un evento, o activar `slack-notify` y pulsar "Enviar prueba". Nunca compartas los secretos: se guardan cifrados en la instancia y no los ve ninguna extensión.',
    ] },
    { t: 'h2', id: 'migration', text: 'Migrar una instancia' },
    { t: 'ol', items: [
        'Simulacro: `node --experimental-strip-types scripts/migrate-googlelib.mjs` (backend).',
        'Aplicar: añade `--apply`. Copia los ajustes no secretos; las extensiones de origen no se tocan.',
        'Credenciales: el script NO mueve secretos. Guárdalas en cada instancia con `oauth secret set` (cifradas con su clave).',
        'Revertir: `--rollback` (desactiva) o `--rollback --purge`. Las cuentas vinculadas y los tokens no se tocan.',
    ] },
];

const en: Block[] = [
    { t: 'p', text: 'An OAuth provider (Google, Microsoft, Zoom or Slack, or your own) is an **extension**: it declares `oauthProviders` in its manifest and the instance core runs the flow. Other extensions use it through a dependency and **never see tokens**.' },
    { t: 'h2', id: 'model', text: 'Model' },
    { t: 'ul', items: [
        '**Core** (`/api/oauth/[provider]/start|callback|reconnect|unlink`): PKCE S256, single-use opaque `state`, OIDC `id_token` verification through JWKS, `iss` check (RFC 9207), sanitised `returnTo`, refresh with locking and rotation, RFC 7009 revocation on unlink. The Google aliases (`/api/auth/google`, `/api/auth/callback/google`) use the same flow.',
        '**Registry**: providers come from the installed manifests. With no extension, Google keeps working with the `GOOGLE_*` variables only when every endpoint is an official Google host.',
        '**Credentials**: the client secret and shared credentials are stored encrypted (AES-256-GCM v3) in the instance table `OAuthProviderConfig`, pinned to the approved hosts. If a host changes, the provider becomes `needs_reapproval`.',
        '**Broker**: the backend calls the instance (`/api/internal/host/oauth`) presenting the `executionGrant` the instance itself signed (see "Execution grants") and exposes `services.oauth` and `ctx.libs.<provider>.<action>`. Scope groups and shared access are derived by the INSTANCE from the grant. Permissions: `OAUTH_ACCOUNT:<provider>:<group>` and `OAUTH_SHARED:<provider>`.',
        '**Principals**: `user` (the user account), `organizer` (shared account) and `service` (service account; the core signs the JWT).',
    ] },
    { t: 'h2', id: 'write', text: 'Writing an OAuth provider as an extension' },
    { t: 'ol', items: [
        'Declare `oauthProviders` with https endpoints, port 443, public DNS and `allowedHosts` (anti-SSRF rule).',
        'Catalogue the `scopes` with `group`, es/en text and `risk`.',
        'Declare `actions` (method, path with parameters, required scopes, `fixedQuery`, `bodyFrom`, `upload`, `write`). Nothing undeclared can be called.',
        'Set `requires.capabilities` to `oauth.provider.v1` and `requires.clientApi` to 5 (with v2 features: `oauth.provider.v2` and clientApi 9).',
        'Publish; the administrator enters the client id and secret in the console (`/admin/extensions`, or `oauth secret set` in the admin CLI) and approves the provider hosts.',
        'Shortcut: `npm run new:oauth-provider -- <id>` generates the skeleton, the tests and the flow test (see "Template and generator").',
    ] },
    { t: 'code', lang: 'json', title: 'Provider in the manifest', code: manifestEx },
    { t: 'h2', id: 'dependencies', text: 'Dependencies between extensions' },
    { t: 'p', text: '`requires.extensions` accepts semver ranges (`^`, `~`, comparators and `*`). Installing an extension installs or proposes its dependencies; if a dependency is paused or uninstalled, the dependents are **paused** (not deleted) and resume when it returns. Cycles are rejected on publish. Capability: `ext.dependencies.v1` (clientApi 3).' },
    { t: 'code', lang: 'json', title: 'Extension that uses GoogleLib', code: dependentEx },
    { t: 'h2', id: 'routes', text: 'Extension routes and pages: authentication modes' },
    { t: 'p', text: '`backendRoutes` are served at `/api/ext/<id>/...` and public pages at `/p/**`. Each route declares `auth`:' },
    { t: 'table', head: ['Mode', 'Who can call', 'Detail'], rows: [
        ['`session`', 'Signed-in user', 'Default. Honours `minLevel`.'],
        ['`admin`', 'Administrator', 'Optional `minLevel` and `stepUp` (recent MFA). Pages check it at `/api/expansions/page-access`.'],
        ['`signature`', 'Shared backend', 'Direct Ed25519-signed calls to the instance only; the edge never signs `signature`.'],
        ['`hmac`', 'External system', 'HMAC with a domain secret (never global), constant-time comparison and anti-replay.'],
        ['`none`', 'Anyone', 'Needs the `PUBLIC_ROUTE` permission explicitly approved by the administrator (`approvedPermissions`). `auth: none` pages only under `/p/**` with a strict CSP.'],
    ] },
    { t: 'code', lang: 'json', title: 'backendRoutes', code: routeEx },
    { t: 'p', text: 'Capabilities: `ext.routes.v1`, `ext.routes.auth.v1`, `ext.pages.auth.v1` (clientApi 4). The instance edge signs the origin, level, user and IP inside the URL; the backend verifies them.' },
    { t: 'h2', id: 'security', text: 'Security: STRIDE threat model' },
    { t: 'table', head: ['Threat', 'Risk', 'Mitigation'], rows: [
        ['Spoofing (S)', 'Forged callback, fake broker or route call; impersonated backend', 'Single-use opaque `state`, PKCE S256, verified `iss` and `id_token`; the broker only accepts the `executionGrant` signed with THIS instance\'s key (jti, expiry, domain, extension, user); per-route HMAC with a domain secret; provider registry over https to a fixed URL with a strict schema, and admin approval for non-built-in providers.'],
        ['Tampering (T)', 'Changing endpoints, scopes or parameters', 'Endpoints pinned to approved hosts (`needs_reapproval`); actions validated against the manifest; `grantedGroups` signed by the backend.'],
        ['Repudiation (R)', 'Denying a link or a credential change', '`oauth.*` audit with provider and credential name, never values.'],
        ['Information disclosure (I)', 'Token or secret leak', 'Tokens encrypted at rest; tokens never reach extensions (the executor strips `context.auth`); `no-store` responses; the shared backend stores no provider secrets.'],
        ['Denial of service (D)', 'Refresh storms, SSRF, huge responses', 'Refresh lock (advisory lock + dedupe), `providerFetch` without redirects, public DNS, size and time caps.'],
        ['Elevation of privilege (E)', 'Extension reaching other accounts', 'Per-group permissions; shared only with `OAUTH_SHARED`; `PUBLIC_ROUTE` needs approval; `admin` routes with level and recent MFA.'],
    ] },
    { t: 'h2', id: 'domain-key', text: 'Requirement: the instance domain key' },
    { t: 'p', text: 'GoogleLib, bridged AI, host services and extension routes (`ext.grants.v1`, `oauth.*`, `ext.routes*`) **only work if the instance signs its requests** with its `BLOOMX_DOMAIN_PRIVATE_KEY`. An instance without a key stays in legacy mode and receives exactly the extension versions it always had (google-sync, meet, calendar and drive 1.x, with tokens via `context.auth`): it announces `clientApi` 3 and only the capabilities that work unsigned. Once the key is registered it moves to the new versions by itself, with nothing else to do.' },
    { t: 'ol', items: [
        'Generate the pair on your machine: `node scripts/gen-domain-keypair.mjs` (the private key is never generated in or sent through the browser).',
        'Store the private key as the secret environment variable `BLOOMX_DOMAIN_PRIVATE_KEY` of the instance and redeploy.',
        'Register the public key with the backend: `bloomx-admin security keys register` (manager session, level 4 with re-authentication), the `/admin/register` page or `POST /api/manager/domain-key`.',
        'Check with `bloomx-admin security signing` (`signed: true`): the notice in the Extensions, AI and Linked accounts panels disappears and the extensions can be updated.',
    ] },
    { t: 'table', head: ['Capability', 'Without a key', 'Reason'], rows: [
        ['`ext.grants.v1`', 'Not announced', 'The instance issues the `executionGrant` with its key.'],
        ['`oauth.provider.v1`, `oauth.broker.v1`', 'Not announced', 'The backend calls the broker with the grant; GoogleLib requires both.'],
        ['`ext.routes.v1`, `ext.routes.auth.v1`', 'Not announced', 'The edge signs `_bx_src`, level and IP in the URL.'],
        ['`oauth.provider.v2`', 'Not announced', 'MicrosoftLib, ZoomLib and SlackLib: the same signed broker plus the flow features only this core knows.'],
        ['`oauth.provider.v3`', 'Not announced', 'DiscordLib 1.1.0: bot credential and dispatch routes, on the same signed broker.'],
        ['`ext.dependencies.v1`', 'Announced', 'Backend logic independent of signing.'],
        ['`ai.*`, `services.host.v1`, `lifecycle.events.v1`, `settings.schema.v1`, UI', 'Announced', 'The deployed version already announced them; without a key they degrade (legacy path) instead of breaking. Changing them would alter the versions those instances get today.'],
    ] },
    { t: 'h2', id: 'grants', text: 'Execution grants (no global backend key)' },
    { t: 'p', text: 'The shared backend holds no key of its own and signs nothing. When an instance asks it to run an extension, hook or route, it attaches an `executionGrant`: an Ed25519 message signed with the instance\'s domain key (`BLOOMX_DOMAIN_PRIVATE_KEY`, the same one that already signs its requests). It carries the domain (`iss`/`aud`), extension and version, user (`sub`, null on public routes), the closed list of permissions for that execution, `jti`, `iat/exp` (120 s by default, `BLOOMX_GRANT_TTL_SECONDS`), a nonce and a use cap (`BLOOMX_GRANT_MAX_USES`).' },
    { t: 'ul', items: [
        '**The backend only forwards it**: it checks the grant matches the execution (the request\'s authenticated domain, extension, version, user, not expired) and presents it as is to `/api/internal/host/*`. The sandbox never sees it.',
        '**The instance verifies it on its own**, with the public key derived from its private key and no network: signature, `exp`, `aud`, body extension and user, service within the permissions and a per-`jti` use cap (the same execution makes N calls until `exp`). An extension cannot widen permissions or change user or domain because that would break the signature.',
        '**Versioning**: capability `ext.grants.v1` (clientApi 6). If the instance announces it and there is no valid grant, the backend offers NO host services (it never falls back to a global key); a malformed grant, or one for another domain, extension, version or user, is rejected with `INVALID_GRANT`.',
        '**Deprecated legacy**: old instances and backends that use the backend signature (`BACKEND_SIGNING_PRIVATE_KEY`, `BLOOMX_BACKEND_PUBLIC_KEY`, `/.well-known/bloomx-backend-key.json`) keep working during the transition; the instance warns in the log and in `/admin`. To switch it off: `BLOOMX_ACCEPT_BACKEND_SIGNATURE=false`. It will be removed in a future version.',
        '**Credential migration**: no automatic delivery. `migrate-googlelib` only reports credential names; store them on each instance with `oauth secret set`.',
    ] },
    { t: 'h2', id: 'hardening', text: 'Additional security rules' },
    { t: 'ul', items: [
        '**Tokens are a permission**: `context.auth` and `getToken()` only reach extensions whose manifest declares `OAUTH_READ` or a closed list of old versions (google-meet, calendar, google-drive, google-sync, zoom and hubspot, up to their last legacy version). Any other extension does not receive them. This is **deprecated**: use `OAUTH_ACCOUNT:*`.',
        '**Reserved ids**: `google`, `microsoft`, `zoom`, `slack`, `github` and similar can only be registered by their official extension (`core-googlelib`, `core-microsoftlib`, `core-zoomlib`, `core-slacklib`...); not even an official one can register another one\'s id. Checked on publish and again on the instance.',
        '**Action paths**: a path parameter can never be `.` or `..` and the final path after URL normalisation must be exactly the one built; an id with `%2e%2e`, `/` or `?` never leaves the server.',
        '**Per-action limits**: per-minute quota per user/extension/provider (120 reads, 30 writes) and, when the action declares it, `quotaPerHour` (a hard hourly cap set by the manifest, not by the extension). `allowedFromSetting` restricts a parameter to a list the admin sets (e.g. Slack channels).',
        '**Accounts are bound to their provider**: each account stores the hash of the endpoints of the provider that issued it; if another provider used the same id, its tokens are neither sent nor refreshed.',
        '**Approval of non-built-in providers**: they stay in `pending_approval` until an administrator (level 3 + step-up) approves their hosts (`POST /api/admin/oauth/providers/<id>/approve` or `oauth approve`). Sign-in only works with the official Google and requires an explicit `email_verified`.',
        '**Approvals on install/update**: each public route (`PUBLIC_ROUTE:<METHOD> <path>` or `PUBLIC_ROUTE:PAGE <path>`), `OAUTH_SHARED:*` and `OAUTH_ACCOUNT:*` of high-risk groups (gmail, drive...) are approved one by one; a new version that adds one stays pending.',
        '**Shared accounts**: the organizer and the service account only grant the scopes of a fixed list (Google: calendar and Meet).',
        '**Transport**: the provider connection pins the validated IP (no DNS-rebinding window) and treats 6to4, NAT64 and IPv4-compatible IPv6 as private. `NEXT_PUBLIC_BACKEND_URL` must be https in production and is FIXED per instance: the provider registry follows no redirects, is validated by a strict schema, and non-built-in providers require administrator approval. There is no global backend key.',
        '**Patterns**: action and route `pattern`s are checked against ReDoS on publish and run with error handling.',
        '**HMAC**: `timestampHeader` is mandatory unless `allowReplay: true`; without a timestamp the replay detector is per process and not a strong defence on serverless.',
        '**GET with side effects**: a `session`/`admin` route with `sideEffects: true` rejects `Sec-Fetch-Site: cross-site` requests.',
        '**`admin` pages on the server**: without the level the browser does not receive those pages\' component tree and the actions they call (and their handler) answer 403. The initial `state` is only hidden when the extension keeps no other mounts with a component: do not put sensitive data in `state`.',
        '**Without the `OAuthFlow` table in production** the flow fails closed instead of degrading to memory.',
    ] },
    { t: 'h2', id: 'compliance', text: 'Compliance (verified by code and tests)' },
    { t: 'callout', kind: 'warn', text: 'Mapping done by reading the code and running the tests; it is not a certification. Tests use a local fake OAuth server; **it has not been tested against real Google** (needs credentials).' },
    { t: 'table', head: ['Reference', 'Control', 'Status and verification'], rows: [
        ['RFC 6749', 'Code flow, `state`, refresh', 'MET: flow tests, single-use state and rotation.'],
        ['RFC 7636', 'PKCE', 'MET: S256 only; verifier test.'],
        ['RFC 9700 (BCP)', 'No implicit, exact redirect, refresh rotation', 'MET: fixed redirect per provider, `invalid_grant` marks reconnect.'],
        ['RFC 9207', '`iss` parameter', 'MET: checked when the provider sends it.'],
        ['RFC 8252', 'Native apps', 'N/A: browser web flow; no custom schemes.'],
        ['RFC 7009', 'Revocation', 'MET: on unlink, when the provider offers it.'],
        ['OIDC Core', '`id_token`, nonce, JWKS', 'MET: signature, `iss`, `aud`, `exp` and JWKS cache with grace.'],
        ['OWASP ASVS V3/V4/V8/V13', 'Session, access control, data, API', 'PARTIAL: tests per security point; no external audit.'],
        ['OWASP API Top 10', 'BOLA, broken auth, SSRF, resources', 'MET on the new routes: input validation, limits and SSRF tested.'],
        ['NIST SP 800-53 / 800-63B', 'IA-5, SC-8, SC-12, SC-28', 'PARTIAL: AES-256-GCM and TLS; no KMS (see [CIS / NIST / ISO mapping](/docs/compliance)).'],
        ['ISO/IEC 27001 A.8.5, A.8.24', 'Secure authentication and cryptography', 'PARTIAL: as above.'],
    ] },
    { t: 'h2', id: 'providers', text: 'Included providers: MicrosoftLib, ZoomLib and SlackLib' },
    { t: 'p', text: 'All three follow the GoogleLib pattern: a manifest with `oauthProviders`, a status-only `server.js` (no network or secrets) and dependent extensions with `OAUTH_ACCOUNT:<provider>:<group>`. They require `oauth.provider.v2` (clientApi 9) and a domain key on the instance. Tokens never reach an extension.' },
    { t: 'table', head: ['Provider (extension)', 'Flow and specifics', 'Scopes', 'Actions and consumers'], rows: [
        ['`microsoft` (`core-microsoftlib`)', 'Microsoft identity platform v2 OAuth2/OIDC, PKCE S256. Tenant `common`, `organizations`, `consumers` or a GUID in the `MICROSOFT_TENANT` setting (`{tenant}` variable). The id_token `iss` is `https://login.microsoftonline.com/{tid}/v2.0`: the signature is checked against the JWKS and compared with the token\'s own `tid` (with a pinned GUID tenant, only that tenant). Hosts: login.microsoftonline.com and graph.microsoft.com.', '17 in 7 groups (userinfo, calendar, meetings, contacts, mail, files, directory). High risk: Calendars.ReadWrite, Contacts.ReadWrite, Mail.*, Files.ReadWrite. Admin approval: mail, files and directory groups. Default: openid, profile, email, offline_access, User.Read, Calendars.ReadWrite, OnlineMeetings.ReadWrite.', '30 actions on Graph v1.0: profile, calendars and events (list/create/update/delete, view, availability), Teams meeting (`meetings.onlineMeetings.*`), contacts, mail (read and send), files and directory. Consumer: `microsoft-teams` (event location picker).'],
        ['`zoom` (`core-zoomlib`)', 'Per-user OAuth with PKCE and `client_secret_basic` (Basic header), revocation by access token and Server-to-Server mode (`account_credentials`) with its own S2S app (settings `ZOOM_ACCOUNT_ID`, `ZOOM_S2S_CLIENT_ID`, secret `ZOOM_S2S_CLIENT_SECRET`). Hosts: zoom.us and api.zoom.us.', '7 granular in 2 groups (meetings, userinfo): meeting:write/update/delete/read, meeting:read:list_meetings, user:read:user, user:read:email. The first five by default.', '6 actions: `meetings.create/update/delete/get/list` and `users.me.get`. Consumer: `zoom` 2.0.0 (conferencing contract unchanged). Old clients and instances without a key keep receiving `zoom` 1.4.1.'],
        ['`slack` (`core-slacklib`)', 'Slack OAuth v2 (`tokenFormat: slack-v2`): BOT and USER tokens stored as two independent accounts, user scopes prefixed `user:`, `{ok:false}` errors, optional rotation and revocation through `auth.revoke`. No PKCE (Slack does not use it): the secret is mandatory. Host: slack.com.', '9 in 3 groups (chat, channels, users): chat:write, chat:write.public, channels:read, groups:read, users:read, users:read.email and user:chat:write, user:channels:read, user:users:read. Default: chat:write, channels:read, users:read.', '7 actions: `chat.postMessage` (only to the channels in `SLACK_ALLOWED_CHANNELS`, hard cap of 120/hour), `conversations.list/listPrivate/info`, `users.list/info` and `auth.test`; none reads messages. Consumer: `slack-notify` (mail alerts with filters, no bodies by default).'],
    ] },
    { t: 'code', lang: 'json', title: 'MicrosoftLib (excerpt)', code: msEx },
    { t: 'code', lang: 'js', title: 'ZoomLib (excerpt) and use from zoom 2.0', code: zoomEx },
    { t: 'code', lang: 'js', title: 'SlackLib (excerpt) and use from slack-notify', code: slackEx },
    { t: 'h2', id: 'v3', text: 'v3 features (oauth.provider.v3): bot credential and dispatch routes' },
    { t: 'p', text: 'DiscordLib 1.1.0 adds, under the `oauth.provider.v3` capability (clientApi 12), only new fields: a provider **bot credential** (`botCredential`, a write-only token held only by the core), actions with `credential: "bot"` (the `Authorization: Bot` header is injected by the core and never returned), `moderation` (actions off unless the admin enables them), `guild` (restriction to allowed servers), `pathSettings` and routes with `dispatch` (after verifying an Ed25519 `hmac` signature the router delivers the event to the hooks of other extensions). Instances without the capability keep receiving the previous version. Details and examples in [DiscordLib: Discord bot](/docs/extension-tools/discordlib).' },
    { t: 'h2', id: 'v2', text: 'v2 features (oauth.provider.v2)' },
    { t: 'table', head: ['Need', 'Field', 'Used by'], rows: [
        ['Tenant or region in the URL', '`variables` (`{name}` in the path only; the value comes from a setting, checked by `pattern` and by a fixed core character set that cannot leave the segment)', 'MicrosoftLib'],
        ['OIDC issuer that depends on the token', '`issuer` with `{claim:tid}` (exact comparison after verifying the signature; the `iss` response parameter is also constrained)', 'MicrosoftLib'],
        ['Client with a Basic header', '`tokenAuth: "basic"` (neither id nor secret in the body)', 'ZoomLib'],
        ['Revoke by access token', '`revokeToken: "access"` (refreshed first if expired)', 'ZoomLib'],
        ['Server to server', '`serviceCredentials` + `principal: "service"` + `OAUTH_SHARED` permission (the core exchanges and caches the S2S token; `:admin` scopes are normalised)', 'ZoomLib'],
        ['Non-standard token response', '`tokenFormat: "slack-v2"`', 'SlackLib'],
        ['Query with `$`', '`queryName` on the parameter (`top` → `$top`)', 'MicrosoftLib'],
        ['Values the admin sets', '`allowedFromSetting` (empty list = nothing allowed; enforced by the core)', 'SlackLib'],
        ['Hard hourly cap', '`quotaPerHour` on the action', 'SlackLib'],
    ] },
    { t: 'h2', id: 'unlink', text: 'Unlinking and revocation, per provider' },
    { t: 'table', head: ['Provider', 'What the core does on unlink', 'What the user or admin should also do'], rows: [
        ['Google', 'Revokes the refresh token (RFC 7009) and deletes the rows.', 'Nothing.'],
        ['Microsoft', 'There is no standard revocation endpoint for applications: the core deletes the local tokens (result `not_supported`). `revokeSignInSessions` is not used because it would invalidate the user\'s sessions in ALL their applications.', 'The user can withdraw consent at myaccount.microsoft.com → Apps (personal accounts: account.live.com/consent/Manage); the tenant admin, in Entra ID → Enterprise applications → Permissions, or delete the application.'],
        ['Zoom', 'Revokes the access token with Basic (refreshing first if expired) and deletes the account; a Zoom failure does not prevent unlinking.', 'Nothing (the user can also remove the app in Zoom Marketplace → Manage → Added Apps).'],
        ['Slack', 'Revokes the user token with `auth.revoke`; the bot token only if no other user in the workspace holds a copy (result `shared`), so the others are not left without the bot. Deletes bot and user.', 'To remove the app from the workspace: Slack administration → Apps.'],
    ] },
    { t: 'h2', id: 'template', text: 'Template and generator' },
    { t: 'p', text: '`bloomx-extensions/_oauth-provider-template/` is a documented, tested example ("Acme"): a commented `manifest.src.mjs`, a status `server.js`, a step-by-step README and tests. Like `_template`, it starts with `_` and its JSON is called `manifest.template.json`: it is **not publishable** and the synchronisers, validation and version control ignore it. `npm run new:oauth-provider -- <id>` creates `<id>lib/` with the sample data replaced (hosts are left as `<id>-todo-replace.com` so they are not forgotten) and the flow test against a fake OAuth server. A reserved id needs `--core` and only works for its official extension.' },
    { t: 'code', lang: 'bash', title: 'Create a provider', code: generatorEx },
    { t: 'h2', id: 'real-credentials', text: 'Testing with real credentials' },
    { t: 'p', text: 'The automated tests use fake OAuth servers and the real manifests; **they have not been run against real Microsoft, Zoom or Slack** (credentials required). To check on an instance that has a domain key:' },
    { t: 'ol', items: [
        '**Microsoft**: register a web app in Entra ID with redirect `https://<instance>/api/oauth/microsoft/callback`, create a secret and grant the catalogue delegated permissions. Store `MICROSOFT_CLIENT_ID`, `MICROSOFT_TENANT` (`organizations` or your tenant GUID; `common` allows personal accounts, but Teams meetings need a work or school account) and the secret in the MicrosoftLib settings.',
        '**Zoom**: create a *General* app (user OAuth) with redirect `https://<instance>/api/oauth/zoom/callback` and the granular scopes; store `ZOOM_CLIENT_ID` and `ZOOM_CLIENT_SECRET`. For S2S create a separate *Server-to-Server OAuth* app and store `ZOOM_ACCOUNT_ID`, `ZOOM_S2S_CLIENT_ID`, `ZOOM_S2S_CLIENT_SECRET` and `ZOOM_HOST_EMAIL`.',
        '**Slack**: create the app at api.slack.com/apps with redirect `https://<instance>/api/oauth/slack/callback`, bot scopes `chat:write`, `channels:read`, `users:read`; store `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` and the channel ids in `SLACK_ALLOWED_CHANNELS`, and invite the bot to the channel (`/invite @app`).',
        'As an administrator, approve the provider hosts (`/admin/extensions` or `oauth approve <id>`) and store the secret (`oauth secret set`); as a user, link the account in Settings → Integrations or with `/api/oauth/<id>/start` and check Linked accounts at `/admin/accounts`.',
        'Test: create a Teams or Zoom meeting from an event\'s location picker, or enable `slack-notify` and press "Send test". Never share the secrets: they are stored encrypted on the instance and no extension sees them.',
    ] },
    { t: 'h2', id: 'migration', text: 'Migrating an instance' },
    { t: 'ol', items: [
        'Dry run: `node --experimental-strip-types scripts/migrate-googlelib.mjs` (backend).',
        'Apply: add `--apply`. It copies non-secret settings; the source extensions are untouched.',
        'Credentials: the script does NOT move secrets. Store them on each instance with `oauth secret set` (encrypted with its key).',
        'Roll back: `--rollback` (deactivates) or `--rollback --purge`. Linked accounts and tokens are untouched.',
    ] },
];

const page: DocPageContent = { es, en };
export default page;
