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
- `WEBHOOK_SECRET`: Resend/Svix signing secret used to verify webhook signatures. If omitted, Bloomx accepts the webhook without signature verification.
- `TOP_DOMAIN`: Used when Bloomx sends the automatic undeliverable reply for unknown recipients.

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
