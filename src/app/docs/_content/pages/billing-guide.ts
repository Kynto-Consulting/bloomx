import type { Block, DocPageContent } from '../types';

/** Guia de facturacion (/admin/billing) para el dueno del dominio. Bilingue; un test valida enlaces, anclas y paridad es/en. */

type Lang = 'es' | 'en';
const T = (lang: Lang, es: string, en: string): string => (lang === 'es' ? es : en);

const blocks = (lang: Lang): Block[] => [
    { t: 'p', text: T(lang,
        'La página `/admin/billing` es para el **dueño del dominio** (nivel de permiso 4, con step-up para acciones sensibles). Aquí compras extensiones de pago, gestionas tus suscripciones y, si publicas extensiones, ves tus ingresos y cobras. El proxy del frontend es `/api/admin/billing`; los pagos los procesa PayPal, BloomX nunca ve los datos de tu tarjeta.',
        'The `/admin/billing` page is for the **domain owner** (permission level 4, with step-up for sensitive actions). Here you buy paid extensions, manage your subscriptions and, if you publish extensions, see your income and get paid. The frontend proxy is `/api/admin/billing`; PayPal processes payments, BloomX never sees your card data.') },
    { t: 'callout', kind: 'note', text: T(lang,
        'Si ves el aviso de pagos no configurados, el operador de la plataforma aún no activó PayPal ([Configuración de PayPal](/docs/billing-setup)). Tu dominio también debe estar firmado (con clave registrada).',
        'If you see the payments-not-configured notice, the platform operator has not enabled PayPal yet ([PayPal setup](/docs/billing-setup)). Your domain must also be signed (registered key).') },

    { t: 'h2', id: 'buy', text: T(lang, 'Comprar una extensión', 'Buy an extension') },
    { t: 'ol', items: [
        T(lang, 'En el catálogo elige la extensión de pago y pulsa comprar. El importe lo calcula el servidor desde la base de datos; no se toma del navegador.', 'In the catalog pick the paid extension and press buy. The amount is computed by the server from the database; it is not taken from the browser.'),
        T(lang, '**Pago único:** se abre la aprobación de PayPal y, al volver, BloomX captura el pago.', '**One-time payment:** the PayPal approval opens and, on return, BloomX captures the payment.'),
        T(lang, '**Suscripción:** eliges mensual o anual (con prueba gratuita si la hay) y apruebas la suscripción en PayPal.', '**Subscription:** you choose monthly or yearly (with a free trial if offered) and approve the subscription on PayPal.'),
        T(lang, 'Vuelves a `/admin/billing`. Solo vuelves al origen de tu propia instancia.', 'You return to `/admin/billing`. You can only return to your own instance origin.'),
    ] },
    { t: 'table', head: [T(lang, 'Estado', 'Status'), T(lang, 'Significado', 'Meaning')], rows: [
        [T(lang, 'pendiente', 'pending'), T(lang, 'PayPal aún no confirmó la captura. Puede tardar unos segundos o minutos; se reconcilia sola.', 'PayPal has not confirmed the capture yet. It can take seconds or minutes; it reconciles itself.')],
        ['ok', T(lang, 'Cobro confirmado por PayPal y licencia concedida.', 'Charge confirmed by PayPal and license granted.')],
        [T(lang, 'fallido', 'failed'), T(lang, 'Pago rechazado, cancelado o caducado. No se concede nada; puedes intentarlo otra vez.', 'Payment declined, cancelled or expired. Nothing is granted; you can try again.')],
    ] },
    { t: 'p', text: T(lang,
        'Nunca se concede una licencia sin una captura **COMPLETED** confirmada por PayPal; si cierras la ventana a medias, el webhook y la conciliación periódica terminan el trabajo.',
        'A license is never granted without a **COMPLETED** capture confirmed by PayPal; if you close the window midway, the webhook and periodic reconciliation finish the job.') },

    { t: 'h2', id: 'install', text: T(lang, 'Instalación y permisos', 'Installation and permissions') },
    { t: 'p', text: T(lang,
        'Tras el pago la extensión se instala en tu dominio, pero queda **pendiente de aprobación** hasta que revises y apruebes sus permisos (igual que cualquier extensión, ver [Extensiones](/docs/expansions)). Si la extensión pide permisos nuevos en una versión posterior, debes aprobarlos de nuevo.',
        'After payment the extension is installed on your domain but stays **pending approval** until you review and approve its permissions (like any extension, see [Extensions](/docs/expansions)). If a later version asks for new permissions you must approve them again.') },

    { t: 'h2', id: 'revoked', text: T(lang, 'Licencia revocada', 'Revoked license') },
    { t: 'p', text: T(lang,
        'Un **reembolso** o un **contracargo** revoca la licencia. La extensión se **pausa** (deja de ejecutarse y de instalarse) pero **tus datos no se borran**: si vuelves a comprarla, todo sigue ahí.',
        'A **refund** or a **chargeback** revokes the license. The extension is **paused** (stops running and installing) but **your data is not deleted**: if you buy it again everything is still there.') },

    { t: 'h2', id: 'subscriptions', text: T(lang, 'Suscripciones', 'Subscriptions') },
    { t: 'table', head: [T(lang, 'Situación', 'Situation'), T(lang, 'Qué ocurre', 'What happens')], rows: [
        [T(lang, 'Prueba', 'Trial'), T(lang, 'Acceso completo durante la prueba (0 a 30 días); el primer cobro llega al terminar.', 'Full access during the trial (0 to 30 days); the first charge arrives at its end.')],
        [T(lang, 'Renovación', 'Renewal'), T(lang, 'PayPal cobra cada ciclo y BloomX lo registra. El acceso se extiende al siguiente periodo.', 'PayPal charges each cycle and BloomX records it. Access extends to the next period.')],
        [T(lang, 'Fallo de pago', 'Payment failure'), T(lang, '**Periodo de gracia de 3 días** (`PAYMENTS_GRACE_DAYS`) con la extensión activa; si no se cobra, la extensión se **pausa**.', '**3-day grace period** (`PAYMENTS_GRACE_DAYS`) with the extension active; if the charge does not go through, the extension is **paused**.')],
        [T(lang, 'Cancelar', 'Cancel'), T(lang, 'Mantiene el acceso **hasta el fin del periodo ya pagado**. No hay reembolso del periodo en curso.', 'Keeps access **until the end of the already-paid period**. The current period is not refunded.')],
        [T(lang, 'Reanudar', 'Resume'), T(lang, 'Crea una **suscripción nueva**, sin una segunda prueba gratuita.', 'Creates a **new subscription**, without a second free trial.')],
        [T(lang, 'Cambiar mensual a anual (o al revés)', 'Switch monthly to yearly (or back)'), T(lang, 'Rige **desde el siguiente ciclo**, sin cobro doble: PayPal no prorratea.', 'Takes effect **from the next cycle**, with no double charge: PayPal does not prorate.')],
    ] },

    { t: 'h3', id: 'price-change', text: T(lang, 'Aprobar un cambio de precio', 'Approving a price change') },
    { t: 'p', text: T(lang,
        'Los planes de PayPal son inmutables. Si el desarrollador sube el precio, **sigues pagando el precio anterior** hasta que apruebes el nuevo; la página te muestra un aviso y un botón de aprobación que te lleva a PayPal. Si no lo apruebas, tu precio actual no cambia.',
        'PayPal plans are immutable. If the developer raises the price, **you keep paying the old price** until you approve the new one; the page shows a notice and an approval button that takes you to PayPal. If you do not approve, your current price does not change.') },

    { t: 'h2', id: 'summary', text: T(lang, 'Resumen de ingresos y egresos', 'Income and expenses summary') },
    { t: 'p', text: T(lang,
        'El resumen se calcula sobre un **rango de fechas** que eliges (por defecto 30 días, máximo 366). Muestra lo que **gastaste** en extensiones y, si vendes, lo que **ganaste**.',
        'The summary is computed over a **date range** you choose (30 days by default, at most 366). It shows what you **spent** on extensions and, if you sell, what you **earned**.') },
    { t: 'ul', items: [
        T(lang, '**Ventas por extensión:** unidades, bruto, tu parte y reembolsos.', '**Sales per extension:** units, gross, your share and refunds.'),
        T(lang, '**MRR y bajas** de tus suscripciones (ingreso mensual recurrente y cancelaciones).', '**MRR and churn** of your subscriptions (monthly recurring revenue and cancellations).'),
        T(lang, '**Historial** de compras, pagos y reembolsos, con paginación.', '**History** of purchases, payouts and refunds, paginated.'),
    ] },

    { t: 'h2', id: 'balance', text: T(lang, 'Saldo: disponible, retenido y pagado', 'Balance: available, held and paid') },
    { t: 'table', head: [T(lang, 'Saldo', 'Balance'), T(lang, 'Qué es', 'What it is')], rows: [
        [T(lang, 'Retenido', 'Held'), T(lang, 'Tu parte de ventas recientes, aún dentro de los 14 días de retención.', 'Your share of recent sales, still inside the 14-day hold.')],
        [T(lang, 'Disponible', 'Available'), T(lang, 'Ya cumplió la retención; se paga en el siguiente ciclo si supera el mínimo.', 'Past the hold; paid in the next cycle if it exceeds the minimum.')],
        [T(lang, 'Pagado', 'Paid'), T(lang, 'Lo que PayPal Payouts ya envió a tu cuenta.', 'What PayPal Payouts already sent to your account.')],
    ] },
    { t: 'p', text: T(lang,
        'Si un reembolso deja tu saldo en negativo, se **compensa** con las ventas siguientes. Reglas de reparto y retención en la [Guía de desarrollador](/docs/developer-guide#split).',
        'If a refund leaves your balance negative, it is **offset** against your following sales. Split and hold rules are in the [Developer guide](/docs/developer-guide#split).') },

    { t: 'h2', id: 'export', text: T(lang, 'CSV y recibos', 'CSV and receipts') },
    { t: 'ul', items: [
        T(lang, '**CSV** de compras, ventas, pagos o libro mayor. Las celdas que podrían interpretarse como fórmulas se neutralizan para que abrirlo en una hoja de cálculo sea seguro.', '**CSV** of purchases, sales, payouts or ledger. Cells that could be interpreted as formulas are neutralised so opening them in a spreadsheet is safe.'),
        T(lang, '**Recibo** por cada compra o cobro, para tu contabilidad. No sustituye a un comprobante fiscal: las obligaciones tributarias son tuyas.', '**Receipt** for each purchase or charge, for your bookkeeping. It does not replace a tax document: tax obligations are yours.'),
    ] },

    { t: 'h2', id: 'paypal-account', text: T(lang, 'Vincular o cambiar tu cuenta de PayPal', 'Link or change your PayPal account') },
    { t: 'p', text: T(lang,
        'Para cobrar como desarrollador vinculas tu cuenta con **Log in with PayPal**. Es **solo una prueba de propiedad**: BloomX guarda el identificador de pagador y el correo verificado, y **descarta los tokens al instante** (no se almacenan).',
        'To get paid as a developer you link your account with **Log in with PayPal**. It is **proof of ownership only**: BloomX stores the payer identifier and verified email, and **discards the tokens immediately** (they are not stored).') },
    { t: 'ul', items: [
        T(lang, '**Cambiar** la cuenta exige **step-up**. Se envía un **correo al dueño y a los super admins** de la plataforma.', '**Changing** the account requires **step-up**. An **email goes to the owner and the platform super admins**.'),
        T(lang, 'Los **pagos pendientes siguen yendo a la cuenta anterior durante 24 h** (`PAYMENTS_ACCOUNT_SWITCH_HOURS`); así, si alguien secuestra tu sesión, tienes tiempo de detectarlo.', '**Pending payouts keep going to the previous account for 24 h** (`PAYMENTS_ACCOUNT_SWITCH_HOURS`); so if someone hijacks your session you have time to notice.'),
        T(lang, 'El inicio de sesión usa un `state` de un solo uso que caduca en 10 minutos.', 'The login uses a single-use `state` that expires in 10 minutes.'),
    ] },

    { t: 'h2', id: 'see-also', text: T(lang, 'Véase también', 'See also') },
    { t: 'ul', items: [
        T(lang, '[Guía de desarrollador](/docs/developer-guide) para publicar y fijar precios.', '[Developer guide](/docs/developer-guide) to publish and set prices.'),
        T(lang, '[Configuración de PayPal](/docs/billing-setup) para el operador.', '[PayPal setup](/docs/billing-setup) for the operator.'),
        T(lang, '[Seguridad de pagos y marketplace](/docs/payments-security).', '[Payments and marketplace security](/docs/payments-security).'),
    ] },
];

const page: DocPageContent = { es: blocks('es'), en: blocks('en') };
export default page;
