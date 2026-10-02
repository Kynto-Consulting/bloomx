import type { Block, DocPageContent } from '../types';

/** Guia de desarrollador del marketplace de terceros (portal /admin/developer). Bilingue; un test valida enlaces, anclas y paridad es/en. */

type Lang = 'es' | 'en';
const T = (lang: Lang, es: string, en: string): string => (lang === 'es' ? es : en);

const manifestExample = `{
  "id": "dev.acme-com.resumen-diario",
  "name": "Resumen diario",
  "version": "1.0.0",
  "publisher": "acme.com",
  "permissions": ["READ_EMAIL"],
  "network": { "hosts": ["api.acme.com"] }
}`;

const blocks = (lang: Lang): Block[] => [
    { t: 'p', text: T(lang,
        'Esta guía explica cómo publicar una extensión **de terceros** en el marketplace de BloomX desde el portal `/admin/developer`, cómo se revisa, cómo se cobra y cuánto recibes. El contrato técnico de la extensión (manifest, permisos, handler) está en [Extensiones](/docs/expansions) y [Crear una extensión](/docs/create-extension).',
        'This guide explains how to publish a **third-party** extension on the BloomX marketplace from the `/admin/developer` portal, how it is reviewed, how you get paid and how much you receive. The technical contract of the extension (manifest, permissions, handler) is in [Extensions](/docs/expansions) and [Build an extension](/docs/create-extension).') },
    { t: 'callout', kind: 'note', title: T(lang, 'Cobros opcionales', 'Payments are optional'), text: T(lang,
        'Publicar gratis no requiere PayPal. Las extensiones de pago solo funcionan si el operador configuró los pagos ([Configuración de PayPal](/docs/billing-setup)); si no, el backend responde 503 `payments_not_configured`.',
        'Publishing for free does not need PayPal. Paid extensions only work if the operator configured payments ([PayPal setup](/docs/billing-setup)); otherwise the backend answers 503 `payments_not_configured`.') },

    { t: 'h2', id: 'account', text: T(lang, 'Cuenta de desarrollador', 'Developer account') },
    { t: 'ul', items: [
        T(lang, 'Tu instancia debe tener un **dominio con clave Ed25519 registrada** (firmado). Un dominio en modo legado recibe 403 `signature_required` en todas las rutas de dinero y de marketplace ([Arquitectura](/docs/architecture#signed-vs-legacy)).', 'Your instance must have a **domain with a registered Ed25519 key** (signed). A domain in legacy mode gets 403 `signature_required` on every money and marketplace route ([Architecture](/docs/architecture#signed-vs-legacy)).'),
        T(lang, 'Solo el **dueño del dominio (nivel de permiso 4)** accede al portal, y las acciones sensibles piden **step-up** reciente (confirmación de identidad). La instancia lo exige antes de firmar la petición; el backend confía solo en lo firmado.', 'Only the **domain owner (permission level 4)** can use the portal, and sensitive actions require a recent **step-up** (identity re-confirmation). The instance enforces it before signing the request; the backend trusts only what is signed.'),
        T(lang, 'Antes de publicar debes **aceptar los términos del desarrollador**. Se registra la versión aceptada (`PAYMENTS_TERMS_VERSION`); si la plataforma publica una versión nueva, debes aceptarla otra vez para seguir enviando versiones.', 'Before publishing you must **accept the developer terms**. The accepted version (`PAYMENTS_TERMS_VERSION`) is recorded; if the platform publishes a new version you must accept it again to keep submitting versions.'),
    ] },

    { t: 'h2', id: 'identity', text: T(lang, 'Identidad: id y publisher', 'Identity: id and publisher') },
    { t: 'p', text: T(lang,
        'El id es obligatoriamente `dev.<slug-del-dominio>.<nombre>`. El slug es el nombre de tu dominio firmado en minúsculas con `.` convertido en `-` (`acme.com` pasa a `acme-com`). Solo puedes crear ids con **tu** slug.',
        'The id must be `dev.<domain-slug>.<name>`. The slug is your signed domain name in lowercase with `.` replaced by `-` (`acme.com` becomes `acme-com`). You can only create ids with **your** slug.') },
    { t: 'ul', items: [
        T(lang, 'El prefijo `core-` y los nombres reservados son **solo de la plataforma**; no se pueden usar como nombre.', 'The `core-` prefix and reserved names belong **only to the platform**; they cannot be used as a name.'),
        T(lang, 'El `publisher` es **tu dominio**. No puedes presentarte como otro editor ni como la plataforma.', 'The `publisher` is **your domain**. You cannot present yourself as another publisher or as the platform.'),
        T(lang, 'Dos dominios distintos pueden producir el mismo slug (`a-b.com` y `a.b.com`). La primera submission fija la propiedad del id; el otro dominio recibe 409 `extension_id_taken`.', 'Two different domains can produce the same slug (`a-b.com` and `a.b.com`). The first submission fixes id ownership; the other domain gets 409 `extension_id_taken`.'),
    ] },
    { t: 'code', lang: 'json', title: 'manifest.json', code: manifestExample },

    { t: 'h2', id: 'files', text: T(lang, 'Archivos de una versión', 'Files of a version') },
    { t: 'table', head: [T(lang, 'Archivo', 'File'), T(lang, 'Qué es', 'What it is')], rows: [
        ['`manifest.json`', T(lang, 'Id, nombre, versión, publisher, permisos, `network.hosts`, componentes. Se valida con el mismo esquema que el resto de extensiones.', 'Id, name, version, publisher, permissions, `network.hosts`, components. Validated with the same schema as every other extension.')],
        ['`server.js`', T(lang, 'El handler. Corre en el sandbox, no tiene `require`, `process` ni `eval`.', 'The handler. Runs in the sandbox; it has no `require`, `process` or `eval`.')],
        [T(lang, 'Icono', 'Icon'), T(lang, 'Imagen con límite de tamaño y formato validado.', 'Image with a size limit and validated format.')],
        ['`README`', T(lang, 'Descripción que ve el revisor y que alimenta la ficha del catálogo ([metadatos](/docs/marketplace-metadata)).', 'Description the reviewer sees and that feeds the catalog page ([metadata](/docs/marketplace-metadata)).')],
    ] },

    { t: 'h2', id: 'versioning', text: T(lang, 'Versionado', 'Versioning') },
    { t: 'ul', items: [
        T(lang, '**semver** estricto `X.Y.Z`. Una versión enviada es **inmutable**: para cambiar algo envías otra.', 'Strict **semver** `X.Y.Z`. A submitted version is **immutable**: to change anything you submit another one.'),
        T(lang, 'La versión **debe subir** respecto a la última publicada.', 'The version **must increase** over the last published one.'),
        T(lang, 'El **changelog es obligatorio** en cada versión.', 'The **changelog is mandatory** on every version.'),
        T(lang, 'El portal sugiere `patch`, `minor` o `major` y muestra un **diff de permisos** frente a la versión anterior: pedir permisos nuevos hace que los dominios que la tienen instalada deban aprobarlos otra vez.', 'The portal suggests `patch`, `minor` or `major` and shows a **permissions diff** against the previous version: asking for new permissions makes domains that have it installed approve them again.'),
    ] },

    { t: 'h2', id: 'validation', text: T(lang, 'Validación y análisis estático', 'Validation and static analysis') },
    { t: 'p', text: T(lang,
        'Antes de enviar a revisión (`POST /api/developer/validate` desde el portal) se valida el manifest, los tamaños y se ejecuta un análisis estático **consultivo**. Los hallazgos `error` bloquean el envío; los `warning` e `info` los ve el revisor.',
        'Before submitting for review (`POST /api/developer/validate` from the portal) the manifest and sizes are validated and an **advisory** static analysis runs. `error` findings block submission; the reviewer sees `warning` and `info`.') },
    { t: 'ul', items: [
        T(lang, '**Red:** todo host al que llame tu código debe estar declarado en `network.hosts`. Un comodín `*` solo se rechaza por demasiado amplio; `*.dominio.com` cubre subdominios.', '**Network:** every host your code calls must be declared in `network.hosts`. A bare `*` is rejected as too broad; `*.domain.com` covers subdomains.'),
        T(lang, '**Permisos de riesgo alto** se señalan al revisor, y algunos permisos están prohibidos para terceros.', '**High-risk permissions** are flagged to the reviewer, and some permissions are forbidden for third parties.'),
        T(lang, '**Tamaño** máximo de `server.js`, manifest, icono y README (configurables por el operador).', 'Maximum size of `server.js`, manifest, icon and README (operator-configurable).'),
        T(lang, '**APIs prohibidas:** `require`, `process`, `import`, `eval`, `new Function`, `fs`, `net`, `child_process`...', '**Forbidden APIs:** `require`, `process`, `import`, `eval`, `new Function`, `fs`, `net`, `child_process`...'),
    ] },
    { t: 'callout', kind: 'warn', title: T(lang, 'El análisis no es la defensa', 'Analysis is not the defence'), text: T(lang,
        'Es una primera barrera. La defensa real es el sandbox y la lista de hosts impuesta en tiempo de ejecución ([sandbox](/docs/expansions#sandbox)); el sandbox no es una frontera fuerte frente a un atacante decidido, por eso existe la revisión humana.',
        'It is a first barrier. The real defence is the sandbox and the host list enforced at run time ([sandbox](/docs/expansions#sandbox)); the sandbox is not a strong boundary against a determined attacker, which is why human review exists.') },

    { t: 'h2', id: 'review', text: T(lang, 'Flujo de revisión', 'Review flow') },
    { t: 'code', lang: 'text', title: T(lang, 'Estados', 'States'), code: 'draft -> in_review -> changes_requested -> (editar) -> in_review\n                  -> approved -> published -> yanked\n                  -> rejected' },
    { t: 'ul', items: [
        T(lang, '`draft`: editable. Puedes retirar (`withdraw`) un envío pendiente.', '`draft`: editable. You can withdraw a pending submission.'),
        T(lang, '`in_review`: lo evalúa el **revisor, un administrador de la plataforma**, con diff de código, análisis y permisos.', '`in_review`: the **reviewer, a platform administrator**, evaluates it with code diff, analysis and permissions.'),
        T(lang, '`changes_requested`: edita y vuelve a enviar. `rejected`: cierra esa versión; puedes enviar una nueva con número mayor.', '`changes_requested`: edit and resubmit. `rejected`: closes that version; you can submit a new one with a higher number.'),
        T(lang, '`approved`: aún no es visible; tú decides cuándo **publicar** (`published`).', '`approved`: not visible yet; you decide when to **publish** (`published`).'),
        T(lang, '**Cada versión se re-revisa**, también las que solo cambian un patch. Recibes un **correo** en cada decisión (al dueño del dominio).', '**Every version is re-reviewed**, including patch-only changes. You receive an **email** on each decision (to the domain owner).'),
    ] },
    { t: 'p', text: T(lang, 'Cualquier otra transición se rechaza: la máquina de estados es cerrada.', 'Any other transition is rejected: the state machine is closed.') },

    { t: 'h2', id: 'test-mode', text: T(lang, 'Modo prueba en tu dominio', 'Test mode on your domain') },
    { t: 'p', text: T(lang,
        'Mientras una extensión no está aprobada y publicada existe como **extensión privada**: solo tu dominio puede instalarla y ejecutarla (`test-install`). **Nada sin aprobar llega a otros dominios.** Tú no pagas por usar tu propia extensión de pago en tu dominio.',
        'Until an extension is approved and published it exists as a **private extension**: only your domain can install and run it (`test-install`). **Nothing unapproved reaches other domains.** You do not pay to use your own paid extension on your domain.') },

    { t: 'h2', id: 'yank', text: T(lang, 'Kill switch y yank', 'Kill switch and yank') },
    { t: 'p', text: T(lang,
        'Puedes retirar (`yank`) una versión o extensión, y la plataforma puede suspenderla. Una extensión `yanked` o `suspended` **no se ejecuta para nadie**, ni siquiera para ti, de inmediato. Si falta el registro de la extensión de tercero, el sistema falla cerrado (no se ejecuta).',
        'You can withdraw (`yank`) a version or extension, and the platform can suspend it. A `yanked` or `suspended` extension **runs for nobody**, not even you, immediately. If the third-party extension record is missing, the system fails closed (it does not run).') },

    { t: 'h2', id: 'limits', text: T(lang, 'Límites de recursos', 'Resource limits') },
    { t: 'p', text: T(lang, 'El código de terceros corre con límites **más estrictos** que el de la plataforma:', 'Third-party code runs with **stricter** limits than platform code:') },
    { t: 'ul', items: [
        T(lang, 'Memoria del Worker reducida (48 MB de heap viejo), contexto de 2 MiB y resultado de 1 MiB.', 'Reduced Worker memory (48 MB old heap), 2 MiB context and 1 MiB result.'),
        T(lang, 'Timeout duro de 10 s aunque el manifest pida más; 2 ejecuciones simultáneas por extensión; 30 ejecuciones por minuto por (dominio, extensión).', 'Hard 10 s timeout even if the manifest asks for more; 2 concurrent runs per extension; 30 runs per minute per (domain, extension).'),
        T(lang, 'Presupuestos pequeños de llamadas de red y de IA por ejecución; red solo a `network.hosts` y **sin redirecciones automáticas**.', 'Small per-run budgets of network and AI calls; network only to `network.hosts` and **no automatic redirects**.'),
    ] },

    { t: 'h2', id: 'pricing', text: T(lang, 'Precios', 'Pricing') },
    { t: 'table', head: [T(lang, 'Modelo', 'Model'), T(lang, 'Detalle', 'Detail')], rows: [
        [T(lang, 'Gratis', 'Free'), T(lang, 'Sin cobro ni PayPal.', 'No charge, no PayPal.')],
        [T(lang, 'Pago único', 'One-time'), T(lang, 'Un cobro por dominio; el derecho no caduca.', 'One charge per domain; the entitlement does not expire.')],
        [T(lang, 'Suscripción', 'Subscription'), T(lang, 'Mensual y/o anual, con **prueba gratuita de 0 a 30 días**.', 'Monthly and/or yearly, with a **free trial of 0 to 30 days**.')],
    ] },
    { t: 'ul', items: [
        T(lang, 'Los precios se validan entre un mínimo y un máximo definidos por el operador (`PAYMENTS_MIN_PRICE_CENTS` / `PAYMENTS_MAX_PRICE_CENTS`), siempre en USD y en centavos enteros.', 'Prices are validated between an operator-defined minimum and maximum (`PAYMENTS_MIN_PRICE_CENTS` / `PAYMENTS_MAX_PRICE_CENTS`), always in USD and whole cents.'),
        T(lang, 'Los **planes de PayPal son inmutables**: cambiar el precio crea un plan nuevo. El **suscriptor actual conserva su precio** hasta que apruebe el nuevo ([Guía de facturación](/docs/billing-guide#price-change)).', '**PayPal plans are immutable**: changing the price creates a new plan. The **current subscriber keeps their price** until they approve the new one ([Billing guide](/docs/billing-guide#price-change)).'),
    ] },

    { t: 'h2', id: 'split', text: T(lang, 'Reparto 70/30', '70/30 split') },
    { t: 'p', text: T(lang,
        'Recibes el **70 % del precio bruto**; la plataforma, el 30 %. El porcentaje es configurable en el backend (`PAYMENTS_DEVELOPER_SHARE_BPS`, 7000 = 70 %). La **comisión de PayPal la asume la plataforma** (sale de su parte, no de la tuya).',
        'You receive **70 % of the gross price**; the platform gets 30 %. The percentage is configurable in the backend (`PAYMENTS_DEVELOPER_SHARE_BPS`, 7000 = 70 %). The **PayPal fee is borne by the platform** (it comes out of its share, not yours).') },
    { t: 'code', lang: 'text', title: T(lang, 'Redondeo en centavos enteros', 'Rounding in whole cents'), code: 'desarrollador = floor(bruto * 70%)\nplataforma    = bruto - desarrollador   (el resto del redondeo es de la plataforma)\n\nejemplo: bruto 999 -> desarrollador 699, plataforma 300' },
    { t: 'p', text: T(lang, 'En un reembolso la parte del desarrollador se revierte de forma proporcional (también con `floor`).', 'On a refund your share is reversed proportionally (also with `floor`).') },

    { t: 'h2', id: 'payouts', text: T(lang, 'Cobro de tus pagos', 'Getting paid') },
    { t: 'ul', items: [
        T(lang, 'Vincula tu **cuenta de PayPal** ([vincular](/docs/billing-guide#paypal-account)). Sin cuenta vinculada tu saldo simplemente se acumula.', 'Link your **PayPal account** ([how](/docs/billing-guide#paypal-account)). Without a linked account your balance simply accumulates.'),
        T(lang, '**Retención de 14 días** (`PAYMENTS_HOLD_DAYS`): hasta entonces el saldo está *retenido*; luego, *disponible*.', '**14-day hold** (`PAYMENTS_HOLD_DAYS`): until then the balance is *held*; afterwards, *available*.'),
        T(lang, 'Hay un **mínimo de pago** y un máximo por pago (`PAYMENTS_PAYOUT_MIN_CENTS` / `PAYMENTS_PAYOUT_MAX_CENTS`); el resto se paga en el siguiente ciclo.', 'There is a **minimum payout** and a per-payout maximum (`PAYMENTS_PAYOUT_MIN_CENTS` / `PAYMENTS_PAYOUT_MAX_CENTS`); the rest is paid in the next cycle.'),
        T(lang, 'Si los **reembolsos dejan el saldo negativo**, se compensa con tus ventas siguientes antes de volver a pagarte.', 'If **refunds leave the balance negative**, it is offset against your next sales before you are paid again.'),
        T(lang, 'Ves saldo, ventas y pagos en [Guía de facturación](/docs/billing-guide#balance).', 'See balance, sales and payouts in the [Billing guide](/docs/billing-guide#balance).'),
    ] },
    { t: 'callout', kind: 'warn', title: T(lang, 'Disponibilidad de PayPal', 'PayPal availability'), text: T(lang,
        'PayPal Payouts y Subscriptions pueden no estar disponibles para ciertas cuentas o países. Verifícalo con PayPal antes de depender de ellos ([Configuración](/docs/billing-setup#availability)).',
        'PayPal Payouts and Subscriptions may be unavailable for certain accounts or countries. Verify with PayPal before relying on them ([Setup](/docs/billing-setup#availability)).') },

    { t: 'h2', id: 'terms', text: T(lang, 'Términos', 'Terms') },
    { t: 'p', text: T(lang,
        'Aceptas los términos vigentes desde el portal (`/api/developer/terms`). El software registra la versión aceptada, pero **no sustituye** a unos términos legales redactados por la plataforma ni resuelve tus obligaciones tributarias.',
        'You accept the current terms from the portal (`/api/developer/terms`). The software records the accepted version, but it **does not replace** legal terms drafted by the platform nor settle your tax obligations.') },

    { t: 'h2', id: 'see-also', text: T(lang, 'Véase también', 'See also') },
    { t: 'ul', items: [
        T(lang, '[Guía de facturación](/docs/billing-guide) para quien compra y para el cobro.', '[Billing guide](/docs/billing-guide) for buyers and for getting paid.'),
        T(lang, '[Configuración de PayPal](/docs/billing-setup) para el operador.', '[PayPal setup](/docs/billing-setup) for the operator.'),
        T(lang, '[Seguridad de pagos y marketplace](/docs/payments-security): modelo de amenazas.', '[Payments and marketplace security](/docs/payments-security): threat model.'),
    ] },
];

const page: DocPageContent = { es: blocks('es'), en: blocks('en') };
export default page;
