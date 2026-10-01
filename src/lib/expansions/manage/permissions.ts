/**
 * Permisos de un manifest en frases claras (es/en) con nivel de sensibilidad (PURO). Toda clave de
 * PERMISSION_CATALOG (manifest-schema) debe estar aqui: lo verifica permissions.test.ts.
 */
import { RESERVED_ENV_RE } from '@/lib/expansions/manifest-schema';

export type Sensitivity = 'low' | 'medium' | 'high';
export type ManageLocale = 'es' | 'en';

interface PermissionText { es: string; en: string; level: Sensitivity }

export const PERMISSION_TEXTS: Record<string, PermissionText> = {
    READ_EMAIL: { es: 'Leer el correo que tienes abierto', en: 'Read the email you have open', level: 'high' },
    MAIL_LABEL: { es: 'Poner o quitar etiquetas en tu correo', en: 'Add or remove labels on your email', level: 'medium' },
    READ_USER: { es: 'Ver tu identificador y tu direccion de correo', en: 'See your ID and email address', level: 'low' },
    READ_USER_NAME: { es: 'Ver tu nombre', en: 'See your name', level: 'low' },
    AI_GENERATE: { es: 'Enviar texto a la inteligencia artificial para generar contenido', en: 'Send text to the AI service to generate content', level: 'medium' },
    HTTP_REQUEST: { es: 'Conectarse a servicios externos', en: 'Connect to external services', level: 'high' },
    OAUTH_READ: { es: 'Usar las cuentas de terceros conectadas por tu organizacion', en: 'Use third-party accounts connected by your organization', level: 'high' },
    OAUTH_WRITE: { es: 'Conectar o desconectar cuentas de terceros', en: 'Connect or disconnect third-party accounts', level: 'high' },
    API_ROUTE_CREATE: { es: 'Crear rutas de API propias (reservado)', en: 'Create its own API routes (reserved)', level: 'medium' },
    PAGE_ROUTE_CREATE: { es: 'Crear paginas propias (reservado)', en: 'Create its own pages (reserved)', level: 'medium' },
    DB_READ: { es: 'Leer los datos que la extension guarda (reservado)', en: 'Read the data the extension stores (reserved)', level: 'medium' },
    DB_WRITE: { es: 'Guardar datos de la extension (reservado)', en: 'Store extension data (reserved)', level: 'medium' },
    'local:secure-storage': { es: 'Guardar datos cifrados en este navegador', en: 'Store encrypted data in this browser', level: 'low' },
    CALENDAR_READ: { es: 'Consultar tus eventos y huecos libres del calendario', en: 'See your calendar events and free slots', level: 'medium' },
    CALENDAR_WRITE: { es: 'Crear, cambiar o cancelar eventos e invitar a asistentes', en: 'Create, change or cancel events and invite attendees', level: 'high' },
    CONTACTS_READ: { es: 'Consultar tus contactos', en: 'See your contacts', level: 'medium' },
    CONTACTS_WRITE: { es: 'Crear, editar y fusionar contactos', en: 'Create, edit and merge contacts', level: 'high' },
    FORMATS: { es: 'Dar formato a fechas, numeros y plantillas (sin acceso a tus datos)', en: 'Format dates, numbers and templates (no access to your data)', level: 'low' },
    STORAGE: { es: 'Guardar sus propios ajustes en el servidor (hasta 256 KB por usuario)', en: 'Save its own settings on the server (up to 256 KB per user)', level: 'low' },
    NOTIFY: { es: 'Mostrarte avisos dentro de la aplicacion', en: 'Show you notices inside the app', level: 'low' },
    PUBLIC_ROUTE: { es: 'Exponer rutas o paginas publicas, accesibles sin iniciar sesion (con limites estrictos)', en: 'Expose public routes or pages reachable without signing in (with strict limits)', level: 'high' },
};

const ENV_KEY_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const RANK: Record<Sensitivity | 'unknown', number> = { high: 0, unknown: 1, medium: 2, low: 3 };

export interface ReadablePermission {
    permission: string;
    text: string;
    level: Sensitivity;
    /** false = permiso no documentado (se muestra tal cual). */
    known: boolean;
}

export function describePermission(permission: string, locale: ManageLocale = 'es'): ReadablePermission {
    if (permission.startsWith('ENV_READ:')) {
        const key = permission.slice('ENV_READ:'.length).trim();
        const valid = ENV_KEY_RE.test(key) && !RESERVED_ENV_RE.test(key);
        if (valid) return { permission, text: locale === 'en' ? `Use the administrator's setting ${key}` : `Usar el ajuste ${key} del administrador`, level: 'high', known: true };
        return { permission, text: permission, level: 'high', known: false };
    }
    const shared = /^OAUTH_SHARED:([a-z][a-z0-9-]{1,31})$/.exec(permission);
    if (shared) return { permission, text: locale === 'en' ? `Act as the organization's shared ${shared[1]} identity (organizer or service account), not as a user` : `Actuar como la identidad compartida de ${shared[1]} de la organizacion (organizador o cuenta de servicio), no como un usuario`, level: 'high', known: true };
    const oauth = /^OAUTH_ACCOUNT:([a-z][a-z0-9-]{1,31}):([a-z][a-z0-9-]{0,31})$/.exec(permission);
    if (oauth) return { permission, text: locale === 'en' ? `Use your linked ${oauth[1]} account(s) for "${oauth[2]}" (it never sees your passwords or tokens)` : `Usar tu(s) cuenta(s) ${oauth[1]} vinculada(s) para "${oauth[2]}" (nunca ve tus contrasenas ni tokens)`, level: 'high', known: true };
    const info = Object.prototype.hasOwnProperty.call(PERMISSION_TEXTS, permission) ? PERMISSION_TEXTS[permission] : null;
    if (!info) return { permission, text: permission, level: 'high', known: false };
    return { permission, text: info[locale === 'en' ? 'en' : 'es'], level: info.level, known: true };
}

/** Permisos legibles, sin duplicados, ordenados por sensibilidad (alta primero; los no documentados tras los altos). */
export function describePermissions(permissions: unknown, locale: ManageLocale = 'es'): ReadablePermission[] {
    const list = Array.isArray(permissions) ? permissions.filter((p): p is string => typeof p === 'string' && p.trim() !== '').map((p) => p.trim().slice(0, 120)) : [];
    const unique = Array.from(new Set(list)).slice(0, 60);
    return unique
        .map((permission, index) => ({ item: describePermission(permission, locale), index }))
        .sort((a, b) => RANK[a.item.known ? a.item.level : 'unknown'] - RANK[b.item.known ? b.item.level : 'unknown'] || a.index - b.index)
        .map((x) => x.item);
}

/** Nivel mas alto entre los permisos (para el resumen de la tarjeta). `null` si no hay. */
export function highestSensitivity(permissions: unknown): Sensitivity | null {
    const items = describePermissions(permissions);
    if (items.length === 0) return null;
    return items.some((i) => i.level === 'high') ? 'high' : items.some((i) => i.level === 'medium') ? 'medium' : 'low';
}
