import type { DocPageContent } from '../types';

const page: DocPageContent = {
    es: [
        { t: 'p', text: '**BloomX** es un cliente de correo web multi-empresa, con marca propia por dominio, que recibe y envía a través de **Resend**, guarda en PostgreSQL y almacenamiento S3-compatible, y se amplía con extensiones. Esta documentación describe el sistema **tal como está hoy** y se verifica contra el código.' },
        { t: 'h2', id: 'pillars', text: 'Qué ofrece' },
        { t: 'ul', items: [
            '**Multi-tenant real**: N frontends (uno por empresa) sobre un backend compartido, sin secretos globales: cada instancia se autentica con su propia clave Ed25519 ([Arquitectura](/docs/architecture)).',
            '**Tu marca completa**: paleta por modo claro/oscuro, radio, tipografía y una landing de login configurable, con contraste AA garantizado ([Temas](/docs/themes), [Landing](/docs/landing)).',
            '**Correo completo**: bandeja con búsqueda por operadores, etiquetas y reglas, contactos, calendario y citas, PWA, atajos e i18n es/en ([Funciones](/docs/features)).',
            '**Envíos masivos**: Elixir con plantillas Liquid, campañas en segundo plano, cuotas y bajas de un clic ([Elixir](/docs/elixir)).',
            '**Extensibilidad**: extensiones con contrato `handler(ctx)`, permisos, credenciales por dominio y hooks (DLP incluido) ([Extensiones](/docs/expansions)).',
            '**Seguridad por capas**: MFA TOTP, sesiones revocables, cifrado en reposo con rotación de claves, assets firmados, antivirus opcional y auditoría ([Seguridad](/docs/security)).',
        ] },
        { t: 'callout', kind: 'note', title: 'Honestidad ante todo', text: 'Cada página indica lo que **no** existe o funciona a medias (por ejemplo: sin IMAP, snooze sin interfaz, sandbox que no es frontera fuerte, hook `CRON` sin disparador). La [matriz CIS / NIST / ISO](/docs/compliance) y los apartados "Límites" no maquillan.' },
        { t: 'h2', id: 'where', text: 'Por dónde empezar' },
        { t: 'ul', items: [
            'Quiero **poner BloomX en marcha**: [Puesta en marcha](/docs/getting-started), [Variables de entorno](/docs/env-variables), [Despliegue](/docs/deployment) y [Correo: Resend y DNS](/docs/email-setup).',
            'Quiero **entender cómo encaja todo**: [Arquitectura](/docs/architecture) y [Seguridad](/docs/security).',
            'Soy **diseñador** y quiero adaptar la marca: [Temas empresariales](/docs/themes) y [Landing y login](/docs/landing).',
            'Soy **desarrollador**: [Crear una extensión](/docs/create-extension), [API del frontend](/docs/api) y [API del backend y firma](/docs/api-backend).',
            'Algo **falla**: [Operación y pruebas](/docs/operations#troubleshooting) y [Preguntas frecuentes](/docs/faq).',
        ] },
        { t: 'h2', id: 'using-docs', text: 'Cómo usar esta documentación' },
        { t: 'ul', items: [
            'Busca en el cuadro de la cabecera (atajo `/`): indexa todas las páginas en el idioma activo.',
            'Cada página tiene tabla de contenido (a la derecha en pantallas anchas, plegable en móvil) y enlaces a la página anterior y siguiente.',
            'Los bloques de código tienen botón **Copiar**. Todos los valores son marcadores de posición: nunca pegues secretos reales en el repositorio.',
            'Cambia de idioma con los botones ES / EN de la cabecera. Cada empresa puede [ocultar o mostrar](/docs/hide-docs) esta documentación.',
        ] },
        { t: 'h2', id: 'repos', text: 'Repositorios' },
        { t: 'table', head: ['Repositorio', 'Contenido'], rows: [
            ['`bloomx`', 'Frontend Next.js: interfaz, API `/api/*`, esquema con `db:ensure`, esta documentación'],
            ['`bloomx-backend`', 'Backend compartido: `/api/config`, registro de dominios, extensiones y sandbox, pagos'],
            ['`bloomx-extensions`', 'Extensiones (`manifest.json` + `server.js`), schema compartido y tests de contrato'],
        ] },
    ],
    en: [
        { t: 'p', text: '**BloomX** is a multi-company web mail client, branded per domain, that receives and sends through **Resend**, stores in PostgreSQL and S3-compatible storage, and grows through extensions. This documentation describes the system **as it is today** and is verified against the code.' },
        { t: 'h2', id: 'pillars', text: 'What it offers' },
        { t: 'ul', items: [
            '**Real multi-tenancy**: N frontends (one per company) over a shared backend, with no global secrets: each instance authenticates with its own Ed25519 key ([Architecture](/docs/architecture)).',
            '**Your full brand**: per light/dark mode palette, radius, typography and a configurable login landing, with guaranteed AA contrast ([Themes](/docs/themes), [Landing](/docs/landing)).',
            '**Complete mail**: inbox with operator search, labels and rules, contacts, calendar and appointments, PWA, shortcuts and es/en i18n ([Features](/docs/features)).',
            '**Bulk sending**: Elixir with Liquid templates, background campaigns, quotas and one-click unsubscribe ([Elixir](/docs/elixir)).',
            '**Extensibility**: extensions with the `handler(ctx)` contract, permissions, per-domain credentials and hooks (DLP included) ([Extensions](/docs/expansions)).',
            '**Layered security**: TOTP MFA, revocable sessions, encryption at rest with key rotation, signed assets, optional antivirus and audit ([Security](/docs/security)).',
        ] },
        { t: 'callout', kind: 'note', title: 'Honesty first', text: 'Each page says what does **not** exist or only half works (for example: no IMAP, snooze without UI, a sandbox that is not a strong boundary, a `CRON` hook with no trigger). The [CIS / NIST / ISO matrix](/docs/compliance) and the "Limits" sections do not gloss over anything.' },
        { t: 'h2', id: 'where', text: 'Where to start' },
        { t: 'ul', items: [
            'I want to **get BloomX running**: [Getting started guide](/docs/getting-started), [Environment variables](/docs/env-variables), [Deployment](/docs/deployment) and [Email: Resend and DNS](/docs/email-setup).',
            'I want to **understand how it fits together**: [Architecture](/docs/architecture) and [Security](/docs/security).',
            'I am a **designer** adapting the brand: [Enterprise themes](/docs/themes) and [Landing and login](/docs/landing).',
            'I am a **developer**: [Build an extension](/docs/create-extension), [Frontend API](/docs/api) and [Backend API and signing](/docs/api-backend).',
            'Something **fails**: [Operations and testing](/docs/operations#troubleshooting) and [FAQ](/docs/faq).',
        ] },
        { t: 'h2', id: 'using-docs', text: 'How to use this documentation' },
        { t: 'ul', items: [
            'Search with the header box (shortcut `/`): it indexes every page in the active language.',
            'Each page has a table of contents (on the right on wide screens, collapsible on mobile) and previous/next links.',
            'Code blocks have a **Copy** button. Every value is a placeholder: never paste real secrets into the repository.',
            'Switch language with the header ES / EN buttons. Each company can [hide or show](/docs/hide-docs) this documentation.',
        ] },
        { t: 'h2', id: 'repos', text: 'Repositories' },
        { t: 'table', head: ['Repository', 'Contents'], rows: [
            ['`bloomx`', 'Next.js frontend: UI, `/api/*` API, schema with `db:ensure`, this documentation'],
            ['`bloomx-backend`', 'Shared backend: `/api/config`, domain registration, extensions and sandbox, payments'],
            ['`bloomx-extensions`', 'Extensions (`manifest.json` + `server.js`), shared schema and contract tests'],
        ] },
    ],
};

export default page;
