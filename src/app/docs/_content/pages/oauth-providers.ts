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

const routeEx = `"backendRoutes": [
  { "path": "/hook/:id", "method": "POST", "handler": "onHook", "auth": "hmac", "hmac": { "header": "X-Signature", "secretSetting": "HOOK_SECRET" } },
  { "path": "/status", "method": "GET", "handler": "status", "auth": "admin", "minLevel": 2, "stepUp": true }
]`;

const es: Block[] = [
    { t: 'p', text: 'Un proveedor OAuth (Google, y mañana Microsoft, Zoom o Slack) es una **extensión**: declara `oauthProviders` en su manifest y el núcleo de la instancia ejecuta el flujo. Las demás extensiones lo usan por dependencia y **nunca ven tokens**.' },
    { t: 'h2', id: 'model', text: 'Modelo' },
    { t: 'ul', items: [
        '**Núcleo** (`/api/oauth/[provider]/start|callback|reconnect|unlink`): PKCE S256, `state` opaco de un solo uso, verificación del `id_token` OIDC por JWKS, comprobación de `iss` (RFC 9207), `returnTo` saneado, refresh con bloqueo y rotación, revocación RFC 7009 al desvincular. Los alias de Google (`/api/auth/google`, `/api/auth/callback/google`) usan el mismo flujo.',
        '**Registro**: los proveedores salen de los manifests instalados. Si no hay extensión, Google sigue funcionando con las variables `GOOGLE_*` solo cuando todos los endpoints son hosts oficiales de Google.',
        '**Credenciales**: el client secret y las credenciales compartidas se guardan cifradas (AES-256-GCM v3) en la tabla de la instancia `OAuthProviderConfig`, ancladas a los hosts aprobados. Si cambia un host, el proveedor pasa a `needs_reapproval`.',
        '**Broker**: el backend llama a la instancia (`/api/internal/host/oauth`, firmado Ed25519) y expone `services.oauth` y `ctx.libs.<proveedor>.<acción>`. Los permisos son `OAUTH_ACCOUNT:<proveedor>:<grupo>` y `OAUTH_SHARED:<proveedor>`.',
        '**Principales**: `user` (cuenta del usuario), `organizer` (cuenta compartida) y `service` (cuenta de servicio; el JWT lo firma el núcleo).',
    ] },
    { t: 'h2', id: 'write', text: 'Escribir un proveedor OAuth como extensión' },
    { t: 'ol', items: [
        'Declara `oauthProviders` con endpoints https, puerto 443, DNS público y `allowedHosts` (regla anti-SSRF).',
        'Cataloga los `scopes` con `group`, texto es/en y `risk`.',
        'Declara `actions` (método, ruta con parámetros, scopes requeridos, `fixedQuery`, `bodyFrom`, `upload`, `write`). Nada que no esté declarado se puede llamar.',
        'Pon `requires.capabilities` con `oauth.provider.v1` y `requires.clientApi` 5.',
        'Publica; el administrador introduce el client id y el secreto en la consola (`/admin/extensions`, o `oauth secret set` en la CLI de administración).',
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
        ['Suplantación (S)', 'Callback forjado, llamada falsa al broker o a una ruta', '`state` opaco de un solo uso, PKCE S256, `iss` e `id_token` verificados; broker firmado Ed25519 por dominio; HMAC por ruta con secreto de dominio.'],
        ['Manipulación (T)', 'Cambiar endpoints, scopes o parámetros', 'Endpoints anclados a hosts aprobados (`needs_reapproval`); acciones validadas contra el manifest; `grantedGroups` firmado por el backend.'],
        ['Repudio (R)', 'Negar una vinculación o un cambio de credencial', 'Auditoría `oauth.*` con proveedor y nombre de credencial, nunca valores.'],
        ['Divulgación (I)', 'Fuga de tokens o secretos', 'Tokens cifrados en reposo; los tokens nunca llegan a las extensiones (el ejecutor retira `context.auth`); respuestas `no-store`; el backend compartido no guarda secretos del proveedor.'],
        ['Denegación (D)', 'Agotar refresh, SSRF o respuestas enormes', 'Bloqueo de refresh (advisory lock + dedupe), `providerFetch` sin redirecciones, DNS público, tope de tamaño y de tiempo.'],
        ['Elevación (E)', 'Extensión que accede a cuentas ajenas', 'Permisos por grupo; compartido solo con `OAUTH_SHARED`; `PUBLIC_ROUTE` requiere aprobación; rutas `admin` con nivel y MFA reciente.'],
    ] },
    { t: 'h2', id: 'hardening', text: 'Reglas de seguridad adicionales' },
    { t: 'ul', items: [
        '**Tokens como permiso**: `context.auth` y `getToken()` solo llegan a extensiones cuyo manifest declara `OAUTH_READ` o a una lista cerrada de versiones antiguas (google-meet, calendar, google-drive, google-sync, zoom y hubspot, hasta su última versión legada). Cualquier otra extensión no los recibe. Está **deprecado**: usa `OAUTH_ACCOUNT:*`.',
        '**Ids reservados**: `google`, `microsoft`, `zoom`, `slack`, `github` y similares solo los registra su extensión oficial (`core-googlelib`...). Se valida al publicar y de nuevo en la instancia.',
        '**Cuenta atada a su proveedor**: cada cuenta guarda el hash de los endpoints del proveedor que la emitió; si otro proveedor usara el mismo id, sus tokens no se envían ni se refrescan.',
        '**Aprobación de proveedores no integrados**: quedan en `pending_approval` hasta que un administrador (nivel 3 + step-up) aprueba sus hosts (`POST /api/admin/oauth/providers/<id>/approve` o `oauth approve`). El inicio de sesión solo funciona con el Google oficial y exige `email_verified` explícito.',
        '**Aprobaciones al instalar/actualizar**: cada ruta pública (`PUBLIC_ROUTE:<MÉTODO> <ruta>` o `PUBLIC_ROUTE:PAGE <ruta>`), `OAUTH_SHARED:*` y `OAUTH_ACCOUNT:*` de grupos de riesgo alto (gmail, drive...) se aprueban una a una; una versión nueva que añade alguna queda pendiente.',
        '**Cuentas compartidas**: el organizador y la cuenta de servicio solo conceden los scopes de una lista fija (Google: calendario y Meet).',
        '**Transporte**: la conexión al proveedor fija la IP validada (sin ventana de DNS rebinding) e incluye 6to4, NAT64 e IPv6 compatible como direcciones privadas. `NEXT_PUBLIC_BACKEND_URL` debe ser https en producción; con `BLOOMX_BACKEND_PUBLIC_KEY` el registro de proveedores exige la firma del backend (`X-BloomX-Config-Sig`).',
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
    { t: 'h2', id: 'future', text: 'Proveedores futuros y plantilla' },
    { t: 'p', text: 'MicrosoftLib, ZoomLib y SlackLib seguirán el mismo patrón que GoogleLib: un manifest con `oauthProviders`, sin código de flujo, y extensiones dependientes con `OAUTH_ACCOUNT:<proveedor>:<grupo>`. Aún **no existen**. La plantilla `oauth-provider-template` (manifest mínimo, `server.js` de estado y prueba con el servidor OAuth falso) es el punto de partida previsto; tampoco existe todavía.' },
    { t: 'h2', id: 'migration', text: 'Migrar una instancia' },
    { t: 'ol', items: [
        'Simulacro: `node --experimental-strip-types scripts/migrate-googlelib.mjs` (backend).',
        'Aplicar: añade `--apply`. Copia los ajustes no secretos; las extensiones de origen no se tocan.',
        'Credenciales: `--apply --handoff` con la puerta abierta en la instancia durante la migración; o `oauth secret set` en cada instancia.',
        'Revertir: `--rollback` (desactiva) o `--rollback --purge`. Las cuentas vinculadas y los tokens no se tocan.',
    ] },
];

const en: Block[] = [
    { t: 'p', text: 'An OAuth provider (Google, and tomorrow Microsoft, Zoom or Slack) is an **extension**: it declares `oauthProviders` in its manifest and the instance core runs the flow. Other extensions use it through a dependency and **never see tokens**.' },
    { t: 'h2', id: 'model', text: 'Model' },
    { t: 'ul', items: [
        '**Core** (`/api/oauth/[provider]/start|callback|reconnect|unlink`): PKCE S256, single-use opaque `state`, OIDC `id_token` verification through JWKS, `iss` check (RFC 9207), sanitised `returnTo`, refresh with locking and rotation, RFC 7009 revocation on unlink. The Google aliases (`/api/auth/google`, `/api/auth/callback/google`) use the same flow.',
        '**Registry**: providers come from the installed manifests. With no extension, Google keeps working with the `GOOGLE_*` variables only when every endpoint is an official Google host.',
        '**Credentials**: the client secret and shared credentials are stored encrypted (AES-256-GCM v3) in the instance table `OAuthProviderConfig`, pinned to the approved hosts. If a host changes, the provider becomes `needs_reapproval`.',
        '**Broker**: the backend calls the instance (`/api/internal/host/oauth`, Ed25519-signed) and exposes `services.oauth` and `ctx.libs.<provider>.<action>`. Permissions are `OAUTH_ACCOUNT:<provider>:<group>` and `OAUTH_SHARED:<provider>`.',
        '**Principals**: `user` (the user account), `organizer` (shared account) and `service` (service account; the core signs the JWT).',
    ] },
    { t: 'h2', id: 'write', text: 'Writing an OAuth provider as an extension' },
    { t: 'ol', items: [
        'Declare `oauthProviders` with https endpoints, port 443, public DNS and `allowedHosts` (anti-SSRF rule).',
        'Catalogue the `scopes` with `group`, es/en text and `risk`.',
        'Declare `actions` (method, path with parameters, required scopes, `fixedQuery`, `bodyFrom`, `upload`, `write`). Nothing undeclared can be called.',
        'Set `requires.capabilities` to `oauth.provider.v1` and `requires.clientApi` to 5.',
        'Publish; the administrator enters the client id and secret in the console (`/admin/extensions`, or `oauth secret set` in the admin CLI).',
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
        ['Spoofing (S)', 'Forged callback, fake broker or route call', 'Single-use opaque `state`, PKCE S256, verified `iss` and `id_token`; per-domain Ed25519-signed broker; per-route HMAC with a domain secret.'],
        ['Tampering (T)', 'Changing endpoints, scopes or parameters', 'Endpoints pinned to approved hosts (`needs_reapproval`); actions validated against the manifest; `grantedGroups` signed by the backend.'],
        ['Repudiation (R)', 'Denying a link or a credential change', '`oauth.*` audit with provider and credential name, never values.'],
        ['Information disclosure (I)', 'Token or secret leak', 'Tokens encrypted at rest; tokens never reach extensions (the executor strips `context.auth`); `no-store` responses; the shared backend stores no provider secrets.'],
        ['Denial of service (D)', 'Refresh storms, SSRF, huge responses', 'Refresh lock (advisory lock + dedupe), `providerFetch` without redirects, public DNS, size and time caps.'],
        ['Elevation of privilege (E)', 'Extension reaching other accounts', 'Per-group permissions; shared only with `OAUTH_SHARED`; `PUBLIC_ROUTE` needs approval; `admin` routes with level and recent MFA.'],
    ] },
    { t: 'h2', id: 'hardening', text: 'Additional security rules' },
    { t: 'ul', items: [
        '**Tokens are a permission**: `context.auth` and `getToken()` only reach extensions whose manifest declares `OAUTH_READ` or a closed list of old versions (google-meet, calendar, google-drive, google-sync, zoom and hubspot, up to their last legacy version). Any other extension does not receive them. This is **deprecated**: use `OAUTH_ACCOUNT:*`.',
        '**Reserved ids**: `google`, `microsoft`, `zoom`, `slack`, `github` and similar can only be registered by their official extension (`core-googlelib`...). Checked on publish and again on the instance.',
        '**Accounts are bound to their provider**: each account stores the hash of the endpoints of the provider that issued it; if another provider used the same id, its tokens are neither sent nor refreshed.',
        '**Approval of non-built-in providers**: they stay in `pending_approval` until an administrator (level 3 + step-up) approves their hosts (`POST /api/admin/oauth/providers/<id>/approve` or `oauth approve`). Sign-in only works with the official Google and requires an explicit `email_verified`.',
        '**Approvals on install/update**: each public route (`PUBLIC_ROUTE:<METHOD> <path>` or `PUBLIC_ROUTE:PAGE <path>`), `OAUTH_SHARED:*` and `OAUTH_ACCOUNT:*` of high-risk groups (gmail, drive...) are approved one by one; a new version that adds one stays pending.',
        '**Shared accounts**: the organizer and the service account only grant the scopes of a fixed list (Google: calendar and Meet).',
        '**Transport**: the provider connection pins the validated IP (no DNS-rebinding window) and treats 6to4, NAT64 and IPv4-compatible IPv6 as private. `NEXT_PUBLIC_BACKEND_URL` must be https in production; with `BLOOMX_BACKEND_PUBLIC_KEY` the provider registry requires the backend signature (`X-BloomX-Config-Sig`).',
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
    { t: 'h2', id: 'future', text: 'Future providers and template' },
    { t: 'p', text: 'MicrosoftLib, ZoomLib and SlackLib will follow the GoogleLib pattern: a manifest with `oauthProviders`, no flow code, and dependent extensions with `OAUTH_ACCOUNT:<provider>:<group>`. They do **not exist** yet. The `oauth-provider-template` (minimal manifest, status `server.js` and a test against the fake OAuth server) is the planned starting point; it does not exist yet either.' },
    { t: 'h2', id: 'migration', text: 'Migrating an instance' },
    { t: 'ol', items: [
        'Dry run: `node --experimental-strip-types scripts/migrate-googlelib.mjs` (backend).',
        'Apply: add `--apply`. It copies non-secret settings; the source extensions are untouched.',
        'Credentials: `--apply --handoff` with the gate open on the instance during the migration; or `oauth secret set` on each instance.',
        'Roll back: `--rollback` (deactivates) or `--rollback --purge`. Linked accounts and tokens are untouched.',
    ] },
];

const page: DocPageContent = { es, en };
export default page;
