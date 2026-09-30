/**
 * Registro de contexto por punto de montaje de extensiones.
 *
 * - MOUNT_POINT_CONTEXT documenta, por punto, en que pantalla se pinta y que claves recibe la extension (las
 *   expresiones `${context.xxx}` del manifest leen estas claves).
 * - buildMountContext(point, raw) normaliza lo que entrega el componente anfitrion al contexto estable del punto.
 *   Siempre pasa por toBackendContext: se quitan funciones, auth/user/env/services/settings..., y el cliente nunca
 *   fija identidad (el servidor inyecta userId/auth desde la sesion firmada).
 *
 * Nota: los componentes anfitriones solo necesitan pasar datos crudos; aqui se recortan a la lista blanca documentada.
 */

import { buildReadingContext, toBackendContext } from './context';

export interface MountPointInfo {
    surface: string;
    description: string;
    /** clave del contexto -> descripcion */
    contextKeys: Record<string, string>;
}

const EMAIL_KEYS: Record<string, string> = {
    email: '{ id, from, to, cc, subject, folder, date, isRead, labels, hasAttachments } del correo',
    emailContent: 'Texto plano ya resuelto del correo abierto (sin HTML)',
    fromContact: '{ email, name, firstName, lastName } del remitente',
    content: 'Cuerpo del correo tal como lo entrega el anfitrion (texto o HTML saneado)',
};

const COMPOSER_KEYS: Record<string, string> = {
    emailContent: 'Texto plano del cuerpo en edicion',
    subject: 'Asunto actual',
    to: 'Destinatarios (Para)',
    cc: 'Destinatarios en copia',
    bcc: 'Destinatarios en copia oculta',
    sender: 'Remitente seleccionado',
};

export const MOUNT_POINT_CONTEXT: Record<string, MountPointInfo> = {
    // --- Correo (lectura) ---
    EMAIL_TOOLBAR: { surface: 'mail.reader', description: 'Barra de acciones del correo abierto', contextKeys: EMAIL_KEYS },
    EMAIL_HEADER: { surface: 'mail.reader', description: 'Cabecera del correo abierto', contextKeys: EMAIL_KEYS },
    EMAIL_FOOTER: { surface: 'mail.reader', description: 'Pie del correo abierto', contextKeys: EMAIL_KEYS },
    EMAIL_READER_SIDEBAR: { surface: 'mail.reader', description: 'Panel lateral junto al correo abierto', contextKeys: EMAIL_KEYS },
    EMAIL_LIST_ROW_ACTION: { surface: 'mail.list', description: 'Accion por fila en la lista de correos', contextKeys: EMAIL_KEYS },
    CONTEXT_MENU: { surface: 'mail.list', description: 'Menu contextual de un correo', contextKeys: EMAIL_KEYS },
    // --- Barra lateral de la app ---
    SIDEBAR_HEADER: { surface: 'app.sidebar', description: 'Cabecera de la barra lateral', contextKeys: { folder: 'Carpeta activa', unreadCounts: 'Mapa carpeta -> no leidos (opcional)' } },
    SIDEBAR_FOOTER: { surface: 'app.sidebar', description: 'Pie de la barra lateral', contextKeys: { folder: 'Carpeta activa', unreadCounts: 'Mapa carpeta -> no leidos (opcional)' } },
    SIDEBAR_PANEL: { surface: 'app.sidebar', description: 'Panel propio dentro de la barra lateral', contextKeys: { folder: 'Carpeta activa', unreadCounts: 'Mapa carpeta -> no leidos (opcional)' } },
    // --- Composer ---
    COMPOSER_TOOLBAR: { surface: 'mail.composer', description: 'Barra de herramientas del composer', contextKeys: COMPOSER_KEYS },
    COMPOSER_SIDEBAR: { surface: 'mail.composer', description: 'Panel lateral del composer', contextKeys: COMPOSER_KEYS },
    COMPOSER_INIT: { surface: 'mail.composer', description: 'Inicializacion sin UI del composer', contextKeys: COMPOSER_KEYS },
    // --- Calendario ---
    CALENDAR_TOOLBAR: { surface: 'calendar', description: 'Barra de herramientas del calendario', contextKeys: {
        range: '{ from, to } ISO del rango visible', view: "Vista activa ('day'|'week'|'month'|...)", isGoogleLinked: 'true si hay Google Calendar vinculado',
    } },
    CALENDAR_EVENT_PANEL: { surface: 'calendar', description: 'Panel de detalle de un evento', contextKeys: {
        event: 'Evento (id, title, startsAt, endsAt, allDay, location, attendees...)', calendarId: 'Id del calendario del evento', isReadOnly: 'true si no es editable',
    } },
    CALENDAR_HEADER: { surface: 'calendar', description: 'Cabecera del calendario', contextKeys: { isGoogleLinked: 'true si hay Google Calendar vinculado' } },
    CALENDAR_SIDEBAR: { surface: 'calendar', description: 'Barra lateral del calendario', contextKeys: { isGoogleLinked: 'true si hay Google Calendar vinculado' } },
    CALENDAR_SIDEBAR_BOTTOM: { surface: 'calendar', description: 'Parte inferior de la barra lateral del calendario', contextKeys: { isGoogleLinked: 'true si hay Google Calendar vinculado' } },
    CALENDAR_ADD_SOURCES: { surface: 'calendar', description: 'Selector de fuentes de calendario', contextKeys: { isGoogleLinked: 'true si hay Google Calendar vinculado' } },
    // --- Contactos ---
    CONTACTS_TOOLBAR: { surface: 'contacts', description: 'Barra de herramientas de contactos', contextKeys: {
        contactCount: 'Total de contactos', isGoogleLinked: 'true si hay Google vinculado', selectedIds: 'Ids de contactos seleccionados',
    } },
    CONTACT_CARD_PANEL: { surface: 'contacts', description: 'Panel de la ficha de un contacto', contextKeys: {
        contact: '{ id, email, name, notes, source }',
    } },
    CONTACTS_HEADER: { surface: 'contacts', description: 'Cabecera de contactos', contextKeys: { isGoogleLinked: 'true si hay Google vinculado', contactCount: 'Total de contactos' } },
    CONTACTS_SIDEBAR: { surface: 'contacts', description: 'Barra lateral de contactos', contextKeys: { isGoogleLinked: 'true si hay Google vinculado' } },
    CONTACTS_SIDEBAR_BOTTOM: { surface: 'contacts', description: 'Parte inferior de la barra lateral de contactos', contextKeys: { isGoogleLinked: 'true si hay Google vinculado' } },
    // --- Ajustes ---
    SETTINGS_PANEL: { surface: 'settings', description: 'Panel de ajustes de la extension', contextKeys: {
        extensionId: 'Id de la extension', settings: 'Ajustes guardados de la extension (valores no secretos)',
    } },
};

// ---------------------------------------------------------------------------------------------------------------

const MAX_LIST = 200;

function text(value: unknown, max = 2000): string {
    return typeof value === 'string' ? value.slice(0, max) : '';
}

function asList(value: unknown): unknown[] {
    return Array.isArray(value) ? value.slice(0, MAX_LIST) : [];
}

function isoOrNull(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    const date = value instanceof Date ? value : new Date(value as any);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Forma estable del correo para los puntos de lectura. Sin cuerpo HTML ni claves internas (htmlKey, textKey, ...). */
function emailSummary(raw: any): Record<string, unknown> {
    const labels = asList(raw?.labels).map((label: any) => (typeof label === 'string' ? label : text(label?.name || label?.id, 100))).filter(Boolean);
    const attachments = raw?.attachments;
    return {
        id: text(raw?.id, 100),
        from: text(raw?.from, 400),
        to: text(Array.isArray(raw?.to) ? raw.to.join(', ') : raw?.to, 2000),
        cc: text(Array.isArray(raw?.cc) ? raw.cc.join(', ') : raw?.cc, 2000),
        subject: text(raw?.subject, 998),
        folder: text(raw?.folder, 50),
        date: isoOrNull(raw?.date ?? raw?.createdAt ?? raw?.receivedAt),
        isRead: typeof raw?.isRead === 'boolean' ? raw.isRead : raw?.read === true,
        labels,
        hasAttachments: typeof raw?.hasAttachments === 'boolean' ? raw.hasAttachments : Array.isArray(attachments) && attachments.length > 0,
    };
}

function buildEmailMountContext(raw: any): Record<string, unknown> {
    // MailView pasa el objeto email (con content/html/snippet) o { email, content }: se resuelven ambos.
    const source = raw && typeof raw.email === 'object' && raw.email ? { ...raw.email, content: raw.content ?? raw.email.content, emailContent: raw.emailContent } : raw;
    const resolved = buildReadingContext(source && typeof source === 'object' ? source : {}) || {};
    return {
        email: emailSummary(source),
        emailContent: text(resolved.emailContent, 200_000),
        fromContact: resolved.fromContact,
        content: text(resolved.content ?? source?.content, 200_000),
    };
}

function pickContact(raw: any): Record<string, unknown> {
    const c = raw?.contact ?? raw ?? {};
    return { id: text(c.id, 100), email: text(c.email, 320), name: text(c.name, 300), notes: text(c.notes, 5000), source: text(c.source, 30) };
}

function pickEvent(raw: any): Record<string, unknown> {
    const e = raw?.event ?? raw ?? {};
    return {
        id: text(e.id, 100),
        title: text(e.title, 300),
        description: text(e.description, 5000),
        location: text(e.location, 500),
        startsAt: isoOrNull(e.startsAt),
        endsAt: isoOrNull(e.endsAt),
        allDay: e.allDay === true,
        status: text(e.status, 30),
        calendarId: text(e.calendarId, 100),
        attendees: asList(e.attendees).map((a: any) => ({ email: text(a?.email, 320), name: text(a?.name, 200), responseStatus: text(a?.responseStatus, 30) })),
    };
}

/** Contexto final que recibe la extension montada en `point`. Nunca incluye auth/user/env/services. */
export function buildMountContext(point: string, raw: any): Record<string, any> {
    const input = raw && typeof raw === 'object' ? raw : {};
    let context: Record<string, unknown>;

    switch (point) {
        case 'EMAIL_READER_SIDEBAR':
        case 'EMAIL_LIST_ROW_ACTION':
        case 'CONTEXT_MENU':
            context = buildEmailMountContext(input);
            break;
        case 'CALENDAR_EVENT_PANEL': {
            const event = pickEvent(input);
            context = { event, calendarId: text(input.calendarId ?? event.calendarId, 100), isReadOnly: input.isReadOnly === true };
            break;
        }
        case 'CALENDAR_TOOLBAR':
            context = {
                range: { from: isoOrNull(input.range?.from), to: isoOrNull(input.range?.to) },
                view: text(input.view, 30),
                isGoogleLinked: input.isGoogleLinked === true,
            };
            break;
        case 'CONTACT_CARD_PANEL':
            context = { contact: pickContact(input) };
            break;
        case 'CONTACTS_TOOLBAR':
            context = {
                contactCount: Number.isFinite(Number(input.contactCount)) ? Number(input.contactCount) : 0,
                isGoogleLinked: input.isGoogleLinked === true,
                selectedIds: asList(input.selectedIds).map((id) => text(id, 100)).filter(Boolean),
            };
            break;
        case 'SETTINGS_PANEL':
            // `settings` son los ajustes (no secretos) de la extension para el renderer; toBackendContext los quitaria en la
            // raiz, asi que se sanean por separado y se devuelven tras el saneado (nunca viajan al backend: api.ts lo repite).
            context = { extensionId: text(input.extensionId, 200), settings: toBackendContext({ v: input.settings }).v ?? {} };
            return { ...toBackendContext(context), settings: context.settings };
        case 'SIDEBAR_PANEL':
            context = { folder: text(input.folder, 50), ...(input.unreadCounts && typeof input.unreadCounts === 'object' ? { unreadCounts: input.unreadCounts } : {}) };
            break;
        default:
            // Composer (COMPOSER_*) y puntos previos (EMAIL_TOOLBAR, CALENDAR_HEADER, ...): el contexto existente trae
            // callbacks del anfitrion (insertar contenido, cerrar...) que el renderer necesita, asi que NO se sanea aqui;
            // al backend siempre viaja por toBackendContext (ExtensionRenderer/api.ts), que los elimina.
            return buildReadingContext(input);
    }
    return toBackendContext(context);
}
