/**
 * Estado por proveedor para el usuario de la sesion (GET /api/calendar/conferencing/providers).
 *
 * Combina: (1) el handler `status` de la extension del proveedor (modo activo, si hay credenciales de instancia o cuenta
 * de usuario), (2) lo que el host sabe (cuentas vinculadas del usuario, OAuth configurado en el frontend) y (3) el modo
 * de autenticacion del backend (`legacy` = dominio sin firma: la extension no recibe credenciales del dominio).
 * Cuando la extension no esta instalada o el backend no responde, el adaptador del host sigue ofreciendo la cuenta vinculada.
 */
import { callExtension, type CallExtensionInit } from './bridge';
import { getLinkedAuth, type LinkedAuthResult } from './auth-context';
import { zoomOAuthConfigured } from '@/lib/zoom/account';
import { getProvider } from '@/lib/oauth/providers';
import {
    PROVIDER_INFO,
    isConferencingProviderId,
    type ConferencingAuthMode,
    type ConferencingCredentialSource,
    type ConferencingProviderId,
    type ConferencingProviderStatus,
} from './types';

export interface Actor {
    userId: string;
    email?: string | null;
    domain: string;
}

const MODES: readonly ConferencingAuthMode[] = ['server-to-server', 'user-oauth', 'service-account', 'google-account', 'microsoft-account', 'custom-link'];
const SOURCES: readonly ConferencingCredentialSource[] = ['instance', 'user-oauth', 'extension', 'none'];

const DEFAULT_MODES: Record<'zoom' | 'google-meet' | 'microsoft-teams', ConferencingAuthMode[]> = {
    zoom: ['server-to-server', 'user-oauth'],
    'microsoft-teams': ['microsoft-account'],
    'google-meet': ['service-account', 'google-account'],
};

export interface StatusDeps {
    call?: (init: CallExtensionInit) => ReturnType<typeof callExtension>;
    linked?: (userId: string) => Promise<LinkedAuthResult>;
    env?: Record<string, string | undefined>;
}

function pickMode(v: unknown): ConferencingAuthMode | null {
    return typeof v === 'string' && (MODES as readonly string[]).includes(v) ? (v as ConferencingAuthMode) : null;
}

function oauthConfigured(provider: 'zoom' | 'google-meet' | 'microsoft-teams', env: Record<string, string | undefined>): boolean {
    // Teams: la cuenta Microsoft se vincula en Ajustes > Cuentas vinculadas (OAuth v2 del backend); no hay ruta OAuth directa del host.
    if (provider === 'microsoft-teams') return false;
    return provider === 'zoom' ? zoomOAuthConfigured(env) : Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

/**
 * Proveedores de conferencia cuyas cuentas de usuario gestiona un PROVEEDOR OAUTH DE EXTENSION (core-zoomlib para zoom 2.x, core-microsoftlib para Teams):
 * el flujo es /api/oauth/<proveedor>/start del nucleo. Solo si ese proveedor esta registrado por su extension oficial y listo (client id/secreto y hosts
 * aprobados por el admin); si no, zoom sigue con su ruta heredada y Teams remite a Ajustes.
 */
const LIB_PROVIDER: Partial<Record<'zoom' | 'google-meet' | 'microsoft-teams', { provider: string; extensionId: string }>> = {
    zoom: { provider: 'zoom', extensionId: 'core-zoomlib' },
    'microsoft-teams': { provider: 'microsoft', extensionId: 'core-microsoftlib' },
};
async function libConnectUrl(id: 'zoom' | 'google-meet' | 'microsoft-teams'): Promise<string | null> {
    const lib = LIB_PROVIDER[id];
    if (!lib) return null;
    try {
        const p = await getProvider(lib.provider);
        return p && p.source === 'extension' && p.extensionId === lib.extensionId && p.status === 'ready' ? `/api/oauth/${lib.provider}/start` : null;
    } catch {
        return null;
    }
}

async function providerStatus(
    actor: Actor,
    id: 'zoom' | 'google-meet' | 'microsoft-teams',
    linkedResult: LinkedAuthResult,
    deps: StatusDeps,
): Promise<ConferencingProviderStatus> {
    const info = PROVIDER_INFO[id];
    const env = deps.env ?? process.env;
    const call = deps.call ?? callExtension;
    // Teams: el host no inyecta tokens; MicrosoftLib (backend) resuelve la cuenta del usuario de la sesion.
    const linkKey = id === 'zoom' ? 'zoom' : id === 'google-meet' ? 'google' : null;
    const linked = linkKey ? linkedResult.auth[linkKey] : undefined;
    const problem = linkKey ? linkedResult.problems[linkKey] : undefined;

    const base: ConferencingProviderStatus = {
        id,
        name: info.name,
        icon: info.icon,
        configured: false,
        connected: false,
        mode: null,
        source: 'none',
        origin: 'core',
        extensionId: info.extensionId,
        modes: DEFAULT_MODES[id].map((m) => ({ id: m, available: true })),
    };
    const libUrl = deps.env ? null : await libConnectUrl(id);
    const connect: ConferencingProviderStatus['connect'] = libUrl
        ? { type: 'oauth', url: libUrl }
        : oauthConfigured(id, env)
            ? { type: 'oauth', url: id === 'zoom' ? '/api/auth/zoom' : '/api/auth/google' }
            : { type: 'settings', section: 'integrations' };

    const res = await call({
        domain: actor.domain,
        userId: actor.userId,
        email: actor.email,
        extensionId: info.extensionId!,
        action: 'status',
        params: {},
        context: { auth: linked && linkKey ? { [linkKey]: linked } : {} },
        timeoutMs: 8_000,
    });

    if (res.ok && res.result && typeof res.result === 'object') {
        const r = res.result as Record<string, any>;
        const source = SOURCES.includes(r.source) ? (r.source as ConferencingCredentialSource) : 'none';
        const modes = Array.isArray(r.modes)
            ? r.modes.map((m: any) => ({ id: pickMode(m?.id), available: m?.available !== false })).filter((m: any): m is { id: ConferencingAuthMode; available: boolean } => Boolean(m.id))
            : base.modes;
        const configured = r.configured === true;
        const status: ConferencingProviderStatus = {
            ...base,
            origin: 'extension',
            configured,
            connected: r.connected === true || configured,
            mode: pickMode(r.mode),
            source,
            modes: modes && modes.length ? modes : base.modes,
            account: typeof r.account === 'string' ? r.account.slice(0, 200) : null,
            // Con credenciales de instancia no hace falta conectar; en modo usuario, solo si la cuenta no tiene problemas.
            connect: configured && (source === 'instance' || !problem) ? null : connect,
        };
        if (!configured) {
            status.reason = problem === 'token_revoked' ? 'token_revoked' : res.authMode === 'legacy' ? 'legacy_domain' : 'not_connected';
        }
        return status;
    }

    // Extension ausente o backend caido: adaptador del host con la cuenta vinculada del usuario.
    const reason = res.ok ? 'provider_error' : res.kind === 'not_installed' ? 'extension_not_installed' : res.error.code;
    if (linked) {
        return {
            ...base,
            configured: true,
            connected: true,
            mode: id === 'zoom' ? 'user-oauth' : 'google-account',
            source: 'user-oauth',
            connect: null,
            ...(res.ok ? {} : { reason: reason as ConferencingProviderStatus['reason'] }),
        };
    }
    return {
        ...base,
        reason: problem === 'token_revoked' ? 'token_revoked' : (reason as ConferencingProviderStatus['reason']),
        connect,
    };
}

const CACHE_TTL_MS = 5_000; // corto: tras conectar/desconectar (OAuth) el estado debe verse enseguida
const cache = new Map<string, { until: number; value: ConferencingProviderStatus[] }>();
export function __resetStatusCache() {
    cache.clear();
}

export async function listProviderStatuses(actor: Actor, opts: { force?: boolean; deps?: StatusDeps } = {}): Promise<ConferencingProviderStatus[]> {
    const deps = opts.deps ?? {};
    const key = `${actor.domain}|${actor.userId}`;
    const hit = cache.get(key);
    if (!opts.force && !opts.deps && hit && hit.until > Date.now()) return hit.value;

    const linkedResult = await (deps.linked ?? getLinkedAuth)(actor.userId);
    const [meet, zoom, teams] = await Promise.all([
        providerStatus(actor, 'google-meet', linkedResult, deps),
        providerStatus(actor, 'zoom', linkedResult, deps),
        providerStatus(actor, 'microsoft-teams', linkedResult, deps),
    ]);
    const custom: ConferencingProviderStatus = {
        id: 'custom',
        name: PROVIDER_INFO.custom.name,
        icon: PROVIDER_INFO.custom.icon,
        configured: true,
        connected: true,
        mode: 'custom-link',
        source: 'none',
        origin: 'core',
        extensionId: null,
        connect: null,
    };
    const value: ConferencingProviderStatus[] = [meet, zoom, teams, custom];
    if (!opts.deps) cache.set(key, { until: Date.now() + CACHE_TTL_MS, value });
    return value;
}

export function invalidateStatusCache(actor: Pick<Actor, 'userId' | 'domain'>) {
    cache.delete(`${actor.domain}|${actor.userId}`);
}

export function providerIdOrNull(id: string): ConferencingProviderId | null {
    return isConferencingProviderId(id) ? id : null;
}
