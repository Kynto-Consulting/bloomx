import type { Block, DocPageContent } from '../types';

/** Configuracion de PayPal para el operador de la plataforma. Bilingue; un test valida enlaces, anclas y paridad es/en. */

type Lang = 'es' | 'en';
const T = (lang: Lang, es: string, en: string): string => (lang === 'es' ? es : en);

const envRequired = `PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=<client-id-de-la-app>
PAYPAL_CLIENT_SECRET=<secreto-de-la-app>
PAYPAL_WEBHOOK_ID=<id-del-webhook>
PAYPAL_OIDC_REDIRECT_URI=https://<backend>/api/payments/paypal/link/callback
PAYMENTS_CRON_SECRET=<secreto-aleatorio-de-24-o-mas-caracteres>`;

const cronCurl = `curl -X POST https://<backend>/api/cron/payments \\
  -H "Authorization: Bearer <PAYMENTS_CRON_SECRET>"`;

const ddlCmds = `# Imprime el SQL sin ejecutarlo
node scripts/apply-ddl.mjs

# Aplica el DDL (idempotente: CREATE ... IF NOT EXISTS)
DATABASE_URL=<url-de-la-base> node scripts/apply-ddl.mjs --apply`;

const testCmds = `# Pruebas con el servidor PayPal falso (sin credenciales reales)
node --test tests/payments-unit.test.mjs
npm run test:pg

# Conciliacion manual contra PayPal
npm run payments:reconcile`;

const blocks = (lang: Lang): Block[] => [
    { t: 'p', text: T(lang,
        'Esta página es para el **operador de la plataforma** (quien despliega el backend compartido). Los pagos están **apagados por defecto**: sin las variables de abajo, todas las rutas de dinero responden 503 `payments_not_configured`. Los desarrolladores y compradores no necesitan nada de esto; ver [Guía de desarrollador](/docs/developer-guide) y [Guía de facturación](/docs/billing-guide).',
        'This page is for the **platform operator** (whoever deploys the shared backend). Payments are **off by default**: without the variables below, every money route answers 503 `payments_not_configured`. Developers and buyers need none of this; see the [Developer guide](/docs/developer-guide) and [Billing guide](/docs/billing-guide).') },

    { t: 'h2', id: 'app', text: T(lang, '1. Crear la app REST de PayPal', '1. Create the PayPal REST app') },
    { t: 'ol', items: [
        T(lang, 'En el panel de desarrolladores de PayPal crea una app **REST** en **sandbox** y otra en **live** (credenciales distintas).', 'In the PayPal developer dashboard create a **REST** app in **sandbox** and another in **live** (separate credentials).'),
        T(lang, 'En la app habilita **Subscriptions** y **Payouts**, y activa **Log in with PayPal** (ver más abajo).', 'In the app enable **Subscriptions** and **Payouts**, and turn on **Log in with PayPal** (see below).'),
        T(lang, 'Copia `client id` y `secret` al entorno del backend. Los secretos van solo en variables de entorno de la plataforma, nunca en el repositorio.', 'Copy the `client id` and `secret` to the backend environment. Secrets live only in platform environment variables, never in the repository.'),
    ] },

    { t: 'h2', id: 'env', text: T(lang, '2. Variables del backend', 'Backend variables') },
    { t: 'p', text: T(lang, 'Obligatorias para activar los pagos (fuente: `bloomx-backend/.env.example` y `src/lib/payments/config.ts`):', 'Required to enable payments (source: `bloomx-backend/.env.example` and `src/lib/payments/config.ts`):') },
    { t: 'code', lang: 'bash', title: '.env (backend)', code: envRequired },
    { t: 'p', text: T(lang, '`PAYPAL_ENV` acepta `sandbox` o `live` (`production` y `prod` son sinónimos de `live`); cualquier otro valor es inválido y **nunca** cae a live (los pagos quedan apagados).', '`PAYPAL_ENV` accepts `sandbox` or `live` (`production` and `prod` are synonyms of `live`); any other value is invalid and **never** falls back to live (payments stay off).') },
    { t: 'table', head: [T(lang, 'Opcional', 'Optional'), T(lang, 'Defecto', 'Default'), T(lang, 'Qué controla', 'What it controls')], rows: [
        ['`PAYMENTS_DEVELOPER_SHARE_BPS`', '7000', T(lang, 'Parte del desarrollador en puntos base (70 %).', 'Developer share in basis points (70 %).')],
        ['`PAYMENTS_MIN_PRICE_CENTS`', '200', T(lang, 'Precio mínimo por extensión (centavos USD).', 'Minimum price per extension (USD cents).')],
        ['`PAYMENTS_MAX_PRICE_CENTS`', '100000', T(lang, 'Precio máximo por extensión.', 'Maximum price per extension.')],
        ['`PAYMENTS_HOLD_DAYS`', '14', T(lang, 'Retención antes de poder pagar al desarrollador.', 'Hold before the developer can be paid.')],
        ['`PAYMENTS_PAYOUT_MIN_CENTS`', '1000', T(lang, 'Pago mínimo.', 'Minimum payout.')],
        ['`PAYMENTS_PAYOUT_MAX_CENTS`', '500000', T(lang, 'Pago máximo por ciclo.', 'Maximum payout per cycle.')],
        ['`PAYMENTS_ACCOUNT_SWITCH_HOURS`', '24', T(lang, 'Espera al cambiar de cuenta PayPal.', 'Wait when changing PayPal account.')],
        ['`PAYMENTS_GRACE_DAYS`', '3', T(lang, 'Gracia tras un cobro de suscripción fallido.', 'Grace after a failed subscription charge.')],
        ['`PAYMENTS_RENEWAL_BUFFER_HOURS`', '24', T(lang, 'Holgura tras la fecha de renovación antes de pausar (webhook tardío).', 'Slack after the renewal date before pausing (late webhook).')],
        ['`PAYMENTS_TERMS_VERSION`', '2026-10', T(lang, 'Versión vigente de los términos del desarrollador.', 'Current developer terms version.')],
        ['`PLATFORM_RESEND_API_KEY`', '-', T(lang, 'Clave de Resend de la plataforma para correos de revisión, cuenta y cobros.', 'Platform Resend key for review, account and payment emails.')],
        ['`PLATFORM_MAIL_FROM`', '-', T(lang, 'Remitente de esos correos, p. ej. `BloomX <billing@tu-dominio>`.', 'Sender of those emails, e.g. `BloomX <billing@your-domain>`.')],
    ] },
    { t: 'p', text: T(lang, 'Valores fuera de rango se ignoran y se usa el defecto. Estas variables **no** se exponen a las extensiones, ni siquiera con el fallback global de entorno.', 'Out-of-range values are ignored and the default is used. These variables are **never** exposed to extensions, not even through the global environment fallback.') },

    { t: 'h2', id: 'webhook', text: T(lang, '3. Webhook', '3. Webhook') },
    { t: 'p', text: T(lang, 'Crea un webhook en la app con la URL `https://<backend>/api/payments/webhook`, suscrito a estos eventos, y copia su id a `PAYPAL_WEBHOOK_ID`:', 'Create a webhook on the app with the URL `https://<backend>/api/payments/webhook`, subscribed to these events, and copy its id to `PAYPAL_WEBHOOK_ID`:') },
    { t: 'ul', items: [
        '`CHECKOUT.ORDER.APPROVED`',
        '`PAYMENT.CAPTURE.COMPLETED` · `PAYMENT.CAPTURE.DENIED` · `PAYMENT.CAPTURE.REFUNDED` · `PAYMENT.CAPTURE.REVERSED`',
        '`BILLING.SUBSCRIPTION.CREATED` · `ACTIVATED` · `UPDATED` · `SUSPENDED` · `CANCELLED` · `EXPIRED`',
        '`BILLING.SUBSCRIPTION.PAYMENT.FAILED`',
        '`PAYMENT.SALE.COMPLETED` · `PAYMENT.SALE.REFUNDED` · `PAYMENT.SALE.REVERSED` · `PAYMENT.SALE.DENIED`',
    ] },
    { t: 'p', text: T(lang, 'Cada evento se verifica con la API oficial `verify-webhook-signature`; sin verificación válida se responde 401 y no se toca nada.', 'Every event is verified with the official `verify-webhook-signature` API; without valid verification the answer is 401 and nothing is touched.') },

    { t: 'h2', id: 'oidc', text: T(lang, '4. Log in with PayPal', '4. Log in with PayPal') },
    { t: 'ul', items: [
        T(lang, 'Activa **Log in with PayPal** en la app con los scopes `openid` y `email`.', 'Turn on **Log in with PayPal** on the app with the `openid` and `email` scopes.'),
        T(lang, 'Registra la `redirect_uri` **exacta** `https://<backend>/api/payments/paypal/link/callback` y la misma en `PAYPAL_OIDC_REDIRECT_URI`. El backend nunca construye la `redirect_uri` desde la petición.', 'Register the **exact** `redirect_uri` `https://<backend>/api/payments/paypal/link/callback` and the same value in `PAYPAL_OIDC_REDIRECT_URI`. The backend never builds the `redirect_uri` from the request.'),
    ] },

    { t: 'h2', id: 'cron', text: T(lang, '5. Cron de pagos', '5. Payments cron') },
    { t: 'p', text: T(lang, 'La ruta `/api/cron/payments` concilia órdenes y suscripciones pendientes y ejecuta el ciclo de pagos a desarrolladores. Se autentica con `Authorization: Bearer <PAYMENTS_CRON_SECRET>` (mínimo 24 caracteres). El backend trae un `vercel.json` con un cron **diario** (`0 6 * * *`); en Vercel define `CRON_SECRET` con el **mismo valor** que `PAYMENTS_CRON_SECRET` para que Vercel envíe el Bearer correcto. Consulta [Despliegue](/docs/deployment#cron).', 'The `/api/cron/payments` route reconciles pending orders and subscriptions and runs the developer payout cycle. It authenticates with `Authorization: Bearer <PAYMENTS_CRON_SECRET>` (at least 24 characters). The backend ships a `vercel.json` with a **daily** cron (`0 6 * * *`); on Vercel set `CRON_SECRET` to the **same value** as `PAYMENTS_CRON_SECRET` so Vercel sends the right Bearer. See [Deployment](/docs/deployment#cron).') },
    { t: 'code', lang: 'bash', title: T(lang, 'Ejecución manual', 'Manual run'), code: cronCurl },

    { t: 'h2', id: 'ddl', text: T(lang, '6. Base de datos (DDL)', '6. Database (DDL)') },
    { t: 'p', text: T(lang, 'Las tablas nuevas (`src/lib/payments/ddl.ts` y `src/lib/marketplace/ddl.ts`) no se crean solas en producción. Revisa el SQL y aplícalo:', 'The new tables (`src/lib/payments/ddl.ts` and `src/lib/marketplace/ddl.ts`) are not created on their own in production. Review the SQL and apply it:') },
    { t: 'code', lang: 'bash', title: 'DDL', code: ddlCmds },
    { t: 'p', text: T(lang, 'Mientras falten las tablas, las rutas de facturación responden 503 `payments_unavailable` (y las de dinero fallan cerradas: una extensión de pago no se regala). El libro mayor tiene un trigger que impide `UPDATE` y `DELETE`.', 'While the tables are missing, billing routes answer 503 `payments_unavailable` (and money paths fail closed: a paid extension is never given away). The ledger has a trigger that blocks `UPDATE` and `DELETE`.') },

    { t: 'h2', id: 'verify', text: T(lang, '7. Comprobar antes de ir a live', '7. Verify before going live') },
    { t: 'ol', items: [
        T(lang, '**Sin credenciales reales:** las pruebas usan un servidor PayPal falso (`node --test tests/payments-unit.test.mjs`, `npm run test:pg`).', '**Without real credentials:** tests use a fake PayPal server (`node --test tests/payments-unit.test.mjs`, `npm run test:pg`).'),
        T(lang, '**Con cuentas sandbox reales:** `PAYPAL_ENV=sandbox`, una cuenta vendedora y otra compradora de sandbox; prueba compra única, suscripción con prueba, fallo de pago, reembolso, vinculación y un ciclo de payout.', '**With real sandbox accounts:** `PAYPAL_ENV=sandbox`, a sandbox seller and buyer; test one-time purchase, subscription with trial, payment failure, refund, linking and a payout cycle.'),
        T(lang, '**Paso a live:** cambia a las credenciales de la app live, un webhook nuevo (otro id) y la `redirect_uri` live; deja `PAYPAL_ENV=live` al final.', '**Going live:** switch to the live app credentials, a new webhook (different id) and the live `redirect_uri`; set `PAYPAL_ENV=live` last.'),
        T(lang, '**Conciliación:** `npm run payments:reconcile` compara tu base con PayPal; úsalo tras cualquier incidente.', '**Reconciliation:** `npm run payments:reconcile` compares your database with PayPal; use it after any incident.'),
    ] },
    { t: 'code', lang: 'bash', title: T(lang, 'Pruebas y conciliación', 'Tests and reconciliation'), code: testCmds },

    { t: 'h2', id: 'errors', text: T(lang, 'Respuestas 503', '503 responses') },
    { t: 'table', head: [T(lang, 'Respuesta', 'Response'), T(lang, 'Causa', 'Cause')], rows: [
        ['`503 payments_not_configured`', T(lang, 'Falta alguna credencial (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`) o `PAYPAL_ENV` es inválido.', 'A credential is missing (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`) or `PAYPAL_ENV` is invalid.')],
        ['`503 payments_unavailable`', T(lang, 'Las tablas de pagos aún no existen: aplica el DDL.', 'The payment tables do not exist yet: apply the DDL.')],
    ] },

    { t: 'h2', id: 'availability', text: T(lang, 'Disponibilidad y límites del software', 'Availability and software limits') },
    { t: 'callout', kind: 'warn', title: T(lang, 'Verifica con PayPal', 'Verify with PayPal'), text: T(lang,
        'PayPal Payouts y Subscriptions **pueden no estar disponibles** para ciertas cuentas o países (por ejemplo Perú): confirma con PayPal que tu cuenta de plataforma los tiene habilitados **antes** de ir a live. El software no puede comprobarlo por ti.',
        'PayPal Payouts and Subscriptions **may not be available** for certain accounts or countries (for example Peru): confirm with PayPal that your platform account has them enabled **before** going live. The software cannot check it for you.') },
    { t: 'callout', kind: 'danger', title: T(lang, 'Lo que el software no resuelve', 'What the software does not solve'), text: T(lang,
        'Los **términos legales** del marketplace y las **obligaciones tributarias** (por ejemplo ante SUNAT) no los resuelve el software: requieren asesoría legal y contable propias. Un recibo de BloomX no es un comprobante fiscal.',
        'The marketplace **legal terms** and **tax obligations** (for example before SUNAT) are not solved by the software: they require your own legal and accounting advice. A BloomX receipt is not a tax document.') },

    { t: 'h2', id: 'mercadopago', text: T(lang, 'Mercado Pago: desactivado', 'Mercado Pago: removed') },
    { t: 'ul', items: [
        T(lang, 'Se **eliminaron** `create-preference` y su webhook, y el paquete `mercadopago`.', '`create-preference`, its webhook and the `mercadopago` package were **removed**.'),
        T(lang, '`MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` y `PAYMENT_REDIRECT_ALLOWED_ORIGINS` ya **no tienen efecto**; puedes quitarlas del entorno.', '`MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` and `PAYMENT_REDIRECT_ALLOWED_ORIGINS` now have **no effect**; you can remove them from the environment.'),
        T(lang, '`Transaction.providerId` queda como campo legado legible. El flujo nuevo usa `PaymentOrder`, `Subscription`, `Entitlement` y `LedgerEntry`.', '`Transaction.providerId` remains as a readable legacy field. The new flow uses `PaymentOrder`, `Subscription`, `Entitlement` and `LedgerEntry`.'),
        T(lang, 'No se migra ningún dato de producción porque no había transacciones.', 'No production data is migrated because there were no transactions.'),
    ] },

    { t: 'h2', id: 'see-also', text: T(lang, 'Véase también', 'See also') },
    { t: 'ul', items: [
        T(lang, '[Variables de entorno](/docs/env-variables) y [Seguridad de pagos y marketplace](/docs/payments-security).', '[Environment variables](/docs/env-variables) and [Payments and marketplace security](/docs/payments-security).'),
    ] },
];

const page: DocPageContent = { es: blocks('es'), en: blocks('en') };
export default page;
