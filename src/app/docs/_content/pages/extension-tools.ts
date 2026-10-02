import type { DocPageContent } from '../types';

const sdkExample = `// mi-ext/manifest.src.mjs
import { ui, act, expr, defineManifest } from '../_shared/sdk/index.js';

export default defineManifest({
    id: 'acme-hello', name: 'Hello', version: '1.0.0', permissions: ['READ_USER'],
    api: { functions: { greet: { handler: 'greet' } } },
    mounts: [
        { point: 'COMPOSER_TOOLBAR', component: ui.button('Saludo', { icon: 'Smile', variant: 'ghost', onClick: act.openOverlay('acme-form') }) },
        { point: 'OVERLAY', id: 'acme-form', component: ui.modal('Saludo', { width: 'md' },
            ui.form({
                fields: [{ name: 'name', label: 'Nombre', type: 'text', rules: { required: true, minLength: 2 } }],
                onSubmit: act.callBackend('greet', undefined, {
                    retry: { attempts: 2 },
                    onSuccess: act.all(act.insertContent(expr.of('result.text'), { closeOverlay: true }), act.toast('Listo', { tone: 'success' })),
                }),
            })) },
    ],
});`;

const exampleEn = sdkExample.replace("'Saludo'", "'Greeting'").replace("'Saludo'", "'Greeting'").replace("'Nombre'", "'Name'").replace("'Listo'", "'Done'");

const cli = `# Desde bloomx-extensions (sin instalar nada: Node 22+)
cp -r _template mi-extension
node --experimental-strip-types _shared/sdk/build-manifest.mjs mi-extension/manifest.src.mjs   # genera manifest.json
node --experimental-strip-types _shared/validate.mjs mi-extension                               # valida (--strict: lo obsoleto es error)
node --experimental-strip-types --test mi-extension/tests/*.test.mjs                            # tests de la extension
npm test                                                                                        # contrato + schema + SDK + validador`;

const aiBasic = `// permisos: AI_GENERATE · manifest.ai = { features: ['summarize'], required: false, purpose: {...} }
export async function summarize(ctx) {
  const ai = ctx.services.ai;
  if (!(await ai.isAvailable('summarize'))) return { text: null }; // degradar sin error
  const r = await ai.generate({
    prompt: 'Resume en 3 viñetas:\\n' + ctx.args.body,
    system: 'Responde en el idioma del texto.',
    feature: 'summarize', maxTokens: 300, temperature: 0.2,
  });
  // r: { text, json?, usage: { tokensIn, tokensOut }, model, warnings? }
  return { text: r.text, tokens: r.usage.tokensIn + r.usage.tokensOut, model: r.model };
}

// Conversación: chat({ messages, feature, ... }) devuelve el mismo resultado
const c = await ai.chat({ feature: 'composer', messages: [
  { role: 'user', content: 'Redacta un saludo breve' },
] });`;

const aiJson = `const schema = {
  type: 'object', additionalProperties: false,
  required: ['asunto', 'prioridad', 'fechas'],
  properties: {
    asunto: { type: 'string', maxLength: 120 },
    prioridad: { enum: ['baja', 'media', 'alta'] },
    fechas: { type: 'array', maxItems: 10, items: { type: 'string', minLength: 8, maxLength: 10 } },
  },
};
const { data, usage } = await ctx.services.ai.json(
  'Extrae asunto, prioridad y fechas (AAAA-MM-DD) de este correo:\\n' + ctx.args.body,
  schema,
  { feature: 'organizer', retries: 1, maxTokens: 400 },
);
// data: { asunto: string, prioridad: 'baja'|'media'|'alta', fechas: string[] }`;

const aiErrors = `const MSG = {
  ai_disabled: { es: 'La IA está desactivada en esta organización.', en: 'AI is turned off for this organization.' },
  feature_disabled: { es: 'Esta función de IA está desactivada.', en: 'This AI feature is turned off.' },
  quota_exceeded: { es: 'Has alcanzado la cuota de IA. Inténtalo más tarde.', en: 'AI quota reached. Try again later.' },
  guardrail_blocked: { es: 'El contenido fue bloqueado por las reglas de seguridad.', en: 'The content was blocked by safety rules.' },
  not_configured: { es: 'La IA aún no está configurada.', en: 'AI is not configured yet.' },
  provider_error: { es: 'El proveedor de IA falló. Reintenta en un momento.', en: 'The AI provider failed. Please retry shortly.' },
  schema_validation_failed: { es: 'La IA no devolvió el formato esperado.', en: 'The AI did not return the expected format.' },
  invalid_args: { es: 'Petición de IA no válida.', en: 'Invalid AI request.' },
};
try {
  const { text } = await ctx.services.ai.generate({ prompt, feature: 'summarize' });
  return { text };
} catch (err) {
  const code = err && err.code;
  const m = MSG[code] || { es: 'No se pudo usar la IA.', en: 'AI is unavailable.' };
  const wait = code === 'quota_exceeded' && err.retryAfter ? err.retryAfter : undefined; // segundos
  return { error: m, retryAfter: wait }; // nunca muestres err.message crudo
}`;

const aiManifest = `"permissions": ["AI_GENERATE"],
"ai": {
  "features": ["organizer", "summarize"],
  "required": false,
  "maxTokens": 600,
  "purpose": { "es": "Resume y clasifica tus correos", "en": "Summarizes and sorts your emails" }
}`;

const aiStatus = `const s = await ctx.services.ai.status('summarize');
// { enabled, available, featureEnabled, provider, model, remaining: { requestsDay, requestsMonth, tokensDay, tokensMonth },
//   limits, reason, state }   (model es el nombre; nunca la clave)
if (!s.available) return { hint: s.reason };`;

const page: DocPageContent = {
    es: [
        { t: 'p', text: 'Todo lo necesario para **escribir, validar, probar y gestionar** extensiones sin desplegar nada: SDK con tipos, plantilla, validador por línea de comandos, **playground** y **galería de componentes** en la propia aplicación, y la página **/extensions** para usuarios y autores. La referencia de componentes, expresiones y acciones está en [Kit de componentes y UI](/docs/extension-ui).' },
        { t: 'callout', kind: 'tip', title: 'TSDocs', text: '¿Buscas los tipos exactos? [TSDocs: referencia del SDK](/docs/extension-tools/tsdocs) se genera de los `.d.ts` reales: `Manifest`, puntos de montaje, acciones, expresiones, `ctx.services`... con ejemplos, buscador y enlaces entre tipos.' },
        { t: 'p', text: 'Para hablar con Discord desde una extensión (bot por REST sin gateway, Interactions por HTTP): [DiscordLib: bot de Discord](/docs/extension-tools/discordlib).' },
        { t: 'h2', id: 'sdk', text: 'SDK y plantilla' },
        { t: 'p', text: 'En `bloomx-extensions/_shared/sdk/`, sin dependencias. `ui.*` (un helper por componente), `act.*` (acciones) y `expr.*` (expresiones) **se generan del catálogo** (`ui-schema.ts`), así que los nombres y los tipos (`ui.d.ts`) nunca se desfasan; un test falla si el catálogo cambia y no se regenera (`npm run sdk:generate`). `ctx.d.ts` tipa `handler(ctx)` y `ctx.services` para `server.js` con JSDoc.' },
        { t: 'code', lang: 'js', title: 'UI como código tipado', code: sdkExample },
        { t: 'ul', items: [
            '`_template/` es una extensión completa lista para copiar (manifest con overlay y formulario validado, `server.js` con la firma `handler(ctx)`, tests y README). Su JSON se llama `manifest.template.json` a propósito para que ningún script de sincronización la publique como extensión instalable.',
            '`build-manifest.mjs` convierte `manifest.src.mjs` en `manifest.json` validándolo (manifest, UI y sintaxis de expresiones); `--check` falla si el JSON no coincide.',
            'Los helpers devuelven JSON plano: también puedes escribir el manifest a mano; el resultado es el mismo.',
        ] },
        { t: 'h2', id: 'validator', text: 'Validador por línea de comandos' },
        { t: 'code', lang: 'bash', title: 'Flujo de trabajo', code: cli },
        { t: 'p', text: '`validate.mjs` comprueba el **manifest**, el **UI** (errores con ruta y avisos de obsolescencia), la **firma de los handlers** (existen en `server.js` y declaran un solo parámetro) y los **permisos** (los servicios usados frente a los declarados). Salida agrupada y legible, `--json` para CI, `--all` para todas las extensiones y la plantilla; código de salida 0 (correcto), 1 (errores) o 2 (uso incorrecto). Los tests de contrato lo ejecutan sobre las 21 extensiones.' },
        { t: 'h2', id: 'playground', text: 'Playground' },
        { t: 'p', text: '`/extensions/playground` permite pegar o editar un manifest completo (o un nodo de UI suelto) y verlo **renderizado en vivo**, con errores de validación en línea, en cualquier tema y tamaño:' },
        { t: 'ul', items: [
            '**Validación en línea** con ruta y mensaje: errores JSON (línea y columna), manifest, UI y expresiones; los avisos de obsolescencia (formato antiguo) van aparte y el interruptor **Estricto** los trata como errores. El botón **Migrar** reescribe el JSON al formato nuevo.',
            '**Temas**: claro, oscuro, los 8 genéricos, las paletas de empresa de prueba (claro/oscuro) y la empresa real del dominio. La vista previa aplica los tokens solo a su marco, sin cambiar el tema de la aplicación. Tamaños: móvil (375 px), tablet y escritorio.',
            '**Contexto simulado**: el correo abierto, las funciones del redactor (`insertBody`, `appendBody`, `setSubject`, `addAttachment`, `uploadAttachment`; quedan en un panel de **Eventos**) y las respuestas del backend (`{ "saveNote": { "result": {...}, "delayMs": 300 } }` o `{ "error": "...", "times": 1 }` para probar el reintento). **Nunca se llama al backend real.** Un panel de **Estado** muestra `state` en vivo.',
        ] },
        { t: 'callout', kind: 'warn', title: 'Quién puede verlo', text: 'El playground y la galería son herramientas de **administración**: solo las ve quien administra la instancia (la misma comprobación de la consola de admin). Para probar en local sin sesión, arranca `next dev` con `NEXT_PUBLIC_BLOOMX_THEME_OVERRIDE` definida (solo desarrollo; se ignora en producción).' },
        { t: 'h2', id: 'gallery', text: 'Galería de componentes' },
        { t: 'p', text: '`/extensions/components` es el catálogo **vivo**: se genera desde el mismo schema que valida y que pinta, así que siempre está al día. Para cada componente: descripción, tabla de props (tipos, valores permitidos, defectos), ejemplos renderizados en vivo, botón **Copiar JSON**, **Abrir en el playground** y una vista **en todos los temas** a la vez. Un test exige un ejemplo válido por cada componente del catálogo.' },
        { t: 'h2', id: 'manage', text: 'Gestión de extensiones (usuarios y autores)' },
        { t: 'p', text: '`/extensions` lista las extensiones instaladas en tu organización:' },
        { t: 'ul', items: [
            '**Búsqueda** (sin tildes ni mayúsculas), **categorías** (`manifest.category` y `manifest.tags`, o derivadas de los puntos de montaje y permisos) y **estado**: activa, desactivada por ti, desactivada por la organización, con errores, de pago o gratuita.',
            '**Activar o desactivar por usuario** sin desinstalar, y **orden** de botones y paneles (subir/bajar con anuncio accesible y "Restablecer orden"). Las preferencias se guardan en tu navegador y en tus ajustes (`expansionSettings`), no afectan a otros usuarios. Desactivar una extensión también evita que sus reglas de servidor (por ejemplo al enviar un correo) se ejecuten para ti, **salvo las obligatorias**: si tu organización marca una como obligatoria (por ejemplo DLP), su interruptor aparece bloqueado con una explicación y no se puede apagar. Ajustes → Extensiones tiene un enlace directo a esta página.',
            '**Detalle**: versión instalada y actualización disponible (si el catálogo la ofrece), **permisos en lenguaje claro** ordenados por sensibilidad, dónde aparece, **vista previa** del panel con datos simulados, capturas (`manifest.screenshots`, solo https), historial (`manifest.changelog`) y errores.',
            '**Errores de ejecución para el autor**: validación de UI, excepciones de render, acciones fallidas y expresiones inválidas se registran (no solo en consola) con extensión, ruta, mensaje, número de veces y hora; **Copiar informe** (sin correos ni tokens) y **Limpiar**.',
        ] },
        { t: 'h3', id: 'manifest-fields', text: 'Campos opcionales nuevos del manifest' },
        { t: 'table', head: ['Campo', 'Tipo', 'Para qué'], rows: [
            ['`state`', 'objeto pequeño', 'Estado inicial de cada mount/overlay (`${state.x}`); máx. 50 KB'],
            ['`category`', 'texto', 'Categoría en /extensions (correo, redactor, calendario, contactos, automatización, IA, integraciones, ajustes)'],
            ['`tags`', 'lista de textos', 'Etiquetas para la búsqueda'],
            ['`screenshots`', 'lista de URLs https', 'Capturas en el detalle'],
            ['`changelog`', '`[{ version, date, notes }]`', 'Historial de versiones mostrado como texto'],
        ] },
        { t: 'callout', kind: 'note', title: 'Límites', text: 'Estos campos no se validan aún en el schema de manifest (se leen de forma defensiva). Las preferencias de usuario no se aplican a los hooks de servidor (DLP, webhooks): solo a lo que se pinta. El playground no ejecuta `server.js`: simula sus respuestas. La vista previa de /extensions es solo visual.' },
        { t: 'h2', id: 'settings-fields', text: 'Campos de ajustes: secretos, usuarios y mapas por usuario' },
        { t: 'p', text: 'El `settingsSchema` del manifest admite tres familias de campos sensibles a la organización: **secretos write-only** (`secret: true`, `writeOnly: true` o `type: "secret"`; cifrados, jamás se vuelven a leer, con `pattern`/`format` validados en servidor y rotación auditada), **selectores de usuario** (`user`, `users`) y **`userMap`** (un valor por usuario del dominio: boolean, string, number o select). En el handler llegan como `ctx.env.X`, `ctx.settings.owner` (id), `ctx.settings.recipients` (ids) y `ctx.settings.digest` (mapa), con `ctx.settings.forUser(key, userId)` para resolver con el `default`.' },
        { t: 'p', text: 'Referencia completa, validación y compatibilidad en [Configuración por dominio](/docs/expansions#domain-config-users); los tipos TypeScript están en la [referencia tsdocs](/docs/extension-tools/tsdocs). Vista previa interactiva de los controles:' },
        { t: 'settings-preview' },
        { t: 'h2', id: 'ai-sdk', text: 'SDK de IA' },
        { t: 'p', text: '`ctx.services.ai` da acceso a la IA configurada por tu organización en [/admin/ai](/docs/ai), sin claves en la extensión. Requiere el permiso `AI_GENERATE` y el bloque `ai` del manifest. Los guardarrailes, las cuotas y la redacción de datos de /admin/ai se aplican igual que en el resto de la aplicación. **No se guardan prompts ni respuestas.**' },
        { t: 'table', head: ['Método', 'Devuelve', 'Notas'], rows: [
            ['`generate({ prompt, system?, feature?, maxTokens?, temperature?, responseFormat?, parts? })`', '`{ text, json?, usage: { tokensIn, tokensOut }, model, warnings? }`', '`responseFormat`: `text` o `json`. La firma antigua `generate(system, prompt, extra)` sigue funcionando pero está **obsoleta**.'],
            ['`chat({ messages, ... })`', 'igual que generate', 'Conversación con roles; mismas opciones.'],
            ['`json(input, schema, { feature?, system?, maxTokens?, temperature?, retries?, parts? })`', '`{ data, usage, model, warnings? }`', 'Salida estructurada validada (ver abajo). `retries`: 0 a 2.'],
            ['`status(feature?)`', 'estado y cuota restante', 'No consume cuota de IA.'],
            ['`isAvailable(feature?)`', '`boolean`', 'Nunca lanza; ideal para degradar.'],
        ] },
        { t: 'p', text: 'Funciones (`feature`): `composer`, `smart-reply`, `summarize`, `translate`, `organizer` y `other`. Cada una se puede desactivar por separado en /admin/ai. El uso (`usage`) informa de tokens de entrada y salida de esa llamada.' },
        { t: 'code', lang: 'js', title: 'generate, chat e isAvailable', code: aiBasic },
        { t: 'h2', id: 'ai-structured', text: 'Salida estructurada' },
        { t: 'p', text: '`ai.json(input, schema, opciones)` devuelve datos ya validados contra un **subconjunto de JSON Schema**: `object`, `array`, `string`, `number`, `integer`, `boolean`, `enum` y `nullable`; `required`, `items`, `minItems`/`maxItems`, `minimum`/`maximum`, `minLength`/`maxLength` y `additionalProperties: false`. **No** se admiten `$ref`, `$defs`, `allOf`, `anyOf`, `oneOf`, `not`, `pattern` ni `format`.' },
        { t: 'ul', items: [
            '**Límites del esquema**: profundidad 6, 200 nodos, 16 KB y `enum` de hasta 100 valores. Si se superan, la llamada falla con `invalid_args`.',
            '**El servidor siempre valida**, sea cual sea el proveedor. Usa el modo nativo cuando existe: `json_schema` en OpenAI, tool-use forzado en Anthropic y `responseSchema` en Gemini; en OpenRouter y compatibles se añade una instrucción y se valida igualmente.',
            '**Reintentos** (`retries`, 0 a 2): ante un incumplimiento se reintenta indicando a la IA la ruta del campo fallido. **Cada reintento cuenta en la cuota** y en el presupuesto por invocación.',
            'Si sigue sin cumplirse: error `schema_validation_failed`; `err.detail` es la ruta del primer incumplimiento (por ejemplo `prioridad`) y nunca incluye contenido del modelo.',
        ] },
        { t: 'code', lang: 'js', title: 'Extraer asunto, prioridad y fechas de un correo', code: aiJson },
        { t: 'h2', id: 'ai-errors', text: 'Errores de IA' },
        { t: 'p', text: 'Todos los fallos son `Error` con `.code`. El SDK exporta `AiErrorCodes` con las constantes.' },
        { t: 'table', head: ['Código', 'Cuándo ocurre', 'Cómo mostrarlo'], rows: [
            ['`ai_disabled`', 'La IA está apagada para la instancia u organización', 'Oculta la función o avisa; no reintentes'],
            ['`feature_disabled`', 'Esa `feature` está apagada en /admin/ai', 'Igual que el anterior, indicando la función'],
            ['`quota_exceeded`', 'Se agotó una cuota (día o mes, peticiones o tokens); `.retryAfter` en segundos', 'Muestra "inténtalo más tarde" y, si hay `retryAfter`, cuándo'],
            ['`guardrail_blocked`', 'Un guardarraíl bloqueó la entrada o la salida', 'Mensaje neutro; no repitas el contenido'],
            ['`not_configured`', 'No hay proveedor o clave configurados', 'Pide a un administrador configurar /admin/ai'],
            ['`provider_error`', 'Fallo del proveedor (red, 5xx, límite externo)', 'Permite reintentar'],
            ['`schema_validation_failed`', 'La salida no cumple el esquema tras los reintentos; `.detail` = ruta', 'Ofrece reintentar o rellenar a mano'],
            ['`invalid_args`', 'Argumentos o esquema no válidos (límites, palabras clave no admitidas)', 'Es un error de programación: corrígelo'],
            ['`AI_PERMISSION_DENIED`', 'Falta `AI_GENERATE` o la función no está declarada en `ai.features`', 'Corrige el manifest'],
            ['`AI_CALL_BUDGET`', 'Se superó el presupuesto de la invocación', 'Reduce llamadas o reintentos'],
            ['`AI_SERVICE_ERROR`', 'Fallo interno del puente de IA', 'Permite reintentar'],
        ] },
        { t: 'code', lang: 'js', title: 'Patrón try/catch con mensajes es/en', code: aiErrors },
        { t: 'h2', id: 'ai-quota', text: 'Cuotas y disponibilidad' },
        { t: 'p', text: '`status(feature?)` devuelve `enabled`, `available`, `featureEnabled`, `provider`, `model` (nombre, nunca la clave), `remaining` (`requestsDay`, `requestsMonth`, `tokensDay`, `tokensMonth`), `limits`, `reason` y `state`. `isAvailable(feature?)` es la versión corta y **nunca lanza**.' },
        { t: 'code', lang: 'js', title: 'Consultar el estado', code: aiStatus },
        { t: 'p', text: 'Declara el uso de IA en el manifest. Con `required: false` la extensión **degrada**: sigue activa y tú decides qué hacer según `isAvailable`. Con `required: true`, si se desactiva la IA o la función, la extensión queda **pausada** y el backend rechaza las llamadas con `ai_disabled`.' },
        { t: 'code', lang: 'json', title: 'Bloque ai del manifest', code: aiManifest },
        { t: 'callout', kind: 'note', title: 'Presupuesto por invocación', text: 'Cada ejecución de `server.js` puede hacer hasta **5 generaciones** (`generate`, `chat` y `json`, incluidos los reintentos) y **20 consultas** de `status`/`isAvailable`; al excederlo se lanza `AI_CALL_BUDGET`.' },
        { t: 'callout', kind: 'note', title: 'Por qué no hay stream', text: 'El puente hacia el backend es una petición/respuesta firmada y el sandbox solo transfiere strings por RPC; un contexto `vm` no admite iteradores asíncronos del host. Por eso las respuestas llegan completas. Más sobre proveedores, cuotas y guardarrailes en [IA](/docs/ai).' },
    ],
    en: [
        { t: 'p', text: 'Everything needed to **write, validate, test and manage** extensions without deploying anything: an SDK with types, a template, a command-line validator, a **playground** and a **component gallery** inside the app itself, and the **/extensions** page for users and authors. The reference for components, expressions and actions is in [Component kit and UI](/docs/extension-ui).' },
        { t: 'callout', kind: 'tip', title: 'TSDocs', text: 'Looking for the exact types? [TSDocs: SDK reference](/docs/extension-tools/tsdocs) is generated from the real `.d.ts` files: `Manifest`, mount points, actions, expressions, `ctx.services`... with examples, searchable and cross-linked.' },
        { t: 'p', text: 'To talk to Discord from an extension (REST bot with no gateway, Interactions over HTTP): [DiscordLib: Discord bot](/docs/extension-tools/discordlib).' },
        { t: 'h2', id: 'sdk', text: 'SDK and template' },
        { t: 'p', text: 'In `bloomx-extensions/_shared/sdk/`, dependency-free. `ui.*` (one helper per component), `act.*` (actions) and `expr.*` (expressions) are **generated from the catalogue** (`ui-schema.ts`), so names and types (`ui.d.ts`) never drift; a test fails if the catalogue changes and is not regenerated (`npm run sdk:generate`). `ctx.d.ts` types `handler(ctx)` and `ctx.services` for `server.js` via JSDoc.' },
        { t: 'code', lang: 'js', title: 'UI as typed code', code: exampleEn },
        { t: 'ul', items: [
            '`_template/` is a complete extension ready to copy (manifest with overlay and validated form, `server.js` with the `handler(ctx)` signature, tests and README). Its JSON is deliberately named `manifest.template.json` so no sync script publishes it as an installable extension.',
            '`build-manifest.mjs` turns `manifest.src.mjs` into `manifest.json`, validating it (manifest, UI and expression syntax); `--check` fails if the JSON differs.',
            'The helpers return plain JSON: you can also write the manifest by hand; the result is the same.',
        ] },
        { t: 'h2', id: 'validator', text: 'Command-line validator' },
        { t: 'code', lang: 'bash', title: 'Workflow', code: cli.replace('Desde bloomx-extensions (sin instalar nada: Node 22+)', 'From bloomx-extensions (nothing to install: Node 22+)').replace('genera manifest.json', 'generates manifest.json').replace('valida (--strict: lo obsoleto es error)', 'validates (--strict: deprecated is an error)').replace('tests de la extension', 'extension tests').replace('contrato + schema + SDK + validador', 'contract + schema + SDK + validator') },
        { t: 'p', text: '`validate.mjs` checks the **manifest**, the **UI** (errors with path and deprecation warnings), the **handler signature** (they exist in `server.js` and declare a single parameter) and the **permissions** (services used versus declared). Grouped, readable output, `--json` for CI, `--all` for every extension and the template; exit code 0 (ok), 1 (errors) or 2 (bad usage). The contract tests run it over the 21 extensions.' },
        { t: 'h2', id: 'playground', text: 'Playground' },
        { t: 'p', text: '`/extensions/playground` lets you paste or edit a whole manifest (or a bare UI node) and see it **rendered live**, with inline validation errors, in any theme and size:' },
        { t: 'ul', items: [
            '**Inline validation** with path and message: JSON errors (line and column), manifest, UI and expressions; deprecation warnings (legacy format) are listed apart and the **Strict** switch treats them as errors. The **Migrate** button rewrites the JSON to the new format.',
            '**Themes**: light, dark, the 8 generic ones, the test company palettes (light/dark) and the domain real company. The preview applies the tokens to its own frame only, without changing the app theme. Sizes: mobile (375 px), tablet and desktop.',
            '**Simulated context**: the open email, the composer functions (`insertBody`, `appendBody`, `setSubject`, `addAttachment`, `uploadAttachment`; they land in an **Events** panel) and backend responses (`{ "saveNote": { "result": {...}, "delayMs": 300 } }` or `{ "error": "...", "times": 1 }` to test retries). **The real backend is never called.** A **State** panel shows `state` live.',
        ] },
        { t: 'callout', kind: 'warn', title: 'Who can see it', text: 'The playground and the gallery are **administration** tools: only whoever administers the instance sees them (the same check as the admin console). To try them locally without a session, start `next dev` with `NEXT_PUBLIC_BLOOMX_THEME_OVERRIDE` defined (development only; ignored in production).' },
        { t: 'h2', id: 'gallery', text: 'Component gallery' },
        { t: 'p', text: '`/extensions/components` is the **live** catalogue: generated from the same schema that validates and renders, so it is always up to date. For each component: description, props table (types, allowed values, defaults), live rendered examples, a **Copy JSON** button, **Open in playground** and an **all themes** view side by side. A test requires a valid example for every component in the catalogue.' },
        { t: 'h2', id: 'manage', text: 'Managing extensions (users and authors)' },
        { t: 'p', text: '`/extensions` lists the extensions installed in your organisation:' },
        { t: 'ul', items: [
            '**Search** (accent- and case-insensitive), **categories** (`manifest.category` and `manifest.tags`, or derived from mount points and permissions) and **status**: active, disabled by you, disabled by the organisation, with errors, paid or free.',
            '**Enable or disable per user** without uninstalling, and **order** of buttons and panels (move up/down with an accessible announcement and "Reset order"). Preferences are stored in your browser and in your settings (`expansionSettings`), and do not affect other users. Turning an extension off also stops its server rules (for example when sending mail) from running for you, **except mandatory ones**: if your organization marks one as mandatory (for example DLP), its switch appears locked with an explanation and cannot be turned off. Settings → Extensions has a direct link to this page.',
            '**Detail**: installed version and available update (if the catalogue offers one), **permissions in plain language** sorted by sensitivity, where it appears, panel **preview** with simulated data, screenshots (`manifest.screenshots`, https only), history (`manifest.changelog`) and errors.',
            '**Runtime errors for the author**: UI validation, render exceptions, failed actions and invalid expressions are recorded (not only in the console) with extension, path, message, count and time; **Copy report** (no emails or tokens) and **Clear**.',
        ] },
        { t: 'h3', id: 'manifest-fields', text: 'New optional manifest fields' },
        { t: 'table', head: ['Field', 'Type', 'Purpose'], rows: [
            ['`state`', 'small object', 'Initial state of each mount/overlay (`${state.x}`); max 50 KB'],
            ['`category`', 'text', 'Category in /extensions (mail, composer, calendar, contacts, automation, AI, integrations, settings)'],
            ['`tags`', 'list of text', 'Search tags'],
            ['`screenshots`', 'list of https URLs', 'Screenshots in the detail view'],
            ['`changelog`', '`[{ version, date, notes }]`', 'Version history shown as text'],
        ] },
        { t: 'callout', kind: 'note', title: 'Limits', text: 'These fields are not validated by the manifest schema yet (they are read defensively). User preferences do not apply to server hooks (DLP, webhooks): only to what is painted. The playground does not run `server.js`: it simulates its responses. The /extensions preview is visual only.' },
        { t: 'h2', id: 'settings-fields', text: 'Settings fields: secrets, users and per-user maps' },
        { t: 'p', text: 'The manifest `settingsSchema` supports three organization-aware field families: **write-only secrets** (`secret: true`, `writeOnly: true` or `type: "secret"`; encrypted, never read back, with `pattern`/`format` validated server-side and audited rotation), **user pickers** (`user`, `users`) and **`userMap`** (one value per domain user: boolean, string, number or select). In the handler they arrive as `ctx.env.X`, `ctx.settings.owner` (id), `ctx.settings.recipients` (ids) and `ctx.settings.digest` (map), with `ctx.settings.forUser(key, userId)` to resolve against the `default`.' },
        { t: 'p', text: 'Full reference, validation and compatibility in [Per-domain configuration](/docs/expansions#domain-config-users); the TypeScript types are in the [tsdocs reference](/docs/extension-tools/tsdocs). Interactive preview of the controls:' },
        { t: 'settings-preview' },
        { t: 'h2', id: 'ai-sdk', text: 'AI SDK' },
        { t: 'p', text: '`ctx.services.ai` gives access to the AI configured by your organization in [/admin/ai](/docs/ai), with no keys inside the extension. It needs the `AI_GENERATE` permission and the manifest `ai` block. Guardrails, quotas and redaction from /admin/ai apply exactly as elsewhere in the app. **Prompts and responses are not stored.**' },
        { t: 'table', head: ['Method', 'Returns', 'Notes'], rows: [
            ['`generate({ prompt, system?, feature?, maxTokens?, temperature?, responseFormat?, parts? })`', '`{ text, json?, usage: { tokensIn, tokensOut }, model, warnings? }`', '`responseFormat`: `text` or `json`. The old `generate(system, prompt, extra)` signature still works but is **deprecated**.'],
            ['`chat({ messages, ... })`', 'same as generate', 'Role-based conversation; same options.'],
            ['`json(input, schema, { feature?, system?, maxTokens?, temperature?, retries?, parts? })`', '`{ data, usage, model, warnings? }`', 'Validated structured output (see below). `retries`: 0 to 2.'],
            ['`status(feature?)`', 'state and remaining quota', 'Does not consume AI quota.'],
            ['`isAvailable(feature?)`', '`boolean`', 'Never throws; ideal for degrading.'],
        ] },
        { t: 'p', text: 'Features (`feature`): `composer`, `smart-reply`, `summarize`, `translate`, `organizer` and `other`. Each can be turned off separately in /admin/ai. `usage` reports input and output tokens for that call.' },
        { t: 'code', lang: 'js', title: 'generate, chat and isAvailable', code: aiBasic },
        { t: 'h2', id: 'ai-structured', text: 'Structured output' },
        { t: 'p', text: '`ai.json(input, schema, options)` returns data already validated against a **JSON Schema subset**: `object`, `array`, `string`, `number`, `integer`, `boolean`, `enum` and `nullable`; `required`, `items`, `minItems`/`maxItems`, `minimum`/`maximum`, `minLength`/`maxLength` and `additionalProperties: false`. **Not** supported: `$ref`, `$defs`, `allOf`, `anyOf`, `oneOf`, `not`, `pattern` or `format`.' },
        { t: 'ul', items: [
            '**Schema limits**: depth 6, 200 nodes, 16 KB and `enum` up to 100 values. Exceeding them fails with `invalid_args`.',
            '**The server always validates**, whatever the provider. It uses the native mode where available: `json_schema` on OpenAI, forced tool-use on Anthropic and `responseSchema` on Gemini; OpenRouter and compatible providers get an instruction plus the same validation.',
            '**Retries** (`retries`, 0 to 2): on a mismatch the AI is retried with the failing field path as a hint. **Each retry counts against the quota** and the per-invocation budget.',
            'If it still fails: `schema_validation_failed`; `err.detail` is the path of the first mismatch (for example `prioridad`) and never contains model content.',
        ] },
        { t: 'code', lang: 'js', title: 'Extract subject, priority and dates from an email', code: aiJson },
        { t: 'h2', id: 'ai-errors', text: 'AI errors' },
        { t: 'p', text: 'Every failure is an `Error` with `.code`. The SDK exports `AiErrorCodes` with the constants.' },
        { t: 'table', head: ['Code', 'When it happens', 'How to show it'], rows: [
            ['`ai_disabled`', 'AI is off for the instance or organization', 'Hide the feature or notify; do not retry'],
            ['`feature_disabled`', 'That `feature` is off in /admin/ai', 'As above, naming the feature'],
            ['`quota_exceeded`', 'A quota is exhausted (day or month, requests or tokens); `.retryAfter` in seconds', 'Show "try again later" and, if present, when'],
            ['`guardrail_blocked`', 'A guardrail blocked the input or output', 'Neutral message; do not echo the content'],
            ['`not_configured`', 'No provider or key configured', 'Ask an admin to set up /admin/ai'],
            ['`provider_error`', 'Provider failure (network, 5xx, upstream limit)', 'Allow retry'],
            ['`schema_validation_failed`', 'Output does not match the schema after retries; `.detail` = path', 'Offer retry or manual entry'],
            ['`invalid_args`', 'Invalid arguments or schema (limits, unsupported keywords)', 'Programming error: fix it'],
            ['`AI_PERMISSION_DENIED`', 'Missing `AI_GENERATE` or feature not listed in `ai.features`', 'Fix the manifest'],
            ['`AI_CALL_BUDGET`', 'Per-invocation budget exceeded', 'Reduce calls or retries'],
            ['`AI_SERVICE_ERROR`', 'Internal AI bridge failure', 'Allow retry'],
        ] },
        { t: 'code', lang: 'js', title: 'try/catch pattern with es/en messages', code: aiErrors },
        { t: 'h2', id: 'ai-quota', text: 'Quotas and availability' },
        { t: 'p', text: '`status(feature?)` returns `enabled`, `available`, `featureEnabled`, `provider`, `model` (name, never the key), `remaining` (`requestsDay`, `requestsMonth`, `tokensDay`, `tokensMonth`), `limits`, `reason` and `state`. `isAvailable(feature?)` is the short form and **never throws**.' },
        { t: 'code', lang: 'js', title: 'Checking the state', code: aiStatus },
        { t: 'p', text: 'Declare AI use in the manifest. With `required: false` the extension **degrades**: it stays active and you decide what to do from `isAvailable`. With `required: true`, if AI or the feature is turned off the extension is **paused** and the backend rejects calls with `ai_disabled`.' },
        { t: 'code', lang: 'json', title: 'Manifest ai block', code: aiManifest },
        { t: 'callout', kind: 'note', title: 'Per-invocation budget', text: 'Each `server.js` run may make up to **5 generations** (`generate`, `chat` and `json`, retries included) and **20** `status`/`isAvailable` queries; exceeding it throws `AI_CALL_BUDGET`.' },
        { t: 'callout', kind: 'note', title: 'Why there is no streaming', text: 'The bridge to the backend is a signed request/response and the sandbox only passes strings over RPC; a `vm` context cannot accept async iterators from the host. Responses therefore arrive complete. More on providers, quotas and guardrails in [AI](/docs/ai).' },
    ],
};

export default page;
