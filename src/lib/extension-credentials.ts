/**
 * Credenciales por dominio de las extensiones (panel /admin).
 *
 * Funciones puras (sin React, sin fetch) para que el formulario y los tests compartan las mismas reglas que el
 * backend (`bloomx-backend/src/app/api/extension/settings/route.ts`):
 *  - los campos salen de los permisos `ENV_READ:*` del manifest (menos las variables reservadas de plataforma);
 *  - valores: texto de una sola linea, sin caracteres de control, maximo 4096;
 *  - `null` en el payload = borrar la credencial.
 * El servidor NUNCA devuelve valores: solo `{ name, configured }`.
 */
import { RESERVED_ENV_RE } from '@/lib/expansions/manifest-schema';

export const MAX_CREDENTIAL_LENGTH = 4096;
/** Unica credencial multilinea y de hasta 16 KB: el JSON de la cuenta de servicio de Google. */
export const MULTILINE_CREDENTIAL_KEY = 'GOOGLE_SERVICE_ACCOUNT_JSON';
export const MAX_SERVICE_ACCOUNT_LENGTH = 16384;
const ENV_KEY_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

/** Fuente ACTIVA de una variable (sin valores): dominio -> heredado -> entorno del servidor -> sin configurar. */
export type CredentialSource = 'domain' | 'legacy' | 'server-env' | 'missing';

export interface CredentialKeyStatus {
    name: string;
    /** Hay credencial propia del dominio (paso 1). */
    configured: boolean;
    /** Fuente activa; ausente en backends antiguos (se deduce de `configured`). */
    source?: CredentialSource;
    /** Hay un valor heredado del dominio que se puede copiar a credenciales del dominio. */
    movable?: boolean;
}

const SOURCES: readonly CredentialSource[] = ['domain', 'legacy', 'server-env', 'missing'];

/** Fuente efectiva de una clave (tolera respuestas sin `source`). */
export function effectiveSource(key: Pick<CredentialKeyStatus, 'configured' | 'source'>): CredentialSource {
    if (key.source && SOURCES.includes(key.source)) return key.source;
    return key.configured ? 'domain' : 'missing';
}

/** Sufijo de la clave i18n legacyMode.sources.* para una fuente. */
export function sourceI18nKey(source: CredentialSource): 'domain' | 'legacy' | 'serverEnv' | 'missing' {
    return source === 'server-env' ? 'serverEnv' : source;
}

/** Claves cuyo valor heredado el dueno puede mover a credenciales del dominio. */
export function movableKeys(keys: readonly CredentialKeyStatus[]): string[] {
    return keys.filter((k) => k.movable === true && effectiveSource(k) === 'legacy').map((k) => k.name);
}

/** Claves servidas por el entorno global del backend: no se pueden copiar (el frontend nunca ve el valor). */
export function serverEnvKeys(keys: readonly CredentialKeyStatus[]): string[] {
    return keys.filter((k) => effectiveSource(k) === 'server-env').map((k) => k.name);
}

export type CredentialError = 'empty' | 'tooLong' | 'control';

function parseTemplate(template: unknown): any {
    if (typeof template === 'string') {
        try {
            return JSON.parse(template);
        } catch {
            return null;
        }
    }
    return template && typeof template === 'object' ? template : null;
}

/** Claves de credencial que el manifest declara con ENV_READ (mismo filtro que el servidor). */
export function declaredCredentialKeys(template: unknown): string[] {
    const permissions = parseTemplate(template)?.permissions;
    if (!Array.isArray(permissions)) return [];
    const keys = permissions
        .filter((p: unknown): p is string => typeof p === 'string' && p.startsWith('ENV_READ:'))
        .map((p) => p.slice('ENV_READ:'.length).trim())
        .filter((key) => ENV_KEY_RE.test(key) && !RESERVED_ENV_RE.test(key));
    return Array.from(new Set(keys));
}

/** Valida un valor nuevo antes de enviarlo. `null` = valido. */
export function validateCredentialValue(value: string, key?: string): CredentialError | null {
    // Solo GOOGLE_SERVICE_ACCOUNT_JSON: hasta 16384 caracteres y saltos de linea (\n, \r, \t).
    const multiline = key === MULTILINE_CREDENTIAL_KEY;
    if (value.trim() === '') return 'empty';
    if (value.length > (multiline ? MAX_SERVICE_ACCOUNT_LENGTH : MAX_CREDENTIAL_LENGTH)) return 'tooLong';
    // eslint-disable-next-line no-control-regex
    const control = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
    if (control.test(value)) return 'control';
    return null;
}

export interface CredentialDraft {
    /** Valor nuevo escrito por el admin ('' = sin cambio). */
    values: Record<string, string>;
    /** Claves marcadas para borrar. */
    removals: ReadonlySet<string> | string[];
}

/** Errores por campo del borrador (solo campos con texto escrito). */
export function validateDraft(draft: CredentialDraft): Record<string, CredentialError> {
    const removals = new Set(draft.removals);
    const errors: Record<string, CredentialError> = {};
    for (const [key, value] of Object.entries(draft.values)) {
        if (removals.has(key) || value === '') continue;
        const error = validateCredentialValue(value, key);
        if (error) errors[key] = error;
    }
    return errors;
}

/** Payload para PUT: claves con valor -> string (recortado); claves a borrar -> null. Vacio si no hay cambios. */
export function buildCredentialPayload(draft: CredentialDraft): Record<string, string | null> {
    const removals = new Set(draft.removals);
    const payload: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(draft.values)) {
        if (removals.has(key) || value === '') continue;
        payload[key] = value.trim();
    }
    for (const key of removals) payload[key] = null;
    return payload;
}

/** Clave i18n (admin.extensions.credentials.errors.*) para un estado HTTP del proxy. */
export function credentialsHttpErrorKey(status: number): string {
    switch (status) {
        case 401: return 'unauthorized';
        case 403: return 'forbidden';
        case 404: return 'notInstalled';
        case 429: return 'tooMany';
        case 503: return 'encryptionUnavailable';
        default: return 'generic';
    }
}
