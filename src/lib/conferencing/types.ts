/**
 * Capacidad de NUCLEO `conferencing` (infraestructura neutra del host).
 *
 * El host NO contiene la logica de Zoom ni de Google Meet: vive en las extensiones `core-zoom` y `core-google-meet`
 * (bloomx-extensions/_shared/CONFERENCING-CONTRACT.md). El host aporta: registro de proveedores, fachada HTTP
 * (`/api/calendar/conferencing/**`), idempotencia, limite de peticiones, errores tipados, validacion de enlaces y el
 * componente `ConferencingPicker`. Este archivo es puro (sin React, sin Prisma) y lo comparten cliente y servidor.
 */

export type ConferencingProviderId = 'google-meet' | 'zoom' | 'custom';

export const CONFERENCING_PROVIDER_IDS: readonly ConferencingProviderId[] = ['google-meet', 'zoom', 'custom'];

export function isConferencingProviderId(value: unknown): value is ConferencingProviderId {
    return typeof value === 'string' && (CONFERENCING_PROVIDER_IDS as readonly string[]).includes(value);
}

/** Codigos de error tipados (contrato uniforme de extensiones + propios del host). */
export type ConferencingErrorCode =
    | 'not_connected' // el usuario/instancia no ha conectado el proveedor -> "Conectar"
    | 'token_revoked' // el token fue revocado/caduco -> "Reconectar"
    | 'invalid_credentials' // credenciales de instancia invalidas -> avisar al administrador
    | 'rate_limited' // demasiadas peticiones (host o proveedor)
    | 'provider_error' // fallo del proveedor / red / timeout
    | 'invalid_input' // datos de entrada invalidos
    | 'not_supported' // operacion no soportada por el proveedor
    | 'unavailable' // extension no instalada / backend caido / dominio legado
    | 'unauthorized'; // sin sesion

export const CONFERENCING_ERROR_CODES: readonly ConferencingErrorCode[] = [
    'not_connected',
    'token_revoked',
    'invalid_credentials',
    'rate_limited',
    'provider_error',
    'invalid_input',
    'not_supported',
    'unavailable',
    'unauthorized',
];

export const CONFERENCING_ERROR_STATUS: Record<ConferencingErrorCode, number> = {
    not_connected: 409,
    token_revoked: 401,
    invalid_credentials: 424,
    rate_limited: 429,
    provider_error: 502,
    invalid_input: 400,
    not_supported: 501,
    unavailable: 503,
    unauthorized: 401,
};

export class ConferencingError extends Error {
    readonly code: ConferencingErrorCode;
    readonly retryAfter?: number;
    constructor(code: ConferencingErrorCode, message?: string, opts: { retryAfter?: number } = {}) {
        super(message || code);
        this.name = 'ConferencingError';
        this.code = code;
        this.retryAfter = opts.retryAfter;
    }
}

export function isConferencingError(error: unknown): error is ConferencingError {
    return error instanceof ConferencingError || (Boolean(error) && (error as { name?: unknown }).name === 'ConferencingError');
}

/** Modo de autenticacion activo (ver CONFERENCING-CONTRACT.md). */
export type ConferencingAuthMode =
    | 'server-to-server' // Zoom: credenciales de la cuenta (instancia)
    | 'user-oauth' // Zoom: cuenta Zoom del propio usuario
    | 'service-account' // Google: JSON de cuenta de servicio (+ delegacion)
    | 'google-account' // Google: cuenta organizadora de la instancia o cuenta del propio usuario
    | 'custom-link'; // enlace propio sin credenciales

/** De donde salen las credenciales que se usaran (para que el panel lo muestre). */
export type ConferencingCredentialSource = 'instance' | 'user-oauth' | 'extension' | 'none';

export interface ConferencingProviderStatus {
    id: ConferencingProviderId;
    name: string;
    /** Clave de icono conocida ('google-meet' | 'zoom' | 'link'); el componente la traduce a un SVG. */
    icon: string;
    /** El proveedor puede crear reuniones ahora mismo con la fuente activa. */
    configured: boolean;
    /** El usuario actual tiene una cuenta conectada (modo por usuario) o la instancia esta conectada. */
    connected: boolean;
    mode: ConferencingAuthMode | null;
    source: ConferencingCredentialSource;
    /** Motivo legible por maquina cuando `configured` es false (o hay que reconectar). */
    reason?: ConferencingErrorCode | 'extension_not_installed' | 'legacy_domain';
    /** Donde llevar al usuario para conectar: URL de OAuth o seccion de Ajustes. */
    connect?: { type: 'oauth'; url: string } | { type: 'settings'; section: 'integrations' } | null;
    /** Modos disponibles segun la extension (para el selector del panel de administracion). */
    modes?: Array<{ id: ConferencingAuthMode; available: boolean }>;
    /** Direccion de la cuenta conectada (si el proveedor la expone). */
    account?: string | null;
    /** `extension` si el proveedor lo aporta una extension instalada, `core` si es el adaptador del host. */
    origin: 'extension' | 'core';
    extensionId?: string | null;
}

export interface CreateMeetingInput {
    topic?: string;
    /** ISO 8601. Sin fecha => reunion instantanea. */
    startsAt?: string | null;
    endsAt?: string | null;
    timeZone?: string | null;
    /** Emails de los invitados (se anaden como invitados del proveedor cuando este lo soporta). */
    attendees?: string[];
    /** Solo proveedor `custom`: enlace pegado por el usuario. */
    customUrl?: string;
    /**
     * Solo `google-meet` con un evento ya sincronizado en Google: id de evento de Google al que se adjunta la
     * conferencia (conferenceData.createRequest) en lugar de crear uno nuevo.
     */
    attachToEventId?: string;
}

export interface DialIn {
    country?: string;
    number: string;
    /** Identificador de reunion / PIN si el proveedor lo entrega. */
    code?: string;
}

export interface ConferencingMeeting {
    provider: ConferencingProviderId;
    /** Enlace para que los invitados se unan (siempre https y de host valido). */
    joinUrl: string;
    /** Enlace del anfitrion (administrar / iniciar), si existe. */
    hostUrl?: string | null;
    meetingId: string;
    passcode?: string | null;
    dialIn?: DialIn[];
    /** Nombre mostrado del proveedor ("Zoom", "Google Meet", ...). */
    providerName: string;
    topic?: string | null;
    mode?: ConferencingAuthMode | null;
    /** Invitacion ICS generada por la extension (solo con fecha); el composer puede adjuntarla. No se persiste. */
    attachment?: MeetingAttachment | null;
}

export interface MeetingAttachment {
    filename: string;
    mimeType: string;
    contentBase64: string;
}

export interface ConferencingProviderInfo {
    id: ConferencingProviderId;
    name: string;
    icon: string;
    extensionId: string | null;
}

export const PROVIDER_INFO: Record<ConferencingProviderId, ConferencingProviderInfo> = {
    'google-meet': { id: 'google-meet', name: 'Google Meet', icon: 'google-meet', extensionId: 'core-google-meet' },
    zoom: { id: 'zoom', name: 'Zoom', icon: 'zoom', extensionId: 'core-zoom' },
    custom: { id: 'custom', name: 'Enlace propio', icon: 'link', extensionId: null },
};

/** Equivalencia con los valores historicos de AppointmentSchedule.conferencing ('meet' | 'zoom'). */
export function providerFromLegacyValue(value: unknown): ConferencingProviderId | null {
    if (value === 'meet' || value === 'google-meet') return 'google-meet';
    if (value === 'zoom') return 'zoom';
    if (value === 'custom') return 'custom';
    return null;
}

export function legacyValueFromProvider(id: ConferencingProviderId): 'meet' | 'zoom' | 'custom' {
    return id === 'google-meet' ? 'meet' : id;
}
