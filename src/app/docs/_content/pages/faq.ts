import type { Block, DocPageContent } from '../types';

type QA = { id: string; q: string; a: string };

const esQa: QA[] = [
    { id: 'imap', q: '¿BloomX funciona con Gmail, Outlook o IMAP?', a: 'No como buzones. El correo entra por **webhook de Resend** y sale por la **API de Resend**; no hay cliente IMAP/SMTP. Sí existe la sincronización de calendario y contactos de Google (unidireccional). Ver [Arquitectura](/docs/architecture#mail-flow).' },
    { id: 'backend-propio', q: '¿Necesito desplegar mi propio backend?', a: 'No necesariamente. El backend es **compartido y multi-tenant**: puedes registrar tu dominio en uno existente (`register-domain` + `verify-domain`). Si lo despliegas tú, consulta [Despliegue](/docs/deployment#vercel-backend).' },
    { id: 'secretos', q: '¿Qué secretos tengo que compartir entre frontend y backend?', a: 'Ninguno. Cada frontend usa su propio `NEXTAUTH_SECRET`; la autenticación hacia el backend es con la clave Ed25519 de tu instancia. Ver [Arquitectura](/docs/architecture#trust).' },
    { id: 'legacy', q: '¿Qué es el "modo legado"?', a: 'Si tu dominio no tiene clave pública registrada, el backend acepta cabeceras sin firma, sin services privilegiados (`EMAIL_RECEIVED`, `CRON`, `services.mail`); las extensiones siguen usando sus credenciales y cada ejecución se audita. Responde `X-BloomX-Auth: legacy`. Registra tu clave para salir de él ([protocolo](/docs/api-backend#register-key)).' },
    { id: 'webhook-secret', q: '¿Es obligatorio `WEBHOOK_SECRET`?', a: 'No: es opcional y lo decide cada organizador. Con él se exige firma Svix válida; sin él el webhook se acepta sin firma (aviso en el log). En producción se recomienda definirlo. Lo mismo vale para `RESEND_WEBHOOK_SECRET`. Ver [Correo](/docs/email-setup#webhooks).' },
    { id: 'login-503', q: 'El login de un administrador da 503', a: 'Falta la tabla `UserMfa`. Ejecuta `npm run db:ensure` en la base de datos de destino.' },
    { id: 'mfa', q: '¿Quién tiene MFA obligatorio?', a: 'Los correos de `ADMIN_EMAILS` (desactivable con `MFA_ENFORCE_ADMIN=false`) y todos si `MFA_REQUIRED_ALL=true`. Es TOTP con códigos de recuperación. Ver [Seguridad](/docs/security#mfa).' },
    { id: 'rotar-secreto', q: '¿Puedo rotar `NEXTAUTH_SECRET`?', a: 'Sí, pero cierra todas las sesiones. Antes fija `MFA_RECOVERY_PEPPER` y una `DATA_ENCRYPTION_KEY` dedicada si dependías de la reserva, o perderás los códigos de recuperación y el contenido cifrado.' },
    { id: 'elixir-cron', q: '¿Por qué mis campañas de Elixir no avanzan?', a: 'Elixir no tiene cron declarado en `vercel.json`. Configura un cron por minuto o un pinger externo sobre `/api/cron/elixir` con `Authorization: Bearer <CRON_SECRET>`. Ver [Despliegue](/docs/deployment#cron).' },
    { id: 'ttl-sellado', q: '¿Es seguro el envío sellado?', a: 'El contenido se cifra en tu navegador, pero **la clave viaja en el enlace del correo**. Sin contraseña, quien lea el correo puede descifrarlo; con contraseña compartida por otro canal, no. No admite adjuntos y evade el DLP. Ver [Sealer](/docs/sealer#limits).' },
    { id: 'extensiones-seguras', q: '¿Las extensiones están aisladas del sistema?', a: 'Parcialmente: corren en `worker_threads` con límites de memoria y tiempo y red filtrada, pero **no es una frontera fuerte**. Instala solo extensiones en las que confíes ([Extensiones](/docs/expansions#sandbox)).' },
    { id: 'tema-no-aplica', q: 'Mi tema de empresa no se ve', a: 'Comprueba que `GET /api/config` devuelve tu `theme`, que hay al menos un color (radio o fuente solos no crean temas de empresa) y que borraste la cookie `bloomx-theme`/`localStorage` del navegador si quieres ver `defaultMode`. Ver [Temas](/docs/themes).' },
    { id: 'contraste', q: 'El editor dice que mi color se corrigió', a: 'Con `autoFixContrast` activo (por defecto) el color que no llega a AA se sustituye por el más cercano que sí cumple. Si necesitas el tuyo tal cual, pon `autoFixContrast: false` (solo se avisa). Ver [Temas](/docs/themes#aa).' },
    { id: 'landing-se-pierde', q: 'Guardé el tema y se perdió la landing (o la paleta)', a: '`PUT /api/admin/domain` **reemplaza** el `theme` completo. Envía siempre el objeto completo (colores, `palette` y `landing`). Ver [Landing y login](/docs/landing).' },
    { id: 'ocultar-docs', q: '¿Cómo oculto esta documentación a mis usuarios?', a: 'Con `landing.docs.visible = false` ([Ocultar o mostrar docs](/docs/hide-docs)). Es ocultación de interfaz; no sustituye a no desplegarla.' },
    { id: 'undo-send', q: '¿Hay deshacer envío, posponer o cancelar programados?', a: 'No hay "deshacer envío" con retardo. Posponer (`snooze`) y cancelar un envío programado existen solo como API, sin interfaz. Ver [Funciones](/docs/features#compose).' },
    { id: 'offline-envio', q: '¿Puedo enviar sin conexión?', a: 'No: la cola offline solo cubre acciones por lote de la lista (archivar, borrar, marcar…). Enviar un correo sin red no se encola. Ver [Funciones](/docs/features#offline).' },
    { id: 'limites-adjuntos', q: '¿Qué tamaño de adjunto se admite?', a: 'Hasta 200 MB por archivo con subida previa, y 35 MB en total si van incrustados en base64 en el envío; hasta 25 adjuntos por correo.' },
    { id: 'claves-ia', q: '¿Qué variable configura la IA?', a: 'Ninguna: la IA se configura por instancia en `/admin/ai`. `AI_KEY`, `AI_PROVIDER` y `AI_MODEL` son un respaldo heredado y deprecado. Ver [IA](/docs/ai#migration).' },
    { id: 'idiomas', q: '¿Cómo añado un idioma?', a: 'Amplía `LOCALES`, crea el diccionario y regístralo; para la landing, amplía también `LANDING_LOCALES` en ambos repositorios. Ver [Funciones](/docs/features#i18n).' },
    { id: 'docs-desactualizada', q: 'Encontré algo que no coincide con el código', a: 'Esta documentación se verificó contra el código y un test comprueba enlaces y variables, pero puede quedar desfasada. El código manda: abre una incidencia indicando la página y la sección.' },
];

const enQa: QA[] = [
    { id: 'imap', q: 'Does BloomX work with Gmail, Outlook or IMAP?', a: 'Not as mailboxes. Mail enters through the **Resend webhook** and leaves through the **Resend API**; there is no IMAP/SMTP client. Google calendar and contacts sync does exist (one-way). See [Architecture](/docs/architecture#mail-flow).' },
    { id: 'backend-propio', q: 'Do I need to deploy my own backend?', a: 'Not necessarily. The backend is **shared and multi-tenant**: you can register your domain on an existing one (`register-domain` + `verify-domain`). If you deploy it yourself, see [Deployment](/docs/deployment#vercel-backend).' },
    { id: 'secretos', q: 'Which secrets must I share between frontend and backend?', a: 'None. Each frontend uses its own `NEXTAUTH_SECRET`; authentication towards the backend uses your instance\'s Ed25519 key. See [Architecture](/docs/architecture#trust).' },
    { id: 'legacy', q: 'What is "legacy mode"?', a: 'If your domain has no registered public key, the backend accepts unsigned headers without privileged services (`EMAIL_RECEIVED`, `CRON`, `services.mail`); extensions keep using their credentials and every run is audited. It answers `X-BloomX-Auth: legacy`. Register your key to leave it ([protocol](/docs/api-backend#register-key)).' },
    { id: 'webhook-secret', q: 'Is `WEBHOOK_SECRET` mandatory?', a: 'No: it is optional and each organiser decides. With it a valid Svix signature is required; without it the webhook is accepted unsigned (log warning). Setting it is recommended in production. The same goes for `RESEND_WEBHOOK_SECRET`. See [Email](/docs/email-setup#webhooks).' },
    { id: 'login-503', q: 'An admin\'s login gives 503', a: 'The `UserMfa` table is missing. Run `npm run db:ensure` against the target database.' },
    { id: 'mfa', q: 'Who has mandatory MFA?', a: 'The emails in `ADMIN_EMAILS` (turn off with `MFA_ENFORCE_ADMIN=false`) and everyone if `MFA_REQUIRED_ALL=true`. It is TOTP with recovery codes. See [Security](/docs/security#mfa).' },
    { id: 'rotar-secreto', q: 'Can I rotate `NEXTAUTH_SECRET`?', a: 'Yes, but it ends all sessions. First pin `MFA_RECOVERY_PEPPER` and a dedicated `DATA_ENCRYPTION_KEY` if you relied on the fallback, or you will lose recovery codes and encrypted content.' },
    { id: 'elixir-cron', q: 'Why do my Elixir campaigns not advance?', a: 'Elixir has no cron declared in `vercel.json`. Set a per-minute cron or an external pinger on `/api/cron/elixir` with `Authorization: Bearer <CRON_SECRET>`. See [Deployment](/docs/deployment#cron).' },
    { id: 'ttl-sellado', q: 'Is sealed sending secure?', a: 'Content is encrypted in your browser, but **the key travels in the email link**. Without a password, whoever reads the email can decrypt it; with a password shared through another channel, they cannot. It does not support attachments and bypasses DLP. See [Sealer](/docs/sealer#limits).' },
    { id: 'extensiones-seguras', q: 'Are extensions isolated from the system?', a: 'Partially: they run in `worker_threads` with memory and time limits and filtered network, but it is **not a strong boundary**. Only install extensions you trust ([Extensions](/docs/expansions#sandbox)).' },
    { id: 'tema-no-aplica', q: 'My company theme does not show', a: 'Check that `GET /api/config` returns your `theme`, that there is at least one colour (radius or font alone do not create company themes) and that you cleared the browser\'s `bloomx-theme` cookie/`localStorage` if you want to see `defaultMode`. See [Themes](/docs/themes).' },
    { id: 'contraste', q: 'The editor says my colour was corrected', a: 'With `autoFixContrast` on (default) a colour that does not reach AA is replaced by the nearest one that does. If you need yours as-is, set `autoFixContrast: false` (warning only). See [Themes](/docs/themes#aa).' },
    { id: 'landing-se-pierde', q: 'I saved the theme and lost the landing (or the palette)', a: '`PUT /api/admin/domain` **replaces** the whole `theme`. Always send the full object (colours, `palette` and `landing`). See [Landing and login](/docs/landing).' },
    { id: 'ocultar-docs', q: 'How do I hide this documentation from my users?', a: 'With `landing.docs.visible = false` ([Hide or show docs](/docs/hide-docs)). It is UI-level hiding; it does not replace not deploying it.' },
    { id: 'undo-send', q: 'Is there undo send, snooze or cancel for scheduled mail?', a: 'There is no delayed "undo send". Snooze and cancelling a scheduled send exist only as an API, without UI. See [Features](/docs/features#compose).' },
    { id: 'offline-envio', q: 'Can I send while offline?', a: 'No: the offline queue only covers list batch actions (archive, delete, mark…). Sending an email with no network is not queued. See [Features](/docs/features#offline).' },
    { id: 'limites-adjuntos', q: 'What attachment size is allowed?', a: 'Up to 200 MB per file with prior upload, and 35 MB in total if embedded as base64 in the send; up to 25 attachments per message.' },
    { id: 'claves-ia', q: 'Which variable configures AI?', a: 'None: AI is configured per instance in `/admin/ai`. `AI_KEY`, `AI_PROVIDER` and `AI_MODEL` are a legacy, deprecated fallback. See [AI](/docs/ai#migration).' },
    { id: 'idiomas', q: 'How do I add a language?', a: 'Extend `LOCALES`, create the dictionary and register it; for the landing also extend `LANDING_LOCALES` in both repositories. See [Features](/docs/features#i18n).' },
    { id: 'docs-desactualizada', q: 'I found something that does not match the code', a: 'This documentation was verified against the code and a test checks links and variables, but it can drift. The code wins: open an issue naming the page and section.' },
];

function blocks(qa: QA[]): Block[] {
    const out: Block[] = [];
    for (const x of qa) {
        out.push({ t: 'h3', id: x.id, text: x.q });
        out.push({ t: 'p', text: x.a });
    }
    return out;
}

const page: DocPageContent = { es: blocks(esQa), en: blocks(enQa) };
export default page;
