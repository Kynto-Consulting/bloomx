# Bloomx

> Multi-company web mail on **Resend**, with per-domain branding, a shared multi-tenant backend and an extension engine.
> Correo web multi-empresa sobre **Resend**, con marca por dominio, backend compartido multi-tenant y motor de extensiones.

The full, verified documentation (bilingual es/en, searchable) ships **inside the app** at `/docs` (source: `src/app/docs/_content`). This README is the short version.
La documentación completa y verificada (bilingüe es/en, con buscador) va **dentro de la app** en `/docs` (fuente: `src/app/docs/_content`). Este README es la versión corta.

| Topic / Tema | Page / Página |
|---|---|
| Architecture (N frontends, one shared backend) / Arquitectura | `/docs/architecture` |
| Getting started, environment variables, deployment / Puesta en marcha, variables, despliegue | `/docs/getting-started`, `/docs/env-variables`, `/docs/deployment` |
| Resend webhooks and DNS (SPF/DKIM/DMARC/MTA-STS) / Resend y DNS | `/docs/email-setup` (extended guide: [DNS_SETUP.md](./DNS_SETUP.md)) |
| Enterprise themes, landing/login, hide docs / Temas, landing, ocultar docs | `/docs/themes`, `/docs/landing`, `/docs/hide-docs` |
| Features, Elixir (Liquid), Sealer, Organizer, AI, storage / Funciones | `/docs/features`, `/docs/elixir`, `/docs/sealer`, `/docs/ai`, `/docs/storage` |
| Security and CIS/NIST/ISO mapping / Seguridad y mapeo | `/docs/security`, `/docs/compliance` |
| Extensions and API / Extensiones y API | `/docs/expansions`, `/docs/create-extension`, `/docs/api`, `/docs/api-backend` |
| Operations, tests, troubleshooting, FAQ / Operación | `/docs/operations`, `/docs/faq` |

## What it is / Qué es

- **N frontends, one backend.** Each company runs its own Next.js frontend (own database, own `NEXTAUTH_SECRET`). A shared backend (`bloomx-backend`) provides brand config, domain registration, extension execution and payments. **No secret is shared** between them: each frontend signs its requests with its own Ed25519 key (`BLOOMX_DOMAIN_PRIVATE_KEY`); the internal server-to-server key is derived from `NEXTAUTH_SECRET` with HKDF.
- **Mail in and out through Resend**: inbound by webhook (`/api/webhooks/resend`), outbound by API. There is no IMAP/SMTP.
- **Brand**: per-mode palette (49 tokens), radius, fonts, allowed themes, configurable login landing; WCAG AA contrast guaranteed by default.
- **Mail features**: operator search (`from: to: subject: label: has:attachment is:unread|read|starred`), labels and rules, contacts, calendar and appointments, PWA, shortcuts, es/en.
- **Elixir**: bulk sending with Liquid templates, background campaigns, quotas and one-click unsubscribe.
- **Extensions**: `handler(ctx)` contract, manifest schema, per-domain encrypted credentials, hooks (`EMAIL_PRE_SEND` DLP, `EMAIL_RECEIVED`, `CRON`), sandboxed in `worker_threads` (not a strong boundary).

Honest limits are documented on every page (for example: no undo-send, snooze without UI, Elixir without a scheduled cron in `vercel.json`, Sealer key travels in the link unless a password is used).

## Quick start / Inicio rápido

```bash
npm install                 # postinstall runs prisma generate
cp .env.example .env        # fill the minimum below
npm run db:ensure           # idempotent, additive schema (also runs on predev/prebuild/prestart)
npm run dev                 # http://localhost:3000
```

Minimum `.env` (placeholders only; never commit real values) / `.env` mínimo:

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/bloomx"
NEXTAUTH_SECRET="<long random string owned by this instance>"
RESEND_API_KEY="re_xxxxxxxx"
NEXT_PUBLIC_APP_URL="https://mail.your-domain.com"
NEXT_PUBLIC_BACKEND_URL="https://backend.your-domain.com"
TOP_DOMAIN="your-domain.com"
REGISTRATION_KEY="<key for user sign-up>"     # in production sign-up is closed if missing or "dev-secret"
ADMIN_EMAILS="admin@your-domain.com"          # admins must enable TOTP MFA
```

All variables (required vs optional, defaults) are in `/docs/env-variables` and `.env.example`. Notes that commonly trip people up / Notas frecuentes:

- **Do NOT configure** `INTERNAL_SECRET`, `EXTENSION_HOOKS_SECRET` or `FRONTEND_INTERNAL_URL`, and do not share `NEXTAUTH_SECRET` with the backend.
- **AI** uses `AI_KEY` (+ `AI_PROVIDER`, `AI_MODEL`) on the **backend**. There are no per-provider keys.
- **`WEBHOOK_SECRET` and `RESEND_WEBHOOK_SECRET` are optional** (each organizer decides): with them a valid Svix signature is required on `/api/webhooks/resend` and `/api/webhooks/resend-events`; without them requests are accepted unsigned and a warning is logged. Recommended in production.
- **Signed mode** (recommended): `node scripts/gen-domain-keypair.mjs`, keep `BLOOMX_DOMAIN_PRIVATE_KEY` secret and register the public key on the backend (`/docs/api-backend#register-key`). Without it the backend treats your domain in *legacy mode* (`X-BloomX-Auth: legacy`, reduced privileges).
- **Cron**: set `CRON_SECRET`. `vercel.json` declares only `/api/cron/run` (daily). Elixir campaigns need a cron or external pinger on `/api/cron/elixir` (`Authorization: Bearer <CRON_SECRET>`).
- **Rate limit** is per instance unless you set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

## Resend webhooks

Register **two** webhooks in Resend (public https URLs):

```text
POST https://your-host/api/webhooks/resend          # email.received + delivery states
POST https://your-host/api/webhooks/resend-events   # bounces and complaints (feeds the suppression list)
```

Inbound behaviour: recipients are resolved from `to`, `cc` and `bcc`; the webhook is idempotent (Resend retries do not duplicate). DNS (SPF, DKIM, DMARC, MX, MTA-STS, TLS-RPT): [DNS_SETUP.md](./DNS_SETUP.md).

## Scripts

| Command | What it does |
|---|---|
| `npm run db:ensure` | Idempotent, additive DDL from `src/lib/db/schema.ts` (`IF NOT EXISTS`). Not a versioned migration system: it does not change column types. It drops the legacy `Email.accountEmail` column. Runs automatically on `predev`, `prebuild` and `prestart`. |
| `npm test` | Unit tests (vitest): no network, real database blocked. |
| `npm run test:pg` | Tests against an embedded ephemeral PostgreSQL (`*.pg.test.ts`). Never touches your database. |
| `npm run test:db:setup` | Creates `prisma/test.db` (SQLite) used by a few tests. |
| `npm run check:themes` | WCAG AA contrast of the generic themes and the company fixtures (`src/lib/theme-fixtures.ts`). |
| `npm run meet:fix -- --yes` | One-off: patches existing Google Meet rooms (uses every user's Google refresh token). |
| `npm run attachments:reprocess -- --yes` | Backfills attachments stored as `PENDING`/0-byte from the raw MIME. |
| `npm run icons:generate` | Rasterizes `public/icon*.svg` into the PWA PNG icons (committed). |

Maintenance scripts never run in build/dev/start; `DATABASE_URL` decides which database they touch. A manual local E2E environment (embedded Postgres, fake Resend and backend) is described in `scripts/e2e-README.md`.

## Offline, realtime and PWA

- **Service worker** (`public/sw.js`): caches only static assets (`/_next/static/*`, icons, `/offline.html`). Never `/api/*`, `Authorization` requests or HTML pages.
- **Offline queue** (`src/lib/offline-queue.ts`): list batch actions (`/api/emails/batch`, `/api/drafts/batch`) are queued (max 200, up to 8 attempts) and replayed with `Idempotency-Key`. **Sending a message offline is not queued.**
- **Realtime** (`/api/sse`): at most 3 connections per user, ~50 s lifetime, reconnect with `Last-Event-ID`.
- **Public booking**: `/book/<scheduleId>` and `/book/<scheduleId>/cancel/<token>` (HMAC token, expires when the appointment starts).

## Extensions

Extensions live in `bloomx-extensions` (manifest + `server.js`), are published to the backend with `node --env-file=.env sync-extensions.mjs` (run from `bloomx-backend`) and each domain installs its own. Catalogue and status: [expansions.md](./expansions.md); how to build one: [expansions/howto.md](./expansions/howto.md) and `/docs/create-extension`.

## Security

TOTP MFA (mandatory for `ADMIN_EMAILS`), revocable sessions, AES-256-GCM encryption at rest with key rotation, signed asset URLs, optional antivirus, audit log, retention and rate limiting. Full model and an honest CIS/NIST/ISO mapping: `/docs/security`, `/docs/compliance`. Known limits are listed there (for instance the extension sandbox is not a strong boundary, and `requireAdmin` currently also accepts any backend manager session).

## Tests of this documentation

`src/app/docs/_content/__tests__/docs.test.ts` fails if a documented link or anchor is broken, if es/en diverge, if a documented environment variable does not exist in a `.env.example` or in the code, if a documented default differs from the code, or if the docs pages use raw palette classes.

## License / Licencia

MIT © Kynto Group
