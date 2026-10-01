import type { DocPageContent } from '../types';

const link = `https://mail.tu-dominio.com/secure/<uuid>#k=<43 caracteres base64url>
                                           └── el fragmento (#…) NO se envía nunca al servidor`;
const linkEn = link.replace('tu-dominio', 'your-domain').replace('43 caracteres base64url', '43 base64url characters').replace('el fragmento (#…) NO se envía nunca al servidor', 'the fragment (#…) is NEVER sent to the server');

const page: DocPageContent = {
    es: [
        { t: 'h2', id: 'sealer', text: 'Sealer: envío sellado' },
        { t: 'p', text: 'El **envío sellado** permite mandar un mensaje que se cifra **en el navegador** del remitente; el servidor solo guarda un sobre cifrado. El destinatario no necesita cuenta: recibe un enlace `/secure/<id>` y descifra en su navegador. Está activo (la extensión `core-sealer` está `active`), pero **el cifrado no lo hace la extensión** (su `server.js` solo describe el protocolo): vive en la aplicación (`src/lib/sealed/*`, `/api/secure-message`, `/secure/[id]` y la opción "Enviar sellado" del editor).' },
        { t: 'h3', id: 'how', text: 'Cómo funciona' },
        { t: 'ol', items: [
            'El navegador genera una clave aleatoria de 256 bits (`K`) y cifra `{asunto, html}` con **AES-256-GCM** (IV de 96 bits, tag de 128 bits; máx. 700 000 bytes de texto plano).',
            'Opcional: **contraseña** (8–256 caracteres). La clave de contenido pasa a `HKDF-SHA256(K ‖ P)` con `P` derivada con PBKDF2-SHA256 (600 000 iteraciones por defecto, sal de 16 bytes). Hacen falta **ambos** secretos: el fragmento y la contraseña. El AAD (`bloomx-sealed:v1:nopw` o `…:pw:<iter>`) impide ataques de degradación.',
            'El navegador sube el sobre `{v, alg, iv, ct, pw, …}` a `POST /api/secure-message` (con sesión; 30/h por correo) con `maxViews` (1–100 o sin límite). El servidor devuelve `{id, viewUrl, expiresAt}` y guarda `secure/<id>.sealed`, envuelto además con la clave de datos del servidor (defensa en profundidad).',
            'El correo saliente lleva solo el enlace con la clave en el **fragmento** `#k=…`, que el navegador nunca envía al servidor.',
            'El destinatario abre `/secure/<id>`; si hay límite de vistas se muestra una pantalla previa antes de gastar una. `GET /api/secure-message/<id>` da metadatos sin contar vista; `POST` (con cabecera `X-Sealed-Reveal: 1`) consume una vista de forma atómica y devuelve el sobre; el navegador descifra.',
        ] },
        { t: 'code', lang: 'text', title: 'El enlace', code: link },
        { t: 'ul', items: [
            'TTL: `min(ttlDays pedido, SECURE_MESSAGE_TTL_DAYS)` (30 por defecto). La interfaz **no** expone `ttlDays`, así que siempre se usa el máximo configurado. Al caducar o agotar las vistas se borra el objeto. Un id inexistente, caducado o agotado responde igual (404).',
            '`SECURE_MESSAGE_ENABLED=false` desactiva el módulo (403 al crear).',
            'Rate limit: abrir 120/min por IP y 240/h por id; consumir 60/min por IP y 120/h por id.',
            'El editor ofrece la casilla "Enviar sellado", panel de contraseña/vistas, y "copiar enlace" (cifra y sube sin enviar correo). Funciona con envío programado.',
        ] },
        { t: 'h3', id: 'limits', text: 'Límites reales' },
        { t: 'callout', kind: 'warn', title: 'La clave viaja en el enlace', text: 'Quien pueda leer el correo (o el enlace completo) obtiene la clave. **Sin contraseña**, el sellado protege el contenido en el servidor y en tránsito hacia BloomX, pero no frente a alguien con acceso al buzón del destinatario. Para proteger de verdad, define una contraseña y compártela por **otro canal**. Sin contraseña el editor pide confirmación.' },
        { t: 'ul', items: [
            'Un envío sellado **no admite adjuntos**.',
            'El contenido sellado **evade el DLP**: el hook `EMAIL_PRE_SEND` solo ve el correo exterior con el enlace, no el contenido cifrado.',
            'No oculta metadatos: quién envía a quién y cuándo sigue siendo visible, y el destinatario ve el correo exterior.',
            'El conteo de vistas es atómico en la tabla `SecureMessageMeta`; si la tabla no existe (`npm run db:ensure`), cae a un conteo con bloqueo en memoria y, con varias instancias, podría exceder el límite en 1.',
            'La frase de contraseña la valida el cliente (8–256); el servidor no la ve. Cualquier fallo de descifrado da el mismo error genérico.',
            'Los enlaces con `.msg` antiguos (texto plano guardado en el servidor) siguen legibles; el formato antiguo con `content` se rechaza al crear.',
        ] },
        { t: 'h2', id: 'organizer', text: 'Organizer: organización con IA' },
        { t: 'p', text: 'El **Organizer** clasifica el correo de la bandeja en categorías y aplica etiquetas automáticamente (o las propone). Es una extensión (`core-organizer`, `active`); el frontend solo aporta el puente de datos (`/api/internal/mail`) y la interfaz de propuestas.' },
        { t: 'callout', kind: 'note', title: 'Requisitos', text: 'Necesita `services.mail`: llamada firmada (tu dominio en modo firmado, con `BLOOMX_DOMAIN_PRIVATE_KEY`); el backend no necesita ninguna clave. Si no, falla con `ORGANIZER_MAIL_SERVICE_UNAVAILABLE` y el hook `EMAIL_RECEIVED` se omite en silencio. La IA usa la configuración de la instancia en `/admin/ai` ([IA](/docs/ai)); sin IA degrada a heurística.' },
        { t: 'h3', id: 'organizer-how', text: 'Cómo decide' },
        { t: 'ol', items: [
            '**Candidatos**: solo `inbox`, sin etiquetas y sin decisión previa del organizer. Cada correo se evalúa una sola vez. "Organize" procesa hasta 50 recientes (máx. 100, antigüedad 30 días); el hook `EMAIL_RECEIVED` lo hace al llegar.',
            '**Tus reglas primero**: si una regla habilitada ya etiqueta o mueve el correo, el organizer se abstiene.',
            '**Heurística** (regex sobre asunto, extracto y remitente; confianza 0.72–0.9). Con confianza ≥ 0.85 no gasta IA.',
            '**IA** para lo dudoso, en lotes de 25 con ids anónimos (`e1…eN`); el texto del correo se trata como dato no confiable y la respuesta debe ser JSON. Confianza tope 0.95; una categoría fuera de lista se descarta.',
            'Sin IA, con fallo o respuesta inválida, degrada a la heurística; lo no clasificable queda como `none` (examinado).',
        ] },
        { t: 'table', head: ['Categoría', 'Etiqueta creada', 'Color'], rows: [
            ['`work`', 'Work', '`#2563eb`'],
            ['`personal`', 'Personal', '`#16a34a`'],
            ['`newsletter`', 'Newsletters', '`#9333ea`'],
            ['`notification`', 'Notifications', '`#64748b`'],
            ['`finance`', 'Finance', '`#ca8a04`'],
            ['`social`', 'Social', '`#db2777`'],
            ['`spam`', '(ninguna: solo se propone)', '—'],
        ] },
        { t: 'ul', items: [
            '**Confianza**: piso 0.5; umbral `minConfidence` (por defecto 0.7, configurable 0.5–0.99 por dominio). ≥ umbral: aplica la etiqueta; entre 0.5 y el umbral: **propone**; < 0.5: examinado sin acción.',
            '**Propuestas**: `GET /api/organizer/proposals` y `POST /api/organizer/proposals/<emailId>` con `{action: "accept" | "dismiss"}`. La interfaz está en Ajustes → Etiquetas (solo aparece si hay propuestas), con asunto, remitente, categoría y porcentaje.',
            '**Undo**: el botón "Undo organize" deshace la última corrida (o un `runId`): solo desconecta las etiquetas que esa corrida añadió; es idempotente. Las propuestas no se deshacen (no hay nada aplicado).',
            'Los nombres internos de etiqueta son en inglés (se muestran traducidos); `settings.useAi === false` desactiva la IA.',
        ] },
    ],
    en: [
        { t: 'h2', id: 'sealer', text: 'Sealer: sealed sending' },
        { t: 'p', text: '**Sealed sending** lets you send a message that is encrypted **in the sender\'s browser**; the server only stores an encrypted envelope. The recipient needs no account: they get a `/secure/<id>` link and decrypt in their browser. It is active (the `core-sealer` extension is `active`), but **the extension does not do the encryption** (its `server.js` only describes the protocol): it lives in the application (`src/lib/sealed/*`, `/api/secure-message`, `/secure/[id]` and the editor\'s "Send sealed" option).' },
        { t: 'h3', id: 'how', text: 'How it works' },
        { t: 'ol', items: [
            'The browser generates a random 256-bit key (`K`) and encrypts `{subject, html}` with **AES-256-GCM** (96-bit IV, 128-bit tag; max 700,000 plaintext bytes).',
            'Optional **password** (8–256 characters). The content key becomes `HKDF-SHA256(K ‖ P)` with `P` derived with PBKDF2-SHA256 (600,000 iterations by default, 16-byte salt). **Both** secrets are needed: the fragment and the password. The AAD (`bloomx-sealed:v1:nopw` or `…:pw:<iter>`) blocks downgrade attacks.',
            'The browser uploads the envelope `{v, alg, iv, ct, pw, …}` to `POST /api/secure-message` (with a session; 30/h per email) with `maxViews` (1–100 or unlimited). The server returns `{id, viewUrl, expiresAt}` and stores `secure/<id>.sealed`, additionally wrapped with the server data key (defence in depth).',
            'The outgoing email carries only the link with the key in the **fragment** `#k=…`, which the browser never sends to the server.',
            'The recipient opens `/secure/<id>`; with a view limit an interstitial is shown before a view is spent. `GET /api/secure-message/<id>` gives metadata without counting a view; `POST` (with the `X-Sealed-Reveal: 1` header) atomically consumes one view and returns the envelope; the browser decrypts.',
        ] },
        { t: 'code', lang: 'text', title: 'The link', code: linkEn },
        { t: 'ul', items: [
            'TTL: `min(requested ttlDays, SECURE_MESSAGE_TTL_DAYS)` (30 by default). The UI does **not** expose `ttlDays`, so the configured maximum is always used. When it expires or views run out the object is deleted. A nonexistent, expired or exhausted id answers the same (404).',
            '`SECURE_MESSAGE_ENABLED=false` disables the module (403 on create).',
            'Rate limit: open 120/min per IP and 240/h per id; consume 60/min per IP and 120/h per id.',
            'The editor offers the "Send sealed" checkbox, a password/views panel, and "copy link" (encrypts and uploads without sending an email). Works with scheduled send.',
        ] },
        { t: 'h3', id: 'limits', text: 'Real limits' },
        { t: 'callout', kind: 'warn', title: 'The key travels in the link', text: 'Anyone who can read the email (or the full link) gets the key. **Without a password**, sealing protects the content on the server and in transit to BloomX, but not against someone with access to the recipient\'s mailbox. To really protect it, set a password and share it through **another channel**. Without a password the editor asks for confirmation.' },
        { t: 'ul', items: [
            'A sealed send **does not support attachments**.',
            'Sealed content **bypasses DLP**: the `EMAIL_PRE_SEND` hook only sees the outer email with the link, not the encrypted content.',
            'It does not hide metadata: who sends to whom and when is still visible, and the recipient sees the outer email.',
            'View counting is atomic in the `SecureMessageMeta` table; if the table does not exist (`npm run db:ensure`), it falls back to an in-memory locked count and, with several instances, could exceed the limit by 1.',
            'The password is validated by the client (8–256); the server never sees it. Any decryption failure gives the same generic error.',
            'Old `.msg` links (plain text stored on the server) remain readable; the old `content` format is rejected on create.',
        ] },
        { t: 'h2', id: 'organizer', text: 'Organizer: AI organising' },
        { t: 'p', text: 'The **Organizer** classifies inbox mail into categories and applies labels automatically (or proposes them). It is an extension (`core-organizer`, `active`); the frontend only provides the data bridge (`/api/internal/mail`) and the proposals UI.' },
        { t: 'callout', kind: 'note', title: 'Requirements', text: 'It needs `services.mail`: a signed call (your domain in signed mode, with `BLOOMX_DOMAIN_PRIVATE_KEY`); the backend needs no key. Otherwise it fails with `ORGANIZER_MAIL_SERVICE_UNAVAILABLE` and the `EMAIL_RECEIVED` hook is silently skipped. AI uses the instance configuration in `/admin/ai` ([AI](/docs/ai)); without AI it degrades to heuristics.' },
        { t: 'h3', id: 'organizer-how', text: 'How it decides' },
        { t: 'ol', items: [
            '**Candidates**: only `inbox`, with no labels and no earlier organizer decision. Each message is evaluated once. "Organize" processes up to 50 recent ones (max 100, age 30 days); the `EMAIL_RECEIVED` hook does it on arrival.',
            '**Your rules first**: if an enabled rule already labels or moves the message, the organizer abstains.',
            '**Heuristics** (regex over subject, snippet and sender; confidence 0.72–0.9). At confidence ≥ 0.85 it spends no AI.',
            '**AI** for the doubtful ones, in batches of 25 with anonymous ids (`e1…eN`); the email text is treated as untrusted data and the answer must be JSON. Confidence capped at 0.95; a category outside the list is dropped.',
            'Without AI, on failure or an invalid answer, it degrades to heuristics; what cannot be classified is recorded as `none` (examined).',
        ] },
        { t: 'table', head: ['Category', 'Label created', 'Colour'], rows: [
            ['`work`', 'Work', '`#2563eb`'],
            ['`personal`', 'Personal', '`#16a34a`'],
            ['`newsletter`', 'Newsletters', '`#9333ea`'],
            ['`notification`', 'Notifications', '`#64748b`'],
            ['`finance`', 'Finance', '`#ca8a04`'],
            ['`social`', 'Social', '`#db2777`'],
            ['`spam`', '(none: proposal only)', '—'],
        ] },
        { t: 'ul', items: [
            '**Confidence**: floor 0.5; threshold `minConfidence` (default 0.7, configurable 0.5–0.99 per domain). ≥ threshold: applies the label; between 0.5 and the threshold: **proposes**; < 0.5: examined, no action.',
            '**Proposals**: `GET /api/organizer/proposals` and `POST /api/organizer/proposals/<emailId>` with `{action: "accept" | "dismiss"}`. The UI is in Settings → Labels (only shown when proposals exist), with subject, sender, category and percentage.',
            '**Undo**: the "Undo organize" button undoes the last run (or a `runId`): it only detaches the labels that run added; it is idempotent. Proposals are not undone (nothing was applied).',
            'Internal label names are in English (shown translated); `settings.useAi === false` turns AI off.',
        ] },
    ],
};

export default page;
