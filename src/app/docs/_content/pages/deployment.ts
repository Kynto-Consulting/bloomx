import type { DocPageContent } from '../types';

const vercelJson = `{
  "framework": "nextjs",
  "crons": [
    { "path": "/api/cron/run", "schedule": "0 6 * * *" }
  ]
}`;

const cronCurl = `# Recordatorios y reglas (modo global, hasta 50 usuarios). Vercel Cron lo llama con GET y Bearer automáticamente.
curl -sS "https://mail.tu-dominio.com/api/cron/run" -H "Authorization: Bearer $CRON_SECRET"

# Campañas de Elixir en segundo plano (GET o POST). Procesa hasta 5 campañas 'running' (~50 s)
curl -sS "https://mail.tu-dominio.com/api/cron/elixir" -H "Authorization: Bearer $CRON_SECRET"

# Retención (añade ?dryRun=1 para solo contar)
curl -sS "https://mail.tu-dominio.com/api/admin/retention?dryRun=1" -H "Authorization: Bearer $CRON_SECRET"`;

const cronCurlEn = cronCurl
    .replace('# Recordatorios y reglas (modo global, hasta 50 usuarios). Vercel Cron lo llama con GET y Bearer automáticamente.', '# Reminders and rules (global mode, up to 50 users). Vercel Cron calls it with GET and Bearer automatically.')
    .replace("# Campañas de Elixir en segundo plano (GET o POST). Procesa hasta 5 campañas 'running' (~50 s)", "# Background Elixir campaigns (GET or POST). Processes up to 5 'running' campaigns (~50 s)")
    .replace('# Retención (añade ?dryRun=1 para solo contar)', '# Retention (add ?dryRun=1 to only count)');

const page: DocPageContent = {
    es: [
        { t: 'p', text: 'BloomX está pensado para Vercel (frontend y backend son proyectos Next.js independientes), pero funciona en cualquier host de Node que ejecute `next start`.' },
        { t: 'h2', id: 'database', text: 'Base de datos' },
        { t: 'ul', items: [
            'PostgreSQL para el frontend (`DATABASE_URL`) y otra para el backend. Neon, Supabase, RDS… cualquiera.',
            'Ejecuta `npm run db:ensure` **antes de desplegar** contra la base de destino (en Vercel corre solo en `prebuild`, que necesita `DATABASE_URL` en el entorno de build). Sin las tablas `UserMfa`, `RevokedSession`, `AuditEvent`, `Rule`, `RuleRun`, etc. algunas funciones se degradan y el login de un administrador responde 503.',
            '`db:ensure` usa advisory locks por transacción pensados para el pooler de Neon (pgbouncer en modo transacción), pero **no se probó contra un Neon real**. Si tienes problemas, ejecútalo con la conexión directa (no la del pooler).',
            'El backend no tiene `ensure`: aplica su esquema con `npm run prisma:push` (usa `prisma/schema_push.prisma`). Revisa siempre lo que `prisma db push` propone antes de aceptar cambios destructivos.',
        ] },
        { t: 'h2', id: 'vercel-frontend', text: 'Frontend en Vercel' },
        { t: 'ol', items: [
            'Importa el repositorio `bloomx` como proyecto (Framework: Next.js). Build por defecto: `npm run build` (ejecuta `prebuild` → `db:ensure` y luego `next build`).',
            'Define las variables de entorno del [mínimo de producción](/docs/env-variables#frontend-min). En especial `NEXTAUTH_SECRET` (propio), `NEXT_PUBLIC_APP_URL` (https) y `NEXT_PUBLIC_BACKEND_URL` (https).',
            'Asigna tu dominio y confirma que `TOP_DOMAIN` coincide con el tenant que registraste en el backend.',
            'Despliega y comprueba `GET /api/config`.',
        ] },
        { t: 'callout', kind: 'note', text: '`NEXT_PUBLIC_*` se incorporan en el build: si las cambias, vuelve a desplegar. Si dejas `NEXT_PUBLIC_BACKEND_URL` vacío se usa `https://backend.bloomx.arubik.dev` (y en dos sitios `http://…`): fíjala siempre.' },
        { t: 'h2', id: 'vercel-backend', text: 'Backend compartido en Vercel' },
        { t: 'ol', items: [
            'Proyecto aparte con la carpeta `bloomx-backend` como raíz. No tiene `vercel.json`: usa los valores por defecto de Next.js.',
            'Variables: [mínimo del backend](/docs/env-variables#backend-min). **No** definas `NEXTAUTH_SECRET`, `INTERNAL_SECRET`, `EXTENSION_HOOKS_SECRET` ni `FRONTEND_INTERNAL_URL`.',
            'Aplica el esquema con `npm run prisma:push` y publica las extensiones ([Crear una extensión](/docs/create-extension#publish)).',
            'Si quieres el puente `services.mail` (Organizer), genera `BACKEND_SIGNING_PRIVATE_KEY` y comprueba `GET /.well-known/bloomx-backend-key.json`.',
            'Registro abierto: si tu backend es privado, define `ALLOW_OPEN_REGISTRATION=false`.',
        ] },
        { t: 'h2', id: 'cron', text: 'Cron' },
        { t: 'p', text: 'Define `CRON_SECRET` en el proyecto del frontend: Vercel Cron envía automáticamente `Authorization: Bearer <CRON_SECRET>` a los crons declarados. El código solo comprueba el Bearer (no que la llamada venga de Vercel).' },
        { t: 'code', lang: 'json', title: 'vercel.json (frontend, tal como está en el repositorio)', code: vercelJson },
        { t: 'table', head: ['Endpoint', 'Qué hace', 'Programación'], rows: [
            ['`/api/cron/run`', 'Recordatorios de calendario (eventos en los próximos 15 min; ejecución cada 5 min como máximo), reglas sobre correos recientes (catch-up de 2 días, lotes de 200), en modo global para hasta 50 usuarios. `POST` con sesión ejecuta solo para ese usuario (lo hace el navegador cada 5 min con la pestaña visible)', 'Declarado: diario, 06:00 UTC'],
            ['`/api/cron/elixir`', 'Worker de campañas de Elixir: hasta 5 campañas en marcha, presupuesto de 50 s (`maxDuration` 60), reanudable. Acepta `?campaign=<id>`. Se encadena a sí mismo mientras queden filas listas (hasta 400 saltos)', '**No declarado**: necesita un cron cada minuto (plan de Vercel que lo permita) o un pinger externo con `Authorization: Bearer <CRON_SECRET>`. También avanza por el encadenamiento y el sondeo de la interfaz'],
            ['`/api/admin/retention`', 'Purga por retención ([Seguridad](/docs/security#retention))', '**No declarado**: añade un cron diario, por ejemplo `0 3 * * *`'],
        ] },
        { t: 'code', lang: 'bash', title: 'Probar los crons', code: cronCurl },
        { t: 'callout', kind: 'warn', title: 'Elixir sin cron', text: 'Sin un cron propio, las campañas en segundo plano solo avanzan mientras haya encadenamiento o la interfaz esté abierta haciendo `tick`. Para campañas fiables configura un pinger externo (o un cron por minuto) contra `/api/cron/elixir`. La frecuencia de crons depende de tu plan de Vercel: consulta sus límites actuales.' },
        { t: 'p', text: 'Los tokens de baja y el resto de endpoints públicos (`/api/cron`, `/api/webhooks`, `/api/assets`) no exigen sesión: se protegen con su propio secreto o firma.' },
        { t: 'h2', id: 'upstash', text: 'Upstash Redis (opcional)' },
        { t: 'p', text: 'Sin Upstash el rate limit es por instancia (memoria). En Vercel cada invocación puede caer en otra instancia, así que **para un límite real** crea una base en Upstash, copia la URL REST y el token a `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`. Si Redis falla, `RATE_LIMIT_ON_ERROR=memory` (por defecto) cuenta en memoria; nunca bloquea a todos. El rate limit del backend siempre es en memoria.' },
        { t: 'h2', id: 'https-hsts', text: 'HTTPS y cabeceras' },
        { t: 'ul', items: [
            'Usa siempre https: la cookie de sesión `__Host-…` exige `Secure` y el frontend emite HSTS con `preload`.',
            'Si quitas el prefijo `__Host-` o cambias de dominio, las sesiones existentes se invalidan (ver `SESSION_COOKIE_*` en [Variables](/docs/env-variables#g-auth)).',
            'Detrás de un proxy propio, haz que sobrescriba `x-forwarded-for` (el rate limit lo usa) y `x-forwarded-host`.',
        ] },
        { t: 'h2', id: 'post-deploy', text: 'Después del despliegue' },
        { t: 'ol', items: [
            'Configura los webhooks de Resend y el DNS ([Correo: Resend y DNS](/docs/email-setup)).',
            'Rota cualquier credencial que haya estado en texto plano en algún archivo o historial.',
            'Repasa [Operación](/docs/operations) (backups y pruebas).',
        ] },
    ],
    en: [
        { t: 'p', text: 'BloomX is designed for Vercel (frontend and backend are independent Next.js projects) but works on any Node host running `next start`.' },
        { t: 'h2', id: 'database', text: 'Database' },
        { t: 'ul', items: [
            'PostgreSQL for the frontend (`DATABASE_URL`) and another for the backend. Neon, Supabase, RDS… any will do.',
            'Run `npm run db:ensure` **before deploying** against the target database (on Vercel it runs by itself in `prebuild`, which needs `DATABASE_URL` in the build environment). Without the `UserMfa`, `RevokedSession`, `AuditEvent`, `Rule`, `RuleRun`, … tables some features degrade and an admin\'s login answers 503.',
            '`db:ensure` uses per-transaction advisory locks designed for Neon\'s pooler (pgbouncer in transaction mode), but it was **not tested against a real Neon**. If you hit problems, run it with the direct (non-pooler) connection.',
            'The backend has no `ensure`: apply its schema with `npm run prisma:push` (uses `prisma/schema_push.prisma`). Always review what `prisma db push` proposes before accepting destructive changes.',
        ] },
        { t: 'h2', id: 'vercel-frontend', text: 'Frontend on Vercel' },
        { t: 'ol', items: [
            'Import the `bloomx` repository as a project (Framework: Next.js). Default build: `npm run build` (runs `prebuild` → `db:ensure`, then `next build`).',
            'Set the [production minimum](/docs/env-variables#frontend-min) environment variables. Especially `NEXTAUTH_SECRET` (its own), `NEXT_PUBLIC_APP_URL` (https) and `NEXT_PUBLIC_BACKEND_URL` (https).',
            'Assign your domain and confirm `TOP_DOMAIN` matches the tenant you registered on the backend.',
            'Deploy and check `GET /api/config`.',
        ] },
        { t: 'callout', kind: 'note', text: '`NEXT_PUBLIC_*` are baked in at build time: redeploy after changing them. If `NEXT_PUBLIC_BACKEND_URL` is empty `https://backend.bloomx.arubik.dev` is used (and in two places `http://…`): always set it.' },
        { t: 'h2', id: 'vercel-backend', text: 'Shared backend on Vercel' },
        { t: 'ol', items: [
            'A separate project with the `bloomx-backend` folder as root. It has no `vercel.json`: Next.js defaults apply.',
            'Variables: [backend minimum](/docs/env-variables#backend-min). Do **not** set `NEXTAUTH_SECRET`, `INTERNAL_SECRET`, `EXTENSION_HOOKS_SECRET` or `FRONTEND_INTERNAL_URL`.',
            'Apply the schema with `npm run prisma:push` and publish the extensions ([Build an extension](/docs/create-extension#publish)).',
            'If you want the `services.mail` bridge (Organizer), generate `BACKEND_SIGNING_PRIVATE_KEY` and check `GET /.well-known/bloomx-backend-key.json`.',
            'Open sign-up: if your backend is private, set `ALLOW_OPEN_REGISTRATION=false`.',
        ] },
        { t: 'h2', id: 'cron', text: 'Cron' },
        { t: 'p', text: 'Set `CRON_SECRET` in the frontend project: Vercel Cron automatically sends `Authorization: Bearer <CRON_SECRET>` to declared crons. The code only checks the Bearer (not that the call comes from Vercel).' },
        { t: 'code', lang: 'json', title: 'vercel.json (frontend, as in the repository)', code: vercelJson },
        { t: 'table', head: ['Endpoint', 'What it does', 'Schedule'], rows: [
            ['`/api/cron/run`', 'Calendar reminders (events starting within 15 min; runs at most every 5 min), rules over recent mail (2-day catch-up, batches of 200), in global mode for up to 50 users. `POST` with a session runs only for that user (the browser does it every 5 min while the tab is visible)', 'Declared: daily, 06:00 UTC'],
            ['`/api/cron/elixir`', 'Elixir campaign worker: up to 5 running campaigns, 50 s budget (`maxDuration` 60), resumable. Accepts `?campaign=<id>`. It chains itself while rows are ready (up to 400 hops)', '**Not declared**: needs a cron every minute (a Vercel plan that allows it) or an external pinger with `Authorization: Bearer <CRON_SECRET>`. It also advances through chaining and the UI polling'],
            ['`/api/admin/retention`', 'Retention purge ([Security](/docs/security#retention))', '**Not declared**: add a daily cron, for example `0 3 * * *`'],
        ] },
        { t: 'code', lang: 'bash', title: 'Testing the crons', code: cronCurlEn },
        { t: 'callout', kind: 'warn', title: 'Elixir without a cron', text: 'Without its own cron, background campaigns only advance while chaining continues or the UI is open doing `tick`. For reliable campaigns set up an external pinger (or a per-minute cron) against `/api/cron/elixir`. Cron frequency depends on your Vercel plan: check its current limits.' },
        { t: 'p', text: 'Unsubscribe tokens and the other public endpoints (`/api/cron`, `/api/webhooks`, `/api/assets`) do not require a session: they are protected by their own secret or signature.' },
        { t: 'h2', id: 'upstash', text: 'Upstash Redis (optional)' },
        { t: 'p', text: 'Without Upstash the rate limit is per instance (memory). On Vercel each invocation can land on a different instance, so **for a real limit** create an Upstash database and copy the REST URL and token into `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. If Redis fails, `RATE_LIMIT_ON_ERROR=memory` (default) counts in memory; it never blocks everyone. The backend rate limit is always in memory.' },
        { t: 'h2', id: 'https-hsts', text: 'HTTPS and headers' },
        { t: 'ul', items: [
            'Always use https: the `__Host-…` session cookie needs `Secure` and the frontend emits HSTS with `preload`.',
            'If you drop the `__Host-` prefix or change domain, existing sessions are invalidated (see `SESSION_COOKIE_*` in [Variables](/docs/env-variables#g-auth)).',
            'Behind your own proxy, make it overwrite `x-forwarded-for` (the rate limit uses it) and `x-forwarded-host`.',
        ] },
        { t: 'h2', id: 'post-deploy', text: 'After deploying' },
        { t: 'ol', items: [
            'Configure the Resend webhooks and DNS ([Email: Resend and DNS](/docs/email-setup)).',
            'Rotate any credential that ever sat in plain text in a file or history.',
            'Review [Operations](/docs/operations) (backups and tests).',
        ] },
    ],
};

export default page;
