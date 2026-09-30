import type { DocPageContent } from '../types';

const tpl = `Hola {{ nombre | capitalize }},

{% if saldo > 0 %}
Tienes un saldo pendiente de S/ {{ saldo | round: 2 }} con vencimiento el {{ vence | date: "%d/%m/%Y" }}.
{% else %}
¡Gracias por estar al día!
{% endif %}

{% assign items = "A,B,C" | split: "," %}
{% for item in items limit: 2 %}
  {{ forloop.index }}. Producto {{ item }}
{% endfor %}

Enviado el {{ current_date }}.
Si no deseas recibir más correos: {{ unsubscribe_url }}`;

const tplEn = tpl
    .replace('Hola {{ nombre | capitalize }},', 'Hello {{ nombre | capitalize }},')
    .replace('Tienes un saldo pendiente de S/ {{ saldo | round: 2 }} con vencimiento el', 'You have an outstanding balance of {{ saldo | round: 2 }} due on')
    .replace('¡Gracias por estar al día!', 'Thanks for being up to date!')
    .replace('Producto {{ item }}', 'Product {{ item }}')
    .replace('Enviado el {{ current_date }}.', 'Sent on {{ current_date }}.')
    .replace('Si no deseas recibir más correos:', 'To stop receiving these emails:');

const campaignFlow = `POST  /api/elixir/campaigns                    -> crea el borrador (compila y valida la plantilla)
POST  /api/elixir/campaigns/<id>/rows           -> sube filas en trozos de hasta 500 ({ items: [{ index, row }] })
PATCH /api/elixir/campaigns/<id>  {"action":"start"}   (pause | resume | cancel | retry_errors)
GET   /api/elixir/campaigns/<id>?rows=1         -> estado y filas
# El worker avanza con /api/cron/elixir (Authorization: Bearer <CRON_SECRET>) o POST /api/elixir/campaigns/<id>/tick (1 cada 10 s)`;

const campaignFlowEn = campaignFlow
    .replace('-> crea el borrador (compila y valida la plantilla)', '-> creates the draft (compiles and validates the template)')
    .replace('-> sube filas en trozos de hasta 500', '-> uploads rows in chunks of up to 500')
    .replace('-> estado y filas', '-> status and rows')
    .replace('# El worker avanza con', '# The worker advances with')
    .replace('o POST', 'or POST')
    .replace('(1 cada 10 s)', '(1 per 10 s)');

const page: DocPageContent = {
    es: [
        { t: 'p', text: '**Elixir** es el módulo de envío masivo personalizado: subes un CSV o XLSX, escribes una plantilla **Liquid** y BloomX envía un correo por fila, con reintentos, cuotas, lista de supresión y baja de un clic. Hay dos modos: envío directo por lotes en primer plano y **campañas en segundo plano** persistentes.' },
        { t: 'h2', id: 'data', text: 'Datos de entrada' },
        { t: 'ul', items: [
            'Archivo de hasta **15 MB**; hasta **100 000 filas** y **500 columnas**. CSV/TXT (quita BOM, detecta `,` `;` tab o `|`, o respeta `sep=;`; RFC 4180) y **XLSX** (solo la primera hoja, con protección anti zip-bomb; el `.xls` antiguo se rechaza).',
            'Cabeceras vacías pasan a `columna_N` y duplicadas a `nombre_2`. Cada celda se recorta a 20 000 caracteres.',
            'Los nombres de columna pueden llevar espacios y acentos; para símbolos usa `row["Precio (S/.)"]`.',
            'El editor es CodeMirror con autocompletado y *lint* de la plantilla; hay biblioteca de plantillas (máx. 200 por usuario) e historial de campañas.',
        ] },
        { t: 'h2', id: 'liquid', text: 'Liquid: sintaxis y límites' },
        { t: 'p', text: 'El motor Liquid es propio (no la librería estándar): compila una vez y renderiza por fila; los errores de sintaxis, etiqueta o filtro desconocido se detectan al **compilar**. Sin `eval` ni `Function`; solo se leen propiedades propias.' },
        { t: 'table', head: ['Límite', 'Valor por defecto'], rows: [
            ['Tamaño de plantilla', '500 000 caracteres'],
            ['Profundidad / iteraciones / pasos', '24 / 100 000 / 2 000 000'],
            ['Rango `(a..b)`', '10 000 elementos'],
            ['Salida por correo', '5 MiB'],
            ['Tiempo de render por fila', '2000 ms'],
        ] },
        { t: 'code', lang: 'liquid', title: 'Ejemplo de plantilla', code: tpl },
        { t: 'h3', id: 'tags', text: 'Etiquetas (tags)' },
        { t: 'ul', items: [
            '`if` / `elsif` / `else`, `unless`, `for` (con `limit`, `offset`, `reversed`, rangos `(1..N)` y `else`), `case` / `when` (coma u `or`), `assign`, `capture`, `comment`, `raw`, `increment`, `decrement`, `cycle`, `echo`, `break`, `continue`.',
            'Control de espacios: `{{-`, `-}}`, `{%-`, `-%}`. Operadores: `==`, `!=`, `>`, `<`, `>=`, `<=`, `contains`, `and`, `or`.',
            '`forloop`: `index`, `index0`, `rindex`, `rindex0`, `first`, `last`, `length`, `parentloop`.',
            '**No soportados** (error explícito): `include`, `render`, `liquid`, `tablerow`, `ifchanged` y similares.',
            'Diferencias con Liquid estándar: una celda vacía, `"false"`, `"nil"` o `"null"` cuenta como **falsa**; las fechas `YYYY-MM-DD` y `DD/MM/YYYY` se tratan como fecha de calendario (sin zona horaria).',
        ] },
        { t: 'h3', id: 'filters', text: 'Filtros' },
        { t: 'table', head: ['Grupo', 'Filtros'], rows: [
            ['Texto', '`upcase`, `downcase`, `capitalize`, `strip`, `lstrip`, `rstrip`, `strip_html`, `strip_newlines`, `newline_to_br`, `escape`, `escape_once`, `raw`, `url_encode`, `url_decode`, `base64_encode`, `base64_decode`, `base64_url_safe_encode`, `base64_url_safe_decode`, `truncate`, `truncatewords`, `replace`, `replace_first`, `replace_last`, `remove`, `remove_first`, `remove_last`, `prepend`, `append`, `default`, `json`'],
            ['Números', '`abs`, `ceil`, `floor`, `round`, `fixed`, `at_least`, `at_most`, `plus`, `minus`, `times`, `divided_by`, `modulo`'],
            ['Fecha', '`date` (formatos strftime: `%d %m %Y %H %M %S %B %b %A %a %e %j %I %l %p %Z %z %s %F %T %R %D`…; con relleno `%-d`)'],
            ['Listas', '`size`, `first`, `last`, `reverse`, `split`, `join`, `sort`, `sort_natural`, `uniq`, `compact`, `flatten`, `sum`, `min`, `max`, `concat`, `push`, `map`, `where`, `reject`, `slice`'],
        ] },
        { t: 'p', text: '`fixed` y `push` no son estándar de Liquid.' },
        { t: 'h3', id: 'variables', text: 'Variables' },
        { t: 'ul', items: [
            'Las **columnas** de tu archivo.',
            '`current_date`, `current_day`, `current_month`, `current_year` (las calcula el servidor, en español, con la zona de la campaña) y `now` / `today` (para usar con `| date`).',
            '`unsubscribe_url`: enlace de baja firmado por destinatario.',
            '`brand_name`, `brand_color`, `brand_logo` aparecen como variables de sistema en el editor, pero **el servidor no las calcula**: solo llegan si el cliente las manda en `systemVars` (máx. 50 claves).',
            'Precedencia al fusionar: fecha < `systemVars` < fila < `unsubscribe_url`.',
            'Opciones de render: `autoescape` (por defecto activo; usa `| raw` para valores de confianza), `strictVariables` (por defecto activo) y `timezone` (zona IANA, por defecto UTC).',
        ] },
        { t: 'h2', id: 'sending', text: 'Modos de envío' },
        { t: 'h3', id: 'direct', text: 'Envío directo por lotes' },
        { t: 'p', text: '`POST /api/elixir/send` desde la interfaz, en lotes de 25 (el servidor acepta hasta `ELIXIR_BATCH_MAX` = 50 filas, tope 100) con presupuesto de 45 s. Devuelve `results` por fila (`sent`, `skipped`, `error`, `unsubscribed`) y `pending`, con `retryAfterMs` o `paused: "quota"`. Límite de 1200 peticiones por hora por usuario y cuota en memoria `ELIXIR_MAX_ROWS_PER_HOUR` (5000 por defecto). Idempotente por (campaña, destinatario) con `Idempotency-Key` hacia Resend.' },
        { t: 'h3', id: 'background', text: 'Campañas en segundo plano' },
        { t: 'code', lang: 'text', title: 'Ciclo de vida por API', code: campaignFlow },
        { t: 'ul', items: [
            'Hasta **20 000 filas** por campaña (`ELIXIR_MAX_CAMPAIGN_ROWS`; 413 al excederlo). Al subir, un correo inválido pasa a `skipped` (`invalid_email`) y un duplicado a `skipped` (`duplicate`).',
            '**Estados de campaña**: `draft → running ⇄ paused`, y `running → done | cancelled | failed`. `start` solo desde `draft`; `resume` desde `paused`, `cancelled` o `failed`; `retry_errors` devuelve las filas `error` a `pending`. Borrar una campaña `running` da 409.',
            '**Estados de fila**: `pending → sending → sent | error | skipped | unsubscribed`, y `sent → bounced | complained` (por eventos de Resend).',
            '**Worker** (`/api/cron/elixir`, `Authorization: Bearer <CRON_SECRET>` o la clave interna derivada): hasta 5 campañas en marcha, un solo worker por campaña (bloqueo de 90 s), lotes de 10 filas con 550 ms entre envíos, cuota persistente por usuario (filas `sent` de la última hora, `ELIXIR_MAX_ROWS_PER_HOUR`). Filas atascadas en `sending` más de 5 min vuelven a `pending`.',
            '**Reintentos**: hasta 4 dentro de un envío (backoff exponencial con jitter, respeta `Retry-After`) y, por fila, backoff `30 s × 2^(n−1)` con tope de 1 h y máximo 6 intentos (después `error` con código `max_attempts`). Con 429/5xx/red la fila vuelve a `pending` y el lote se detiene.',
            'Falla **cerrado**: si la lista de supresión no está disponible, no envía y reintenta a los 30 s. Si el render falla, la fila queda en `error`: **nunca** se envía la plantilla cruda. El remitente debe ser el usuario o una cuenta vinculada.',
            'Elixir **no tiene cron programado** en el repositorio: avanza por encadenamiento propio (hasta 400 saltos), por el sondeo de la interfaz o por un cron externo ([Despliegue](/docs/deployment#cron)).',
        ] },
        { t: 'h2', id: 'unsubscribe', text: 'Supresión y bajas' },
        { t: 'ul', items: [
            'Cada envío masivo añade `List-Unsubscribe` (https y `mailto:`) y `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058) **solo si** `NEXT_PUBLIC_APP_URL` es https y hay secreto (`UNSUBSCRIBE_SECRET` o `NEXTAUTH_SECRET`). Se añade un pie de baja salvo que la plantilla ya use `unsubscribe_url`.',
            '`GET /api/webhooks/unsubscribe?t=<token>` muestra una página de confirmación y **no** da de baja; `POST` da de baja (un clic o formulario). Página bilingüe (`?lang=`), sin JavaScript; 30/min por IP.',
            'Las bajas se guardan como eventos. Los **rebotes permanentes** y las **quejas** de Resend (webhook `resend-events`) también suprimen; el retraso de entrega solo se anota.',
            'Los destinatarios suprimidos se omiten en cada envío (`unsubscribed`). `cc` y `bcc` admiten Liquid (máx. 10 extras, filtrando suprimidos).',
        ] },
        { t: 'h2', id: 'limits', text: 'Límites conocidos' },
        { t: 'ul', items: [
            'El worker siempre renderiza con `locale = es` para las variables de fecha.',
            'La cuota `ELIXIR_MAX_ROWS_PER_HOUR` del modo directo es por instancia (memoria); la del worker es persistente.',
            'Las plantillas y campañas persistidas no incluyen adjuntos.',
            'Sin `CRON_SECRET` y sin cron propio, las campañas dependen de tener la interfaz abierta o del encadenamiento.',
        ] },
    ],
    en: [
        { t: 'p', text: '**Elixir** is the personalised bulk-sending module: you upload a CSV or XLSX, write a **Liquid** template and BloomX sends one email per row, with retries, quotas, a suppression list and one-click unsubscribe. There are two modes: direct foreground batch sending and persistent **background campaigns**.' },
        { t: 'h2', id: 'data', text: 'Input data' },
        { t: 'ul', items: [
            'File up to **15 MB**; up to **100,000 rows** and **500 columns**. CSV/TXT (strips BOM, detects `,` `;` tab or `|`, or honours `sep=;`; RFC 4180) and **XLSX** (first sheet only, with zip-bomb protection; old `.xls` is rejected).',
            'Empty headers become `columna_N` and duplicates `name_2`. Each cell is trimmed to 20,000 characters.',
            'Column names may contain spaces and accents; for symbols use `row["Price (S/.)"]`.',
            'The editor is CodeMirror with autocomplete and template *lint*; there is a template library (max 200 per user) and campaign history.',
        ] },
        { t: 'h2', id: 'liquid', text: 'Liquid: syntax and limits' },
        { t: 'p', text: 'The Liquid engine is custom (not the standard library): it compiles once and renders per row; syntax errors and unknown tags or filters are caught at **compile time**. No `eval` or `Function`; only own properties are read.' },
        { t: 'table', head: ['Limit', 'Default value'], rows: [
            ['Template size', '500,000 characters'],
            ['Depth / iterations / steps', '24 / 100,000 / 2,000,000'],
            ['Range `(a..b)`', '10,000 elements'],
            ['Output per email', '5 MiB'],
            ['Render time per row', '2000 ms'],
        ] },
        { t: 'code', lang: 'liquid', title: 'Template example', code: tplEn },
        { t: 'h3', id: 'tags', text: 'Tags' },
        { t: 'ul', items: [
            '`if` / `elsif` / `else`, `unless`, `for` (with `limit`, `offset`, `reversed`, `(1..N)` ranges and `else`), `case` / `when` (comma or `or`), `assign`, `capture`, `comment`, `raw`, `increment`, `decrement`, `cycle`, `echo`, `break`, `continue`.',
            'Whitespace control: `{{-`, `-}}`, `{%-`, `-%}`. Operators: `==`, `!=`, `>`, `<`, `>=`, `<=`, `contains`, `and`, `or`.',
            '`forloop`: `index`, `index0`, `rindex`, `rindex0`, `first`, `last`, `length`, `parentloop`.',
            '**Unsupported** (explicit error): `include`, `render`, `liquid`, `tablerow`, `ifchanged` and similar.',
            'Differences from standard Liquid: an empty cell, `"false"`, `"nil"` or `"null"` counts as **false**; `YYYY-MM-DD` and `DD/MM/YYYY` dates are treated as calendar dates (no time zone).',
        ] },
        { t: 'h3', id: 'filters', text: 'Filters' },
        { t: 'table', head: ['Group', 'Filters'], rows: [
            ['Text', '`upcase`, `downcase`, `capitalize`, `strip`, `lstrip`, `rstrip`, `strip_html`, `strip_newlines`, `newline_to_br`, `escape`, `escape_once`, `raw`, `url_encode`, `url_decode`, `base64_encode`, `base64_decode`, `base64_url_safe_encode`, `base64_url_safe_decode`, `truncate`, `truncatewords`, `replace`, `replace_first`, `replace_last`, `remove`, `remove_first`, `remove_last`, `prepend`, `append`, `default`, `json`'],
            ['Numbers', '`abs`, `ceil`, `floor`, `round`, `fixed`, `at_least`, `at_most`, `plus`, `minus`, `times`, `divided_by`, `modulo`'],
            ['Date', '`date` (strftime formats: `%d %m %Y %H %M %S %B %b %A %a %e %j %I %l %p %Z %z %s %F %T %R %D`…; with padding `%-d`)'],
            ['Lists', '`size`, `first`, `last`, `reverse`, `split`, `join`, `sort`, `sort_natural`, `uniq`, `compact`, `flatten`, `sum`, `min`, `max`, `concat`, `push`, `map`, `where`, `reject`, `slice`'],
        ] },
        { t: 'p', text: '`fixed` and `push` are not standard Liquid.' },
        { t: 'h3', id: 'variables', text: 'Variables' },
        { t: 'ul', items: [
            'Your file\'s **columns**.',
            '`current_date`, `current_day`, `current_month`, `current_year` (computed by the server, in Spanish, with the campaign time zone) and `now` / `today` (to use with `| date`).',
            '`unsubscribe_url`: unsubscribe link signed per recipient.',
            '`brand_name`, `brand_color`, `brand_logo` appear as system variables in the editor, but **the server does not compute them**: they only arrive if the client sends them in `systemVars` (max 50 keys).',
            'Precedence when merging: date < `systemVars` < row < `unsubscribe_url`.',
            'Render options: `autoescape` (on by default; use `| raw` for trusted values), `strictVariables` (on by default) and `timezone` (IANA zone, UTC by default).',
        ] },
        { t: 'h2', id: 'sending', text: 'Sending modes' },
        { t: 'h3', id: 'direct', text: 'Direct batch sending' },
        { t: 'p', text: '`POST /api/elixir/send` from the UI, in batches of 25 (the server accepts up to `ELIXIR_BATCH_MAX` = 50 rows, cap 100) with a 45 s budget. Returns per-row `results` (`sent`, `skipped`, `error`, `unsubscribed`) and `pending`, with `retryAfterMs` or `paused: "quota"`. Limit of 1200 requests per hour per user and in-memory quota `ELIXIR_MAX_ROWS_PER_HOUR` (5000 by default). Idempotent per (campaign, recipient) through `Idempotency-Key` towards Resend.' },
        { t: 'h3', id: 'background', text: 'Background campaigns' },
        { t: 'code', lang: 'text', title: 'Lifecycle through the API', code: campaignFlowEn },
        { t: 'ul', items: [
            'Up to **20,000 rows** per campaign (`ELIXIR_MAX_CAMPAIGN_ROWS`; 413 when exceeded). On upload, an invalid email becomes `skipped` (`invalid_email`) and a duplicate `skipped` (`duplicate`).',
            '**Campaign states**: `draft → running ⇄ paused`, and `running → done | cancelled | failed`. `start` only from `draft`; `resume` from `paused`, `cancelled` or `failed`; `retry_errors` returns `error` rows to `pending`. Deleting a `running` campaign gives 409.',
            '**Row states**: `pending → sending → sent | error | skipped | unsubscribed`, and `sent → bounced | complained` (from Resend events).',
            '**Worker** (`/api/cron/elixir`, `Authorization: Bearer <CRON_SECRET>` or the derived internal key): up to 5 running campaigns, a single worker per campaign (90 s lock), batches of 10 rows with 550 ms between sends, persistent per-user quota (`sent` rows in the last hour, `ELIXIR_MAX_ROWS_PER_HOUR`). Rows stuck in `sending` for over 5 min go back to `pending`.',
            '**Retries**: up to 4 inside a send (exponential backoff with jitter, honours `Retry-After`) and, per row, backoff `30 s × 2^(n−1)` capped at 1 h and at most 6 attempts (then `error` with code `max_attempts`). On 429/5xx/network the row goes back to `pending` and the batch stops.',
            'Fails **closed**: if the suppression list is unavailable it does not send and retries after 30 s. If rendering fails the row is `error`: the raw template is **never** sent. The sender must be the user or a linked account.',
            'Elixir has **no scheduled cron** in the repository: it advances through its own chaining (up to 400 hops), the UI polling or an external cron ([Deployment](/docs/deployment#cron)).',
        ] },
        { t: 'h2', id: 'unsubscribe', text: 'Suppression and unsubscribes' },
        { t: 'ul', items: [
            'Every bulk send adds `List-Unsubscribe` (https and `mailto:`) and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058) **only if** `NEXT_PUBLIC_APP_URL` is https and a secret exists (`UNSUBSCRIBE_SECRET` or `NEXTAUTH_SECRET`). An unsubscribe footer is added unless the template already uses `unsubscribe_url`.',
            '`GET /api/webhooks/unsubscribe?t=<token>` shows a confirmation page and does **not** unsubscribe; `POST` unsubscribes (one click or form). Bilingual page (`?lang=`), no JavaScript; 30/min per IP.',
            'Unsubscribes are stored as events. Resend **permanent bounces** and **complaints** (`resend-events` webhook) also suppress; delivery delay is only noted.',
            'Suppressed recipients are skipped on every send (`unsubscribed`). `cc` and `bcc` accept Liquid (max 10 extras, filtering suppressed ones).',
        ] },
        { t: 'h2', id: 'limits', text: 'Known limits' },
        { t: 'ul', items: [
            'The worker always renders with `locale = es` for date variables.',
            'The direct-mode `ELIXIR_MAX_ROWS_PER_HOUR` quota is per instance (memory); the worker\'s is persistent.',
            'Persisted templates and campaigns do not include attachments.',
            'Without `CRON_SECRET` and without its own cron, campaigns depend on the UI being open or on chaining.',
        ] },
    ],
};

export default page;
