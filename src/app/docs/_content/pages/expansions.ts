import type { Block, DocPageContent } from '../types';

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
    { t: 'h3', id: 'services-example', text: 'Ejemplo completo' },
    { t: 'p', text: 'Busca un hueco libre, crea el evento y avisa al usuario. Es el patrón de `summarizer` (que solo crea eventos tras confirmación explícita), simplificado.' },
    { t: 'code', lang: 'javascript', title: 'Calendario y aviso, con degradación', code: tr(servicesCode, 'es') },
    { t: 'h3', id: 'services-limits', text: 'Límites por invocación' },
    { t: 'table', head: ['Límite', 'Valor'], rows: [
        ['Presupuesto de llamadas', '`calendar` 60, `contacts` 60, `storage` 100, `notify` 10, `formats` 200 (y 30 remotas: `renderTemplate` y `sanitizeHtml`). Cuentan también las fallidas'],
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
    ['`AI_GENERATE`', 'Usar IA', 'Envía texto al proveedor de IA de la plataforma (con límite de llamadas).', 'Medio'],
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
    { t: 'h3', id: 'services-example', text: 'Complete example' },
    { t: 'p', text: 'Finds a free slot, creates the event and notifies the user. It is the `summarizer` pattern (which only creates events after explicit confirmation), simplified.' },
    { t: 'code', lang: 'javascript', title: 'Calendar and notice, with degradation', code: tr(servicesCode, 'en') },
    { t: 'h3', id: 'services-limits', text: 'Per-invocation limits' },
    { t: 'table', head: ['Limit', 'Value'], rows: [
        ['Call budget', '`calendar` 60, `contacts` 60, `storage` 100, `notify` 10, `formats` 200 (and 30 remote: `renderTemplate` and `sanitizeHtml`). Failed calls count too'],
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
    ['`AI_GENERATE`', 'Use AI', 'Sends text to the platform AI provider (with a call limit).', 'Medium'],
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
        ['`services.ai.generate(system, prompt)`', 'Genera texto con el proveedor de IA del backend (máx. 5 llamadas por invocación)'],
        ['`services.auth.getToken(provider)`', 'Token OAuth del usuario o dominio; string o `null`. Orden: `ctx.auth`, `authData` de la instalación, credencial `<PROVEEDOR>_ACCESS_TOKEN`, ajuste y, si se permite, variable global'],
        ['`services.mail.*`', '`listRecent`, `getEmail`, `applyBatch`, `undoRun`. Solo si la llamada va firmada, el backend tiene `BACKEND_SIGNING_PRIVATE_KEY` y el manifest declara `READ_EMAIL` (lectura) o `MAIL_LABEL` (etiquetar/deshacer)'],
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
    { t: 'h2', id: 'catalogue', text: 'Catálogo actual y estado' },
    { t: 'table', head: ['Extensión', 'Estado'], rows: [
        ['`calendar`, `zoom`, `google-meet`', 'Funcionales (Zoom exige credenciales de dominio; Meet, cuenta Google vinculada o credenciales)'],
        ['`notion`, `trello`, `hubspot`, `giphy`', 'Funcionales con credenciales del dominio (`GIPHY_API_KEY` para Giphy)'],
        ['`composer-helper`, `mail-groups`, `signature`, `dlp`, `webhooks`, `slash-commands`', 'Funcionales (`dlp` bloquea vía `EMAIL_PRE_SEND`; `slash-commands` es solo cliente)'],
        ['`google-drive`', 'Parcial: listar e insertar enlaces, sin interfaz de subida'],
        ['`google-sync`, `appointments`', 'Solo cliente (`clientOnly`, sin `server.js`)'],
        ['`summarizer`, `translator`, `smart-reply`', 'Parciales: dependen de que el correo abierto aporte su contenido completo'],
        ['`organizer`', 'Activo, pero requiere `services.mail` (llamada firmada + `BACKEND_SIGNING_PRIVATE_KEY`); si no, falla con `ORGANIZER_MAIL_SERVICE_UNAVAILABLE` y el hook se omite. Ver [Organizer](/docs/sealer#organizer)'],
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
        ['`services.ai.generate(system, prompt)`', 'Generates text with the backend AI provider (max 5 calls per invocation)'],
        ['`services.auth.getToken(provider)`', 'OAuth token of the user or domain; string or `null`. Order: `ctx.auth`, installation `authData`, `<PROVIDER>_ACCESS_TOKEN` credential, setting and, if allowed, a global variable'],
        ['`services.mail.*`', '`listRecent`, `getEmail`, `applyBatch`, `undoRun`. Only if the call is signed, the backend has `BACKEND_SIGNING_PRIVATE_KEY` and the manifest declares `READ_EMAIL` (read) or `MAIL_LABEL` (label/undo)'],
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
    { t: 'h2', id: 'catalogue', text: 'Current catalogue and status' },
    { t: 'table', head: ['Extension', 'Status'], rows: [
        ['`calendar`, `zoom`, `google-meet`', 'Working (Zoom needs domain credentials; Meet, a linked Google account or credentials)'],
        ['`notion`, `trello`, `hubspot`, `giphy`', 'Working with domain credentials (`GIPHY_API_KEY` for Giphy)'],
        ['`composer-helper`, `mail-groups`, `signature`, `dlp`, `webhooks`, `slash-commands`', 'Working (`dlp` blocks via `EMAIL_PRE_SEND`; `slash-commands` is client-only)'],
        ['`google-drive`', 'Partial: list and insert links, no upload UI'],
        ['`google-sync`, `appointments`', 'Client-only (`clientOnly`, no `server.js`)'],
        ['`summarizer`, `translator`, `smart-reply`', 'Partial: depend on the open message supplying its full content'],
        ['`organizer`', 'Active, but requires `services.mail` (signed call + `BACKEND_SIGNING_PRIVATE_KEY`); otherwise it fails with `ORGANIZER_MAIL_SERVICE_UNAVAILABLE` and the hook is skipped. See [Organizer](/docs/sealer#organizer)'],
        ['`sealer`', 'Active, but encryption happens in the browser; its `server.js` only describes the protocol. See [Sealer](/docs/sealer)'],
    ] },
    { t: 'callout', kind: 'note', text: 'Status is based on the repository manifests, code and tests; it was not run against real providers (Google, Zoom, Notion…).' },
];

const page: DocPageContent = { es, en };
export default page;
