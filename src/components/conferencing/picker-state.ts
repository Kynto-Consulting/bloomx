/**
 * Logica PURA del selector de videoconferencia (sin React, sin red, sin DOM): estados de proveedor, acciones segun el
 * codigo de error tipado, claves de idempotencia, validacion del enlace propio y seguridad de las URL de conexion.
 * El componente solo pinta lo que estas funciones deciden, asi se prueban sin navegador.
 */
import { analyzeMeetingUrl, type MeetingLinkInfo } from '@/lib/conferencing/hosts';
import {
    CONFERENCING_PROVIDER_IDS,
    PROVIDER_INFO,
    isConferencingError,
    type ConferencingError,
    type ConferencingErrorCode,
    type ConferencingMeeting,
    type ConferencingProviderId,
    type ConferencingProviderStatus,
    type CreateMeetingInput,
} from '@/lib/conferencing/types';

/** Reunion que entiende el selector: lo minimo + lo que el proveedor haya devuelto. */
export type PickerMeeting = Pick<ConferencingMeeting, 'provider' | 'joinUrl' | 'providerName' | 'meetingId'> & Partial<ConferencingMeeting>;

export interface PickerContext {
    title?: string;
    startsAt?: string | null;
    endsAt?: string | null;
    timeZone?: string | null;
    attendees?: string[];
    attachToEventId?: string;
}

// ---------------------------------------------------------------------------
// Estado de cada proveedor
// ---------------------------------------------------------------------------

export type ProviderState = 'ready' | 'connect' | 'reconnect' | 'unavailable' | 'admin';

export const STATE_LABEL_KEY: Record<ProviderState, string> = {
    ready: 'conferencing.state.ready',
    connect: 'conferencing.state.connect',
    reconnect: 'conferencing.state.reconnect',
    unavailable: 'conferencing.state.unavailable',
    admin: 'conferencing.state.admin',
};

const REASON_KEY: Record<string, string> = {
    not_connected: 'conferencing.reason.not_connected',
    token_revoked: 'conferencing.reason.token_revoked',
    invalid_credentials: 'conferencing.reason.invalid_credentials',
    extension_not_installed: 'conferencing.reason.extension_not_installed',
    legacy_domain: 'conferencing.reason.legacy_domain',
    unavailable: 'conferencing.reason.unavailable',
    provider_error: 'conferencing.reason.provider_error',
    rate_limited: 'conferencing.reason.provider_error',
};

export const SOURCE_KEY: Record<string, string> = {
    instance: 'conferencing.source.instance',
    'user-oauth': 'conferencing.source.userOauth',
    extension: 'conferencing.source.extension',
    none: 'conferencing.source.none',
};

export const MODE_KEY: Record<string, string> = {
    'server-to-server': 'conferencing.mode.serverToServer',
    'user-oauth': 'conferencing.mode.userOauth',
    'service-account': 'conferencing.mode.serviceAccount',
    'google-account': 'conferencing.mode.googleAccount',
    'custom-link': 'conferencing.mode.customLink',
};

/** Estado de un proveedor a partir de lo que informa el servidor. */
export function providerState(status: ConferencingProviderStatus): ProviderState {
    if (status.id === 'custom') return 'ready';
    const reason = status.reason;
    if (reason === 'extension_not_installed' || reason === 'legacy_domain') return 'unavailable';
    if (reason === 'token_revoked') return status.connect ? 'reconnect' : 'unavailable';
    if (status.configured) return 'ready';
    if (reason === 'invalid_credentials') return 'admin';
    if (status.connect) return 'connect';
    return 'unavailable';
}

/** Clave i18n del motivo legible (o null si no hay que explicar nada). */
export function providerReasonKey(status: ConferencingProviderStatus): string | null {
    const state = providerState(status);
    if (state === 'ready') return null;
    if (status.reason && REASON_KEY[status.reason]) return REASON_KEY[status.reason];
    return state === 'connect' ? REASON_KEY.not_connected : REASON_KEY.unavailable;
}

/** Proveedor sintetico del enlace propio (no necesita credenciales ni el servidor). */
export const CUSTOM_STATUS: ConferencingProviderStatus = {
    id: 'custom',
    name: PROVIDER_INFO.custom.name,
    icon: 'link',
    configured: true,
    connected: true,
    mode: 'custom-link',
    source: 'none',
    origin: 'core',
};

/** Proveedores visibles, filtrados por `allowed` y con el enlace propio al final si `allowCustom`. */
export function orderProviders(
    statuses: readonly ConferencingProviderStatus[],
    opts: { allowed?: readonly ConferencingProviderId[]; allowCustom?: boolean } = {},
): ConferencingProviderStatus[] {
    const allowed = opts.allowed && opts.allowed.length > 0 ? new Set(opts.allowed) : null;
    const byId = new Map<ConferencingProviderId, ConferencingProviderStatus>();
    for (const s of statuses) if (s && CONFERENCING_PROVIDER_IDS.includes(s.id) && !byId.has(s.id)) byId.set(s.id, s);
    const out: ConferencingProviderStatus[] = [];
    for (const id of CONFERENCING_PROVIDER_IDS) {
        if (allowed && !allowed.has(id)) continue;
        if (id === 'custom') {
            if (opts.allowCustom) out.push(byId.get('custom') ? { ...byId.get('custom')!, configured: true, connected: true } : CUSTOM_STATUS);
            continue;
        }
        const s = byId.get(id);
        if (s) out.push(s);
    }
    return out;
}

/** Proveedor inicial: el de la reunion actual, si no el primero listo, si no el primero. */
export function defaultProviderId(
    providers: readonly ConferencingProviderStatus[],
    current?: ConferencingProviderId | null,
): ConferencingProviderId | null {
    if (current && providers.some((p) => p.id === current)) return current;
    return (providers.find((p) => providerState(p) === 'ready') ?? providers[0])?.id ?? null;
}

// ---------------------------------------------------------------------------
// Seguridad de las URL de conexion
// ---------------------------------------------------------------------------

/** Ruta interna de la app: empieza por "/" (no "//"), sin "\" ni caracteres de control. */
export function isInternalPath(value: unknown): value is string {
    // eslint-disable-next-line no-control-regex
    return typeof value === 'string' && value.length > 0 && value.length <= 1024 && value.startsWith('/') && !value.startsWith('//') && !/[\\\u0000-\u001f\u007f]/.test(value);
}

const PROVIDER_CONNECT_DOMAINS = ['zoom.us', 'zoom.com', 'google.com'];

/** URL https de un proveedor conocido (para OAuth directo). */
export function isProviderHttpsUrl(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return false;
    }
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
    const host = url.hostname.toLowerCase();
    return PROVIDER_CONNECT_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * Destino seguro para "Conectar": solo una ruta interna (se le anade `returnTo` interno si no lo trae) o una URL https
 * de un proveedor. Cualquier otra cosa (javascript:, //evil, http:, hosts ajenos) devuelve null.
 */
export function safeConnectHref(url: unknown, returnTo?: string | null): string | null {
    if (isInternalPath(url)) {
        if (!isInternalPath(returnTo) || /[?&]returnTo=/.test(url)) return url;
        return `${url}${url.includes('?') ? '&' : '?'}returnTo=${encodeURIComponent(returnTo)}`;
    }
    return isProviderHttpsUrl(url) ? (url as string) : null;
}

/** Conexion por defecto cuando el servidor no indica `connect` (mismas rutas OAuth que usa el resto de la app). */
export const DEFAULT_CONNECT_URL: Partial<Record<ConferencingProviderId, string>> = {
    'google-meet': '/api/auth/google',
    zoom: '/api/auth/zoom',
};

/** Destino OAuth seguro para conectar un proveedor (null si no hay OAuth o la URL no es segura). */
export function resolveConnectHref(status: Pick<ConferencingProviderStatus, 'id' | 'connect'> | null, providerId: ConferencingProviderId | undefined, returnTo?: string | null): string | null {
    const info = status?.connect;
    if (info?.type === 'settings') return null;
    const target = info?.type === 'oauth' ? info.url : providerId ? DEFAULT_CONNECT_URL[providerId] : undefined;
    return safeConnectHref(target, returnTo);
}

// ---------------------------------------------------------------------------
// Errores tipados -> accion de la interfaz
// ---------------------------------------------------------------------------

export type ErrorAction = 'connect' | 'reconnect' | 'wait' | 'admin' | 'retry' | 'none';

export interface ErrorPlan {
    code: ConferencingErrorCode;
    action: ErrorAction;
    messageKey: string;
    /** Segundos a esperar (solo `wait`). */
    waitSeconds?: number;
}

export const ERROR_KEY: Record<ConferencingErrorCode, string> = {
    not_connected: 'conferencing.errors.not_connected',
    token_revoked: 'conferencing.errors.token_revoked',
    invalid_credentials: 'conferencing.errors.invalid_credentials',
    rate_limited: 'conferencing.errors.rate_limited',
    provider_error: 'conferencing.errors.provider_error',
    invalid_input: 'conferencing.errors.invalid_input',
    not_supported: 'conferencing.errors.not_supported',
    unavailable: 'conferencing.errors.unavailable',
    unauthorized: 'conferencing.errors.unauthorized',
};

export const DEFAULT_WAIT_SECONDS = 30;
export const MAX_WAIT_SECONDS = 300;

export function clampWait(retryAfter: unknown): number {
    const n = Number(retryAfter);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_WAIT_SECONDS;
    return Math.min(MAX_WAIT_SECONDS, Math.max(1, Math.ceil(n)));
}

/** Convierte cualquier error capturado en el plan de la interfaz. */
export function errorPlan(error: unknown): ErrorPlan {
    const e: ConferencingError | null = isConferencingError(error) ? error : null;
    const code: ConferencingErrorCode = e?.code ?? 'provider_error';
    switch (code) {
        case 'not_connected':
            return { code, action: 'connect', messageKey: ERROR_KEY[code] };
        case 'token_revoked':
            return { code, action: 'reconnect', messageKey: ERROR_KEY[code] };
        case 'rate_limited':
            return { code, action: 'wait', messageKey: ERROR_KEY[code], waitSeconds: clampWait(e?.retryAfter) };
        case 'invalid_credentials':
            return { code, action: 'admin', messageKey: ERROR_KEY[code] };
        case 'provider_error':
        case 'unavailable':
            return { code, action: 'retry', messageKey: ERROR_KEY[code] };
        default:
            return { code, action: 'none', messageKey: ERROR_KEY[code] };
    }
}

/** Segundos que faltan hasta `until` (ms epoch), nunca negativos. */
export function remainingSeconds(until: number, now: number): number {
    return Math.max(0, Math.ceil((until - now) / 1000));
}

// ---------------------------------------------------------------------------
// Idempotencia
// ---------------------------------------------------------------------------

/** Firma del contexto: si no cambia, un reintento reutiliza la MISMA Idempotency-Key. */
export function contextSignature(provider: ConferencingProviderId, context: PickerContext, customUrl = ''): string {
    return JSON.stringify([
        provider,
        (context.title || '').trim(),
        context.startsAt || '',
        context.endsAt || '',
        context.timeZone || '',
        [...(context.attendees || [])].map((a) => String(a).trim().toLowerCase()).filter(Boolean).sort(),
        context.attachToEventId || '',
        customUrl,
    ]);
}

/** Guarda la clave vigente: misma firma -> misma clave; firma distinta o `renew()` -> clave nueva. */
export function createIdempotencyKeeper(makeKey: () => string) {
    let signature: string | null = null;
    let key: string | null = null;
    return {
        keyFor(next: string): string {
            if (key === null || signature !== next) {
                signature = next;
                key = makeKey();
            }
            return key;
        },
        /** Tras un exito: la proxima creacion (regenerar) debe ser una reunion distinta. */
        renew(): void {
            signature = null;
            key = null;
        },
    };
}

/** Entrada de createMeeting a partir del contexto (sin campos vacios). */
export function buildCreateInput(context: PickerContext, fallbackTopic: string): CreateMeetingInput {
    const input: CreateMeetingInput = { topic: (context.title || '').trim().slice(0, 200) || fallbackTopic };
    if (context.startsAt) input.startsAt = context.startsAt;
    if (context.endsAt) input.endsAt = context.endsAt;
    if (context.timeZone) input.timeZone = context.timeZone;
    const attendees = Array.from(new Set((context.attendees || []).map((a) => String(a).trim()).filter((a) => a.includes('@')))).slice(0, 100);
    if (attendees.length) input.attendees = attendees;
    if (context.attachToEventId) input.attachToEventId = context.attachToEventId;
    return input;
}

// ---------------------------------------------------------------------------
// Enlace propio
// ---------------------------------------------------------------------------

export type CustomLinkCheck =
    | { status: 'empty' }
    | { status: 'invalid' }
    | { status: 'valid'; info: MeetingLinkInfo }
    | { status: 'unrecognized'; info: MeetingLinkInfo };

export function checkCustomLink(raw: string): CustomLinkCheck {
    if (!raw.trim()) return { status: 'empty' };
    const info = analyzeMeetingUrl(raw);
    if (!info) return { status: 'invalid' };
    return info.recognized ? { status: 'valid', info } : { status: 'unrecognized', info };
}

export function meetingFromCustomLink(info: MeetingLinkInfo): PickerMeeting {
    return { provider: 'custom', joinUrl: info.url, providerName: info.recognized ? info.providerName : PROVIDER_INFO.custom.name, meetingId: '', mode: 'custom-link' };
}

/** Reunion a partir de un enlace ya existente (evento guardado): proveedor del registro o `custom` si es valido. */
export function meetingFromLink(raw: unknown): PickerMeeting | null {
    const info = analyzeMeetingUrl(raw);
    if (!info) return null;
    if (info.provider === 'google-meet') return { provider: 'google-meet', joinUrl: info.url, providerName: info.providerName, meetingId: '' };
    if (info.provider === 'zoom') return { provider: 'zoom', joinUrl: info.url, providerName: info.providerName, meetingId: '' };
    return null;
}

/** Solo las reuniones creadas por una extension (con id) se pueden cancelar en el proveedor. */
export function canDeleteRemote(meeting: Pick<PickerMeeting, 'provider' | 'meetingId'> | null | undefined): boolean {
    return Boolean(meeting && meeting.provider !== 'custom' && typeof meeting.meetingId === 'string' && meeting.meetingId.trim());
}

/** Quita `joinUrl` del texto de ubicacion (si era todo el texto, queda vacio). */
export function locationWithoutLink(location: string, joinUrl: string): string {
    if (!joinUrl) return location;
    if (location.trim() === joinUrl) return '';
    return location.split(joinUrl).join('').replace(/\s{2,}/g, ' ').replace(/^[\s,;:-]+|[\s,;:-]+$/g, '');
}
