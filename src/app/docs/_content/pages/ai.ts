import type { DocPageContent } from '../types';

const legacyEx = `# HEREDADO (solo respaldo): en el entorno de la instancia
AI_PROVIDER="openai"
AI_KEY="<clave-del-proveedor>"
AI_MODEL="gpt-4o-mini"`;

const legacyExEn = `# LEGACY (fallback only): in the instance environment
AI_PROVIDER="openai"
AI_KEY="<provider-key>"
AI_MODEL="gpt-4o-mini"`;

const cliEx = `bloomx ai status                 # estado: activa, proveedor, modelo, origen de la configuración
bloomx ai enable | disable       # kill switch (nivel 4 + step-up)
bloomx ai set                    # proveedor, modelo, funciones, límites, cuotas, guardarraíles
bloomx ai key set                # clave del proveedor (write-only)
bloomx ai usage                  # uso agregado y coste estimado
bloomx ai test                   # petición de prueba al proveedor`;

const cliExEn = `bloomx ai status                 # state: enabled, provider, model, configuration source
bloomx ai enable | disable       # kill switch (level 4 + step-up)
bloomx ai set                    # provider, model, features, limits, quotas, guardrails
bloomx ai key set                # provider key (write-only)
bloomx ai usage                  # aggregated usage and estimated cost
bloomx ai test                   # test request to the provider`;

const page: DocPageContent = {
    es: [
        { t: 'p', text: 'La IA de BloomX es **opcional** y es un servicio **por instancia**: cada instancia la configura y la controla **solo** desde `https://<tu-instancia>/admin/ai`. Las extensiones la usan a través de un puente firmado de la propia instancia; el backend compartido **ya no tiene clave de IA global**. Sin IA el resto del correo funciona igual.' },
        { t: 'callout', kind: 'note', title: 'No hay compositor nativo con IA', text: 'BloomX **no** incluye un compositor con IA integrado. La única ayuda para redactar es la extensión `core-composer-helper` ("Asistente de redacción"), que usa este servicio como cualquier otra extensión y se bloquea igual si la IA está desactivada.' },
        { t: 'h2', id: 'setup', text: 'Configuración paso a paso' },
        { t: 'ol', items: [
            'Entra como administrador (nivel ≥ 3 para editar; ver [niveles](#permissions)) en `/admin/ai`.',
            'Elige el **proveedor** y el **modelo**; para Azure OpenAI y compatibles indica la **URL base**.',
            'Pega la **clave** del proveedor. Se guarda **cifrada en reposo** y es **write-only**: después solo verás "configurada ••••1234". Cambiar clave, proveedor o el kill switch exige nivel ≥ 4 con step-up.',
            'Activa las **funciones** que quieras: `composer`, `smart-reply`, `summarize`, `translate`, `organizer` y `other`.',
            'Ajusta **límites** (tokens de salida, caracteres de entrada, tope de temperatura, timeout), **cuotas**, **guardarraíles** y, si quieres estimar costes, los **precios por modelo**.',
            'Pulsa **Probar** (o `ai test`) y, si todo va bien, activa la IA con el interruptor general.',
        ] },
        { t: 'h2', id: 'providers', text: 'Proveedores' },
        { t: 'table', head: ['Proveedor', 'Notas'], rows: [
            ['`openai`', 'API de OpenAI'],
            ['`anthropic`', 'API de Anthropic (Claude)'],
            ['`google`', 'Gemini'],
            ['`azure-openai`', 'Requiere URL base (tu recurso de Azure)'],
            ['`openrouter`', 'Pasarela a varios modelos'],
            ['`compatible`', 'Cualquier API compatible con OpenAI; requiere URL base propia'],
            ['`cohere`', 'API de Cohere'],
        ] },
        { t: 'p', text: 'Las URL base propias se validan contra **SSRF**: solo `https`, sin IP privadas, locales ni de metadatos de la nube. Puedes restringir los modelos permitidos y fijar, por extensión, un tope de tokens, un modelo o desactivarla.' },
        { t: 'h2', id: 'guardrails', text: 'Guardarraíles' },
        { t: 'p', text: 'Cada guardarraíl tiene modo `off`, `log` (solo registra), `warn` (avisa) o `enforce` (bloquea o aplica).' },
        { t: 'table', head: ['Guardarraíl', 'Qué hace'], rows: [
            ['Prefijo de `system`', 'Texto obligatorio que se antepone a toda instrucción de sistema'],
            ['Redacción de datos sensibles', 'Antes de enviar al proveedor oculta tarjetas, IBAN, DNI/SSN y claves/JWT; emails y teléfonos son opcionales'],
            ['Temas y regex bloqueados', 'Rechaza peticiones que coinciden (las expresiones regulares se comprueban como seguras)'],
            ['Filtro de salida', 'Limita longitud y patrones de la respuesta'],
            ['Política de cuerpo', '`full` (todo), `subject-only` (nunca el cuerpo) o `snippet` (solo los primeros N caracteres)'],
        ] },
        { t: 'h2', id: 'quotas', text: 'Cuotas, límites y costes' },
        { t: 'ul', items: [
            'Cuotas **por usuario** y **globales**, en peticiones y tokens por día y por mes (`0` = sin límite). Al agotarlas: `quota_exceeded` con `Retry-After`.',
            'Límites de petición: tokens de salida, caracteres de entrada, temperatura máxima y timeout. La temperatura pedida se recorta al tope.',
            'Con **precios por modelo** (entrada/salida por 1000 tokens) `/admin/ai` y `ai usage` muestran una **estimación** de coste.',
            '**Retención de uso** configurable (90 días por defecto): pasado el plazo se eliminan los registros.',
        ] },
        { t: 'h2', id: 'privacy', text: 'Privacidad' },
        { t: 'ul', items: [
            'Solo se guardan **metadatos de uso**: usuario, función, extensión, proveedor, modelo, tokens, ok/error y marcas de guardarraíl. **Nunca** se guardan prompts ni respuestas.',
            'La clave es cifrada y de solo escritura; los mensajes de error no incluyen contenido del usuario ni detalles del proveedor.',
            'El contenido que una función envía (tras la redacción y la política de cuerpo) **sí llega** al proveedor que elijas: elige uno acorde con tu política de datos.',
        ] },
        { t: 'callout', kind: 'warn', title: 'Kill switch', text: 'Desactivar la IA en `/admin/ai` (o con `ai disable`) la corta para toda la instancia. El estado se cachea como máximo **30 s**, así que el efecto es casi inmediato.' },
        { t: 'h2', id: 'blocking', text: 'Bloqueo de extensiones' },
        { t: 'p', text: 'Una extensión **requiere IA** si declara el permiso `AI` / `AI_GENERATE`, la categoría `ai` o un bloque `ai` en su manifest. Con la IA desactivada:' },
        { t: 'ul', items: [
            'En `/extensions` aparece como **"Requiere IA · deshabilitada"** y no se puede instalar ni activar.',
            'Las ya activas quedan **"pausadas: IA desactivada"** y el backend rechaza sus llamadas con `ai_disabled`.',
            'Al reactivar la IA vuelven a funcionar **sin reinstalar**.',
            'Si el manifest declara `ai.required: false`, la extensión **degrada** (funciona sin IA) en lugar de bloquearse; también se aplica por función (`feature_disabled`) y por extensión.',
        ] },
        { t: 'h2', id: 'migration', text: 'Migración desde variables de entorno' },
        { t: 'p', text: '`AI_KEY`, `AI_PROVIDER` y `AI_MODEL` quedan como **respaldo heredado**: solo se usan si **no hay configuración guardada en `/admin/ai`**, se muestra un aviso de migración y **nunca se mezclan** con la configuración de la interfaz.' },
        { t: 'code', lang: 'bash', title: 'Variables heredadas (ya no recomendadas)', code: legacyEx },
        { t: 'ol', items: [
            'Abre `/admin/ai` en la instancia (el aviso "configuración heredada" confirma que sigues en el respaldo).',
            'Introduce proveedor, modelo y clave y guarda: desde ese momento manda la configuración de la interfaz y el respaldo se ignora.',
            'Pulsa **Probar** (o `ai test`) y revisa funciones, cuotas y guardarraíles (los valores por defecto son prudentes).',
            'Elimina `AI_KEY`, `AI_PROVIDER` y `AI_MODEL` (y `OPENAI_API_KEY` del backend) del entorno y redespliega.',
        ] },
        { t: 'p', text: 'Durante la transición todo sigue funcionando con el respaldo. El backend compartido **ya no usa una clave global**: llamar a su `services.ai` directamente está **DEPRECADO** (aviso en logs) y solo se conserva por compatibilidad con instancias antiguas que aún no tienen el endpoint del puente; actualiza esas instancias y migra como arriba.' },
        { t: 'h2', id: 'errors', text: 'Errores tipados' },
        { t: 'table', head: ['Código', 'HTTP', 'Cuándo'], rows: [
            ['`ai_disabled`', '403', 'La IA está desactivada en la instancia'],
            ['`feature_disabled`', '403', 'La función (o la extensión) está desactivada por el administrador'],
            ['`quota_exceeded`', '429', 'Se agotó una cuota de usuario o global'],
            ['`guardrail_blocked`', '422', 'Un guardarraíl en modo `enforce` bloqueó la petición o la respuesta'],
            ['`not_configured`', '503', 'Falta proveedor o clave'],
            ['`provider_error`', '502', 'El proveedor falló o agotó el timeout'],
            ['`schema_validation_failed`', '422', 'La respuesta no cumple el formato pedido'],
            ['`invalid_args`', '400', 'Petición inválida'],
        ] },
        { t: 'p', text: 'Cada código trae un mensaje amable en es/en (`AI_ERROR_MESSAGES`) que nunca incluye contenido del usuario.' },
        { t: 'h2', id: 'permissions', text: 'Niveles de permiso' },
        { t: 'table', head: ['Nivel', 'Puede'], rows: [
            ['≥ 1', 'Ver configuración (sin la clave) y uso'],
            ['≥ 3', 'Editar funciones, límites, cuotas, guardarraíles y precios'],
            ['≥ 4 + step-up', 'Clave, proveedor y kill switch'],
        ] },
        { t: 'h2', id: 'cli', text: 'CLI' },
        { t: 'code', lang: 'bash', title: 'Comandos de IA', code: cliEx },
        { t: 'p', text: 'Referencia completa de opciones en [CLI de administración](/docs/admin-cli).' },
        { t: 'h2', id: 'features', text: 'Qué funciones usan IA' },
        { t: 'table', head: ['Función', 'Extensión', 'Notas'], rows: [
            ['Organizer (clasificar y etiquetar)', '`organizer`', 'IA opcional con degradación a heurística ([Organizer](/docs/sealer#organizer))'],
            ['Respuesta inteligente', '`smart-reply`', 'Depende del contenido del correo abierto'],
            ['Resumen', '`summarizer`', 'Idem'],
            ['Traducción', '`translator`', 'Idem'],
            ['Ayuda para redactar', '`core-composer-helper`', 'La única ayuda de redacción; no hay compositor nativo con IA'],
        ] },
        { t: 'p', text: 'Las reglas, la búsqueda, Liquid/Elixir, Sealer y las citas **no usan IA**.' },
    ],
    en: [
        { t: 'p', text: 'BloomX AI is **optional** and a **per-instance** service: each instance configures and controls it **only** from `https://<your-instance>/admin/ai`. Extensions use it through a signed bridge of the instance itself; the shared backend **no longer has a global AI key**. Without AI the rest of mail works the same.' },
        { t: 'callout', kind: 'note', title: 'There is no native AI composer', text: 'BloomX does **not** ship a built-in AI composer. The only writing help is the `core-composer-helper` extension ("Writing assistant"), which uses this service like any other extension and is blocked the same way when AI is disabled.' },
        { t: 'h2', id: 'setup', text: 'Step-by-step setup' },
        { t: 'ol', items: [
            'Sign in as an administrator (level ≥ 3 to edit; see [levels](#permissions)) and open `/admin/ai`.',
            'Choose the **provider** and **model**; for Azure OpenAI and compatible APIs enter the **base URL**.',
            'Paste the provider **key**. It is stored **encrypted at rest** and is **write-only**: afterwards you only see "configured ••••1234". Changing the key, provider or kill switch needs level ≥ 4 with step-up.',
            'Enable the **features** you want: `composer`, `smart-reply`, `summarize`, `translate`, `organizer` and `other`.',
            'Tune **limits** (output tokens, input characters, temperature cap, timeout), **quotas**, **guardrails** and, to estimate costs, **per-model prices**.',
            'Press **Test** (or `ai test`) and, if it works, turn AI on with the main switch.',
        ] },
        { t: 'h2', id: 'providers', text: 'Providers' },
        { t: 'table', head: ['Provider', 'Notes'], rows: [
            ['`openai`', 'OpenAI API'],
            ['`anthropic`', 'Anthropic API (Claude)'],
            ['`google`', 'Gemini'],
            ['`azure-openai`', 'Needs a base URL (your Azure resource)'],
            ['`openrouter`', 'Gateway to many models'],
            ['`compatible`', 'Any OpenAI-compatible API; needs your own base URL'],
            ['`cohere`', 'Cohere API'],
        ] },
        { t: 'p', text: 'Custom base URLs are validated against **SSRF**: `https` only, no private, local or cloud-metadata IPs. You can restrict allowed models and set, per extension, a token cap, a model, or disable it.' },
        { t: 'h2', id: 'guardrails', text: 'Guardrails' },
        { t: 'p', text: 'Each guardrail has a mode: `off`, `log` (record only), `warn` or `enforce` (block or apply).' },
        { t: 'table', head: ['Guardrail', 'What it does'], rows: [
            ['`system` prefix', 'Mandatory text prepended to every system instruction'],
            ['Sensitive data redaction', 'Before sending to the provider it masks cards, IBAN, national IDs (DNI/SSN) and keys/JWTs; emails and phones are optional'],
            ['Blocked topics and regex', 'Rejects matching requests (regular expressions are checked to be safe)'],
            ['Output filter', 'Limits the length and patterns of the answer'],
            ['Body policy', '`full` (everything), `subject-only` (never the body) or `snippet` (only the first N characters)'],
        ] },
        { t: 'h2', id: 'quotas', text: 'Quotas, limits and costs' },
        { t: 'ul', items: [
            '**Per-user** and **global** quotas, in requests and tokens per day and per month (`0` = unlimited). When exhausted: `quota_exceeded` with `Retry-After`.',
            'Request limits: output tokens, input characters, max temperature and timeout. The requested temperature is clamped to the cap.',
            'With **per-model prices** (input/output per 1,000 tokens) `/admin/ai` and `ai usage` show an **estimated** cost.',
            'Configurable **usage retention** (90 days by default): older records are deleted.',
        ] },
        { t: 'h2', id: 'privacy', text: 'Privacy' },
        { t: 'ul', items: [
            'Only **usage metadata** is stored: user, feature, extension, provider, model, tokens, ok/error and guardrail flags. Prompts and answers are **never** stored.',
            'The key is encrypted and write-only; error messages never include user content or provider details.',
            'The content a feature sends (after redaction and body policy) **does reach** the provider you choose: pick one consistent with your data policy.',
        ] },
        { t: 'callout', kind: 'warn', title: 'Kill switch', text: 'Disabling AI in `/admin/ai` (or with `ai disable`) cuts it for the whole instance. The state is cached for at most **30 s**, so the effect is near-immediate.' },
        { t: 'h2', id: 'blocking', text: 'Extension blocking' },
        { t: 'p', text: 'An extension **requires AI** if it declares the `AI` / `AI_GENERATE` permission, the `ai` category or an `ai` block in its manifest. With AI disabled:' },
        { t: 'ul', items: [
            'In `/extensions` it shows as **"Requires AI · disabled"** and cannot be installed or enabled.',
            'Already-active ones become **"paused: AI disabled"** and the backend rejects their calls with `ai_disabled`.',
            'When AI is turned back on they work again **without reinstalling**.',
            'If the manifest declares `ai.required: false`, the extension **degrades** (works without AI) instead of being blocked; the same applies per feature (`feature_disabled`) and per extension.',
        ] },
        { t: 'h2', id: 'migration', text: 'Migrating from environment variables' },
        { t: 'p', text: '`AI_KEY`, `AI_PROVIDER` and `AI_MODEL` remain only as a **legacy fallback**: they are used only when **nothing is saved in `/admin/ai`**, a migration notice is shown and they are **never mixed** with the UI configuration.' },
        { t: 'code', lang: 'bash', title: 'Legacy variables (no longer recommended)', code: legacyExEn },
        { t: 'ol', items: [
            'Open `/admin/ai` on the instance (the "legacy configuration" notice confirms you are on the fallback).',
            'Enter provider, model and key and save: from then on the UI configuration wins and the fallback is ignored.',
            'Press **Test** (or `ai test`) and review features, quotas and guardrails (defaults are conservative).',
            'Remove `AI_KEY`, `AI_PROVIDER` and `AI_MODEL` (and the backend\'s `OPENAI_API_KEY`) from the environment and redeploy.',
        ] },
        { t: 'p', text: 'During the transition everything keeps working on the fallback. The shared backend **no longer uses a global key**: calling its `services.ai` directly is **DEPRECATED** (warning in logs) and kept only for compatibility with old instances that do not yet have the bridge endpoint; update those instances and migrate as above.' },
        { t: 'h2', id: 'errors', text: 'Typed errors' },
        { t: 'table', head: ['Code', 'HTTP', 'When'], rows: [
            ['`ai_disabled`', '403', 'AI is disabled on the instance'],
            ['`feature_disabled`', '403', 'The feature (or extension) is disabled by the administrator'],
            ['`quota_exceeded`', '429', 'A user or global quota is exhausted'],
            ['`guardrail_blocked`', '422', 'A guardrail in `enforce` mode blocked the request or the answer'],
            ['`not_configured`', '503', 'Provider or key missing'],
            ['`provider_error`', '502', 'The provider failed or timed out'],
            ['`schema_validation_failed`', '422', 'The answer does not match the requested format'],
            ['`invalid_args`', '400', 'Invalid request'],
        ] },
        { t: 'p', text: 'Each code has a friendly es/en message (`AI_ERROR_MESSAGES`) that never includes user content.' },
        { t: 'h2', id: 'permissions', text: 'Permission levels' },
        { t: 'table', head: ['Level', 'Can'], rows: [
            ['≥ 1', 'View configuration (without the key) and usage'],
            ['≥ 3', 'Edit features, limits, quotas, guardrails and prices'],
            ['≥ 4 + step-up', 'Key, provider and kill switch'],
        ] },
        { t: 'h2', id: 'cli', text: 'CLI' },
        { t: 'code', lang: 'bash', title: 'AI commands', code: cliExEn },
        { t: 'p', text: 'Full option reference in [Admin CLI](/docs/admin-cli).' },
        { t: 'h2', id: 'features', text: 'Which features use AI' },
        { t: 'table', head: ['Feature', 'Extension', 'Notes'], rows: [
            ['Organizer (classify and label)', '`organizer`', 'Optional AI with heuristic fallback ([Organizer](/docs/sealer#organizer))'],
            ['Smart reply', '`smart-reply`', 'Depends on the open message content'],
            ['Summary', '`summarizer`', 'Same'],
            ['Translation', '`translator`', 'Same'],
            ['Writing help', '`core-composer-helper`', 'The only writing help; there is no native AI composer'],
        ] },
        { t: 'p', text: 'Rules, search, Liquid/Elixir, Sealer and appointments **do not use AI**.' },
    ],
};

export default page;
