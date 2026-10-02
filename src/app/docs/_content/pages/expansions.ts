import type { Block, DocPageContent } from '../types';
import { CAPABILITY_REGISTRY } from '@/lib/expansions/client-contract';

const domainConfigManifest = `"settingsSchema": {
  "groups": [{ "id": "scan", "label": { "es": "Análisis", "en": "Scanning" } }],
  "fields": [
    { "key": "mode", "type": "enum", "group": "scan", "default": "block", "legacyEnv": "DLP_MODE",
      "label": { "es": "Modo", "en": "Mode" },
      "options": [{ "value": "block", "label": { "es": "Bloquear", "en": "Block" } }, "warn", "log"] },
    { "key": "keywords", "type": "list", "group": "scan", "maxItems": 100, "itemMaxLength": 100,
      "legacyEnv": "DLP_KEYWORDS", "label": { "es": "Palabras clave", "en": "Keywords" } },
    { "key": "GIPHY_API_KEY", "type": "string", "secret": true, "required": true,
      "label": { "es": "Clave de API", "en": "API key" } }
  ]
}`;
const userFieldsManifest = `"settingsSchema": {
  "fields": [
    { "key": "owner", "type": "user", "label": { "es": "Responsable", "en": "Owner" }, "filter": { "minLevel": 3 } },
    { "key": "recipients", "type": "users", "maxItems": 10, "label": { "es": "Destinatarios", "en": "Recipients" } },
    { "key": "digest", "type": "userMap", "valueType": "boolean", "default": false,
      "label": { "es": "Recibe el resumen", "en": "Gets the digest" } },
    { "key": "dailyLimit", "type": "userMap", "valueType": "number", "min": 1, "max": 500, "integer": true, "default": 20,
      "label": { "es": "Límite diario por usuario", "en": "Daily limit per user" } },
    { "key": "API_TOKEN", "type": "secret", "pattern": "^tok_[A-Za-z0-9]{16,}$", "revealLast4": true,
      "label": { "es": "Token de la API", "en": "API token" } }
  ]
}`;
const userFieldsUsageEs = `// server.js
module.exports = {
    async sendDigest(ctx) {
        const { owner, recipients, digest } = ctx.settings;   // owner = id; recipients = ids; digest = { [userId]: boolean } (solo entradas explicitas)
        const wants = (id) => ctx.settings.forUser('digest', id);          // entrada explicita o default del schema
        const limit = ctx.settings.getUserValue('dailyLimit', ctx.user.id); // numero, o 20 si el usuario no tiene entrada
        const token = ctx.env.API_TOKEN;                                   // secreto write-only: solo existe aqui, dentro del sandbox
        if (!wants(ctx.user.id)) return { skipped: 'opt-out' };
        // ... un id eliminado sigue llegando como id: comprueba con ctx.services.users.get(id) si lo necesitas
    }
};`;
const userFieldsUsageEn = userFieldsUsageEs.replace('// server.js', '// server.js').replace('(solo entradas explicitas)', '(explicit entries only)').replace('entrada explicita o default del schema', 'explicit entry or the schema default').replace('numero, o 20 si el usuario no tiene entrada', 'a number, or 20 when the user has no entry').replace('secreto write-only: solo existe aqui, dentro del sandbox', 'write-only secret: only exists here, inside the sandbox').replace('un id eliminado sigue llegando como id: comprueba con ctx.services.users.get(id) si lo necesitas', 'a deleted id still arrives as an id: check with ctx.services.users.get(id) if you need to');

const domainConfigUsageEs = `// server.js: los ajustes NO secretos llegan en ctx.settings; los secretos, en ctx.env
module.exports = {
    async onEmailPreSend(ctx) {
        const mode = ctx.settings.mode || 'block';          // dominio > heredado > defecto
        const keywords = ctx.settings.keywords || [];
        const key = ctx.env.GIPHY_API_KEY;                  // credencial cifrada del dominio
        // ...
    }
};`;
const domainConfigUsageEn = `// server.js: non-secret settings arrive in ctx.settings; secrets in ctx.env
module.exports = {
    async onEmailPreSend(ctx) {
        const mode = ctx.settings.mode || 'block';          // domain > legacy > default
        const keywords = ctx.settings.keywords || [];
        const key = ctx.env.GIPHY_API_KEY;                  // encrypted domain credential
        // ...
    }
};`;


const manifestMin = `{
  "manifestVersion": "1.0",
  "id": "core-dlp",
  "version": "1.0.0",
  "name": "Data Loss Prevention",
  "permissions": ["READ_EMAIL", "ENV_READ:DLP_KEYWORDS"],
  "api": {
    "runtime": "nodejs",
    "entry": "server.js",
    "functions": { "scanContent": { "handler": "scanContent", "timeout": 5000 } }
  },
  "intercepts": [
    { "point": "EMAIL_PRE_SEND", "handler": "scanContent", "priority": "HIGH", "onError": "block" }
  ]
}`;

const handlerEx = `// server.js  (CommonJS, o "export function")
module.exports = {
    // UN solo parámetro: ctx
    scanContent: async (ctx) => {
        const text = String(ctx.emailContent || '');
        const words = String(ctx.env.DLP_KEYWORDS || '').split(',').filter(Boolean);
        const hit = words.find((w) => text.toLowerCase().includes(w.trim().toLowerCase()));
        if (hit) return { stop: true, message: 'Contenido bloqueado por política: ' + hit };
        return { success: true };
    },
};`;

const handlerExEn = handlerEx
    .replace('// server.js  (CommonJS, o "export function")', '// server.js  (CommonJS, or "export function")')
    .replace('// UN solo parámetro: ctx', '// ONE parameter only: ctx')
    .replace("'Contenido bloqueado por política: '", "'Blocked by policy: '");

const slashEx = `"slashCommands": [
  { "key": "shrug", "description": "Insertar ¯\\\\_(ツ)_/¯", "action": { "action": "INSERT_CONTENT", "content": "¯\\\\_(ツ)_/¯" } },
  { "key": "ai", "description": "Redactar con IA", "arguments": "<tema>",
    "action": { "action": "OPEN_OVERLAY", "targetId": "ai-dialog", "passArgs": true } }
]`;

// ---------------------------------------------------------------------------------------------------------------
// Servicios autorizados, eventos de ciclo de vida, puntos de montaje y permisos. Los ejemplos se adaptan a extensiones
// reales del repositorio (summarizer, hubspot, notion, trello y signature).
// ---------------------------------------------------------------------------------------------------------------

const CM: Record<string, { es: string; en: string }> = {
    c1: { es: 'modo legado o sin permiso: degradar', en: 'legacy mode or no permission: degrade' },
    c2: { es: 'Permisos: CALENDAR_READ, CALENDAR_WRITE, NOTIFY', en: 'Permissions: CALENDAR_READ, CALENDAR_WRITE, NOTIFY' },
    c3: { es: "p. ej. 'CALENDAR_PERMISSION_DENIED: services.calendar.createEvent requires CALENDAR_WRITE ...'", en: "e.g. 'CALENDAR_PERMISSION_DENIED: services.calendar.createEvent requires CALENDAR_WRITE ...'" },
    c4: { es: 'Reunion', en: 'Meeting' },
    c5: { es: 'Evento creado', en: 'Event created' },
    c6: { es: '{ value: null } si no existe', en: '{ value: null } if it does not exist' },
    c7: { es: '{ ok: true, usedBytes, quotaBytes }', en: '{ ok: true, usedBytes, quotaBytes }' },
    c8: { es: 'valor > 64 KB o clave invalida', en: 'value > 64 KB or invalid key' },
    c9: { es: 'cuota de 256 KB agotada', en: '256 KB quota exhausted' },
    c10: { es: 'Permiso: STORAGE. Contador persistente por usuario y extension.', en: 'Permission: STORAGE. Persistent per-user, per-extension counter.' },
    c11: { es: 'Permiso: FORMATS. Todo devuelve una Promise; sin permiso falla con FORMATS_PERMISSION_DENIED.', en: 'Permission: FORMATS. Everything returns a Promise; without the permission it fails with FORMATS_PERMISSION_DENIED.' },
    c12: { es: 'texto con formato local (string)', en: 'locally formatted text (string)' },
    c13: { es: 'CRLF, escapes y folding a 75 octetos ya aplicados', en: 'CRLF, escaping and 75-octet folding already applied' },
    c14: { es: 'Liquid; un fallo de render es un error, nunca la plantilla cruda', en: 'Liquid; a render failure is an error, never the raw template' },
    c15: { es: 'hook CONTACT_SAVED, ctx = { contactId, email, created, source, event, userId, settings, services }', en: 'CONTACT_SAVED hook, ctx = { contactId, email, created, source, event, userId, settings, services }' },
    c16: { es: 'modo legado: los hooks de ciclo de vida ni se disparan', en: 'legacy mode: lifecycle hooks are not fired at all' },
    c17: { es: 'un hook nunca debe lanzar', en: 'a hook must never throw' },
    c18: { es: 'Nuevo contacto: ', en: 'New contact: ' },
};

const objectsEx = `"settingsSchema": {
  "fields": [{
    "key": "endpoints", "type": "objects", "required": true, "maxItems": 20,
    "label": { "es": "Endpoints", "en": "Endpoints" },
    "itemFields": [
      { "key": "name", "type": "string", "required": true, "label": "Name" },
      { "key": "url", "type": "string", "format": "url", "required": true, "label": "URL" },
      { "key": "secret", "type": "string", "secret": true, "required": true, "label": "Signing secret" }
    ],
    "templates": [{ "id": "slack", "label": "Slack", "value": { "name": "Slack", "url": "https://hooks.example.com/x" } }]
  }],
  "actions": [{ "id": "send-test", "label": "Send test event", "handler": "sendTest", "scope": "item", "itemsKey": "endpoints" }],
  "runLog": { "limit": 50 }
}`;
const webhookPayload = `{ "id": "7b0c2f0e-...", "type": "email.received", "version": 1, "createdAt": "2026-01-01T10:00:00.000Z",
  "data": { "emailId": "...", "userId": "...", "timestamp": "..." } }`;
const webhookNode = `const crypto = require('node:crypto');

// rawBody: el cuerpo CRUDO recibido (string/Buffer), sin reserializar
function verify(rawBody, headers, secret, toleranceSec = 300) {
  const ts = Number(headers['x-bloomx-timestamp']);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > toleranceSec) return false; // anti-replay
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(\`\${ts}.\${rawBody}\`).digest('hex');
  const got = String(headers['x-bloomx-signature'] || '');
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}`;
const webhookPy = `import hashlib, hmac, time

def verify(raw_body: bytes, headers: dict, secret: str, tolerance: int = 300) -> bool:
    try:
        ts = int(headers["X-BloomX-Timestamp"])
    except (KeyError, ValueError):
        return False
    if abs(time.time() - ts) > tolerance:
        return False
    signed = f"{ts}.".encode() + raw_body
    expected = "sha256=" + hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, headers.get("X-BloomX-Signature", ""))`;

const tr = (code: string, l: 'es' | 'en'): string => code.replace(/@@(\w+)@@/g, (_m, k: string) => CM[k][l]);

const servicesCode = `// server.js
// @@c2@@
module.exports = {
    bookFirstSlot: async (ctx) => {
        const { calendar, notify } = ctx.services || {};
        if (!calendar) return { success: false, code: 'CALENDAR_SERVICE_UNAVAILABLE' };   // @@c1@@
        try {
            const from = new Date().toISOString();
            const to = new Date(Date.now() + 7 * 86400000).toISOString();
            const { slots } = await calendar.findFreeSlots({ from, to, durationMinutes: 30, timeZone: 'Europe/Madrid', limit: 1 });
            if (slots.length === 0) return { success: false, code: 'NO_SLOT' };
            const title = String((ctx.args && ctx.args.title) || '@@c4@@').slice(0, 200);
            const { event } = await calendar.createEvent({ title, startsAt: slots[0].start, endsAt: slots[0].end });
            if (notify) await notify.toast({ message: '@@c5@@', level: 'success', url: '/calendar' }).catch(() => {});
            return { success: true, eventId: event.id };
        } catch (error) {
            // @@c3@@
            return { success: false, code: String(error.message).split(':')[0] };
        }
    },
};`;

const storageCode = `// @@c10@@
const storage = ctx.services && ctx.services.storage;
if (!storage) return { success: false, code: 'STORAGE_SERVICE_UNAVAILABLE' };
try {
    const current = await storage.get({ key: 'stats/opened' });          // @@c6@@
    const count = (current.value && current.value.count) || 0;
    await storage.set({ key: 'stats/opened', value: { count: count + 1 } });   // @@c7@@
    const page = await storage.list({ prefix: 'stats/', limit: 20 });    // { keys, usedBytes, quotaBytes }
    await storage.delete({ key: 'stats/old' });                          // { deleted: boolean }
} catch (error) {
    if (String(error.message).startsWith('STORAGE_INVALID_ARGS')) { /* @@c8@@ */ }
    if (error.message === 'STORAGE_ERROR: quota_exceeded') { /* @@c9@@ */ }
}`;

const formatsCode = `// @@c11@@
const f = ctx.services && ctx.services.formats;
if (!f) return { success: false, code: 'FORMATS_SERVICE_UNAVAILABLE' };

const when = await f.formatDate({ value: '2026-10-05T15:30:00Z', locale: 'es-ES', timeZone: 'Europe/Madrid', style: 'long' });   // @@c12@@
const price = await f.formatNumber({ value: 1234.5, locale: 'es-ES', style: 'currency', currency: 'EUR' });                  // @@c12@@

const { ics } = await f.buildIcs({                                   // @@c13@@
    method: 'REQUEST',
    events: [{ summary: 'Demo, con coma; y punto y coma', startsAt: '2026-10-05T15:30:00Z', endsAt: '2026-10-05T16:00:00Z',
               attendees: [{ email: 'ana@example.com', name: 'Ana' }] }],
});
const { events } = await f.parseIcs({ ics });                        // [{ uid, summary, startsAt, endsAt, allDay, attendees, ... }]

const { vcard } = await f.buildVcard({ version: '4.0', contacts: [{ name: 'Ana Perez', email: 'ana@example.com', org: 'Acme' }] });
const { contacts } = await f.parseVcard({ vcard });                  // [{ name, email, phone, org, title, note }]

const { text } = await f.renderTemplate({ template: 'Hola {{ nombre }}', variables: { nombre: 'Ana' } });   // @@c14@@
const { html } = await f.sanitizeHtml({ html: '<p onclick="x()">Hola</p><script>x()</script>' });`;

const lifecycleManifest = `{
  "manifestVersion": "1.0",
  "id": "contact-welcome",
  "version": "1.0.0",
  "name": "Contact welcome",
  "permissions": ["CONTACTS_READ", "STORAGE", "NOTIFY"],
  "api": {
    "runtime": "nodejs",
    "entry": "server.js",
    "functions": { "onContactSaved": { "handler": "onContactSaved", "timeout": 8000 } }
  },
  "hooks": [
    { "point": "CONTACT_SAVED", "handler": "onContactSaved", "priority": "NORMAL" }
  ]
}`;

const lifecycleCode = `// server.js
module.exports = {
    // @@c15@@
    onContactSaved: async (ctx) => {
        const { storage, contacts, notify } = ctx.services || {};
        if (!storage || !ctx.created) return { skipped: true };     // @@c16@@
        try {
            const key = 'seen/' + ctx.contactId;
            const seen = await storage.get({ key });
            if (seen.value) return { skipped: true, reason: 'already_seen' };
            const found = contacts ? await contacts.get({ contactId: ctx.contactId }) : { contact: null };
            const label = (found.contact && found.contact.name) || ctx.email || ctx.contactId;
            await storage.set({ key, value: { at: new Date().toISOString() } });
            if (notify) await notify.toast({ message: '@@c18@@' + String(label).slice(0, 150), level: 'info' });
            return { success: true };
        } catch (error) {
            return { success: false, code: String(error.message).split(':')[0] };   // @@c17@@
        }
    },
};`;

const mountsManifest = `{
  "manifestVersion": "1.0",
  "id": "sender-context",
  "version": "1.0.0",
  "name": "Sender context",
  "permissions": ["CONTACTS_READ", "STORAGE"],
  "api": {
    "runtime": "nodejs",
    "entry": "server.js",
    "functions": {
      "lookupSender": { "handler": "lookupSender" },
      "savePrefs": { "handler": "savePrefs" }
    }
  },
  "mounts": [
    {
      "point": "EMAIL_READER_SIDEBAR",
      "component": {
        "type": "CARD",
        "props": { "title": "Sender" },
        "children": [
          { "type": "HEADLESS", "props": { "onLoad": {
            "action": "CALL_BACKEND", "function": "lookupSender",
            "args": { "email": "\${context.fromContact.email}" },
            "onSuccess": { "action": "SET_STATE", "key": "sender", "value": "\${result}" }
          } } },
          { "type": "TEXT", "props": { "content": "\${state.sender.name}" } }
        ]
      }
    },
    {
      "point": "SETTINGS_PANEL",
      "component": {
        "type": "FORM",
        "props": { "onSubmit": {
          "action": "CALL_BACKEND", "function": "savePrefs",
          "args": { "label": "\${formData.label}" },
          "onSuccess": { "action": "TOAST", "message": "Saved" }
        } },
        "children": [ { "type": "INPUT", "props": { "name": "label", "label": "Label" } } ]
      }
    }
  ]
}`;

const servicesEs: Block[] = [
    { t: 'h2', id: 'services', text: 'Servicios del sandbox (services.*)' },
    { t: 'p', text: 'Además de `services.ai`, `services.auth` y `services.mail`, el sandbox ofrece cinco servicios con acceso controlado a los datos del usuario: `services.calendar`, `services.contacts`, `services.storage`, `services.notify` y `services.formats`. Cada operación es `await ctx.services.<servicio>.<operación>(args)`: **un único objeto** de argumentos y una Promise que resuelve con el `data` de la respuesta. Las tablas reflejan la validación real del backend (`host-services.ts`, `formats-service.ts`).' },
    { t: 'h3', id: 'services-security', text: 'Modelo de seguridad' },
    { t: 'ul', items: [
        '**Solo dominios firmados.** Las llamadas salen firmadas con Ed25519 con la clave del backend hacia `/api/internal/<servicio>` del frontend del dominio. En **modo legado** `ctx.services.calendar|contacts|storage|notify|formats` no existe (ausente): la extensión debe **degradar** (`if (!ctx.services?.calendar) ...`). Sin clave de firma en el backend solo queda `services.formats` (operaciones locales).',
        '**`userId` lo fija el host** a partir de la identidad firmada del dominio (`X-User-Id`); la extensión **nunca** puede elegirlo ni pasarlo en `args`. El `extensionId` (namespacing de `storage` y atribución de `notify`) también lo fija el host.',
        '**Propiedad por usuario.** Toda consulta y escritura filtra por el usuario; un id ajeno se comporta como inexistente (`not_found`, sin oráculo). Los calendarios de solo lectura no se pueden escribir (`read_only`).',
        '**Sin secretos.** Nunca se exponen tokens de Google, `externalId`, `syncToken` ni `inviteUid`. Los errores no llevan detalles internos ni datos personales.',
        '**Mínimo privilegio.** Cada operación exige un permiso del manifest; sin él, falla con `<SERVICIO>_PERMISSION_DENIED` (no con un "undefined is not a function").',
        '**Argumentos estrictos.** Una clave desconocida es error (`<SERVICIO>_INVALID_ARGS`). El frontend revalida con zod estricto.',
        '**Anti-bucle.** Los cambios hechos por `services.*` **no disparan** hooks de ciclo de vida (p. ej. crear un evento con `createEvent` no emite `CALENDAR_EVENT_CREATED`).',
    ] },
    { t: 'h3', id: 'services-calendar', text: 'services.calendar' },
    { t: 'p', text: 'Fechas en ISO 8601. Un `Event` es `{id, calendarId, title, description, location, startsAt, endsAt, allDay, status, responseStatus, source, organizerEmail, conferenceUrl, attendees:[{email,name,responseStatus}]}`.' },
    { t: 'table', head: ['Operación', 'Permiso', 'Argumentos y límites', 'Resultado'], rows: [
        ['`listCalendars`', '`CALENDAR_READ`', '`{}`', '`{calendars:[{id,name,color,source,isReadOnly}]}`'],
        ['`listEvents`', '`CALENDAR_READ`', '`{from, to, limit?, calendarId?}`. `to > from`, rango máx. **92 días**, `limit` 1–200 (50)', '`{events, truncated}`'],
        ['`getEvent`', '`CALENDAR_READ`', '`{eventId}`', '`{event}` (`null` si no existe)'],
        ['`findFreeSlots`', '`CALENDAR_READ`', '`{from, to, durationMinutes, limit?, timeZone?, workdayStart?, workdayEnd?, stepMinutes?, calendarId?}`. Rango máx. **31 días**; duración 5–480; `limit` 1–50 (10); `stepMinutes` 5–120 (15); `timeZone` IANA (`UTC`); jornada `HH:MM` (`09:00`–`18:00`)', '`{slots:[{start,end}], timeZone}`'],
        ['`createEvent`', '`CALENDAR_WRITE`', '`{title, startsAt, endsAt, calendarId?, description?, location?, allDay?, attendees?}`. Título 1–200, descripción ≤5000, lugar ≤300, `endsAt ≥ startsAt`, ≤50 asistentes `{email, name?}`. Sin `calendarId`: el primer calendario local no de solo lectura', '`{event}`'],
        ['`updateEvent`', '`CALENDAR_WRITE`', '`{eventId, title?, description?, location?, startsAt?, endsAt?, allDay?}`; al menos un campo', '`{event}`'],
        ['`deleteEvent`', '`CALENDAR_WRITE`', '`{eventId}` (cancela el evento, como la ruta de la app)', '`{deleted:true, eventId}`'],
        ['`addInvite`', '`CALENDAR_WRITE`', '`{eventId, attendees}` con 1–20 entradas `{email, name?}`', '`{event}`'],
        ['`respondInvite`', '`CALENDAR_WRITE`', '`{eventId, response}` con `accepted`, `tentative` o `declined`', '`{event}`'],
    ] },
    { t: 'h3', id: 'services-contacts', text: 'services.contacts' },
    { t: 'p', text: 'Un `Contact` es `{id, email, name, notes, source, createdAt}`.' },
    { t: 'table', head: ['Operación', 'Permiso', 'Argumentos y límites', 'Resultado'], rows: [
        ['`search`', '`CONTACTS_READ`', '`{q, limit?}`: `q` 1–100, `limit` 1–50 (20)', '`{contacts}`'],
        ['`get`', '`CONTACTS_READ`', '`{contactId}` **o** `{email}` (exactamente uno)', '`{contact}` (`null` si no existe)'],
        ['`list`', '`CONTACTS_READ`', '`{limit?, offset?}`: `limit` 1–100 (50), `offset` 0–100000', '`{contacts, total, nextOffset}`'],
        ['`suggestMerges`', '`CONTACTS_READ`', '`{limit?}` 1–50 (20). Solo sugiere; no escribe', '`{groups:[{reason, contacts}]}` (`same_email_normalized` o `same_name`)'],
        ['`create`', '`CONTACTS_WRITE`', '`{email, name?, notes?}`: nombre ≤200, notas ≤5000. Si ya existe no sobrescribe', '`{contact, created}`'],
        ['`update`', '`CONTACTS_WRITE`', '`{contactId, name?, notes?, email?}`; al menos un campo. Un email ya existente da `conflict`', '`{contact}`'],
        ['`merge`', '`CONTACTS_WRITE`', '`{keepId, mergeIds}` con 1–10 ids distintos de `keepId`. Concatena notas y borra los fusionados', '`{contact, merged}`'],
    ] },
    { t: 'h3', id: 'services-storage', text: 'services.storage' },
    { t: 'p', text: 'Almacén clave-valor privado por usuario **y** extensión: una extensión no puede leer el de otra. Claves `^[A-Za-z0-9_.:/-]{1,128}$`; el valor es cualquier JSON serializable. Al borrar al usuario se borran sus filas.' },
    { t: 'table', head: ['Operación', 'Permiso', 'Argumentos y límites', 'Resultado'], rows: [
        ['`get`', '`STORAGE`', '`{key}`', '`{value}` (`null` si no existe)'],
        ['`set`', '`STORAGE`', '`{key, value}`: valor ≤ **64 KB** (JSON). Cuota total **256 KB** (claves + valores) por usuario y extensión; máx. 1000 claves', '`{ok:true, usedBytes, quotaBytes}`'],
        ['`delete`', '`STORAGE`', '`{key}`', '`{deleted}`'],
        ['`list`', '`STORAGE`', '`{prefix?, limit?}`: `limit` 1–100 (50)', '`{keys, usedBytes, quotaBytes}`'],
    ] },
    { t: 'code', lang: 'javascript', title: 'services.storage (contador y manejo de errores)', code: tr(storageCode, 'es') },
    { t: 'h3', id: 'services-notify', text: 'services.notify' },
    { t: 'table', head: ['Operación', 'Permiso', 'Argumentos y límites', 'Resultado'], rows: [
        ['`toast`', '`NOTIFY`', '`{message, title?, level?, url?}`: `message` 1–200, `title` ≤80, `level` `info` (por defecto), `success`, `warning` o `error`; `url` ruta relativa `/...` (sin `//`) o `https://`', '`{delivered:true}`'],
    ] },
    { t: 'p', text: 'El aviso se guarda y la interfaz lo muestra como toast (`GET /api/expansions/notifications`). Tope de **20 pendientes** por usuario y extensión y **30 por minuto** por extensión (`rate_limited`).' },
    { t: 'h3', id: 'services-users', text: 'services.users (solo lectura)' },
    { t: 'p', text: 'Permiso **`READ_USERS`** (riesgo **alto**: lo aprueba el administrador al instalar o actualizar la extensión). Lista y consulta las cuentas de **este** dominio: la fuente es la propia instancia (su base de datos) a través del puente firmado con la `executionGrant`, así que no hay forma de consultar otro dominio. Exige la capacidad `lifecycle.events.v2` (cliente con `clientApi` ≥ 7).' },
    { t: 'table', head: ['Operación', 'Permiso', 'Argumentos y límites', 'Resultado'], rows: [
        ['`list`', '`READ_USERS`', '`{limit?, cursor?, search?}`: `limit` 1–100 (50); `cursor` opaco de la página anterior; `search` 1–100 caracteres sobre correo o nombre', '`{users:[{id,email,name,createdAt}], nextCursor}` (`nextCursor` es `null` en la última página)'],
        ['`get`', '`READ_USERS`', '`get("ana@acme.com")`, `get("<id>")`, `{id}` o `{email}` (exactamente uno)', '`{user}` (`null` si no existe)'],
    ] },
    { t: 'ul', items: [
        '**Campos mínimos:** `id`, `email`, `name` y `createdAt`. Nunca contraseña ni hash, tokens, MFA, ajustes ni nivel de permiso.',
        '**Paginación estable** por cursor (fecha de alta + id): un alta durante el recorrido ni duplica ni salta filas.',
        '**Cuotas:** 30 llamadas por ejecución, **120 consultas por minuto por extensión** (`USERS_ERROR: rate_limited`) y límite por usuario en la ruta. Cada consulta queda en la auditoría (`extension.users.read`: quién, extensión, operación y número de filas; sin datos de las cuentas).',
        '**Permisos reales en dos sitios:** el backend (manifest) y la instancia (la `executionGrant` firmada por ella lleva los permisos); sin `READ_USERS` falla con `USERS_PERMISSION_DENIED`.',
        '**Solo dominios firmados.** En modo legado `ctx.services.users` no existe: degrada.',
    ] },
    { t: 'code', lang: 'javascript', title: 'Recorrer todas las cuentas', code: `let cursor = null;
do {
    const page = await ctx.services.users.list({ limit: 100, cursor: cursor ?? undefined });
    for (const u of page.users) { /* u.id, u.email, u.name, u.createdAt */ }
    cursor = page.nextCursor;
} while (cursor);` },
    { t: 'h3', id: 'services-shared', text: 'Estado compartido del dominio (storage.listShared)' },
    { t: 'p', text: 'Las claves de `services.storage` que empiezan por `shared/` se guardan en el espacio del usuario, pero **cualquier ejecución de la misma extensión** puede leerlas con `listShared({prefix: "shared/...", limit?})` (1–200, solo valores, sin quién las escribió). **Solo se escriben (`set`/`delete`) desde un hook de servidor**: la concesión firmada por la instancia lleva el evento que originó la ejecución, y sin él la escritura falla con `STORAGE_ERROR: forbidden`; así un usuario no puede añadirse a listas compartidas desde el navegador. `mail-groups` lo usa para el alta automática en grupos.' },
    { t: 'h3', id: 'services-example', text: 'Ejemplo completo' },
    { t: 'p', text: 'Busca un hueco libre, crea el evento y avisa al usuario. Es el patrón de `summarizer` (que solo crea eventos tras confirmación explícita), simplificado.' },
    { t: 'code', lang: 'javascript', title: 'Calendario y aviso, con degradación', code: tr(servicesCode, 'es') },
    { t: 'h3', id: 'services-limits', text: 'Límites por invocación' },
    { t: 'table', head: ['Límite', 'Valor'], rows: [
        ['Presupuesto de llamadas', '`calendar` 60, `contacts` 60, `storage` 100, `notify` 10, `users` 30, `formats` 200 (y 30 remotas: `renderTemplate` y `sanitizeHtml`). Cuentan también las fallidas'],
        ['Timeout por llamada', '15 s (`<SERVICIO>_SERVICE_TIMEOUT`)'],
        ['Tamaño de respuesta', '512 KB (`<SERVICIO>_RESPONSE_TOO_LARGE`)'],
        ['Cuota de `storage`', '256 KB por usuario y extensión; valor ≤ 64 KB'],
        ['`notify`', '20 pendientes por usuario y extensión; 30 por minuto por extensión'],
    ] },
    { t: 'h3', id: 'services-errors', text: 'Errores' },
    { t: 'p', text: 'Todo fallo es un `Error` cuyo mensaje empieza por el prefijo del servicio (`<P>`): `CALENDAR_`, `CONTACTS_`, `STORAGE_`, `NOTIFY_` o `FORMATS_`. Atrápalo con `try/catch` y decide.' },
    { t: 'table', head: ['Mensaje', 'Cuándo'], rows: [
        ['`<P>_PERMISSION_DENIED: services.x.op requires PERMISO in the extension manifest`', 'El manifest no declara el permiso de esa operación'],
        ['`<P>_INVALID_ARGS: <detalle>`', 'Operación desconocida, `args` que no son JSON o que no pasan la validación (clave desconocida, rango, tamaño…)'],
        ['`<P>_ERROR: <code>`', 'El frontend rechazó la operación. `code` es `invalid_args`, `not_found`, `forbidden`, `read_only`, `conflict`, `quota_exceeded` o `rate_limited`'],
        ['`<P>_SERVICE_ERROR (estado)`', 'Respuesta HTTP de error sin `code` conocido'],
        ['`<P>_SERVICE_UNAVAILABLE`', 'No hay puente (falta firma o URL), error de red o el frontend no responde'],
        ['`<P>_SERVICE_TIMEOUT`', 'La llamada superó 15 s'],
        ['`<P>_CALL_BUDGET`', 'Se superó el presupuesto de llamadas de la invocación'],
    ] },
    { t: 'h2', id: 'formats', text: 'services.formats (utilidades puras)' },
    { t: 'p', text: 'Requiere el permiso `FORMATS` (riesgo bajo: no accede a datos del usuario). Todo salvo plantillas y HTML se resuelve **en el propio backend**, sin red; `renderTemplate` y `sanitizeHtml` viajan al frontend por el puente firmado.' },
    { t: 'table', head: ['Operación', 'Argumentos y límites', 'Resultado'], rows: [
        ['`formatDate`', '`{value, locale?, timeZone?, style?}`: `value` ISO o epoch ms; `locale` validado con `Intl` (`en-US`); `timeZone` IANA (`UTC`); `style` `short`, `medium`, `long`, `full`, `date`, `time` o `datetime` (por defecto)', '`string`'],
        ['`formatNumber`', '`{value, locale?, style?, currency?, minimumFractionDigits?, maximumFractionDigits?}`: `style` `decimal`, `percent` o `currency` (exige `currency` ISO 4217); dígitos 0–10', '`string`'],
        ['`parseIcs`', '`{ics}` ≤ 200 KB', '`{events:[{uid, summary, description, location, startsAt, endsAt, allDay, organizerEmail, attendees:[{email,name,responseStatus}]}]}`'],
        ['`buildIcs`', '`{events, method?, calendarName?}`: 1–50 eventos (`summary` obligatorio; fechas ISO o epoch); `method` `PUBLISH` (por defecto), `REQUEST` o `CANCEL`', '`{ics}`'],
        ['`parseVcard`', '`{vcard}` ≤ 200 KB', '`{contacts:[{name, email, phone, org, title, note}]}` (máx. 100)'],
        ['`buildVcard`', '`{contacts, version?}`: 1–100 contactos (`name` obligatorio); `version` `3.0` (por defecto) o `4.0`', '`{vcard}`'],
        ['`renderTemplate`', '`{template, variables?}`: plantilla ≤ 20000; `variables` objeto plano de ≤ 50 claves escalares (texto ≤ 5000). Motor **Liquid** del frontend', '`{text}`'],
        ['`sanitizeHtml`', '`{html}` ≤ 200000', '`{html}`'],
    ] },
    { t: 'code', lang: 'javascript', title: 'Todas las utilidades', code: tr(formatsCode, 'es') },
    { t: 'ul', items: [
        '**ICS y vCard seguros.** En `buildIcs` y `buildVcard` los CR/LF y caracteres de control se eliminan de **todo** valor (no se puede inyectar una propiedad nueva), los textos se escapan (`\\`, `;`, `,` y saltos de línea) y las líneas se pliegan a **75 octetos** sin partir caracteres UTF-8, con CRLF. Los parámetros (`CN`) se limpian de comillas y separadores.',
        '`parseIcs` y `parseVcard` despliegan las líneas plegadas, desescapan y limpian controles; ignoran lo que no reconocen.',
        '`renderTemplate`: si la plantilla falla (sintaxis, límites) el error es `FORMATS_ERROR: invalid_args`; **nunca** se devuelve la plantilla sin renderizar. Escapa los valores de las variables que vayan a un HTML antes de interpolar (así lo hace `signature`).',
        '`sanitizeHtml` usa la misma configuración del sanitizador del frontend (DOMPurify: sin scripts, formularios, iframes ni URI peligrosas; los enlaces reciben `rel="noopener noreferrer nofollow"`), ejecutada en el **servidor** con un DOM, así que **conserva el formato seguro**. Si el DOM del servidor no estuviera disponible, degrada a texto escapado sin etiquetas (seguro, pero sin formato).',
        'Los fallos de las operaciones locales se reportan como `FORMATS_ERROR: invalid_args` (sin detalles internos).',
    ] },
    { t: 'h2', id: 'lifecycle', text: 'Eventos de ciclo de vida' },
    { t: 'p', text: 'Son nueve eventos de la aplicación a los que una extensión puede suscribirse. Se declaran como cualquier `intercept`: en `intercepts` o en su alias `hooks` (misma forma `{point, handler, priority?}`). El handler recibe `ctx = {...contexto, event, userId}` más `services`. La tabla muestra el contexto **mínimo y exacto**: el backend lo filtra con una lista blanca y descarta cualquier otro campo (asuntos, cuerpos, destinatarios…).' },
    { t: 'table', head: ['Evento', 'Contexto', 'Dónde se dispara'], rows: [
        ['`EMAIL_OPENED`', '`{emailId, folder, fromEmail, isRead}`', '`GET /api/emails/[id]` (como máximo una vez por minuto por usuario y correo)'],
        ['`EMAIL_SENT`', '`{emailId, toCount, ccCount, bccCount, hasAttachments, sentAt}`', '`POST /api/emails`, tras enviar (no los programados)'],
        ['`COMPOSE_OPENED`', '`{mode, inReplyToEmailId?, draftId?}` con `mode` `new`, `reply`, `replyAll` o `forward`', 'La interfaz avisa al abrir el editor con `POST /api/expansions/events`'],
        ['`CALENDAR_EVENT_CREATED`, `CALENDAR_EVENT_UPDATED`, `CALENDAR_EVENT_CANCELLED`', '`{eventId, calendarId, startsAt, endsAt, allDay, status, attendeeCount, source}`', '`POST /api/calendar/events`, y `PUT` y `DELETE` de `/api/calendar/events/[id]`'],
        ['`CONTACT_SAVED`', '`{contactId, email, created, source}`', '`POST /api/contacts` (`created:true`) y `PUT /api/contacts/[id]` (`created:false`)'],
        ['`CONTACT_DELETED`', '`{contactId}`', '`DELETE /api/contacts/[id]`'],
        ['`APPOINTMENT_BOOKED`', '`{bookingId, scheduleId, startsAt, endsAt, guestEmail, calendarEventId?}`', 'La reserva pública de citas (`POST /api/appointments/book/[scheduleId]`)'],
    ] },
    { t: 'code', lang: 'json', title: 'manifest.json: declarar el evento (alias hooks)', code: lifecycleManifest },
    { t: 'code', lang: 'javascript', title: 'server.js: onContactSaved (patrón de hubspot)', code: tr(lifecycleCode, 'es') },
    { t: 'h3', id: 'lifecycle-v2', text: 'Eventos v2 (lifecycle.events.v2)' },
    { t: 'p', text: 'Cinco eventos más, con payload **versionado** (`v: 1`) y mínimo. Cada uno exige un **permiso** en el manifest (si falta, `validateManifest` da error y el backend no invoca el handler) y la capacidad `lifecycle.events.v2` (`requires.clientApi` ≥ 7: los clientes antiguos siguen recibiendo la versión anterior de la extensión). No existe `USER_DELETED`: la plataforma no borra cuentas, solo las deshabilita.' },
    { t: 'table', head: ['Evento', 'Permiso', 'Contexto', 'Dónde se dispara'], rows: [
        ['`USER_CREATED`', '`READ_USERS`', '`{v, eventKey, subjectUserId, email, emailDomain, source, createdAt}`; `source`: `register`, `admin` o `import`', 'Autoregistro (`POST /api/register`), alta del administrador y creación de buzones al importar (`createUserAccount`)'],
        ['`USER_DISABLED`, `USER_ENABLED`', '`READ_USERS`', '`{v, eventKey, subjectUserId, email, emailDomain, disabledAt | enabledAt}`', 'Solo cuando el estado **cambia** (consola de administración); repetir el mismo estado no emite'],
        ['`EMAIL_SPAM_DETECTED`', '`READ_EMAIL`', '`{v, eventKey, emailId, fromEmail, fromDomain, verdict, action, score?, reasons[]}`; `verdict`: `spam`, `phishing` o `suspicious`; `action`: `junk` o `flag`', 'El motor anti-spam clasifica un correo entrante como spam o sospechoso. Sin asunto, cuerpo ni destinatarios'],
        ['`LABEL_APPLIED`', '`READ_EMAIL`', '`{v, eventKey, emailId, labelId, labelName?, source, ruleId?}`; `source`: `user`, `rule` o `system`', 'Etiqueta aplicada por una regla al recibir o con "Aplicar ahora" (máx. 50 correos por llamada) o por el usuario (editar etiquetas, "Mover a")'],
    ] },
    { t: 'ul', items: [
        '**El handler corre COMO el usuario afectado** en `USER_*` (`ctx.userId == subjectUserId`) y como el dueño del buzón en el resto; `ctx.services.users` permite leer el directorio.',
        '**Procedencia: `ctx.hook = {event, eventKey}`** lo fija solo el servidor (en `/execute` es siempre `null`, aunque el cliente envíe `context.hook`). Un handler que actúa sobre eventos v2 debe exigir `ctx.hook?.event === "..."`: el resto del contexto puede venir de un cliente.',
        '**Idempotencia:** `eventKey` es determinista por hecho (`uc:<id>`, `sp:<correo>`, `lb:<correo>:<etiqueta>`, …). El frontend descarta repeticiones del mismo hecho durante 10 min (60 s en etiquetas) y los consumidores deben deduplicar por `eventKey` (los webhooks usan un `id`/`X-BloomX-Delivery` estable derivado de él).',
        '**Asíncronos y aislados:** `after()`, timeout de 5 s en la llamada, ≤ 60 por minuto, y un fallo (backend caído, handler roto, timeout) solo deja una línea de log: **nunca** bloquea ni revierte el registro, el alta, la deshabilitación, la ingesta ni el etiquetado.',
        '**Privacidad por defecto:** sin contraseñas, hashes, tokens, asuntos ni cuerpos (lista blanca en el frontend y otra vez en el backend). La importación de correo y lo que hagan las extensiones con `services.*` no emiten estos eventos (anti-bucle).',
    ] },
    { t: 'h3', id: 'lifecycle-rules', text: 'Reglas y límites' },
    { t: 'ul', items: [
        '**No bloqueantes.** No pueden impedir ni modificar la acción: `stop` y `modify` se ignoran (solo `EMAIL_PRE_SEND` los admite). `onError: "block"` se ignora y `validateManifest` lo avisa. El frontend los lanza en segundo plano (`after()`), así que no retrasan la respuesta al usuario.',
        '**Solo dominios firmados.** En modo legado no se dispara ninguno. El `userId` sale de la identidad firmada, nunca del cuerpo.',
        '**Límites.** Como máximo **10 handlers** por evento (el resto se ignora), ordenados por prioridad; **timeout por handler ≤ 10 s** (el menor entre el del manifest y 10 s) y **presupuesto total de 20 s** (pasado el cual los handlers pendientes se omiten). La llamada del frontend espera como máximo 5 s.',
        '**Frecuencia.** El frontend emite como máximo **60 disparos por minuto por usuario y evento**; el exceso se descarta en silencio.',
        '**Anti-bucle.** Lo que hagas con `services.*` dentro del handler no vuelve a disparar eventos.',
        'Un `point` desconocido es un **error** de manifest; `EMAIL_PRE_SEND`, `EMAIL_RECEIVED` y `CRON` siguen su propia semántica (ver [Hooks](#hooks)).',
    ] },
    { t: 'h2', id: 'mount-points', text: 'Puntos de montaje y su contexto' },
    { t: 'p', text: 'Cada punto pasa a la extensión un contexto fijo (el registro `MOUNT_POINT_CONTEXT` de `src/lib/expansions/mount-points.ts`); se lee con expresiones `${context.clave}`. El contexto nunca incluye `auth`, `user`, `env` ni `services`: la identidad la pone el servidor. La columna **Estado** indica si hoy hay un `<ExtensionLoader>` que lo pinte, según el código del frontend.' },
    { t: 'table', head: ['Punto', 'Dónde', 'Contexto', 'Estado'], rows: [
        ['`EMAIL_TOOLBAR`', 'Barra del correo abierto', '`email`, `emailContent`, `fromContact`, `content`', 'Montado'],
        ['`EMAIL_HEADER`', 'Cabecera del correo abierto', 'Igual que `EMAIL_TOOLBAR`', 'Definido, sin pintar'],
        ['`EMAIL_FOOTER`', 'Pie (hoy, bajo el editor de redacción)', 'Contexto del editor', 'Montado (en el editor)'],
        ['`EMAIL_READER_SIDEBAR`', 'Panel lateral junto al correo abierto', '`email`, `emailContent`, `fromContact`, `content`', 'Definido, sin pintar'],
        ['`EMAIL_LIST_ROW_ACTION`', 'Acción por fila de la lista', 'Igual que `EMAIL_TOOLBAR`', 'Definido, sin pintar'],
        ['`CONTEXT_MENU`', 'Menú contextual de un correo', 'Igual que `EMAIL_TOOLBAR`', 'Definido, sin pintar'],
        ['`SIDEBAR_HEADER`, `SIDEBAR_FOOTER`', 'Barra lateral de la app', '`folder`, `unreadCounts?`', 'Montados'],
        ['`SIDEBAR_PANEL`', 'Panel propio en la barra lateral', '`folder`, `unreadCounts?`', 'Definido, sin pintar'],
        ['`COMPOSER_TOOLBAR`, `COMPOSER_INIT`', 'Editor de redacción', '`emailContent`, `subject`, `to`, `cc`, `bcc`, `sender`', 'Montados'],
        ['`COMPOSER_SIDEBAR`', 'Panel lateral del editor', 'Igual que `COMPOSER_TOOLBAR`', 'Definido, sin pintar'],
        ['`CALENDAR_TOOLBAR`', 'Barra del calendario', '`range:{from,to}`, `view`, `isGoogleLinked`', 'Montado'],
        ['`CALENDAR_EVENT_PANEL`', 'Detalle de un evento', '`event`, `calendarId`, `isReadOnly`', 'Definido, sin pintar'],
        ['`CALENDAR_HEADER`, `CALENDAR_SIDEBAR_BOTTOM`, `CALENDAR_ADD_SOURCES`', 'Calendario', '`isGoogleLinked`', 'Montados'],
        ['`CALENDAR_SIDEBAR`', 'Barra lateral del calendario', '`isGoogleLinked`', 'Definido, sin pintar'],
        ['`CONTACTS_TOOLBAR`', 'Barra de contactos', '`contactCount`, `isGoogleLinked`, `selectedIds`', 'Montado'],
        ['`CONTACTS_HEADER`, `CONTACTS_SIDEBAR`, `CONTACTS_SIDEBAR_BOTTOM`', 'Contactos', '`isGoogleLinked` (y `contactCount` en la cabecera)', 'Montados'],
        ['`CONTACT_CARD_PANEL`', 'Ficha de un contacto', '`contact:{id,email,name,notes,source}`', 'Definido, sin pintar'],
        ['`SETTINGS_PANEL`', 'Ajustes de la extensión', '`extensionId`, `settings` (valores no secretos)', 'Definido, sin pintar'],
    ] },
    { t: 'p', text: 'Los demás puntos (`EVENT_LOCATION_BUILDER`, `CUSTOM_SETTINGS_TAB`, `PAGE`, `OVERLAY`, `SLASH_COMMAND`, `*_HANDLER`…) mantienen su comportamiento anterior. Un punto que el schema conoce pero la interfaz aún no pinta **valida sin avisos y no se muestra**: no falla, pero no tiene efecto hasta que exista el consumidor.' },
    { t: 'code', lang: 'json', title: 'Manifest con EMAIL_READER_SIDEBAR y SETTINGS_PANEL', code: mountsManifest },
    { t: 'callout', kind: 'note', title: 'Estado de montaje', text: 'La columna **Estado** sale de buscar `<ExtensionLoader mountPoint=...>` en `src`. Cuando un punto pase de "definido" a "montado" su contexto no cambia: el contrato es el de la tabla.' },
];

const permissionsRowsEs: string[][] = [
    ['`READ_EMAIL`', 'Leer correo', 'Lee remitente, asunto y fragmento de los correos de la bandeja del usuario.', 'Alto'],
    ['`MAIL_LABEL`', 'Etiquetar correo', 'Aplica o deshace etiquetas de categoría en correos del usuario (no mueve, borra ni envía).', 'Medio'],
    ['`READ_USER`', 'Ver datos del usuario', 'Ve el identificador y el correo del usuario que ejecuta la extensión.', 'Bajo'],
    ['`READ_USER_NAME`', 'Ver nombre del usuario', 'Ve el nombre del usuario.', 'Bajo'],
    ['`AI_GENERATE`', 'Usar IA', 'Envía texto al proveedor de IA configurado por la instancia en `/admin/ai`, con guardarraíles y cuotas. Con la IA desactivada la extensión se bloquea ([IA](/docs/ai#blocking)). `core-composer-helper` es la única ayuda de redacción: no hay compositor nativo con IA.', 'Medio'],
    ['`HTTP_REQUEST`', 'Llamadas HTTP externas', 'Hace peticiones HTTPS a servicios externos (filtradas contra SSRF).', 'Alto'],
    ['`OAUTH_READ`', 'Leer tokens OAuth', 'Usa los tokens de las cuentas conectadas del dominio.', 'Alto'],
    ['`OAUTH_WRITE`', 'Gestionar conexiones OAuth', 'Conecta o desconecta cuentas de terceros.', 'Alto'],
    ['`API_ROUTE_CREATE`, `PAGE_ROUTE_CREATE`', 'Crear rutas de API / páginas', 'Declaran rutas o páginas propias (reservado).', 'Medio'],
    ['`DB_READ`, `DB_WRITE`', 'Leer / escribir base de datos', 'Datos de la extensión (reservado).', 'Medio'],
    ['`local:secure-storage`', 'Almacenamiento seguro del navegador', 'Guarda datos cifrados en el navegador del usuario.', 'Bajo'],
    ['`CALENDAR_READ`', 'Leer calendario', 'Lista y consulta eventos y huecos libres de los calendarios del usuario (sin tokens de Google).', 'Medio'],
    ['`CALENDAR_WRITE`', 'Modificar calendario', 'Crea, edita, cancela eventos e invita asistentes en calendarios del usuario.', 'Alto'],
    ['`CONTACTS_READ`', 'Leer contactos', 'Busca y lista los contactos del usuario y sugiere duplicados.', 'Medio'],
    ['`CONTACTS_WRITE`', 'Modificar contactos', 'Crea, edita y fusiona contactos del usuario.', 'Alto'],
    ['`FORMATS`', 'Formatos', 'Usa utilidades puras de fechas, números, ICS, vCard, plantillas y saneo de HTML (sin acceso a datos).', 'Bajo'],
    ['`STORAGE`', 'Almacenamiento propio', 'Guarda hasta 256 KB de estado de la extensión por usuario en el servidor.', 'Bajo'],
    ['`NOTIFY`', 'Notificaciones', 'Muestra avisos (toast) al usuario dentro de la aplicación.', 'Bajo'],
    ['`ENV_READ:NOMBRE`', 'Variable NOMBRE', 'Lee la credencial o variable configurada para este dominio.', 'Alto'],
];

const permissionsEs: Block[] = [
    { t: 'p', text: 'Una extensión puede declarar páginas completas (`PAGE`) y entradas de navegación (`navEntries`, capacidades `ui.pages.v1` y `nav.entries.v1`): ver la guía [Página completa y navegación](/docs/extension-pages).' },
    { t: 'h2', id: 'permissions', text: 'Permisos' },
    { t: 'p', text: 'El manifest declara los permisos que la extensión necesita. El catálogo (`PERMISSION_CATALOG` en el schema) da a cada uno una **etiqueta**, una **descripción** y un **riesgo**; es lo que ve el administrador del dominio.' },
    { t: 'table', head: ['Permiso', 'Etiqueta', 'Descripción', 'Riesgo'], rows: permissionsRowsEs },
    { t: 'ul', items: [
        '**Validación.** `validateManifest` comprueba que `permissions` sea una lista de strings; un permiso que no está en el catálogo produce un **aviso** (`Permiso desconocido`) y la plataforma lo ignora. `ENV_READ:NOMBRE` se valida aparte (`^[A-Z][A-Z0-9_]{1,63}$` y no reservada) y un nombre inválido es **error**.',
        '**Confirmación al instalar.** El administrador ve la lista legible (`describePermissions`: etiqueta, descripción y riesgo; los desconocidos se marcan como tales) y debe **confirmar** antes de instalar. Pide solo lo necesario: lo que pidas se le muestra tal cual.',
        '**Se hacen cumplir en el servidor:** `ENV_READ:*`, `READ_EMAIL`, `MAIL_LABEL` y los de servicios (`CALENDAR_*`, `CONTACTS_*`, `FORMATS`, `STORAGE`, `NOTIFY`). El ejecutor rechaza una operación de servicio sin su permiso con un error claro (`CALENDAR_PERMISSION_DENIED: services.calendar.createEvent requires CALENDAR_WRITE in the extension manifest`). El resto (`READ_USER`, `AI_GENERATE`, `HTTP_REQUEST`, `OAUTH_*`, `local:secure-storage`) documenta la intención y los reservados (`API_ROUTE_CREATE`, `PAGE_ROUTE_CREATE`, `DB_*`) no tienen efecto.',
        'Detalle de cada operación y su permiso: [Servicios del sandbox](#services).',
    ] },
    { t: 'callout', kind: 'note', title: 'Variables reservadas', text: 'No se pueden pedir con `ENV_READ`: `DATABASE_URL`, `DIRECT_URL`, `POSTGRES_*`, `PG*`, `B2_*`, `ADMIN_*`, `MP_*`, `NEXTAUTH_*`, `AUTH_*`, `DATA_ENCRYPTION_KEY`, `AI_*`, `OPENAI_*`, `RESEND_*`, `VERCEL*`, `NEXT_*`, `NODE_*`, `EXTENSION_*`, `INTERNAL_*`, `JWT_*`, `SESSION_*`, `AWS_*`, `GITHUB_*`, `NPM_*`, `PATH`, `HOME`, `USER*`.' },
];

const servicesEn: Block[] = [
    { t: 'h2', id: 'services', text: 'Sandbox services (services.*)' },
    { t: 'p', text: 'Besides `services.ai`, `services.auth` and `services.mail`, the sandbox offers five services with controlled access to the user\'s data: `services.calendar`, `services.contacts`, `services.storage`, `services.notify` and `services.formats`. Each operation is `await ctx.services.<service>.<operation>(args)`: **a single object** of arguments and a Promise that resolves to the response `data`. The tables mirror the backend\'s real validation (`host-services.ts`, `formats-service.ts`).' },
    { t: 'h3', id: 'services-security', text: 'Security model' },
    { t: 'ul', items: [
        '**Signed domains only.** Calls leave signed with Ed25519 using the backend key towards the domain frontend\'s `/api/internal/<service>`. In **legacy mode** `ctx.services.calendar|contacts|storage|notify|formats` does not exist (absent): the extension must **degrade** (`if (!ctx.services?.calendar) ...`). Without a signing key on the backend only `services.formats` (local operations) remains.',
        '**`userId` is set by the host** from the domain\'s signed identity (`X-User-Id`); the extension can **never** choose it or pass it in `args`. The `extensionId` (namespacing for `storage`, attribution for `notify`) is also set by the host.',
        '**Per-user ownership.** Every read and write filters by the user; a foreign id behaves as nonexistent (`not_found`, no oracle). Read-only calendars cannot be written (`read_only`).',
        '**No secrets.** Google tokens, `externalId`, `syncToken` and `inviteUid` are never exposed. Errors carry no internal details or personal data.',
        '**Least privilege.** Each operation requires a manifest permission; without it, it fails with `<SERVICE>_PERMISSION_DENIED` (not with "undefined is not a function").',
        '**Strict arguments.** An unknown key is an error (`<SERVICE>_INVALID_ARGS`). The frontend revalidates with strict zod.',
        '**Anti-loop.** Changes made through `services.*` **do not fire** lifecycle hooks (e.g. creating an event with `createEvent` does not emit `CALENDAR_EVENT_CREATED`).',
    ] },
    { t: 'h3', id: 'services-calendar', text: 'services.calendar' },
    { t: 'p', text: 'Dates are ISO 8601. An `Event` is `{id, calendarId, title, description, location, startsAt, endsAt, allDay, status, responseStatus, source, organizerEmail, conferenceUrl, attendees:[{email,name,responseStatus}]}`.' },
    { t: 'table', head: ['Operation', 'Permission', 'Arguments and limits', 'Result'], rows: [
        ['`listCalendars`', '`CALENDAR_READ`', '`{}`', '`{calendars:[{id,name,color,source,isReadOnly}]}`'],
        ['`listEvents`', '`CALENDAR_READ`', '`{from, to, limit?, calendarId?}`. `to > from`, max range **92 days**, `limit` 1–200 (50)', '`{events, truncated}`'],
        ['`getEvent`', '`CALENDAR_READ`', '`{eventId}`', '`{event}` (`null` if it does not exist)'],
        ['`findFreeSlots`', '`CALENDAR_READ`', '`{from, to, durationMinutes, limit?, timeZone?, workdayStart?, workdayEnd?, stepMinutes?, calendarId?}`. Max range **31 days**; duration 5–480; `limit` 1–50 (10); `stepMinutes` 5–120 (15); IANA `timeZone` (`UTC`); workday `HH:MM` (`09:00`–`18:00`)', '`{slots:[{start,end}], timeZone}`'],
        ['`createEvent`', '`CALENDAR_WRITE`', '`{title, startsAt, endsAt, calendarId?, description?, location?, allDay?, attendees?}`. Title 1–200, description ≤5000, location ≤300, `endsAt ≥ startsAt`, ≤50 attendees `{email, name?}`. Without `calendarId`: the first non-read-only local calendar', '`{event}`'],
        ['`updateEvent`', '`CALENDAR_WRITE`', '`{eventId, title?, description?, location?, startsAt?, endsAt?, allDay?}`; at least one field', '`{event}`'],
        ['`deleteEvent`', '`CALENDAR_WRITE`', '`{eventId}` (cancels the event, like the app route)', '`{deleted:true, eventId}`'],
        ['`addInvite`', '`CALENDAR_WRITE`', '`{eventId, attendees}` with 1–20 `{email, name?}` entries', '`{event}`'],
        ['`respondInvite`', '`CALENDAR_WRITE`', '`{eventId, response}` with `accepted`, `tentative` or `declined`', '`{event}`'],
    ] },
    { t: 'h3', id: 'services-contacts', text: 'services.contacts' },
    { t: 'p', text: 'A `Contact` is `{id, email, name, notes, source, createdAt}`.' },
    { t: 'table', head: ['Operation', 'Permission', 'Arguments and limits', 'Result'], rows: [
        ['`search`', '`CONTACTS_READ`', '`{q, limit?}`: `q` 1–100, `limit` 1–50 (20)', '`{contacts}`'],
        ['`get`', '`CONTACTS_READ`', '`{contactId}` **or** `{email}` (exactly one)', '`{contact}` (`null` if it does not exist)'],
        ['`list`', '`CONTACTS_READ`', '`{limit?, offset?}`: `limit` 1–100 (50), `offset` 0–100000', '`{contacts, total, nextOffset}`'],
        ['`suggestMerges`', '`CONTACTS_READ`', '`{limit?}` 1–50 (20). Only suggests; writes nothing', '`{groups:[{reason, contacts}]}` (`same_email_normalized` or `same_name`)'],
        ['`create`', '`CONTACTS_WRITE`', '`{email, name?, notes?}`: name ≤200, notes ≤5000. If it already exists it does not overwrite', '`{contact, created}`'],
        ['`update`', '`CONTACTS_WRITE`', '`{contactId, name?, notes?, email?}`; at least one field. An already existing email gives `conflict`', '`{contact}`'],
        ['`merge`', '`CONTACTS_WRITE`', '`{keepId, mergeIds}` with 1–10 ids different from `keepId`. Concatenates notes and deletes the merged ones', '`{contact, merged}`'],
    ] },
    { t: 'h3', id: 'services-storage', text: 'services.storage' },
    { t: 'p', text: 'Private key-value store per user **and** extension: an extension cannot read another\'s. Keys `^[A-Za-z0-9_.:/-]{1,128}$`; the value is any serialisable JSON. Deleting the user deletes their rows.' },
    { t: 'table', head: ['Operation', 'Permission', 'Arguments and limits', 'Result'], rows: [
        ['`get`', '`STORAGE`', '`{key}`', '`{value}` (`null` if it does not exist)'],
        ['`set`', '`STORAGE`', '`{key, value}`: value ≤ **64 KB** (JSON). Total quota **256 KB** (keys + values) per user and extension; max 1000 keys', '`{ok:true, usedBytes, quotaBytes}`'],
        ['`delete`', '`STORAGE`', '`{key}`', '`{deleted}`'],
        ['`list`', '`STORAGE`', '`{prefix?, limit?}`: `limit` 1–100 (50)', '`{keys, usedBytes, quotaBytes}`'],
    ] },
    { t: 'code', lang: 'javascript', title: 'services.storage (counter and error handling)', code: tr(storageCode, 'en') },
    { t: 'h3', id: 'services-notify', text: 'services.notify' },
    { t: 'table', head: ['Operation', 'Permission', 'Arguments and limits', 'Result'], rows: [
        ['`toast`', '`NOTIFY`', '`{message, title?, level?, url?}`: `message` 1–200, `title` ≤80, `level` `info` (default), `success`, `warning` or `error`; `url` a relative `/...` path (no `//`) or `https://`', '`{delivered:true}`'],
    ] },
    { t: 'p', text: 'The notice is stored and the UI shows it as a toast (`GET /api/expansions/notifications`). Cap of **20 pending** per user and extension and **30 per minute** per extension (`rate_limited`).' },
    { t: 'h3', id: 'services-users', text: 'services.users (read-only)' },
    { t: 'p', text: '**`READ_USERS`** permission (**high** risk: the administrator approves it when installing or updating the extension). It lists and looks up the accounts of **this** domain: the source is the instance itself (its own database) through the bridge signed with the `executionGrant`, so there is no way to query another domain. Requires the `lifecycle.events.v2` capability (client with `clientApi` ≥ 7).' },
    { t: 'table', head: ['Operation', 'Permission', 'Arguments and limits', 'Result'], rows: [
        ['`list`', '`READ_USERS`', '`{limit?, cursor?, search?}`: `limit` 1–100 (50); `cursor` opaque, from the previous page; `search` 1–100 characters over email or name', '`{users:[{id,email,name,createdAt}], nextCursor}` (`nextCursor` is `null` on the last page)'],
        ['`get`', '`READ_USERS`', '`get("ana@acme.com")`, `get("<id>")`, `{id}` or `{email}` (exactly one)', '`{user}` (`null` if it does not exist)'],
    ] },
    { t: 'ul', items: [
        '**Minimal fields:** `id`, `email`, `name` and `createdAt`. Never a password or hash, tokens, MFA, settings or permission level.',
        '**Stable pagination** by cursor (creation date + id): a sign-up during the walk neither duplicates nor skips rows.',
        '**Quotas:** 30 calls per execution, **120 queries per minute per extension** (`USERS_ERROR: rate_limited`) and a per-user limit on the route. Every query is audited (`extension.users.read`: who, extension, operation and row count; no account data).',
        '**Permissions are enforced twice:** by the backend (manifest) and by the instance (the `executionGrant` it signs carries the permissions); without `READ_USERS` it fails with `USERS_PERMISSION_DENIED`.',
        '**Signed domains only.** In legacy mode `ctx.services.users` does not exist: degrade.',
    ] },
    { t: 'code', lang: 'javascript', title: 'Walking every account', code: `let cursor = null;
do {
    const page = await ctx.services.users.list({ limit: 100, cursor: cursor ?? undefined });
    for (const u of page.users) { /* u.id, u.email, u.name, u.createdAt */ }
    cursor = page.nextCursor;
} while (cursor);` },
    { t: 'h3', id: 'services-shared', text: 'Shared domain state (storage.listShared)' },
    { t: 'p', text: '`services.storage` keys starting with `shared/` are stored in the user\'s space, but **any execution of the same extension** can read them with `listShared({prefix: "shared/...", limit?})` (1–200, values only, without who wrote them). They are **only written (`set`/`delete`) from a server hook**: the grant signed by the instance carries the event that originated the execution, and without it the write fails with `STORAGE_ERROR: forbidden`; so a user cannot add themselves to shared lists from the browser. `mail-groups` uses it for automatic group sign-up.' },
    { t: 'h3', id: 'services-example', text: 'Complete example' },
    { t: 'p', text: 'Finds a free slot, creates the event and notifies the user. It is the `summarizer` pattern (which only creates events after explicit confirmation), simplified.' },
    { t: 'code', lang: 'javascript', title: 'Calendar and notice, with degradation', code: tr(servicesCode, 'en') },
    { t: 'h3', id: 'services-limits', text: 'Per-invocation limits' },
    { t: 'table', head: ['Limit', 'Value'], rows: [
        ['Call budget', '`calendar` 60, `contacts` 60, `storage` 100, `notify` 10, `users` 30, `formats` 200 (and 30 remote: `renderTemplate` and `sanitizeHtml`). Failed calls count too'],
        ['Timeout per call', '15 s (`<SERVICE>_SERVICE_TIMEOUT`)'],
        ['Response size', '512 KB (`<SERVICE>_RESPONSE_TOO_LARGE`)'],
        ['`storage` quota', '256 KB per user and extension; value ≤ 64 KB'],
        ['`notify`', '20 pending per user and extension; 30 per minute per extension'],
    ] },
    { t: 'h3', id: 'services-errors', text: 'Errors' },
    { t: 'p', text: 'Every failure is an `Error` whose message starts with the service prefix (`<P>`): `CALENDAR_`, `CONTACTS_`, `STORAGE_`, `NOTIFY_` or `FORMATS_`. Catch it with `try/catch` and decide.' },
    { t: 'table', head: ['Message', 'When'], rows: [
        ['`<P>_PERMISSION_DENIED: services.x.op requires PERMISSION in the extension manifest`', 'The manifest does not declare that operation\'s permission'],
        ['`<P>_INVALID_ARGS: <detail>`', 'Unknown operation, `args` that are not JSON or fail validation (unknown key, range, size…)'],
        ['`<P>_ERROR: <code>`', 'The frontend rejected the operation. `code` is `invalid_args`, `not_found`, `forbidden`, `read_only`, `conflict`, `quota_exceeded` or `rate_limited`'],
        ['`<P>_SERVICE_ERROR (status)`', 'HTTP error response without a known `code`'],
        ['`<P>_SERVICE_UNAVAILABLE`', 'No bridge (missing signature or URL), network error or the frontend does not answer'],
        ['`<P>_SERVICE_TIMEOUT`', 'The call exceeded 15 s'],
        ['`<P>_CALL_BUDGET`', 'The invocation\'s call budget was exceeded'],
    ] },
    { t: 'h2', id: 'formats', text: 'services.formats (pure utilities)' },
    { t: 'p', text: 'Requires the `FORMATS` permission (low risk: it does not access user data). Everything except templates and HTML is resolved **in the backend itself**, with no network; `renderTemplate` and `sanitizeHtml` travel to the frontend through the signed bridge.' },
    { t: 'table', head: ['Operation', 'Arguments and limits', 'Result'], rows: [
        ['`formatDate`', '`{value, locale?, timeZone?, style?}`: `value` ISO or epoch ms; `locale` validated with `Intl` (`en-US`); IANA `timeZone` (`UTC`); `style` `short`, `medium`, `long`, `full`, `date`, `time` or `datetime` (default)', '`string`'],
        ['`formatNumber`', '`{value, locale?, style?, currency?, minimumFractionDigits?, maximumFractionDigits?}`: `style` `decimal`, `percent` or `currency` (requires ISO 4217 `currency`); digits 0–10', '`string`'],
        ['`parseIcs`', '`{ics}` ≤ 200 KB', '`{events:[{uid, summary, description, location, startsAt, endsAt, allDay, organizerEmail, attendees:[{email,name,responseStatus}]}]}`'],
        ['`buildIcs`', '`{events, method?, calendarName?}`: 1–50 events (`summary` required; ISO or epoch dates); `method` `PUBLISH` (default), `REQUEST` or `CANCEL`', '`{ics}`'],
        ['`parseVcard`', '`{vcard}` ≤ 200 KB', '`{contacts:[{name, email, phone, org, title, note}]}` (max 100)'],
        ['`buildVcard`', '`{contacts, version?}`: 1–100 contacts (`name` required); `version` `3.0` (default) or `4.0`', '`{vcard}`'],
        ['`renderTemplate`', '`{template, variables?}`: template ≤ 20000; `variables` a flat object of ≤ 50 scalar keys (text ≤ 5000). The frontend\'s **Liquid** engine', '`{text}`'],
        ['`sanitizeHtml`', '`{html}` ≤ 200000', '`{html}`'],
    ] },
    { t: 'code', lang: 'javascript', title: 'All the utilities', code: tr(formatsCode, 'en') },
    { t: 'ul', items: [
        '**Safe ICS and vCard.** In `buildIcs` and `buildVcard` CR/LF and control characters are removed from **every** value (a new property cannot be injected), texts are escaped (`\\`, `;`, `,` and line breaks) and lines are folded at **75 octets** without splitting UTF-8 characters, with CRLF. Parameters (`CN`) are stripped of quotes and separators.',
        '`parseIcs` and `parseVcard` unfold folded lines, unescape and strip controls; they ignore what they do not recognise.',
        '`renderTemplate`: if the template fails (syntax, limits) the error is `FORMATS_ERROR: invalid_args`; the unrendered template is **never** returned. Escape variable values that go into HTML before interpolating (as `signature` does).',
        '`sanitizeHtml` uses the same configuration as the frontend sanitiser (DOMPurify: no scripts, forms, iframes or dangerous URIs; links get `rel="noopener noreferrer nofollow"`), run on the **server** with a DOM, so it **keeps safe formatting**. If the server DOM were unavailable it degrades to escaped text without tags (safe, but unformatted).',
        'Failures of the local operations are reported as `FORMATS_ERROR: invalid_args` (no internal details).',
    ] },
    { t: 'h2', id: 'lifecycle', text: 'Lifecycle events' },
    { t: 'p', text: 'Nine application events an extension can subscribe to. They are declared like any `intercept`: in `intercepts` or in its `hooks` alias (same `{point, handler, priority?}` shape). The handler receives `ctx = {...context, event, userId}` plus `services`. The table shows the **minimal, exact** context: the backend filters it with an allow-list and drops any other field (subjects, bodies, recipients…).' },
    { t: 'table', head: ['Event', 'Context', 'Where it fires'], rows: [
        ['`EMAIL_OPENED`', '`{emailId, folder, fromEmail, isRead}`', '`GET /api/emails/[id]` (at most once per minute per user and message)'],
        ['`EMAIL_SENT`', '`{emailId, toCount, ccCount, bccCount, hasAttachments, sentAt}`', '`POST /api/emails`, after sending (not scheduled ones)'],
        ['`COMPOSE_OPENED`', '`{mode, inReplyToEmailId?, draftId?}` with `mode` `new`, `reply`, `replyAll` or `forward`', 'The UI reports it when the composer opens with `POST /api/expansions/events`'],
        ['`CALENDAR_EVENT_CREATED`, `CALENDAR_EVENT_UPDATED`, `CALENDAR_EVENT_CANCELLED`', '`{eventId, calendarId, startsAt, endsAt, allDay, status, attendeeCount, source}`', '`POST /api/calendar/events`, and `PUT` and `DELETE` of `/api/calendar/events/[id]`'],
        ['`CONTACT_SAVED`', '`{contactId, email, created, source}`', '`POST /api/contacts` (`created:true`) and `PUT /api/contacts/[id]` (`created:false`)'],
        ['`CONTACT_DELETED`', '`{contactId}`', '`DELETE /api/contacts/[id]`'],
        ['`APPOINTMENT_BOOKED`', '`{bookingId, scheduleId, startsAt, endsAt, guestEmail, calendarEventId?}`', 'The public appointment booking (`POST /api/appointments/book/[scheduleId]`)'],
    ] },
    { t: 'code', lang: 'json', title: 'manifest.json: declaring the event (hooks alias)', code: lifecycleManifest },
    { t: 'code', lang: 'javascript', title: 'server.js: onContactSaved (hubspot pattern)', code: tr(lifecycleCode, 'en') },
    { t: 'h3', id: 'lifecycle-v2', text: 'v2 events (lifecycle.events.v2)' },
    { t: 'p', text: 'Five more events with a **versioned** (`v: 1`), minimal payload. Each one requires a **permission** in the manifest (if missing, `validateManifest` errors and the backend does not invoke the handler) and the `lifecycle.events.v2` capability (`requires.clientApi` ≥ 7: old clients keep receiving the previous version of the extension). There is no `USER_DELETED`: the platform does not delete accounts, it only disables them.' },
    { t: 'table', head: ['Event', 'Permission', 'Context', 'Where it fires'], rows: [
        ['`USER_CREATED`', '`READ_USERS`', '`{v, eventKey, subjectUserId, email, emailDomain, source, createdAt}`; `source`: `register`, `admin` or `import`', 'Self sign-up (`POST /api/register`), admin creation and mailbox creation on import (`createUserAccount`)'],
        ['`USER_DISABLED`, `USER_ENABLED`', '`READ_USERS`', '`{v, eventKey, subjectUserId, email, emailDomain, disabledAt | enabledAt}`', 'Only when the state **changes** (admin console); repeating the same state does not emit'],
        ['`EMAIL_SPAM_DETECTED`', '`READ_EMAIL`', '`{v, eventKey, emailId, fromEmail, fromDomain, verdict, action, score?, reasons[]}`; `verdict`: `spam`, `phishing` or `suspicious`; `action`: `junk` or `flag`', 'The anti-spam engine classifies an incoming email as spam or suspicious. No subject, body or recipients'],
        ['`LABEL_APPLIED`', '`READ_EMAIL`', '`{v, eventKey, emailId, labelId, labelName?, source, ruleId?}`; `source`: `user`, `rule` or `system`', 'Label applied by a rule on receipt or with "Apply now" (max 50 emails per call) or by the user (edit labels, "Move to")'],
    ] },
    { t: 'ul', items: [
        '**The handler runs AS the affected user** in `USER_*` (`ctx.userId == subjectUserId`) and as the mailbox owner in the rest; `ctx.services.users` lets it read the directory.',
        '**Provenance: `ctx.hook = {event, eventKey}`** is set only by the server (in `/execute` it is always `null`, even if the client sends `context.hook`). A handler acting on v2 events must require `ctx.hook?.event === "..."`: the rest of the context may come from a client.',
        '**Idempotency:** `eventKey` is deterministic per fact (`uc:<id>`, `sp:<email>`, `lb:<email>:<label>`, …). The frontend drops repeats of the same fact for 10 min (60 s for labels) and consumers must dedupe by `eventKey` (webhooks use a stable `id`/`X-BloomX-Delivery` derived from it).',
        '**Asynchronous and isolated:** `after()`, 5 s call timeout, ≤ 60 per minute, and a failure (backend down, broken handler, timeout) only leaves a log line: it **never** blocks or rolls back sign-up, creation, disabling, ingestion or labelling.',
        '**Privacy by default:** no passwords, hashes, tokens, subjects or bodies (allowlist in the frontend and again in the backend). Mail import and what extensions do with `services.*` do not emit these events (anti-loop).',
    ] },
    { t: 'h3', id: 'lifecycle-rules', text: 'Rules and limits' },
    { t: 'ul', items: [
        '**Non-blocking.** They cannot prevent or modify the action: `stop` and `modify` are ignored (only `EMAIL_PRE_SEND` accepts them). `onError: "block"` is ignored and `validateManifest` warns about it. The frontend fires them in the background (`after()`), so they do not delay the user\'s response.',
        '**Signed domains only.** In legacy mode none fires. The `userId` comes from the signed identity, never the body.',
        '**Limits.** At most **10 handlers** per event (the rest is ignored), ordered by priority; **per-handler timeout ≤ 10 s** (the lower of the manifest\'s and 10 s) and a **total budget of 20 s** (after which pending handlers are skipped). The frontend call waits at most 5 s.',
        '**Rate.** The frontend emits at most **60 firings per minute per user and event**; the excess is silently dropped.',
        '**Anti-loop.** What you do with `services.*` inside the handler does not fire events again.',
        'An unknown `point` is a manifest **error**; `EMAIL_PRE_SEND`, `EMAIL_RECEIVED` and `CRON` keep their own semantics (see [Hooks](#hooks)).',
    ] },
    { t: 'h2', id: 'mount-points', text: 'Mount points and their context' },
    { t: 'p', text: 'Each point gives the extension a fixed context (the `MOUNT_POINT_CONTEXT` registry in `src/lib/expansions/mount-points.ts`); it is read with `${context.key}` expressions. The context never includes `auth`, `user`, `env` or `services`: the server supplies identity. The **Status** column says whether an `<ExtensionLoader>` paints it today, according to the frontend code.' },
    { t: 'table', head: ['Point', 'Where', 'Context', 'Status'], rows: [
        ['`EMAIL_TOOLBAR`', 'Open message toolbar', '`email`, `emailContent`, `fromContact`, `content`', 'Mounted'],
        ['`EMAIL_HEADER`', 'Open message header', 'Same as `EMAIL_TOOLBAR`', 'Defined, not rendered'],
        ['`EMAIL_FOOTER`', 'Footer (today, under the composer)', 'Composer context', 'Mounted (in the composer)'],
        ['`EMAIL_READER_SIDEBAR`', 'Side panel next to the open message', '`email`, `emailContent`, `fromContact`, `content`', 'Defined, not rendered'],
        ['`EMAIL_LIST_ROW_ACTION`', 'Per-row action in the list', 'Same as `EMAIL_TOOLBAR`', 'Defined, not rendered'],
        ['`CONTEXT_MENU`', 'Message context menu', 'Same as `EMAIL_TOOLBAR`', 'Defined, not rendered'],
        ['`SIDEBAR_HEADER`, `SIDEBAR_FOOTER`', 'App sidebar', '`folder`, `unreadCounts?`', 'Mounted'],
        ['`SIDEBAR_PANEL`', 'Own panel in the sidebar', '`folder`, `unreadCounts?`', 'Defined, not rendered'],
        ['`COMPOSER_TOOLBAR`, `COMPOSER_INIT`', 'Composer', '`emailContent`, `subject`, `to`, `cc`, `bcc`, `sender`', 'Mounted'],
        ['`COMPOSER_SIDEBAR`', 'Composer side panel', 'Same as `COMPOSER_TOOLBAR`', 'Defined, not rendered'],
        ['`CALENDAR_TOOLBAR`', 'Calendar toolbar', '`range:{from,to}`, `view`, `isGoogleLinked`', 'Mounted'],
        ['`CALENDAR_EVENT_PANEL`', 'Event detail', '`event`, `calendarId`, `isReadOnly`', 'Defined, not rendered'],
        ['`CALENDAR_HEADER`, `CALENDAR_SIDEBAR_BOTTOM`, `CALENDAR_ADD_SOURCES`', 'Calendar', '`isGoogleLinked`', 'Mounted'],
        ['`CALENDAR_SIDEBAR`', 'Calendar sidebar', '`isGoogleLinked`', 'Defined, not rendered'],
        ['`CONTACTS_TOOLBAR`', 'Contacts toolbar', '`contactCount`, `isGoogleLinked`, `selectedIds`', 'Mounted'],
        ['`CONTACTS_HEADER`, `CONTACTS_SIDEBAR`, `CONTACTS_SIDEBAR_BOTTOM`', 'Contacts', '`isGoogleLinked` (and `contactCount` in the header)', 'Mounted'],
        ['`CONTACT_CARD_PANEL`', 'A contact\'s card', '`contact:{id,email,name,notes,source}`', 'Defined, not rendered'],
        ['`SETTINGS_PANEL`', 'Extension settings', '`extensionId`, `settings` (non-secret values)', 'Defined, not rendered'],
    ] },
    { t: 'p', text: 'The other points (`EVENT_LOCATION_BUILDER`, `CUSTOM_SETTINGS_TAB`, `PAGE`, `OVERLAY`, `SLASH_COMMAND`, `*_HANDLER`…) keep their previous behaviour. A point the schema knows but the UI does not paint yet **validates without warnings and is not shown**: it does not fail, but has no effect until the consumer exists.' },
    { t: 'code', lang: 'json', title: 'Manifest with EMAIL_READER_SIDEBAR and SETTINGS_PANEL', code: mountsManifest },
    { t: 'callout', kind: 'note', title: 'Mount status', text: 'The **Status** column comes from searching `<ExtensionLoader mountPoint=...>` in `src`. When a point goes from "defined" to "mounted" its context does not change: the contract is the table\'s.' },
];

const permissionsRowsEn: string[][] = [
    ['`READ_EMAIL`', 'Read mail', 'Reads sender, subject and snippet of the messages in the user\'s inbox.', 'High'],
    ['`MAIL_LABEL`', 'Label mail', 'Applies or undoes category labels on the user\'s messages (it does not move, delete or send).', 'Medium'],
    ['`READ_USER`', 'See user data', 'Sees the id and email of the user running the extension.', 'Low'],
    ['`READ_USER_NAME`', 'See user name', 'Sees the user\'s name.', 'Low'],
    ['`AI_GENERATE`', 'Use AI', 'Sends text to the AI provider configured by the instance in `/admin/ai`, with guardrails and quotas. With AI disabled the extension is blocked ([AI](/docs/ai#blocking)). `core-composer-helper` is the only writing help: there is no native AI composer.', 'Medium'],
    ['`HTTP_REQUEST`', 'External HTTP calls', 'Makes HTTPS requests to external services (filtered against SSRF).', 'High'],
    ['`OAUTH_READ`', 'Read OAuth tokens', 'Uses the tokens of the domain\'s connected accounts.', 'High'],
    ['`OAUTH_WRITE`', 'Manage OAuth connections', 'Connects or disconnects third-party accounts.', 'High'],
    ['`API_ROUTE_CREATE`, `PAGE_ROUTE_CREATE`', 'Create API routes / pages', 'Declare own routes or pages (reserved).', 'Medium'],
    ['`DB_READ`, `DB_WRITE`', 'Read / write database', 'Extension data (reserved).', 'Medium'],
    ['`local:secure-storage`', 'Secure browser storage', 'Stores encrypted data in the user\'s browser.', 'Low'],
    ['`CALENDAR_READ`', 'Read calendar', 'Lists and queries events and free slots of the user\'s calendars (no Google tokens).', 'Medium'],
    ['`CALENDAR_WRITE`', 'Modify calendar', 'Creates, edits and cancels events and invites attendees on the user\'s calendars.', 'High'],
    ['`CONTACTS_READ`', 'Read contacts', 'Searches and lists the user\'s contacts and suggests duplicates.', 'Medium'],
    ['`CONTACTS_WRITE`', 'Modify contacts', 'Creates, edits and merges the user\'s contacts.', 'High'],
    ['`FORMATS`', 'Formats', 'Uses pure utilities for dates, numbers, ICS, vCard, templates and HTML sanitising (no data access).', 'Low'],
    ['`STORAGE`', 'Own storage', 'Stores up to 256 KB of extension state per user on the server.', 'Low'],
    ['`NOTIFY`', 'Notifications', 'Shows notices (toasts) to the user inside the app.', 'Low'],
    ['`ENV_READ:NAME`', 'Variable NAME', 'Reads the credential or variable configured for this domain.', 'High'],
];

const permissionsEn: Block[] = [
    { t: 'p', text: 'An extension can declare full pages (`PAGE`) and navigation entries (`navEntries`, capabilities `ui.pages.v1` and `nav.entries.v1`): see the guide [Full page and navigation](/docs/extension-pages).' },
    { t: 'h2', id: 'permissions', text: 'Permissions' },
    { t: 'p', text: 'The manifest declares the permissions the extension needs. The catalogue (`PERMISSION_CATALOG` in the schema) gives each one a **label**, a **description** and a **risk**; this is what the domain administrator sees.' },
    { t: 'table', head: ['Permission', 'Label', 'Description', 'Risk'], rows: permissionsRowsEn },
    { t: 'ul', items: [
        '**Validation.** `validateManifest` checks that `permissions` is a list of strings; a permission not in the catalogue produces a **warning** (`Unknown permission`) and the platform ignores it. `ENV_READ:NAME` is validated separately (`^[A-Z][A-Z0-9_]{1,63}$` and not reserved) and an invalid name is an **error**.',
        '**Confirmation on install.** The administrator sees the readable list (`describePermissions`: label, description and risk; unknown ones are flagged) and must **confirm** before installing. Ask only for what you need: what you ask for is shown as is.',
        '**Enforced on the server:** `ENV_READ:*`, `READ_EMAIL`, `MAIL_LABEL` and the service ones (`CALENDAR_*`, `CONTACTS_*`, `FORMATS`, `STORAGE`, `NOTIFY`). The executor rejects a service operation without its permission with a clear error (`CALENDAR_PERMISSION_DENIED: services.calendar.createEvent requires CALENDAR_WRITE in the extension manifest`). The rest (`READ_USER`, `AI_GENERATE`, `HTTP_REQUEST`, `OAUTH_*`, `local:secure-storage`) documents intent and the reserved ones (`API_ROUTE_CREATE`, `PAGE_ROUTE_CREATE`, `DB_*`) have no effect.',
        'Detail of each operation and its permission: [Sandbox services](#services).',
    ] },
    { t: 'callout', kind: 'note', title: 'Reserved variables', text: 'These cannot be requested with `ENV_READ`: `DATABASE_URL`, `DIRECT_URL`, `POSTGRES_*`, `PG*`, `B2_*`, `ADMIN_*`, `MP_*`, `NEXTAUTH_*`, `AUTH_*`, `DATA_ENCRYPTION_KEY`, `AI_*`, `OPENAI_*`, `RESEND_*`, `VERCEL*`, `NEXT_*`, `NODE_*`, `EXTENSION_*`, `INTERNAL_*`, `JWT_*`, `SESSION_*`, `AWS_*`, `GITHUB_*`, `NPM_*`, `PATH`, `HOME`, `USER*`.' },
];

const reqEx = `"requires": { "clientApi": ">=2", "capabilities": ["settings.schema.v1", "ai.v1"] }
// clientApi: 2 | ">=2" | ">=2 <4"   (sin "requires" = compatible con legacy / without it = legacy-compatible)`;
const capRows = (l: 'es' | 'en'): string[][] => Object.entries(CAPABILITY_REGISTRY).map(([id, c]) => ['`' + id + '`', String(c.since) + (c.since <= 1 ? (l === 'es' ? ' (línea base)' : ' (baseline)') : ''), c[l]]);
const legacyList = 'appointments, calendar, composer-helper, dlp, giphy, google-drive, google-meet, google-sync, hubspot, mail-groups, notion, organizer, sealer, signature, slash-commands, smart-reply, summarizer, translator, trello, webhooks, zoom';

const versioningEs: Block[] = [
    { t: 'h2', id: 'client-versioning', text: 'Versionado del cliente y compatibilidad' },
    { t: 'p', text: 'El backend es compartido y guarda **una sola copia** de cada extensión, pero cada instancia (frontend) puede desplegar una versión distinta del cliente. La solución es versionar el cliente y **negociar capacidades**: el cliente dice qué sabe hacer y el backend sirve a cada instancia la versión de la extensión que ese cliente puede ejecutar.' },
    { t: 'h3', id: 'client-identity', text: 'Identidad del cliente' },
    { t: 'ul', items: [
        '`CLIENT_API_VERSION` (entero; hoy **5**): contrato cliente↔backend de extensiones. Es independiente de la versión de la app y del `BUILD_ID`. `CLIENT_CAPABILITIES` son cadenas estables. Ambos se definen en `src/lib/expansions/client/capabilities.ts`.',
        'Registro único `CAPABILITY_REGISTRY` en `client-contract.ts` (copia idéntica en el frontend, el backend y `bloomx-extensions/_shared`).',
        'Cabeceras `X-BloomX-Client-Api` (entero) y `X-BloomX-Client-Caps` (lista separada por comas, máx. 1024 caracteres y 64 capacidades) en **todas** las llamadas al backend.',
        'Con firma Ed25519 activa, el mensaje firmado pasa a `BLOOMX-SIG-V2` = V1 + dos líneas (api y caps), de modo que no se pueden quitar ni añadir. Sin firma (modo legado) viajan como informativas.',
        'Un cliente sin cabeceras es la línea base `legacy`: `clientApi` 1 + las capacidades con `since: 1`.',
    ] },
    { t: 'table', head: ['Capacidad', 'Desde clientApi', 'Qué significa'], rows: capRows('es') },
    { t: 'h3', id: 'client-requires', text: 'requires en el manifest' },
    { t: 'code', lang: 'json', title: 'requires', code: reqEx },
    { t: 'ul', items: [
        'Sin `requires` la extensión es compatible con legacy (todas las 1.0.x).',
        'Las capacidades **desconocidas se rechazan al publicar**: hay que registrarlas primero (decisión documentada, evita erratas y capacidades futuras sin soporte).',
        'Un verificador estático (`bloomx-extensions/_shared/feature-rules.mjs`, usado por `validate` y por los tests) obliga a declarar la capacidad cuando el manifest o `server.js` usa `settingsSchema`, `onSubmit` en campos (no FORM), los componentes STACK/REPEAT/EMPTY/SKELETON/TEXTAREA u `onCancel`, `props.toolbar`, un bloque `ai` o `services.ai.chat/status`, `ai.json()`, eventos de ciclo de vida, permisos de servicios del host, o `kind`/`conferencingProviders`.',
    ] },
    { t: 'h3', id: 'client-resolution', text: 'Resolución por petición' },
    { t: 'ul', items: [
        'Se sirve la versión **más alta no-yanked** cuyos `requires` cumple el cliente.',
        'La versión fijada por el dominio (`settings.meta.pinnedVersion`, o install con `version` explícita) se respeta si es compatible y no está yanked.',
        'Si hay una versión más nueva incompatible, la respuesta incluye `upgrade { latestVersion, requires, missingCaps, clientApiNeeded }`.',
        'Si ninguna es compatible, la extensión no se entrega: aparece en `incompatibleExtensions` de `/api/config`, y install/update/toggle/execute responden 409 `EXTENSION_CLIENT_INCOMPATIBLE`.',
        'La ejecución en el backend (execute, hooks, settings, config) usa la versión resuelta para ese dominio y cliente. `mandatory` se conserva: si la última versión viva es obligatoria, la servida también.',
        'Se aplica en `/api/config`, `/api/extensions`, public-list, `/api/manager/extensions` (`versionInfo`), execute, hooks y settings/config.',
    ] },
    { t: 'h3', id: 'client-versions-table', text: 'Tabla ExtensionVersion' },
    { t: 'p', text: '`ExtensionVersion` guarda `extensionId`, `version`, `template`, `requiresClientApi`, `requiresCaps`, `status` (`published`, `deprecated`, `yanked`), `scriptUrl`, `scriptSource` y `contentHash`, con `UNIQUE(extensionId, version)`. `Extension` es el puntero a la última versión. Las versiones son **inmutables**: el mismo número con otro contenido responde 409 `VERSION_EXISTS` (el sync aborta; sube la versión, o usa `--replace <id>@<ver>` de forma explícita).' },
    { t: 'h3', id: 'client-publish', text: 'Publicar una extensión que necesita un cliente nuevo' },
    { t: 'ol', items: [
        '**Cliente**: registra la capacidad en `CAPABILITY_REGISTRY` (las 3 copias), añádela a `CLIENT_CAPABILITIES`, sube `CLIENT_API_VERSION` si cambia el contrato y añade la regla en `feature-rules.mjs`.',
        '**Extensión**: sube la versión, añade `requires`, ejecuta `npm run validate` y `npm test`. Conserva la anterior publicable: `node --experimental-strip-types scripts/archive-legacy-versions.mjs` (desde `bloomx-extensions`) archiva versiones previas desde git en `<ext>/versions/<ver>/`.',
        '**Sync**: `node --env-file=.env scripts/sync-repository-extensions.mjs` (o `sync-extensions.mjs`). Conserva la versión que sirve la BD, archiva y mueve el puntero.',
        '**Orden de despliegue**: (a) crear la tabla `ExtensionVersion` (`prisma/schema_push.prisma` con `npm run prisma:push`, o el DDL idempotente de `prisma/schema.prisma`); (b) desplegar el backend (preview primero, luego prod); (c) ejecutar el sync de extensiones; (d) desplegar los frontends.',
    ] },
    { t: 'callout', kind: 'note', text: 'Sin la tabla, el código del backend funciona como antes (tolerante), pero el sync falla cerrado.' },
    { t: 'h3', id: 'client-lifecycle', text: 'Deprecación y ciclo de vida' },
    { t: 'ul', items: [
        'Política: se mantiene publicada como mínimo la última versión compatible con la línea base legacy mientras haya instancias legacy, y las 2 últimas versiones menores previas de cada línea.',
        '`deprecated` = se sirve marcada; `yanked` = nunca se sirve, instala ni ejecuta. Ambos son reversibles.',
        'CLI: `node --env-file=.env scripts/extension-version.mjs list|yank|deprecate|restore <id> [<version>]`. API: `POST`/`GET /api/admin/extensions/versions` (Basic Auth de plataforma).',
        'Regla: añadir una capacidad exige registrarla y/o subir `CLIENT_API_VERSION`; los tests lo exigen.',
        'Opcional: la variable `BLOOMX_MIN_CLIENT_API` en el backend añade la cabecera `X-BloomX-Min-Client-Api` a las respuestas de extensiones. Enlaza con la sección «Cómo se actualiza la PWA» de [Operación](/docs/operations).',
    ] },
    { t: 'h3', id: 'client-legacy-archive', text: 'Versiones legacy archivadas' },
    { t: 'p', text: 'Extensiones con carpeta `versions/` en el repositorio de extensiones: ' + legacyList + '. Se reconstruyen desde el historial git eligiendo, por cada número de versión, el commit más nuevo compatible con la línea base. El contenido que hoy sirva la BD de producción se conserva automáticamente en el primer sync (la BD manda). Si el commit histórico no existe, no se puede reconstruir esa versión.' },
];

const versioningEn: Block[] = [
    { t: 'h2', id: 'client-versioning', text: 'Client versioning and compatibility' },
    { t: 'p', text: 'The backend is shared and keeps **one copy** of each extension, but every instance (frontend) may deploy a different client version. The solution is to version the client and **negotiate capabilities**: the client says what it can do and the backend serves each instance the extension version that client can run.' },
    { t: 'h3', id: 'client-identity', text: 'Client identity' },
    { t: 'ul', items: [
        '`CLIENT_API_VERSION` (integer; currently **5**): the client↔backend extension contract. It is independent of the app version and of `BUILD_ID`. `CLIENT_CAPABILITIES` are stable strings. Both are defined in `src/lib/expansions/client/capabilities.ts`.',
        'A single `CAPABILITY_REGISTRY` in `client-contract.ts` (identical copy in the frontend, the backend and `bloomx-extensions/_shared`).',
        'Headers `X-BloomX-Client-Api` (integer) and `X-BloomX-Client-Caps` (comma-separated list, max 1024 characters and 64 capabilities) on **every** backend call.',
        'With Ed25519 signing on, the signed message becomes `BLOOMX-SIG-V2` = V1 + two lines (api and caps), so they can be neither removed nor added. Without signing (legacy mode) they are informative only.',
        'A client without headers is the `legacy` baseline: `clientApi` 1 + the capabilities with `since: 1`.',
    ] },
    { t: 'table', head: ['Capability', 'Since clientApi', 'Meaning'], rows: capRows('en') },
    { t: 'h3', id: 'client-requires', text: 'requires in the manifest' },
    { t: 'code', lang: 'json', title: 'requires', code: reqEx },
    { t: 'ul', items: [
        'Without `requires` the extension is legacy-compatible (all 1.0.x).',
        '**Unknown capabilities are rejected at publish time**: register them first (documented decision; avoids typos and unsupported future capabilities).',
        'A static checker (`bloomx-extensions/_shared/feature-rules.mjs`, used by `validate` and the tests) forces you to declare the capability when the manifest or `server.js` uses `settingsSchema`, `onSubmit` on fields (not FORM), the STACK/REPEAT/EMPTY/SKELETON/TEXTAREA components or `onCancel`, `props.toolbar`, an `ai` block or `services.ai.chat/status`, `ai.json()`, lifecycle events, host service permissions, or `kind`/`conferencingProviders`.',
    ] },
    { t: 'h3', id: 'client-resolution', text: 'Per-request resolution' },
    { t: 'ul', items: [
        'The **highest non-yanked** version whose `requires` the client meets is served.',
        'The version pinned by the domain (`settings.meta.pinnedVersion`, or install with an explicit `version`) is honoured if compatible and not yanked.',
        'If a newer incompatible version exists, the response carries `upgrade { latestVersion, requires, missingCaps, clientApiNeeded }`.',
        'If none is compatible the extension is not delivered: it shows in `incompatibleExtensions` of `/api/config`, and install/update/toggle/execute answer 409 `EXTENSION_CLIENT_INCOMPATIBLE`.',
        'Backend execution (execute, hooks, settings, config) uses the version resolved for that domain and client. `mandatory` is preserved: if the latest live version is mandatory, so is the served one.',
        'Applied in `/api/config`, `/api/extensions`, public-list, `/api/manager/extensions` (`versionInfo`), execute, hooks and settings/config.',
    ] },
    { t: 'h3', id: 'client-versions-table', text: 'The ExtensionVersion table' },
    { t: 'p', text: '`ExtensionVersion` stores `extensionId`, `version`, `template`, `requiresClientApi`, `requiresCaps`, `status` (`published`, `deprecated`, `yanked`), `scriptUrl`, `scriptSource` and `contentHash`, with `UNIQUE(extensionId, version)`. `Extension` is the pointer to the latest version. Versions are **immutable**: the same number with different content answers 409 `VERSION_EXISTS` (the sync aborts; bump the version, or explicitly use `--replace <id>@<ver>`).' },
    { t: 'h3', id: 'client-publish', text: 'Publishing an extension that needs a new client' },
    { t: 'ol', items: [
        '**Client**: register the capability in `CAPABILITY_REGISTRY` (all 3 copies), add it to `CLIENT_CAPABILITIES`, bump `CLIENT_API_VERSION` if the contract changes, and add the rule in `feature-rules.mjs`.',
        '**Extension**: bump the version, add `requires`, run `npm run validate` and `npm test`. Keep the previous one publishable: `node --experimental-strip-types scripts/archive-legacy-versions.mjs` (from `bloomx-extensions`) archives earlier versions from git into `<ext>/versions/<ver>/`.',
        '**Sync**: `node --env-file=.env scripts/sync-repository-extensions.mjs` (or `sync-extensions.mjs`). It keeps the version the DB serves, archives, and moves the pointer.',
        '**Deploy order**: (a) create the `ExtensionVersion` table (`prisma/schema_push.prisma` with `npm run prisma:push`, or the idempotent DDL in `prisma/schema.prisma`); (b) deploy the backend (preview first, then prod); (c) run the extension sync; (d) deploy the frontends.',
    ] },
    { t: 'callout', kind: 'note', text: 'Without the table the backend code works as before (tolerant), but the sync fails closed.' },
    { t: 'h3', id: 'client-lifecycle', text: 'Deprecation and lifecycle' },
    { t: 'ul', items: [
        'Policy: keep published at least the latest version compatible with the legacy baseline while legacy instances exist, plus the 2 previous minor versions of each line.',
        '`deprecated` = served but flagged; `yanked` = never served, installed or executed. Both are reversible.',
        'CLI: `node --env-file=.env scripts/extension-version.mjs list|yank|deprecate|restore <id> [<version>]`. API: `POST`/`GET /api/admin/extensions/versions` (platform Basic Auth).',
        'Rule: adding a capability requires registering it and/or bumping `CLIENT_API_VERSION`; the tests enforce it.',
        'Optional: the backend variable `BLOOMX_MIN_CLIENT_API` adds the `X-BloomX-Min-Client-Api` header to extension responses. See the "How the PWA updates" section of [Operations](/docs/operations).',
    ] },
    { t: 'h3', id: 'client-legacy-archive', text: 'Archived legacy versions' },
    { t: 'p', text: 'Extensions with a `versions/` folder in the extensions repository: ' + legacyList + '. They are rebuilt from the git history by picking, for each version number, the newest commit compatible with the baseline. Whatever the production DB serves today is preserved automatically on the first sync (the DB wins). If the historical commit does not exist, that version cannot be rebuilt.' },
];

const es: Block[] = [
    { t: 'p', text: 'Una **extensión** (en el código y en la interfaz también se llama *expansión*) añade interfaz y lógica a BloomX sin tocar su código. Se compone de un `manifest.json` (declarativo: qué se muestra, qué funciones expone, qué permisos pide) y, opcionalmente, un `server.js` que se ejecuta en el **backend compartido** dentro de un sandbox. Para construir una paso a paso ve a [Crear una extensión](/docs/create-extension).' },
    { t: 'h2', id: 'model', text: 'Modelo' },
    { t: 'ul', items: [
        'Las extensiones viven en el repositorio `bloomx-extensions` (una carpeta por extensión) y se **publican** al backend (base de datos + almacenamiento). Cada dominio (empresa) **instala** las que quiere.',
        'El frontend recibe de `GET /api/config` las extensiones habilitadas del dominio (con sus `template`, es decir el manifest, y sus `settings` sin secretos) y pinta su interfaz en los *puntos de montaje*.',
        'Cuando la interfaz llama a una función (`CALL_BACKEND`) o se dispara un hook, el frontend hace un proxy **firmado** al backend (`/api/extension/execute` o `/api/extension/hooks`), que ejecuta `server.js` en el sandbox.',
        'Extensiones **solo cliente** (`"clientOnly": true`, sin `server.js`), como `slash-commands`, `appointments` o `google-sync`, no ejecutan nada en el backend.',
    ] },
    { t: 'h2', id: 'contract', text: 'Contrato handler(ctx)' },
    { t: 'p', text: 'Cada función exportada por `server.js` recibe **un único parámetro** `ctx` y devuelve un valor serializable a JSON (hasta 5 MB). Un test del repositorio falla si algún handler declara más de un parámetro.' },
    { t: 'code', lang: 'javascript', title: 'server.js', code: handlerEx },
    { t: 'table', head: ['Campo de `ctx`', 'Contenido'], rows: [
        ['`args`', 'Parámetros de la llamada (`CALL_BACKEND.args` más `formData`), o `{}`'],
        ['`env`', 'Solo las claves declaradas con `ENV_READ:*` (ver [credenciales](#credentials))'],
        ['`domain`', '`{id, name, displayName, logo, theme}` (el tema sin secretos)'],
        ['`user`', '`{id, email}` o `null`. Lo fija el servidor a partir de la identidad firmada'],
        ['`settings`', 'Ajustes de la instalación sin secretos (sin credenciales)'],
        ['`extension`', '`{id, sourceId, name, manifest}`'],
        ['`services.ai.generate(system, prompt)`', 'Genera texto con la IA de la instancia (puente firmado `/api/internal/host/ai`, configurada en `/admin/ai`; máx. 5 llamadas por invocación). Errores tipados: [IA](/docs/ai#errors)'],
        ['`services.auth.getToken(provider)`', 'Token OAuth del usuario o dominio; string o `null`. Orden: `ctx.auth`, `authData` de la instalación, credencial `<PROVEEDOR>_ACCESS_TOKEN`, ajuste y, si se permite, variable global'],
        ['`services.mail.*`', '`listRecent`, `getEmail`, `applyBatch`, `undoRun`. Solo si la llamada va firmada por el dominio (la instancia aporta la `executionGrant`) y el manifest declara `READ_EMAIL` (lectura) o `MAIL_LABEL` (etiquetar/deshacer)'],
        ['`services.calendar`, `contacts`, `storage`, `notify`, `formats`', 'Solo en dominios firmados y según los permisos del manifest (ausentes en modo legado). Ver [Servicios del sandbox](#services)'],
        ['Resto', 'Lo que envía el cliente (`emailContent`, `subject`, `to`, `from`…). **No es fiable**: `args`, `env`, `domain`, `user`, `settings` y `extension` nunca los puede pisar el cliente'],
    ] },
    { t: 'ul', items: [
        '**Errores**: `throw new Error(msg)` devuelve `{success:false, error}` con HTTP 500; `AUTH_REQUIRED` da 401; un timeout, 408; una acción no exportada, 404.',
        '**Convención** (no impuesta): devolver `{success, ...}`.',
        'Para los hooks (`ctx.event`) el retorno tiene semántica propia, ver [Hooks](#hooks).',
    ] },
    { t: 'h2', id: 'manifest', text: 'Manifest y schema' },
    { t: 'p', text: 'El schema canónico es `bloomx-extensions/_shared/manifest-schema.ts`, con dos copias idénticas (backend y frontend) que un test compara. Los **errores** impiden cargar o publicar; los **avisos** no.' },
    { t: 'table', head: ['Campo', 'Regla'], rows: [
        ['`id`', 'Obligatorio. `^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$`'],
        ['`name`', 'Obligatorio. Texto no vacío, máx. 120'],
        ['`version`', 'Obligatorio. Semver `X.Y.Z` (sufijo opcional)'],
        ['`description`', 'Opcional, máx. 2000'],
        ['`manifestVersion`', 'Opcional. `"1.0"` o `"2.0"` (otra da aviso)'],
        ['`status`', 'Opcional. `"active"` o `"disabled"` (otro valor es error)'],
        ['`permissions`', 'Lista de strings; ver [permisos](#permissions)'],
        ['`auth`', '`{type}` con `NONE`, `OAUTH2`, `API_KEY`, `WEBHOOK_SECRET` o `BASIC_AUTH`'],
        ['`api`', '`runtime` (solo `nodejs`), `entry` (ruta relativa, sin `..`) y `functions: {nombre: {handler, timeout?}}` con `timeout` de 100 a 60000 ms'],
        ['`mounts[]`', '`point` obligatorio y `component` o `handler`; los `OVERLAY` exigen `id`'],
        ['`overlays`', 'Objeto `{id: componente}` para `OPEN_OVERLAY`'],
        ['`intercepts[]` / `hooks[]`', 'Hooks (`hooks` es un alias con la misma forma): `point`, `handler`, `priority`, `onError`, `schedule`'],
        ['`slashCommands[]`', '`{key, description, action, arguments?}`'],
        ['`clientOnly`', 'Indicador documental para extensiones sin servidor'],
        ['`category`', 'Categoría de la página `/extensions` (`mail`, `composer`, `calendar`, `contacts`, `automation`, `ai`, `integrations`, `settings`, `other` o su alias es/en). Desconocida: aviso, se deriva de los mounts y permisos'],
        ['`tags`', 'Hasta 12 etiquetas de búsqueda de 1 a 30 caracteres, sin HTML'],
        ['`screenshots`', 'Hasta 6 URLs **https** absolutas (sin usuario/clave, máx. 2000 caracteres). `http`, `javascript:` y `data:` se rechazan'],
        ['`changelog`', 'Hasta 20 entradas `{version, date?, notes?}`; `notes` (texto o lista, máx. 1000 caracteres) se muestra como texto plano'],
        ['`mandatory`', '`true` = extensión **obligatoria para todos** los usuarios (DLP, seguridad): no se puede desactivar y sus hooks de servidor se ejecutan siempre. Ver [preferencias del usuario](#user-prefs)'],
        ['`conferencingProviders[]`', 'Proveedores de videollamada `{id, name, icon?, handlers}`; `handlers` apunta a `api.functions` (estándar: `status`, `testConnection`, `createMeeting`, `updateMeeting`, `deleteMeeting`) y `createMeeting` es obligatorio'],
    ] },
    { t: 'ul', items: [
        'Reglas cruzadas: todo `CALL_BACKEND.function`, `mount.handler` e `intercept.handler` debe existir en `api.functions`. Profundidad máxima del árbol de componentes: 40. Una acción desconocida es un **error**; un componente o punto de montaje desconocido, solo un aviso.',
        '`backendRoutes` genera un aviso: **no hay** router `/api/ext/[id]/*`, así que no se sirve.',
        'La lista de tipos de componente **se deriva** de `ui-schema.ts` (los ~70 del kit) más los nombres del formato antiguo (`COLUMN`, `DATA_TABLE`…): un tipo del kit nunca da el aviso «componente desconocido». Límites del manifest: 1 MB, 12 etiquetas, 6 capturas, 20 entradas de changelog y 50 000 nodos recorridos.',
        '**Validación al publicar**: además del manifest, el backend valida todo el UI con el espejo de `ui-schema.ts` (ruta del error incluida, p. ej. `mounts[0].component.props.tone`). Estructura inválida = **400**; UI inválido o fuera de límites (600 nodos y 24 niveles por árbol, 256 KB, 200 mounts, 100 overlays, 5000 nodos en total) = **422**. Aplica a `POST /api/admin/extensions`, a las acciones de `/admin` (`createExtension`, `syncRepositoryExtensions`), a `sync-extensions.mjs` y `scripts/sync-repository-extensions.mjs` (fallan cerrados), a la siembra y a la **instalación** (`422 EXTENSION_INVALID`). Al cargar una extensión ya publicada, el frontend trata los problemas de los campos de catálogo como avisos (`lenientCatalog`), no como errores.',
    ] },
    { t: 'code', lang: 'json', title: 'Manifest mínimo (dlp, sin interfaz)', code: manifestMin },
    { t: 'h3', id: 'ui', text: 'Interfaz declarativa' },
    { t: 'p', text: 'La interfaz es un árbol JSON de componentes (por ejemplo `BUTTON`, `TEXT`, `INPUT`, `CARD`, `ROW`, `MODAL`, `TABS`, `FORM`, `LIST`, `DATA_TABLE`, `MARKDOWN`, `FILE_UPLOAD`, `WIZARD`…) y acciones (`SET_STATE`, `CALL_BACKEND`, `CALL_API`, `TOAST`, `OPEN_OVERLAY`, `OPEN_URL`, `INSERT_CONTENT`, `APPEND_BODY`, `SET_SUBJECT`, `ADD_ATTACHMENT`, `NEXT_STEP`, `SECURE_SAVE`, `OAUTH_CONNECT`…). Las expresiones `${...}` las evalúa un intérprete propio sin `eval`; `CALL_API` solo acepta rutas propias `/api/...`; `OPEN_URL` y los enlaces solo `http(s)`, `mailto` y `tel`.' },
    { t: 'p', text: 'Puntos de montaje soportados por el schema: los de correo, barra lateral, editor, calendario, contactos y ajustes (tabla completa con su contexto en [Puntos de montaje](#mount-points)), más `EVENT_LOCATION_BUILDER`, `SETTINGS_TAB`, `CUSTOM_SETTINGS_TAB`, `PAGE`, `OVERLAY`, `SLASH_COMMAND` y los `*_HANDLER` de edición. **No todos tienen consumidor en la interfaz**: `BEFORE_SEND_HANDLER`, `CUSTOM_ROUTE` y `backendRoutes` no hacen nada hoy.' },
    ...permissionsEs,
    { t: 'h2', id: 'credentials', text: 'Credenciales por dominio' },
    { t: 'ul', items: [
        'Cada empresa configura sus propias credenciales (por ejemplo `GIPHY_API_KEY`) en el panel de administración (extensiones → credenciales) o con `PUT /api/extension/settings`. Se guardan **cifradas** (`enc:v1:`, AES-256-GCM con `DATA_ENCRYPTION_KEY` del backend) y **nunca vuelven al navegador**: la interfaz solo ve `{name, configured}`.',
        'Solo se aceptan nombres declarados con `ENV_READ:*` en el manifest y no reservados; valor de hasta 4096 caracteres, sin caracteres de control. `null` o cadena vacía borra.',
        '**Lectura en ejecución**: por cada `ENV_READ:X`, en este orden: (1) la credencial **del dominio** (cifrada, la escribe el manager desde el panel), (2) el valor **heredado** que guardaban las instalaciones antiguas y (3) la variable global del backend, salvo las variables de plataforma (base de datos, almacenamiento, cifrado, claves privadas, `EXTENSION_*`, etc.), que ninguna extensión puede leer. `EXTENSION_GLOBAL_ENV_FALLBACK` es un control de endurecimiento opcional: `none` desactiva el paso 3 y una lista lo limita a esos nombres. El panel muestra la fuente activa de cada variable.',
        'En modo legado (sin firma) la extensión recibe las mismas credenciales, que quedan dentro del sandbox y no se devuelven; no tiene `services.mail` y cada ejecución se audita. `requireSignature` rechaza el modo legado.',
        'Desinstalar una extensión borra sus credenciales y `authData`, y **intenta** revocar los tokens OAuth en el proveedor (Google, HubSpot, Notion, Zoom; mejor esfuerzo, 5 s).',
    ] },
    { t: 'h2', id: 'domain-config', text: 'Configuración por dominio vs variables de entorno' },
    { t: 'p', text: 'El manifest puede declarar `settingsSchema`: los campos que el administrador configura **por dominio** en la consola (extensiones → detalle → pestañas **Ajustes** y **Credenciales**), sin tocar variables de entorno del servidor. Cada campo tiene `key`, `type`, `label`/`description` (texto o `{es, en}`), `default`, `required`, `group` (secciones definidas en `groups`), `visibleWhen: {key, in:[...]}` y los límites propios de su tipo.' },
    { t: 'code', lang: 'json', title: 'manifest.json: settingsSchema', code: domainConfigManifest },
    { t: 'table', head: [
        'Tipo',
        'Control en la consola',
        'Valor guardado',
    ], rows: [
        ['`string`, `multiline`', 'Campo de texto / área de texto (`maxLength`, `pattern`, `format`: `email`, `url`, `domain`, `regex`)', 'Texto'],
        ['`number`', 'Campo numérico (`min`, `max`, `integer`)', 'Número'],
        ['`boolean`', 'Interruptor', 'Booleano'],
        ['`enum`', 'Lista desplegable (`options`)', 'Uno de los valores de `options`'],
        ['`multienum`', 'Casillas, cada una con descripción y ejemplo', 'Lista de valores de `options` (puede ser vacía)'],
        ['`list`', 'Un elemento por línea, con contador (`maxItems`, `itemMaxLength`)', 'Lista de textos sin repetidos'],
        ['`json`', 'Área de texto con validación', 'Cualquier JSON de hasta 8 KB'],
        ['`user`, `users`', 'Buscador de usuarios del dominio (uno / varios)', 'Id(s) estable(s) del usuario'],
        ['`userMap`', 'Tabla de usuarios con un valor cada uno (`valueType`)', 'Mapa `{ idUsuario: valor }`'],
    ] },
    { t: 'h3', id: 'domain-config-secrets', text: 'Secretos frente a ajustes' },
    { t: 'ul', items: [
        '**Secretos** (`secret: true`): tokens, claves y contraseñas. La `key` es el nombre de variable en MAYÚSCULAS (el mismo de `ENV_READ:*`) y no admite `default`. Se guardan **cifrados** como credenciales del dominio, se editan solo en la pestaña **Credenciales** y su valor nunca vuelve al navegador. La pestaña Ajustes solo muestra «n de m secretos configurados» con un enlace.',
        '**Ajustes** (el resto): valores tipados que se guardan en claro en `ExtensionOnDomain.settings.config` y la extensión recibe en **`ctx.settings[key]`**. No pongas secretos aquí. Claves reservadas: `credentials`, `env`, `meta`, `ui`, `config`, `configMeta`, `authData`, `mandatory`.',
    ] },
    { t: 'code', lang: 'javascript', title: 'server.js: ctx.settings y ctx.env', code: domainConfigUsageEs },
    { t: 'h3', id: 'domain-config-writeonly', text: 'Secretos de solo escritura (write-only)' },
    { t: 'ul', items: [
        'Un secreto se declara con `secret: true`, `writeOnly: true` o `type: "secret"` (equivalentes). Se cifra en reposo (AES-256-GCM, la misma `DATA_ENCRYPTION_KEY` que la clave de IA) y **nunca se vuelve a leer**: la API solo devuelve `{ name, configured, set, updatedAt?, last4? }`. `last4` (los 4 últimos caracteres) solo existe si el campo declara `revealLast4: true` (apagado por defecto; secretos de menos de 12 caracteres no revelan nada).',
        'En la consola cada secreto muestra «Guardado — escribe para reemplazar» con la fecha de la última rotación y las acciones **Reemplazar** y **Borrar** (esta última pide confirmación). El campo es `type=password` con `autocomplete="new-password"`.',
        '**Un campo vacío en un guardado no borra nada**: solo `null` (la acción Borrar) elimina el valor. Reemplazar y borrar quedan en la auditoría con quién y cuándo, **nunca con el valor** (tampoco en exportaciones, copias, registros de ejecución, errores, estado de páginas ni respuestas de `execute`).',
        '**Validación en servidor al guardar**: `pattern`, `format` y `maxLength` del campo (tope 4096). El error indica el motivo sin repetir el valor.',
        '**Dentro del sandbox**: el `server.js` recibe el secreto descifrado en `ctx.env` (secretos de dominio, solo los declarados con `ENV_READ:*`) o en el propio elemento de `ctx.settings` (secretos por elemento de `objects`), solo durante esa ejecución y solo si la extensión lo declara y tiene permiso.',
        '**Migración**: los valores que aún estuvieran en claro (instalaciones antiguas) se cifran en el primer guardado de la extensión, de forma idempotente (repetirlo no cambia nada). Compatibilidad: cualquier cliente que dependiera de **leer** un valor guardado ya no podrá hacerlo (solo se devuelve el estado); un cliente antiguo que enviaba `""` para borrar debe enviar `null`.',
    ] },
    { t: 'h3', id: 'domain-config-users', text: 'Selector de usuarios: user, users y userMap' },
    { t: 'p', text: 'Son ajustes que configura el **administrador** (nivel ≥ 3) eligiendo cuentas del propio dominio. Se guarda siempre el **id estable** del usuario (nunca el correo); la consola resuelve el nombre y el correo con un buscador asíncrono y paginado. Solo se ven y se validan las cuentas del dominio actual.' },
    { t: 'table', head: ['Tipo', 'Control', 'Valor guardado / en ctx.settings'], rows: [
        ['`user`', 'Un usuario (buscador con resultados paginados)', 'Texto: el id'],
        ['`users`', 'Varios usuarios, con `maxItems` (tope 50)', 'Lista de ids sin repetidos'],
        ['`userMap`', 'Tabla buscable y paginada: un valor por usuario; añadir, quitar, «Todos: sí/no» y «Añadir a todos» (boolean)', '`{ [userId]: valor }` con entradas explícitas (tope `maxItems`, hasta 5000)'],
    ] },
    { t: 'ul', items: [
        '`userMap` usa `valueType`: `boolean` (por defecto), `string`, `number` (`min`, `max`, `integer`) o `select` (`options`). `default` es el valor de quien **no** tiene entrada; la tabla solo guarda entradas explícitas.',
        '`filter: { minLevel?, role? }` acota quién se puede elegir (nivel de permiso mínimo o nombre del nivel: user, support, operator, admin, superadmin).',
        '**Validación en servidor** (el servidor de la consola, contra la base del dominio): cada id **nuevo** debe existir, no estar desactivado y cumplir el filtro (errores `userMissing`, `userDisabled`, `userFilter`). Los ids ya guardados que luego desaparecen no bloquean otros cambios: la consola los marca **«Usuario eliminado»** y ofrece «Quitar eliminados». El backend compartido valida formato, tipos y topes.',
        '**En el handler**: `ctx.settings.owner` es el id, `ctx.settings.recipients` la lista y `ctx.settings.digest` el mapa completo (es configuración del administrador, sin secretos de usuarios). `ctx.settings.forUser(key, userId)` y `ctx.settings.getUserValue(key, userId)` devuelven la entrada explícita o, si no existe, el `default` (funciones no enumerables: no salen en `JSON.stringify(ctx.settings)`).',
        'API del buscador (nivel 3): `GET /api/admin/extensions/users?q=&page=&limit=` y `?ids=a,b` (resuelve y marca los inexistentes). CLI: `extensions users --q ana`.',
    ] },
    { t: 'code', lang: 'json', title: 'manifest.json: user, users, userMap y secreto', code: userFieldsManifest },
    { t: 'code', lang: 'javascript', title: 'server.js: ctx.settings.forUser', code: userFieldsUsageEs },
    { t: 'settings-preview' },
    { t: 'h3', id: 'domain-config-objects', text: 'Listas de elementos (objects), acciones y registro' },
    { t: 'ul', items: [
        '**`objects`**: lista editable de registros (p. ej. los endpoints de un webhook). `itemFields` declara los sub-campos (tipos simples, con `required` y `visibleWhen`); cada elemento lleva un `id` estable (`[a-z0-9-]`, único, hasta 32 caracteres) que la consola genera a partir de un nombre más un sufijo y **no se puede editar** después de guardar. Máximo 50 elementos.',
        '**Secretos por elemento**: un sub-campo con `secret: true` se guarda **cifrado por elemento** (nombre `campo.id.subcampo`), es de **solo escritura** y llega al handler únicamente dentro del sandbox. La consola solo recibe `secretsSet` (los nombres establecidos): muestra «Configurado / No configurado», un campo de contraseña vacío para establecer o reemplazar y el botón «Quitar». Los secretos viajan en `secrets` del mismo `PUT` y solo si el administrador los cambió.',
        '**`templates`**: elementos sugeridos con un botón «Añadir desde plantilla». No quedan activos por defecto: se añade el elemento, el administrador lo revisa y pulsa Guardar.',
        '**`actions`**: botones que invocan una función de `api.functions` con `{itemId?}` (`scope: "global"` arriba del formulario o `"item"` dentro de cada tarjeta, que se deshabilita si el elemento tiene cambios sin guardar). `confirm` pide confirmación. El resultado (`status`, código HTTP, latencia, mensaje y `report[]`) se muestra saneado y nunca incluye secretos; máximo 10 ejecuciones por minuto (HTTP 429).',
        '**`runLog: {limit}`**: registro acotado de ejecuciones (fecha, evento, destino, estado, intentos, latencia, código y mensaje corto; nunca cuerpos, cabeceras ni secretos). Alimenta «Registro de ejecuciones recientes» en la pestaña Estado y registro.',
        '**Errores de validación**: cada error lleva `path`, `code` y `params` además de `message` (español de respaldo). La consola traduce siempre por `code` + `params` (es/en): `type`, `control`, `format`, `pattern`, `number`, `integer`, `min`, `max`, `option`, `options`, `list`, `maxItems`, `maxChars`, `required`, `objects`, `itemId`, `itemDup`, `itemUnknown`, `itemSecret`, `itemField` (con el sub-código en `params.sub`), `json`, `jsonSize`... El `message` solo se usa si el código no tiene traducción.',
        'En un campo `objects` obligatorio, el listado «Configuración completa» cuenta 1 cuando hay al menos un elemento.',
    ] },
    { t: 'code', lang: 'json', title: 'manifest.json: objects, acciones y registro', code: objectsEx },
    { t: 'h3', id: 'domain-config-priority', text: 'Prioridad y retrocompatibilidad' },
    { t: 'ul', items: [
        'Valor efectivo de un ajuste: **ajuste del dominio > valor heredado del dominio > variable de entorno global (`legacyEnv`) > `default`**. Si nada lo define, la clave queda sin valor (`unset`).',
        '`legacyEnv` nombra la variable de entorno que respaldaba el ajuste antes de existir el esquema (p. ej. `DLP_KEYWORDS`). Si el esquema es heredado y la clave ya está en MAYÚSCULAS, esa misma clave hace de `legacyEnv`. Las extensiones sin `settingsSchema` siguen funcionando igual y la pestaña Ajustes muestra la tabla de solo lectura de antes.',
        'El panel marca cada ajuste que aún se resuelve desde el entorno heredado («usando variable de entorno (heredada): migra a Ajustes») y avisa en el Resumen. **Importar desde el entorno** (solo si hay algo importable) copia al dominio esos ajustes **no secretos**; los secretos no se tocan y el valor del entorno global nunca se muestra en la consola: se copia en el servidor. Un campo con `envImport: false` queda fuera de la importación.',
        '**Restablecer a valores por defecto** borra los ajustes guardados del dominio (pide confirmación) y no toca las credenciales.',
    ] },
    { t: 'h3', id: 'domain-config-api', text: 'Validación, auditoría y límites' },
    { t: 'ul', items: [
        'La consola valida en vivo con las **mismas reglas** que el backend (`validateFieldValue`, módulo compartido `settings-schema`); el servidor vuelve a validar y responde `422 {errors:[{path:"values.<clave>", message}]}`, que la consola pinta junto al campo. Un `required` visible sin valor (propio, heredado o por defecto) cuenta en la lista «Configuración completa X/Y» del Resumen.',
        'API: `GET/PUT/POST /api/extension/config` (el proxy de la consola es `/api/admin/extensions/config`: lectura nivel 3, escritura y importación nivel 4; CLI: `extensions config`, `config set`, `config reset`, `config import-env`).',
        'Auditoría: cada cambio registra `admin.extension.config` con la acción, el resultado y **solo los nombres** de las claves cambiadas o importadas, nunca sus valores.',
        'Límites: hasta 60 campos por esquema; texto de 1000 caracteres (5000 en `multiline`); listas de 200 elementos de 200 caracteres; JSON de 8 KB; patrones regex de 200 caracteres sin referencias hacia atrás ni lookaround; `settings.config` completo, 32 KB.',
    ] },
    { t: 'h2', id: 'outgoing-webhooks', text: 'Webhooks salientes' },
    { t: 'p', text: 'La extensión **webhooks** (`core-webhooks`) entrega eventos de correo a las URL que configure el administrador. Se configura en la consola (extensiones → Webhooks → **Ajustes**): hasta 20 **endpoints**, cada uno con nombre, URL https, interruptor *Activo*, **secreto de firma** (cifrado y de solo escritura), eventos, filtros y límites. Sin secreto no se entrega.' },
    { t: 'table', head: ['Evento', '`type` del payload', 'Datos'], rows: [
        ['`EMAIL_RECEIVED`', '`email.received`', '`emailId`, `userId` y lo que el dominio firmante incluya (carpeta, remitente, etiquetas, asunto/cuerpo si se activan)'],
        ['`EMAIL_SENT`', '`email.sent`', '`emailId`, `toCount`, `ccCount`, `bccCount`, `hasAttachments`, `sentAt` (sin destinatarios)'],
        ['`EMAIL_OPENED`', '`email.opened`', '`emailId`, `folder`, `fromEmail`, `isRead`'],
    ] },
    { t: 'callout', kind: 'note', title: 'Spam, etiquetas y altas de usuario', text: '«Spam detectado», «etiqueta aplicada» y «usuario creado» **no existen como hook** y no se han simulado. Para añadirlos hay que (1) agregar el valor a `LIFECYCLE_EVENTS` y a la lista blanca de contexto del ejecutor de hooks, (2) llamar a `/api/extension/hooks` desde el flujo que lo origina (clasificador, etiquetado, alta de usuario) y (3) añadir el intercept y la opción en `events` del manifest.' },
    { t: 'h3', id: 'outgoing-webhooks-filters', text: 'Filtros y contenido' },
    { t: 'p', text: 'Los filtros opcionales `folder`, `senderDomain` y `label` solo se evalúan si el evento trae ese dato; si el filtro está configurado y falta el dato, el evento **no se entrega** (`skipped`): es más seguro filtrar de más que de menos. `includeSubject` e `includeBody` solo añaden asunto/cuerpo cuando el contexto del evento los trae.' },
    { t: 'h3', id: 'outgoing-webhooks-payload', text: 'Payload y firma' },
    { t: 'code', lang: 'json', title: 'Cuerpo versionado', code: webhookPayload },
    { t: 'ul', items: [
        'Cabeceras: `X-BloomX-Signature: sha256=<hex>`, `X-BloomX-Timestamp` (segundos Unix), `X-BloomX-Event` y `X-BloomX-Delivery` (uuid, igual en los reintentos).',
        'Firma: `sha256=HMAC-SHA256(secreto, "<timestamp>.<cuerpo exacto>")`. El timestamp se renueva en cada reintento; el `id` del payload no cambia, así que sirve para deduplicar.',
        '**Verificación en el receptor**: usa el cuerpo **crudo**, compara en tiempo constante y rechaza timestamps con más de **5 minutos** de diferencia (anti-replay). Guarda además los `X-BloomX-Delivery` ya vistos durante 5 minutos.',
    ] },
    { t: 'code', lang: 'javascript', title: 'Receptor en Node.js', code: webhookNode },
    { t: 'code', lang: 'python', title: 'Receptor en Python', code: webhookPy },
    { t: 'h3', id: 'outgoing-webhooks-delivery', text: 'Entrega, reintentos y registro' },
    { t: 'ul', items: [
        '**Reintentos** de 0 a 5 con espera exponencial (300 ms · 2^n) dentro de un **presupuesto de ≈9 s por evento** (los hooks se cortan a 10 s) y **18 peticiones por invocación** (el sandbox permite 20). Los endpoints se entregan en paralelo.',
        '**Límite de tasa por endpoint** (`rateLimitPerMinute`), calculado sobre el registro de entregas (máximo 100 entradas guardadas).',
        '**SSRF y redirecciones**: solo https, sin credenciales en la URL, sin localhost, redes privadas ni IPv6 literal; no se siguen redirecciones (una 3xx se registra como fallo: configura la URL final).',
        '**Enviar evento de prueba**: botón dentro de cada endpoint (deshabilitado si tiene cambios sin guardar); hace un único intento de `webhook.test` y muestra código, latencia y mensaje.',
        '**Registro de entregas**: «Registro de ejecuciones recientes» en Estado y registro (fecha, evento, destino, estado, intentos, latencia, código, mensaje). Nunca URLs, cuerpos, cabeceras ni secretos.',
        '**Endpoint heredado** (`webhookUrl` / `WEBHOOK_URL`): si no hay endpoints se sintetiza uno solo para `EMAIL_RECEIVED`, firmado con `WEBHOOK_SECRET` si existe y con el campo antiguo `event: "email_received"`. Ambos ajustes están obsoletos: crea un endpoint nuevo con su secreto y retira el heredado.',
    ] },
    { t: 'h2', id: 'mail-groups-defaults', text: 'Grupos por defecto de mail-groups' },
    { t: 'ul', items: [
        '**`defaultGroups`** (desde la 1.1.0) es una lista `objects` de hasta 30 grupos del dominio: alias, dirección opcional, descripción, hasta 200 miembros y visibilidad (`domain` o `private`). Plantillas sugeridas (no activas): **todos**, **soporte** y **ventas**.',
        '**Prioridad del usuario**: los grupos del dominio se fusionan **por debajo** de los alias del usuario; si el usuario tiene un alias con el mismo nombre (con o sin `@`), gana el suyo y nunca se modifica ni se borra nada de lo suyo. La expansión es idempotente y no duplica direcciones.',
        '**Aplicar ahora** (`applyNow`) no copia nada: el modelo es de expansión en tiempo de uso, así que la acción devuelve un **informe de validación** (`report[]`: aplicado u omitido y el motivo).',
        '**`autoAddNewUsers` no existe** por una limitación técnica real: añadir usuarios nuevos exige conocer los usuarios del dominio y enterarse de un alta, y el sandbox no tiene ni un servicio de directorio de usuarios (`ctx.user` es solo quien ejecuta; los `services.*` operan sobre el usuario actual) ni un evento de alta en `LIFECYCLE_EVENTS`. Haría falta un servicio de host `users.list` con permiso propio o un evento `USER_CREATED` con su lista blanca de contexto.',
    ] },
    { t: 'h2', id: 'sandbox', text: 'Sandbox y sus límites' },
    { t: 'p', text: 'Cada invocación crea un `worker_threads` **nuevo** (sin variables de entorno del proceso) con un contexto `node:vm` de prototipo nulo y sin `eval`/`new Function`. Toda entrada/salida sale por mensajes al hilo principal.' },
    { t: 'table', head: ['Límite', 'Valor'], rows: [
        ['Heap / pila', '128 MB viejo, 32 MB joven, 4 MB de pila'],
        ['Timeout por invocación', '25 s por defecto; por función `api.functions.<f>.timeout` (100–60000 ms). Duro (`worker.terminate()`): cubre bucles síncronos y asíncronos'],
        ['Entrada / salida', '10 MB de contexto / 5 MB de resultado'],
        ['`fetch`', '20 por invocación; solo https; 10 s; respuesta ≤5 MB'],
        ['`services.ai`', '5 llamadas por invocación'],
        ['Mensajes / logs', '500 mensajes; 200 líneas de log'],
        ['Concurrencia', '`EXT_SANDBOX_MAX_WORKERS` (1–64, por defecto 8); cola de 5 s, luego `Sandbox busy`'],
    ] },
    { t: 'ul', items: [
        '**Disponible**: `console`, `setTimeout`/`clearTimeout`, `URL`, `URLSearchParams`, un `Buffer` mínimo (`from`, `byteLength`, `isBuffer`, `toString`), `crypto` con `randomUUID`, `sha256Hex` y `hmacSha256Hex`, `fetch` (a través de `safe-fetch`), `module`/`exports` y `process.env` (solo las variables autorizadas).',
        '**No existe**: `require`, `import`, `eval`, `setInterval`, `AbortController`, `Headers`, `Request`, `Response`, `FormData`, `Blob`.',
        '`safe-fetch` bloquea IP privadas y metadatos de nube, valida la IP al conectar y limita las redirecciones a 3.',
    ] },
    { t: 'callout', kind: 'warn', title: 'No es una frontera fuerte', text: 'Un worker con `vm` **no** es un sandbox del sistema operativo. Si el código escapara del contexto, seguiría en el mismo proceso y usuario, con acceso a `fs`, `net` y `child_process`; la memoria fuera del heap de V8 tampoco está acotada. Instala solo extensiones en las que confíes. Para código de terceros hostil hace falta un contenedor o microVM por tenant, un usuario sin privilegios y sin credenciales en disco.' },
    { t: 'h2', id: 'hooks', text: 'Hooks (intercepts)' },
    { t: 'p', text: 'Un `intercept` engancha una función a un evento del sistema. Se declara en `intercepts` o en su alias `hooks`. Campos: `point` (`EMAIL_PRE_SEND`, `EMAIL_RECEIVED`, `CRON` o uno de los nueve [eventos de ciclo de vida](#lifecycle)), `handler`, `priority` (`HIGH`, `NORMAL`, `LOW`, `MONITOR` o número), `onError` (`block` o `continue`, por defecto `continue`) y, para `CRON`, `schedule` (`hourly` o `daily`).' },
    { t: 'table', head: ['Evento', 'Quién lo dispara', 'Semántica'], rows: [
        ['`EMAIL_PRE_SEND`', '`POST /api/emails` del frontend, justo antes de enviar (proxy firmado a `/api/extension/hooks`)', 'Único que puede **bloquear**: `{stop:true, message}` responde 422 `EXTENSION_BLOCKED`. `{modify:{subject?,html?,text?}}` reescribe el contenido (nunca destinatarios); los cambios se encadenan. `{warning}` avisa. `MONITOR` se ejecuta pero no bloquea ni modifica. Si un handler con `onError:"block"` falla, se bloquea. Presupuesto de 8 s comprobado antes de lanzar cada hook'],
        ['`EMAIL_RECEIVED`', '`POST /api/webhooks/resend` del frontend, tras guardar el correo (en segundo plano)', 'Solo dominios **firmados**. Contexto `{emailId, userId, domain}`. No bloquea ni modifica. Se omite en silencio si el frontend no tiene `BLOOMX_DOMAIN_PRIVATE_KEY`'],
        ['`CRON`', 'El endpoint existe en el backend (dominio firmado, o el operador con `Authorization: Bearer <BACKEND_CRON_SECRET>`)', '**Nadie lo llama hoy**: `/api/cron/run` del frontend no invoca hooks y ninguna extensión actual declara un `intercept` `CRON`'],
    ] },
    { t: 'ul', items: [
        'Si el backend no responde, el frontend **envía igualmente** el correo y registra el fallo; con `EXTENSION_HOOKS_FAIL_CLOSED=true` no lo envía. `EXTENSION_HOOKS_DISABLED=true` desactiva la llamada. Timeout de la llamada: 10 s.',
        'En modo legado solo `EMAIL_PRE_SEND` se acepta; `EMAIL_RECEIVED`, `CRON` y los eventos de ciclo de vida responden 403 (estos últimos ni se disparan desde el frontend).',
    ] },
    { t: 'h2', id: 'user-prefs', text: 'Preferencias del usuario y extensiones obligatorias' },
    { t: 'p', text: 'Cada usuario puede **desactivar** una extensión para sí mismo en `/extensions` (se guarda en `expansionSettings["system:extension-prefs"]`). Eso ya no solo oculta la interfaz: en dominios **firmados** el frontend incluye la lista `disabledExtensions` (leída de los ajustes del usuario en el servidor, no del navegador; ids válidos, sin duplicados, máx. 200) dentro del cuerpo firmado de `hooks` y `execute`, y el backend **no ejecuta** esas extensiones para ese usuario.' },
    { t: 'table', head: ['Caso', 'Comportamiento'], rows: [
        ['Extensión desactivada por el usuario', 'Sus hooks (`EMAIL_PRE_SEND`, `EMAIL_RECEIVED`, ciclo de vida) no se ejecutan para él; `execute` responde 403 `EXTENSION_DISABLED_BY_USER`'],
        ['Extensión **obligatoria**', '`mandatory: true` en el manifest, o política del dominio «Obligatoria para todos» (`ExtensionOnDomain.settings.meta.mandatory`). Se ejecuta **siempre**, aunque la lista venga manipulada; la interfaz la muestra bloqueada con una explicación'],
        ['`CRON`', 'No tiene usuario: ignora la lista'],
        ['Dominio LEGADO (sin firma)', 'No recibe la lista y se ejecuta todo como antes'],
        ['No se pueden leer las preferencias', 'No se envía lista: se ejecutan todas (nunca se bloquea el envío por esto)'],
    ] },
    { t: 'p', text: 'El administrador marca una extensión como obligatoria en la consola (`/admin/extensions` → detalle → «Obligatoria para todos»; pide confirmación, audita `extension.mandatory_changed` y exige `requireAdmin` más la sesión de gestor del dominio). Si el manifest ya la declara, el interruptor queda bloqueado. Desinstalar retira la política. La extensión **DLP** se publica con `mandatory: true`.' },
    { t: 'p', text: 'Detalles de seguridad en [Extensiones: validación, preferencias y obligatorias](/docs/security#extension-controls).' },
    ...servicesEs,
    { t: 'h2', id: 'slash', text: 'slashCommands' },
    { t: 'p', text: 'Los comandos `/` del editor de redacción salen de los manifests de las extensiones instaladas. Cada uno es `{key, description, action, arguments?}` con `key` `^[a-zA-Z0-9_-]{1,32}$`. `/` al inicio o tras un espacio abre el menú; flechas, `Home`/`End` navegan, `Enter` ejecuta, `Tab` completa y `Esc` cierra. El texto tras el comando llega como `args`/`slashArgs`. Si dos extensiones repiten la clave gana la primera.' },
    { t: 'code', lang: 'json', title: 'slashCommands en el manifest', code: slashEx },
    ...versioningEs,
    { t: 'h2', id: 'catalogue', text: 'Catálogo actual y estado' },
    { t: 'table', head: ['Extensión', 'Estado'], rows: [
        ['`calendar`, `zoom`, `google-meet`', 'Funcionales (Zoom exige credenciales de dominio; Meet, cuenta Google vinculada o credenciales)'],
        ['`notion`, `trello`, `hubspot`, `giphy`', 'Funcionales con credenciales del dominio (`GIPHY_API_KEY` para Giphy)'],
        ['`composer-helper`, `mail-groups`, `signature`, `dlp`, `webhooks`, `slash-commands`', 'Funcionales (`dlp` bloquea vía `EMAIL_PRE_SEND`; `slash-commands` es solo cliente)'],
        ['`google-drive`', 'Parcial: listar e insertar enlaces, sin interfaz de subida'],
        ['`google-sync`, `appointments`', 'Solo cliente (`clientOnly`, sin `server.js`)'],
        ['`summarizer`, `translator`, `smart-reply`', 'Parciales: dependen de que el correo abierto aporte su contenido completo'],
        ['`organizer`', 'Activo, pero requiere `services.mail` (dominio firmado: la instancia aporta la `executionGrant`); si no, falla con `ORGANIZER_MAIL_SERVICE_UNAVAILABLE` y el hook se omite. Ver [Organizer](/docs/sealer#organizer)'],
        ['`sealer`', 'Activo, pero el cifrado ocurre en el navegador; su `server.js` solo describe el protocolo. Ver [Sealer](/docs/sealer)'],
    ] },
    { t: 'callout', kind: 'note', text: 'Estado según manifests, código y tests del repositorio; no se ejecutó contra proveedores reales (Google, Zoom, Notion…).' },
];

const en: Block[] = [
    { t: 'p', text: 'An **extension** (also called an *expansion* in code and UI) adds interface and logic to BloomX without touching its code. It has a `manifest.json` (declarative: what is shown, which functions it exposes, which permissions it asks for) and, optionally, a `server.js` that runs on the **shared backend** inside a sandbox. To build one step by step see [Build an extension](/docs/create-extension).' },
    { t: 'h2', id: 'model', text: 'Model' },
    { t: 'ul', items: [
        'Extensions live in the `bloomx-extensions` repository (one folder each) and are **published** to the backend (database + storage). Each domain (company) **installs** the ones it wants.',
        'The frontend receives the domain\'s enabled extensions from `GET /api/config` (with their `template`, i.e. the manifest, and secret-free `settings`) and renders their UI at *mount points*.',
        'When the UI calls a function (`CALL_BACKEND`) or a hook fires, the frontend makes a **signed** proxy call to the backend (`/api/extension/execute` or `/api/extension/hooks`), which runs `server.js` in the sandbox.',
        '**Client-only** extensions (`"clientOnly": true`, no `server.js`), such as `slash-commands`, `appointments` or `google-sync`, run nothing on the backend.',
    ] },
    { t: 'h2', id: 'contract', text: 'The handler(ctx) contract' },
    { t: 'p', text: 'Every function exported by `server.js` receives **a single parameter** `ctx` and returns a JSON-serialisable value (up to 5 MB). A repository test fails if a handler declares more than one parameter.' },
    { t: 'code', lang: 'javascript', title: 'server.js', code: handlerExEn },
    { t: 'table', head: ['`ctx` field', 'Content'], rows: [
        ['`args`', 'Call parameters (`CALL_BACKEND.args` plus `formData`), or `{}`'],
        ['`env`', 'Only keys declared with `ENV_READ:*` (see [credentials](#credentials))'],
        ['`domain`', '`{id, name, displayName, logo, theme}` (theme without secrets)'],
        ['`user`', '`{id, email}` or `null`. Set by the server from the signed identity'],
        ['`settings`', 'Installation settings without secrets (no credentials)'],
        ['`extension`', '`{id, sourceId, name, manifest}`'],
        ['`services.ai.generate(system, prompt)`', 'Generates text with the instance AI (signed bridge `/api/internal/host/ai`, configured in `/admin/ai`; max 5 calls per invocation). Typed errors: [AI](/docs/ai#errors)'],
        ['`services.auth.getToken(provider)`', 'OAuth token of the user or domain; string or `null`. Order: `ctx.auth`, installation `authData`, `<PROVIDER>_ACCESS_TOKEN` credential, setting and, if allowed, a global variable'],
        ['`services.mail.*`', '`listRecent`, `getEmail`, `applyBatch`, `undoRun`. Only if the call is signed by the domain (the instance supplies the `executionGrant`) and the manifest declares `READ_EMAIL` (read) or `MAIL_LABEL` (label/undo)'],
        ['`services.calendar`, `contacts`, `storage`, `notify`, `formats`', 'Only on signed domains and according to the manifest permissions (absent in legacy mode). See [Sandbox services](#services)'],
        ['Everything else', 'What the client sends (`emailContent`, `subject`, `to`, `from`…). **Not trusted**: the client can never override `args`, `env`, `domain`, `user`, `settings` or `extension`'],
    ] },
    { t: 'ul', items: [
        '**Errors**: `throw new Error(msg)` returns `{success:false, error}` with HTTP 500; `AUTH_REQUIRED` gives 401; a timeout, 408; an unexported action, 404.',
        '**Convention** (not enforced): return `{success, ...}`.',
        'For hooks (`ctx.event`) the return value has its own semantics, see [Hooks](#hooks).',
    ] },
    { t: 'h2', id: 'manifest', text: 'Manifest and schema' },
    { t: 'p', text: 'The canonical schema is `bloomx-extensions/_shared/manifest-schema.ts`, with two identical copies (backend and frontend) that a test compares. **Errors** block loading or publishing; **warnings** do not.' },
    { t: 'table', head: ['Field', 'Rule'], rows: [
        ['`id`', 'Required. `^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$`'],
        ['`name`', 'Required. Non-empty text, max 120'],
        ['`version`', 'Required. Semver `X.Y.Z` (optional suffix)'],
        ['`description`', 'Optional, max 2000'],
        ['`manifestVersion`', 'Optional. `"1.0"` or `"2.0"` (other values warn)'],
        ['`status`', 'Optional. `"active"` or `"disabled"` (any other value is an error)'],
        ['`permissions`', 'List of strings; see [permissions](#permissions)'],
        ['`auth`', '`{type}` with `NONE`, `OAUTH2`, `API_KEY`, `WEBHOOK_SECRET` or `BASIC_AUTH`'],
        ['`api`', '`runtime` (only `nodejs`), `entry` (relative path, no `..`) and `functions: {name: {handler, timeout?}}` with `timeout` from 100 to 60000 ms'],
        ['`mounts[]`', '`point` required and `component` or `handler`; `OVERLAY` mounts require `id`'],
        ['`overlays`', '`{id: component}` object for `OPEN_OVERLAY`'],
        ['`intercepts[]` / `hooks[]`', 'Hooks (`hooks` is an alias with the same shape): `point`, `handler`, `priority`, `onError`, `schedule`'],
        ['`slashCommands[]`', '`{key, description, action, arguments?}`'],
        ['`clientOnly`', 'Documentation flag for server-less extensions'],
        ['`category`', 'Category for the `/extensions` page (`mail`, `composer`, `calendar`, `contacts`, `automation`, `ai`, `integrations`, `settings`, `other` or its es/en alias). Unknown: warning, derived from mounts and permissions'],
        ['`tags`', 'Up to 12 search tags of 1 to 30 characters, no HTML'],
        ['`screenshots`', 'Up to 6 absolute **https** URLs (no user/password, max 2000 characters). `http`, `javascript:` and `data:` are rejected'],
        ['`changelog`', 'Up to 20 entries `{version, date?, notes?}`; `notes` (text or list, max 1000 characters) is shown as plain text'],
        ['`mandatory`', '`true` = **mandatory for every** user (DLP, security): it cannot be turned off and its server hooks always run. See [user preferences](#user-prefs)'],
        ['`conferencingProviders[]`', 'Video-call providers `{id, name, icon?, handlers}`; `handlers` points to `api.functions` (standard: `status`, `testConnection`, `createMeeting`, `updateMeeting`, `deleteMeeting`) and `createMeeting` is required'],
    ] },
    { t: 'ul', items: [
        'Cross rules: every `CALL_BACKEND.function`, `mount.handler` and `intercept.handler` must exist in `api.functions`. Maximum component-tree depth: 40. An unknown action is an **error**; an unknown component or mount point is only a warning.',
        '`backendRoutes` produces a warning: there is **no** `/api/ext/[id]/*` router, so it is not served.',
        'The list of component types is **derived** from `ui-schema.ts` (the ~70 of the kit) plus the old-format names (`COLUMN`, `DATA_TABLE`…): a kit type never triggers the "unknown component" warning. Manifest limits: 1 MB, 12 tags, 6 screenshots, 20 changelog entries and 50,000 visited nodes.',
        '**Validation on publish**: besides the manifest, the backend validates the whole UI with the mirror of `ui-schema.ts` (error path included, e.g. `mounts[0].component.props.tone`). Invalid structure = **400**; invalid or over-limit UI (600 nodes and 24 levels per tree, 256 KB, 200 mounts, 100 overlays, 5000 nodes in total) = **422**. It applies to `POST /api/admin/extensions`, the `/admin` actions (`createExtension`, `syncRepositoryExtensions`), `sync-extensions.mjs` and `scripts/sync-repository-extensions.mjs` (they fail closed), seeding and **install** (`422 EXTENSION_INVALID`). When loading an already published extension, the frontend treats catalogue-field problems as warnings (`lenientCatalog`), not errors.',
    ] },
    { t: 'code', lang: 'json', title: 'Minimal manifest (dlp, no UI)', code: manifestMin },
    { t: 'h3', id: 'ui', text: 'Declarative UI' },
    { t: 'p', text: 'The UI is a JSON tree of components (for example `BUTTON`, `TEXT`, `INPUT`, `CARD`, `ROW`, `MODAL`, `TABS`, `FORM`, `LIST`, `DATA_TABLE`, `MARKDOWN`, `FILE_UPLOAD`, `WIZARD`…) and actions (`SET_STATE`, `CALL_BACKEND`, `CALL_API`, `TOAST`, `OPEN_OVERLAY`, `OPEN_URL`, `INSERT_CONTENT`, `APPEND_BODY`, `SET_SUBJECT`, `ADD_ATTACHMENT`, `NEXT_STEP`, `SECURE_SAVE`, `OAUTH_CONNECT`…). `${...}` expressions are evaluated by a custom interpreter without `eval`; `CALL_API` only accepts own `/api/...` routes; `OPEN_URL` and links only `http(s)`, `mailto` and `tel`.' },
    { t: 'p', text: 'Mount points supported by the schema: those for mail, sidebar, composer, calendar, contacts and settings (full table with their context in [Mount points](#mount-points)), plus `EVENT_LOCATION_BUILDER`, `SETTINGS_TAB`, `CUSTOM_SETTINGS_TAB`, `PAGE`, `OVERLAY`, `SLASH_COMMAND` and the editing `*_HANDLER`s. **Not all have a consumer in the UI**: `BEFORE_SEND_HANDLER`, `CUSTOM_ROUTE` and `backendRoutes` do nothing today.' },
    ...permissionsEn,
    { t: 'h2', id: 'credentials', text: 'Per-domain credentials' },
    { t: 'ul', items: [
        'Each company sets its own credentials (for example `GIPHY_API_KEY`) in the admin panel (extensions → credentials) or with `PUT /api/extension/settings`. They are stored **encrypted** (`enc:v1:`, AES-256-GCM with the backend `DATA_ENCRYPTION_KEY`) and **never returned to the browser**: the UI only sees `{name, configured}`.',
        'Only names declared with `ENV_READ:*` in the manifest and not reserved are accepted; value up to 4096 characters, no control characters. `null` or an empty string deletes.',
        '**Read at run time**: for each `ENV_READ:X`, in this order: (1) the **domain** credential (encrypted, written by the manager from the panel), (2) the **legacy** value older installs stored and (3) the backend global variable, except platform variables (database, storage, encryption, private keys, `EXTENSION_*`, etc.), which no extension can ever read. `EXTENSION_GLOBAL_ENV_FALLBACK` is an optional hardening control: `none` disables step 3 and a list limits it to those names. The panel shows the active source of each variable.',
        'In legacy mode (no signature) the extension receives the same credentials, which stay inside the sandbox and are never returned; it has no `services.mail` and every run is audited. `requireSignature` rejects legacy mode.',
        'Uninstalling an extension deletes its credentials and `authData`, and **tries** to revoke OAuth tokens at the provider (Google, HubSpot, Notion, Zoom; best effort, 5 s).',
    ] },
    { t: 'h2', id: 'domain-config', text: 'Per-domain configuration vs environment variables' },
    { t: 'p', text: 'A manifest can declare `settingsSchema`: the fields the administrator configures **per domain** in the console (extensions → detail → **Settings** and **Credentials** tabs), without touching server environment variables. Each field has `key`, `type`, `label`/`description` (text or `{es, en}`), `default`, `required`, `group` (sections defined in `groups`), `visibleWhen: {key, in:[...]}` and the limits of its type.' },
    { t: 'code', lang: 'json', title: 'manifest.json: settingsSchema', code: domainConfigManifest },
    { t: 'table', head: [
        'Type',
        'Console control',
        'Stored value',
    ], rows: [
        ['`string`, `multiline`', 'Text field / textarea (`maxLength`, `pattern`, `format`: `email`, `url`, `domain`, `regex`)', 'Text'],
        ['`number`', 'Number field (`min`, `max`, `integer`)', 'Number'],
        ['`boolean`', 'Switch', 'Boolean'],
        ['`enum`', 'Dropdown (`options`)', 'One of the `options` values'],
        ['`multienum`', 'Checkboxes, each with description and example', 'List of `options` values (may be empty)'],
        ['`list`', 'One item per line, with counter (`maxItems`, `itemMaxLength`)', 'List of unique strings'],
        ['`json`', 'Textarea with validation', 'Any JSON up to 8 KB'],
        ['`user`, `users`', 'Search over the domain\'s users (one / several)', 'Stable user id(s)'],
        ['`userMap`', 'Table of users with one value each (`valueType`)', 'Map `{ userId: value }`'],
    ] },
    { t: 'h3', id: 'domain-config-secrets', text: 'Secrets vs settings' },
    { t: 'ul', items: [
        '**Secrets** (`secret: true`): tokens, keys and passwords. The `key` is the UPPERCASE variable name (the same as `ENV_READ:*`) and takes no `default`. They are stored **encrypted** as domain credentials, edited only in the **Credentials** tab and their value never returns to the browser. The Settings tab only shows "n of m secrets configured" with a link.',
        '**Settings** (everything else): typed values stored in clear in `ExtensionOnDomain.settings.config` and received by the extension in **`ctx.settings[key]`**. Do not put secrets here. Reserved keys: `credentials`, `env`, `meta`, `ui`, `config`, `configMeta`, `authData`, `mandatory`.',
    ] },
    { t: 'code', lang: 'javascript', title: 'server.js: ctx.settings and ctx.env', code: domainConfigUsageEn },
    { t: 'h3', id: 'domain-config-writeonly', text: 'Write-only secrets' },
    { t: 'ul', items: [
        'A secret is declared with `secret: true`, `writeOnly: true` or `type: "secret"` (equivalent). It is encrypted at rest (AES-256-GCM, the same `DATA_ENCRYPTION_KEY` as the AI key) and **never read back**: the API only returns `{ name, configured, set, updatedAt?, last4? }`. `last4` (the last 4 characters) only exists when the field declares `revealLast4: true` (off by default; secrets shorter than 12 characters reveal nothing).',
        'In the console each secret shows "Saved — type to replace" with the date of the last rotation and the **Replace** and **Delete** actions (Delete asks for confirmation). The input is `type=password` with `autocomplete="new-password"`.',
        '**An empty field in a save deletes nothing**: only `null` (the Delete action) removes the value. Replacing and deleting are audited with who and when, **never with the value** (nor in exports, backups, run logs, errors, page state or `execute` responses).',
        '**Server-side validation on save**: the field\'s `pattern`, `format` and `maxLength` (cap 4096). The error explains the reason without repeating the value.',
        '**Inside the sandbox**: `server.js` receives the decrypted secret in `ctx.env` (domain secrets, only those declared with `ENV_READ:*`) or in the item itself in `ctx.settings` (per-item secrets of `objects`), only for that execution and only if the extension declares it and has the permission.',
        '**Migration**: values that were still stored in clear text (older installs) are encrypted on the extension\'s first save, idempotently (repeating it changes nothing). Compatibility: any client that relied on **reading** a stored value can no longer do so (only the state is returned); an old client that sent `""` to delete must send `null`.',
    ] },
    { t: 'h3', id: 'domain-config-users', text: 'User picker: user, users and userMap' },
    { t: 'p', text: 'These are settings the **administrator** (level ≥ 3) configures by choosing accounts of their own domain. The user\'s **stable id** is always stored (never the email); the console resolves name and email with an async, paginated search. Only accounts of the current domain are visible and validated.' },
    { t: 'table', head: ['Type', 'Control', 'Stored value / in ctx.settings'], rows: [
        ['`user`', 'One user (search with paginated results)', 'Text: the id'],
        ['`users`', 'Several users, with `maxItems` (cap 50)', 'List of unique ids'],
        ['`userMap`', 'Searchable, paginated table: one value per user; add, remove, "Everyone: yes/no" and "Add everyone" (boolean)', '`{ [userId]: value }` with explicit entries (cap `maxItems`, up to 5000)'],
    ] },
    { t: 'ul', items: [
        '`userMap` uses `valueType`: `boolean` (default), `string`, `number` (`min`, `max`, `integer`) or `select` (`options`). `default` is the value for anyone **without** an entry; the table only stores explicit entries.',
        '`filter: { minLevel?, role? }` limits who can be picked (minimum permission level or level name: user, support, operator, admin, superadmin).',
        '**Server-side validation** (the console server, against the domain database): every **new** id must exist, not be disabled and meet the filter (`userMissing`, `userDisabled`, `userFilter` errors). Ids that were already stored and later disappear do not block other changes: the console marks them **"Deleted user"** and offers "Remove deleted". The shared backend validates format, types and caps.',
        '**In the handler**: `ctx.settings.owner` is the id, `ctx.settings.recipients` the list and `ctx.settings.digest` the whole map (it is administrator configuration, with no user secrets). `ctx.settings.forUser(key, userId)` and `ctx.settings.getUserValue(key, userId)` return the explicit entry or, if none exists, the `default` (non-enumerable functions: they do not show up in `JSON.stringify(ctx.settings)`).',
        'Search API (level 3): `GET /api/admin/extensions/users?q=&page=&limit=` and `?ids=a,b` (resolves and flags missing ones). CLI: `extensions users --q ana`.',
    ] },
    { t: 'code', lang: 'json', title: 'manifest.json: user, users, userMap and a secret', code: userFieldsManifest },
    { t: 'code', lang: 'javascript', title: 'server.js: ctx.settings.forUser', code: userFieldsUsageEn },
    { t: 'settings-preview' },
    { t: 'h3', id: 'domain-config-objects', text: 'Item lists (objects), actions and run log' },
    { t: 'ul', items: [
        '**`objects`**: an editable list of records (e.g. a webhook\'s endpoints). `itemFields` declares the sub-fields (simple types, with `required` and `visibleWhen`); every item has a stable `id` (`[a-z0-9-]`, unique, up to 32 characters) that the console generates from a name plus a suffix and that **cannot be edited** after saving. Up to 50 items.',
        '**Per-item secrets**: a sub-field with `secret: true` is stored **encrypted per item** (name `field.id.subfield`), is **write-only** and reaches the handler only inside the sandbox. The console only receives `secretsSet` (the names that are set): it shows "Configured / Not configured", an empty password input to set or replace, and a "Remove" button. Secrets travel in `secrets` of the same `PUT`, and only if the administrator changed them.',
        '**`templates`**: suggested items with an "Add from template" button. They are not active by default: the item is added, the administrator reviews it and presses Save.',
        '**`actions`**: buttons that call a function of `api.functions` with `{itemId?}` (`scope: "global"` above the form or `"item"` inside each card, disabled while the item has unsaved changes). `confirm` asks for confirmation. The result (`status`, HTTP code, latency, message and `report[]`) is shown sanitized and never includes secrets; at most 10 runs per minute (HTTP 429).',
        '**`runLog: {limit}`**: a bounded run log (date, event, target, status, attempts, latency, code and a short message; never bodies, headers or secrets). It feeds "Recent runs log" in the Status and log tab.',
        '**Validation errors**: every error carries `path`, `code` and `params` besides `message` (Spanish fallback). The console always translates by `code` + `params` (es/en): `type`, `control`, `format`, `pattern`, `number`, `integer`, `min`, `max`, `option`, `options`, `list`, `maxItems`, `maxChars`, `required`, `objects`, `itemId`, `itemDup`, `itemUnknown`, `itemSecret`, `itemField` (sub-code in `params.sub`), `json`, `jsonSize`... `message` is only used when the code has no translation.',
        'In a required `objects` field, the "Configuration complete" list counts 1 when there is at least one item.',
    ] },
    { t: 'code', lang: 'json', title: 'manifest.json: objects, actions and run log', code: objectsEx },
    { t: 'h3', id: 'domain-config-priority', text: 'Priority and backward compatibility' },
    { t: 'ul', items: [
        'Effective value of a setting: **domain setting > legacy domain value > global environment variable (`legacyEnv`) > `default`**. If nothing defines it, the key has no value (`unset`).',
        '`legacyEnv` names the environment variable that backed the setting before the schema existed (e.g. `DLP_KEYWORDS`). With a legacy schema whose key is already UPPERCASE, that key acts as `legacyEnv`. Extensions without `settingsSchema` keep working as before and the Settings tab shows the old read-only table.',
        'The panel flags every setting still resolved from the legacy environment ("using environment variable (legacy): migrate to Settings") and warns in the Summary. **Import from environment** (only when something is importable) copies those **non-secret** settings to the domain; secrets are untouched and the global environment value is never shown in the console: it is copied on the server. A field with `envImport: false` is left out of the import.',
        '**Reset to defaults** deletes the domain\'s saved settings (asks for confirmation) and does not touch credentials.',
    ] },
    { t: 'h3', id: 'domain-config-api', text: 'Validation, audit and limits' },
    { t: 'ul', items: [
        'The console validates live with the **same rules** as the backend (`validateFieldValue`, the shared `settings-schema` module); the server validates again and answers `422 {errors:[{path:"values.<key>", message}]}`, which the console renders next to the field. A visible `required` field without a value (own, legacy or default) counts in the Summary\'s "Configuration complete X/Y" list.',
        'API: `GET/PUT/POST /api/extension/config` (the console proxy is `/api/admin/extensions/config`: read level 3, write and import level 4; CLI: `extensions config`, `config set`, `config reset`, `config import-env`).',
        'Audit: every change records `admin.extension.config` with the action, the outcome and **only the names** of the changed or imported keys, never their values.',
        'Limits: up to 60 fields per schema; 1000-character text (5000 for `multiline`); lists of 200 items of 200 characters; 8 KB JSON; regex patterns of 200 characters without back-references or lookaround; the whole `settings.config`, 32 KB.',
    ] },
    { t: 'h2', id: 'outgoing-webhooks', text: 'Outgoing webhooks' },
    { t: 'p', text: 'The **webhooks** extension (`core-webhooks`) delivers mail events to the URLs the administrator configures. It is configured in the console (extensions → Webhooks → **Settings**): up to 20 **endpoints**, each with a name, https URL, an *Active* switch, a **signing secret** (encrypted, write-only), events, filters and limits. Nothing is delivered without a secret.' },
    { t: 'table', head: ['Event', 'Payload `type`', 'Data'], rows: [
        ['`EMAIL_RECEIVED`', '`email.received`', '`emailId`, `userId` and whatever the signing domain includes (folder, sender, labels, subject/body when enabled)'],
        ['`EMAIL_SENT`', '`email.sent`', '`emailId`, `toCount`, `ccCount`, `bccCount`, `hasAttachments`, `sentAt` (no recipients)'],
        ['`EMAIL_OPENED`', '`email.opened`', '`emailId`, `folder`, `fromEmail`, `isRead`'],
    ] },
    { t: 'callout', kind: 'note', title: 'Spam, labels and user creation', text: '"Spam detected", "label applied" and "user created" **do not exist as hooks** and were not simulated. To add them you must (1) add the value to `LIFECYCLE_EVENTS` and to the hook runner\'s context allow-list, (2) call `/api/extension/hooks` from the flow that produces it (classifier, labeling, user creation) and (3) add the intercept and the option in the manifest `events`.' },
    { t: 'h3', id: 'outgoing-webhooks-filters', text: 'Filters and content' },
    { t: 'p', text: 'The optional `folder`, `senderDomain` and `label` filters are only evaluated if the event carries that datum; if the filter is set and the datum is missing, the event is **not delivered** (`skipped`): filtering too much is safer than too little. `includeSubject` and `includeBody` only add subject/body when the event context carries them.' },
    { t: 'h3', id: 'outgoing-webhooks-payload', text: 'Payload and signature' },
    { t: 'code', lang: 'json', title: 'Versioned body', code: webhookPayload },
    { t: 'ul', items: [
        'Headers: `X-BloomX-Signature: sha256=<hex>`, `X-BloomX-Timestamp` (Unix seconds), `X-BloomX-Event` and `X-BloomX-Delivery` (uuid, the same across retries).',
        'Signature: `sha256=HMAC-SHA256(secret, "<timestamp>.<exact body>")`. The timestamp is renewed on every retry; the payload `id` does not change, so use it to deduplicate.',
        '**Receiver verification**: use the **raw** body, compare in constant time and reject timestamps more than **5 minutes** off (anti-replay). Also remember the `X-BloomX-Delivery` values already seen for 5 minutes.',
    ] },
    { t: 'code', lang: 'javascript', title: 'Node.js receiver', code: webhookNode },
    { t: 'code', lang: 'python', title: 'Python receiver', code: webhookPy },
    { t: 'h3', id: 'outgoing-webhooks-delivery', text: 'Delivery, retries and log' },
    { t: 'ul', items: [
        '**Retries** from 0 to 5 with exponential backoff (300 ms · 2^n) inside a **budget of ≈9 s per event** (hooks are cut at 10 s) and **18 requests per invocation** (the sandbox allows 20). Endpoints are delivered in parallel.',
        '**Per-endpoint rate limit** (`rateLimitPerMinute`), computed over the delivery log (at most 100 stored entries).',
        '**SSRF and redirects**: https only, no credentials in the URL, no localhost, private networks or literal IPv6; redirects are not followed (a 3xx is logged as a failure: configure the final URL).',
        '**Send test event**: a button inside every endpoint (disabled while it has unsaved changes); it makes a single `webhook.test` attempt and shows code, latency and message.',
        '**Delivery log**: "Recent runs log" in Status and log (date, event, target, status, attempts, latency, code, message). Never URLs, bodies, headers or secrets.',
        '**Legacy endpoint** (`webhookUrl` / `WEBHOOK_URL`): if there are no endpoints, one is synthesized for `EMAIL_RECEIVED` only, signed with `WEBHOOK_SECRET` if present and with the old `event: "email_received"` field. Both settings are deprecated: create a new endpoint with its secret and drop the legacy one.',
    ] },
    { t: 'h2', id: 'mail-groups-defaults', text: 'mail-groups default groups' },
    { t: 'ul', items: [
        '**`defaultGroups`** (since 1.1.0) is an `objects` list of up to 30 domain groups: alias, optional address, description, up to 200 members and visibility (`domain` or `private`). Suggested templates (not active): **everyone**, **support** and **sales**.',
        '**User priority**: domain groups are merged **below** the user\'s aliases; if the user has an alias with the same name (with or without `@`), theirs wins and nothing of theirs is ever modified or deleted. Expansion is idempotent and does not duplicate addresses.',
        '**Apply now** (`applyNow`) copies nothing: the model is expansion at use time, so the action returns a **validation report** (`report[]`: applied or skipped and why).',
        '**`autoAddNewUsers` does not exist** because of a real technical limit: adding new users requires knowing the domain\'s users and learning about a sign-up, and the sandbox has neither a user directory service (`ctx.user` is only whoever runs; `services.*` act on the current user) nor a sign-up event in `LIFECYCLE_EVENTS`. It would need a `users.list` host service with its own permission or a `USER_CREATED` event with its context allow-list.',
    ] },
    { t: 'h2', id: 'sandbox', text: 'Sandbox and its limits' },
    { t: 'p', text: 'Each invocation creates a **new** `worker_threads` worker (without the process environment variables) with a null-prototype `node:vm` context and no `eval`/`new Function`. All I/O leaves through messages to the main thread.' },
    { t: 'table', head: ['Limit', 'Value'], rows: [
        ['Heap / stack', '128 MB old, 32 MB young, 4 MB stack'],
        ['Timeout per invocation', '25 s by default; per function `api.functions.<f>.timeout` (100–60000 ms). Hard (`worker.terminate()`): covers synchronous and async loops'],
        ['Input / output', '10 MB context / 5 MB result'],
        ['`fetch`', '20 per invocation; https only; 10 s; response ≤5 MB'],
        ['`services.ai`', '5 calls per invocation'],
        ['Messages / logs', '500 messages; 200 log lines'],
        ['Concurrency', '`EXT_SANDBOX_MAX_WORKERS` (1–64, default 8); 5 s queue, then `Sandbox busy`'],
    ] },
    { t: 'ul', items: [
        '**Available**: `console`, `setTimeout`/`clearTimeout`, `URL`, `URLSearchParams`, a minimal `Buffer` (`from`, `byteLength`, `isBuffer`, `toString`), `crypto` with `randomUUID`, `sha256Hex` and `hmacSha256Hex`, `fetch` (through `safe-fetch`), `module`/`exports` and `process.env` (authorised variables only).',
        '**Not available**: `require`, `import`, `eval`, `setInterval`, `AbortController`, `Headers`, `Request`, `Response`, `FormData`, `Blob`.',
        '`safe-fetch` blocks private IPs and cloud metadata, validates the IP at connect time and limits redirects to 3.',
    ] },
    { t: 'callout', kind: 'warn', title: 'Not a strong boundary', text: 'A `vm` worker is **not** an operating-system sandbox. If code escaped the context it would still be in the same process and user, with access to `fs`, `net` and `child_process`; memory outside the V8 heap is not bounded either. Only install extensions you trust. Hostile third-party code needs a container or microVM per tenant, an unprivileged user and no credentials on disk.' },
    { t: 'h2', id: 'hooks', text: 'Hooks (intercepts)' },
    { t: 'p', text: 'An `intercept` attaches a function to a system event. Declared in `intercepts` or its `hooks` alias. Fields: `point` (`EMAIL_PRE_SEND`, `EMAIL_RECEIVED`, `CRON` or one of the nine [lifecycle events](#lifecycle)), `handler`, `priority` (`HIGH`, `NORMAL`, `LOW`, `MONITOR` or a number), `onError` (`block` or `continue`, default `continue`) and, for `CRON`, `schedule` (`hourly` or `daily`).' },
    { t: 'table', head: ['Event', 'Fired by', 'Semantics'], rows: [
        ['`EMAIL_PRE_SEND`', 'The frontend\'s `POST /api/emails`, right before sending (signed proxy to `/api/extension/hooks`)', 'The only one that can **block**: `{stop:true, message}` answers 422 `EXTENSION_BLOCKED`. `{modify:{subject?,html?,text?}}` rewrites content (never recipients); changes chain. `{warning}` warns. `MONITOR` runs but neither blocks nor modifies. If a handler with `onError:"block"` fails, the send is blocked. 8 s budget checked before launching each hook'],
        ['`EMAIL_RECEIVED`', 'The frontend\'s `POST /api/webhooks/resend`, after storing the message (in the background)', '**Signed** domains only. Context `{emailId, userId, domain}`. Neither blocks nor modifies. Silently skipped if the frontend has no `BLOOMX_DOMAIN_PRIVATE_KEY`'],
        ['`CRON`', 'The endpoint exists on the backend (signed domain, or the operator with `Authorization: Bearer <BACKEND_CRON_SECRET>`)', '**Nobody calls it today**: the frontend `/api/cron/run` does not invoke hooks and no current extension declares a `CRON` `intercept`'],
    ] },
    { t: 'ul', items: [
        'If the backend does not answer, the frontend **sends the mail anyway** and logs the failure; with `EXTENSION_HOOKS_FAIL_CLOSED=true` it does not. `EXTENSION_HOOKS_DISABLED=true` turns the call off. Call timeout: 10 s.',
        'In legacy mode only `EMAIL_PRE_SEND` is accepted; `EMAIL_RECEIVED`, `CRON` and the lifecycle events answer 403 (the latter are not even fired from the frontend).',
    ] },
    { t: 'h2', id: 'user-prefs', text: 'User preferences and mandatory extensions' },
    { t: 'p', text: 'Each user can **turn off** an extension for themselves in `/extensions` (stored in `expansionSettings["system:extension-prefs"]`). That no longer only hides the UI: on **signed** domains the frontend includes the `disabledExtensions` list (read from the user\'s settings on the server, not from the browser; valid ids, no duplicates, max 200) inside the signed body of `hooks` and `execute`, and the backend **does not run** those extensions for that user.' },
    { t: 'table', head: ['Case', 'Behaviour'], rows: [
        ['Extension turned off by the user', 'Its hooks (`EMAIL_PRE_SEND`, `EMAIL_RECEIVED`, lifecycle) do not run for them; `execute` answers 403 `EXTENSION_DISABLED_BY_USER`'],
        ['**Mandatory** extension', '`mandatory: true` in the manifest, or the domain policy "Mandatory for everyone" (`ExtensionOnDomain.settings.meta.mandatory`). It **always** runs, even if the list is tampered with; the UI shows it locked with an explanation'],
        ['`CRON`', 'Has no user: ignores the list'],
        ['LEGACY domain (unsigned)', 'Does not receive the list and everything runs as before'],
        ['Preferences cannot be read', 'No list is sent: everything runs (sending mail is never blocked because of this)'],
    ] },
    { t: 'p', text: 'The administrator marks an extension as mandatory in the console (`/admin/extensions` → detail → "Mandatory for everyone"; asks for confirmation, audits `extension.mandatory_changed` and requires `requireAdmin` plus the domain manager session). If the manifest already declares it, the switch is locked. Uninstalling removes the policy. The **DLP** extension ships with `mandatory: true`.' },
    { t: 'p', text: 'Security details in [Extensions: validation, preferences and mandatory](/docs/security#extension-controls).' },
    ...servicesEn,
    { t: 'h2', id: 'slash', text: 'slashCommands' },
    { t: 'p', text: 'The composer\'s `/` commands come from the manifests of installed extensions. Each is `{key, description, action, arguments?}` with `key` `^[a-zA-Z0-9_-]{1,32}$`. `/` at the start or after a space opens the menu; arrows, `Home`/`End` navigate, `Enter` runs, `Tab` completes and `Esc` closes. The text after the command arrives as `args`/`slashArgs`. If two extensions repeat a key the first wins.' },
    { t: 'code', lang: 'json', title: 'slashCommands in the manifest', code: slashEx },
    ...versioningEn,
    { t: 'h2', id: 'catalogue', text: 'Current catalogue and status' },
    { t: 'table', head: ['Extension', 'Status'], rows: [
        ['`calendar`, `zoom`, `google-meet`', 'Working (Zoom needs domain credentials; Meet, a linked Google account or credentials)'],
        ['`notion`, `trello`, `hubspot`, `giphy`', 'Working with domain credentials (`GIPHY_API_KEY` for Giphy)'],
        ['`composer-helper`, `mail-groups`, `signature`, `dlp`, `webhooks`, `slash-commands`', 'Working (`dlp` blocks via `EMAIL_PRE_SEND`; `slash-commands` is client-only)'],
        ['`google-drive`', 'Partial: list and insert links, no upload UI'],
        ['`google-sync`, `appointments`', 'Client-only (`clientOnly`, no `server.js`)'],
        ['`summarizer`, `translator`, `smart-reply`', 'Partial: depend on the open message supplying its full content'],
        ['`organizer`', 'Active, but requires `services.mail` (signed domain: the instance supplies the `executionGrant`); otherwise it fails with `ORGANIZER_MAIL_SERVICE_UNAVAILABLE` and the hook is skipped. See [Organizer](/docs/sealer#organizer)'],
        ['`sealer`', 'Active, but encryption happens in the browser; its `server.js` only describes the protocol. See [Sealer](/docs/sealer)'],
    ] },
    { t: 'callout', kind: 'note', text: 'Status is based on the repository manifests, code and tests; it was not run against real providers (Google, Zoom, Notion…).' },
];

const page: DocPageContent = { es, en };
export default page;
