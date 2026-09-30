# Guía de extensiones de BloomX

Estado real del sistema al 2026-09-29. Una **extensión** es un directorio en `bloomx-extensions/<nombre>/` con:

- `manifest.json`: declara la interfaz (botones, formularios, overlays), los permisos y los hooks. El frontend lo pinta con `JsonRenderer`.
- `server.js` (opcional): lógica de servidor. Se descarga de Backblaze B2 y se ejecuta en el backend **compartido**, en un `worker_threads` por invocación con un contexto `node:vm` (`bloomx-backend/src/lib/extensions/sandbox.ts`; límites en §7). Las extensiones **solo cliente** (`"clientOnly": true`) no tienen `server.js`.

> La referencia vigente y con ejemplos está también en la documentación de la app: `/docs/expansions` y `/docs/create-extension` (`src/app/docs/_content/pages/`). Este archivo la complementa con detalle del renderer.

No existen `src/lib/expansions/server.ts`, `src/lib/expansions/core/`, flags `EXPANSION_*` ni un `ClientExpansion` para casi todo: eso pertenecía a un diseño anterior. Lo único "nativo" del cliente es `core-mail-groups` (`components/expansions/settings/MailGroupsSettings.tsx`, registrado en `lib/expansions/client/registry.ts`).

```
bloomx-extensions/<ext>/manifest.json + server.js
        │  sync-extensions.mjs (operador)            ┌──────────────────────────────┐
        ▼                                            │ bloomx (frontend)            │
 Neon (Extension.template) + B2 (server.js) ───────► │ /api/config → useDomainConfig│
        ▲                                            │ ExtensionLoader → JsonRenderer│
        │                                            └───────┬──────────────────────┘
 bloomx-backend                                              │ CALL_BACKEND / hooks
  /api/extension/execute  (RPC)  ◄───── /api/expansions ─────┘  (proxy firmado Ed25519 / legado)
  /api/extension/hooks    (intercepts) ◄─ /api/emails (EMAIL_PRE_SEND)
  /api/extension/settings (credenciales por dominio)
```

## 1. Contrato del handler: `handler(ctx)`

Todo handler recibe **un solo objeto**. La firma antigua `(payload, context)` ya no existe (el runtime nunca la soportó: `context` llegaba `undefined`). Una prueba (`bloomx-extensions/tests/contract.test.mjs`) falla si algún handler declara más de un parámetro.

```js
// server.js  (CommonJS o `export async function`; ambos se normalizan)
module.exports = {
    savePage: async (ctx) => {
        const { subject } = ctx.args;               // parámetros de la acción
        const key = ctx.env.NOTION_API_KEY;          // credencial del DOMINIO
        const title = await ctx.services.ai.generate('system', 'prompt');
        return { success: true };                    // se serializa a JSON
    },
};
```

| Campo de `ctx` | Origen | Notas |
|---|---|---|
| `args` | `CALL_BACKEND.args` (+ `formData` si la acción sale de un FORM) | Siempre los del RPC; el `context` del cliente no puede pisarlos. |
| `env` | Permisos `ENV_READ:NOMBRE` | Credencial del dominio (cifrada en BD) o, si el operador lo autoriza, variable global (ver §5). |
| `services.ai.generate(system, prompt, opts?)` | Plataforma | Máx. 5 llamadas por invocación. `opts.response_format = {type:'json_object'}` para JSON. |
| `services.auth.getToken(provider)` | Runtime | Token OAuth: cuenta vinculada del usuario > `authData` del dominio > fallback controlado. Devuelve `null` si no hay. |
| `domain` | Servidor | `{ id, name, displayName, logo, theme }`. Úsalo para marca (`domain.displayName`, `domain.theme.primaryColor`). |
| `user` | Identidad firmada por el dominio (`X-User-Id`, `X-User-Email`) | `{ id, email }` o `null` (p. ej. en hooks `CRON`). |
| `services.mail.{listRecent,getEmail,applyBatch,undoRun}` | Puente firmado backend → frontend | Solo si la llamada va firmada (dominio con clave), el backend tiene `BACKEND_SIGNING_PRIVATE_KEY`, hay usuario y el manifest declara `READ_EMAIL` (lectura) o `MAIL_LABEL` (etiquetar/deshacer). Máx. 60 llamadas y 15 s por invocación. Un permiso ausente da `MAIL_PERMISSION_DENIED`. |
| `settings` | `ExtensionOnDomain.settings` | **Sin** claves con nombre `token/secret/password/credential…` (`stripSecrets`). |
| `extension` | Servidor | `{ id, sourceId, name, manifest }`. |
| Resto | Contexto del cliente | `emailContent`, `subject`, `to`, `from`, `secureData`… **No fiable**: lo manda el navegador. `auth`, `user`, `env` del cliente se descartan. |

Globals disponibles en el sandbox (todo lo demás no existe): `console`, `fetch` (SSRF-safe, https, máx. 20 por invocación), `URL`, `URLSearchParams`, `Buffer` (subconjunto: `from`, `byteLength`, `isBuffer`, `toString`), `crypto {randomUUID, sha256Hex, hmacSha256Hex}`, `setTimeout`/`clearTimeout`, `process.env` (solo las variables autorizadas). Sin `require`, `eval`, `new Function` ni `setInterval`.

**Resolución de acciones**: `CALL_BACKEND.function = "searchGifs"` → `manifest.api.functions.searchGifs.handler = "search"` → `exports.search`. Si `api.functions` no la declara, se usa el nombre tal cual. `api.functions.<x>.timeout` (100–60000 ms) acota esa función; por defecto 25 s.

Errores: lanza `new Error('mensaje')` (se devuelve al cliente, máx. 500 caracteres). `AUTH_REQUIRED` responde 401 y la UI puede reaccionar (p. ej. mostrar "Conectar Google").

## 2. Manifest

Se **valida al cargar** (`lib/expansions/manifest-schema.ts` en el frontend, `src/lib/extensions/manifest-schema.ts` en el backend, y `bloomx-extensions/_shared/manifest-schema.ts` es la fuente canónica; una prueba comprueba que las tres copias sean idénticas). Un manifest con **errores** no se monta en el frontend, no se publica desde `admin/extensions` (400) y `readRepositoryExtensions` lo salta. Los **avisos** (vocabulario desconocido) se cargan igual.

Campos principales:

```jsonc
{
  "manifestVersion": "1.0",
  "id": "core-notion", "name": "…", "version": "1.0.0", "description": "…",
  "status": "active",                       // "disabled": no se monta (hoy ninguna extensión lo está)
  "permissions": ["READ_EMAIL", "ENV_READ:NOTION_API_KEY", "HTTP_REQUEST"],
  "auth": { "type": "OAUTH2", "provider": "hubspot", "scopes": [] },
  "api": { "runtime": "nodejs", "entry": "server.js",
           "functions": { "savePage": { "handler": "savePage", "timeout": 10000 } } },
  "mounts": [ { "point": "EMAIL_TOOLBAR", "component": { "type": "BUTTON", "props": { … } } },
              { "point": "OVERLAY", "id": "notion-modal", "component": { "type": "MODAL", … } },
              { "point": "ON_RECIPIENTS_CHANGE_HANDLER", "handler": "expandGroups", "priority": "HIGH" } ],
  "intercepts": [ { "point": "EMAIL_PRE_SEND", "handler": "scanContent", "priority": "HIGH", "onError": "block" } ]
}
```

Reglas que impone el schema: `id`/`version` válidos; `ENV_READ:` solo en MAYÚSCULAS y **nunca** variables de plataforma (`DATABASE_URL`, `B2_*`, `ADMIN_*`, `NEXT_*`, `EXTENSION_*`…); todo `CALL_BACKEND.function`, `mount.handler` e `intercept.handler` debe existir en `api.functions`; acciones desconocidas son error; los `OVERLAY` requieren `id`.

Formas heredadas que `normalizeMount` convierte: `component: "MODAL"` con `props`/`children` a nivel del mount, y el `COMPOSER_INIT` con `config.storageKey` (firma) → componente `HEADLESS`.

### Puntos de montaje que **tienen consumidor** hoy

| Punto | Dónde | Contexto |
|---|---|---|
| `EMAIL_TOOLBAR` | MailView (correo abierto) | El objeto email + `emailContent` (cuerpo o snippet) y `fromContact {email,name,firstName,lastName}` (los completa `ExtensionLoader`). |
| `COMPOSER_TOOLBAR`, `EMAIL_FOOTER`, `COMPOSER_INIT` | ComposeModal | `subject`, `to/cc/bcc`, `emailContent` (borrador), `insertBody/appendBody/setSubject/addAttachment`. |
| `SIDEBAR_HEADER`, `SIDEBAR_FOOTER` | Sidebar | — |
| `CALENDAR_HEADER`, `CALENDAR_SIDEBAR(_BOTTOM)`, `CALENDAR_ADD_SOURCES`, `EVENT_LOCATION_BUILDER` | Calendario | `isGoogleLinked`, setters del formulario. |
| `CONTACTS_HEADER`, `CONTACTS_SIDEBAR(_BOTTOM)` | Contactos | — |
| `ON_RECIPIENTS_CHANGE_HANDLER` (también `ON_BODY/SUBJECT_CHANGE_HANDLER`) | ComposeModal y CreateEventForm | `GET /api/extensions?trigger=X` devuelve solo los handlers de las extensiones **instaladas en el dominio**, ordenados por `priority`. El handler recibe `args = {to, cc, bcc}`. |
| `CUSTOM_SETTINGS_TAB` | Ajustes | `ExpansionUIProvider` publica las pestañas de los manifests en el registro que lee `SettingsModal` (id `ext:<extensionId>`). |
| `PAGE` | `/extensions/<path>` | — |
| `OVERLAY` | `OPEN_OVERLAY.targetId` | Contexto del mount que lo abre. |

**`slashCommands[]` sí se consumen**: el editor del composer lee los comandos de los manifests instalados (`src/lib/slash-commands.ts`, `SlashMenu.tsx`, `expansions/SlashActionRunner.tsx`), abre un menú con `/` (flechas, `Home`/`End`, Enter ejecuta, Tab completa, Esc cierra) y ejecuta la `action` con el mismo motor que los botones; el texto tras el comando llega como `args`/`slashArgs`. Clave `^[a-zA-Z0-9_-]{1,32}$`; si dos extensiones repiten la clave gana la primera.

**Sin consumidor (no los uses):** `BEFORE_SEND_HANDLER`, `CUSTOM_ROUTE`, `backendRoutes` (no hay router `/api/ext/[id]/*`; se quitaron de giphy y hubspot: usan `CALL_BACKEND`). `EMAIL_HEADER` y `SETTINGS_TAB` están en el schema pero no tienen consumidor documentado.

### Componentes y acciones

Componentes: `BUTTON TEXT INPUT CARD ROW COLUMN CONDITIONAL LINK TABS MODAL HEADLESS WIZARD SELECT FORM LIST IMAGE_BUTTON FOR_EACH SWITCH CHECKBOX TOGGLE TEXTAREA BADGE DIVIDER SPACER PROGRESS SMART_REPLY_CHIPS LOADING ALERT ICON ACCORDION GRID DATA_TABLE MARKDOWN FILE_UPLOAD BLOCK REPEAT DEBUG CONDITION CASE DEFAULT SET_VAR DATE_PICKER SLIDER AVATAR TOOLTIP EMPTY_STATE IFRAME CODE_EDITOR ACCORDION_ITEM TAB_ITEM CODE_BLOCK FLEX BOX SEPARATOR`.

Acciones: `SET_STATE MERGE_STATE MAP_ARRAY FILTER_ARRAY SET_LOADING OPEN_OVERLAY CLOSE_OVERLAY OPEN_URL NAVIGATE REFRESH DELAY CONFIRM CALL_BACKEND CALL_API TOAST COPY_TO_CLIPBOARD INSERT_CONTENT APPEND_BODY SET_SUBJECT ADD_ATTACHMENT SET_CONTEXT_VALUE NEXT_STEP PREV_STEP SECURE_SAVE SECURE_READ OAUTH_CONNECT OAUTH_DISCONNECT`.

Comportamientos que conviene conocer:

- **`CALL_BACKEND` y formularios**: si la acción sale de un `FORM` sin `args`, los campos llegan como `ctx.args`. Con `args` explícitos, estos ganan sobre los campos (`"name": "${formData.name}"`). El `context` que viaja va **saneado** (`toBackendContext`: sin funciones, `overlays`, `auth`, `user`, `env`).
- **`onSuccess/onError`** heredan `value`/`formData` del evento original y añaden `result`/`error`.
- **`WIZARD` + `NEXT_STEP/PREV_STEP`**: actúan sobre el `WIZARD` que contiene al componente. El estado (`SET_STATE`) es compartido por todo el árbol y una cadena de acciones ve los `SET_STATE` anteriores.
- **`CALL_API`** solo admite rutas propias (`/api/...`); **`OAUTH_CONNECT.url`** solo rutas internas; **`NAVIGATE`** solo rutas internas; **`OPEN_URL`/`LINK`** solo `http(s)`, `mailto`, `tel`; **`IMAGE_BUTTON/AVATAR.src`** solo `http(s)`. `javascript:`/`data:` se bloquean.
- **`onLoad`** corre una vez al montar (o cuando `onLoadWhen` pasa de falso a verdadero).
- **`LIST`/`FOR_EACH`/`REPEAT`**: la plantilla se resuelve **por item** (alias `item` o `as`).
- Los campos `defaultValue` de un `FORM` se reaplican solo a los campos que el usuario no ha tocado.

### Expresiones `${…}`

Evaluador propio sin `eval` (`lib/expansions/expressions.ts`). Soporta: rutas (`context.x`, `state.x.y`, `env.X`, alias sueltos como `item`, `result`, `value`, `formData`), literales, `!`, `&&`, `||` (primer valor no vacío; `0`/`false` cuentan), `== != === !==` (`== null` también es cierto para `''`), `< > <= >=`, `+ -`, ternario `a ? b : c`, paréntesis, `?.`, `[expr]` y filtros `| truncate:N | upper | lower | trim | capitalize | length | json | join:sep | default:x`. No hay llamadas a funciones; `__proto__`/`constructor`/`prototype` están bloqueados; un error de sintaxis da `undefined`. Una cadena que es **solo** `${…}` conserva el tipo (array, objeto…); si mezcla texto se convierte a string.

## 3. Hooks de servidor (`intercepts`)

`POST {backend}/api/extension/hooks { event, context }` ejecuta los `intercepts` de las extensiones instaladas en el dominio, por prioridad (`HIGH` → `NORMAL` → `LOW` → `MONITOR`).

| Evento | Quién lo llama | Efecto |
|---|---|---|
| `EMAIL_PRE_SEND` | `POST /api/emails` (frontend, firmado o en modo legado), justo antes de enviar | Handler devuelve `{ stop: true, message }` → **el correo no se envía** (HTTP 422, `code: "EXTENSION_BLOCKED"`). `{ modify: { subject?, html?, text? } }` reemplaza asunto/cuerpo (nunca destinatarios). `{ warning }` se devuelve en `warnings`. `MONITOR` se ejecuta pero no bloquea ni modifica. `onError: "block"` bloquea si el handler falla (DLP lo usa). |
| `EMAIL_RECEIVED` | `POST /api/webhooks/resend` tras guardar el correo, en segundo plano (`runEmailReceivedHooks` en `lib/expansions/server-hooks.ts`), solo con dominio **firmado** | Sin bloqueo. Contexto `{emailId, userId, domain}`. Si el frontend no tiene `BLOOMX_DOMAIN_PRIVATE_KEY` se omite en silencio. Presupuesto de 60 s. |
| `CRON` | El endpoint existe en el backend (dominio firmado, u operador con `BACKEND_CRON_SECRET`); `runCronHooks` existe en el frontend **pero nadie lo llama** (`/api/cron/run` no invoca hooks) | Ejecuta los intercepts `point:"CRON"` con ese `schedule` (máx. 500 ejecuciones). Ninguna extensión actual lo declara. Corren con `user: null`, sin `services.mail`. |

Autenticación: firma Ed25519 con `BLOOMX_DOMAIN_PRIVATE_KEY` (sin secretos compartidos; ver README). Frontend: `EXTENSION_HOOKS_FAIL_CLOSED=true` para **no enviar** si el backend no puede evaluar los hooks (por defecto se envía y se registra el fallo), `EXTENSION_HOOKS_DISABLED=true` para desactivar.

Ejemplo (DLP): el hook ve `ctx.subject`, `ctx.emailContent` (HTML + texto), `ctx.attachments[].filename`, `ctx.to/cc/bcc/from`.

## 4. Persistencia en el cliente

- **`SECURE_SAVE` / `SECURE_READ`** (`lib/expansions/client/secure-storage.ts`): AES-256-GCM con una clave aleatoria **no extraíble** por usuario (IndexedDB) y el nombre de la clave como dato autenticado. **No caduca**. Protege contra leer `localStorage` sin la clave del navegador, **no** contra código que corra en la propia página (XSS). Sin sesión no se guarda ni se lee nada (no existe el usuario `default-user` compartido). Sin IndexedDB/WebCrypto falla (`SECURE_STORAGE_UNAVAILABLE`) en vez de guardar en claro. Es local a ese navegador.
- **Datos que deben sincronizarse entre dispositivos** (alias de mail-groups): `useExpansionSettings(id)` → `/api/settings` (`expansionSettings`).

## 5. Credenciales por dominio

Cada dominio usa **sus** claves (Notion, Trello, HubSpot, Zoom, Google Meet, Giphy, Webhooks, DLP). El manifest solo declara qué variables pide (`ENV_READ:X`); el valor sale de:

1. `ExtensionOnDomain.settings.credentials[X]`, cifrado con AES-256-GCM (`DATA_ENCRYPTION_KEY`). Se escribe con la API:
   - `PUT /api/extension/settings { domainId, extensionId, credentials: { NOTION_API_KEY: "…", NOTION_DATABASE_ID: null } }` (cookie de sesión de manager, dueño del dominio). `null`/`""` borra. Solo acepta claves declaradas por el manifest. `GET ?domainId=&extensionId=` devuelve `{ keys: [{name, configured}] }`, nunca valores.
2. Fallback al entorno global del servidor, **controlado**: las variables no sensibles (`DLP_KEYWORDS`, `DLP_DETECTORS`, `HUBSPOT_PORTAL_ID`…) siempre; las sensibles (nombre con `KEY|TOKEN|SECRET|PASSWORD|ACCOUNT_ID|CLIENT_ID|REFRESH|WEBHOOK_URL`) **solo** si el operador las lista en `EXTENSION_GLOBAL_ENV_FALLBACK` (coma, o `*`). Cada uso deja un `[EXT_SECURITY]` en el log.

`/api/config` nunca devuelve `credentials` (`stripSecrets`). **Pantalla:** Admin → Extensiones → *Credenciales* (`ExtensionCredentialsModal`, visible si el manifest declara `ENV_READ:*`); los valores guardados nunca vuelven al navegador. También puedes usar la API. En modo legado no hay credenciales por dominio. Sin `DATA_ENCRYPTION_KEY` en el backend, en producción el `PUT` responde 503.

## 6. Crear o modificar una extensión

1. Crea `bloomx-extensions/<nombre>/manifest.json` y, si necesita servidor, `server.js` con `handler(ctx)`.
2. `cd bloomx-extensions && npm test` (valida los 21 manifests, el contrato y los handlers con `node --test`). Para las plantillas de invitación: `npm run check:invite`.
3. El operador publica con `node --env-file=.env sync-extensions.mjs` (desde `bloomx-backend`; sube `server.js` a B2 y hace upsert en Neon).
4. El manager del dominio instala la extensión (`/api/manager/extensions/install`) y configura sus credenciales (§5).

Pruebas del frontend (`npm test` en `bloomx`): evaluador de expresiones, validador de manifest, ejecutor de hooks, almacenamiento seguro, saneado de contexto/URLs y el renderer (jsdom). Backend (`npm test` en `bloomx-backend`): ejecutor de hooks y schema.

## 7. Límites conocidos

- **Sandbox**: un `worker_threads` por invocación con contexto `node:vm` (sin `eval`), `env` vacío salvo lo autorizado, heap de 128 MB (joven 32 MB, pila 4 MB), timeout duro de 25 s (por función `api.functions.<f>.timeout`) con `worker.terminate()`, 20 `fetch` y 5 llamadas de IA por invocación, máx. 500 mensajes y 200 logs, `EXT_SANDBOX_MAX_WORKERS` (8) simultáneos con cola de 5 s (`Sandbox busy`). **No es una frontera de seguridad fuerte**: si el código escapara del contexto seguiría en el mismo proceso y usuario (con `fs`, `net`, `child_process`) y la memoria fuera del heap de V8 no está acotada. Para código de terceros hostil hace falta un contenedor/microVM por tenant.
- Globals del sandbox: `console`, `setTimeout`/`clearTimeout`, `URL`, `URLSearchParams`, `Buffer` mínimo, `crypto {randomUUID, sha256Hex, hmacSha256Hex}`, `fetch`, `module`/`exports`, `process.env`. No hay `setInterval`, `AbortController`, `Headers`, `Request`, `Response`, `FormData` ni `Blob`.
- La identidad del dominio es la firma Ed25519 con `X-BloomX-Domain` explícito; un dominio sin clave funciona en modo legado con privilegios reducidos (sin credenciales, `services.mail`, `EMAIL_RECEIVED` ni `CRON`). El anti-replay por nonce vive en memoria de cada instancia.
- `Sealer` está **activo** pero no es una extensión de servidor: el cifrado (AES-256-GCM, clave en el fragmento `#k=`) ocurre en el navegador. La clave viaja en el enlace salvo contraseña, no admite adjuntos y evade el DLP (ver `/docs/sealer`).
- `Organizer` está **activo** y requiere `services.mail` (dominio firmado + `BACKEND_SIGNING_PRIVATE_KEY` + permisos `READ_EMAIL`/`MAIL_LABEL`); sin ello falla con `ORGANIZER_MAIL_SERVICE_UNAVAILABLE` y el hook se omite.
- `MailView` pasa solo `data.email` a `EMAIL_TOOLBAR`: `emailContent` es el `snippet` (extracto). Para dar el cuerpo completo a summarizer/translator/notion/trello basta con que MailView pase `{ ...data.email, content: data.content }` (`ExtensionLoader` ya convierte `content` a texto). No se verificó si ya se corrigió.
- `appointments` y `google-sync` son `clientOnly` (sin `server.js`): `sync-extensions.mjs` los publica con `scriptUrl = null`.
- `sync-extensions.mjs`, `scripts/sync-repository-extensions.mjs` y `POST /api/admin/extensions` validan manifest **y UI** (ver `bloomx-extensions/_shared/validate.mjs`): una extensión inválida NO se publica (los scripts la cuentan como fallo y salen con código 1; la API responde 400/422 con la ruta del error). Si el validador no se puede ejecutar, tampoco se publica.
- El test de contrato de `bloomx-extensions` cuenta las carpetas (21): actualízalo al añadir una.
- `docs`: los archivos de `bloomorg-updates/` describen el diseño original; manda esta guía y `/docs/expansions`.
