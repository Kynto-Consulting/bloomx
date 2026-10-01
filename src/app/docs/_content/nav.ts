import type { DocNavSection, DocNavPage, Locale } from './types';
import { KIT_BASE, kitGroups, kitHref } from './ui-kit/kit';

/**
 * Navegacion unica de la documentacion (layout, buscador, anterior/siguiente y tests).
 * Sin imports de React: se importa desde tests de vitest en entorno node.
 */
export const DOC_NAV: DocNavSection[] = [
    {
        id: 'start',
        title: { es: 'Primeros pasos', en: 'Getting started' },
        pages: [
            { slug: '', icon: 'home', title: { es: 'Introducción', en: 'Introduction' }, description: { es: 'Qué es BloomX y cómo se organiza esta documentación.', en: 'What BloomX is and how this documentation is organised.' }, keywords: 'inicio bienvenida overview' },
            { slug: 'architecture', icon: 'layers', title: { es: 'Arquitectura', en: 'Architecture' }, description: { es: 'Backend compartido multi-tenant, N frontends y flujo de servicios.', en: 'Shared multi-tenant backend, N frontends and service flow.' }, keywords: 'multi-tenant backend compartido diagrama hkdf ed25519 cors' },
            { slug: 'getting-started', icon: 'rocket', title: { es: 'Puesta en marcha', en: 'Getting started guide' }, description: { es: 'De cero a un despliegue funcionando, en orden.', en: 'From zero to a working deployment, in order.' }, keywords: 'instalar checklist db:ensure local dev' },
            { slug: 'env-variables', icon: 'key', title: { es: 'Variables de entorno', en: 'Environment variables' }, description: { es: 'Todas las variables: obligatorias y opcionales, frontend y backend.', en: 'Every variable: required and optional, frontend and backend.' }, keywords: 'env secretos NEXTAUTH_SECRET DATABASE_URL' },
            { slug: 'deployment', icon: 'server', title: { es: 'Despliegue', en: 'Deployment' }, description: { es: 'Vercel (frontend y backend), cron, Upstash y base de datos.', en: 'Vercel (frontend and backend), cron, Upstash and database.' }, keywords: 'vercel cron upstash neon produccion' },
            { slug: 'email-setup', icon: 'mail', title: { es: 'Correo: Resend y DNS', en: 'Email: Resend and DNS' }, description: { es: 'Webhooks de Resend, SPF, DKIM, DMARC, MTA-STS y TLS-RPT.', en: 'Resend webhooks, SPF, DKIM, DMARC, MTA-STS and TLS-RPT.' }, keywords: 'resend dns spf dkim dmarc mta-sts tls-rpt webhook' },
        ],
    },
    {
        id: 'customize',
        title: { es: 'Personalización', en: 'Customisation' },
        pages: [
            { slug: 'themes', icon: 'palette', title: { es: 'Temas empresariales', en: 'Enterprise themes' }, description: { es: 'Paleta por modo, tokens, radio, fuentes, contraste AA.', en: 'Per-mode palette, tokens, radius, fonts, AA contrast.' }, keywords: 'tema color paleta tokens contraste wcag lockBrand' },
            { slug: 'landing', icon: 'layout', title: { es: 'Landing y login', en: 'Landing and login' }, description: { es: 'Layouts, hero, testimonios, textos por idioma y registro.', en: 'Layouts, hero, testimonials, per-language text and sign-up.' }, keywords: 'login landing hero testimonios footer registro' },
            { slug: 'hide-docs', icon: 'eye-off', title: { es: 'Ocultar o mostrar docs', en: 'Hide or show docs' }, description: { es: 'Cómo una empresa oculta esta documentación o sus enlaces.', en: 'How a company hides this documentation or its links.' }, keywords: 'landing.docs visible footer sidebar' },
        ],
    },
    {
        id: 'product',
        title: { es: 'Funciones', en: 'Features' },
        pages: [
            { slug: 'features', icon: 'sparkles', title: { es: 'Funciones del correo', en: 'Mail features' }, description: { es: 'Reglas, labels, búsqueda, contactos, citas, offline, atajos e i18n.', en: 'Rules, labels, search, contacts, appointments, offline, shortcuts and i18n.' }, keywords: 'reglas etiquetas busqueda operadores contactos calendario pwa atajos' },
            { slug: 'elixir', icon: 'flask', title: { es: 'Elixir y Liquid', en: 'Elixir and Liquid' }, description: { es: 'Plantillas, filtros, campañas en segundo plano y bajas.', en: 'Templates, filters, background campaigns and unsubscribes.' }, keywords: 'liquid campanas plantillas filtros supresion baja csv' },
            { slug: 'conferencing', icon: 'zap', title: { es: 'Reuniones (Zoom y Meet)', en: 'Meetings (Zoom and Meet)' }, description: { es: 'Crear reuniones de Zoom, Google Meet o enlace propio desde calendario, correo y citas.', en: 'Create Zoom, Google Meet or own-link meetings from calendar, mail and appointments.' }, keywords: 'zoom meet reunion videollamada conferencia calendario invitacion ics oauth service account server-to-server idempotencia' },
            { slug: 'sealer', icon: 'lock', title: { es: 'Sealer y Organizer', en: 'Sealer and Organizer' }, description: { es: 'Envío sellado (con sus límites reales) y organización con IA.', en: 'Sealed sending (with its real limits) and AI organising.' }, keywords: 'sealer organizer secure cifrado ia propuestas undo' },
            { slug: 'ai', icon: 'wand', title: { es: 'Capacidades de IA', en: 'AI capabilities' }, description: { es: 'Proveedores y qué funciones usan IA.', en: 'Providers and which features use AI.' }, keywords: 'openai anthropic gemini cohere' },
            { slug: 'storage', icon: 'database', title: { es: 'Almacenamiento', en: 'Storage' }, description: { es: 'Adjuntos y activos en S3/B2/R2.', en: 'Attachments and assets on S3/B2/R2.' }, keywords: 's3 r2 b2 minio adjuntos' },
        ],
    },
    {
        id: 'security',
        title: { es: 'Seguridad', en: 'Security' },
        pages: [
            { slug: 'security', icon: 'shield', title: { es: 'Seguridad y cifrado', en: 'Security and encryption' }, description: { es: 'Amenazas, sesiones, MFA, cifrado, assets firmados, auditoría y CSP.', en: 'Threats, sessions, MFA, encryption, signed assets, audit and CSP.' }, keywords: 'jwt mfa totp cifrado aes csp rate limit retencion antivirus' },
            { slug: 'compliance', icon: 'scale', title: { es: 'Mapeo CIS / NIST / ISO', en: 'CIS / NIST / ISO mapping' }, description: { es: 'Qué se cumple, qué es parcial y qué falta, sin maquillaje.', en: 'What is met, partial and missing, without gloss.' }, keywords: 'cis nist iso 27001 cumplimiento' },
        ],
    },
    {
        id: 'developers',
        title: { es: 'Desarrolladores', en: 'Developers' },
        pages: [
            { slug: 'expansions', icon: 'component', title: { es: 'Extensiones', en: 'Extensions' }, description: { es: 'Contrato handler(ctx), manifest, permisos, sandbox y hooks.', en: 'handler(ctx) contract, manifest, permissions, sandbox and hooks.' }, keywords: 'expansiones plugins manifest permisos sandbox worker_threads hooks slashCommands' },
            { slug: 'oauth-providers', icon: 'key', title: { es: 'Proveedores OAuth como extensión', en: 'OAuth providers as extensions' }, description: { es: 'Escribir un proveedor OAuth, dependencias, modos de autenticación, STRIDE y cumplimiento.', en: 'Writing an OAuth provider, dependencies, auth modes, STRIDE and compliance.' }, keywords: 'oauth google pkce dependencias backendRoutes hmac stride rfc 9700' },
            { slug: 'create-extension', icon: 'wrench', title: { es: 'Crear una extensión', en: 'Build an extension' }, description: { es: 'Paso a paso con un ejemplo mínimo.', en: 'Step by step with a minimal example.' }, keywords: 'tutorial ejemplo handler manifest publicar' },
            { slug: 'extension-ui', icon: 'component', title: { es: 'Kit de componentes y UI', en: 'Component kit and UI' }, description: { es: 'Componentes, tematización, estado, expresiones y acciones de las extensiones.', en: 'Extension components, theming, state, expressions and actions.' }, keywords: 'kit componentes ui json tone variant tema contraste schema validacion migracion bind state expresiones acciones formularios tabla' },
            { slug: 'extension-tools', icon: 'wrench', title: { es: 'Herramientas de extensiones', en: 'Extension tools' }, description: { es: 'SDK, plantilla, validador, playground, galería y gestión en /extensions.', en: 'SDK, template, validator, playground, gallery and /extensions management.' }, keywords: 'sdk plantilla template validador validate playground galeria componentes gestion extensions errores permisos build-manifest' },
            { slug: 'extension-tools/tsdocs', icon: 'code', title: { es: 'TSDocs: referencia del SDK', en: 'TSDocs: SDK reference' }, description: { es: 'Interfaces, tipos, funciones, acciones y servicios del host, generados de los .d.ts del SDK.', en: 'Interfaces, types, functions, actions and host services, generated from the SDK .d.ts files.' }, keywords: 'tsdocs typedoc sdk tipos interfaces manifest ctx handler services storage notify defineManifest referencia api' },
            { slug: 'api', icon: 'code', title: { es: 'API del frontend', en: 'Frontend API' }, description: { es: 'Endpoints públicos y autenticados con ejemplos curl.', en: 'Public and authenticated endpoints with curl examples.' }, keywords: 'rest curl endpoints codigos error limites' },
            { slug: 'api-backend', icon: 'plug', title: { es: 'API del backend y firma', en: 'Backend API and signing' }, description: { es: 'Backend compartido y protocolo de firma v1 con código Node.', en: 'Shared backend and the v1 signing protocol with Node code.' }, keywords: 'firma ed25519 register-domain verify-domain X-BloomX-Signature' },
        ],
    },
    {
        id: 'ops',
        title: { es: 'Operación', en: 'Operations' },
        pages: [
            { slug: 'admin', icon: 'shield', title: { es: 'Consola de administración', en: 'Administration console' }, description: { es: 'Usuarios, cuentas, correo, marca, extensiones, seguridad, auditoría y retención.', en: 'Users, accounts, mail, brand, extensions, security, audit and retention.' }, keywords: 'admin consola usuarios mfa sesiones supresion dns auditoria retencion clave firma' },
            { slug: 'spam', icon: 'shield', title: { es: 'Filtro de spam y remitentes', en: 'Spam filter and senders' }, description: { es: 'Motor explicable, niveles, listas de bloqueo y permitidos, aprendizaje y correos externos.', en: 'Explainable engine, levels, block and allow lists, learning and external mail.' }, keywords: 'spam antispam phishing suplantacion bloqueo bloqueados permitidos lista negra blanca externos externo whitelist blocklist umbral nivel bayes aprendizaje dmarc spf dkim' },
            { slug: 'mail-transfer', icon: 'mail', title: { es: 'Importar y exportar correo', en: 'Import and export mail' }, description: { es: 'MBOX, EML, ZIP y PST desde Gmail, Titan, Outlook o Thunderbird; buzones faltantes, cifrado y salvaguardas.', en: 'MBOX, EML, ZIP and PST from Gmail, Titan, Outlook or Thunderbird; missing mailboxes, encryption and safeguards.' }, keywords: 'importar exportar mbox eml pst takeout gmail titan outlook hotmail thunderbird migrar respaldo cifrado buzones' },
            { slug: 'operations', icon: 'life-buoy', title: { es: 'Operación y pruebas', en: 'Operations and testing' }, description: { es: 'Backups, migraciones, pruebas, E2E y solución de problemas.', en: 'Backups, migrations, tests, E2E and troubleshooting.' }, keywords: 'backup migraciones vitest test:pg e2e check:themes troubleshooting' },
            { slug: 'admin-cli', icon: 'code', title: { es: 'Admin CLI y consola de comandos', en: 'Admin CLI and command console' }, description: { es: 'Terminal web y CLI `bloomx` por HTTPS: instalación, login, niveles de permisos, sesión privilegiada única, tokens y comandos.', en: 'Web terminal and `bloomx` CLI over HTTPS: install, login, permission levels, single privileged session, tokens and commands.' }, keywords: 'cli bloomx consola comandos terminal ssh token permission_level niveles permisos sesion privilegiada superseded step-up mfa admin' },
            { slug: 'faq', icon: 'help', title: { es: 'Preguntas frecuentes', en: 'FAQ' }, description: { es: 'Respuestas rápidas a los problemas habituales.', en: 'Quick answers to common problems.' }, keywords: 'faq preguntas errores 503 login' },
        ],
    },
];

export const DOC_PAGES: DocNavPage[] = DOC_NAV.flatMap((s) => s.pages);

export function docHref(slug: string): string {
    return slug ? `/docs/${slug}` : '/docs';
}

export function findDocPage(slug: string): DocNavPage | undefined {
    return DOC_PAGES.find((p) => p.slug === slug);
}

/** Pagina anterior/siguiente en el orden de la navegacion. */
export function neighbours(slug: string): { prev?: DocNavPage; next?: DocNavPage } {
    const i = DOC_PAGES.findIndex((p) => p.slug === slug);
    if (i < 0) return {};
    return { prev: DOC_PAGES[i - 1], next: DOC_PAGES[i + 1] };
}

// ---------------------------------------------------------------------------
// Componentes del kit de UI (una ruta /docs/extension-ui/<componente> por cada uno de UI_COMPONENTS)
// ---------------------------------------------------------------------------

export interface KitNavItem { type: string; href: string }
export interface KitNavGroup { id: string; title: Record<Locale, string>; items: KitNavItem[] }

/** Navegacion lateral de los componentes, agrupada por categoria. Se genera del esquema: no se mantiene a mano. */
export const KIT_NAV: KitNavGroup[] = kitGroups().map((g) => ({ id: g.id, title: g.label, items: g.types.map((type) => ({ type, href: kitHref(type) })) }));

export function kitNavSection(): { title: Record<Locale, string>; href: string } {
    return { title: { es: 'Componentes de UI', en: 'UI components' }, href: KIT_BASE };
}

export function findKitEntry(pathname: string | null): KitNavItem | undefined {
    if (!pathname) return undefined;
    const clean = pathname.replace(/\/$/, '');
    for (const g of KIT_NAV) for (const item of g.items) if (item.href === clean) return item;
    return undefined;
}
