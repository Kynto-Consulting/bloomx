import type { Block, DocPageContent } from '../types';
import { ENV_GROUPS } from '../env';

const feMin = `# .env (frontend) — mínimo para arrancar. Todos los valores son marcadores de posición.
DATABASE_URL="postgresql://USUARIO:CONTRASENA@HOST:5432/bloomx"
NEXTAUTH_SECRET="<cadena-aleatoria-larga-propia-de-esta-instancia>"   # openssl rand -base64 48
RESEND_API_KEY="re_xxxxxxxx"
NEXT_PUBLIC_APP_URL="https://mail.tu-dominio.com"
NEXT_PUBLIC_BACKEND_URL="https://backend.tu-dominio.com"
TOP_DOMAIN="tu-dominio.com"
REGISTRATION_KEY="<clave-para-el-alta-de-usuarios>"
ADMIN_EMAILS="admin@tu-dominio.com"`;

const feMinEn = `# .env (frontend) — minimum to start. Every value is a placeholder.
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/bloomx"
NEXTAUTH_SECRET="<long-random-string-owned-by-this-instance>"   # openssl rand -base64 48
RESEND_API_KEY="re_xxxxxxxx"
NEXT_PUBLIC_APP_URL="https://mail.your-domain.com"
NEXT_PUBLIC_BACKEND_URL="https://backend.your-domain.com"
TOP_DOMAIN="your-domain.com"
REGISTRATION_KEY="<key-for-user-sign-up>"
ADMIN_EMAILS="admin@your-domain.com"`;

const feProd = `# Recomendado en producción (frontend)
S3_ENDPOINT="https://..."  S3_REGION="auto"  S3_ACCESS_KEY="..."  S3_SECRET_KEY="..."  S3_BUCKET="bloomx-uploads"
DATA_ENCRYPTION_KEY="<clave-dedicada-distinta-de-NEXTAUTH_SECRET>"
ENCRYPTION_REQUIRE_DEDICATED_KEY="true"
CRON_SECRET="<cadena-aleatoria>"
UPSTASH_REDIS_REST_URL="https://..."  UPSTASH_REDIS_REST_TOKEN="..."
BLOOMX_DOMAIN_PRIVATE_KEY="<salida de node scripts/gen-domain-keypair.mjs>"
# Opcional por organizador: firma de los webhooks de Resend
WEBHOOK_SECRET="whsec_..."  RESEND_WEBHOOK_SECRET="whsec_..."`;

const beMin = `# .env (backend compartido) — marcadores de posición
DATABASE_URL="postgresql://USUARIO:CONTRASENA@HOST:5432/bloomx_backend"
NEXT_PUBLIC_BACKEND_URL="https://backend.tu-dominio.com"
B2_ENDPOINT="https://..."  B2_REGION="..."  B2_BUCKET="..."  B2_ACCESS_KEY="..."  B2_SECRET_KEY="..."
DATA_ENCRYPTION_KEY="<64 hex o base64 de 32 bytes>"     # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ADMIN_EMAIL="plataforma@tu-dominio.com"  ADMIN_PASSWORD="<contraseña>"
STORAGE_PUBLIC_PREFIXES="public/,logos/"
# Opcional: puente backend -> frontend (Organizer / services.mail)
# BACKEND_SIGNING_PRIVATE_KEY="<PEM PKCS8>"
# NO definir NEXTAUTH_SECRET, INTERNAL_SECRET, EXTENSION_HOOKS_SECRET ni FRONTEND_INTERNAL_URL en el backend: ya no se leen.`;

const beMinEn = beMin
    .replace('marcadores de posición', 'placeholders')
    .replace('64 hex o base64 de 32 bytes', '64 hex or 32-byte base64')
    .replace('contraseña', 'password')
    .replace('# Opcional: puente backend -> frontend (Organizer / services.mail)', '# Optional: backend -> frontend bridge (Organizer / services.mail)')
    .replace('# NO definir NEXTAUTH_SECRET, INTERNAL_SECRET, EXTENSION_HOOKS_SECRET ni FRONTEND_INTERNAL_URL en el backend: ya no se leen.', '# Do NOT set NEXTAUTH_SECRET, INTERNAL_SECRET, EXTENSION_HOOKS_SECRET or FRONTEND_INTERNAL_URL on the backend: they are no longer read.');

function groups(locale: 'es' | 'en'): Block[] {
    const out: Block[] = [];
    for (const g of ENV_GROUPS) {
        out.push({ t: 'h3', id: `g-${g.id}`, text: g.title[locale] });
        if (g.intro) out.push({ t: 'p', text: g.intro[locale] });
        out.push({ t: 'env', group: g.id });
    }
    return out;
}

const page: DocPageContent = {
    es: [
        { t: 'p', text: 'Esta página es la referencia completa. Cada variable se verificó contra el código (nombre, valor por defecto y qué pasa si falta) y un test impide listar variables inexistentes. **No pongas valores reales en el repositorio**: usa las variables del proveedor (Vercel, etc.).' },
        { t: 'callout', kind: 'note', title: 'Cómo leer las tablas', text: '**Obligatoria**: sin ella no arranca o falla. **Condicional**: obligatoria solo si usas esa función (por ejemplo Google, o el registro en producción). **Opcional**: hay un valor por defecto o la función se desactiva. En "Por defecto", "—" significa que no hay valor por defecto.' },
        { t: 'h2', id: 'frontend-min', text: 'Frontend: mínimo' },
        { t: 'code', lang: 'bash', title: '.env del frontend', code: feMin },
        { t: 'code', lang: 'bash', title: 'Recomendado en producción', code: feProd },
        { t: 'callout', kind: 'warn', title: 'Cada frontend tiene SU NEXTAUTH_SECRET', text: 'No se comparte con el backend ni con otros frontends. Si lo rotas, se cierran todas las sesiones; fija antes `MFA_RECOVERY_PEPPER` (y `DATA_ENCRYPTION_KEY` si usabas la reserva) para no perder los códigos de recuperación ni el contenido cifrado.' },
        { t: 'h2', id: 'backend-min', text: 'Backend compartido: mínimo' },
        { t: 'code', lang: 'bash', title: '.env del backend', code: beMin },
        { t: 'callout', kind: 'note', text: 'Sin `DATA_ENCRYPTION_KEY` el backend guarda la clave de Resend de cada dominio y las credenciales de extensiones **sin cifrar** (en producción solo emite un aviso y `PUT /api/extension/settings` responde 503).' },
        { t: 'h2', id: 'frontend-all', text: 'Frontend y backend: todas las variables' },
        { t: 'p', text: 'La columna **Dónde** indica si la variable se lee en el frontend, en el backend o en ambos.' },
        ...groups('es'),
        { t: 'h2', id: 'removed', text: 'Variables que ya no existen' },
        { t: 'p', text: 'Aparecían en documentación antigua y **el código no las lee**: `COOKIE_SECRET`, `EXPANSION_SECRET`, `AI_OPENAI_API_KEY`, `AI_GEMINI_API_KEY`, `AI_ANTHROPIC_API_KEY`, `AI_COHERE_API_KEY` (la IA se configura en `/admin/ai`; `AI_KEY`/`AI_PROVIDER`/`AI_MODEL` son solo respaldo heredado, ver [IA](/docs/ai#migration)),`SLACK_SIGNING_SECRET`, `EXPANSION_CRM_URL`, `EXPANSION_CRM_API_KEY`, `EXPANSION_WEBHOOK_URL` y `TRELLO_SECRET`. Entre frontend y backend tampoco se usan `EXTENSION_HOOKS_SECRET` ni `FRONTEND_INTERNAL_URL`. En el backend `RESEND_API_KEY` no se lee: la clave de Resend llega en `register-domain` y se guarda cifrada por dominio.' },
    ],
    en: [
        { t: 'p', text: 'This page is the complete reference. Every variable was verified against the code (name, default and what happens if it is missing) and a test prevents listing variables that do not exist. **Never commit real values**: use your provider\'s variable store (Vercel, etc.).' },
        { t: 'callout', kind: 'note', title: 'How to read the tables', text: '**Required**: it will not start or will fail without it. **Conditional**: required only if you use that feature (for example Google, or sign-up in production). **Optional**: there is a default or the feature turns off. In "Default", "—" means there is no default.' },
        { t: 'h2', id: 'frontend-min', text: 'Frontend: minimum' },
        { t: 'code', lang: 'bash', title: 'Frontend .env', code: feMinEn },
        { t: 'code', lang: 'bash', title: 'Recommended in production', code: feProd.replace('# Recomendado en producción (frontend)', '# Recommended in production (frontend)').replace('<clave-dedicada-distinta-de-NEXTAUTH_SECRET>', '<dedicated-key-different-from-NEXTAUTH_SECRET>').replace('<cadena-aleatoria>', '<random-string>').replace('<salida de node scripts/gen-domain-keypair.mjs>', '<output of node scripts/gen-domain-keypair.mjs>').replace('# Opcional por organizador: firma de los webhooks de Resend', '# Optional per organiser: signing of Resend webhooks') },
        { t: 'callout', kind: 'warn', title: 'Each frontend has ITS OWN NEXTAUTH_SECRET', text: 'It is not shared with the backend or with other frontends. Rotating it ends all sessions; first pin `MFA_RECOVERY_PEPPER` (and `DATA_ENCRYPTION_KEY` if you relied on the fallback) so you do not lose recovery codes or encrypted content.' },
        { t: 'h2', id: 'backend-min', text: 'Shared backend: minimum' },
        { t: 'code', lang: 'bash', title: 'Backend .env', code: beMinEn },
        { t: 'callout', kind: 'note', text: 'Without `DATA_ENCRYPTION_KEY` the backend stores each domain\'s Resend key and extension credentials **unencrypted** (in production it only warns and `PUT /api/extension/settings` answers 503).' },
        { t: 'h2', id: 'frontend-all', text: 'Frontend and backend: every variable' },
        { t: 'p', text: 'The **Where** column says whether the variable is read on the frontend, the backend or both.' },
        ...groups('en'),
        { t: 'h2', id: 'removed', text: 'Variables that no longer exist' },
        { t: 'p', text: 'They appeared in old documentation and **the code does not read them**: `COOKIE_SECRET`, `EXPANSION_SECRET`, `AI_OPENAI_API_KEY`, `AI_GEMINI_API_KEY`, `AI_ANTHROPIC_API_KEY`, `AI_COHERE_API_KEY` (AI is configured in `/admin/ai`; `AI_KEY`/`AI_PROVIDER`/`AI_MODEL` are only a legacy fallback, see [AI](/docs/ai#migration)),`SLACK_SIGNING_SECRET`, `EXPANSION_CRM_URL`, `EXPANSION_CRM_API_KEY`, `EXPANSION_WEBHOOK_URL` and `TRELLO_SECRET`. Between frontend and backend `EXTENSION_HOOKS_SECRET` and `FRONTEND_INTERNAL_URL` are not used either. On the backend `RESEND_API_KEY` is not read: the Resend key arrives in `register-domain` and is stored encrypted per domain.' },
    ],
};

export default page;
