import type { DocPageContent } from '../types';

const dns = `# Ejemplos de forma (usa SIEMPRE los valores exactos que te muestre Resend)
TXT    @            v=spf1 include:<lo-que-indique-resend> ~all          # un solo SPF por dominio
CNAME  <selector>   <valor-DKIM-de-resend>                                # DKIM: tal cual, sin editar
TXT    _dmarc       v=DMARC1; p=none; rua=mailto:dmarc@tu-dominio.com; adkim=r; aspf=r; pct=100
MX     <host>       <prioridad> <destino-MX-de-resend>                    # solo si recibes correo con Resend`;

const dnsEn = dns
    .replace('# Ejemplos de forma (usa SIEMPRE los valores exactos que te muestre Resend)', '# Shape examples (ALWAYS use the exact values Resend shows you)')
    .replace('<lo-que-indique-resend>', '<what-resend-tells-you>')
    .replace('# un solo SPF por dominio', '# one SPF per domain')
    .replace('<valor-DKIM-de-resend>', '<resend-DKIM-value>')
    .replace('# DKIM: tal cual, sin editar', '# DKIM: as-is, do not edit')
    .replace('mailto:dmarc@tu-dominio.com', 'mailto:dmarc@your-domain.com')
    .replace('<destino-MX-de-resend>', '<resend-MX-target>')
    .replace('# solo si recibes correo con Resend', '# only if you receive mail with Resend');

const mta = `TXT  _mta-sts    v=STSv1; id=20260101000000
TXT  _smtp._tls   v=TLSRPTv1; rua=mailto:tlsrpt@tu-dominio.com

# https://mta-sts.tu-dominio.com/.well-known/mta-sts.txt   (certificado válido, sin redirecciones)
version: STSv1
mode: testing
mx: <host MX exacto que te da Resend>
max_age: 86400`;

const mtaEn = mta
    .replace('tlsrpt@tu-dominio.com', 'tlsrpt@your-domain.com')
    .replace('https://mta-sts.tu-dominio.com', 'https://mta-sts.your-domain.com')
    .replace('(certificado válido, sin redirecciones)', '(valid certificate, no redirects)')
    .replace('<host MX exacto que te da Resend>', '<exact MX host Resend gives you>');

const page: DocPageContent = {
    es: [
        { t: 'p', text: 'BloomX usa **Resend** para enviar y recibir. No habla IMAP/SMTP: el correo entrante llega por webhook y el saliente sale por la API de Resend. La guía completa y ampliada también está en `DNS_SETUP.md` del repositorio.' },
        { t: 'h2', id: 'resend', text: 'Configurar Resend' },
        { t: 'ol', items: [
            'En Resend añade el dominio con el que enviarás (por ejemplo `mail.tu-dominio.com`) y **publica exactamente** los registros que te indique (SPF/verificación, DKIM, y MX si recibirás correo). No cambies nombres, prioridades ni valores.',
            'Espera a que Resend marque el dominio como verificado antes de enviar tráfico real.',
            'Crea una clave de API y guárdala en `RESEND_API_KEY` del frontend.',
            'Define `TOP_DOMAIN` con ese dominio: BloomX genera correos del sistema como `noreply@<TOP_DOMAIN>`.',
            'Crea los **dos webhooks** descritos abajo.',
        ] },
        { t: 'callout', kind: 'warn', title: 'Un buzón por dominio', text: 'Publicar los `MX` de Resend en el dominio raíz **reemplaza** cualquier otro proveedor de correo entrante (Google Workspace, Microsoft 365). Si ya recibes correo en ese dominio, usa un subdominio dedicado (por ejemplo `mail.tu-dominio.com`) y ajusta `TOP_DOMAIN`. Mantén un solo conjunto de MX por dominio o subdominio.' },
        { t: 'h2', id: 'webhooks', text: 'Webhooks de Resend' },
        { t: 'table', head: ['Webhook', 'Eventos', 'Variable de firma (opcional)'], rows: [
            ['`https://<tu-host>/api/webhooks/resend`', '`email.received` (correo entrante) y estados de entrega (`email.sent`, `email.delivered`, `email.bounced`, `email.complained`, `email.delivery_delayed`)', '`WEBHOOK_SECRET` (`whsec_…`)'],
            ['`https://<tu-host>/api/webhooks/resend-events`', 'Rebotes y quejas: `email.bounced`, `email.complained`, `email.delivery_delayed`', '`RESEND_WEBHOOK_SECRET` (`whsec_…`)'],
        ] },
        { t: 'ul', items: [
            '**Los secretos son opcionales y los decide cada organizador.** Con `WEBHOOK_SECRET` se exige una firma Svix válida en `/api/webhooks/resend` (400 si no); sin él, la petición se acepta sin firma y solo se escribe un aviso en el log. Lo mismo para `RESEND_WEBHOOK_SECRET` en `resend-events`. Cada webhook de Resend tiene su propio secreto: copia el de cada uno en su variable. **Recomendado en producción**: sin firma, cualquiera que conozca la URL podría inyectar correos o bajas.',
            'Sin el segundo webhook, los rebotes permanentes y las quejas **no** alimentan la lista de supresión de Elixir.',
            'La URL debe ser pública y https. Si el webhook responde 500, Resend reintenta (por diseño en `resend-events`).',
            'Al recibir un correo BloomX: lo guarda (idempotente), resuelve To/Cc/Bcc, etiqueta por alias/regex y reglas, puntúa spam con `Authentication-Results`, procesa adjuntos en segundo plano y dispara el hook `EMAIL_RECEIVED` si tu dominio está en modo firmado.',
        ] },
        { t: 'diagram', id: 'mail-flow', caption: 'Flujo del correo entrante y saliente.' },
        { t: 'h2', id: 'dns', text: 'DNS: SPF, DKIM y DMARC' },
        { t: 'code', lang: 'dns', title: 'Registros (formas)', code: dns },
        { t: 'ul', items: [
            '**SPF**: un único registro por dominio. Si usas otros proveedores, combínalos dentro del mismo SPF. Máximo 10 consultas DNS (`include`, `a`, `mx`, `redirect`); si pasas, hay `permerror` y DMARC falla. Usa `-all` (o `~all` mientras pruebas), nunca `+all`.',
            '**DKIM**: obligatorio. Publica todos los registros que entregue Resend, sin editar el selector ni convertir `CNAME` en `TXT`. Claves de 2048 bits y rotación del selector cada 6–12 meses.',
            '**DMARC**: empieza con `p=none` y alineación **relajada** (`adkim=r; aspf=r`). No uses alineación estricta al inicio: Resend enruta con un subdominio (return-path) y con `aspf=s` el SPF no alinea. Tras 2–4 semanas de reportes `rua` sube a `p=quarantine; pct=25`, luego `pct=100` y por último `p=reject` (con `sp=reject` para subdominios que no envían).',
            'Los reportes DMARC (`rua`) llegan a un buzón real. Si tu dominio apunta a BloomX, llegan como `.zip`/`.gz` al usuario `dmarc`, que debe existir.',
            'Envía con un `From:` del mismo dominio autenticado. Evita mandar desde `gmail.com` u otros dominios ajenos.',
        ] },
        { t: 'h2', id: 'mta-sts', text: 'MTA-STS y TLS-RPT' },
        { t: 'p', text: 'Para **exigir** TLS a quienes te envían correo (BloomX recibe a través de Resend, que negocia TLS de forma oportunista):' },
        { t: 'code', lang: 'dns', title: 'MTA-STS y TLS-RPT', code: mta },
        { t: 'ul', items: [
            'BloomX **no sirve** el archivo de política ni ninguna ruta MTA-STS/TLS-RPT: debes alojar `mta-sts.tu-dominio.com` tú (un host estático). La única ruta `/.well-known` de BloomX es `bloomx-backend-key.json` (clave de firma del backend) y no tiene relación.',
            'Empieza con `mode: testing`; cuando los reportes no muestren fallos pasa a `enforce` y sube `max_age` (604800 o más). **Cada vez que cambies la política, cambia el `id`.**',
            'Si no puedes alojar la política, omite MTA-STS (un `id` publicado sin política accesible causa fallos de entrega). TLS-RPT sí puede publicarse siempre.',
        ] },
        { t: 'h2', id: 'others', text: 'Otros registros recomendados' },
        { t: 'ul', items: [
            '**DNSSEC** en el dominio, para proteger SPF/DKIM/DMARC/MTA-STS de respuestas DNS falsas.',
            '**CAA** para limitar las autoridades que pueden emitir certificados (`CAA 0 issue "letsencrypt.org"`).',
            '**BIMI** (opcional): requiere DMARC con `p=quarantine` o `p=reject`. **ARC** solo si reenvías o alojas listas: BloomX no firma ARC.',
            'Esto son recomendaciones de DNS genéricas; el código de BloomX no las comprueba.',
        ] },
        { t: 'h2', id: 'verify', text: 'Verificar antes de escalar' },
        { t: 'ul', items: [
            'Envía a Gmail, Outlook y una cuenta corporativa y confirma `SPF=PASS`, `DKIM=PASS` y `DMARC=PASS` (BloomX muestra una insignia con el veredicto de la cabecera `Authentication-Results`, si Resend la incluye).',
            'Usa Mail-Tester, MXToolbox o Google Postmaster Tools.',
            'Calienta el dominio: sube el volumen de forma gradual durante 2–4 semanas.',
            'Para envíos masivos: Gmail y Yahoo exigen SPF/DKIM/DMARC alineados, quejas < 0,3 % y baja de un clic. Los envíos de Elixir incluyen `List-Unsubscribe` y `List-Unsubscribe-Post` (RFC 8058) si `NEXT_PUBLIC_APP_URL` es https público y hay secreto (`UNSUBSCRIBE_SECRET` o `NEXTAUTH_SECRET`).',
        ] },
    ],
    en: [
        { t: 'p', text: 'BloomX uses **Resend** to send and receive. It does not speak IMAP/SMTP: inbound mail arrives by webhook and outbound leaves through Resend\'s API. The full extended guide is also in the repository\'s `DNS_SETUP.md`.' },
        { t: 'h2', id: 'resend', text: 'Configuring Resend' },
        { t: 'ol', items: [
            'In Resend add the domain you will send from (for example `mail.your-domain.com`) and **publish exactly** the records it tells you (SPF/verification, DKIM, and MX if you will receive mail). Do not change names, priorities or values.',
            'Wait for Resend to mark the domain as verified before sending real traffic.',
            'Create an API key and store it in the frontend\'s `RESEND_API_KEY`.',
            'Set `TOP_DOMAIN` to that domain: BloomX generates system mail such as `noreply@<TOP_DOMAIN>`.',
            'Create the **two webhooks** described below.',
        ] },
        { t: 'callout', kind: 'warn', title: 'One mailbox provider per domain', text: 'Publishing Resend\'s `MX` on the root domain **replaces** any other inbound provider (Google Workspace, Microsoft 365). If you already receive mail on that domain, use a dedicated subdomain (for example `mail.your-domain.com`) and adjust `TOP_DOMAIN`. Keep a single MX set per domain or subdomain.' },
        { t: 'h2', id: 'webhooks', text: 'Resend webhooks' },
        { t: 'table', head: ['Webhook', 'Events', 'Signing variable (optional)'], rows: [
            ['`https://<your-host>/api/webhooks/resend`', '`email.received` (inbound mail) and delivery states (`email.sent`, `email.delivered`, `email.bounced`, `email.complained`, `email.delivery_delayed`)', '`WEBHOOK_SECRET` (`whsec_…`)'],
            ['`https://<your-host>/api/webhooks/resend-events`', 'Bounces and complaints: `email.bounced`, `email.complained`, `email.delivery_delayed`', '`RESEND_WEBHOOK_SECRET` (`whsec_…`)'],
        ] },
        { t: 'ul', items: [
            '**The secrets are optional and each organiser decides.** With `WEBHOOK_SECRET` a valid Svix signature is required at `/api/webhooks/resend` (400 otherwise); without it the request is accepted unsigned and only a log warning is written. Same for `RESEND_WEBHOOK_SECRET` on `resend-events`. Each Resend webhook has its own secret: copy each one into its variable. **Recommended in production**: without a signature, anyone who knows the URL could inject mail or unsubscribes.',
            'Without the second webhook, permanent bounces and complaints do **not** feed Elixir\'s suppression list.',
            'The URL must be public https. If the webhook answers 500, Resend retries (by design in `resend-events`).',
            'When BloomX receives a message it stores it (idempotently), resolves To/Cc/Bcc, labels by alias/regex and rules, scores spam using `Authentication-Results`, processes attachments in the background and fires the `EMAIL_RECEIVED` hook if your domain is in signed mode.',
        ] },
        { t: 'diagram', id: 'mail-flow', caption: 'Inbound and outbound mail flow.' },
        { t: 'h2', id: 'dns', text: 'DNS: SPF, DKIM and DMARC' },
        { t: 'code', lang: 'dns', title: 'Records (shapes)', code: dnsEn },
        { t: 'ul', items: [
            '**SPF**: a single record per domain. If you use other providers, merge them into the same SPF. At most 10 DNS lookups (`include`, `a`, `mx`, `redirect`); beyond that it is a `permerror` and DMARC fails. Use `-all` (or `~all` while testing), never `+all`.',
            '**DKIM**: mandatory. Publish every record Resend gives you, without editing the selector or turning `CNAME` into `TXT`. 2048-bit keys and selector rotation every 6–12 months.',
            '**DMARC**: start with `p=none` and **relaxed** alignment (`adkim=r; aspf=r`). Do not use strict alignment at first: Resend routes through a subdomain (return-path) and with `aspf=s` SPF does not align. After 2–4 weeks of `rua` reports move to `p=quarantine; pct=25`, then `pct=100` and finally `p=reject` (with `sp=reject` for subdomains that do not send).',
            'DMARC reports (`rua`) go to a real mailbox. If your domain points at BloomX they arrive as `.zip`/`.gz` to the `dmarc` user, which must exist.',
            'Send with a `From:` from the same authenticated domain. Avoid sending from `gmail.com` or other foreign domains.',
        ] },
        { t: 'h2', id: 'mta-sts', text: 'MTA-STS and TLS-RPT' },
        { t: 'p', text: 'To **require** TLS from those who send you mail (BloomX receives through Resend, which negotiates TLS opportunistically):' },
        { t: 'code', lang: 'dns', title: 'MTA-STS and TLS-RPT', code: mtaEn },
        { t: 'ul', items: [
            'BloomX does **not serve** the policy file or any MTA-STS/TLS-RPT route: you host `mta-sts.your-domain.com` yourself (a static host). BloomX\'s only `/.well-known` route is `bloomx-backend-key.json` (the backend\'s signing key), unrelated.',
            'Start with `mode: testing`; when reports show no failures move to `enforce` and raise `max_age` (604800 or more). **Change the `id` every time you change the policy.**',
            'If you cannot host the policy, skip MTA-STS (a published `id` without a reachable policy causes delivery failures). TLS-RPT can always be published.',
        ] },
        { t: 'h2', id: 'others', text: 'Other recommended records' },
        { t: 'ul', items: [
            '**DNSSEC** on the domain, to protect SPF/DKIM/DMARC/MTA-STS from forged DNS answers.',
            '**CAA** to limit which authorities may issue certificates (`CAA 0 issue "letsencrypt.org"`).',
            '**BIMI** (optional): requires DMARC with `p=quarantine` or `p=reject`. **ARC** only if you forward or host lists: BloomX does not sign ARC.',
            'These are generic DNS recommendations; BloomX\'s code does not check them.',
        ] },
        { t: 'h2', id: 'verify', text: 'Verify before scaling' },
        { t: 'ul', items: [
            'Send to Gmail, Outlook and a corporate account and confirm `SPF=PASS`, `DKIM=PASS` and `DMARC=PASS` (BloomX shows a badge with the `Authentication-Results` header verdict, if Resend includes it).',
            'Use Mail-Tester, MXToolbox or Google Postmaster Tools.',
            'Warm up the domain: raise volume gradually over 2–4 weeks.',
            'For bulk sending: Gmail and Yahoo require aligned SPF/DKIM/DMARC, complaints < 0.3 % and one-click unsubscribe. Elixir sends include `List-Unsubscribe` and `List-Unsubscribe-Post` (RFC 8058) if `NEXT_PUBLIC_APP_URL` is a public https URL and a secret exists (`UNSUBSCRIBE_SECRET` or `NEXTAUTH_SECRET`).',
        ] },
    ],
};

export default page;
