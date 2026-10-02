import type { Block, DocPageContent } from '../types';

const nodeSign = `// sign-request.mjs  (Node >= 18, solo node:crypto)
import crypto from 'node:crypto';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL;            // https://backend.example.com
const DOMAIN = 'mail.mi-empresa.com';                            // el dominio (tenant) registrado
const PRIVATE_KEY = crypto.createPrivateKey(
    (process.env.BLOOMX_DOMAIN_PRIVATE_KEY ?? '').replace(/\\\\n/g, '\\n'), // PEM PKCS8 en una linea
);

export async function signedFetch(path, { method = 'POST', body, userId = '', userEmail = '', callback = '' } = {}) {
    const raw = body === undefined ? '' : JSON.stringify(body);   // los MISMOS bytes que se envian
    const url = new URL(path, BACKEND);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = crypto.randomBytes(18).toString('base64url');   // 24 caracteres: cumple ^[A-Za-z0-9_-]{16,64}$

    const canonical = [
        'BLOOMX-SIG-V1',
        method.toUpperCase(),
        url.pathname + url.search,                                 // ruta + query tal como la ve el backend
        crypto.createHash('sha256').update(raw).digest('hex'),     // sha256 del cuerpo crudo (vacio en GET)
        DOMAIN.toLowerCase(),
        timestamp,
        nonce,
        userId,
        userEmail,
        callback,                                                  // https://<tu-dominio> o ''
    ].join('\\n');

    const signature = crypto.sign(null, Buffer.from(canonical, 'utf8'), PRIVATE_KEY).toString('base64url');

    return fetch(url, {
        method,
        headers: {
            'content-type': 'application/json',
            'X-BloomX-Domain': DOMAIN,
            'X-BloomX-Signature': signature,
            'X-BloomX-Timestamp': timestamp,
            'X-BloomX-Nonce': nonce,
            'X-User-Id': userId,
            'X-User-Email': userEmail,
            ...(callback ? { 'X-BloomX-Callback': callback } : {}),
        },
        body: raw || undefined,
    });
}

// Ejemplo: ejecutar una acción de una extensión instalada
const res = await signedFetch('/api/extension/execute', {
    userId: 'user_123',
    userEmail: 'ana@mi-empresa.com',
    body: { extensionId: 'core-hello', action: 'hello', params: { name: 'Ana' } },
});
console.log(res.status, await res.json());`;

const nodeSignEn = nodeSign
    .replace('// sign-request.mjs  (Node >= 18, solo node:crypto)', '// sign-request.mjs  (Node >= 18, node:crypto only)')
    .replace('// el dominio (tenant) registrado', '// the registered domain (tenant)')
    .replace('// PEM PKCS8 en una linea', '// single-line PKCS8 PEM')
    .replace('// los MISMOS bytes que se envian', '// the SAME bytes that are sent')
    .replace('// 24 caracteres: cumple', '// 24 characters: matches')
    .replace('// ruta + query tal como la ve el backend', '// path + query as the backend sees it')
    .replace('// sha256 del cuerpo crudo (vacio en GET)', '// sha256 of the raw body (empty for GET)')
    .replace("// https://<tu-dominio> o ''", "// https://<your-domain> or ''")
    .replace('// Ejemplo: ejecutar una acción de una extensión instalada', '// Example: run an action of an installed extension');

const verifyNode = `// Lo que hace el backend (resumen de src/lib/domain-auth.ts)
// 1. domain = X-BloomX-Domain (obligatorio si el dominio tiene clave)
// 2. |now - timestamp| <= 120 s y nonce ^[A-Za-z0-9_-]{16,64}$
// 3. canonical = mismo string de arriba, con el cuerpo crudo recibido
// 4. crypto.verify(null, canonical, publicKeyDelDominio, base64url(signature))  // firma de 64 bytes
// 5. el nonce (domain:nonce) se consume UNA vez, solo si la firma es valida`;

const curlRegister = `# 1) Alta del dominio: el backend envía un OTP de 6 dígitos (válido 15 min) al correo
curl -sS -X POST "$BACKEND/api/auth/register-domain" \\
  -H 'content-type: application/json' \\
  -d '{"email":"admin@mi-empresa.com","domain":"mail.mi-empresa.com","password":"<contraseña>","resendApiKey":"<tu-clave-de-resend>"}'
# => {"success":true,"message":"OTP sent to email"}

# 2) Verificar y, opcionalmente, registrar la clave pública Ed25519 de esta instancia
curl -sS -X POST "$BACKEND/api/auth/verify-domain" \\
  -H 'content-type: application/json' \\
  -d '{"email":"admin@mi-empresa.com","otp":"123456","signingPublicKey":"<clave-publica-base64url>"}'
# => {"success":true,"manager":{"id":"...","email":"...","role":"OWNER"},"domain":{"id":"...","name":"mail.mi-empresa.com"}}`;

const curlRegisterEn = curlRegister
    .replace('# 1) Alta del dominio: el backend envía un OTP de 6 dígitos (válido 15 min) al correo', '# 1) Register the domain: the backend emails a 6-digit OTP (valid 15 min)')
    .replace('"password":"<contraseña>"', '"password":"<password>"')
    .replace('"resendApiKey":"<tu-clave-de-resend>"', '"resendApiKey":"<your-resend-key>"')
    .replace('# 2) Verificar y, opcionalmente, registrar la clave pública Ed25519 de esta instancia', '# 2) Verify and, optionally, register this instance\'s Ed25519 public key')
    .replace('<clave-publica-base64url>', '<public-key-base64url>');

const curlConfig = `# Público, sin autenticación
curl -sS "$BACKEND/api/config?domain=mail.mi-empresa.com"
# => {"config":{"id":"...","name":"...","displayName":"...","theme":{...},"logo":"..."},
#     "extensions":[{"id":"core-dlp","name":"...","template":{...},"settings":{}}]}

# Clave pública del backend (solo si tiene BACKEND_SIGNING_PRIVATE_KEY; si no, 404 {"available":false})
curl -sS "$BACKEND/.well-known/bloomx-backend-key.json"
# => {"version":1,"alg":"Ed25519","kid":"...","publicKey":"...","jwk":{"kty":"OKP","crv":"Ed25519","x":"...","kid":"..."}}`;

const curlManager = `# Con la sesión de manager (cookie auth_session) dueño del dominio: registrar o ROTAR la clave pública
curl -sS -X POST "$BACKEND/api/manager/domain-key" \\
  -H 'content-type: application/json' -b 'auth_session=<cookie>' \\
  -d '{"domainId":"<id>","signingPublicKey":"<clave-publica-base64url>"}'
# => {"success":true,"registered":true,"fingerprint":"<16 hex>"}`;

const curlManagerEn = curlManager
    .replace('# Con la sesión de manager (cookie auth_session) dueño del dominio: registrar o ROTAR la clave pública', '# With the domain owner\'s manager session (auth_session cookie): register or ROTATE the public key')
    .replace('<clave-publica-base64url>', '<public-key-base64url>');

const sqlKey = `ALTER TABLE "Domain" ADD COLUMN IF NOT EXISTS "signingPublicKey" TEXT;`;

const rows = (es: boolean): string[][] => [
    ['`GET /api/config?domain=`', es ? 'Pública' : 'Public', es ? 'Marca (`theme`, `logo`, `displayName`) y extensiones habilitadas del dominio. Dominio desconocido: 200 con la config por defecto. `TOP_DOMAIN`, si existe, prevalece sobre `?domain`.' : 'Brand (`theme`, `logo`, `displayName`) and enabled extensions for the domain. Unknown domain: 200 with the default config. `TOP_DOMAIN`, if set, overrides `?domain`.'],
    ['`POST /api/auth/register`', es ? 'Pública (403 si `ALLOW_OPEN_REGISTRATION=false`)' : 'Public (403 if `ALLOW_OPEN_REGISTRATION=false`)', es ? '`{email, password}` (8–256). 5/h por IP. 400 / 429 / 403.' : '`{email, password}` (8–256). 5/h per IP. 400 / 429 / 403.'],
    ['`POST /api/auth/register-domain`', es ? 'Pública' : 'Public', es ? '`{email, domain, password, resendApiKey}`. 5/h por IP. **409** si email o dominio ya existen.' : '`{email, domain, password, resendApiKey}`. 5/h per IP. **409** if email or domain already exist.'],
    ['`POST /api/auth/verify-domain`', es ? 'Pública' : 'Public', es ? '`{email, otp, signingPublicKey?}`. 30/15 min por IP y 5 intentos por email. 400 / **404** / **409** / 429.' : '`{email, otp, signingPublicKey?}`. 30/15 min per IP and 5 attempts per email. 400 / **404** / **409** / 429.'],
    ['`POST /api/auth/login` · `GET /api/auth/me` · `POST /api/auth/logout`', es ? 'Cookie de manager (Lucia)' : 'Manager cookie (Lucia)', es ? 'Login: 200/15 min por IP y 10/15 min por cuenta; 401 `Invalid credentials`. `me` siempre devuelve 200 (`{user:null}` sin sesión).' : 'Login: 200/15 min per IP and 10/15 min per account; 401 `Invalid credentials`. `me` always returns 200 (`{user:null}` without a session).'],
    ['`GET/POST /api/manager/domain-key`', es ? 'Manager dueño del dominio' : 'Manager who owns the domain', es ? 'Consulta (`{registered, fingerprint}`) o registra/rota la clave. 30/min. 401 / 403 / 400.' : 'Query (`{registered, fingerprint}`) or register/rotate the key. 30/min. 401 / 403 / 400.'],
    ['`POST /api/manager/extensions/install` · `uninstall`', es ? 'Manager dueño del dominio' : 'Domain-owner manager', es ? 'Instalar (402 `PAYMENT_REQUIRED` si es de pago sin transacción aprobada) y desinstalar (borra credenciales y revoca tokens OAuth, mejor esfuerzo).' : 'Install (402 `PAYMENT_REQUIRED` for paid extensions without an approved transaction) and uninstall (removes credentials, revokes OAuth tokens best-effort).'],
    ['`GET/PUT /api/admin/domain`', es ? 'Manager' : 'Manager', es ? 'Lee o guarda `displayName` (≤120), `logo` y `theme` (saneado; `landing` incluido). 400 si el tema es demasiado grande.' : 'Reads or saves `displayName` (≤120), `logo` and `theme` (sanitised; `landing` included). 400 if the theme is too large.'],
    ['`GET/PUT /api/extension/settings`', es ? 'Manager dueño' : 'Owner manager', es ? 'Credenciales por dominio: GET devuelve `{keys:[{name, configured}]}` (nunca valores); PUT `{domainId, extensionId, credentials}`. 60/min. **503** sin `DATA_ENCRYPTION_KEY` en producción.' : 'Per-domain credentials: GET returns `{keys:[{name, configured}]}` (never values); PUT `{domainId, extensionId, credentials}`. 60/min. **503** without `DATA_ENCRYPTION_KEY` in production.'],
    ['`GET /api/extensions`', es ? 'Pública (sin `trigger`) / firmada (con `trigger`)' : 'Public (no `trigger`) / signed (with `trigger`)', es ? 'Catálogo gratuito, o lista de handlers de un hook (`?trigger=EMAIL_PRE_SEND`).' : 'Free catalogue, or the handlers of a hook (`?trigger=EMAIL_PRE_SEND`).'],
    ['`POST /api/extension/execute`', es ? 'Firmada (o legado)' : 'Signed (or legacy)', es ? '`{extensionId, action, params?, context?}`. Cuerpo ≤1 MiB (413), 60/min. 400 / 401 `AUTH_REQUIRED` / 404 / **408** timeout / 500.' : '`{extensionId, action, params?, context?}`. Body ≤1 MiB (413), 60/min. 400 / 401 `AUTH_REQUIRED` / 404 / **408** timeout / 500.'],
    ['`POST /api/extension/hooks`', es ? 'Firmada (`EMAIL_PRE_SEND` también en legado)' : 'Signed (`EMAIL_PRE_SEND` also in legacy)', es ? '`{event: EMAIL_PRE_SEND|EMAIL_RECEIVED|CRON, context?, schedule?}`. 120/min. 403 para `EMAIL_RECEIVED`/`CRON` sin firma.' : '`{event: EMAIL_PRE_SEND|EMAIL_RECEIVED|CRON, context?, schedule?}`. 120/min. 403 for `EMAIL_RECEIVED`/`CRON` without a signature.'],
    ['`GET /api/storage/<clave>`', es ? 'Pública' : 'Public', es ? 'Sirve objetos del bucket (con `STORAGE_PUBLIC_PREFIXES` solo esos prefijos). Solo imágenes inline; lo demás como descarga. 300/min.' : 'Serves bucket objects (with `STORAGE_PUBLIC_PREFIXES` only those prefixes). Only images inline; the rest as downloads. 300/min.'],
    ['`POST /api/payments/orders` · `orders/capture` · `GET orders/[id]` · `/api/payments/subscriptions/*` · `GET /api/payments/billing/*`', es ? 'Firmada (solo dominios con clave)' : 'Signed (keyed domains only)', es ? 'Compra única, suscripciones y facturación del dominio. Modo legado: **403** `signature_required`. Sin PayPal: **503** `payments_not_configured`; sin tablas: **503** `payments_unavailable`. Ver [Guía de facturación](/docs/billing-guide).' : 'One-time purchase, subscriptions and domain billing. Legacy mode: **403** `signature_required`. Without PayPal: **503** `payments_not_configured`; without tables: **503** `payments_unavailable`. See the [Billing guide](/docs/billing-guide).'],
    ['`/api/payments/paypal/link/*` · `/api/payments/paypal/account` · `POST /api/payments/webhook` · `/api/cron/payments`', es ? 'Firmada / PayPal (firma verificada) / Bearer de cron' : 'Signed / PayPal (verified signature) / cron Bearer', es ? 'Vínculo de la cuenta PayPal (Log in with PayPal), webhook verificado con `verify-webhook-signature` y cron de conciliación y pagos (`PAYMENTS_CRON_SECRET`). Ver [Configuración de PayPal](/docs/billing-setup).' : 'PayPal account link (Log in with PayPal), webhook verified with `verify-webhook-signature` and the reconciliation and payout cron (`PAYMENTS_CRON_SECRET`). See [PayPal setup](/docs/billing-setup).'],
    ['`/api/developer/*` (`overview`, `validate`, `submissions`, `terms`, `pricing`, `extensions/[id]/test-install|yank`)', es ? 'Firmada (solo dominios con clave)' : 'Signed (keyed domains only)', es ? 'Portal de desarrollador: validar, enviar a revisión, precios, términos y retirar. Los proxies del frontend son `/api/admin/billing` y `/api/admin/developer` (nivel 4 y step-up). Ver [Guía de desarrollador](/docs/developer-guide).' : 'Developer portal: validate, submit for review, pricing, terms and yank. The frontend proxies are `/api/admin/billing` and `/api/admin/developer` (level 4 and step-up). See the [Developer guide](/docs/developer-guide).'],
    ['`GET /.well-known/bloomx-backend-key.json`', es ? 'Pública' : 'Public', es ? 'Clave pública Ed25519 del backend; 404 `{available:false}` si no tiene `BACKEND_SIGNING_PRIVATE_KEY`.' : 'The backend\'s Ed25519 public key; 404 `{available:false}` if it has no `BACKEND_SIGNING_PRIVATE_KEY`.'],
];

const head = (es: boolean) => es ? ['Ruta', 'Autenticación', 'Detalle y errores'] : ['Route', 'Authentication', 'Detail and errors'];

const es: Block[] = [
    { t: 'p', text: 'API del **backend compartido** (`bloomx-backend`). Para la API de cada frontend ve a [API del frontend](/docs/api). Las respuestas de error son JSON `{"error": "..."}`; CORS es siempre `*` sin credenciales y se exponen las cabeceras `X-BloomX-Auth` y `Retry-After`.' },
    { t: 'h2', id: 'auth-modes', text: 'Formas de autenticación' },
    { t: 'ul', items: [
        '**Cookie de manager** (Lucia, `auth_session`): panel de gestión de dominios. Registro y login de managers.',
        '**Firma Ed25519 por dominio** (`X-BloomX-*`): extensiones, hooks y su listado. Es el mecanismo principal entre un frontend y el backend.',
        '**Modo legado**: dominios sin clave registrada, con privilegios reducidos ([Arquitectura](/docs/architecture#signed-vs-legacy)).',
        '**Operador**: `Authorization: Bearer <BACKEND_CRON_SECRET>` (opcional) para ejecutar hooks `CRON` de todos los dominios; y Basic Auth de plataforma (`ADMIN_EMAIL`/`ADMIN_PASSWORD`) para publicar extensiones en `/api/admin/extensions` (60/15 min por IP).',
    ] },
    { t: 'h2', id: 'endpoints', text: 'Endpoints' },
    { t: 'table', head: head(true), rows: rows(true), caption: 'Endpoints del backend compartido' },
    { t: 'h2', id: 'examples', text: 'Ejemplos con curl' },
    { t: 'code', lang: 'bash', title: 'Alta de un dominio', code: curlRegister },
    { t: 'code', lang: 'bash', title: 'Configuración pública y clave del backend', code: curlConfig },
    { t: 'code', lang: 'bash', title: 'Registrar o rotar la clave pública de una instancia', code: curlManager },
    { t: 'h2', id: 'signing', text: 'Protocolo de firma v1' },
    { t: 'diagram', id: 'signing', caption: 'Firma de una petición del frontend al backend.' },
    { t: 'p', text: 'Cada petición de un dominio con clave registrada se firma con Ed25519 sobre esta cadena, con las líneas unidas por `\\n` (los `\\r` y `\\n` internos de cada valor se sustituyen por un espacio):' },
    { t: 'ol', items: [
        '`BLOOMX-SIG-V1`',
        'Método HTTP en mayúsculas',
        'Ruta + query tal como la ve el receptor (`pathname` + `search`)',
        '`sha256` del cuerpo crudo, en hexadecimal (cadena vacía si no hay cuerpo)',
        'Dominio (audiencia) en minúsculas',
        'Timestamp en segundos Unix',
        'Nonce',
        '`x-user-id` (o vacío)',
        '`x-user-email` (o vacío)',
        '`x-bloomx-callback` (o vacío)',
    ] },
    { t: 'table', head: ['Cabecera', 'Contenido'], rows: [
        ['`X-BloomX-Domain`', 'Dominio del tenant. **Obligatoria** en modo firmado (nunca se deduce del `Host`).'],
        ['`X-BloomX-Signature`', 'Firma Ed25519 de 64 bytes en base64url'],
        ['`X-BloomX-Timestamp`', 'Segundos Unix (`^\\d{9,12}$`); ventana ±120 s'],
        ['`X-BloomX-Nonce`', '`^[A-Za-z0-9_-]{16,64}$`; se consume una vez por dominio (anti-replay)'],
        ['`X-User-Id`, `X-User-Email`', 'Identidad del usuario, incluida en la firma'],
        ['`X-BloomX-Callback`', 'Opcional: origen https de la instancia (mismo dominio o subdominio) para el puente backend→frontend'],
    ] },
    { t: 'code', lang: 'javascript', title: 'Firmar una petición con Node', code: nodeSign },
    { t: 'code', lang: 'text', title: 'Cómo verifica el backend', code: verifyNode },
    { t: 'h3', id: 'register-key', text: 'Registrar la clave pública' },
    { t: 'ol', items: [
        'Genera el par en el frontend: `node scripts/gen-domain-keypair.mjs` (o `--json`). La privada va en `BLOOMX_DOMAIN_PRIVATE_KEY` del frontend; **nunca** la subas a git.',
        'Registra la pública: campo opcional `signingPublicKey` en `POST /api/auth/verify-domain` al dar de alta el dominio, o `POST /api/manager/domain-key` con la sesión del manager dueño (sirve para **rotar**). Se acepta PEM SPKI o base64/base64url de 32 bytes.',
        'La columna se crea de forma perezosa la primera vez, o a mano (aditiva):',
    ] },
    { t: 'code', lang: 'sql', code: sqlKey },
    { t: 'callout', kind: 'warn', title: 'Al registrar la clave, el modo legado termina', text: 'Desde ese momento el backend **exige** firma para ese dominio: un 401 significa firma ausente, inválida, caducada (±120 s de desfase de reloj) o nonce repetido. Comprueba que el reloj de tu servidor esté sincronizado (NTP).' },
    { t: 'callout', kind: 'note', title: 'Anti-replay por instancia', text: 'El almacén de nonces está en la memoria de cada instancia del backend (TTL 245 s, hasta 50 000 entradas). Con varias instancias, un replay dentro de la ventana contra otra instancia distinta podría aceptarse; la firma incluye método, ruta y cuerpo, así que solo se puede repetir la misma petición exacta.' },
    { t: 'h3', id: 'reverse', text: 'Sentido inverso: backend → frontend' },
    { t: 'p', text: 'El backend NO firma hacia el frontend. Cuando la instancia pide ejecutar una extensión adjunta una `executionGrant` (cuerpo `executionGrant` / `executionGrants`, o cabecera `X-BloomX-Grant` en `/api/ext/*`) firmada con **su propia** clave de dominio; el backend comprueba que corresponde a la ejecución (dominio autenticado, extensión, versión, usuario) y la reenvía tal cual a `/api/internal/**` (`services.mail`, storage, notify, ai, oauth...). La instancia la verifica sin red. Capacidad `ext.grants.v1`. Legado deprecado: firma del backend con `BACKEND_SIGNING_PRIVATE_KEY`.' },
    { t: 'h2', id: 'errors', text: 'Códigos de error y límites' },
    { t: 'table', head: ['Código', 'Significado'], rows: [
        ['400', 'Cuerpo o campos inválidos; `Unable to resolve domain`'],
        ['401', '`Unauthorized`: firma ausente o inválida (dominio con clave), sesión ausente o `Invalid credentials`'],
        ['402', '`PAYMENT_REQUIRED`: extensión de pago sin transacción aprobada'],
        ['403', 'Sin permiso (dominio ajeno, hook privilegiado sin firma, registro cerrado)'],
        ['404', 'Dominio, extensión o solicitud pendiente inexistente'],
        ['408', 'Timeout de una extensión'],
        ['409', 'Conflicto (email o dominio ya registrado)'],
        ['413', 'Cuerpo mayor de 1 MiB (`execute`, `hooks`)'],
        ['429', 'Rate limit (cabecera `Retry-After`); el límite del backend es solo en memoria por instancia'],
        ['503', 'BD no disponible (`Retry-After: 5`), pagos o cifrado no configurados'],
    ] },
];

const en: Block[] = [
    { t: 'p', text: 'API of the **shared backend** (`bloomx-backend`). For each frontend\'s API see [Frontend API](/docs/api). Error responses are JSON `{"error": "..."}`; CORS is always `*` without credentials, exposing the `X-BloomX-Auth` and `Retry-After` headers.' },
    { t: 'h2', id: 'auth-modes', text: 'Authentication modes' },
    { t: 'ul', items: [
        '**Manager cookie** (Lucia, `auth_session`): the domain-management panel. Manager sign-up and login.',
        '**Per-domain Ed25519 signature** (`X-BloomX-*`): extensions, hooks and their listing. This is the main mechanism between a frontend and the backend.',
        '**Legacy mode**: domains without a registered key, with reduced privileges ([Architecture](/docs/architecture#signed-vs-legacy)).',
        '**Operator**: `Authorization: Bearer <BACKEND_CRON_SECRET>` (optional) to run `CRON` hooks for all domains; and platform Basic Auth (`ADMIN_EMAIL`/`ADMIN_PASSWORD`) to publish extensions at `/api/admin/extensions` (60/15 min per IP).',
    ] },
    { t: 'h2', id: 'endpoints', text: 'Endpoints' },
    { t: 'table', head: head(false), rows: rows(false), caption: 'Shared backend endpoints' },
    { t: 'h2', id: 'examples', text: 'curl examples' },
    { t: 'code', lang: 'bash', title: 'Registering a domain', code: curlRegisterEn },
    { t: 'code', lang: 'bash', title: 'Public configuration and backend key', code: curlConfig.replace('# Público, sin autenticación', '# Public, no authentication').replace('# Clave pública del backend (solo si tiene BACKEND_SIGNING_PRIVATE_KEY; si no, 404 {"available":false})', '# Backend public key (only if it has BACKEND_SIGNING_PRIVATE_KEY; otherwise 404 {"available":false})') },
    { t: 'code', lang: 'bash', title: 'Register or rotate an instance public key', code: curlManagerEn },
    { t: 'h2', id: 'signing', text: 'Signing protocol v1' },
    { t: 'diagram', id: 'signing', caption: 'Signing a request from the frontend to the backend.' },
    { t: 'p', text: 'Every request from a domain with a registered key is signed with Ed25519 over this string, lines joined by `\\n` (any `\\r` or `\\n` inside a value is replaced by a space):' },
    { t: 'ol', items: [
        '`BLOOMX-SIG-V1`',
        'HTTP method in upper case',
        'Path + query as the receiver sees it (`pathname` + `search`)',
        '`sha256` of the raw body, hex (empty string if no body)',
        'Domain (audience) in lower case',
        'Unix timestamp in seconds',
        'Nonce',
        '`x-user-id` (or empty)',
        '`x-user-email` (or empty)',
        '`x-bloomx-callback` (or empty)',
    ] },
    { t: 'table', head: ['Header', 'Content'], rows: [
        ['`X-BloomX-Domain`', 'Tenant domain. **Required** in signed mode (never inferred from `Host`).'],
        ['`X-BloomX-Signature`', '64-byte Ed25519 signature in base64url'],
        ['`X-BloomX-Timestamp`', 'Unix seconds (`^\\d{9,12}$`); ±120 s window'],
        ['`X-BloomX-Nonce`', '`^[A-Za-z0-9_-]{16,64}$`; consumed once per domain (anti-replay)'],
        ['`X-User-Id`, `X-User-Email`', 'User identity, included in the signature'],
        ['`X-BloomX-Callback`', 'Optional: the instance\'s https origin (same domain or subdomain) for the backend→frontend bridge'],
    ] },
    { t: 'code', lang: 'javascript', title: 'Signing a request with Node', code: nodeSignEn },
    { t: 'code', lang: 'text', title: 'How the backend verifies', code: verifyNode
        .replace('Lo que hace el backend (resumen de src/lib/domain-auth.ts)', 'What the backend does (summary of src/lib/domain-auth.ts)')
        .replace('(obligatorio si el dominio tiene clave)', '(required if the domain has a key)')
        .replace('mismo string de arriba, con el cuerpo crudo recibido', 'same string as above, using the raw body received')
        .replace('// firma de 64 bytes', '// 64-byte signature')
        .replace('se consume UNA vez, solo si la firma es valida', 'consumed ONCE, only if the signature is valid')
        .replace('publicKeyDelDominio', 'domainPublicKey') },
    { t: 'h3', id: 'register-key', text: 'Registering the public key' },
    { t: 'ol', items: [
        'Generate the pair on the frontend: `node scripts/gen-domain-keypair.mjs` (or `--json`). The private key goes in the frontend\'s `BLOOMX_DOMAIN_PRIVATE_KEY`; **never** commit it.',
        'Register the public key: optional `signingPublicKey` field in `POST /api/auth/verify-domain` when creating the domain, or `POST /api/manager/domain-key` with the owning manager\'s session (also used to **rotate**). SPKI PEM or 32-byte base64/base64url is accepted.',
        'The column is created lazily the first time, or by hand (additive):',
    ] },
    { t: 'code', lang: 'sql', code: sqlKey },
    { t: 'callout', kind: 'warn', title: 'Registering the key ends legacy mode', text: 'From then on the backend **requires** a signature for that domain: a 401 means a missing, invalid or expired signature (±120 s clock skew) or a repeated nonce. Make sure your server clock is synchronised (NTP).' },
    { t: 'callout', kind: 'note', title: 'Per-instance anti-replay', text: 'The nonce store lives in each backend instance\'s memory (TTL 245 s, up to 50,000 entries). With several instances, a replay inside the window against a different instance could be accepted; the signature covers method, path and body, so only the exact same request can be replayed.' },
    { t: 'h3', id: 'reverse', text: 'Reverse direction: backend → frontend' },
    { t: 'p', text: 'The backend does NOT sign towards the frontend. When the instance asks to run an extension it attaches an `executionGrant` (body `executionGrant` / `executionGrants`, or the `X-BloomX-Grant` header on `/api/ext/*`) signed with **its own** domain key; the backend checks it matches the execution (authenticated domain, extension, version, user) and forwards it as is to `/api/internal/**` (`services.mail`, storage, notify, ai, oauth...). The instance verifies it offline. Capability `ext.grants.v1`. Deprecated legacy: backend signature with `BACKEND_SIGNING_PRIVATE_KEY`.' },
    { t: 'h2', id: 'errors', text: 'Error codes and limits' },
    { t: 'table', head: ['Code', 'Meaning'], rows: [
        ['400', 'Invalid body or fields; `Unable to resolve domain`'],
        ['401', '`Unauthorized`: missing or invalid signature (domain with key), missing session or `Invalid credentials`'],
        ['402', '`PAYMENT_REQUIRED`: paid extension without an approved transaction'],
        ['403', 'Not allowed (foreign domain, privileged hook without signature, sign-up closed)'],
        ['404', 'Unknown domain, extension or pending request'],
        ['408', 'Extension timeout'],
        ['409', 'Conflict (email or domain already registered)'],
        ['413', 'Body larger than 1 MiB (`execute`, `hooks`)'],
        ['429', 'Rate limit (`Retry-After` header); the backend limit is per-instance memory only'],
        ['503', 'DB unavailable (`Retry-After: 5`), payments or encryption not configured'],
    ] },
];

const page: DocPageContent = { es, en };
export default page;
