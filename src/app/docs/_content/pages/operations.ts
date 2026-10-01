import type { Block, DocPageContent } from '../types';

const tests = `# Frontend
npm test                 # vitest: sin red, sin servicios reales (DATABASE_URL apunta a un destino inalcanzable)
npm run test:pg          # vitest contra un PostgreSQL embebido y efímero (*.pg.test.ts); nunca toca tu BD
npm run test:db:setup    # crea prisma/test.db (SQLite) que usan algunos tests
npm run check:themes     # contraste WCAG AA de temas genéricos y de empresa; sale con 1 si algo falla
npx tsc --noEmit         # tipos

# Backend compartido
npm test                 # node --test (firmas, dominio legado/firmado, CORS, rutas con dobles, sandbox)

# Extensiones (Node >= 22.6)
cd bloomx-extensions && npm test`;

const testsEn = tests
    .replace('# vitest: sin red, sin servicios reales (DATABASE_URL apunta a un destino inalcanzable)', '# vitest: no network, no real services (DATABASE_URL points to an unreachable target)')
    .replace('# vitest contra un PostgreSQL embebido y efímero (*.pg.test.ts); nunca toca tu BD', '# vitest against an embedded, ephemeral PostgreSQL (*.pg.test.ts); never touches your DB')
    .replace('# crea prisma/test.db (SQLite) que usan algunos tests', '# creates prisma/test.db (SQLite) used by some tests')
    .replace('# contraste WCAG AA de temas genéricos y de empresa; sale con 1 si algo falla', '# WCAG AA contrast of generic and company themes; exits 1 if anything fails')
    .replace('# tipos', '# types')
    .replace('# Backend compartido', '# Shared backend')
    .replace('# node --test (firmas, dominio legado/firmado, CORS, rutas con dobles, sandbox)', '# node --test (signatures, legacy/signed domain, CORS, routes with doubles, sandbox)')
    .replace('# Extensiones (Node >= 22.6)', '# Extensions (Node >= 22.6)');

const e2e = `# sin Docker, todo en 127.0.0.1 con datos de prueba (nunca usa tu .env real)
node scripts/e2e-pg.mjs                 # PostgreSQL embebido (puerto 54329, base bloomx_e2e)
npx tsx scripts/seed-e2e.ts             # genera .env.e2e, aplica el esquema y siembra usuarios/correos
node scripts/fake-resend.mjs            # Resend falso (54330): guarda los envíos en .e2e/resend-captured.json
node scripts/fake-backend.mjs           # backend falso (54331) con el manifest real de slash-commands
node scripts/e2e-dev.mjs                # next dev SOLO con .env.e2e en el puerto 3100  (NO uses npm run dev)
node scripts/e2e-webhook.mjs            # webhook email.received firmado con Svix (BAD_SIG=1 para probar firma inválida)`;

const e2eEn = e2e
    .replace('# sin Docker, todo en 127.0.0.1 con datos de prueba (nunca usa tu .env real)', '# no Docker, everything on 127.0.0.1 with test data (never uses your real .env)')
    .replace('# PostgreSQL embebido (puerto 54329, base bloomx_e2e)', '# embedded PostgreSQL (port 54329, database bloomx_e2e)')
    .replace('# genera .env.e2e, aplica el esquema y siembra usuarios/correos', '# generates .env.e2e, applies the schema and seeds users/mail')
    .replace('# Resend falso (54330): guarda los envíos en .e2e/resend-captured.json', '# fake Resend (54330): stores sends in .e2e/resend-captured.json')
    .replace('# backend falso (54331) con el manifest real de slash-commands', '# fake backend (54331) with the real slash-commands manifest')
    .replace('# next dev SOLO con .env.e2e en el puerto 3100  (NO uses npm run dev)', '# next dev with ONLY .env.e2e on port 3100  (do NOT use npm run dev)')
    .replace('# webhook email.received firmado con Svix (BAD_SIG=1 para probar firma inválida)', '# email.received webhook signed with Svix (BAD_SIG=1 to test an invalid signature)');

const es: Block[] = [
    { t: 'h2', id: 'backups', text: 'Copias de seguridad' },
    { t: 'p', text: 'BloomX **no incluye** herramientas de backup: dependen de tu proveedor. Qué proteger:' },
    { t: 'table', head: ['Qué', 'Dónde vive', 'Recomendación'], rows: [
        ['Base de datos del frontend', 'PostgreSQL (`DATABASE_URL`)', 'Backups automáticos y recuperación a un punto en el tiempo del proveedor (Neon, RDS…); prueba la restauración'],
        ['Base de datos del backend', 'PostgreSQL del backend', 'Ídem. Contiene dominios, claves públicas de firma, extensiones instaladas y credenciales cifradas'],
        ['Correos y adjuntos', 'Bucket S3/B2/R2', 'Versionado del bucket y replicación; activa `S3_SSE`'],
        ['Claves', '`NEXTAUTH_SECRET`, `DATA_ENCRYPTION_KEY` (+ `DATA_ENCRYPTION_KEYS_PREVIOUS`), `MFA_RECOVERY_PEPPER`, `BLOOMX_DOMAIN_PRIVATE_KEY`', '**Sin estas claves los datos cifrados y las sesiones no se recuperan.** Guárdalas en un gestor de secretos, separadas del backup de la base de datos'],
    ] },
    { t: 'callout', kind: 'warn', text: 'Tras restaurar una base de datos, ejecuta `npm run db:ensure` (idempotente) y comprueba `GET /api/config`. Si restauras a un entorno nuevo, `TOP_DOMAIN` y el dominio registrado en el backend deben coincidir.' },
    { t: 'h2', id: 'migrations', text: 'Migraciones' },
    { t: 'h3', id: 'ensure', text: 'Frontend: `db:ensure`' },
    { t: 'ul', items: [
        '`npm run db:ensure` (`scripts/ensure-schema.ts`) crea o completa el esquema con `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, constraints con guarda e índices `IF NOT EXISTS`, más de 25 tablas (usuarios, correos, adjuntos, etiquetas, reglas, MFA, revocación, auditoría, calendario, citas, contactos, Elixir, mensajes sellados, push…). Corre solo en `predev`, `prebuild` y `prestart`.',
        '**Es aditivo, no un sistema de migraciones versionadas**: no cambia el tipo de una columna existente ni la renombra. Es idempotente y seguro de ejecutar varias veces; usa un *advisory lock* de transacción por tabla, así que varias instancias arrancando a la vez no chocan.',
        'Excepción de limpieza: elimina la columna heredada `Email.accountEmail` y su índice. Los datos de negocio no se modifican.',
        'Índices notables: GIN de texto completo sobre `Email`, índice único parcial de idempotencia de envío, índice único parcial anti doble reserva de citas (se omite con un aviso si ya hay duplicados) y `(campaignId, recipient)` único en Elixir.',
        'Sin `DATABASE_URL` solo avisa y sale con 0; si falla, sale con 1 (y rompe el build).',
    ] },
    { t: 'h3', id: 'backend-schema', text: 'Backend' },
    { t: 'ul', items: [
        'No hay `ensure`. `npm run prisma:push` aplica `prisma/schema_push.prisma` (igual que `schema.prisma` más `Domain.signingPublicKey`). No hay carpeta `prisma/migrations`.',
        '`prisma db push` puede proponer cambios destructivos: revisa el plan y no uses `--accept-data-loss` a ciegas.',
        'La columna `signingPublicKey` también se crea de forma perezosa (`ADD COLUMN IF NOT EXISTS`) al registrar la primera clave.',
    ] },
    { t: 'h2', id: 'testing', text: 'Pruebas' },
    { t: 'code', lang: 'bash', title: 'Comandos', code: tests },
    { t: 'ul', items: [
        '**Frontend**: unos 105 archivos de test y más de mil casos (`npm test`, `vitest`), de los cuales ~120 corren contra PostgreSQL real embebido con `npm run test:pg`. El `setup` de vitest bloquea la base real: los tests nunca tocan Neon ni tu `DATABASE_URL`.',
        '**Backend**: 12 archivos, ~130 casos con el runner de Node. **Extensiones**: contrato, DLP, grupos, organizer, webhooks y slash-commands.',
        'Este `/docs` tiene su propio test (`src/app/docs/_content/__tests__/docs.test.ts`): comprueba que los enlaces internos y las anclas de la navegación existan, que cada página exista en español e inglés con la misma estructura y que **toda variable de entorno de las tablas exista** en un `.env.example` o en el código.',
        '`npm run check:themes` valida el contraste AA de los temas ([Temas](/docs/themes#local)).',
    ] },
    { t: 'h3', id: 'e2e', text: 'E2E local' },
    { t: 'p', text: 'Un entorno E2E manual y aislado (`scripts/e2e-README.md`): Postgres embebido, Resend y backend falsos y `next dev` con un `.env.e2e` generado. **No hay un script npm** que lo lance: es un procedimiento manual.' },
    { t: 'code', lang: 'bash', title: 'Levantar el entorno E2E', code: e2e },
    { t: 'ul', items: [
        'Usuarios de prueba: `tester@bloomx.test` y el administrador `admin@bloomx.test` (con MFA obligatorio); las contraseñas están en el `.env.e2e` generado. Scripts auxiliares: `e2e-totp.ts` (códigos TOTP), `e2e-session-replay.mjs` y `e2e-tracker.mjs`.',
        'Para limpiar: `rm -rf .e2e .gemini/storage .env.e2e prisma/.pgdata`.',
        'No se probó contra servicios reales: Neon con pooler, S3/B2, Resend ni Google reales.',
    ] },
    { t: 'h2', id: 'troubleshooting', text: 'Solución de problemas' },
    { t: 'table', head: ['Síntoma', 'Causa probable y solución'], rows: [
        ['Cualquier `/api/*` responde 307 a `/login`', 'No hay cookie de sesión válida (o el JWT no es de sesión). Inicia sesión y reenvía la cookie; para clientes externos usa la API `molt`.'],
        ['El login de un administrador responde 503', 'Falta la tabla `UserMfa` y MFA es obligatorio para ese correo. Ejecuta `npm run db:ensure`.'],
        ['`/api/register` responde 403 `Invalid registration secret`', 'La clave no coincide, o en producción `REGISTRATION_KEY` falta o vale `dev-secret`.'],
        ['`GET /api/config` devuelve "BloomX Default"', 'El dominio no está registrado en el backend, o `TOP_DOMAIN`/`Host` no coincide con el dominio registrado. En el backend `TOP_DOMAIN` prevalece sobre `?domain`.'],
        ['El backend responde 401 `Unauthorized` a un dominio con clave', 'Firma ausente/inválida, reloj desfasado más de 120 s, nonce repetido o `X-BloomX-Domain` ausente. Sincroniza el reloj (NTP) y revisa que firmas los mismos bytes del cuerpo ([protocolo](/docs/api-backend#signing)).'],
        ['Las cabeceras del backend indican `X-BloomX-Auth: legacy`', 'El dominio no tiene clave registrada o el frontend no tiene `BLOOMX_DOMAIN_PRIVATE_KEY`. Los hooks `EMAIL_RECEIVED`/`CRON` y `services.mail` no funcionan en modo legado; las credenciales de extensiones sí.'],
        ['El Organizer falla con `ORGANIZER_MAIL_SERVICE_UNAVAILABLE`', 'Falta el modo firmado en tu dominio o `BACKEND_SIGNING_PRIVATE_KEY` en el backend (o la extensión no declara `READ_EMAIL`/`MAIL_LABEL`).'],
        ['El webhook de Resend responde 400 `Invalid signature`', 'Copiaste en `WEBHOOK_SECRET` el secreto de otro webhook (cada uno tiene el suyo), o el proxy altera el cuerpo. Sin la variable, el webhook se acepta sin firma.'],
        ['Llegan correos pero sin adjuntos', 'Revisa el almacenamiento (`S3_*`) y los logs de `process-attachments`; `npm run attachments:reprocess` o `POST /api/admin/reprocess-attachments` los reprocesan.'],
        ['Un envío responde 422 `EXTENSION_BLOCKED`', 'Un hook `EMAIL_PRE_SEND` (por ejemplo DLP) lo bloqueó; el mensaje explica la política.'],
        ['Un envío responde 425', 'Hay otro envío con la misma `Idempotency-Key` en curso: reintenta tras `Retry-After: 2`.'],
        ['Las campañas de Elixir no avanzan', 'No hay cron sobre `/api/cron/elixir` ni la interfaz abierta; define `CRON_SECRET` y un cron/pinger ([Despliegue](/docs/deployment#cron)). Sin tablas: `{processed:0, note:"elixir_tables_missing"}` → `db:ensure`.'],
        ['El rate limit parece inconsistente', 'Sin Upstash es por instancia. Configura `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`.'],
        ['Las sesiones se cierran tras un despliegue', 'Cambiaste `NEXTAUTH_SECRET`, el dominio o `SESSION_COOKIE_HOST_PREFIX`. Fija `MFA_RECOVERY_PEPPER` antes de rotar.'],
        ['La subida devuelve 422 o 503', '422: el antivirus detectó una amenaza. 503: no se pudo escanear con `AV_FAIL_MODE=closed`.'],
        ['`next build` falla con `DATABASE_URL`', '`prebuild` ejecuta `db:ensure`; define la variable en el entorno de build o accede a una base alcanzable.'],
        ['Los estilos de empresa no aparecen', 'Comprueba `GET /api/config` (`theme`), `npm run check:themes` y que borraste la cookie `bloomx-theme`/`localStorage` para ver `defaultMode`.'],
    ] },
    { t: 'h2', id: 'pwa-update', text: 'Cómo se actualiza la PWA' },
    { t: 'ul', items: [
        '**BUILD_ID**: `next.config.js` lo genera en cada build (`VERCEL_GIT_COMMIT_SHA` si existe; si no, un hash corto de fecha y azar fijo durante ese build) y lo expone como `NEXT_PUBLIC_BUILD_ID` y `NEXT_PUBLIC_BUILT_AT`.',
        '**`GET /api/version`**: público, sin sesión y con `Cache-Control: no-store`. Devuelve `{ buildId, clientApi, minClientApi, builtAt }`; `clientApi` es `CLIENT_API_VERSION` y `minClientApi` sale de `BLOOMX_MIN_CLIENT_API` (entero, por defecto 1).',
        '**Service worker**: se registra como `/sw.js?v=<buildId>` (sin caché HTTP, `updateViaCache: none`). Las cachés se nombran con el build id y `activate` borra las de builds anteriores; no hay versión manual que subir.',
        '**Aviso**: el cliente consulta `/api/version` al cargar, al volver a la pestaña, al recuperar la red y cada ~10 min (±20%). Si el build cambió muestra «Hay una versión nueva · Actualizar»; al pulsar activa el SW nuevo (`SKIP_WAITING`) y recarga. Nunca recarga solo si hay un borrador con contenido o peticiones pendientes en la cola offline: espera a que el usuario termine.',
        '**Actualización obligatoria**: si el `clientApi` del cliente es menor que `minClientApi`, o una respuesta del backend trae `X-BloomX-Min-Client-Api` mayor que `CLIENT_API_VERSION`, aparece un aviso bloqueante «Actualizar ahora» y se recarga automáticamente (los borradores se guardan al descargar la página y la cola offline persiste).',
        'Sin red no ocurre nada. Para forzar a todos a actualizarse, sube `BLOOMX_MIN_CLIENT_API` y despliega.',
    ] },
    { t: 'h2', id: 'monitoring', text: 'Qué vigilar' },
    { t: 'ul', items: [
        'Logs de `AuditEvent` (login, MFA, admin, assets) y avisos como `[BLOOMX_AUTH] … LEGADO`.',
        'Fallos del webhook de Resend (500) y campañas Elixir en estado `failed`/filas `error`.',
        'Presupuestos de extensiones (408, `Sandbox busy`).',
        'Retención: ejecuta `?dryRun=1` antes de activar purgas nuevas.',
    ] },
];

const en: Block[] = [
    { t: 'h2', id: 'backups', text: 'Backups' },
    { t: 'p', text: 'BloomX **does not include** backup tooling: it depends on your provider. What to protect:' },
    { t: 'table', head: ['What', 'Where it lives', 'Recommendation'], rows: [
        ['Frontend database', 'PostgreSQL (`DATABASE_URL`)', 'Provider automatic backups and point-in-time recovery (Neon, RDS…); test restoring'],
        ['Backend database', 'Backend PostgreSQL', 'Same. It holds domains, signing public keys, installed extensions and encrypted credentials'],
        ['Mail and attachments', 'S3/B2/R2 bucket', 'Bucket versioning and replication; enable `S3_SSE`'],
        ['Keys', '`NEXTAUTH_SECRET`, `DATA_ENCRYPTION_KEY` (+ `DATA_ENCRYPTION_KEYS_PREVIOUS`), `MFA_RECOVERY_PEPPER`, `BLOOMX_DOMAIN_PRIVATE_KEY`', '**Without these keys encrypted data and sessions cannot be recovered.** Keep them in a secrets manager, separate from the database backup'],
    ] },
    { t: 'callout', kind: 'warn', text: 'After restoring a database, run `npm run db:ensure` (idempotent) and check `GET /api/config`. If you restore into a new environment, `TOP_DOMAIN` and the domain registered on the backend must match.' },
    { t: 'h2', id: 'migrations', text: 'Migrations' },
    { t: 'h3', id: 'ensure', text: 'Frontend: `db:ensure`' },
    { t: 'ul', items: [
        '`npm run db:ensure` (`scripts/ensure-schema.ts`) creates or completes the schema with `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, guarded constraints and `IF NOT EXISTS` indexes, over 25 tables (users, mail, attachments, labels, rules, MFA, revocation, audit, calendar, appointments, contacts, Elixir, sealed messages, push…). It runs by itself on `predev`, `prebuild` and `prestart`.',
        '**It is additive, not a versioned migration system**: it does not change an existing column\'s type or rename it. It is idempotent and safe to run repeatedly; it uses a per-table transaction *advisory lock*, so several instances starting at once do not collide.',
        'Cleanup exception: it drops the legacy `Email.accountEmail` column and its index. Business data is not modified.',
        'Notable indexes: full-text GIN on `Email`, a partial unique send-idempotency index, a partial unique anti-double-booking index for appointments (skipped with a notice if duplicates already exist) and a unique `(campaignId, recipient)` on Elixir.',
        'Without `DATABASE_URL` it only warns and exits 0; on failure it exits 1 (and breaks the build).',
    ] },
    { t: 'h3', id: 'backend-schema', text: 'Backend' },
    { t: 'ul', items: [
        'There is no `ensure`. `npm run prisma:push` applies `prisma/schema_push.prisma` (same as `schema.prisma` plus `Domain.signingPublicKey`). There is no `prisma/migrations` folder.',
        '`prisma db push` may propose destructive changes: review the plan and do not use `--accept-data-loss` blindly.',
        'The `signingPublicKey` column is also created lazily (`ADD COLUMN IF NOT EXISTS`) when the first key is registered.',
    ] },
    { t: 'h2', id: 'testing', text: 'Testing' },
    { t: 'code', lang: 'bash', title: 'Commands', code: testsEn },
    { t: 'ul', items: [
        '**Frontend**: about 105 test files and over a thousand cases (`npm test`, `vitest`), of which ~120 run against a real embedded PostgreSQL with `npm run test:pg`. Vitest\'s `setup` blocks the real database: tests never touch Neon or your `DATABASE_URL`.',
        '**Backend**: 12 files, ~130 cases with Node\'s runner. **Extensions**: contract, DLP, groups, organizer, webhooks and slash-commands.',
        'This `/docs` has its own test (`src/app/docs/_content/__tests__/docs.test.ts`): it checks that internal links and anchors in the navigation exist, that every page exists in Spanish and English with the same structure and that **every environment variable in the tables exists** in a `.env.example` or in the code.',
        '`npm run check:themes` validates theme AA contrast ([Themes](/docs/themes#local)).',
    ] },
    { t: 'h3', id: 'e2e', text: 'Local E2E' },
    { t: 'p', text: 'A manual, isolated E2E environment (`scripts/e2e-README.md`): embedded Postgres, fake Resend and backend and `next dev` with a generated `.env.e2e`. **There is no npm script** to launch it: it is a manual procedure.' },
    { t: 'code', lang: 'bash', title: 'Bring up the E2E environment', code: e2eEn },
    { t: 'ul', items: [
        'Test users: `tester@bloomx.test` and the admin `admin@bloomx.test` (with mandatory MFA); passwords are in the generated `.env.e2e`. Helper scripts: `e2e-totp.ts` (TOTP codes), `e2e-session-replay.mjs` and `e2e-tracker.mjs`.',
        'To clean up: `rm -rf .e2e .gemini/storage .env.e2e prisma/.pgdata`.',
        'Not tested against real services: Neon with pooler, S3/B2, Resend or Google.',
    ] },
    { t: 'h2', id: 'troubleshooting', text: 'Troubleshooting' },
    { t: 'table', head: ['Symptom', 'Likely cause and fix'], rows: [
        ['Any `/api/*` answers 307 to `/login`', 'No valid session cookie (or the JWT is not a session one). Sign in and resend the cookie; for external clients use the `molt` API.'],
        ['An admin\'s login answers 503', 'The `UserMfa` table is missing and MFA is mandatory for that email. Run `npm run db:ensure`.'],
        ['`/api/register` answers 403 `Invalid registration secret`', 'The key does not match, or in production `REGISTRATION_KEY` is missing or `dev-secret`.'],
        ['`GET /api/config` returns "BloomX Default"', 'The domain is not registered on the backend, or `TOP_DOMAIN`/`Host` does not match the registered domain. On the backend `TOP_DOMAIN` overrides `?domain`.'],
        ['The backend answers 401 `Unauthorized` to a domain with a key', 'Missing/invalid signature, clock skew over 120 s, repeated nonce or missing `X-BloomX-Domain`. Sync the clock (NTP) and check you sign the same body bytes ([protocol](/docs/api-backend#signing)).'],
        ['Backend headers show `X-BloomX-Auth: legacy`', 'The domain has no registered key or the frontend has no `BLOOMX_DOMAIN_PRIVATE_KEY`. `EMAIL_RECEIVED`/`CRON` hooks and `services.mail` do not work in legacy mode; extension credentials do.'],
        ['The Organizer fails with `ORGANIZER_MAIL_SERVICE_UNAVAILABLE`', 'Your domain is not in signed mode or the backend lacks `BACKEND_SIGNING_PRIVATE_KEY` (or the extension does not declare `READ_EMAIL`/`MAIL_LABEL`).'],
        ['The Resend webhook answers 400 `Invalid signature`', 'You put another webhook\'s secret in `WEBHOOK_SECRET` (each has its own), or a proxy alters the body. Without the variable the webhook is accepted unsigned.'],
        ['Mail arrives but without attachments', 'Check storage (`S3_*`) and the `process-attachments` logs; `npm run attachments:reprocess` or `POST /api/admin/reprocess-attachments` reprocess them.'],
        ['A send answers 422 `EXTENSION_BLOCKED`', 'An `EMAIL_PRE_SEND` hook (for example DLP) blocked it; the message explains the policy.'],
        ['A send answers 425', 'Another send with the same `Idempotency-Key` is in flight: retry after `Retry-After: 2`.'],
        ['Elixir campaigns do not advance', 'No cron on `/api/cron/elixir` and the UI is not open; set `CRON_SECRET` and a cron/pinger ([Deployment](/docs/deployment#cron)). Without tables: `{processed:0, note:"elixir_tables_missing"}` → `db:ensure`.'],
        ['Rate limiting seems inconsistent', 'Without Upstash it is per instance. Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.'],
        ['Sessions end after a deploy', 'You changed `NEXTAUTH_SECRET`, the domain or `SESSION_COOKIE_HOST_PREFIX`. Pin `MFA_RECOVERY_PEPPER` before rotating.'],
        ['Upload returns 422 or 503', '422: the antivirus detected a threat. 503: it could not be scanned with `AV_FAIL_MODE=closed`.'],
        ['`next build` fails on `DATABASE_URL`', '`prebuild` runs `db:ensure`; set the variable in the build environment or reach a reachable database.'],
        ['Company styles do not appear', 'Check `GET /api/config` (`theme`), `npm run check:themes` and that you cleared the `bloomx-theme` cookie/`localStorage` to see `defaultMode`.'],
    ] },
    { t: 'h2', id: 'pwa-update', text: 'How the PWA updates' },
    { t: 'ul', items: [
        '**BUILD_ID**: `next.config.js` generates it on every build (`VERCEL_GIT_COMMIT_SHA` if present; otherwise a short hash of the date plus randomness, fixed for that build) and exposes it as `NEXT_PUBLIC_BUILD_ID` and `NEXT_PUBLIC_BUILT_AT`.',
        '**`GET /api/version`**: public, no session, `Cache-Control: no-store`. Returns `{ buildId, clientApi, minClientApi, builtAt }`; `clientApi` is `CLIENT_API_VERSION` and `minClientApi` comes from `BLOOMX_MIN_CLIENT_API` (integer, default 1).',
        '**Service worker**: registered as `/sw.js?v=<buildId>` (no HTTP cache, `updateViaCache: none`). Caches are named after the build id and `activate` deletes those of previous builds; there is no manual version to bump.',
        '**Notice**: the client queries `/api/version` on load, when the tab becomes visible, when the network returns and every ~10 min (±20%). If the build changed it shows "A new version is available · Update"; clicking activates the new SW (`SKIP_WAITING`) and reloads. It never reloads on its own while there is a draft with content or pending offline-queue requests: it waits for the user.',
        '**Mandatory update**: if the client `clientApi` is lower than `minClientApi`, or a backend response carries `X-BloomX-Min-Client-Api` greater than `CLIENT_API_VERSION`, a blocking "Update now" notice appears and the page reloads automatically (drafts are saved on page unload and the offline queue persists).',
        'Offline, nothing happens. To force everyone to update, raise `BLOOMX_MIN_CLIENT_API` and deploy.',
    ] },
    { t: 'h2', id: 'monitoring', text: 'What to watch' },
    { t: 'ul', items: [
        '`AuditEvent` logs (login, MFA, admin, assets) and warnings like `[BLOOMX_AUTH] … LEGADO`.',
        'Resend webhook failures (500) and Elixir campaigns in `failed` state/`error` rows.',
        'Extension budgets (408, `Sandbox busy`).',
        'Retention: run `?dryRun=1` before enabling new purges.',
    ] },
];

const page: DocPageContent = { es, en };
export default page;
