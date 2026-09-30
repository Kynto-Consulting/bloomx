/**
 * Iconos FUNCIONALES recomendados para extensiones que no integran una marca concreta (DLP, firma, traductor, resumen con IA...).
 * Son iconos de Lucide con su nombre: en un manifest se declaran como "lucide:<Nombre>" (p. ej. "lucide:ShieldCheck").
 * Esta lista documenta la convencion (la pagina de docs se genera de aqui) y la verifican los tests: todos existen en Lucide.
 */
export interface FunctionalIcon {
    /** Funcion que representa. */
    slug: string;
    /** Nombre del icono de Lucide. */
    lucide: string;
    name: { es: string; en: string };
}

export const FUNCTIONAL_ICONS: readonly FunctionalIcon[] = [
    { slug: 'dlp', lucide: 'ShieldCheck', name: { es: 'Prevencion de fuga de datos (DLP)', en: 'Data loss prevention (DLP)' } },
    { slug: 'signature', lucide: 'PenLine', name: { es: 'Firma', en: 'Signature' } },
    { slug: 'translator', lucide: 'Languages', name: { es: 'Traductor', en: 'Translator' } },
    { slug: 'ai-summary', lucide: 'Sparkles', name: { es: 'Resumen con IA', en: 'AI summary' } },
    { slug: 'organizer', lucide: 'FolderTree', name: { es: 'Organizador', en: 'Organizer' } },
    { slug: 'sealer', lucide: 'Lock', name: { es: 'Sellado (candado)', en: 'Sealer (lock)' } },
    { slug: 'mail-groups', lucide: 'Users', name: { es: 'Grupos de correo', en: 'Mail groups' } },
    { slug: 'webhooks', lucide: 'Webhook', name: { es: 'Webhooks', en: 'Webhooks' } },
    { slug: 'slash-commands', lucide: 'SquareSlash', name: { es: 'Comandos con /', en: 'Slash commands' } },
    { slug: 'smart-reply', lucide: 'Reply', name: { es: 'Respuesta inteligente', en: 'Smart reply' } },
    { slug: 'composer-helper', lucide: 'WandSparkles', name: { es: 'Asistente de redaccion', en: 'Writing assistant' } },
    { slug: 'appointments', lucide: 'CalendarClock', name: { es: 'Citas', en: 'Appointments' } },
    { slug: 'sync', lucide: 'RefreshCw', name: { es: 'Sincronizacion', en: 'Sync' } },
    { slug: 'conferencing', lucide: 'Video', name: { es: 'Videollamada', en: 'Video call' } },
    { slug: 'calendar', lucide: 'CalendarDays', name: { es: 'Calendario', en: 'Calendar' } },
    { slug: 'contacts', lucide: 'Users', name: { es: 'Contactos', en: 'Contacts' } },
    { slug: 'ai', lucide: 'Bot', name: { es: 'Asistente de IA', en: 'AI assistant' } },
    { slug: 'automation', lucide: 'Workflow', name: { es: 'Automatizacion', en: 'Automation' } },
    { slug: 'extension', lucide: 'Puzzle', name: { es: 'Extension generica', en: 'Generic extension' } },
];
