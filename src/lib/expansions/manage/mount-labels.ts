/** Nombres legibles (es/en) de los puntos de montaje para el usuario (PURO). */
import type { ManageLocale } from './permissions';

export const MOUNT_LABELS: Record<string, { es: string; en: string }> = {
    EMAIL_TOOLBAR: { es: 'Barra del correo', en: 'Mail toolbar' },
    EMAIL_FOOTER: { es: 'Pie del correo', en: 'Mail footer' },
    EMAIL_HEADER: { es: 'Cabecera del correo', en: 'Mail header' },
    EMAIL_READER_SIDEBAR: { es: 'Panel lateral del lector de correo', en: 'Mail reader side panel' },
    EMAIL_LIST_ROW_ACTION: { es: 'Acciones de cada fila de la bandeja', en: 'Inbox row actions' },
    CONTEXT_MENU: { es: 'Menu contextual', en: 'Context menu' },
    SIDEBAR_HEADER: { es: 'Cabecera de la barra lateral', en: 'Sidebar header' },
    SIDEBAR_FOOTER: { es: 'Pie de la barra lateral', en: 'Sidebar footer' },
    SIDEBAR_PANEL: { es: 'Panel de la barra lateral', en: 'Sidebar panel' },
    COMPOSER_TOOLBAR: { es: 'Barra del redactor', en: 'Composer toolbar' },
    COMPOSER_INIT: { es: 'Al abrir el redactor', en: 'When the composer opens' },
    COMPOSER_SIDEBAR: { es: 'Panel lateral del redactor', en: 'Composer side panel' },
    CALENDAR_TOOLBAR: { es: 'Barra del calendario', en: 'Calendar toolbar' },
    CALENDAR_EVENT_PANEL: { es: 'Panel de evento del calendario', en: 'Calendar event panel' },
    CONTACTS_TOOLBAR: { es: 'Barra de contactos', en: 'Contacts toolbar' },
    CONTACT_CARD_PANEL: { es: 'Panel de la ficha de contacto', en: 'Contact card panel' },
    SETTINGS_PANEL: { es: 'Panel de ajustes', en: 'Settings panel' },
    EVENT_LOCATION_BUILDER: { es: 'Lugar del evento (videollamada)', en: 'Event location (video call)' },
    CALENDAR_HEADER: { es: 'Cabecera del calendario', en: 'Calendar header' },
    CALENDAR_SIDEBAR: { es: 'Barra lateral del calendario', en: 'Calendar sidebar' },
    CALENDAR_SIDEBAR_BOTTOM: { es: 'Parte inferior de la barra del calendario', en: 'Bottom of the calendar sidebar' },
    CALENDAR_ADD_SOURCES: { es: 'Anadir calendarios', en: 'Add calendars' },
    CONTACTS_HEADER: { es: 'Cabecera de contactos', en: 'Contacts header' },
    CONTACTS_SIDEBAR: { es: 'Barra lateral de contactos', en: 'Contacts sidebar' },
    CONTACTS_SIDEBAR_BOTTOM: { es: 'Parte inferior de la barra de contactos', en: 'Bottom of the contacts sidebar' },
    SETTINGS_TAB: { es: 'Pestana de ajustes', en: 'Settings tab' },
    CUSTOM_SETTINGS_TAB: { es: 'Pestana propia en ajustes', en: 'Own settings tab' },
    CUSTOM_ROUTE: { es: 'Ruta propia', en: 'Own route' },
    PAGE: { es: 'Pagina propia', en: 'Own page' },
    OVERLAY: { es: 'Ventana emergente', en: 'Pop-up window' },
    SLASH_COMMAND: { es: 'Comando "/" del redactor', en: 'Composer "/" command' },
    BEFORE_SEND_HANDLER: { es: 'Revision antes de enviar', en: 'Check before sending' },
    ON_BODY_CHANGE_HANDLER: { es: 'Al cambiar el texto del mensaje', en: 'When the message text changes' },
    ON_SUBJECT_CHANGE_HANDLER: { es: 'Al cambiar el asunto', en: 'When the subject changes' },
    ON_RECIPIENTS_CHANGE_HANDLER: { es: 'Al cambiar los destinatarios', en: 'When the recipients change' },
};

/** Nombre legible; un punto desconocido se muestra tal cual. */
export function mountLabel(point: string, locale: ManageLocale = 'es'): string {
    const info = Object.prototype.hasOwnProperty.call(MOUNT_LABELS, point) ? MOUNT_LABELS[point] : null;
    return info ? info[locale === 'en' ? 'en' : 'es'] : point;
}
