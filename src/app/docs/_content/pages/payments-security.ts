import type { Block, DocPageContent } from '../types';

/** Modelo de amenazas STRIDE de pagos y marketplace + tabla de cumplimiento. Bilingue; un test valida enlaces, anclas y paridad es/en. */

type Lang = 'es' | 'en';
const T = (lang: Lang, es: string, en: string): string => (lang === 'es' ? es : en);

const P = 'bloomx-backend/src/lib/payments/';
const M = 'bloomx-backend/src/lib/marketplace/';

const stride = (lang: Lang): { head: string[]; rows: Record<string, string[][]> } => {
    const head = [T(lang, 'Amenaza', 'Threat'), T(lang, 'Mitigación real', 'Actual mitigation'), T(lang, 'Dónde', 'Where')];
    return {
        head,
        rows: {
            orders: [
                [T(lang, 'S: un dominio sin identidad compra o ve órdenes ajenas', 'S: a domain without identity buys or sees others\' orders'), T(lang, 'Solo dominios firmados Ed25519; modo legado recibe 403 `signature_required`. Dominio y usuario salen de la firma, no del cuerpo. Una orden ajena responde 404 indistinguible de inexistente.', 'Only Ed25519-signed domains; legacy mode gets 403 `signature_required`. Domain and user come from the signature, not the body. Someone else\'s order answers 404, indistinguishable from nonexistent.'), '`route-auth.ts`, `orders.ts`'],
                [T(lang, 'T: manipular el importe o el reparto', 'T: tamper with amount or split'), T(lang, 'El cliente solo envía `extensionId`; el importe sale de la BD y el reparto se calcula con enteros (`floor`, BigInt).', 'The client only sends `extensionId`; the amount comes from the DB and the split uses integers (`floor`, BigInt).'), '`orders.ts`, `split.ts`'],
                [T(lang, 'T/R: crear la misma orden dos veces', 'T/R: create the same order twice'), T(lang, '`PayPal-Request-Id` idempotente en cada POST; `providerOrderId` UNIQUE.', 'Idempotent `PayPal-Request-Id` on every POST; `providerOrderId` UNIQUE.'), '`paypal.ts`, `ddl.ts`'],
                [T(lang, 'D: inundar la creación de órdenes', 'D: flood order creation'), T(lang, 'Rate limit por dominio, cuerpo JSON acotado y timeout/reintentos acotados hacia PayPal.', 'Per-domain rate limit, bounded JSON body and bounded timeout/retries towards PayPal.'), '`handler.ts`, `paypal.ts`'],
                [T(lang, 'E: llegar a la ruta sin ser dueño nivel 4', 'E: reach the route without being a level-4 owner'), T(lang, 'La instancia exige nivel 4 y step-up antes de firmar; el backend solo confía en lo firmado por la clave del dominio.', 'The instance requires level 4 and step-up before signing; the backend trusts only what the domain key signs.'), '`route-auth.ts`'],
            ],
            capture: [
                [T(lang, 'T: capturar dos veces o conceder sin pagar', 'T: capture twice or grant without paying'), T(lang, 'Claim atómico `UPDATE` condicional CREATED/APPROVED a CAPTURED; asientos idempotentes por `refKey`; `providerCaptureId` UNIQUE. Nunca se concede sin captura COMPLETED confirmada.', 'Atomic conditional `UPDATE` CREATED/APPROVED to CAPTURED; ledger entries idempotent by `refKey`; `providerCaptureId` UNIQUE. Nothing is granted without a confirmed COMPLETED capture.'), '`orders.ts`, `ledger.ts`'],
                [T(lang, 'R: negar un cobro o disputar', 'R: deny a charge or dispute'), T(lang, 'Libro mayor solo-INSERT (trigger bloquea UPDATE/DELETE) y `PaymentAudit` insert-only, sin PII.', 'Insert-only ledger (trigger blocks UPDATE/DELETE) and insert-only `PaymentAudit`, without PII.'), '`ddl.ts`, `audit.ts`'],
                [T(lang, 'D: captura perdida si cae el retorno', 'D: lost capture if the return fails'), T(lang, 'El webhook y la conciliación (cron) terminan las capturas pendientes.', 'The webhook and reconciliation (cron) finish pending captures.'), '`reconcile.ts`'],
            ],
            webhook: [
                [T(lang, 'S: evento falso', 'S: forged event'), T(lang, '`verify-webhook-signature` obligatorio con `PAYPAL_WEBHOOK_ID`; sin verificación válida 401; sin credenciales 503. Se rechaza un `cert_url` ajeno.', 'Mandatory `verify-webhook-signature` with `PAYPAL_WEBHOOK_ID`; no valid verification gives 401; no credentials gives 503. A foreign `cert_url` is rejected.'), '`webhook.ts`, `paypal.ts`'],
                [T(lang, 'T: importes falsos en el evento', 'T: false amounts in the event'), T(lang, 'Importes y estados NO se toman del evento: se reconsulta a PayPal (orden, captura, reembolso) y se compara con la BD.', 'Amounts and states are NOT taken from the event: PayPal is re-queried (order, capture, refund) and compared with the DB.'), '`webhook.ts`'],
                [T(lang, 'T: repetición (replay)', 'T: replay'), T(lang, 'Dedupe por id de evento (`PaymentEvent`, PK `eventId`); edad máxima del evento; transiciones idempotentes y tolerantes al desorden.', 'Dedupe by event id (`PaymentEvent`, PK `eventId`); maximum event age; idempotent, order-tolerant transitions.'), '`webhook.ts`, `ddl.ts`'],
                [T(lang, 'I: payload guardado', 'I: stored payload'), T(lang, 'Solo se guardan id, tipo, id de recurso y hash; nunca el cuerpo.', 'Only id, type, resource id and hash are stored; never the body.'), '`webhook.ts`'],
                [T(lang, 'D: cuerpo enorme', 'D: huge body'), T(lang, 'Límite de 256 KiB.', '256 KiB limit.'), '`webhook.ts`'],
            ],
            oidc: [
                [T(lang, 'S/T: CSRF o inyección de código en el vínculo', 'S/T: CSRF or code injection in the link'), T(lang, '`state` de un solo uso (se guarda su hash, reclamo atómico, caduca en 10 min), nonce y PKCE S256 de nuestra parte; `redirect_uri` fija de configuración, jamás de la petición.', 'Single-use `state` (hash stored, atomic claim, expires in 10 min), nonce and our-side PKCE S256; fixed `redirect_uri` from configuration, never from the request.'), '`account.ts`'],
                [T(lang, 'T: redirección abierta tras el login', 'T: open redirect after login'), T(lang, '`returnTo` es el origen firmado del dominio fijado al iniciar; nada del callback decide el destino. Sin `state` válido el callback nunca redirige.', '`returnTo` is the domain\'s signed origin fixed at start; nothing from the callback decides the destination. Without a valid `state` the callback never redirects.'), '`account.ts`'],
                [T(lang, 'I: robo de tokens', 'I: token theft'), T(lang, 'Los tokens se descartan al instante; solo se guardan payer_id y correo verificado.', 'Tokens are discarded immediately; only payer_id and verified email are stored.'), '`account.ts`'],
                [T(lang, 'E: secuestro de sesión para desviar pagos', 'E: session hijack to divert payouts'), T(lang, 'Cambiar de cuenta exige step-up, avisa por correo al dueño y a los super admins y los pagos pendientes siguen a la cuenta anterior 24 h.', 'Changing account requires step-up, emails the owner and super admins, and pending payouts follow the previous account for 24 h.'), '`account.ts`'],
            ],
            payouts: [
                [T(lang, 'T/R: pago duplicado', 'T/R: duplicate payout'), T(lang, 'Bloqueo consultivo de Postgres por desarrollador; `Payout` READY y asiento negativo en la misma transacción; `sender_batch_id` = id del Payout (idempotente en PayPal).', 'Postgres advisory lock per developer; READY `Payout` and negative entry in the same transaction; `sender_batch_id` = Payout id (idempotent on PayPal).'), '`payouts.ts`'],
                [T(lang, 'T: pagar de más tras un reembolso', 'T: overpay after a refund'), T(lang, 'Se paga el saldo NETO; un saldo negativo se compensa en el siguiente pago; el fallo de un payout se repone con un `ADJUSTMENT`, nunca editando asientos.', 'The NET balance is paid; a negative balance is offset on the next payout; a payout failure is restored with an `ADJUSTMENT`, never by editing entries.'), '`payouts.ts`, `ledger.ts`'],
                [T(lang, 'D/I: pago ejecutado por un tercero', 'D/I: payout triggered by a third party'), T(lang, 'El cron exige `PAYMENTS_CRON_SECRET` (mínimo 24 caracteres) comparado en tiempo constante.', 'The cron requires `PAYMENTS_CRON_SECRET` (at least 24 characters) compared in constant time.'), '`bloomx-backend/src/app/api/cron/payments/route.ts`'],
            ],
            subscriptions: [
                [T(lang, 'T: cambiar el precio de un suscriptor sin su consentimiento', 'T: change a subscriber\'s price without consent'), T(lang, 'Planes de PayPal inmutables; el suscriptor conserva su precio hasta aprobar el nuevo en PayPal.', 'Immutable PayPal plans; the subscriber keeps their price until approving the new one on PayPal.'), '`subscriptions.ts`, `pricing-store.ts`'],
                [T(lang, 'T: evento de suscripción manipulado', 'T: manipulated subscription event'), T(lang, 'El importe esperado sale de `Subscription.priceCents`, no del evento; el estado se repara con conciliación periódica.', 'The expected amount comes from `Subscription.priceCents`, not the event; state is repaired by periodic reconciliation.'), '`subscriptions.ts`'],
                [T(lang, 'E: acceso sin pagar', 'E: access without paying'), T(lang, 'Derecho solo en TRIAL/ACTIVE, gracia de 3 días tras un fallo, o hasta el fin del periodo pagado si se cancela; luego la extensión se pausa.', 'Entitlement only in TRIAL/ACTIVE, 3-day grace after a failure, or until the end of the paid period if cancelled; then the extension is paused.'), '`subscriptions.ts`, `licensing.ts`'],
            ],
            marketplace: [
                [T(lang, 'S: suplantar a otro editor o a la plataforma', 'S: impersonate another publisher or the platform'), T(lang, 'Id `dev.<slug>.<nombre>` con el slug del dominio firmado; `core-*` y reservados prohibidos; la primera submission fija la propiedad (409 `extension_id_taken`).', 'Id `dev.<slug>.<name>` with the signed domain\'s slug; `core-*` and reserved names forbidden; the first submission fixes ownership (409 `extension_id_taken`).'), '`' + M + 'rules.ts`'],
                [T(lang, 'T: cambiar código ya aprobado', 'T: change already-approved code'), T(lang, 'Versiones semver inmutables y crecientes; cada versión se re-revisa; diff de código y de permisos para el revisor; máquina de estados cerrada.', 'Immutable, increasing semver versions; every version is re-reviewed; code and permissions diff for the reviewer; closed state machine.'), '`rules.ts`, `diff.ts`, `service.ts`'],
                [T(lang, 'I: exfiltración por red o SSRF', 'I: network exfiltration or SSRF'), T(lang, 'Red solo a `network.hosts` declarados, sin redirecciones automáticas y con `safeFetch` anti-SSRF; las variables de pagos de la plataforma no salen por el fallback global de entorno.', 'Network only to declared `network.hosts`, no automatic redirects, with anti-SSRF `safeFetch`; platform payment variables never leave through the global environment fallback.'), '`sandbox-policy.ts`, `hosts.ts`'],
                [T(lang, 'D: código que agota recursos', 'D: resource-exhausting code'), T(lang, 'Límites más estrictos: memoria, timeout duro de 10 s, 2 ejecuciones simultáneas, 30/min por (dominio, extensión).', 'Stricter limits: memory, hard 10 s timeout, 2 concurrent runs, 30/min per (domain, extension).'), '`sandbox-policy.ts`'],
                [T(lang, 'E: extensión no aprobada llega a otros dominios', 'E: unapproved extension reaches other domains'), T(lang, 'Estado `private` solo para el dueño; `yanked`/`suspended` no corre para nadie; sin fila `DevExtension` un `dev.*` no corre (fail-closed); extensión de pago sin `Entitlement` bloqueada, también con tablas ausentes.', '`private` state only for the owner; `yanked`/`suspended` runs for nobody; without a `DevExtension` row a `dev.*` does not run (fail-closed); paid extension without `Entitlement` blocked, also with missing tables.'), '`licensing.ts`'],
                [T(lang, 'T: CSRF en el panel de revisión', 'T: CSRF on the review panel'), T(lang, 'Comprobación de origen (`Origin` = host o `Sec-Fetch-Site`) además de la protección nativa de Next y la cookie SameSite=Lax.', 'Origin check (`Origin` = host or `Sec-Fetch-Site`) on top of Next native protection and the SameSite=Lax cookie.'), '`' + M + 'csrf.ts`'],
            ],
        },
    };
};

const section = (lang: Lang, id: string, title: string, key: string): Block[] => [
    { t: 'h3', id, text: title },
    { t: 'table', head: stride(lang).head, rows: stride(lang).rows[key] },
];

const compliance = (lang: Lang): string[][] => [
    ['ASVS V4.1', T(lang, 'Control de acceso aplicado en un punto de confianza', 'Access control enforced at a trusted point'), T(lang, 'Solo dominios firmados; dominio y usuario salen de la firma; nivel 4 y step-up en la instancia.', 'Signed domains only; domain and user from the signature; level 4 and step-up at the instance.'), '`' + P + 'route-auth.ts`; `tests/payments-unit.test.mjs` (403 `signature_required`, 401)'],
    ['ASVS V4.2', T(lang, 'Sin acceso a objetos ajenos (IDOR)', 'No access to others\' objects (IDOR)'), T(lang, 'Consultas filtradas por el dominio firmado; orden ajena = 404.', 'Queries filtered by the signed domain; others\' order = 404.'), '`' + P + 'billing.ts`, `orders.ts`; `tests/pg/orders.pg.test.mjs`'],
    ['ASVS V4.3', T(lang, 'Funciones privilegiadas protegidas', 'Privileged functions protected'), T(lang, 'Revisión solo por administradores de la plataforma; CSRF por origen; cron con secreto.', 'Review only by platform administrators; CSRF by origin; cron with secret.'), '`' + M + 'csrf.ts`; `app/api/cron/payments/route.ts`; `tests/payments-unit.test.mjs` (cron sin secreto 401)'],
    ['ASVS V8.1', T(lang, 'Datos sensibles mínimos y sin registrar', 'Minimal sensitive data, not logged'), T(lang, 'Sin tokens de PayPal; webhook guarda hash; auditoría redacta secretos, correos y payer ids.', 'No PayPal tokens; webhook stores a hash; audit redacts secrets, emails and payer ids.'), '`' + P + 'audit.ts`, `account.ts`; `tests/payments-unit.test.mjs` (auditoría sin secretos)'],
    ['ASVS V8.3', T(lang, 'Protección de datos en respuestas', 'Data protection in responses'), T(lang, 'Respuestas `Cache-Control: no-store`; errores saneados sin filtrar secretos; CSV anti-fórmulas.', '`Cache-Control: no-store` responses; sanitised errors without leaking secrets; formula-safe CSV.'), '`route-auth.ts`; `tests/payments-unit.test.mjs` (CSV, errores de cliente PayPal)'],
    ['ASVS V13.1', T(lang, 'Validación de entrada de la API', 'API input validation'), T(lang, 'Cuerpo JSON acotado, rangos de fecha validados (máx. 366 días), límites de paginación, manifest y tamaños validados.', 'Bounded JSON body, validated date ranges (max 366 days), pagination limits, validated manifest and sizes.'), '`' + P + 'billing.ts`, `handler.ts`; `tests/marketplace-rules.test.mjs`'],
    ['ASVS V13.2', T(lang, 'Seguridad de la API REST (autenticación, límites, idempotencia)', 'REST API security (authentication, limits, idempotency)'), T(lang, 'Firma Ed25519 por petición; rate limit por dominio; idempotencia con `PayPal-Request-Id` y `refKey`; CORS `*` sin cookies a propósito.', 'Per-request Ed25519 signature; per-domain rate limit; idempotency with `PayPal-Request-Id` and `refKey`; CORS `*` without cookies on purpose.'), '`handler.ts`, `paypal.ts`; `tests/pg/subscriptions.pg.test.mjs`'],
    ['NIST SC-8', T(lang, 'Confidencialidad e integridad en tránsito', 'Transmission confidentiality and integrity'), T(lang, 'Solo HTTPS hacia PayPal (hosts fijos sandbox/live); firma de webhook verificada; `redirect_uri` https fija.', 'HTTPS only to PayPal (fixed sandbox/live hosts); verified webhook signature; fixed https `redirect_uri`.'), '`' + P + 'config.ts`, `webhook.ts`; `tests/payments-unit.test.mjs` (`cert_url` ajeno rechazado)'],
    ['NIST AU-2', T(lang, 'Eventos auditables', 'Auditable events'), T(lang, 'Todo cambio de dinero o de cuenta genera línea JSON y fila `PaymentAudit`; libro mayor inmutable por trigger.', 'Every money or account change produces a JSON line and a `PaymentAudit` row; ledger immutable by trigger.'), '`' + P + 'audit.ts`, `ddl.ts`; `tests/pg/payouts.pg.test.mjs`'],
    ['ISO 27001 A.8 (8.2, 8.3)', T(lang, 'Privilegios y restricción de acceso a la información', 'Privileged access and information access restriction'), T(lang, 'Dueño nivel 4; revisor administrador de plataforma; variables de plataforma fuera del alcance de las extensiones.', 'Level-4 owner; platform-administrator reviewer; platform variables out of extensions\' reach.'), '`' + P + 'route-auth.ts`; `tests/payments-unit.test.mjs` (variables fuera del fallback)'],
    ['ISO 27001 A.8 (8.15, 8.16)', T(lang, 'Registro y monitorización', 'Logging and monitoring'), T(lang, 'Auditoría a stdout (SIEM) y BD; conciliación (`npm run payments:reconcile`) detecta divergencias con PayPal.', 'Audit to stdout (SIEM) and DB; reconciliation (`npm run payments:reconcile`) detects divergences with PayPal.'), '`audit.ts`, `reconcile.ts`; `scripts/payments-reconcile.mjs`'],
    ['ISO 27001 A.8 (8.26, 8.28)', T(lang, 'Requisitos de seguridad y codificación segura de aplicaciones', 'Application security requirements and secure coding'), T(lang, 'Análisis estático de extensiones, sandbox con límites, revisión humana por versión.', 'Static analysis of extensions, sandboxed with limits, per-version human review.'), '`' + M + 'analysis.ts`, `sandbox-policy.ts`; `tests/marketplace-analysis.test.mjs`'],
];

const blocks = (lang: Lang): Block[] => [
    { t: 'p', text: T(lang,
        'Modelo de amenazas **STRIDE** (Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege) del sistema de pagos con PayPal y del marketplace de código de terceros. Cada mitigación listada existe en el código; la columna «Dónde» indica el archivo. Para el uso, ve a [Guía de desarrollador](/docs/developer-guide), [Guía de facturación](/docs/billing-guide) y [Configuración de PayPal](/docs/billing-setup). Contexto general en [Seguridad y cifrado](/docs/security) y [Mapeo CIS / NIST / ISO](/docs/compliance).',
        '**STRIDE** threat model (Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege) for the PayPal payment system and the third-party code marketplace. Every listed mitigation exists in the code; the "Where" column gives the file. For usage see the [Developer guide](/docs/developer-guide), [Billing guide](/docs/billing-guide) and [PayPal setup](/docs/billing-setup). General context in [Security and encryption](/docs/security) and [CIS / NIST / ISO mapping](/docs/compliance).') },

    { t: 'h2', id: 'principles', text: T(lang, 'Principios', 'Principles') },
    { t: 'ul', items: [
        T(lang, '**PayPal es la autoridad:** antes de actuar se reconsulta el estado a PayPal; el evento solo avisa.', '**PayPal is the authority:** state is re-queried from PayPal before acting; the event only notifies.'),
        T(lang, '**Dinero en enteros** (centavos) y desde la BD; nunca floats ni importes del cliente.', '**Money in integers** (cents) and from the DB; never floats or client amounts.'),
        T(lang, '**Fail-closed:** sin firma, sin credenciales o sin tablas, no se concede nada.', '**Fail-closed:** with no signature, credentials or tables, nothing is granted.'),
        T(lang, '**PCI fuera de alcance:** PayPal hospeda el pago; BloomX nunca ve ni guarda datos de tarjeta.', '**PCI out of scope:** PayPal hosts the payment; BloomX never sees or stores card data.'),
        T(lang, '**CORS `*` sin cookies es intencional:** la autenticación es por firma de cada petición, no por cookies, así que no hay CSRF clásico en estas rutas ([Arquitectura](/docs/architecture#trust)).', '**CORS `*` without cookies is intentional:** authentication is a per-request signature, not cookies, so there is no classic CSRF on these routes ([Architecture](/docs/architecture#trust)).'),
        T(lang, 'Las variables de la plataforma (`PAYPAL_*`, `PAYMENTS_*`, `PLATFORM_*`) no son visibles para las extensiones, ni por el fallback global de entorno.', 'Platform variables (`PAYPAL_*`, `PAYMENTS_*`, `PLATFORM_*`) are not visible to extensions, not even through the global environment fallback.'),
    ] },

    { t: 'h2', id: 'stride', text: T(lang, 'STRIDE por superficie', 'STRIDE per surface') },
    ...section(lang, 'orders', T(lang, 'Creación de órdenes', 'Order creation'), 'orders'),
    ...section(lang, 'capture', T(lang, 'Captura', 'Capture'), 'capture'),
    ...section(lang, 'webhook', T(lang, 'Webhook', 'Webhook'), 'webhook'),
    ...section(lang, 'oidc', T(lang, 'Vínculo PayPal (OIDC)', 'PayPal link (OIDC)'), 'oidc'),
    ...section(lang, 'payouts', T(lang, 'Payouts', 'Payouts'), 'payouts'),
    ...section(lang, 'subscriptions', T(lang, 'Suscripciones', 'Subscriptions'), 'subscriptions'),
    ...section(lang, 'marketplace', T(lang, 'Marketplace (código de terceros)', 'Marketplace (third-party code)'), 'marketplace'),

    { t: 'h2', id: 'compliance', text: T(lang, 'Tabla de cumplimiento', 'Compliance table') },
    { t: 'p', text: T(lang, 'Cada fila: requisito, cómo se cumple y el archivo o prueba que lo demuestra (rutas relativas a `bloomx-backend/` salvo que se indique).', 'Each row: requirement, how it is met and the file or test that demonstrates it (paths relative to `bloomx-backend/` unless stated).') },
    { t: 'table', head: [T(lang, 'Control', 'Control'), T(lang, 'Requisito', 'Requirement'), T(lang, 'Cómo se cumple', 'How it is met'), T(lang, 'Evidencia', 'Evidence')], rows: compliance(lang) },
    { t: 'callout', kind: 'note', text: T(lang, 'Las pruebas que usan Postgres (`npm run test:pg`) y el servidor PayPal falso se ejecutan en local; **no sustituyen** una auditoría externa ni una prueba con cuentas sandbox reales ([verificar](/docs/billing-setup#verify)).', 'Tests that use Postgres (`npm run test:pg`) and the fake PayPal server run locally; they **do not replace** an external audit or a test with real sandbox accounts ([verify](/docs/billing-setup#verify)).') },

    { t: 'h2', id: 'residual', text: T(lang, 'Riesgos residuales', 'Residual risks') },
    { t: 'ul', items: [
        T(lang, '**Rate limit en memoria por instancia:** cada instancia serverless lleva su contador; un atacante puede repartir peticiones entre instancias. Mitigan la firma obligatoria, la idempotencia y los límites de PayPal, pero no hay un límite distribuido.', '**In-memory per-instance rate limit:** each serverless instance has its own counter; an attacker can spread requests across instances. Mandatory signatures, idempotency and PayPal limits mitigate it, but there is no distributed limit.'),
        T(lang, '**Sin PKCE garantizado por PayPal:** enviamos `code_challenge`, pero no tenemos garantía de que PayPal lo exija o lo valide; la protección efectiva es el `state` de un solo uso, el nonce y la `redirect_uri` fija.', '**No PayPal-guaranteed PKCE:** we send `code_challenge`, but have no guarantee PayPal requires or validates it; the effective protection is the single-use `state`, the nonce and the fixed `redirect_uri`.'),
        T(lang, '**Conciliación manual de `duplicate_unresolved`:** si PayPal rechaza un `sender_batch_id` repetido y no indica el payout original, el pago queda READY con ese error y un operador debe comprobar en PayPal si ya se envió antes de reintentar.', '**Manual reconciliation of `duplicate_unresolved`:** if PayPal rejects a repeated `sender_batch_id` without pointing to the original payout, the payout stays READY with that error and an operator must check on PayPal whether it was already sent before retrying.'),
        T(lang, '**El sandbox no es una frontera fuerte:** el código de terceros corre en `worker_threads` con `vm`; la revisión humana y los límites reducen el riesgo, no lo eliminan ([Extensiones](/docs/expansions#sandbox)).', '**The sandbox is not a strong boundary:** third-party code runs in `worker_threads` with `vm`; human review and limits reduce the risk but do not remove it ([Extensions](/docs/expansions#sandbox)).'),
        T(lang, '**El revisor es una persona:** el análisis estático es consultivo y puede no detectar código ofuscado.', '**The reviewer is a person:** static analysis is advisory and may miss obfuscated code.'),
        T(lang, '**Disponibilidad de PayPal** (Payouts/Subscriptions según país) y los **términos legales y obligaciones tributarias** no los resuelve el software ([Configuración](/docs/billing-setup#availability)).', '**PayPal availability** (Payouts/Subscriptions by country) and **legal terms and tax obligations** are not solved by the software ([Setup](/docs/billing-setup#availability)).'),
    ] },
];

const page: DocPageContent = { es: blocks('es'), en: blocks('en') };
export default page;
