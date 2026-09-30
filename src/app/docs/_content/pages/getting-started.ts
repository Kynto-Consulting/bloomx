import type { DocPageContent } from '../types';

const local = `git clone <tu-repositorio>/bloomx && cd bloomx
npm install                       # postinstall ejecuta prisma generate
cp .env.example .env              # y completa lo mínimo (ver Variables de entorno)
npm run db:ensure                 # crea/actualiza tablas (también corre solo en predev/prebuild/prestart)
npm run dev                       # http://localhost:3000`;

const localEn = `git clone <your-repository>/bloomx && cd bloomx
npm install                       # postinstall runs prisma generate
cp .env.example .env              # and fill in the minimum (see Environment variables)
npm run db:ensure                 # creates/updates tables (also runs on predev/prebuild/prestart)
npm run dev                       # http://localhost:3000`;

const keys = `node scripts/gen-domain-keypair.mjs
# Imprime:
#   BLOOMX_DOMAIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"   <- variable SECRETA del frontend
#   signingPublicKey: <clave pública base64url>                                                    <- se registra en el backend`;

const keysEn = keys
    .replace('# Imprime:', '# Prints:')
    .replace('<- variable SECRETA del frontend', '<- SECRET frontend variable')
    .replace('<clave pública base64url>', '<public key base64url>')
    .replace('<- se registra en el backend', '<- registered on the backend');

const page: DocPageContent = {
    es: [
        { t: 'p', text: 'De cero a un BloomX funcionando, en el orden en que conviene hacerlo. Cada paso enlaza con la página que lo detalla.' },
        { t: 'h2', id: 'checklist', text: 'Lista de verificación' },
        { t: 'ol', items: [
            'Decide el modelo: usar el backend compartido de otra organización, o desplegar el tuyo ([Arquitectura](/docs/architecture)).',
            'Crea una base de datos PostgreSQL para el frontend (y otra para el backend si lo despliegas).',
            'Crea una cuenta de Resend, verifica tu dominio y obtén una clave de API ([Correo: Resend y DNS](/docs/email-setup)).',
            'Crea un bucket S3-compatible (S3, R2, B2, MinIO) para adjuntos ([Almacenamiento](/docs/storage)).',
            'Define las variables de entorno ([Variables de entorno](/docs/env-variables)).',
            'Ejecuta `npm run db:ensure` contra la base de datos de destino.',
            'Despliega ([Despliegue](/docs/deployment)).',
            'Registra tu dominio en el backend y la clave pública Ed25519 de tu instancia ([API del backend](/docs/api-backend#register-key)).',
            'Configura los webhooks de Resend, el DNS y los crons.',
            'Pruébalo con el checklist final de esta página.',
        ] },
        { t: 'h2', id: 'local', text: 'Desarrollo local' },
        { t: 'code', lang: 'bash', title: 'Arranque local', code: local },
        { t: 'ul', items: [
            'Necesitas una versión de Node compatible con Next.js (20 o superior recomendada) y una base PostgreSQL accesible.',
            '`predev`, `prebuild` y `prestart` ejecutan `tsx scripts/ensure-schema.ts`, así que las tablas se crean solas. Sin `DATABASE_URL` solo emite un aviso y sale con código 0.',
            'Sin `S3_ACCESS_KEY`/`S3_BUCKET` el almacenamiento cae a disco local (`.gemini/storage`): solo para desarrollo.',
            'Para probar un tema de empresa sin backend usa `NEXT_PUBLIC_BLOOMX_THEME_OVERRIDE` ([Temas](/docs/themes#local)).',
            'Para un entorno E2E totalmente local (Postgres embebido, Resend y backend falsos) ve [Operación](/docs/operations#e2e).',
        ] },
        { t: 'h2', id: 'first-user', text: 'Primer usuario y administración' },
        { t: 'ol', items: [
            'Define `REGISTRATION_KEY` (en producción, si falta o vale `dev-secret`, el registro responde 403) y abre `/register`.',
            'Para acceder a las rutas de administración, añade tu correo a `ADMIN_EMAILS`: la cuenta debe activar **MFA TOTP** (obligatorio para administradores) antes de usar `api/admin/*`.',
            'El panel de administración del dominio (marca, tema, landing, extensiones) usa la sesión de **manager** del backend: entra por `/admin/login` (o crea el manager y el dominio en `/admin/register`).',
        ] },
        { t: 'callout', kind: 'note', text: 'Registrar el dominio en el backend crea el manager y el dominio; el alta usa `register-domain` + `verify-domain` con un OTP de 6 dígitos enviado por correo. Ver [API del backend](/docs/api-backend#examples).' },
        { t: 'h2', id: 'signing-keys', text: 'Clave de firma de la instancia (recomendado)' },
        { t: 'p', text: 'Sin clave, tu dominio funciona en **modo legado** (sin `EMAIL_RECEIVED`, sin `services.mail`; las extensiones siguen usando sus credenciales y el panel muestra un aviso para registrar la clave). Para el modo firmado:' },
        { t: 'code', lang: 'bash', title: 'Generar el par Ed25519', code: keys },
        { t: 'ol', items: [
            'Guarda `BLOOMX_DOMAIN_PRIVATE_KEY` en el entorno del frontend (nunca en git).',
            'Registra la clave pública: `signingPublicKey` en `verify-domain`, o `POST /api/manager/domain-key` con la sesión del manager.',
            'Comprueba que el backend ya no responde `X-BloomX-Auth: legacy` a tus peticiones.',
        ] },
        { t: 'h2', id: 'final-check', text: 'Checklist final' },
        { t: 'ul', items: [
            '`GET /api/config` del frontend devuelve la marca y las extensiones de tu dominio (no la config por defecto "BloomX Default").',
            'Puedes registrarte, iniciar sesión y activar MFA.',
            'Un correo enviado a tu dominio aparece en la bandeja (webhook de Resend + MX).',
            'Un correo enviado desde BloomX llega y muestra `SPF=PASS`, `DKIM=PASS` y `DMARC=PASS`.',
            'Adjuntar y descargar un archivo funciona (almacenamiento).',
            'El cron diario responde 200 con `CRON_SECRET` ([Despliegue](/docs/deployment#cron)).',
            'Las extensiones que instalaste funcionan (si hay hooks, tu dominio debe estar en modo firmado).',
        ] },
    ],
    en: [
        { t: 'p', text: 'From zero to a working BloomX, in the order that makes sense. Each step links to the page that details it.' },
        { t: 'h2', id: 'checklist', text: 'Checklist' },
        { t: 'ol', items: [
            'Decide the model: use another organisation\'s shared backend, or deploy your own ([Architecture](/docs/architecture)).',
            'Create a PostgreSQL database for the frontend (and another for the backend if you deploy it).',
            'Create a Resend account, verify your domain and get an API key ([Email: Resend and DNS](/docs/email-setup)).',
            'Create an S3-compatible bucket (S3, R2, B2, MinIO) for attachments ([Storage](/docs/storage)).',
            'Set the environment variables ([Environment variables](/docs/env-variables)).',
            'Run `npm run db:ensure` against the target database.',
            'Deploy ([Deployment](/docs/deployment)).',
            'Register your domain on the backend and your instance\'s Ed25519 public key ([Backend API](/docs/api-backend#register-key)).',
            'Configure the Resend webhooks, DNS and crons.',
            'Test it with this page\'s final checklist.',
        ] },
        { t: 'h2', id: 'local', text: 'Local development' },
        { t: 'code', lang: 'bash', title: 'Local start', code: localEn },
        { t: 'ul', items: [
            'You need a Node version compatible with Next.js (20 or newer recommended) and a reachable PostgreSQL database.',
            '`predev`, `prebuild` and `prestart` run `tsx scripts/ensure-schema.ts`, so tables are created automatically. Without `DATABASE_URL` it only warns and exits with code 0.',
            'Without `S3_ACCESS_KEY`/`S3_BUCKET` storage falls back to local disk (`.gemini/storage`): development only.',
            'To try a company theme without a backend use `NEXT_PUBLIC_BLOOMX_THEME_OVERRIDE` ([Themes](/docs/themes#local)).',
            'For a fully local E2E environment (embedded Postgres, fake Resend and backend) see [Operations](/docs/operations#e2e).',
        ] },
        { t: 'h2', id: 'first-user', text: 'First user and administration' },
        { t: 'ol', items: [
            'Set `REGISTRATION_KEY` (in production, if missing or `dev-secret`, sign-up answers 403) and open `/register`.',
            'To reach the admin routes, add your email to `ADMIN_EMAILS`: the account must enable **TOTP MFA** (mandatory for admins) before using `api/admin/*`.',
            'The domain admin panel (brand, theme, landing, extensions) uses the backend **manager** session: sign in at `/admin/login` (or create the manager and domain at `/admin/register`).',
        ] },
        { t: 'callout', kind: 'note', text: 'Registering the domain on the backend creates the manager and the domain; sign-up uses `register-domain` + `verify-domain` with a 6-digit OTP sent by email. See [Backend API](/docs/api-backend#examples).' },
        { t: 'h2', id: 'signing-keys', text: 'Instance signing key (recommended)' },
        { t: 'p', text: 'Without a key your domain runs in **legacy mode** (no `EMAIL_RECEIVED`, no `services.mail`; extensions keep using their credentials and the panel shows a notice to register the key). For signed mode:' },
        { t: 'code', lang: 'bash', title: 'Generate the Ed25519 pair', code: keysEn },
        { t: 'ol', items: [
            'Store `BLOOMX_DOMAIN_PRIVATE_KEY` in the frontend environment (never in git).',
            'Register the public key: `signingPublicKey` in `verify-domain`, or `POST /api/manager/domain-key` with the manager session.',
            'Check that the backend no longer answers `X-BloomX-Auth: legacy` to your requests.',
        ] },
        { t: 'h2', id: 'final-check', text: 'Final checklist' },
        { t: 'ul', items: [
            'The frontend\'s `GET /api/config` returns your domain\'s brand and extensions (not the default "BloomX Default" config).',
            'You can sign up, sign in and enable MFA.',
            'A mail sent to your domain shows in the inbox (Resend webhook + MX).',
            'A mail sent from BloomX arrives and shows `SPF=PASS`, `DKIM=PASS` and `DMARC=PASS`.',
            'Attaching and downloading a file works (storage).',
            'The daily cron answers 200 with `CRON_SECRET` ([Deployment](/docs/deployment#cron)).',
            'The extensions you installed work (if they have hooks, your domain must be in signed mode).',
        ] },
    ],
};

export default page;
