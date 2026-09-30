# Extensiones (Expansions) de BloomX

Catálogo y estado real, 2026-09-29. Cómo se construyen: [`expansions/howto.md`](expansions/howto.md). Configuración de Google: [`expansions/google_setup.md`](expansions/google_setup.md).

Las 21 extensiones viven en `bloomx-extensions/` (manifest + `server.js`), se publican a Neon/B2 con `sync-extensions.mjs` y cada dominio instala las suyas. **No hay flags `EXPANSION_*`** (eran del diseño anterior): que una extensión esté activa depende de que el dominio la tenga instalada y habilitada (`ExtensionOnDomain.enabled`).

## Estado

Leyenda: **OK** funciona de punta a punta · **Cred.** requiere credenciales del dominio (§Credenciales) · **Parcial** · **Off** deshabilitada (`status: "disabled"`, no se monta).

| Extensión | ID | Estado | Qué hace / límites |
|---|---|---|---|
| Calendar | `core-calendar` | OK | Evento con `.ics` + HTML de invitación; `extractEvent` con IA. `slashCommands` no se consumen. |
| Zoom | `core-zoom` | OK · Cred. | `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` del dominio; si faltan responde "Zoom is not configured". |
| Google Meet | `core-google-meet` | OK | Cuenta Google vinculada del usuario; alternativa: `GOOGLE_CLIENT_ID/SECRET` + `GOOGLE_MEET_ADMIN_REFRESH_TOKEN` del dominio. |
| Google Drive | `core-google-drive` | Parcial | Lista e inserta enlaces (saneados). `uploadFile` existe en servidor sin UI. |
| Google Sync | `core-google-sync` | Parcial | Solo UI (`/api/google/sync`); sin `server.js`, no se publica. |
| Appointments | `core-appointments` | Parcial | UI sobre `/api/appointments/schedules`; sin `server.js`, no se publica. |
| Notion | `core-notion` | OK · Cred. | `NOTION_API_KEY`, `NOTION_DATABASE_ID`. |
| Trello | `core-trello` | OK · Cred. | `TRELLO_KEY`, `TRELLO_TOKEN` (van en cabecera, no en la URL). |
| HubSpot | `core-hubspot` | OK · Cred. | OAuth del dominio o `HUBSPOT_ACCESS_TOKEN`; `HUBSPOT_PORTAL_ID` para el enlace al contacto. |
| Giphy | `core-giphy` | OK · Cred. | `GIPHY_API_KEY` (del dominio, o global si el operador la lista en `EXTENSION_GLOBAL_ENV_FALLBACK`). Vive en la barra del composer. |
| Composer Helper | `core-composer-helper` | OK | Redacción con IA. |
| Summarizer / Translator / Smart Reply | `core-summarizer` `core-translator` `core-smart-reply` | Parcial | Handlers correctos; en el correo abierto `emailContent` es el extracto (snippet) hasta que MailView pase el cuerpo (ver howto §7). |
| Mail Groups | `core-mail-groups` | OK | Alias `@equipo` → miembros. Ajustes nativos (Ajustes → Mail Groups, se guardan en `/api/settings`); expansión vía `ON_RECIPIENTS_CHANGE_HANDLER`. |
| Email Signature | `core-signature` | OK | Firma en Ajustes (pestaña de la extensión); se guarda cifrada **en ese navegador**, sin caducidad; se añade al abrir el composer. |
| DLP | `core-dlp` | OK | **Bloquea el envío** (`POST /api/emails` → 422) si detecta palabras clave (`DLP_KEYWORDS`), tarjetas (Luhn), IBAN, SSN, claves privadas o secretos; si el escaneo falla, también bloquea (`onError: "block"`). |
| Webhooks | `core-webhooks` | Parcial | Handler firmado con HMAC (`WEBHOOK_URL`, `WEBHOOK_SECRET`). El ejecutor `EMAIL_RECEIVED` existe; falta llamarlo desde el webhook de Resend (`runEmailReceivedHooks`). |
| Slash Commands | `core-slash-commands` | Parcial | Declarativo; el editor no consume `slashCommands` todavía. |
| Auto Organizer | `core-organizer` | Off | `organize` clasifica con IA los correos que recibe, pero el sandbox no puede leer el buzón ni aplicar etiquetas. Ya no simula éxito. |
| Sealer | `core-sealer` | Off | **No cifra nada.** Requiere directorio de claves públicas y un hook de envío que no existen (`Domain.publicKey` es un UUID). El handler falla cerrado. |

Ya no existen en el código ni en esta lista: `core-slack`, `core-templates`, `core-confidential`, `core-followup`, `core-crm`.

## Seguridad (resumen)

- **Ejecución autenticada**: `/api/extension/execute` y `/api/extension/hooks` exigen el JWT de sesión (`NEXTAUTH_SECRET` compartido) o el secreto de servicio; fallan cerrado sin configuración en producción.
- **Sandbox** `node:vm` sin objetos del host; `process.env` solo con las variables `ENV_READ:*` permitidas (lista de reservadas en `manifest-schema.ts`); `fetch` con protección SSRF. Sigue sin ser una frontera fuerte: para código de terceros usar `isolated-vm`/contenedor.
- **Manifests validados** con schema en carga (frontend), publicación (`admin/extensions`) y lectura de repositorio.
- **Renderer**: evaluador de expresiones sin `eval`, URLs saneadas, contexto saneado hacia el backend, `auth`/`user`/`env` fijados solo por el servidor.
- **Multi-tenant**: credenciales por dominio cifradas; el fallback al entorno global de credenciales exige autorización explícita del operador.
- **Almacenamiento local** (`SECURE_SAVE`): AES-256-GCM con clave no extraíble por usuario, sin caducidad; ver los límites en el howto §4.

## Credenciales por dominio

```
PUT /api/extension/settings
{ "domainId": "…", "extensionId": "core-notion",
  "credentials": { "NOTION_API_KEY": "secret_…", "NOTION_DATABASE_ID": "…" } }
```
Cookie de sesión del manager (propietario del dominio). Requiere `DATA_ENCRYPTION_KEY` en producción. Operador: `EXTENSION_GLOBAL_ENV_FALLBACK=GIPHY_API_KEY` (o `*`) permite que un dominio sin credencial propia use la variable global.

## Variables de entorno relevantes

| Variable | Dónde | Uso |
|---|---|---|
| `NEXTAUTH_SECRET` | ambos (mismo valor) | JWT de sesión que el backend verifica. |
| `DATA_ENCRYPTION_KEY` | backend | Cifrado de credenciales por dominio. |
| `EXTENSION_HOOKS_SECRET` / `INTERNAL_SECRET` | ambos (mismo valor) | Llamadas de servicio a `/api/extension/hooks` (EMAIL_RECEIVED, CRON). |
| `EXTENSION_GLOBAL_ENV_FALLBACK` | backend | Variables sensibles que un dominio puede tomar del entorno global. |
| `EXTENSION_HOOKS_FAIL_CLOSED` / `EXTENSION_HOOKS_DISABLED` | frontend | Política si el backend no evalúa los hooks de `EMAIL_PRE_SEND`. |

Para actualizar este catálogo al añadir una extensión: manifest + `npm test` en `bloomx-extensions`, y una fila aquí.
