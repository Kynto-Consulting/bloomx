import type { DocPageContent } from '../types';

const envEx = `# En el BACKEND compartido (es quien llama al proveedor de IA)
AI_PROVIDER="openai"      # openai | grok | cohere | anthropic | gemini (o google)
AI_KEY="<clave-del-proveedor>"
AI_MODEL="gpt-4o-mini"    # opcional`;

const envExEn = envEx.replace('# En el BACKEND compartido (es quien llama al proveedor de IA)', '# On the shared BACKEND (it is the one calling the AI provider)').replace('<clave-del-proveedor>', '<provider-key>').replace('# opcional', '# optional');

const page: DocPageContent = {
    es: [
        { t: 'p', text: 'Las funciones de IA de BloomX son **opcionales** y se ejecutan en el **backend compartido**, dentro de las extensiones que declaran el permiso `AI_GENERATE` (`services.ai.generate(system, prompt)`). Sin clave de IA, esas funciones fallan con un error claro; el resto del correo funciona igual.' },
        { t: 'h2', id: 'providers', text: 'Proveedores y configuración' },
        { t: 'table', head: ['Variable', 'Valores'], rows: [
            ['`AI_PROVIDER`', '`openai` (por defecto), `grok` (API de xAI), `cohere`, `anthropic`, `gemini` o `google`. En el backend, si no se define y existe `OPENAI_API_KEY`, se usa OpenAI'],
            ['`AI_KEY`', 'Clave **única** del proveedor elegido. No existen claves por proveedor (`AI_OPENAI_API_KEY`, etc.). En el backend también se acepta `OPENAI_API_KEY`'],
            ['`AI_MODEL`', 'Modelo. Backend: por defecto `gpt-4o-mini` (o `OPENAI_MODEL`)'],
        ] },
        { t: 'code', lang: 'bash', title: 'Configuración del backend', code: envEx },
        { t: 'ul', items: [
            'Temperatura 0.3. La respuesta se pide en JSON solo a OpenAI y Grok. Los errores del proveedor se devuelven como `AI request failed (status)` sin detalles.',
            'Presupuesto por invocación de extensión: 5 llamadas; `system` ≤ 20 000 y `prompt` ≤ 100 000 caracteres.',
            'El frontend valida `AI_PROVIDER` con un enum al importar `src/lib/env.ts`: un valor inválido (por ejemplo `claude`) hace fallar el registro y el almacenamiento. Usa uno de los valores de la tabla. El módulo `src/lib/ai.ts` del frontend existe pero, según la revisión del código, hoy no lo importa ninguna pantalla: la IA real corre en el backend.',
        ] },
        { t: 'h2', id: 'features', text: 'Qué funciones usan IA' },
        { t: 'table', head: ['Función', 'Extensión', 'Notas'], rows: [
            ['Organizer (clasificar y etiquetar)', '`organizer`', 'IA opcional con degradación a heurística ([Organizer](/docs/sealer#organizer))'],
            ['Respuesta inteligente', '`smart-reply`', 'Parcial: depende del contenido del correo abierto'],
            ['Resumen', '`summarizer`', 'Parcial (idem)'],
            ['Traducción (a inglés)', '`translator`', 'Parcial (idem)'],
            ['Ayuda para redactar', '`composer-helper`', 'Comando `/ai` y botón "Help me write with AI"'],
        ] },
        { t: 'p', text: 'Las reglas, la búsqueda, Liquid/Elixir, Sealer y las citas **no usan IA**.' },
        { t: 'callout', kind: 'warn', title: 'Privacidad', text: 'Al usar IA, el contenido que la función envía (asunto, extracto, etc.) sale hacia el proveedor que configures. El Organizer envía lotes con ids anónimos y trata el texto del correo como dato no confiable, pero el texto sí llega al proveedor. Elige un proveedor acorde con tu política de datos o no configures `AI_KEY`.' },
    ],
    en: [
        { t: 'p', text: 'BloomX\'s AI features are **optional** and run on the **shared backend**, inside extensions that declare the `AI_GENERATE` permission (`services.ai.generate(system, prompt)`). Without an AI key those features fail with a clear error; the rest of mail works the same.' },
        { t: 'h2', id: 'providers', text: 'Providers and configuration' },
        { t: 'table', head: ['Variable', 'Values'], rows: [
            ['`AI_PROVIDER`', '`openai` (default), `grok` (xAI API), `cohere`, `anthropic`, `gemini` or `google`. On the backend, if unset and `OPENAI_API_KEY` exists, OpenAI is used'],
            ['`AI_KEY`', '**Single** key for the chosen provider. There are no per-provider keys (`AI_OPENAI_API_KEY`, etc.). The backend also accepts `OPENAI_API_KEY`'],
            ['`AI_MODEL`', 'Model. Backend: `gpt-4o-mini` by default (or `OPENAI_MODEL`)'],
        ] },
        { t: 'code', lang: 'bash', title: 'Backend configuration', code: envExEn },
        { t: 'ul', items: [
            'Temperature 0.3. A JSON answer is requested only from OpenAI and Grok. Provider errors are returned as `AI request failed (status)` without details.',
            'Budget per extension invocation: 5 calls; `system` ≤ 20,000 and `prompt` ≤ 100,000 characters.',
            'The frontend validates `AI_PROVIDER` with an enum when `src/lib/env.ts` is imported: an invalid value (for example `claude`) makes sign-up and storage fail. Use one of the values in the table. The frontend\'s `src/lib/ai.ts` module exists but, per the code review, no screen imports it today: the real AI runs on the backend.',
        ] },
        { t: 'h2', id: 'features', text: 'Which features use AI' },
        { t: 'table', head: ['Feature', 'Extension', 'Notes'], rows: [
            ['Organizer (classify and label)', '`organizer`', 'Optional AI with heuristic fallback ([Organizer](/docs/sealer#organizer))'],
            ['Smart reply', '`smart-reply`', 'Partial: depends on the open message content'],
            ['Summary', '`summarizer`', 'Partial (same)'],
            ['Translation (to English)', '`translator`', 'Partial (same)'],
            ['Writing help', '`composer-helper`', '`/ai` command and "Help me write with AI" button'],
        ] },
        { t: 'p', text: 'Rules, search, Liquid/Elixir, Sealer and appointments **do not use AI**.' },
        { t: 'callout', kind: 'warn', title: 'Privacy', text: 'When AI is used, the content a feature sends (subject, snippet, etc.) leaves for the provider you configure. The Organizer sends batches with anonymous ids and treats the email text as untrusted data, but the text does reach the provider. Choose a provider consistent with your data policy or do not set `AI_KEY`.' },
    ],
};

export default page;
