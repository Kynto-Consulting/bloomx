# Bloomx

> Correo web multi-empresa sobre **Resend**, con marca por dominio, backend compartido multi-tenant y motor de extensiones.
> Multi-company web mail on **Resend**, with per-domain branding, a shared multi-tenant backend and an extension engine.

La documentación completa (bilingüe es/en, con buscador) va **dentro de la app** en `/docs` (fuente: `src/app/docs/_content`). Este README es la guía corta de instalación.

## Cómo encaja todo

Piensa en Bloomx como una **franquicia**: el backend compartido (`bloomx-backend`) es la casa matriz (marca, registro de dominios, extensiones, cobros) y cada empresa abre su propio local (este frontend, con su base de datos y su `NEXTAUTH_SECRET`). El local no comparte secretos con la matriz: firma sus peticiones con su propia clave Ed25519 (opcional, recomendada).

- Correo entrante por webhook de Resend (`/api/webhooks/resend`) y saliente por API. No hay IMAP/SMTP.
- Marca, tema, landing y extensiones se administran desde `/admin`.

## Instalación (5 pasos)

### 1. Requisitos

- Node 20+ y una base **PostgreSQL** accesible.
- Una cuenta de [Resend](https://resend.com) con tu dominio verificado y una API key.
- Un bucket **S3-compatible** para adjuntos (ver [Almacenamiento](#almacenamiento-recomendado-backblaze-b2)).

### 2. Instalar y configurar el `.env`

```bash
npm install                 # postinstall ejecuta prisma generate
cp .env.example .env
```

El `.env` mínimo es corto: base de datos, almacenamiento y los datos propios de la instancia. Marca, dominio y correo del administrador **no** van aquí.

```bash
# Base de datos
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/bloomx"

# Almacenamiento S3-compatible
S3_ENDPOINT="https://s3.us-west-004.backblazeb2.com"
S3_REGION="us-west-004"
S3_ACCESS_KEY="..."
S3_SECRET_KEY="..."
S3_BUCKET="bloomx-uploads"

# Propios de esta instancia
NEXTAUTH_SECRET="<openssl rand -base64 48>"   # no se comparte con el backend
NEXT_PUBLIC_APP_URL="https://mail.tu-dominio.com"
NEXT_PUBLIC_BACKEND_URL="https://backend.bloomx.arubik.dev"
TOP_DOMAIN="tu-dominio.com"
REGISTRATION_KEY="<clave para el alta de usuarios>"   # en producción, si falta o es "dev-secret", /register responde 403

# Resend (ver nota abajo)
RESEND_API_KEY="re_xxxxxxxx"
```

> **Nota sobre `RESEND_API_KEY`.** El registro desde `/admin` guarda la clave de Resend en el **backend** (cifrada por dominio), pero el código actual de este frontend todavía la lee del entorno para enviar, recibir correo y procesar adjuntos (`src/lib/resend.ts`, webhook, Elixir). Por eso sigue en el `.env` mientras no se migre a leerla del backend. Usa la misma clave en ambos sitios.

### 3. Crear las tablas y arrancar

```bash
npm run db:ensure           # esquema idempotente y aditivo (también corre en predev/prebuild/prestart)
npm run dev                 # http://localhost:3000
```

### 4. Crear tu instancia desde `/admin`

Abre `/admin/register` y completa el formulario:

| Campo | Para qué |
|---|---|
| Nombre del dominio | Identifica tu empresa en el backend |
| Correo | Será el manager/administrador del dominio |
| Contraseña | Acceso al panel `/admin` |
| API key de Resend | Se guarda cifrada en el backend, por dominio |

Te llega un **OTP de 6 dígitos** por correo; lo introduces para verificar y quedas dentro de `/admin`. Desde ahí configuras marca, tema, landing, IA (`/admin/ai`) y extensiones. Los siguientes accesos son por `/admin/login`.

### 5. Webhooks de Resend, DNS y cron

Registra **dos** webhooks en Resend (URLs públicas https):

```text
POST https://tu-host/api/webhooks/resend          # email.received + estados de entrega
POST https://tu-host/api/webhooks/resend-events   # rebotes y quejas (alimenta la lista de supresión)
```

DNS (SPF, DKIM, DMARC, MX, MTA-STS, TLS-RPT): [DNS_SETUP.md](./DNS_SETUP.md) y `/docs/email-setup`.
Cron: define `CRON_SECRET`; `vercel.json` declara `/api/cron/run` (diario). Las campañas de Elixir necesitan un cron externo a `/api/cron/elixir` (`Authorization: Bearer <CRON_SECRET>`).

## Almacenamiento (recomendado: Backblaze B2)

Para empezar sin gastar, [Backblaze B2](https://www.backblaze.com/cloud-storage) ofrece una capa gratuita y es compatible con S3. **Verifica las cifras vigentes en su página de precios**: a mi mejor conocimiento incluye unos 10 GB gratis, pero es aproximado y puede haber cambiado.

1. Crea un bucket (privado) en B2.
2. Crea una *Application Key* limitada a ese bucket y copia `keyID` y `applicationKey`.
3. Rellena el `.env`:
   - `S3_ENDPOINT`: el endpoint S3 de tu bucket (`https://s3.<region>.backblazeb2.com`)
   - `S3_REGION`: la región del endpoint (por ejemplo `us-west-004`)
   - `S3_ACCESS_KEY` = `keyID`, `S3_SECRET_KEY` = `applicationKey`, `S3_BUCKET` = nombre del bucket

Cualquier otro S3-compatible (AWS S3, Cloudflare R2, MinIO) sirve con las mismas variables. Sin `S3_*`, el almacenamiento cae a disco local (`.gemini/storage`): **solo para desarrollo**. Detalle en `/docs/storage`.

## Opcional (no hace falta para arrancar)

Todo esto está comentado en `.env.example` y documentado en `/docs/env-variables`:

- **`ADMIN_EMAILS`**: administradores semilla/rescate (MFA TOTP obligatorio).
- **Modo firmado (recomendado)**: `node scripts/gen-domain-keypair.mjs`, guarda `BLOOMX_DOMAIN_PRIVATE_KEY` en el entorno y registra la clave pública en el backend (`/docs/api-backend#register-key`). Sin ella, el backend trata tu dominio en *modo legado* (`X-BloomX-Auth: legacy`, privilegios reducidos).
- **`WEBHOOK_SECRET` / `RESEND_WEBHOOK_SECRET`**: exigen firma Svix en los webhooks. Recomendado en producción.
- **Rate limit distribuido** con `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` (sin ellas, por instancia).
- Integraciones OAuth propias (Google, Slack, Notion, HubSpot, Trello), web push, límites de envío, cifrado con clave dedicada.

**No configures** `INTERNAL_SECRET`, `EXTENSION_HOOKS_SECRET` ni `FRONTEND_INTERNAL_URL`, y no compartas `NEXTAUTH_SECRET` con el backend. Tampoco hacen falta `COOKIE_SECRET`, `EXPANSION_SECRET` ni claves de IA por proveedor: la IA se configura en `/admin/ai`.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run db:ensure` | DDL idempotente y aditivo desde `src/lib/db/schema.ts`. No es un sistema de migraciones versionadas: no cambia tipos de columna. |
| `npm test` | Tests unitarios (vitest): sin red, base de datos real bloqueada. |
| `npm run test:pg` | Tests contra un PostgreSQL embebido y efímero (`*.pg.test.ts`). Nunca toca tu base. |
| `npm run test:db:setup` | Crea `prisma/test.db` (SQLite) usado por algunos tests. |
| `npm run check:themes` | Contraste WCAG AA de los temas genéricos y de empresa. |
| `npm run meet:fix -- --yes` | Puntual: parchea salas de Google Meet existentes. |
| `npm run attachments:reprocess -- --yes` | Rellena adjuntos guardados como `PENDING`/0 bytes desde el MIME crudo. |
| `npm run icons:generate` | Rasteriza `public/icon*.svg` a los iconos PNG de la PWA. |

Los scripts de mantenimiento nunca corren en build/dev/start; `DATABASE_URL` decide qué base tocan. Prisma: `npm install` ya ejecuta `prisma generate`; no lo lances a mano con `next dev` o tests vivos en Windows (EPERM por la DLL bloqueada).

## Extensiones

Viven en `bloomx-extensions` (manifest + `server.js`), se publican al backend con `node --env-file=.env sync-extensions.mjs` (desde `bloomx-backend`) y cada dominio instala las suyas. Catálogo: [expansions.md](./expansions.md); cómo crear una: [expansions/howto.md](./expansions/howto.md) y `/docs/create-extension`.

## Documentación

| Tema | Página |
|---|---|
| Arquitectura, puesta en marcha, variables, despliegue | `/docs/architecture`, `/docs/getting-started`, `/docs/env-variables`, `/docs/deployment` |
| Resend y DNS | `/docs/email-setup` ([DNS_SETUP.md](./DNS_SETUP.md)) |
| Temas, landing, ocultar docs | `/docs/themes`, `/docs/landing`, `/docs/hide-docs` |
| Funciones, Elixir, Sealer, IA, almacenamiento | `/docs/features`, `/docs/elixir`, `/docs/sealer`, `/docs/ai`, `/docs/storage` |
| Seguridad y cumplimiento | `/docs/security`, `/docs/compliance` |
| Extensiones y API | `/docs/expansions`, `/docs/create-extension`, `/docs/api`, `/docs/api-backend` |
| Operación | `/docs/operations`, `/docs/faq` |

`src/app/docs/_content/__tests__/docs.test.ts` falla si un enlace o ancla documentado está roto, si es/en divergen o si una variable documentada no existe en un `.env.example` o en el código.

## Licencia

MIT © Kynto Group
