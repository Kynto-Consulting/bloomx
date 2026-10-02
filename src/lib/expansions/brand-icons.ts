/**
 * REGISTRO DE ICONOS DE MARCA de las apps que integran las extensiones. ARCHIVO GENERADO: no lo edites a mano.
 *   Fuente:    simple-icons 16.33.0 (CC0-1.0), solo nombre y color de los iconos listados en scripts/generate-brand-icons.mjs
 * SIN rutas SVG: los dibujos se cargan async desde GET /api/extensions/icons/brand.<slug> (bloomx-extensions/_brands). Este indice solo da el
 * placeholder instantaneo (ficha con inicial en el color de la marca) y el respaldo si el backend no responde.
 *   Regenerar: npm run icons:brands
 *
 * Cada entrada es DATO (nombre + color oficial de la marca; el dibujo vive en el backend), no estilo de la app: por eso este fichero esta en la
 * allowlist de la guardia no-raw-colors. El componente ExtensionIcon aplica una garantia de contraste (>= 3:1) al color oficial
 * segun el tema activo.
 *
 * Marcas registradas: los logotipos pertenecen a sus titulares y se usan SOLO para identificar la integracion con ese servicio; no
 * implican patrocinio ni afiliacion. Microsoft, Teams y Slack (retiradas de simple-icons) se sirven como SVG propio desde el backend
 * (_brands/); el resto sin logotipo se muestra como inicial en una ficha neutra (NEUTRAL_BRANDS).
 */

export interface BrandIcon {
    /** Identificador estable (minusculas), el de `brand:<slug>`. */
    slug: string;
    /** Nombre comercial. */
    name: string;
    /** Color oficial `#rrggbb`. */
    hex: string;
}

export interface NeutralBrand {
    slug: string;
    name: string;
    /** Inicial que se muestra en la ficha neutra. */
    initial: string;
    /** Icono Lucide de reserva. */
    lucide: string;
}

export const BRAND_ICONS: Readonly<Record<string, BrandIcon>> = {
    googlemeet: { slug: 'googlemeet', name: "Google Meet", hex: '#00897b' },
    googlecalendar: { slug: 'googlecalendar', name: "Google Calendar", hex: '#4285f4' },
    googledrive: { slug: 'googledrive', name: "Google Drive", hex: '#4285f4' },
    googlesheets: { slug: 'googlesheets', name: "Google Sheets", hex: '#34a853' },
    googledocs: { slug: 'googledocs', name: "Google Docs", hex: '#4285f4' },
    googlegemini: { slug: 'googlegemini', name: "Google Gemini", hex: '#8e75b2' },
    gmail: { slug: 'gmail', name: "Gmail", hex: '#ea4335' },
    google: { slug: 'google', name: "Google", hex: '#4285f4' },
    zoom: { slug: 'zoom', name: "Zoom", hex: '#0b5cff' },
    notion: { slug: 'notion', name: "Notion", hex: '#000000' },
    trello: { slug: 'trello', name: "Trello", hex: '#0052cc' },
    hubspot: { slug: 'hubspot', name: "HubSpot", hex: '#ff7a59' },
    giphy: { slug: 'giphy', name: "GIPHY", hex: '#ff6666' },
    zoho: { slug: 'zoho', name: "Zoho", hex: '#e42527' },
    github: { slug: 'github', name: "GitHub", hex: '#181717' },
    gitlab: { slug: 'gitlab', name: "GitLab", hex: '#fc6d26' },
    jira: { slug: 'jira', name: "Jira", hex: '#0052cc' },
    linear: { slug: 'linear', name: "Linear", hex: '#5e6ad2' },
    asana: { slug: 'asana', name: "Asana", hex: '#f06a6a' },
    clickup: { slug: 'clickup', name: "ClickUp", hex: '#7b68ee' },
    airtable: { slug: 'airtable', name: "Airtable", hex: '#18bfff' },
    stripe: { slug: 'stripe', name: "Stripe", hex: '#635bff' },
    dropbox: { slug: 'dropbox', name: "Dropbox", hex: '#0061ff' },
    todoist: { slug: 'todoist', name: "Todoist", hex: '#e44332' },
    calendly: { slug: 'calendly', name: "Calendly", hex: '#006bff' },
    discord: { slug: 'discord', name: "Discord", hex: '#5865f2' },
    whatsapp: { slug: 'whatsapp', name: "WhatsApp", hex: '#25d366' },
    telegram: { slug: 'telegram', name: "Telegram", hex: '#26a5e4' },
    anthropic: { slug: 'anthropic', name: "Anthropic", hex: '#191919' },
    microsoft: { slug: 'microsoft', name: "Microsoft", hex: '#00a4ef' },
    microsoftteams: { slug: 'microsoftteams', name: "Microsoft Teams", hex: '#5059c9' },
    slack: { slug: 'slack', name: "Slack", hex: '#e01e5a' },
};

export const NEUTRAL_BRANDS: Readonly<Record<string, NeutralBrand>> = {
    microsoftoutlook: { slug: 'microsoftoutlook', name: "Microsoft Outlook", initial: 'O', lucide: 'Mail' },
    salesforce: { slug: 'salesforce', name: "Salesforce", initial: 'S', lucide: 'Cloud' },
    openai: { slug: 'openai', name: "OpenAI", initial: 'O', lucide: 'Bot' },
};
