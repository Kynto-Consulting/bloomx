import type { DocPageContent } from '../types';

const manifest = `{
  "manifestVersion": "1.0",
  "id": "core-hello",
  "version": "1.0.0",
  "name": "Hello",
  "description": "Ejemplo mínimo",
  "permissions": [],
  "api": {
    "runtime": "nodejs",
    "entry": "server.js",
    "functions": { "hello": { "handler": "hello", "timeout": 5000 } }
  },
  "mounts": [
    {
      "point": "COMPOSER_TOOLBAR",
      "component": {
        "type": "BUTTON",
        "props": {
          "label": "Hello",
          "variant": "ghost",
          "onClick": {
            "action": "CALL_BACKEND",
            "function": "hello",
            "args": { "name": "\${context.subject}" },
            "onSuccess": { "action": "TOAST", "message": "\${result.message}" },
            "onError": { "action": "TOAST", "message": "\${error}", "variant": "error" }
          }
        }
      }
    }
  ]
}`;

const server = `// bloomx-extensions/hello/server.js
module.exports = {
    hello: async (ctx) => {                                  // UN solo parámetro
        const name = String((ctx.args && ctx.args.name) || 'mundo').slice(0, 100);
        return { success: true, message: \`Hola \${name} desde \${ctx.domain.displayName}\` };
    },
};`;

const serverEn = server.replace('// UN solo parámetro', '// ONE parameter only').replace("'mundo'", "'world'").replace('`Hola ${name} desde ${ctx.domain.displayName}`', '`Hello ${name} from ${ctx.domain.displayName}`').replace('Hola \\${name} desde', 'Hello \\${name} from');

const hookEx = `// Un hook que bloquea el envío si el asunto contiene una palabra prohibida.
// manifest: "intercepts": [{ "point": "EMAIL_PRE_SEND", "handler": "check", "priority": "HIGH", "onError": "block" }]
// y "api.functions": { "check": { "handler": "check", "timeout": 3000 } }
module.exports = {
    check: async (ctx) => {
        const banned = String(ctx.env.BANNED_WORDS || '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
        const text = String(ctx.subject || '').toLowerCase();
        const hit = banned.find((w) => text.includes(w));
        return hit ? { stop: true, message: 'Palabra no permitida: ' + hit } : { success: true };
    },
};   // declara "permissions": ["ENV_READ:BANNED_WORDS"] y configura BANNED_WORDS en el panel`;

const hookExEn = hookEx
    .replace('// Un hook que bloquea el envío si el asunto contiene una palabra prohibida.', '// A hook that blocks sending if the subject contains a banned word.')
    .replace('// y "api.functions"', '// and "api.functions"')
    .replace('Palabra no permitida: ', 'Banned word: ')
    .replace('// declara "permissions": ["ENV_READ:BANNED_WORDS"] y configura BANNED_WORDS en el panel', '// declare "permissions": ["ENV_READ:BANNED_WORDS"] and set BANNED_WORDS in the panel');

const publish = `# 1) Validar localmente (Node >= 22.6)
cd bloomx-extensions && npm test

# 2) Publicar en el backend (lee ../bloomx-extensions; necesita B2_* y DATABASE_URL reales en .env)
cd ../bloomx-backend && node --env-file=.env sync-extensions.mjs

# 3) Instalar en un dominio (sesión de manager dueño del dominio)
curl -sS -X POST "$BACKEND/api/manager/extensions/install" -H 'content-type: application/json' \\
  -b 'auth_session=<cookie>' -d '{"domainId":"<id>","extensionId":"core-hello"}'`;

const publishEn = publish
    .replace('# 1) Validar localmente (Node >= 22.6)', '# 1) Validate locally (Node >= 22.6)')
    .replace('# 2) Publicar en el backend (lee ../bloomx-extensions; necesita B2_* y DATABASE_URL reales en .env)', '# 2) Publish to the backend (reads ../bloomx-extensions; needs real B2_* and DATABASE_URL in .env)')
    .replace('# 3) Instalar en un dominio (sesión de manager dueño del dominio)', '# 3) Install on a domain (the domain-owner manager session)');

const servicesEx = `// bloomx-extensions/agenda/server.js
// manifest: "permissions": ["CALENDAR_READ", "FORMATS", "STORAGE"]
module.exports = {
    today: async (ctx) => {
        const { calendar, formats, storage } = ctx.services || {};
        if (!calendar) return { success: false, code: 'CALENDAR_SERVICE_UNAVAILABLE' };   // @@a@@
        const from = new Date(); from.setUTCHours(0, 0, 0, 0);
        const to = new Date(from.getTime() + 86400000);
        try {
            const { events } = await calendar.listEvents({ from: from.toISOString(), to: to.toISOString(), limit: 20 });
            const rows = [];
            for (const e of events) {
                const start = formats ? await formats.formatDate({ value: e.startsAt, locale: 'es-ES', style: 'time' }) : e.startsAt;
                rows.push({ title: e.title, start });
            }
            if (storage) await storage.set({ key: 'last-run', value: { at: new Date().toISOString(), count: rows.length } }).catch(() => {});
            return { success: true, rows };
        } catch (error) {
            return { success: false, code: String(error.message).split(':')[0] };   // @@b@@
        }
    },
};`;

const servicesExEs = servicesEx.replace('@@a@@', 'modo legado o sin servicio: degradar').replace('@@b@@', 'p. ej. CALENDAR_PERMISSION_DENIED');
const servicesExEn = servicesEx.replace('@@a@@', 'legacy mode or no service: degrade').replace('@@b@@', 'e.g. CALENDAR_PERMISSION_DENIED');

const page: DocPageContent = {
    es: [
        { t: 'p', text: 'Guía práctica para crear una extensión. Antes, lee el [contrato y el modelo de seguridad](/docs/expansions).' },
        { t: 'h2', id: 'steps', text: 'Paso a paso' },
        { t: 'ol', items: [
            'Crea `bloomx-extensions/<nombre>/manifest.json` con, como mínimo, `id`, `name` y `version`.',
            'Si necesita lógica de servidor, crea `server.js` y declara en `api.functions` **cada** handler que use la interfaz, un mount o un hook.',
            'Cada handler tiene la firma `handler(ctx)`: **un solo parámetro**. Lee `ctx.args`, `ctx.env`, `ctx.user`, `ctx.domain`…',
            'Si necesita secretos (claves de API), decláralos con `"permissions": ["ENV_READ:MI_CLAVE"]`; cada empresa los configura en el panel (extensiones → credenciales). Nunca los pongas en el manifest ni en el código.',
            'Valida: `npm test` en `bloomx-extensions` comprueba el schema de cada manifest y el contrato de los handlers.',
            'Publica en el backend y luego **instálala** en un dominio (ver abajo).',
            'Prueba en la interfaz: el frontend recibe las extensiones del dominio por `GET /api/config` y pinta los mounts.',
        ] },
        { t: 'callout', kind: 'warn', title: 'El test de contrato cuenta las extensiones', text: '`tests/contract.test.mjs` comprueba `ids.length` igual a **21**. Al añadir una carpeta nueva, ese test falla hasta que actualices la constante. Cada carpeta con `manifest.json` debe validar contra el schema.' },
        { t: 'h2', id: 'example', text: 'Ejemplo mínimo' },
        { t: 'p', text: 'Un botón en la barra del editor que llama a una función del servidor y muestra el resultado.' },
        { t: 'code', lang: 'json', title: 'bloomx-extensions/hello/manifest.json', code: manifest },
        { t: 'code', lang: 'javascript', title: 'bloomx-extensions/hello/server.js', code: server },
        { t: 'ul', items: [
            '`${context.subject}` y `${result.message}` son expresiones que evalúa el intérprete del frontend (sin `eval`).',
            'Los nombres `label`, `variant`, `onClick`, `onSuccess`, `onError` y `message` siguen los de las extensiones existentes (`composer-helper`, `organizer`). No se ejecutó este ejemplo contra un backend real: úsalo como punto de partida y ajusta según el renderer.',
        ] },
        { t: 'h3', id: 'hook', text: 'Un hook' },
        { t: 'code', lang: 'javascript', title: 'Bloquear el envío (EMAIL_PRE_SEND)', code: hookEx },
        { t: 'p', text: 'Devolver `{stop: true, message}` bloquea el envío (422). `{modify: {subject, html, text}}` reescribe el contenido. Ver [Hooks](/docs/expansions#hooks) para la semántica y los límites (`MONITOR`, `onError`).' },
        { t: 'h2', id: 'services-events', text: 'Usar servicios y eventos' },
        { t: 'p', text: 'Además de `fetch`, una extensión puede usar los servicios autorizados (`services.calendar`, `contacts`, `storage`, `notify`, `formats`) y suscribirse a los eventos de ciclo de vida (`CONTACT_SAVED`, `EMAIL_SENT`…). Referencia completa: [servicios](/docs/expansions#services), [formats](/docs/expansions#formats) y [eventos](/docs/expansions#lifecycle).' },
        { t: 'ol', items: [
            'Declara en `permissions` solo lo necesario: `CALENDAR_READ`/`CALENDAR_WRITE`, `CONTACTS_READ`/`CONTACTS_WRITE`, `STORAGE`, `NOTIFY`, `FORMATS`. El administrador verá la lista legible y debe confirmarla al instalar (ver [permisos](/docs/expansions#permissions)).',
            'En el handler toma el servicio de `ctx.services` y **comprueba que existe**: solo hay servicios en dominios firmados; en modo legado no existen.',
            'Llama con **un objeto** de argumentos (`calendar.listEvents({from, to})`). El `userId` nunca se pasa: lo fija el host.',
            'Envuelve las llamadas en `try/catch`: los errores empiezan por `CALENDAR_`, `CONTACTS_`, `STORAGE_`, `NOTIFY_` o `FORMATS_` (`..._PERMISSION_DENIED`, `..._INVALID_ARGS`, `..._ERROR: <code>`, `..._CALL_BUDGET`…).',
            'Para reaccionar a un evento, añade en el manifest `"hooks": [{ "point": "CONTACT_SAVED", "handler": "onContactSaved" }]` y declara el handler en `api.functions` (con `timeout` ≤ 10 s). Los eventos no bloquean ni modifican nada, y lo que hagas con `services.*` no los vuelve a disparar.',
            'Para pintar un panel en un punto nuevo (`EMAIL_READER_SIDEBAR`, `SETTINGS_PANEL`…) mira antes si ya está **montado** en la interfaz: la tabla de [puntos de montaje](/docs/expansions#mount-points) lo indica.',
        ] },
        { t: 'code', lang: 'javascript', title: 'Agenda de hoy con degradación', code: servicesExEs },
        { t: 'callout', kind: 'tip', title: 'Buenos ejemplos reales', text: '`summarizer` (`services.calendar` y `storage`, con confirmación del usuario), `hubspot` (`services.contacts`, `storage` y el hook `CONTACT_SAVED`), `notion` y `trello` (`services.formats.renderTemplate` para el título) y `signature` (`renderTemplate` y `sanitizeHtml`). Todos degradan sin el servicio.' },
        { t: 'h2', id: 'publish', text: 'Publicar e instalar' },
        { t: 'code', lang: 'bash', title: 'Validar, publicar e instalar', code: publish },
        { t: 'ul', items: [
            '`sync-extensions.mjs` (en la raíz de `bloomx-backend`) sube `server.js` a `b2://<bucket>/extensions/<id>/server.js` y hace `upsert` de la extensión con el manifest completo como `template`. Las extensiones sin `server.js` (solo cliente) se publican con `scriptUrl = null`. **No valida el manifest**, por eso el paso 1 es imprescindible. Sale con código 1 si falta alguna variable `B2_*` o `DATABASE_URL`.',
            'Existe una variante, `scripts/sync-repository-extensions.mjs` (B2 opcional; clave de objeto `extensions/<id>-v<version>.js`).',
            'Alternativa con el super-admin de plataforma: `POST /api/admin/extensions` (multipart, Basic Auth con `ADMIN_EMAIL`/`ADMIN_PASSWORD`) **sí** valida el manifest con el schema (400 con detalle) y sube a `extensions/<id>/<version>/server.js`.',
            'Si cambias el schema (`_shared/manifest-schema.ts`), copia el archivo a `bloomx-backend/src/lib/extensions/` y a `bloomx/src/lib/expansions/`; un test comprueba que las copias sean idénticas.',
            'Extensiones de pago (`isPaid`): la instalación exige una transacción `APPROVED` (402 `PAYMENT_REQUIRED`).',
        ] },
        { t: 'h2', id: 'checklist', text: 'Lista de comprobación' },
        { t: 'ul', items: [
            'El manifest valida (`npm test`) y cada función referenciada existe en `api.functions`.',
            'Los handlers tienen un solo parámetro y devuelven JSON serializable (≤ 5 MB) dentro de 25 s (o el `timeout` declarado, 100–60000 ms).',
            'Solo usas `fetch` https y los globals disponibles en el sandbox (sin `require`).',
            'Los secretos van en `ENV_READ:*` y se configuran por dominio.',
            'Si usas `services.mail`, declaras `READ_EMAIL` o `MAIL_LABEL` y el dominio está en modo firmado.',
            'Si usas `services.calendar|contacts|storage|notify|formats`, declaras su permiso (`CALENDAR_*`, `CONTACTS_*`, `STORAGE`, `NOTIFY`, `FORMATS`) y **degradas** cuando `ctx.services.<x>` no existe (modo legado).',
            'Si te suscribes a un evento de ciclo de vida, tu handler no lanza (devuelve `{success:false}`), termina en menos de 10 s y no depende de bloquear ni modificar nada.',
            'Si dependes de hooks `EMAIL_RECEIVED` o `CRON`, recuerda que el dominio debe estar en modo firmado y que `CRON` hoy no lo dispara nadie.',
        ] },
        { t: 'p', text: 'Para una **página completa** (un mount `PAGE` con cabecera, indicadores, gráficos y tabla) y su **entrada en la barra lateral o en la consola de administración** (`navEntries`, con insignia opcional), sigue la guía [Página completa y navegación](/docs/extension-pages).' },
        { t: 'h2', id: 'legacy-docs', text: 'Documentos internos antiguos' },
        { t: 'p', text: 'Los archivos de `bloomorg-updates/` (planes `01/02`) describen el diseño original y están **desactualizados** (hablan de `node:vm`, de JWT/secretos compartidos y de Sealer/Organizer deshabilitados). Esta documentación y `expansions/howto.md` son la referencia vigente. Esos archivos pueden contener credenciales de prueba: no los versiones y rota cualquier credencial que haya estado en ellos.' },
    ],
    en: [
        { t: 'p', text: 'A practical guide to building an extension. First read the [contract and security model](/docs/expansions).' },
        { t: 'h2', id: 'steps', text: 'Step by step' },
        { t: 'ol', items: [
            'Create `bloomx-extensions/<name>/manifest.json` with, at minimum, `id`, `name` and `version`.',
            'If it needs server logic, create `server.js` and declare in `api.functions` **every** handler used by the UI, a mount or a hook.',
            'Each handler has the signature `handler(ctx)`: **a single parameter**. Read `ctx.args`, `ctx.env`, `ctx.user`, `ctx.domain`…',
            'If it needs secrets (API keys), declare them with `"permissions": ["ENV_READ:MY_KEY"]`; each company sets them in the panel (extensions → credentials). Never put them in the manifest or code.',
            'Validate: `npm test` in `bloomx-extensions` checks every manifest\'s schema and the handler contract.',
            'Publish to the backend and then **install** it on a domain (see below).',
            'Try it in the UI: the frontend receives the domain\'s extensions through `GET /api/config` and renders the mounts.',
        ] },
        { t: 'callout', kind: 'warn', title: 'The contract test counts extensions', text: '`tests/contract.test.mjs` asserts `ids.length` equals **21**. When you add a new folder that test fails until you update the constant. Every folder with a `manifest.json` must validate against the schema.' },
        { t: 'h2', id: 'example', text: 'Minimal example' },
        { t: 'p', text: 'A button in the composer toolbar that calls a server function and shows the result.' },
        { t: 'code', lang: 'json', title: 'bloomx-extensions/hello/manifest.json', code: manifest.replace('Ejemplo mínimo', 'Minimal example') },
        { t: 'code', lang: 'javascript', title: 'bloomx-extensions/hello/server.js', code: serverEn },
        { t: 'ul', items: [
            '`${context.subject}` and `${result.message}` are expressions evaluated by the frontend interpreter (no `eval`).',
            'The names `label`, `variant`, `onClick`, `onSuccess`, `onError` and `message` follow those of existing extensions (`composer-helper`, `organizer`). This example was not run against a real backend: use it as a starting point and adjust to the renderer.',
        ] },
        { t: 'h3', id: 'hook', text: 'A hook' },
        { t: 'code', lang: 'javascript', title: 'Block sending (EMAIL_PRE_SEND)', code: hookExEn },
        { t: 'p', text: 'Returning `{stop: true, message}` blocks the send (422). `{modify: {subject, html, text}}` rewrites the content. See [Hooks](/docs/expansions#hooks) for semantics and limits (`MONITOR`, `onError`).' },
        { t: 'h2', id: 'services-events', text: 'Using services and events' },
        { t: 'p', text: 'Besides `fetch`, an extension can use the authorised services (`services.calendar`, `contacts`, `storage`, `notify`, `formats`) and subscribe to lifecycle events (`CONTACT_SAVED`, `EMAIL_SENT`…). Full reference: [services](/docs/expansions#services), [formats](/docs/expansions#formats) and [events](/docs/expansions#lifecycle).' },
        { t: 'ol', items: [
            'Declare in `permissions` only what you need: `CALENDAR_READ`/`CALENDAR_WRITE`, `CONTACTS_READ`/`CONTACTS_WRITE`, `STORAGE`, `NOTIFY`, `FORMATS`. The administrator will see the readable list and must confirm it on install (see [permissions](/docs/expansions#permissions)).',
            'In the handler take the service from `ctx.services` and **check that it exists**: services only exist on signed domains; in legacy mode they do not exist.',
            'Call with **one object** of arguments (`calendar.listEvents({from, to})`). The `userId` is never passed: the host sets it.',
            'Wrap calls in `try/catch`: errors start with `CALENDAR_`, `CONTACTS_`, `STORAGE_`, `NOTIFY_` or `FORMATS_` (`..._PERMISSION_DENIED`, `..._INVALID_ARGS`, `..._ERROR: <code>`, `..._CALL_BUDGET`…).',
            'To react to an event, add `"hooks": [{ "point": "CONTACT_SAVED", "handler": "onContactSaved" }]` to the manifest and declare the handler in `api.functions` (with `timeout` ≤ 10 s). Events neither block nor modify anything, and what you do with `services.*` does not fire them again.',
            'To render a panel at a new point (`EMAIL_READER_SIDEBAR`, `SETTINGS_PANEL`…) first check whether it is already **mounted** in the UI: the [mount points](/docs/expansions#mount-points) table says so.',
        ] },
        { t: 'code', lang: 'javascript', title: 'Today agenda with degradation', code: servicesExEn },
        { t: 'callout', kind: 'tip', title: 'Good real examples', text: '`summarizer` (`services.calendar` and `storage`, with user confirmation), `hubspot` (`services.contacts`, `storage` and the `CONTACT_SAVED` hook), `notion` and `trello` (`services.formats.renderTemplate` for the title) and `signature` (`renderTemplate` and `sanitizeHtml`). All degrade without the service.' },
        { t: 'h2', id: 'publish', text: 'Publish and install' },
        { t: 'code', lang: 'bash', title: 'Validate, publish and install', code: publishEn },
        { t: 'ul', items: [
            '`sync-extensions.mjs` (at the root of `bloomx-backend`) uploads `server.js` to `b2://<bucket>/extensions/<id>/server.js` and upserts the extension with the full manifest as `template`. Extensions without `server.js` (client-only) are published with `scriptUrl = null`. It **does not validate the manifest**, which is why step 1 is essential. It exits with code 1 if any `B2_*` variable or `DATABASE_URL` is missing.',
            'There is a variant, `scripts/sync-repository-extensions.mjs` (B2 optional; object key `extensions/<id>-v<version>.js`).',
            'Alternative with the platform super-admin: `POST /api/admin/extensions` (multipart, Basic Auth with `ADMIN_EMAIL`/`ADMIN_PASSWORD`) **does** validate the manifest with the schema (400 with details) and uploads to `extensions/<id>/<version>/server.js`.',
            'If you change the schema (`_shared/manifest-schema.ts`), copy the file to `bloomx-backend/src/lib/extensions/` and to `bloomx/src/lib/expansions/`; a test checks the copies are identical.',
            'Paid extensions (`isPaid`): installation requires an `APPROVED` transaction (402 `PAYMENT_REQUIRED`).',
        ] },
        { t: 'h2', id: 'checklist', text: 'Checklist' },
        { t: 'ul', items: [
            'The manifest validates (`npm test`) and every referenced function exists in `api.functions`.',
            'Handlers take a single parameter and return serialisable JSON (≤ 5 MB) within 25 s (or the declared `timeout`, 100–60000 ms).',
            'You only use https `fetch` and the globals available in the sandbox (no `require`).',
            'Secrets go in `ENV_READ:*` and are configured per domain.',
            'If you use `services.mail`, you declare `READ_EMAIL` or `MAIL_LABEL` and the domain is in signed mode.',
            'If you use `services.calendar|contacts|storage|notify|formats`, you declare its permission (`CALENDAR_*`, `CONTACTS_*`, `STORAGE`, `NOTIFY`, `FORMATS`) and **degrade** when `ctx.services.<x>` does not exist (legacy mode).',
            'If you subscribe to a lifecycle event, your handler does not throw (it returns `{success:false}`), finishes in under 10 s and does not rely on blocking or modifying anything.',
            'If you depend on `EMAIL_RECEIVED` or `CRON` hooks, remember the domain must be in signed mode and that nobody fires `CRON` today.',
        ] },
        { t: 'p', text: 'For a **full page** (a `PAGE` mount with a header, indicators, charts and a table) and its **entry in the sidebar or the administration console** (`navEntries`, with an optional badge), follow the guide [Full page and navigation](/docs/extension-pages).' },
        { t: 'h2', id: 'legacy-docs', text: 'Old internal documents' },
        { t: 'p', text: 'The files in `bloomorg-updates/` (plans `01/02`) describe the original design and are **out of date** (they mention `node:vm`, shared JWT/secrets and Sealer/Organizer disabled). This documentation and `expansions/howto.md` are the current reference. Those files may contain test credentials: do not commit them and rotate any credential that has been in them.' },
    ],
};

export default page;
