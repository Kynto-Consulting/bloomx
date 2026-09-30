# E2E local (100 % local, sin servicios reales)

Todo corre en 127.0.0.1 con datos y credenciales de PRUEBA. Nunca se usa el `.env` real (Neon, Resend, B2/S3, Google).

## Componentes
| Script | Funcion | Puerto |
|---|---|---|
| `scripts/e2e-pg.mjs` | Postgres embebido efimero (usa `pg-test-server.mjs`), BD `bloomx_e2e` | 54329 |
| `scripts/seed-e2e.ts` | Genera `.env.e2e` (secretos/credenciales aleatorios), aplica `ensureDatabaseSchema`, siembra usuarios, labels, regla, contactos, 9 correos (To+Cc con comas, 2 adjuntos reales, hilo, HTML hostil, Authentication-Results), borrador y `.e2e/manifest.json` (hashes sha256) | - |
| `scripts/fake-resend.mjs` | Resend falso: guarda cada `POST /emails` completo en `.e2e/resend-captured.json` | 54330 |
| `scripts/fake-backend.mjs` | Backend falso de config/extensiones (`NEXT_PUBLIC_BACKEND_URL`); sirve el manifest real `slash-commands` para probar el menu `/` | 54331 |
| `scripts/e2e-dev.mjs` | `next dev` SOLO con `.env.e2e` (blanquea las claves del `.env` real para que Next no las cargue) | 3100 |
| `scripts/e2e-webhook.mjs` | Webhook `email.received` firmado con Svix (`BAD_SIG=1` prueba firma invalida) | - |
| `scripts/e2e-totp.ts` | Codigo TOTP actual con `src/lib/totp.ts` | - |
| `scripts/e2e-session-replay.mjs` | Login + MFA (codigo de recuperacion), logout y replay de la cookie (debe dar 401) | - |
| `scripts/e2e-tracker.mjs` | Servidor "tracker" en 54399 para ver si alguna imagen remota se descarga | 54399 |

## Reproducir
```bash
node scripts/e2e-pg.mjs &                 # espera "READY"
npx tsx scripts/seed-e2e.ts               # crea .env.e2e la primera vez; idempotente
node scripts/fake-resend.mjs &
node scripts/fake-backend.mjs &
node scripts/e2e-dev.mjs &                # http://localhost:3100  (NO usar `npm run dev`: predev usaria el DATABASE_URL del .env)
```
Usuario de prueba: `tester@bloomx.test`; la contrasena esta en `.env.e2e` (`E2E_USER_PASSWORD`). Admin: `admin@bloomx.test` (MFA obligatorio).
Sin sesion en otro perfil: abrir el enlace sellado con `127.0.0.1:3100` (las cookies de `localhost` no viajan).

Verificaciones utiles:
```bash
# Payloads enviados por la app (adjuntos en base64: comparar sha256 con .e2e/manifest.json)
node -e "console.log(JSON.parse(require('fs').readFileSync('.e2e/resend-captured.json','utf8')).length)"
# Regla + idempotencia (3 envios del mismo messageId => 1 correo)
node scripts/e2e-webhook.mjs "Proveedor <b@ext.test>" "Factura octubre" "<id-1@ext.test>" 3
# MFA: leer la clave de /security, y
npx tsx scripts/e2e-totp.ts "<clave base32>"
```

## Notas
- El webhook de prueba NO incluye `email_id`: con `email_id` la app consulta `https://api.resend.com/emails/receiving/...` (URL fija, no configurable por `RESEND_BASE_URL`).
- Los dialogos nativos (`confirm`) estan deshabilitados en el navegador integrado: para probar Sealer sin contrasena, `window.confirm = () => true`.
- El almacenamiento local queda en `.gemini/storage` (ignorado por git). `.env.e2e` y `.e2e/` tambien.

## Detener y limpiar
Detener next dev, fake-resend, fake-backend, e2e-tracker y e2e-pg (SIGTERM borra el cluster). Luego:
`rm -rf .e2e .gemini/storage .env.e2e prisma/.pgdata`
