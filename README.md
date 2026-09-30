# 🌸 Bloomx

> **The Headless AI Email Engine.**
> 100% Open Source. Serverless. Extensible.

Bloomx is not just a mail client. It's a **programmable messaging infrastructure** designed for developers who want full control over their email experience. Built for the **Vercel** ecosystem (but deployable anywhere), it combines modern stack choices with powerful AI capabilities to give you:

- **Universal Inbox**: Clean, unified interface for all your emails.
- **AI-Powered**: Auto-categorization, summarization, smart replies, and more.
- **Headless & API-First**: Build your own frontend or use our robust API.
- **Expansion Engine**: Plugin system to hook into email events (webhooks, cron, UI buttons).

![Bloomx Banner](bloomx_banner.png)

## 🚀 Features

- **📨 Headless Email**: Send and receive via simple REST APIs.
- **🧠 AI Core**: Plug-and-play support for OpenAI, Gemini, Anthropic, and Cohere.
- **🔌 Expansions**: Create custom workflows (e.g., "Add to Notion", "Slack Alert") with full UI/Backend access.
- **📏 Resizable UI**: A premium, customizable desktop experience with resizable composer windows.
- **🛡️ Privacy Focused**: Your data, your database (Postgres), your storage (S3/R2).
- **⚡ Serverless Ready**: Optimized for Next.js 15+ App Router.
- **🔍 Full Text Search**: PostgreSQL-based search for instant results.
- **🎉 Context Actions**: Integrated "Confetti", "Toast", and "Live Recipient" manipulation for expansions.

## 🛠️ Stack

- **Framework**: Next.js 14+ (App Router)
- **Language**: TypeScript
- **Styling**: TailwindCSS + shadcn/ui
- **Database**: PostgreSQL (Prisma ORM)
- **Storage**: S3-compatible (AWS S3, Cloudflare R2, Backblaze B2, MinIO)
- **Email Provider**: Resend (Inbound Webhooks + Outbound API)
- **AI SDK**: Vercel AI SDK

## 📦 One-Click Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Farubiku%2Fbloomx&env=DATABASE_URL,RESEND_API_KEY,REGISTRATION_KEY,AI_KEY)

## 🔧 Configuration

Bloomx is configured entirely via Environment Variables. See `.env.example` for details.

### Required
- `DATABASE_URL`: Connection string for PostgreSQL.
- `RESEND_API_KEY`: API Key from Resend.com.
- `REGISTRATION_KEY`: Secret token to allow new user registration.
- `TOP_DOMAIN`: Primary domain Bloomx should treat as the active tenant/domain in local setups and for system-generated mail such as undeliverable notices. Example: `mail.example.com` or `example.com`.

### App URLs and Domain Resolution
- `NEXT_PUBLIC_APP_URL`: Public URL of the Bloomx frontend, used in OAuth callback URLs.
- `TOP_DOMAIN`: In development or proxy-based setups, this overrides the incoming host so Bloomx resolves the correct tenant/domain configuration. It should match the domain you expect users to receive mail on and the domain verified in Resend if you want automated bounce notices to be sent from `noreply@<TOP_DOMAIN>`.

### Storage (S3 Compatible, B2 Compatible)
- `S3_ENDPOINT` || `B2_ENDPOINT`
- `S3_REGION` || `B2_REGION`
- `S3_ACCESS_KEY` || `B2_ACCESS_KEY`
- `S3_SECRET_KEY` || `B2_SECRET_KEY`
- `S3_BUCKET` || `B2_BUCKET`

### Shared backend (`bloomx-backend`) authentication — no shared secrets
The backend is **shared** by many Bloomx frontends, so nothing global is shared with it.

**Do NOT configure:** `INTERNAL_SECRET`, `EXTENSION_HOOKS_SECRET`, `FRONTEND_INTERNAL_URL`, nor share `NEXTAUTH_SECRET` with the backend. The frontend's internal server-to-server key (Resend webhook -> `process-attachments`, cron chaining) is **derived from this instance's own `NEXTAUTH_SECRET`** with HKDF-SHA256 (info `bloomx-internal-v1`, `src/lib/internal-auth.ts`); `INTERNAL_SECRET` is accepted only if you still define it. The session JWT is no longer forwarded to the backend.

**Optional variables:**
- `BLOOMX_DOMAIN_PRIVATE_KEY`: this instance's Ed25519 private key (PEM PKCS8 or base64). When set, requests to the backend (`extension/execute`, hooks, handler listing) are signed (`X-BloomX-Signature/Timestamp/Nonce`). When unset, the legacy header protocol is used and the backend treats the domain in *legacy mode* (no domain credentials, no `services.mail`, no `EMAIL_RECEIVED`/`CRON` hooks; response header `X-BloomX-Auth: legacy`).
  Generate it with `node scripts/gen-domain-keypair.mjs`, then register the **public** key in the backend (`signingPublicKey` in `POST /api/auth/verify-domain`, or `POST /api/manager/domain-key` with the domain manager's session). Once registered, the backend *requires* signatures for the domain.
- `BLOOMX_BACKEND_PUBLIC_KEY`: the backend's Ed25519 public key, used to verify its signed calls to `/api/internal/mail` (Organizer / `services.mail`). If unset it is discovered (cached) at `NEXT_PUBLIC_BACKEND_URL/.well-known/bloomx-backend-key.json`. If the backend has no key, that bridge is simply unavailable (the Organizer falls back to heuristics).

### AI Capabilities
- `AI_PROVIDER`: `openai`, `gemini`, `anthropic`, `cohere`
- `AI_KEY`: Your API Key.

### Resend Inbound Webhook
Bloomx receives inbound email and status updates from Resend at:

```text
POST /api/webhooks/resend
```

For local development, if Bloomx runs at `http://localhost:3000`, expose it with a tunnel and register this URL in Resend:

```text
https://your-public-host.example/api/webhooks/resend
```

Recommended webhook events:
- `email.received`
- Delivery/status events used by Resend for sent mail lifecycle updates

Optional environment variables for webhook processing:
- `WEBHOOK_SECRET` (optional, each organizer decides): Resend/Svix signing secret (`whsec_...`) for `/api/webhooks/resend`. When set, a valid signature is required; when omitted, the webhook is accepted unsigned and a warning is logged. Recommended in production so nobody can inject inbound mail.
- `RESEND_WEBHOOK_SECRET` (optional, same rule): signing secret of the second Resend webhook that delivers bounce/complaint events to `/api/webhooks/resend-events`.
- `TOP_DOMAIN`: Used when Bloomx sends the automatic undeliverable reply for unknown recipients.

Inbound behavior worth knowing:
- Recipients are resolved from `to`, `cc` and `bcc`, so a mailbox that is only in CC/BCC still receives the message.
- The webhook is idempotent. If Resend retries a delivery (timeouts, 5xx, concurrent attempts) the already-stored copy is kept and the endpoint answers `2xx`; storage keys derive from the inbound email id, so retries overwrite instead of leaving orphans.

## Build, database and maintenance scripts

`npm run build` runs only `prebuild` = `db:ensure`, which applies idempotent, additive DDL (`IF NOT EXISTS`) so new tables and indexes exist after every deploy. It never modifies rows. Everything that changes data is a manual, explicit script:

| Command | What it does | When to run it |
|---|---|---|
| `npm run db:ensure` | Applies the idempotent, additive DDL in `src/lib/db/schema.ts` (`CREATE TABLE/INDEX IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`). Also runs automatically in `predev`, `prestart` and `prebuild`. | Runs on every build; run it by hand only to apply schema changes without deploying. |
| `npm run meet:fix -- --yes` | Patches existing Google Meet rooms so they have no waiting room (uses every user's Google refresh token). | Only once, on demand. Refuses to run without `--yes`. |
| `npm run attachments:reprocess -- --yes` | Backfills attachments stored as `PENDING`/0-byte from the raw MIME (and regenerates `.ics` from our own events). | Only on demand, to repair old emails. Refuses to run without `--yes`. |
| `npm run icons:generate` | Rasterizes `public/icon*.svg` into the PNG icons required by the PWA manifest (`sharp`, already bundled with Next.js). | Only when the icon SVGs change. The PNGs are committed. |
| `npm test` | Unit tests (vitest). | CI and local. |

None of the maintenance scripts runs in `build`, `dev` or `start`. `DATABASE_URL` decides which database they touch: double-check it before running them.

Additive indexes (safe to re-run) are part of `db:ensure`: `Attachment(emailId)`, `Attachment(draftId)`, `Account(userId)`, `EmailEvent(emailId)`, `Email(userId, folder, createdAt DESC)`, `Email(userId, folder, read)`, `Email(userId, scheduledAt)`, `CalendarEvent(userId, startsAt)`, `CalendarEvent(calendarId, externalId)` and a partial unique index `AppointmentBooking(scheduleId, startsAt) WHERE status = 'confirmed'` (double-booking backstop; skipped with a notice if duplicates already exist).

## Offline, realtime and PWA

- **Service worker** (`public/sw.js`): caches only the static shell (`/_next/static/*`, icons, `/offline.html`). It never caches `/api/*`, RSC/Server Action requests, requests with `Authorization`, or HTML pages (they are per-session). A failed navigation falls back to `/offline.html`. Bump `CACHE_VERSION` to invalidate.
- **Offline queue** (`src/contexts/OfflineContext.tsx`, logic in `src/lib/offline-queue.ts`): mutations made offline are queued and replayed sequentially, with exponential backoff, on the account that originated them (the queue stores the account, never the token). Non-retryable 4xx responses are dropped; 401/408/425/429/5xx are retried up to 8 times. Each operation carries an `Idempotency-Key` header and duplicates are collapsed. Composing/sending a message while offline queues the send.
- **Realtime** (`/api/sse`): one connection per tab, at most 3 per user, polling backs off from 5 s to 30 s while idle, and each connection is closed cleanly after ~50 s so the browser reconnects with `Last-Event-ID` (the timestamp of the last notified email) and receives anything it missed.
- **Public booking**: `/book/<scheduleId>/cancel/<token>` cancels an appointment from the link in the confirmation email. Tokens are HMAC-signed (`APPOINTMENT_CANCEL_SECRET`, falls back to `NEXTAUTH_SECRET`), expire when the appointment starts, and must match the token stored with the booking.

### DNS and Deliverability
If you need to configure SPF, DKIM, DMARC, MX, and inbound webhook DNS so mail is less likely to land in spam, see [DNS_SETUP.md](./DNS_SETUP.md).

## 🧩 Expansions

Expansions are the heart of Bloomx. They allow you to:
1. **Intercept** events (email received, cron job, UI interaction).
2. **Execute** custom logic (call fetch, db, AI).
3. **Render** custom UI (buttons, sidebars, modals).

[View Full List of Expansions & Configuration](./expansions.md)

Located in `src/lib/expansions`.

## 🤝 Contributing

We love open source! Please read `CONTRIBUTING.md` (coming soon) for details.

## 📄 License

MIT © Kynto Group
