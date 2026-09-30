import type { DocPageContent } from '../types';

const envEx = `S3_ENDPOINT="https://<cuenta>.r2.cloudflarestorage.com"   # AWS, R2, MinIO o Backblaze B2
S3_REGION="auto"
S3_ACCESS_KEY="<access-key-id>"
S3_SECRET_KEY="<secret-access-key>"
S3_BUCKET="bloomx-uploads"
# S3_SSE="AES256"   # o "aws:kms": cifrado del lado del proveedor (opcional)`;

const envExEn = envEx.replace('# AWS, R2, MinIO o Backblaze B2', '# AWS, R2, MinIO or Backblaze B2').replace('<cuenta>', '<account>').replace('# o "aws:kms": cifrado del lado del proveedor (opcional)', '# or "aws:kms": provider-side encryption (optional)');

const page: DocPageContent = {
    es: [
        { t: 'p', text: 'BloomX guarda el contenido de los correos y los adjuntos en un almacenamiento **S3-compatible**: AWS S3, Cloudflare R2, MinIO o Backblaze B2. Usa `@aws-sdk/lib-storage` con `forcePathStyle`.' },
        { t: 'h2', id: 'config', text: 'Configuración' },
        { t: 'code', lang: 'bash', title: 'Frontend', code: envEx },
        { t: 'ul', items: [
            'Las variables `B2_*` son un alias heredado de `S3_*` (prioridad a `S3_*`). **En el backend** el almacenamiento usa solo `B2_*` (`B2_ENDPOINT`, `B2_REGION`, `B2_BUCKET`, `B2_ACCESS_KEY`, `B2_SECRET_KEY`) y son obligatorias para almacenar extensiones y archivos.',
            'Sin `S3_ACCESS_KEY` o `S3_BUCKET`, el frontend cae a **disco local** (`<cwd>/.gemini/storage`, con protección contra path traversal): útil solo en desarrollo; no sirve en Vercel (sistema de ficheros efímero).',
            '`S3_SSE=AES256|aws:kms` activa el cifrado del lado del proveedor. BloomX **no** cifra cuerpos ni adjuntos a nivel de aplicación (sí cifra secretos, tokens y mensajes sellados: [Seguridad](/docs/security#encryption)).',
        ] },
        { t: 'h2', id: 'keys', text: 'Claves de objeto' },
        { t: 'table', head: ['Contenido', 'Clave'], rows: [
            ['Correo entrante', '`emails/<fecha>/<uuid>/content.html`, `content.txt`, `raw.json`'],
            ['Adjuntos entrantes', '`emails/<fecha>/<uuid>/…` (se evitan colisiones con un sufijo hexadecimal)'],
            ['Adjuntos subidos', '`attachments/<correo>/<timestamp>-<hex>-<nombre>`'],
            ['Cuerpo enviado', '`sent/<correo>/<timestamp>-<asunto>.html` y `.txt`'],
            ['Invitaciones `.ics`', '`attachments/<correo>/<timestamp>-<archivo>.ics`'],
            ['Mensajes sellados', '`secure/<uuid>.sealed` (los antiguos `.msg`)'],
        ] },
        { t: 'p', text: 'Los nombres se sanean (`[^a-zA-Z0-9.-]` pasa a `_`). **Las claves contienen el correo del usuario**: es información personal en el nombre del objeto (limitación conocida).' },
        { t: 'h2', id: 'serving', text: 'Cómo se sirven los adjuntos' },
        { t: 'ul', items: [
            'El navegador nunca habla con el bucket: descarga por el proxy `/api/assets/<clave>` con **URL firmada** por HMAC ([Seguridad](/docs/security#assets)).',
            'La subida previa usa `POST /api/upload` (hasta 200 MB por archivo, validación de tipo real, antivirus opcional).',
            'Borrar un correo borra de forma completa HTML, texto, `raw.json` y adjuntos con conteo de referencias.',
            'Las operaciones masivas usan `DeleteObjects` en lotes de 1000; `deleteStoragePrefix` rechaza prefijos amplios. Estas operaciones no se probaron contra S3/B2 reales.',
        ] },
        { t: 'h2', id: 'backend', text: 'Almacén público del backend' },
        { t: 'p', text: '`GET /api/storage/<clave>` del backend sirve objetos públicos (por ejemplo logos) con `Content-Security-Policy: default-src \'none\'; sandbox`. Solo las imágenes se sirven inline; el resto como descarga. Bloquea `extensions/`, `.` y `_`. **Define `STORAGE_PUBLIC_PREFIXES`** (por ejemplo `public/,logos/`) para que solo esos prefijos sean accesibles; sin ella no hay lista blanca.' },
    ],
    en: [
        { t: 'p', text: 'BloomX stores mail content and attachments in **S3-compatible** storage: AWS S3, Cloudflare R2, MinIO or Backblaze B2. It uses `@aws-sdk/lib-storage` with `forcePathStyle`.' },
        { t: 'h2', id: 'config', text: 'Configuration' },
        { t: 'code', lang: 'bash', title: 'Frontend', code: envExEn },
        { t: 'ul', items: [
            '`B2_*` variables are a legacy alias of `S3_*` (`S3_*` wins). **On the backend** storage uses only `B2_*` (`B2_ENDPOINT`, `B2_REGION`, `B2_BUCKET`, `B2_ACCESS_KEY`, `B2_SECRET_KEY`) and they are required to store extensions and files.',
            'Without `S3_ACCESS_KEY` or `S3_BUCKET`, the frontend falls back to **local disk** (`<cwd>/.gemini/storage`, with path-traversal protection): useful for development only; it does not work on Vercel (ephemeral file system).',
            '`S3_SSE=AES256|aws:kms` enables provider-side encryption. BloomX does **not** encrypt bodies or attachments at application level (it does encrypt secrets, tokens and sealed messages: [Security](/docs/security#encryption)).',
        ] },
        { t: 'h2', id: 'keys', text: 'Object keys' },
        { t: 'table', head: ['Content', 'Key'], rows: [
            ['Inbound mail', '`emails/<date>/<uuid>/content.html`, `content.txt`, `raw.json`'],
            ['Inbound attachments', '`emails/<date>/<uuid>/…` (collisions avoided with a hex suffix)'],
            ['Uploaded attachments', '`attachments/<email>/<timestamp>-<hex>-<name>`'],
            ['Sent body', '`sent/<email>/<timestamp>-<subject>.html` and `.txt`'],
            ['`.ics` invitations', '`attachments/<email>/<timestamp>-<file>.ics`'],
            ['Sealed messages', '`secure/<uuid>.sealed` (old `.msg` ones)'],
        ] },
        { t: 'p', text: 'Names are sanitised (`[^a-zA-Z0-9.-]` becomes `_`). **Keys contain the user\'s email**: personal information in the object name (known limitation).' },
        { t: 'h2', id: 'serving', text: 'How attachments are served' },
        { t: 'ul', items: [
            'The browser never talks to the bucket: it downloads through the `/api/assets/<key>` proxy with an HMAC-**signed URL** ([Security](/docs/security#assets)).',
            'Prior upload uses `POST /api/upload` (up to 200 MB per file, real-type validation, optional antivirus).',
            'Deleting a message completely deletes HTML, text, `raw.json` and attachments with reference counting.',
            'Bulk operations use `DeleteObjects` in batches of 1000; `deleteStoragePrefix` rejects broad prefixes. These operations were not tested against real S3/B2.',
        ] },
        { t: 'h2', id: 'backend', text: 'Backend public store' },
        { t: 'p', text: 'The backend\'s `GET /api/storage/<key>` serves public objects (for example logos) with `Content-Security-Policy: default-src \'none\'; sandbox`. Only images are served inline; the rest as downloads. It blocks `extensions/`, `.` and `_`. **Set `STORAGE_PUBLIC_PREFIXES`** (for example `public/,logos/`) so only those prefixes are reachable; without it there is no allow-list.' },
    ],
};

export default page;
