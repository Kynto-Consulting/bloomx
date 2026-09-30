# Extensiones (Expansions) de BloomX

Catálogo y estado real, 2026-09-29. Cómo se construyen: [`expansions/howto.md`](expansions/howto.md). Configuración de Google: [`expansions/google_setup.md`](expansions/google_setup.md).

Las 21 extensiones viven en `bloomx-extensions/` (manifest + `server.js`), se publican a Neon/B2 con `sync-extensions.mjs` y cada dominio instala las suyas. **No hay flags `EXPANSION_*`** (eran del diseño anterior): que una extensión esté activa depende de que el dominio la tenga instalada y habilitada (`ExtensionOnDomain.enabled`).

## Estado

Leyenda: **OK** funciona de punta a punta · **Cred.** requiere credenciales del dominio (§Credenciales) · **Parcial** · **Off** deshabilitada (`status: "disabled"`, no se monta).

| Extensión | ID | Estado | Qué hace / límites |
|---|---|---|---|
| Calendar | `core-calendar` | OK | Evento con `.ics` + HTML de invitación; `extractEvent` con IA. `/calendar` y `/cal` abren el modal del evento. |
| Zoom | `core-zoom` | OK · Cred. | `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` del dominio; si faltan responde "Zoom is not configured". |
| Google Meet | `core-google-meet` | OK | Cuenta Google vinculada del usuario; alternativa: `GOOGLE_CLIENT_ID/SECRET` + `GOOGLE_MEET_ADMIN_REFRESH_TOKEN` del dominio. |
| Google Drive | `core-google-drive` | Parcial | Lista e inserta enlaces (saneados). `uploadFile` existe en servidor sin UI. |
| Google Sync | `core-google-sync` | Parcial | Solo cliente (`clientOnly`): botones `CALL_API` a `/api/google/sync`; sin `server.js`, se publica sin `scriptUrl`. |
| Appointments | `core-appointments` | Parcial | Solo cliente (`clientOnly`): UI `CALL_API` sobre `/api/appointments/schedules`; sin `server.js`, se publica sin `scriptUrl`. |
| Notion | `core-notion` | OK · Cred. | `NOTION_API_KEY`, `NOTION_DATABASE_ID`. |
| Trello | `core-trello` | OK · Cred. | `TRELLO_KEY`, `TRELLO_TOKEN` (van en cabecera, no en la URL). |
| HubSpot | `core-hubspot` | OK · Cred. | OAuth del dominio o `HUBSPOT_ACCESS_TOKEN`; `HUBSPOT_PORTAL_ID` para el enlace al contacto. |
| Giphy | `core-giphy` | OK · Cred. | `GIPHY_API_KEY` (del dominio, o global si el operador la lista en `EXTENSION_GLOBAL_ENV_FALLBACK`). Vive en la barra del composer. |
| Composer Helper | `core-composer-helper` | OK | Redacción con IA. `/ai qué escribir` abre el asistente con el texto ya cargado. |
| Summarizer / Translator / Smart Reply | `core-summarizer` `core-translator` `core-smart-reply` | Parcial | Handlers correctos; en el correo abierto `emailContent` es el extracto (snippet) hasta que MailView pase el cuerpo (ver howto §7). |
| Mail Groups | `core-mail-groups` | OK | Alias `@equipo` → miembros. Ajustes nativos (Ajustes → Mail Groups, se guardan en `/api/settings`); expansión vía `ON_RECIPIENTS_CHANGE_HANDLER`. |
| Email Signature | `core-signature` | OK | Firma en Ajustes (pestaña de la extensión); se guarda cifrada **en ese navegador**, sin caducidad; se añade al abrir el composer. |
| DLP | `core-dlp` | OK | **Bloquea el envío** (`POST /api/emails` → 422) si detecta palabras clave (`DLP_KEYWORDS`), tarjetas (Luhn), IBAN, SSN, claves privadas o secretos; si el escaneo falla, también bloquea (`onError: "block"`). |
| Webhooks | `core-webhooks` | Parcial | Handler firmado con HMAC (`WEBHOOK_URL`, `WEBHOOK_SECRET`). El ejecutor `EMAIL_RECEIVED` existe; falta llamarlo desde el webhook de Resend (`runEmailReceivedHooks`). |
| Slash Commands | `core-slash-commands` | OK | Solo cliente: `/shrug`, `/smile`, `/hr` (`INSERT_CONTENT`). |
| Auto Organizer | `core-organizer` | Off | `organize` clasifica con IA los correos que recibe, pero el sandbox no puede leer el buzón ni aplicar etiquetas. Ya no simula éxito. |
| Sealer | `core-sealer` | Off | **No cifra nada.** Requiere directorio de claves públicas y un hook de envío que no existen (`Domain.publicKey` es un UUID). El handler falla cerrado. |

Ya no existen en el código ni en esta lista: `core-slack`, `core-templates`, `core-confidential`, `core-followup`, `core-crm`.

## Seguridad (resumen)

- **Ejecución autenticada por dominio, sin secretos compartidos**: el backend es compartido por N frontends. Un dominio con clave pública registrada (`Domain.signingPublicKey`) debe firmar cada llamada con Ed25519 (`X-BloomX-Signature/Timestamp/Nonce`, ventana ±120 s, anti-replay por nonce); un dominio sin clave entra en **modo legado** (cabeceras `x-bloomx-domain`/`x-user-id`, sin credenciales de dominio, sin `services.mail`, sin `EMAIL_RECEIVED`/`CRON`, con rate limit y cabecera `X-BloomX-Auth: legacy`). Ya no se usan `NEXTAUTH_SECRET`/`INTERNAL_SECRET`/`EXTENSION_HOOKS_SECRET` entre frontend y backend.
- **Sandbox** `node:vm` sin objetos del host; `process.env` solo con las variables `ENV_READ:*` permitidas (lista de reservadas en `manifest-schema.ts`); `fetch` con protección SSRF. Sigue sin ser una frontera fuerte: para código de terceros usar `isolated-vm`/contenedor.
- **Manifests validados** con schema en carga (frontend), publicación (`admin/extensions`) y lectura de repositorio.
- **Renderer**: evaluador de expresiones sin `eval`, URLs saneadas, contexto saneado hacia el backend, `auth`/`user`/`env` fijados solo por el servidor.
- **Multi-tenant**: credenciales por dominio cifradas; el fallback al entorno global de credenciales exige autorización explícita del operador.
- **Almacenamiento local** (`SECURE_SAVE`): AES-256-GCM con clave no extraíble por usuario, sin caducidad; ver los límites en el howto §4.

## Comandos con barra (`slashCommands`)

El editor del composer lee `slashCommands[]` de los manifests instalados (`{ key, description, arguments?, action }`). Al escribir `/` se abre un menú accesible (listbox; ↑/↓ navegan, Enter ejecuta, Tab completa la clave, Esc cierra). Con el comando exacto (`/calendar Reunión`) lo escrito después es el argumento (`context.slashArgs`). La `action` la ejecuta el mismo motor que los botones (`INSERT_CONTENT`, `OPEN_OVERLAY`, `CALL_BACKEND` + `onSuccess`…). Si dos extensiones declaran la misma clave gana la primera. Código: `src/lib/slash-commands.ts`, `SlashMenu.tsx`, `Editor.tsx`, `expansions/SlashActionRunner.tsx`.

## Extensiones solo cliente

Un manifest sin `server.js` se marca `"clientOnly": true`, no declara `api.functions` ni usa `CALL_BACKEND` (lo verifica `tests/client-only-slash.test.mjs`). `sync-extensions.mjs` las publica sin `scriptUrl` y termina con código ≠ 0 si alguna falla.

## Credenciales por dominio

```
PUT /api/extension/settings
{ "domainId": "…", "extensionId": "core-notion",
  "credentials": { "NOTION_API_KEY": "secret_…", "NOTION_DATABASE_ID": "…" } }
```
**Panel:** Admin → Extensiones → *Credenciales* (visible si el manifest declara `ENV_READ:*`). Los campos salen de esos permisos (menos las variables reservadas); los valores guardados **nunca** vuelven al navegador (solo "Configurada / Sin configurar"): para rotar se escribe el valor nuevo, para borrar se marca "Eliminar" y se guarda. Proxy: `/api/admin/extensions/settings` (GET/PUT, solo admin, audita nombres —no valores—).
**Desinstalar** borra `authData` (tokens OAuth), `settings.credentials` y cualquier clave de `settings` con aspecto de secreto, y deja auditoría (`extension.uninstall`). No revoca el token en el proveedor.

Cookie de sesión del manager (propietario del dominio). Requiere `DATA_ENCRYPTION_KEY` en producción. Operador: `EXTENSION_GLOBAL_ENV_FALLBACK=GIPHY_API_KEY` (o `*`) permite que un dominio sin credencial propia use la variable global.

## Variables de entorno relevantes

| Variable | Dónde | Uso |
|---|---|---|
| `NEXTAUTH_SECRET` | frontend (propio de cada instancia) | Sesión y clave interna derivada (HKDF). **No se comparte con el backend.** |
| `BLOOMX_DOMAIN_PRIVATE_KEY` | frontend (opcional) | Clave Ed25519 con la que la instancia firma sus llamadas al backend (`scripts/gen-domain-keypair.mjs`); sin ella, modo legado. |
| `BLOOMX_BACKEND_PUBLIC_KEY` | frontend (opcional) | Clave pública del backend para verificar `services.mail`; si falta se descubre en `/.well-known/bloomx-backend-key.json`. |
| `BACKEND_SIGNING_PRIVATE_KEY` | backend (opcional) | Clave Ed25519 propia del backend para el puente hacia el frontend. |
| `DATA_ENCRYPTION_KEY` | backend | Cifrado de credenciales por dominio. |
| `BACKEND_CRON_SECRET` | backend (opcional, operador) | Cron global de hooks de todos los dominios (`Authorization: Bearer`). Sin definir, el cron va firmado por cada dominio. |
| `EXTENSION_GLOBAL_ENV_FALLBACK` | backend | Variables sensibles que un dominio puede tomar del entorno global. |
| `EXTENSION_HOOKS_FAIL_CLOSED` / `EXTENSION_HOOKS_DISABLED` | frontend | Política si el backend no evalúa los hooks de `EMAIL_PRE_SEND`. |

Para actualizar este catálogo al añadir una extensión: manifest + `npm test` en `bloomx-extensions`, y una fila aquí.
