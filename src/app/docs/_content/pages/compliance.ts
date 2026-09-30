import type { Block, DocPageContent } from '../types';

const es: Block[] = [
    { t: 'callout', kind: 'warn', title: 'No es una certificación', text: 'Este mapeo se hizo leyendo el código y no equivale a una auditoría ni a una certificación. Los números de control son referencias orientativas de CIS Controls v8, NIST SP 800-53 / 800-63B e ISO/IEC 27001:2022 Anexo A. **CUMPLE** = el código implementa el control razonablemente; **PARCIAL** = existe pero con huecos; **FALTA** = no implementado.' },
    { t: 'h2', id: 'summary', text: 'Resumen' },
    { t: 'ul', items: [
        '**Fortalezas**: MFA TOTP con anti-replay, sesiones revocables, cifrado en reposo AES-256-GCM con rotación de claves, autenticación entre sistemas con Ed25519 sin secretos compartidos, sanitización del correo entrante en iframe aislado, auditoría con redacción, retención configurable y muchas validaciones de entrada.',
        '**Lo que falta o es débil**: control de acceso de administrador en el backend compartido, sin KMS/HSM, sin cifrado a nivel de aplicación de correos y adjuntos, sandbox de extensiones que no es frontera fuerte, rate limit y anti-replay por instancia, webhooks sin firma si no se configura el secreto, y auditoría sin integridad ni SIEM.',
    ] },
    { t: 'h2', id: 'matrix', text: 'Matriz de controles' },
    { t: 'table', head: ['Control (CIS v8 / NIST / ISO A)', 'Estado', 'Justificación por código'], rows: [
        ['Cuentas y contraseñas: CIS 5 / IA-5, 63B / A.5.17', 'PARCIAL', 'Frontend: 12 caracteres mínimo, lista de comunes, bcrypt coste 12, anti-enumeración. El backend acepta 8 caracteres, sin lista de comunes.'],
        ['MFA: CIS 6.3–6.5 / IA-2(1), AAL2 / A.8.5', 'PARCIAL', 'TOTP con anti-replay y códigos de recuperación, obligatorio para `ADMIN_EMAILS`. Opcional para el resto; el callback de Google no exige TOTP si MFA es voluntario; el backend no tiene MFA; sin WebAuthn.'],
        ['Sesiones y revocación: CIS 6 / AC-12, IA-11 / A.8.5', 'PARCIAL', 'TTL 24 h, tope 14 d, `jti` y `tokenVersion`, cookie `__Host-`. Caché de revocación de 5 s por instancia; JWT multicuenta en `localStorage`; revocación dependiente del DDL.'],
        ['Control de acceso y mínimo privilegio: CIS 6.8 / AC-3, AC-6 / A.5.15, A.8.2', 'PARCIAL', '`requireAdmin` exige propiedad del dominio de la instancia para los managers del backend compartido, o `ADMIN_EMAILS` con MFA para usuarios (ver [Seguridad](/docs/security#limits)).'],
        ['Cifrado en reposo: CIS 3.11 / SC-28, SC-13 / A.8.24', 'PARCIAL', 'AES-256-GCM v3 con HKDF y `keyId` para secretos TOTP, tokens OAuth y ajustes. Correos y adjuntos no se cifran a nivel de aplicación (solo `S3_SSE` opcional).'],
        ['Gestión de claves y rotación: NIST SC-12 / A.8.24', 'PARCIAL', 'Anillo de claves con `keyId` y re-cifrado perezoso. Claves en variables de entorno, sin KMS; la clave dedicada no es obligatoria por defecto; el backend no tiene `keyId`.'],
        ['Cifrado en tránsito: CIS 3.10 / SC-8 / A.8.24', 'PARCIAL', 'HSTS con `preload`, `upgrade-insecure-requests`, extensiones solo https. La URL por defecto del backend en algunos sitios es `http://…`.'],
        ['Registros y auditoría: CIS 8.2, 8.5 / AU-2, AU-3, AU-9 / A.8.15', 'PARCIAL', '`AuditEvent` con redacción y retención de 365 d. Sin integridad criptográfica ni SIEM; el backend solo escribe a stdout.'],
        ['Antimalware: CIS 10.1, 9.6 / SI-3 / A.8.7', 'PARCIAL', 'Magic-bytes y extensiones peligrosas siempre activos. Antivirus opcional y fail-open por defecto; archivos > 25 MB sin escanear.'],
        ['Limitación de intentos y DoS: CIS 13 / AC-7, SC-5 / A.8.6', 'PARCIAL', 'Límites por IP y por cuenta; global con Upstash. Sin Redis es por instancia; el backend siempre en memoria.'],
        ['Seguridad de aplicaciones web: CIS 16 / SI-10, SC-18 / A.8.26, A.8.28', 'PARCIAL', 'CSP, HSTS, nosniff, DOMPurify + iframe aislado, CSRF por `Origin`. La CSP permite `unsafe-inline` y `https:` genérico; CSRF omitido sin `Origin` o con Bearer.'],
        ['Retención y eliminación: CIS 3.4 / SI-12, MP-6 / A.8.10', 'PARCIAL', 'Borrado completo con conteo de referencias. Por defecto solo el spam (30 d) está activo; papelera y `raw.json` desactivados.'],
        ['Autenticación entre sistemas: NIST IA-3, SC-23 / A.8.5', 'PARCIAL', 'Ed25519 por dominio, ventana ±120 s y nonce. Modo legado sin firma; nonce solo en memoria de la instancia.'],
        ['Aislamiento de código de terceros: SC-39, SC-7 / A.8.26', 'PARCIAL', '`worker_threads` con límites duros y `safe-fetch` sólido, pero comparte proceso y usuario: no es frontera fuerte.'],
        ['Antiphishing y filtrado de correo: NIST 800-177 / A.8.23', 'CUMPLE', 'Sanitización DOMPurify, iframe sin `allow-same-origin`, imágenes remotas bloqueadas por defecto, aviso de enlaces engañosos, insignia SPF/DKIM/DMARC y sin backscatter.'],
        ['Secretos en repositorio y entorno: CIS 3.11 / IA-5(7) / A.8.4', 'PARCIAL', '`.env` ignorado por git; las extensiones no pueden leer variables de plataforma. Fallo en producción sin `NEXTAUTH_SECRET`. Credenciales antiguas en documentos internos pendientes de rotar.'],
        ['Integridad de webhooks: SI-7, SC-8 / A.8.24', 'FALTA', 'Los webhooks de Resend se aceptan sin firma si no defines `WEBHOOK_SECRET` / `RESEND_WEBHOOK_SECRET` (decisión por organizador, solo un aviso en el log).'],
        ['Configuración segura por defecto: CIS 4 / CM-6 / A.8.9', 'PARCIAL', 'Buenos valores por defecto (`__Host-`, `v3`, TTL 24 h) junto a otros permisivos: registro abierto en el backend, `ASSET_UNSIGNED_UPLOADS=allow`, AV fail-open, clave dedicada opcional.'],
    ] },
    { t: 'h2', id: 'not-covered', text: 'Qué no cubre BloomX' },
    { t: 'ul', items: [
        'Gestión de vulnerabilidades y dependencias: el frontend usa `next: "latest"` y `react: "latest"` sin versión fijada; el backend usa `lucia` y `oslo`, marcadas como obsoletas por sus autores.',
        'Copias de seguridad, recuperación ante desastres y continuidad: dependen de tu proveedor de base de datos y almacenamiento ([Operación](/docs/operations#backups)).',
        'Gestión de incidentes, formación, control físico y gobierno: fuera del alcance del software.',
        'DLP: existe la extensión `dlp` (bloquea por palabras clave y detectores en `EMAIL_PRE_SEND`), pero el envío sellado la evade y solo ve el correo exterior.',
    ] },
    { t: 'callout', kind: 'note', text: 'Verificado por lectura de código; no se ejecutaron pruebas de penetración. Las tablas `UserMfa`, `RevokedSession`, `AuditEvent` y `SecureMessageMeta` deben existir en el entorno desplegado (`npm run db:ensure`) para que los controles correspondientes estén activos.' },
];

const en: Block[] = [
    { t: 'callout', kind: 'warn', title: 'This is not a certification', text: 'This mapping was made by reading the code and is not an audit or certification. Control numbers are indicative references to CIS Controls v8, NIST SP 800-53 / 800-63B and ISO/IEC 27001:2022 Annex A. **CUMPLE** (met) = the code reasonably implements the control; **PARCIAL** (partial) = exists with gaps; **FALTA** (missing) = not implemented.' },
    { t: 'h2', id: 'summary', text: 'Summary' },
    { t: 'ul', items: [
        '**Strengths**: TOTP MFA with anti-replay, revocable sessions, AES-256-GCM encryption at rest with key rotation, system-to-system authentication with Ed25519 and no shared secrets, inbound-mail sanitisation in an isolated iframe, audit with redaction, configurable retention and many input validations.',
        '**What is missing or weak**: admin access control on the shared backend, no KMS/HSM, no application-level encryption of mail and attachments, an extension sandbox that is not a strong boundary, per-instance rate limit and anti-replay, unsigned webhooks when the secret is not set, and audit without integrity or SIEM.',
    ] },
    { t: 'h2', id: 'matrix', text: 'Control matrix' },
    { t: 'table', head: ['Control (CIS v8 / NIST / ISO A)', 'Status', 'Justification from the code'], rows: [
        ['Accounts and passwords: CIS 5 / IA-5, 63B / A.5.17', 'PARCIAL', 'Frontend: 12-character minimum, common-password list, bcrypt cost 12, anti-enumeration. The backend accepts 8 characters, no common-password list.'],
        ['MFA: CIS 6.3–6.5 / IA-2(1), AAL2 / A.8.5', 'PARCIAL', 'TOTP with anti-replay and recovery codes, mandatory for `ADMIN_EMAILS`. Optional for the rest; the Google callback does not require TOTP if MFA is voluntary; the backend has no MFA; no WebAuthn.'],
        ['Sessions and revocation: CIS 6 / AC-12, IA-11 / A.8.5', 'PARCIAL', '24 h TTL, 14 d cap, `jti` and `tokenVersion`, `__Host-` cookie. 5 s per-instance revocation cache; multi-account JWT in `localStorage`; revocation depends on DDL.'],
        ['Access control and least privilege: CIS 6.8 / AC-3, AC-6 / A.5.15, A.8.2', 'PARCIAL', '`requireAdmin` requires ownership of the instance domain for shared-backend managers, or `ADMIN_EMAILS` with MFA for users (see [Security](/docs/security#limits)).'],
        ['Encryption at rest: CIS 3.11 / SC-28, SC-13 / A.8.24', 'PARCIAL', 'AES-256-GCM v3 with HKDF and `keyId` for TOTP secrets, OAuth tokens and settings. Mail and attachments are not encrypted at application level (optional `S3_SSE` only).'],
        ['Key management and rotation: NIST SC-12 / A.8.24', 'PARCIAL', 'Key ring with `keyId` and lazy re-encryption. Keys in environment variables, no KMS; the dedicated key is not mandatory by default; the backend has no `keyId`.'],
        ['Encryption in transit: CIS 3.10 / SC-8 / A.8.24', 'PARCIAL', 'HSTS with `preload`, `upgrade-insecure-requests`, https-only extensions. The default backend URL is `http://…` in some places.'],
        ['Logging and audit: CIS 8.2, 8.5 / AU-2, AU-3, AU-9 / A.8.15', 'PARCIAL', '`AuditEvent` with redaction and 365 d retention. No cryptographic integrity or SIEM; the backend only writes to stdout.'],
        ['Anti-malware: CIS 10.1, 9.6 / SI-3 / A.8.7', 'PARCIAL', 'Magic-bytes and dangerous extensions always on. Antivirus optional and fail-open by default; files > 25 MB unscanned.'],
        ['Attempt limiting and DoS: CIS 13 / AC-7, SC-5 / A.8.6', 'PARCIAL', 'Per-IP and per-account limits; global with Upstash. Without Redis it is per instance; the backend is always in-memory.'],
        ['Web application security: CIS 16 / SI-10, SC-18 / A.8.26, A.8.28', 'PARCIAL', 'CSP, HSTS, nosniff, DOMPurify + isolated iframe, `Origin`-based CSRF. The CSP allows `unsafe-inline` and generic `https:`; CSRF skipped without `Origin` or with Bearer.'],
        ['Retention and deletion: CIS 3.4 / SI-12, MP-6 / A.8.10', 'PARCIAL', 'Complete deletion with reference counting. By default only spam (30 d) is active; trash and `raw.json` off.'],
        ['System-to-system authentication: NIST IA-3, SC-23 / A.8.5', 'PARCIAL', 'Per-domain Ed25519, ±120 s window and nonce. Unsigned legacy mode; nonce only in instance memory.'],
        ['Third-party code isolation: SC-39, SC-7 / A.8.26', 'PARCIAL', '`worker_threads` with hard limits and solid `safe-fetch`, but shares process and user: not a strong boundary.'],
        ['Anti-phishing and mail filtering: NIST 800-177 / A.8.23', 'CUMPLE', 'DOMPurify sanitisation, iframe without `allow-same-origin`, remote images blocked by default, misleading-link warning, SPF/DKIM/DMARC badge and no backscatter.'],
        ['Secrets in repository and environment: CIS 3.11 / IA-5(7) / A.8.4', 'PARCIAL', '`.env` ignored by git; extensions cannot read platform variables. Fails in production without `NEXTAUTH_SECRET`. Old credentials in internal documents pending rotation.'],
        ['Webhook integrity: SI-7, SC-8 / A.8.24', 'FALTA', 'Resend webhooks are accepted unsigned if you do not set `WEBHOOK_SECRET` / `RESEND_WEBHOOK_SECRET` (per-organiser decision, only a log warning).'],
        ['Secure defaults: CIS 4 / CM-6 / A.8.9', 'PARCIAL', 'Good defaults (`__Host-`, `v3`, 24 h TTL) alongside permissive ones: open sign-up on the backend, `ASSET_UNSIGNED_UPLOADS=allow`, AV fail-open, optional dedicated key.'],
    ] },
    { t: 'h2', id: 'not-covered', text: 'What BloomX does not cover' },
    { t: 'ul', items: [
        'Vulnerability and dependency management: the frontend uses `next: "latest"` and `react: "latest"` with no pinned version; the backend uses `lucia` and `oslo`, marked deprecated by their authors.',
        'Backups, disaster recovery and continuity: they depend on your database and storage provider ([Operations](/docs/operations#backups)).',
        'Incident management, training, physical control and governance: outside the software\'s scope.',
        'DLP: the `dlp` extension exists (blocks by keywords and detectors in `EMAIL_PRE_SEND`), but sealed sending bypasses it and it only sees the outer email.',
    ] },
    { t: 'callout', kind: 'note', text: 'Verified by reading the code; no penetration tests were run. The `UserMfa`, `RevokedSession`, `AuditEvent` and `SecureMessageMeta` tables must exist in the deployed environment (`npm run db:ensure`) for the matching controls to be active.' },
];

const page: DocPageContent = { es, en };
export default page;
