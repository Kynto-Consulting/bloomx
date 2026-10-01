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

const page: DocPageContent = {
    es: [
        { t: 'p', text: 'Todo lo necesario para **escribir, validar, probar y gestionar** extensiones sin desplegar nada: SDK con tipos, plantilla, validador por línea de comandos, **playground** y **galería de componentes** en la propia aplicación, y la página **/extensions** para usuarios y autores. La referencia de componentes, expresiones y acciones está en [Kit de componentes y UI](/docs/extension-ui).' },
        { t: 'callout', kind: 'tip', title: 'TSDocs', text: '¿Buscas los tipos exactos? [TSDocs: referencia del SDK](/docs/extension-tools/tsdocs) se genera de los `.d.ts` reales: `Manifest`, puntos de montaje, acciones, expresiones, `ctx.services`... con ejemplos, buscador y enlaces entre tipos.' },
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
    ],
    en: [
        { t: 'p', text: 'Everything needed to **write, validate, test and manage** extensions without deploying anything: an SDK with types, a template, a command-line validator, a **playground** and a **component gallery** inside the app itself, and the **/extensions** page for users and authors. The reference for components, expressions and actions is in [Component kit and UI](/docs/extension-ui).' },
        { t: 'callout', kind: 'tip', title: 'TSDocs', text: 'Looking for the exact types? [TSDocs: SDK reference](/docs/extension-tools/tsdocs) is generated from the real `.d.ts` files: `Manifest`, mount points, actions, expressions, `ctx.services`... with examples, searchable and cross-linked.' },
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
    ],
};

export default page;
