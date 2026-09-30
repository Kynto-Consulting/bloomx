import type { DocPageContent } from '../types';

const page: DocPageContent = {
    es: [
        { t: 'p', text: 'BloomX clasifica el correo entrante con un **motor de spam explicable**: la puntuación (0–100) es la **suma ponderada de señales**, y cada señal tiene un identificador, un peso y un motivo legible en español e inglés. El administrador elige el **nivel de filtrado**, las **listas** de bloqueo y permitidos y la **política de correos externos** desde `/admin/spam`; cada usuario puede afinarlo en *Ajustes → Spam*.' },
        { t: 'callout', kind: 'note', title: 'Qué es y qué no es', text: 'Es un filtro de **heurísticas + aprendizaje por usuario** con autenticación SPF/DKIM/DMARC, no un servicio de reputación externa ni un antivirus (para adjuntos ver [Seguridad](/docs/security#attachments)). Las cifras de esta página se midieron sobre un **corpus sintético** escrito por el autor del motor: sirven para comparar niveles y detectar regresiones, no son una tasa de error en producción.' },

        { t: 'h2', id: 'flow', text: 'Qué ocurre al llegar un correo' },
        { t: 'ol', items: [
            '**Blocklist («ni entra»)**: antes de guardar nada se comprueban el remitente del sobre (Return-Path), el `From` y el dominio de la firma DKIM contra la lista de bloqueo del dominio y la personal de cada destinatario. Si acierta: no se guarda el correo (ni cuerpo, ni adjuntos, ni el crudo), se responde `200` al proveedor para que no reintente, no se genera rebote (evita *backscatter*), se cuenta el acierto y se anota un evento **sin contenido**. El correo de la propia organización nunca se bloquea por lista.',
            '**Motor v2** por destinatario: señales de autenticación, cabeceras, contenido, enlaces, adjuntos y suplantación + contexto del buzón (contactos, hilos propios, historial) + aprendizaje del usuario.',
            '**Lista de permitidos**: entrega normal, salvo que falle la autenticación alineada (se marca *posible suplantación*) o haya un adjunto peligroso (se trata igual).',
            '**Decisión por banda**: entregar, entregar con advertencia o carpeta Spam. Se guarda `spamScore`, el veredicto con los motivos (≤ 2 KB) y si es externo; las reglas v2 pueden leer `spamScore` e `isExternal`.',
        ] },
        { t: 'p', text: 'Si el motor v2, la configuración o las tablas fallan, el correo **nunca se pierde**: se cae al comportamiento anterior (cabeceras `X-Spam-*` del origen y `SPAM_SCORE_THRESHOLD`). Las importaciones de buzón y otras ingestas internas **no** pasan por este filtro.' },

        { t: 'h2', id: 'signals', text: 'Señales y pesos' },
        { t: 'p', text: 'Pesos base (antes del multiplicador de familia). Cada familia tiene un **tope** de puntos positivos para que una sola no baste por sí sola, y el contexto solo **resta** (suelo −40, y se recorta al 40 % si hay una señal grave: una cuenta conocida comprometida sigue siendo peligrosa). Varias familias independientes que coinciden suman un refuerzo (+8 con 3, +14 con 4).' },
        { t: 'table', head: ['Familia', 'Tope', 'Señales (peso)'], rows: [
            ['Autenticación', '55', 'DMARC fail (30), SPF fail (18), DKIM fail (18), SPF softfail (8), sin resultados (8), sin alineación (10), ARC fail (8), sin cabecera de autenticación (6); resta: DMARC pass (−6, no en correo gratuito), ARC válido en reenvío (−8)'],
            ['Cabeceras', '40', 'Message-ID ausente (8) o de otro dominio (3), fecha ausente (6) / futura (8), Reply-To de otro dominio (8), sobre ≠ From (3), Received con IP literal (5) / anómalo (4), X-Mailer de envío masivo (8), TLD de riesgo en el remitente (14), ≥ 20 / ≥ 50 destinatarios (6 / 12), *bulk* sin baja (6); resta: List-Unsubscribe (−5, marca «promocional»)'],
            ['Contenido', '60', 'Léxico es/en/pt por categoría: phishing (tope 34), estafa/premio (46), cripto (34), factura/envío falsos (24), farmacia (34), adultos (30), apuestas (26), préstamos (20), marketing agresivo (18), urgencia (8), fraude del director (30); densidad de frases (6/12/18), mayúsculas y `!!!`, texto oculto (12), solo imagen (10), base64 enorme (8), homoglifos (14), ancho cero (8), texto partido (8), asunto codificado (5), HTML roto (5), solo un enlace (6)'],
            ['Enlaces', '55', 'Host IP (22), homógrafo IDN (20) / punycode (8), dominio parecido a una marca (20), texto≠destino (18; 4 si es un rastreador conocido), credenciales embebidas (16), TLD de riesgo (12), puerto raro (8), acortadores (4–8), demasiados enlaces (5–10), redirección larga (5)'],
            ['Adjuntos', '60', 'Ejecutable o peligroso por contenido (55), macros (28), HTML/SVG (22), doble extensión (22), comprimido con contraseña citada en el cuerpo (28), comprimido (6), tipo real distinto del declarado (8)'],
            ['Suplantación', '60', 'Nombre de marca con dominio ajeno (28 + 10 sin autenticación), dominio parecido a una marca (30), dominio de marca con autenticación fallida (20), dominio propio falsificado (30), nombre con otra dirección (22; 32 si es la propia) o dominio (15; 25), rol de organización en cuenta gratuita (14), permitido pero suplantado (40)'],
            ['Origen', '50', '`X-Spam-Flag/Status/Score` del proveedor como una señal más (30–45)'],
            ['Contexto', '−40', 'Remitente en contactos (−25), ya le respondiste (−20), responde a un mensaje tuyo (−25), historial legítimo (hasta −20); historial de spam (hasta +25); primera vez solo suma (+4/+7) cuando ya hay otras señales'],
            ['Aprendizaje', '±20', 'Clasificador bayesiano por usuario (ver más abajo)'],
        ] },
        { t: 'p', text: 'Las marcas vigiladas (PayPal, Microsoft, Google, Apple, Amazon, bancos, transportistas, etc.) se detectan en el **nombre visible** solo si coincide con la marca o con «marca + palabra de servicio» (p. ej. «PayPal Seguridad»), para no marcar «Apple Valley Dental». Los parecidos usan distancia de edición 1–2 sobre etiquetas de ≥ 6 letras, plegado de leet (`paypa1`) y homoglifos.' },

        { t: 'h2', id: 'levels', text: 'Niveles, bandas y acciones' },
        { t: 'table', head: ['Nivel', 'Umbral', 'Uso'], rows: [
            ['Desactivado', '—', 'No puntúa (la lista de bloqueo sigue funcionando)'],
            ['Bajo', '80', 'Casi sin falsos positivos; deja pasar spam dudoso'],
            ['Equilibrado (por defecto)', '65', 'Punto de partida recomendado'],
            ['Estricto', '50', 'Buzones con mucho spam'],
            ['Máximo', '35', 'Solo si aceptas revisar la carpeta Spam a menudo'],
            ['Personalizado', '1–100', 'Umbral numérico avanzado (también lo usa `SPAM_SCORE_THRESHOLD` si no hay configuración guardada)'],
        ] },
        { t: 'p', text: 'Tres **bandas**: *limpio* (< umbral − 15), *sospechoso* (entre umbral − 15 y umbral) y *spam* (≥ umbral). Acción por banda: **entrega normal**, **entrega con advertencia** (banner «Por qué» en el lector) o **carpeta Spam**. «Rechazar» **no existe por puntuación**: solo la lista de bloqueo explícita impide que un correo entre. Si el dominio lo permite, cada usuario puede mover el umbral ±1 nivel (±10 puntos).' },
        { t: 'p', text: 'Medido sobre el corpus sintético (385 legítimos, 410 spam/phishing; es/en/pt) con el contexto del buzón:' },
        { t: 'table', head: ['Nivel', 'Falsos positivos', 'Detección (carpeta Spam)', 'Detección incl. sospechosos'], rows: [
            ['Bajo (80)', '0 %', '69,5 %', '90,5 %'],
            ['Equilibrado (65)', '0 %', '90,5 %', '96,8 %'],
            ['Estricto (50)', '0 %', '96,8 %', '99,8 %'],
            ['Máximo (35)', '2,1 %', '99,8 %', '100 %'],
        ] },
        { t: 'p', text: 'Sin ningún contexto del destinatario (peor caso), Equilibrado baja al 80,7 % con 0 % de falsos positivos. El spam **difícil** (autenticación válida desde dominios desechables, textos mínimos, ofuscación) se detecta menos: es la razón de la banda sospechosa y del aprendizaje.' },

        { t: 'h2', id: 'lists', text: 'Listas de bloqueo y permitidos' },
        { t: 'ul', items: [
            '**Tipos**: dirección exacta, dominio (con opción de subdominios), comodín `*@dominio`, TLD y **expresión regular acotada** (la misma defensa que las reglas: sin cuantificadores anidados, sin referencias hacia atrás ni *lookaround*, ≤ 200 caracteres) evaluada sobre la dirección completa.',
            '**Campos**: motivo, caducidad opcional, contador de aciertos y último acierto. Tope **10 000 entradas por lista** (2 000 en la whitelist de externos), con validación y deduplicado atómico (índice único), también con altas concurrentes.',
            '**Importar / exportar CSV** (`type,value,include_subdomains,reason,expires_at`; ≤ 2 MB y 10 000 filas; el informe indica la línea de cada error; la exportación neutraliza fórmulas de hoja de cálculo).',
            '**Guardas**: no se puede bloquear el propio dominio de la instancia (ni un padre con subdominios, ni un TLD o regex que lo cubra) ni las direcciones de los administradores (`ADMIN_EMAILS`).',
            '**Permitidos no eluden la seguridad**: si un remitente permitido falla DMARC/DKIM alineados se marca *posible suplantación* y se trata como sospechoso; los adjuntos peligrosos se bloquean igual.',
        ] },

        { t: 'h2', id: 'learning', text: 'Aprendizaje por usuario' },
        { t: 'p', text: 'Las acciones **Es spam** / **No es spam** se enganchan **en el servidor** (al mover a o desde la carpeta Spam, sea cual sea la interfaz) y alimentan un clasificador bayesiano ligero: tokens del asunto, la vista previa y el dominio del remitente, hash truncado de 32 bits, suavizado de Laplace y combinación por log-odds de los 15 términos más informativos. La contribución al score está **acotada a ±20** y solo cuenta con **≥ 8 marcas** y ≥ 3 términos conocidos. El modelo guarda **5 000 tokens por usuario** (expulsión LRU). Además se llevan contadores por remitente y dominio (spam / legítimo) que ajustan la confianza.' },
        { t: 'p', text: 'En *Ajustes → Spam* el usuario puede desactivar «Aprender de mis marcas» (activado por defecto) y **borrar lo aprendido**. Las marcas no leen el cuerpo completo (viven en el almacenamiento de objetos): usan asunto y vista previa, por eso el modelo es deliberadamente conservador.' },

        { t: 'h2', id: 'external', text: 'Correos externos' },
        { t: 'p', text: 'Se consideran **internos** los dominios propios (`TOP_DOMAIN` y el host de `NEXT_PUBLIC_APP_URL`), los «dominios internos adicionales» que añada el administrador y el dominio del destinatario. El resto son **externos**, salvo los de una whitelist propia de confiables (dominio y personal). Política (todo opcional): aviso en el lector (estilo información o advertencia, texto propio por idioma, plano y saneado), insignia «Externo» en la lista, etiqueta `[EXTERNO]` **solo visual** en el asunto de la lista (nunca se modifica el asunto guardado), aviso reforzado cuando el nombre visible coincide con un compañero o con el dominio propio pero la dirección es externa (la whitelist **no** lo silencia), aviso de primera vez, confirmación antes de abrir enlaces a un dominio distinto del remitente y aviso antes de descargar adjuntos. En hilos el aviso sale por mensaje y se puede cerrar por mensaje.' },

        { t: 'h2', id: 'console', text: 'Consola: /admin/spam' },
        { t: 'table', head: ['Pestaña', 'Qué hace'], rows: [
            ['Nivel de filtrado', 'Presets, umbral, acción por banda, multiplicador 0–2 por familia, interruptores del motor y **vista previa**: «con este ajuste, de tus últimos 200 correos evaluados X habrían ido a spam» (usa las señales guardadas, no relee cuerpos)'],
            ['Bloqueados / Permitidos', 'Tablas con búsqueda, filtros, orden, paginación, alta, borrado, CSV y contador frente al tope'],
            ['Correos externos', 'Política, textos, dominios internos adicionales y whitelist'],
            ['Registro', 'Decisiones (entregado / advertencia / spam / bloqueado / «No es spam» / marcado) con puntuación y motivos, sin contenido. Retención configurable (30 días por defecto)'],
            ['Probar', 'Pega cabeceras y texto (o elige un correo **propio**) y ve la puntuación por señal, sin guardar nada ni contar aciertos'],
            ['Estadísticas', 'Spam, bloqueados, advertencias y externos por día, principales dominios y falsos positivos reportados'],
        ] },
        { t: 'p', text: 'Todas las rutas `/api/admin/spam/**` pasan por `requireAdmin`, limitan la tasa de peticiones, validan con esquemas estrictos (400 sin repetir lo recibido) y auditan los cambios (`admin.spam.*`). La configuración es `AdminSetting` `spamConfig` (JSON versionado y saneado) con caché de ≤ 30 s e invalidación por versión en la base de datos, como la cuota; las instancias ven un cambio en ≤ 5 s.' },

        { t: 'h2', id: 'data', text: 'Datos' },
        { t: 'p', text: 'Tablas aditivas creadas por `npm run db:ensure` (`IF NOT EXISTS`); sin ellas todo cae al comportamiento anterior.' },
        { t: 'table', head: ['Objeto', 'Contenido'], rows: [
            ['`SpamList`', 'Listas: `scope` (`domain`/`user`), `ownerKey`, `kind` (`allow`/`block`/`external`), `matchType`, `value`, `includeSubdomains`, `reason`, `expiresAt`, `createdBy`, `hits`, `lastHitAt`; índice único contra duplicados'],
            ['`SpamToken`', 'Modelo bayesiano: `userId`, `tokenHash`, `spam`, `ham`, `updatedAt`; la fila `__n` guarda los contadores de mensajes'],
            ['`SpamSender`', 'Contadores de marcas por remitente (`e:dirección`) y dominio (`d:dominio`)'],
            ['`SpamEvent`', 'Registro sin contenido: remitente, destinatario, decisión, puntuación, regla y motivos (ids)'],
            ['`Email.spamScore`, `Email.spamReasons`, `Email.isExternal`', 'Columnas aditivas (SQL crudo): puntuación, veredicto ≤ 2 KB e indicador de externo'],
        ] },

        { t: 'h2', id: 'tuning', text: 'Cómo afinar' },
        { t: 'ol', items: [
            'Empieza en **Equilibrado** y revisa una semana el **Registro** y la carpeta Spam de un par de buzones.',
            'Si se cuelan correos: sube a **Estricto** o, mejor, bloquea el dominio/TLD concreto; prueba antes con **Probar** y la **vista previa**.',
            'Si caen legítimos: añádelos a **Permitidos** (no eluden la suplantación) o baja a **Bajo**; pide a los usuarios pulsar **No es spam** (enseña al modelo).',
            'Usa la banda sospechosa con **advertencia** para no perder nada mientras calibras.',
            'Ajusta un multiplicador de familia solo si ves un patrón (p. ej. `content` a 0,5 si tus propios boletines puntúan alto).',
        ] },

        { t: 'h2', id: 'limits', text: 'Límites conocidos' },
        { t: 'ul', items: [
            'La evaluación usa las cabeceras que entrega el webhook (y las que aporta la API de recepción de Resend); si ninguna trae `Authentication-Results`, no hay señales de autenticación (solo `auth.none`).',
            'El contenido se analiza sobre el texto/HTML que recibe el webhook; los adjuntos grandes se descargan de forma asíncrona, así que su **contenido** lo valida el antivirus opcional y el validador de tipo, no el motor (sí se puntúan nombre y extensión).',
            'El aprendizaje usa asunto y vista previa (no el cuerpo completo) y necesita marcas propias del usuario para tener efecto.',
            'Las listas por regex se evalúan sobre la dirección, no sobre el asunto ni el cuerpo.',
            'No hay reputación global de IP/dominio ni consultas DNSBL (no se contacta con servicios externos).',
        ] },
    ],
    en: [
        { t: 'p', text: 'BloomX classifies incoming mail with an **explainable spam engine**: the score (0–100) is the **weighted sum of signals**, and every signal has an identifier, a weight and a human-readable reason in Spanish and English. The administrator chooses the **filtering level**, the block and allow **lists** and the **external mail policy** from `/admin/spam`; each user can fine-tune it in *Settings → Spam*.' },
        { t: 'callout', kind: 'note', title: 'What it is and what it is not', text: 'It is a **heuristics + per-user learning** filter with SPF/DKIM/DMARC authentication, not an external reputation service or an antivirus (see [Security](/docs/security#attachments) for attachments). The numbers on this page were measured on a **synthetic corpus** written by the engine\'s author: they are for comparing levels and catching regressions, not a production error rate.' },

        { t: 'h2', id: 'flow', text: 'What happens when a message arrives' },
        { t: 'ol', items: [
            '**Blocklist ("never enters")**: before anything is stored, the envelope sender (Return-Path), the `From` and the DKIM signing domain are checked against the domain blocklist and each recipient\'s personal one. On a hit: the message is not stored (no body, no attachments, no raw copy), the provider gets `200` so it does not retry, no bounce is generated (avoids *backscatter*), the hit is counted and a **content-free** event is logged. Mail from your own organization is never blocked by a list.',
            '**Engine v2** per recipient: authentication, header, content, link, attachment and impersonation signals + mailbox context (contacts, own threads, history) + the user\'s learning.',
            '**Allow list**: normal delivery, unless aligned authentication fails (flagged *possible spoofing*) or there is a dangerous attachment (handled the same).',
            '**Decision per band**: deliver, deliver with a warning or Spam folder. `spamScore`, the verdict with its reasons (≤ 2 KB) and the external flag are stored; v2 rules can read `spamScore` and `isExternal`.',
        ] },
        { t: 'p', text: 'If engine v2, the configuration or the tables fail, mail is **never lost**: it falls back to the previous behavior (origin `X-Spam-*` headers and `SPAM_SCORE_THRESHOLD`). Mailbox imports and other internal ingestion **do not** go through this filter.' },

        { t: 'h2', id: 'signals', text: 'Signals and weights' },
        { t: 'p', text: 'Base weights (before the family multiplier). Each family has a **cap** on positive points so no single one suffices on its own, and context only **subtracts** (floor −40, cut to 40 % when a serious signal is present: a known compromised account is still dangerous). Several independent families agreeing add a boost (+8 with 3, +14 with 4).' },
        { t: 'table', head: ['Family', 'Cap', 'Signals (weight)'], rows: [
            ['Authentication', '55', 'DMARC fail (30), SPF fail (18), DKIM fail (18), SPF softfail (8), no results (8), not aligned (10), ARC fail (8), no authentication header (6); subtracts: DMARC pass (−6, not for free mail), valid ARC on a forward (−8)'],
            ['Headers', '40', 'Message-ID missing (8) or from another domain (3), date missing (6) / future (8), Reply-To on another domain (8), envelope ≠ From (3), Received with literal IP (5) / anomalous (4), bulk-mailer X-Mailer (8), risky TLD on the sender (14), ≥ 20 / ≥ 50 recipients (6 / 12), bulk without unsubscribe (6); subtracts: List-Unsubscribe (−5, marks "promotional")'],
            ['Content', '60', 'es/en/pt lexicon by category: phishing (cap 34), scam/prize (46), crypto (34), fake invoice/shipping (24), pharma (34), adult (30), gambling (26), loans (20), aggressive marketing (18), urgency (8), CEO fraud (30); phrase density (6/12/18), capitals and `!!!`, hidden text (12), image only (10), huge base64 (8), homoglyphs (14), zero-width (8), split text (8), encoded subject (5), broken HTML (5), link only (6)'],
            ['Links', '55', 'IP host (22), IDN homograph (20) / punycode (8), brand look-alike domain (20), text≠target (18; 4 for a known tracker), embedded credentials (16), risky TLD (12), odd port (8), shorteners (4–8), too many links (5–10), long redirect (5)'],
            ['Attachments', '60', 'Executable or dangerous by content (55), macros (28), HTML/SVG (22), double extension (22), archive with its password quoted in the body (28), archive (6), real type differs from declared (8)'],
            ['Impersonation', '60', 'Brand name with a foreign domain (28 + 10 without authentication), brand look-alike domain (30), brand domain with failed authentication (20), forged own domain (30), name showing another address (22; 32 if it is your own) or domain (15; 25), organization role on a free account (14), allowed but spoofed (40)'],
            ['Origin', '50', 'Provider `X-Spam-Flag/Status/Score` as one more signal (30–45)'],
            ['Context', '−40', 'Sender in contacts (−25), you replied before (−20), replies to your message (−25), legitimate history (up to −20); spam history (up to +25); first time only adds (+4/+7) when other signals exist'],
            ['Learning', '±20', 'Per-user Bayesian classifier (below)'],
        ] },
        { t: 'p', text: 'Watched brands (PayPal, Microsoft, Google, Apple, Amazon, banks, carriers, etc.) are matched in the **display name** only when it equals the brand or "brand + service word" (e.g. "PayPal Security"), so "Apple Valley Dental" is not flagged. Look-alikes use edit distance 1–2 on labels of ≥ 6 letters, leet folding (`paypa1`) and homoglyphs.' },

        { t: 'h2', id: 'levels', text: 'Levels, bands and actions' },
        { t: 'table', head: ['Level', 'Threshold', 'Use'], rows: [
            ['Off', '—', 'No scoring (the blocklist still works)'],
            ['Low', '80', 'Almost no false positives; lets doubtful spam through'],
            ['Balanced (default)', '65', 'Recommended starting point'],
            ['Strict', '50', 'Mailboxes with a lot of spam'],
            ['Maximum', '35', 'Only if you accept checking the Spam folder often'],
            ['Custom', '1–100', 'Advanced numeric threshold (also used by `SPAM_SCORE_THRESHOLD` when nothing is saved)'],
        ] },
        { t: 'p', text: 'Three **bands**: *clean* (< threshold − 15), *suspicious* (between threshold − 15 and threshold) and *spam* (≥ threshold). Action per band: **normal delivery**, **delivery with a warning** ("Why" banner in the reader) or **Spam folder**. "Reject" **does not exist for scores**: only the explicit blocklist keeps a message from entering. If the domain allows it, each user can move the threshold ±1 level (±10 points).' },
        { t: 'p', text: 'Measured on the synthetic corpus (385 legitimate, 410 spam/phishing; es/en/pt) with mailbox context:' },
        { t: 'table', head: ['Level', 'False positives', 'Detection (Spam folder)', 'Detection incl. suspicious'], rows: [
            ['Low (80)', '0 %', '69.5 %', '90.5 %'],
            ['Balanced (65)', '0 %', '90.5 %', '96.8 %'],
            ['Strict (50)', '0 %', '96.8 %', '99.8 %'],
            ['Maximum (35)', '2.1 %', '99.8 %', '100 %'],
        ] },
        { t: 'p', text: 'With no recipient context at all (worst case), Balanced drops to 80.7 % with 0 % false positives. **Hard** spam (valid authentication from disposable domains, minimal text, obfuscation) is detected less often: that is the reason for the suspicious band and for learning.' },

        { t: 'h2', id: 'lists', text: 'Block and allow lists' },
        { t: 'ul', items: [
            '**Types**: exact address, domain (with a subdomains option), `*@domain` wildcard, TLD and a **bounded regular expression** (same defenses as rules: no nested quantifiers, backreferences or lookaround, ≤ 200 characters) matched against the full address.',
            '**Fields**: reason, optional expiry, hit counter and last hit. Cap of **10,000 entries per list** (2,000 for the external whitelist), with validation and atomic de-duplication (unique index), also under concurrent inserts.',
            '**CSV import / export** (`type,value,include_subdomains,reason,expires_at`; ≤ 2 MB and 10,000 rows; the report gives the line of each error; export neutralizes spreadsheet formulas).',
            '**Guards**: you cannot block the instance\'s own domain (nor a parent with subdomains, nor a TLD or regex covering it) or the administrators\' addresses (`ADMIN_EMAILS`).',
            '**Allowed does not bypass security**: if an allowed sender fails aligned DMARC/DKIM it is flagged *possible spoofing* and treated as suspicious; dangerous attachments are blocked all the same.',
        ] },

        { t: 'h2', id: 'learning', text: 'Per-user learning' },
        { t: 'p', text: 'The **Spam** / **Not spam** actions hook in **on the server** (when moving to or from the Spam folder, whatever the UI) and feed a lightweight Bayesian classifier: tokens from the subject, the preview and the sender domain, 32-bit truncated hash, Laplace smoothing and log-odds combination of the 15 most informative terms. Its contribution to the score is **bounded to ±20** and only counts with **≥ 8 marks** and ≥ 3 known terms. The model keeps **5,000 tokens per user** (LRU eviction). Per-sender and per-domain counters (spam / legitimate) also adjust confidence.' },
        { t: 'p', text: 'In *Settings → Spam* the user can turn "Learn from my marks" off (on by default) and **delete what was learned**. Marks do not read the full body (it lives in object storage): they use subject and preview, which is why the model is deliberately conservative.' },

        { t: 'h2', id: 'external', text: 'External mail' },
        { t: 'p', text: '**Internal** domains are your own (`TOP_DOMAIN` and the host of `NEXT_PUBLIC_APP_URL`), the "additional internal domains" the administrator adds and the recipient\'s domain. Everything else is **external**, except senders on your own trusted whitelist (domain and personal). Policy (all optional): a reader warning (info or warning style, your own text per language, plain and sanitized), an "External" badge in the list, a `[EXTERNAL]` tag that is **display-only** in the list subject (the stored subject is never changed), a reinforced warning when the display name matches a colleague or your own domain but the address is external (the whitelist does **not** silence it), a first-time notice, confirmation before opening links to a domain different from the sender and a notice before downloading attachments. In threads the notice appears per message and can be dismissed per message.' },

        { t: 'h2', id: 'console', text: 'Console: /admin/spam' },
        { t: 'table', head: ['Tab', 'What it does'], rows: [
            ['Filtering level', 'Presets, threshold, action per band, 0–2 multiplier per family, engine switches and a **preview**: "with this setting, of your last 200 evaluated messages X would have gone to spam" (uses the stored signals, does not re-read bodies)'],
            ['Blocked / Allowed', 'Tables with search, filters, sorting, pagination, add, delete, CSV and a counter against the cap'],
            ['External mail', 'Policy, texts, additional internal domains and the whitelist'],
            ['Log', 'Decisions (delivered / warned / spam / blocked / "Not spam" / marked) with score and reasons, content-free. Configurable retention (30 days by default)'],
            ['Test', 'Paste headers and text (or pick one of **your own** messages) and see the per-signal score, without saving anything or counting list hits'],
            ['Statistics', 'Spam, blocked, warned and external per day, top domains and reported false positives'],
        ] },
        { t: 'p', text: 'All `/api/admin/spam/**` routes go through `requireAdmin`, rate-limit requests, validate with strict schemas (400 without echoing what was received) and audit changes (`admin.spam.*`). The configuration is `AdminSetting` `spamConfig` (versioned, sanitized JSON) cached for ≤ 30 s with invalidation by a database version, like the quota; instances see a change within 5 s.' },

        { t: 'h2', id: 'data', text: 'Data' },
        { t: 'p', text: 'Additive tables created by `npm run db:ensure` (`IF NOT EXISTS`); without them everything falls back to the previous behavior.' },
        { t: 'table', head: ['Object', 'Content'], rows: [
            ['`SpamList`', 'Lists: `scope` (`domain`/`user`), `ownerKey`, `kind` (`allow`/`block`/`external`), `matchType`, `value`, `includeSubdomains`, `reason`, `expiresAt`, `createdBy`, `hits`, `lastHitAt`; unique index against duplicates'],
            ['`SpamToken`', 'Bayesian model: `userId`, `tokenHash`, `spam`, `ham`, `updatedAt`; the `__n` row holds the message counters'],
            ['`SpamSender`', 'Mark counters per sender (`e:address`) and domain (`d:domain`)'],
            ['`SpamEvent`', 'Content-free log: sender, recipient, decision, score, rule and reasons (ids)'],
            ['`Email.spamScore`, `Email.spamReasons`, `Email.isExternal`', 'Additive columns (raw SQL): score, verdict ≤ 2 KB and external flag'],
        ] },

        { t: 'h2', id: 'tuning', text: 'How to tune it' },
        { t: 'ol', items: [
            'Start at **Balanced** and review the **Log** and the Spam folder of a couple of mailboxes for a week.',
            'If messages slip through: move up to **Strict** or, better, block the specific domain/TLD; try it first with **Test** and the **preview**.',
            'If legitimate mail lands there: add it to **Allowed** (it does not bypass spoofing checks) or drop to **Low**; ask users to press **Not spam** (it teaches the model).',
            'Use the suspicious band with a **warning** so nothing is lost while you calibrate.',
            'Adjust a family multiplier only if you see a pattern (e.g. `content` at 0.5 if your own newsletters score high).',
        ] },

        { t: 'h2', id: 'limits', text: 'Known limits' },
        { t: 'ul', items: [
            'Evaluation uses the headers the webhook delivers (and those the Resend receiving API adds); if none carries `Authentication-Results`, there are no authentication signals (only `auth.none`).',
            'Content is analyzed on the text/HTML the webhook receives; large attachments are downloaded asynchronously, so their **content** is checked by the optional antivirus and the type validator, not the engine (name and extension are scored).',
            'Learning uses subject and preview (not the full body) and needs the user\'s own marks to have any effect.',
            'Regex lists match the address, not the subject or body.',
            'There is no global IP/domain reputation or DNSBL lookup (no external service is contacted).',
        ] },
    ],
};

export default page;
