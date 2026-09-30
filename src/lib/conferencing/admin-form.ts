/**
 * Logica PURA del formulario de credenciales de videoconferencia del administrador (sin React ni red):
 * validacion del JSON de la cuenta de servicio de Google, modos de autenticacion, construccion del payload para
 * PUT /api/admin/extensions/settings y en que extensiones hay que escribirlo.
 *
 * Reglas de seguridad: el `private_key` jamas se devuelve ni se muestra (solo `client_email` y `project_id`); los
 * valores guardados nunca vuelven del servidor (solo { name, configured }).
 */
import {
    MAX_CREDENTIAL_LENGTH,
    MAX_SERVICE_ACCOUNT_LENGTH,
    MULTILINE_CREDENTIAL_KEY,
    validateCredentialValue,
    type CredentialError,
} from '@/lib/extension-credentials';

export type AdminProviderId = 'zoom' | 'google-meet';
export type ZoomAuthMode = 'server-to-server' | 'user-oauth';
export type GoogleAuthMode = 'service-account' | 'google-account';
export type AdminAuthMode = ZoomAuthMode | GoogleAuthMode;

export const ZOOM_AUTH_MODE_KEY = 'ZOOM_AUTH_MODE';
export const GOOGLE_AUTH_MODE_KEY = 'GOOGLE_AUTH_MODE';
export const ZOOM_S2S_KEYS = ['ZOOM_ACCOUNT_ID', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET'] as const;
export const GOOGLE_SA_KEY = 'GOOGLE_SERVICE_ACCOUNT_JSON';
export const GOOGLE_IMPERSONATE_KEY = 'GOOGLE_IMPERSONATE_USER';
export const GOOGLE_ORGANIZER_KEYS = ['GOOGLE_ORGANIZER_REFRESH_TOKEN', 'GOOGLE_ORGANIZER_EMAIL', 'GOOGLE_MEET_ADMIN_REFRESH_TOKEN'] as const;

export const SERVICE_ACCOUNT_MAX_BYTES = MAX_SERVICE_ACCOUNT_LENGTH; // 16 KB

export const MODES: Record<AdminProviderId, readonly AdminAuthMode[]> = {
    zoom: ['server-to-server', 'user-oauth'],
    'google-meet': ['service-account', 'google-account'],
};

export const MODE_CREDENTIAL_KEY: Record<AdminProviderId, string> = {
    zoom: ZOOM_AUTH_MODE_KEY,
    'google-meet': GOOGLE_AUTH_MODE_KEY,
};

/** Extensiones donde se escriben las credenciales de cada proveedor (Google va en ambas si `core-calendar` esta). */
export const PROVIDER_EXTENSIONS: Record<AdminProviderId, readonly string[]> = {
    zoom: ['core-zoom'],
    'google-meet': ['core-google-meet', 'core-calendar'],
};

export function isAdminMode(provider: AdminProviderId, value: unknown): value is AdminAuthMode {
    return typeof value === 'string' && (MODES[provider] as readonly string[]).includes(value);
}

/** Modo inicial del formulario: el activo si es valido para el proveedor, si no el primero. */
export function initialMode(provider: AdminProviderId, active: unknown): AdminAuthMode {
    return isAdminMode(provider, active) ? active : MODES[provider][0];
}

// ---------------------------------------------------------------------------
// JSON de la cuenta de servicio
// ---------------------------------------------------------------------------

export type ServiceAccountError =
    | 'empty'
    | 'tooLarge'
    | 'notJson'
    | 'notObject'
    | 'wrongType'
    | 'missingClientEmail'
    | 'missingPrivateKey'
    | 'missingProjectId'
    | 'badPrivateKey';

export type ServiceAccountCheck =
    | { ok: true; clientEmail: string; projectId: string; /** JSON compacto de una linea listo para guardar. */ normalized: string }
    | { ok: false; error: ServiceAccountError };

export const SERVICE_ACCOUNT_ERROR_KEY: Record<ServiceAccountError, string> = {
    empty: 'conferencing.admin.google.sa.errors.empty',
    tooLarge: 'conferencing.admin.google.sa.errors.tooLarge',
    notJson: 'conferencing.admin.google.sa.errors.notJson',
    notObject: 'conferencing.admin.google.sa.errors.notObject',
    wrongType: 'conferencing.admin.google.sa.errors.wrongType',
    missingClientEmail: 'conferencing.admin.google.sa.errors.missingClientEmail',
    missingPrivateKey: 'conferencing.admin.google.sa.errors.missingPrivateKey',
    missingProjectId: 'conferencing.admin.google.sa.errors.missingProjectId',
    badPrivateKey: 'conferencing.admin.google.sa.errors.badPrivateKey',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function byteLength(text: string): number {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
    return text.length;
}

/** Valida el JSON (type, client_email, private_key, project_id y <= 16 KB). Nunca devuelve la clave privada. */
export function validateServiceAccountJson(raw: unknown): ServiceAccountCheck {
    if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, error: 'empty' };
    if (byteLength(raw) > SERVICE_ACCOUNT_MAX_BYTES) return { ok: false, error: 'tooLarge' };
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { ok: false, error: 'notJson' };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'notObject' };
    const obj = parsed as Record<string, unknown>;
    if (obj.type !== 'service_account') return { ok: false, error: 'wrongType' };
    const clientEmail = typeof obj.client_email === 'string' ? obj.client_email.trim() : '';
    if (!EMAIL_RE.test(clientEmail)) return { ok: false, error: 'missingClientEmail' };
    const privateKey = typeof obj.private_key === 'string' ? obj.private_key : '';
    if (!privateKey.trim()) return { ok: false, error: 'missingPrivateKey' };
    if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(privateKey) || !/-----END [A-Z ]*PRIVATE KEY-----/.test(privateKey)) {
        return { ok: false, error: 'badPrivateKey' };
    }
    const projectId = typeof obj.project_id === 'string' ? obj.project_id.trim() : '';
    if (!projectId) return { ok: false, error: 'missingProjectId' };
    const normalized = JSON.stringify(obj);
    if (byteLength(normalized) > SERVICE_ACCOUNT_MAX_BYTES) return { ok: false, error: 'tooLarge' };
    return { ok: true, clientEmail, projectId, normalized };
}

export function validateImpersonateUser(value: string): boolean {
    return value.trim() === '' || (EMAIL_RE.test(value.trim()) && value.trim().length <= 254);
}

// ---------------------------------------------------------------------------
// Borrador -> payload
// ---------------------------------------------------------------------------

export interface ProviderDraft {
    provider: AdminProviderId;
    mode: AdminAuthMode;
    /** Valores escritos ('' = sin cambio). Para Google, `GOOGLE_SERVICE_ACCOUNT_JSON` es el JSON pegado/subido. */
    values: Record<string, string>;
    /** Claves marcadas para borrar. */
    removals?: readonly string[];
}

export type DraftError =
    | { key: string; error: CredentialError }
    | { key: string; error: 'invalidEmail' }
    | { key: string; error: ServiceAccountError };

/** Claves editables segun el proveedor y el modo. */
export function editableKeys(provider: AdminProviderId, mode: AdminAuthMode): string[] {
    if (provider === 'zoom') return mode === 'server-to-server' ? [...ZOOM_S2S_KEYS] : [];
    return mode === 'service-account' ? [GOOGLE_SA_KEY, GOOGLE_IMPERSONATE_KEY] : [];
}

/** Errores de campo del borrador (solo campos escritos y no borrados). */
export function validateProviderDraft(draft: ProviderDraft): DraftError[] {
    const errors: DraftError[] = [];
    const removals = new Set(draft.removals ?? []);
    for (const key of editableKeys(draft.provider, draft.mode)) {
        const value = draft.values[key] ?? '';
        if (value === '' || removals.has(key)) continue;
        if (key === GOOGLE_SA_KEY) {
            const check = validateServiceAccountJson(value);
            if (!check.ok) errors.push({ key, error: check.error });
            else {
                const generic = validateCredentialValue(check.normalized, MULTILINE_CREDENTIAL_KEY);
                if (generic) errors.push({ key, error: generic });
            }
        } else if (key === GOOGLE_IMPERSONATE_KEY) {
            if (!validateImpersonateUser(value)) errors.push({ key, error: 'invalidEmail' });
            else {
                const generic = validateCredentialValue(value.trim(), key);
                if (generic) errors.push({ key, error: generic });
            }
        } else {
            const generic = validateCredentialValue(value, key);
            if (generic) errors.push({ key, error: generic });
        }
    }
    return errors;
}

/**
 * Payload { CLAVE: valor|null } para guardar: siempre incluye el modo; credenciales escritas (recortadas; el JSON de
 * Google va compacto); `null` para las marcadas a borrar. Cambiar de modo NO borra las credenciales del otro modo.
 */
export function buildProviderPayload(draft: ProviderDraft): Record<string, string | null> {
    const payload: Record<string, string | null> = { [MODE_CREDENTIAL_KEY[draft.provider]]: draft.mode };
    const removals = new Set(draft.removals ?? []);
    for (const key of editableKeys(draft.provider, draft.mode)) {
        if (removals.has(key)) {
            payload[key] = null;
            continue;
        }
        const value = draft.values[key] ?? '';
        if (value.trim() === '') continue;
        if (key === GOOGLE_SA_KEY) {
            const check = validateServiceAccountJson(value);
            if (check.ok) payload[key] = check.normalized;
        } else {
            payload[key] = value.trim();
        }
    }
    return payload;
}

/** Payload de "Borrar credenciales": pone a null todo lo que gestiona el formulario para ese proveedor. */
export function buildClearPayload(provider: AdminProviderId): Record<string, string | null> {
    const keys =
        provider === 'zoom'
            ? [ZOOM_AUTH_MODE_KEY, ...ZOOM_S2S_KEYS]
            : [GOOGLE_AUTH_MODE_KEY, GOOGLE_SA_KEY, GOOGLE_IMPERSONATE_KEY, ...GOOGLE_ORGANIZER_KEYS];
    return Object.fromEntries(keys.map((k) => [k, null])) as Record<string, string | null>;
}

// ---------------------------------------------------------------------------
// Datos del panel (GET /api/admin/conferencing) y escrituras
// ---------------------------------------------------------------------------

export interface AdminExtensionInfo {
    installed: boolean;
    keys: Array<{ name: string; configured: boolean }>;
}

export interface AdminConferencingData {
    domainId: string;
    isAdmin: boolean;
    extensions: Record<string, AdminExtensionInfo>;
    /** Que flujos OAuth tiene configurados el servidor (opcional: backends antiguos no lo envian). */
    oauth?: { google?: boolean; zoom?: boolean; googleOrganizer?: boolean };
}

/** Normaliza la respuesta del servidor (tolera campos ausentes). Devuelve null si no es utilizable. */
export function parseAdminData(json: unknown): AdminConferencingData | null {
    const o = json as { domainId?: unknown; isAdmin?: unknown; extensions?: unknown; oauth?: any } | null;
    if (!o || typeof o !== 'object' || typeof o.domainId !== 'string' || !o.domainId) return null;
    const extensions: Record<string, AdminExtensionInfo> = {};
    if (o.extensions && typeof o.extensions === 'object') {
        for (const [id, raw] of Object.entries(o.extensions as Record<string, any>)) {
            extensions[id] = {
                installed: raw?.installed === true,
                keys: Array.isArray(raw?.keys)
                    ? raw.keys.filter((k: any) => k && typeof k.name === 'string').map((k: any) => ({ name: String(k.name), configured: k.configured === true }))
                    : [],
            };
        }
    }
    const oauth = o.oauth && typeof o.oauth === 'object'
        ? { google: o.oauth.google === true, zoom: o.oauth.zoom === true, googleOrganizer: o.oauth.googleOrganizer === true }
        : undefined;
    return { domainId: o.domainId, isAdmin: o.isAdmin !== false, extensions, ...(oauth ? { oauth } : {}) };
}

export function isKeyConfigured(data: AdminConferencingData, provider: AdminProviderId, key: string): boolean {
    return PROVIDER_EXTENSIONS[provider].some((id) => data.extensions[id]?.installed && data.extensions[id].keys.some((k) => k.name === key && k.configured));
}

/** Extensiones instaladas donde escribir. Google en `core-google-meet` y, si esta instalada, tambien `core-calendar`. */
export function targetExtensions(provider: AdminProviderId, data: AdminConferencingData): string[] {
    return PROVIDER_EXTENSIONS[provider].filter((id) => data.extensions[id]?.installed);
}

export interface CredentialWrite {
    extensionId: string;
    credentials: Record<string, string | null>;
}

export function planWrites(provider: AdminProviderId, credentials: Record<string, string | null>, data: AdminConferencingData): CredentialWrite[] {
    return targetExtensions(provider, data).map((extensionId) => ({ extensionId, credentials: { ...credentials } }));
}

export const ADMIN_HTTP_ERROR_KEY: Record<string, string> = {
    unauthorized: 'conferencing.admin.errors.unauthorized',
    forbidden: 'conferencing.admin.errors.forbidden',
    notInstalled: 'conferencing.admin.errors.notInstalled',
    tooMany: 'conferencing.admin.errors.tooMany',
    encryptionUnavailable: 'conferencing.admin.errors.encryptionUnavailable',
    generic: 'conferencing.admin.errors.generic',
};

export const MAX_SINGLE_CREDENTIAL = MAX_CREDENTIAL_LENGTH;
