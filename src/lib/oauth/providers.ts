import { backendUrl } from '@/lib/backend-url';
import { createHash } from 'node:crypto';
import { tryDecrypt, encrypt } from '@/lib/encryption';
import { normalizeSettingsSchema } from '@/lib/expansions/settings-schema';
import { checkOAuthEndpointUrl, mayRegisterOAuthProvider, validateOAuthProviders, type OAuthActionDef, type OAuthPrincipalsDef, type OAuthProviderDef, type OAuthScopeDef } from '@/lib/expansions/oauth-schema';
import { oauthStore } from './store';
import { clientVersionHeaders } from '@/lib/expansions/client/capabilities';
import { MAX_REGISTRY_BYTES, pinnedBackendKey, validateRegistryResponse, verifyConfigSignature } from './registry-trust';
import { acceptsLegacyBackendSignature } from '@/lib/host-call-auth';

/**
 * REGISTRO DE PROVEEDORES OAUTH del nucleo de la instancia.
 *
 * Un proveedor lo DECLARA una extension (`oauthProviders` de su manifest, p. ej. core-googlelib) y el nucleo ejecuta el flujo. Fuentes:
 *   1. extensiones instaladas, activas y no pausadas del dominio (las que entrega /api/config del backend compartido);
 *   2. proveedores INTEGRADOS (hoy `google`): garantizan que una instancia que ya usa Google sigue funcionando sin instalar nada.
 * Una extension que registra `google` sustituye al integrado (mismos endpoints oficiales, ajustes y credenciales de la extension).
 *
 * Credenciales (nunca en una extension): `clientId` = ajuste tipado de la extension (settings.config[clientIdSetting]); `clientSecret` =
 * tabla propia de la instancia "OAuthProviderConfig" (cifrada con la clave de datos de ESTA instancia) y, como respaldo HEREDADO, la
 * variable de entorno del mismo nombre, SOLO si todos los endpoints son los oficiales del proveedor integrado. El secreto solo se usa si
 * los hosts de los endpoints coinciden con los que el admin aprobo al guardarlo (anclaje): una extension no puede desviarlo.
 */

export interface ProviderRuntime {
    id: string;
    displayName: string;
    icon: string | null;
    authorizeUrl: string;
    tokenUrl: string;
    revokeUrl: string | null;
    userinfoUrl: string | null;
    issuer: string | null;
    jwksUri: string | null;
    apiBase: string | null;
    actions: OAuthActionDef[];
    /** Nombres declarados por la extension para las credenciales/ajustes de los modos compartidos (organizador, cuenta de servicio). */
    principals: OAuthPrincipalsDef;
    /** Ajustes publicos de la extension (config) para resolver impersonateUser / organizerEmail / authMode. */
    settingsConfig: Record<string, unknown>;
    allowedHosts: string[];
    scopes: OAuthScopeDef[];
    defaultScopes: string[];
    pkce: boolean;
    extraParams: Record<string, string>;
    redirectPath: string;
    clientId: string | null;
    clientSecret: string | null;
    /** Nombre (credencial) del client secret segun el manifest. */
    clientSecretName: string | null;
    source: 'extension' | 'builtin';
    extensionId: string | null;
    /** Hosts de todos los endpoints (authorize, token, revoke, userinfo, jwks, apiBase), ordenados: lo que el admin aprueba. */
    endpointHosts: string[];
    /** Hash de la identidad del proveedor (hosts de authorize/token/...): se guarda en cada cuenta vinculada. */
    identityHash: string;
    status: 'ready' | 'not_configured' | 'needs_reapproval' | 'pending_approval';
}

export const GOOGLE_SCOPES: OAuthScopeDef[] = [
    { id: 'openid', group: 'userinfo', es: 'Identificar tu cuenta de Google', en: 'Identify your Google account', risk: 'low' },
    { id: 'email', group: 'userinfo', es: 'Ver tu direccion de correo', en: 'See your email address', risk: 'low' },
    { id: 'profile', group: 'userinfo', es: 'Ver tu nombre y foto', en: 'See your name and photo', risk: 'low' },
    { id: 'https://www.googleapis.com/auth/drive.readonly', group: 'drive', es: 'Ver tus archivos de Google Drive', en: 'See your Google Drive files', risk: 'medium' },
    { id: 'https://www.googleapis.com/auth/calendar', group: 'calendar', es: 'Ver y gestionar tus calendarios', en: 'See and manage your calendars', risk: 'high' },
    { id: 'https://www.googleapis.com/auth/contacts.readonly', group: 'contacts', es: 'Ver tus contactos', en: 'See your contacts', risk: 'medium' },
    { id: 'https://www.googleapis.com/auth/meetings.space.created', group: 'meet', es: 'Crear y gestionar reuniones de Google Meet', en: 'Create and manage Google Meet meetings', risk: 'medium' },
];

/** Proveedor integrado de Google = exactamente lo que el nucleo hacia antes (scopes, parametros y URL de retorno ya registrada en Google Cloud). */
const BUILTIN_GOOGLE_DEF = {
    id: 'google',
    displayName: 'Google',
    icon: 'brand:google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    revokeUrl: 'https://oauth2.googleapis.com/revoke',
    userinfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    issuer: 'https://accounts.google.com',
    jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
    apiBase: 'https://www.googleapis.com',
    allowedHosts: ['accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com', 'openidconnect.googleapis.com'],
    scopes: GOOGLE_SCOPES,
    defaultScopes: GOOGLE_SCOPES.map((s) => s.id),
    pkce: true,
    extraParams: { access_type: 'offline', prompt: 'consent' },
    clientIdSetting: 'GOOGLE_CLIENT_ID',
    clientSecretCredential: 'GOOGLE_CLIENT_SECRET',
    redirectPath: '/api/auth/callback/google',
} as const;

/** Hosts oficiales por proveedor integrado: solo con ellos se admiten las variables de entorno heredadas. */
const LEGACY_ENV_HOSTS: Record<string, readonly string[]> = {
    google: [...BUILTIN_GOOGLE_DEF.allowedHosts, 'meet.googleapis.com', 'people.googleapis.com', 'gmail.googleapis.com', 'calendar.googleapis.com', 'drive.googleapis.com'],
};

const hostOf = (url: string | null | undefined): string | null => { try { return url ? new URL(url).hostname.toLowerCase() : null; } catch { return null; } };

export function endpointHostsOf(def: { authorizeUrl: string; tokenUrl: string; revokeUrl?: string | null; userinfoUrl?: string | null; jwksUri?: string | null; apiBase?: string | null; actions?: ReadonlyArray<{ apiBase?: string }> | null }): string[] {
    // Incluye la base propia de cada accion: una accion que apunte a un host nuevo exige que el admin vuelva a aprobar.
    const urls = [def.authorizeUrl, def.tokenUrl, def.revokeUrl, def.userinfoUrl, def.jwksUri, def.apiBase, ...(def.actions ?? []).map((a) => a.apiBase)];
    return Array.from(new Set(urls.map(hostOf).filter((h): h is string => !!h))).sort();
}

/**
 * Hash de la IDENTIDAD de un proveedor (hosts de authorize/token/revoke/userinfo/jwks + issuer). Se guarda en cada cuenta al vincularla y se exige
 * al usarla/refrescarla: si otra definicion (otro host de token) se registrara con el mismo id, los tokens de las cuentas existentes NO se le envian.
 * No incluye las bases de las acciones (cambiarlas no cambia quien emitio el token).
 */
export function identityHostsOf(def: { authorizeUrl: string; tokenUrl: string; revokeUrl?: string | null; userinfoUrl?: string | null; jwksUri?: string | null; issuer?: string | null }): string[] {
    const urls = [def.authorizeUrl, def.tokenUrl, def.revokeUrl, def.userinfoUrl, def.jwksUri, def.issuer];
    return Array.from(new Set(urls.map(hostOf).filter((h): h is string => !!h))).sort();
}
export function providerIdentityHash(def: { id: string; authorizeUrl: string; tokenUrl: string; revokeUrl?: string | null; userinfoUrl?: string | null; jwksUri?: string | null; issuer?: string | null }): string {
    return createHash('sha256').update(JSON.stringify([def.id, identityHostsOf(def)])).digest('hex');
}

/**
 * Una cuenta ya vinculada solo se usa con el proveedor que la emitio. Cuentas anteriores a esta columna (hash nulo): se aceptan SOLO si el proveedor
 * activo tiene los endpoints oficiales del proveedor integrado (hoy Google), cuyo hash se calcula y se guarda al primer uso.
 */
export function accountMatchesProvider(account: { provider_hash?: string | null }, provider: Pick<ProviderRuntime, 'id' | 'identityHash' | 'endpointHosts'>): boolean {
    if (account.provider_hash) return account.provider_hash === provider.identityHash;
    return usesOfficialEndpoints(provider.id, provider.endpointHosts);
}

/** true si TODOS los endpoints son del conjunto oficial del proveedor integrado (variables de entorno heredadas admitidas). */
export function usesOfficialEndpoints(id: string, hosts: readonly string[]): boolean {
    const official = LEGACY_ENV_HOSTS[id];
    return !!official && hosts.length > 0 && hosts.every((h) => official.includes(h));
}

export type ExtensionLike = { id?: unknown; template?: unknown; settings?: unknown };

function asTemplate(value: unknown): Record<string, any> | null {
    if (typeof value === 'string') { try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' ? parsed : null; } catch { return null; } }
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null;
}

export interface ParsedProvider { def: OAuthProviderDef & { clientIdSetting: string; clientSecretCredential?: string }; extensionId: string; settings: Record<string, any> }

/**
 * Proveedores declarados por las extensiones. Cada definicion se valida con el MISMO esquema que al publicar (SSRF incluido); una invalida
 * se descarta entera. Ante dos extensiones con el mismo id gana la de id menor (determinista).
 */
export function parseExtensionProviders(extensions: readonly ExtensionLike[]): Map<string, ParsedProvider> {
    const out = new Map<string, ParsedProvider>();
    const ordered = [...extensions].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    for (const ext of ordered) {
        const template = asTemplate(ext.template);
        if (!template || !Array.isArray(template.oauthProviders)) continue;
        const fields = normalizeSettingsSchema(template.settingsSchema).fields;
        const errors: string[] = [];
        validateOAuthProviders(template.oauthProviders, (path, message) => errors.push(`${path}: ${message}`), () => undefined, fields, String(ext.id));
        // Una definicion invalida invalida SOLO esa extension (nunca el registro entero ni el proveedor integrado).
        if (errors.length > 0) continue;
        for (const def of template.oauthProviders as ParsedProvider['def'][]) {
            if (out.has(def.id)) continue;
            // Defensa en profundidad (validateOAuthProviders ya lo rechaza): un id reservado solo lo registra su extension oficial.
            if (!mayRegisterOAuthProvider(def.id, String(ext.id))) continue;
            const settings = ext.settings && typeof ext.settings === 'object' ? (ext.settings as Record<string, any>) : {};
            out.set(def.id, { def, extensionId: String(ext.id), settings });
        }
    }
    return out;
}

function toRuntime(def: ParsedProvider['def'] | typeof BUILTIN_GOOGLE_DEF, source: 'extension' | 'builtin', extensionId: string | null): ProviderRuntime {
    const d = def as ParsedProvider['def'];
    const hosts = endpointHostsOf({ authorizeUrl: d.authorizeUrl, tokenUrl: d.tokenUrl, revokeUrl: d.revokeUrl, userinfoUrl: d.userinfoUrl, jwksUri: d.jwksUri, apiBase: d.apiBase, actions: d.actions });
    return {
        id: d.id,
        displayName: d.displayName,
        icon: d.icon ?? null,
        authorizeUrl: d.authorizeUrl,
        tokenUrl: d.tokenUrl,
        revokeUrl: d.revokeUrl ?? null,
        userinfoUrl: d.userinfoUrl ?? null,
        issuer: d.issuer ?? null,
        jwksUri: d.jwksUri ?? null,
        apiBase: d.apiBase ?? null,
        actions: [...(d.actions ?? [])],
        principals: { ...(d.principals ?? {}) },
        settingsConfig: {},
        allowedHosts: [...d.allowedHosts],
        scopes: [...d.scopes],
        defaultScopes: d.defaultScopes && d.defaultScopes.length ? [...d.defaultScopes] : d.scopes.map((s) => s.id),
        pkce: d.pkce,
        extraParams: { ...(d.extraParams ?? {}) },
        redirectPath: d.redirectPath ?? `/api/oauth/${d.id}/callback`,
        clientId: null,
        clientSecret: null,
        clientSecretName: (d as { clientSecretCredential?: string }).clientSecretCredential ?? null,
        source,
        extensionId,
        endpointHosts: hosts,
        identityHash: providerIdentityHash({ id: d.id, authorizeUrl: d.authorizeUrl, tokenUrl: d.tokenUrl, revokeUrl: d.revokeUrl, userinfoUrl: d.userinfoUrl, jwksUri: d.jwksUri, issuer: d.issuer }),
        status: 'not_configured',
    };
}

/** Rellena clientId / clientSecret y el estado. `settings` = ajustes publicos de la extension (config). */
export async function attachCredentials(runtime: ProviderRuntime, def: { clientIdSetting: string; clientSecretCredential?: string }, settings: Record<string, any>, env: NodeJS.ProcessEnv = process.env): Promise<ProviderRuntime> {
    const official = usesOfficialEndpoints(runtime.id, runtime.endpointHosts);
    const configured = settings?.config?.[def.clientIdSetting];
    const clientId = typeof configured === 'string' && configured.trim() ? configured.trim() : official && env[def.clientIdSetting] ? String(env[def.clientIdSetting]) : null;
    let secret: string | null = null;
    let status: ProviderRuntime['status'] = 'not_configured';
    const row = await oauthStore().getProviderConfig(runtime.id).catch(() => null);
    if (row?.clientSecret) {
        const sameHosts = JSON.stringify([...row.approvedHosts].sort()) === JSON.stringify(runtime.endpointHosts);
        if (!sameHosts) status = 'needs_reapproval';
        else {
            const plain = tryDecrypt(row.clientSecret);
            if (plain) secret = plain;
        }
    }
    if (!secret && status !== 'needs_reapproval' && official && def.clientSecretCredential && env[def.clientSecretCredential]) secret = String(env[def.clientSecretCredential]);
    // Un proveedor que NO tiene los endpoints oficiales de un proveedor integrado exige aprobacion EXPLICITA del admin de sus hosts (aunque sea un
    // cliente publico PKCE): sin ella queda en pending_approval y no se usa. Cualquier cambio de hosts posterior lo devuelve a needs_reapproval.
    if (!official && status !== 'needs_reapproval') {
        if (!row || !row.approvedHosts?.length) status = 'pending_approval';
        else if (JSON.stringify([...row.approvedHosts].sort()) !== JSON.stringify(runtime.endpointHosts)) status = 'needs_reapproval';
    }
    // Cliente publico con PKCE y sin secreto declarado: basta el clientId.
    const needsSecret = !!def.clientSecretCredential || !runtime.pkce;
    if (status !== 'needs_reapproval' && status !== 'pending_approval') status = clientId && (secret || !needsSecret) ? 'ready' : 'not_configured';
    if (status === 'pending_approval' || status === 'needs_reapproval') secret = null;
    const cfg = settings?.config && typeof settings.config === 'object' ? (settings.config as Record<string, unknown>) : {};
    return { ...runtime, clientId, clientSecret: secret, status, settingsConfig: cfg };
}

/** Nombres de credenciales que el admin puede guardar (cifradas, en la instancia) para el proveedor. */
export function credentialNamesOf(provider: Pick<ProviderRuntime, 'principals' | 'clientSecretName'>): string[] {
    return [provider.clientSecretName, provider.principals.organizerRefreshToken, provider.principals.serviceAccountJson].filter((n): n is string => typeof n === 'string' && !!n);
}

/** Setting publico de la extension (p. ej. impersonateUser): ajuste de la instancia/extension > variable de entorno heredada (solo endpoints oficiales). */
export function principalSetting(provider: ProviderRuntime, key: keyof OAuthPrincipalsDef, env: NodeJS.ProcessEnv = process.env): string {
    const name = provider.principals[key];
    if (!name) return '';
    const v = provider.settingsConfig[name];
    if (typeof v === 'string' && v.trim()) return v.trim();
    return usesOfficialEndpoints(provider.id, provider.endpointHosts) && env[name] ? String(env[name]).trim() : '';
}

/**
 * Credencial compartida (organizer refresh token / JSON de cuenta de servicio): tabla de la instancia (cifrada) con los hosts aprobados
 * vigentes > variable de entorno de la instancia (solo con endpoints oficiales). Nunca se devuelve a una extension.
 */
export async function getSharedCredential(provider: ProviderRuntime, key: 'organizerRefreshToken' | 'serviceAccountJson', env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
    const name = provider.principals[key];
    if (!name) return null;
    const row = await oauthStore().getProviderConfig(provider.id).catch(() => null);
    if (row?.extra?.[name]) {
        if (JSON.stringify([...row.approvedHosts].sort()) !== JSON.stringify(provider.endpointHosts)) return null;
        const plain = tryDecrypt(row.extra[name]);
        if (plain) return plain;
    }
    return usesOfficialEndpoints(provider.id, provider.endpointHosts) && env[name] ? String(env[name]) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Fuente de extensiones y cache
// ---------------------------------------------------------------------------------------------------------------

type ExtensionsSource = () => Promise<ExtensionLike[]>;
const BACKEND_URL = () => (backendUrl()).replace(/\/+$/, '');

/**
 * Registro de proveedores = respuesta de {backend}/api/config. Sin ninguna clave del backend: URL de backend FIJA por instancia (lib/backend-url.ts, https
 * obligatorio en produccion), SIN redirecciones (un 3xx se rechaza), tope de tamano y esquema estricto (validateRegistryResponse). Los proveedores NO
 * integrados exigen la aprobacion del admin (pending_approval) y los integrados (google...) solo los registra la extension oficial reservada.
 * LEGADO DEPRECADO: si hay BLOOMX_BACKEND_PUBLIC_KEY y llega X-BloomX-Config-Sig de un backend antiguo, se verifica (y una firma invalida descarta el registro).
 */
const defaultSource: ExtensionsSource = async () => {
    const host = (process.env.TOP_DOMAIN || '').split(':')[0] || (process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).hostname : '');
    if (!host) return [];
    const base = backendUrl(); // lanza insecure_backend_url si no es https en produccion
    const res = await fetch(`${base}/api/config?domain=${encodeURIComponent(host)}`, { cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(6000), headers: clientVersionHeaders() });
    if (res.status >= 300 && res.status < 400) throw new Error('config_redirect_rejected');
    if (!res.ok) throw new Error('config_unavailable');
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > MAX_REGISTRY_BYTES) throw new Error('config_too_large');
    const text = await res.text();
    if (text.length > MAX_REGISTRY_BYTES) throw new Error('config_too_large');
    const pinned = acceptsLegacyBackendSignature() ? pinnedBackendKey() : null;
    const sig = res.headers.get('x-bloomx-config-sig');
    if (pinned && sig && !verifyConfigSignature({ domain: host, body: text, header: sig, publicKey: pinned })) throw new Error('config_signature_invalid');
    let data: unknown;
    try { data = JSON.parse(text); } catch { throw new Error('config_invalid'); }
    const list = validateRegistryResponse(data);
    if (!list) throw new Error('config_invalid');
    return list;
};
let source: ExtensionsSource = defaultSource;
let cache: { at: number; map: Map<string, ProviderRuntime> } | null = null;
const TTL_MS = 30_000;

export function __setExtensionsSource(fn: ExtensionsSource | null): void {
    if (process.env.NODE_ENV !== 'test') throw new Error('__setExtensionsSource is only available in tests');
    source = fn ?? defaultSource;
    cache = null;
}
export function invalidateProviderCache(): void { cache = null; }

export async function loadProviders(): Promise<Map<string, ProviderRuntime>> {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.map;
    const map = new Map<string, ProviderRuntime>();
    let exts: ExtensionLike[] = [];
    try { exts = await source(); } catch { exts = cache ? [] : []; /* backend caido: solo integrados (nada deja de funcionar) */ }
    for (const [id, parsed] of parseExtensionProviders(exts)) {
        map.set(id, await attachCredentials(toRuntime(parsed.def, 'extension', parsed.extensionId), parsed.def, parsed.settings));
    }
    if (!map.has('google')) map.set('google', await attachCredentials(toRuntime(BUILTIN_GOOGLE_DEF as unknown as ParsedProvider['def'], 'builtin', null), BUILTIN_GOOGLE_DEF, {}));
    cache = { at: Date.now(), map };
    return map;
}

export async function getProvider(id: string): Promise<ProviderRuntime | null> {
    if (!/^[a-z][a-z0-9-]{1,31}$/.test(id)) return null;
    return (await loadProviders()).get(id) ?? null;
}

export interface ProviderSummary { id: string; displayName: string; icon: string | null; source: 'extension' | 'builtin'; extensionId: string | null; status: ProviderRuntime['status']; groups: string[]; endpointHosts: string[] }
export async function listProviderSummaries(): Promise<ProviderSummary[]> {
    return Array.from((await loadProviders()).values()).map((p) => ({
        id: p.id, displayName: p.displayName, icon: p.icon, source: p.source, extensionId: p.extensionId, status: p.status,
        groups: Array.from(new Set(p.scopes.map((s) => s.group))), endpointHosts: p.endpointHosts,
    }));
}

/** Guarda el client secret (cifrado) anclado a los hosts ACTUALES de los endpoints: lo aprueba el admin con esta accion. */
export async function saveProviderSecret(provider: ProviderRuntime, secret: string, by: string | null): Promise<boolean> {
    const prev = await oauthStore().getProviderConfig(provider.id).catch(() => null);
    const sameHosts = !!prev && JSON.stringify([...prev.approvedHosts].sort()) === JSON.stringify(provider.endpointHosts);
    // Si los hosts cambiaron, las credenciales compartidas anteriores NO se conservan (el admin aprueba los hosts nuevos solo para lo que guarda ahora).
    const ok = await oauthStore().saveProviderConfig({ provider: provider.id, extensionId: provider.extensionId, clientSecret: encrypt(secret), approvedHosts: provider.endpointHosts, updatedBy: by, extra: sameHosts ? prev!.extra : {} });
    invalidateProviderCache();
    return ok;
}

/** Aprueba (o re-aprueba) los hosts ACTUALES de un proveedor no integrado. Conserva el secreto/credenciales solo si los hosts no cambiaron. */
export async function approveProviderHosts(provider: ProviderRuntime, by: string | null): Promise<boolean> {
    const prev = await oauthStore().getProviderConfig(provider.id).catch(() => null);
    const sameHosts = !!prev && JSON.stringify([...prev.approvedHosts].sort()) === JSON.stringify(provider.endpointHosts);
    const ok = await oauthStore().saveProviderConfig({ provider: provider.id, extensionId: provider.extensionId, clientSecret: sameHosts ? prev!.clientSecret : null, approvedHosts: provider.endpointHosts, updatedBy: by, extra: sameHosts ? prev!.extra : {} });
    invalidateProviderCache();
    return ok;
}

/** Guarda (o borra con null) una credencial compartida NOMBRADA por el manifest, cifrada y anclada a los hosts actuales. */
export async function saveSharedCredential(provider: ProviderRuntime, name: string, value: string | null, by: string | null): Promise<boolean> {
    const prev = await oauthStore().getProviderConfig(provider.id).catch(() => null);
    const sameHosts = !!prev && JSON.stringify([...prev.approvedHosts].sort()) === JSON.stringify(provider.endpointHosts);
    const extra = { ...(sameHosts ? prev!.extra : {}) };
    if (value === null) delete extra[name]; else extra[name] = encrypt(value);
    const ok = await oauthStore().saveProviderConfig({
        provider: provider.id, extensionId: provider.extensionId, clientSecret: sameHosts ? prev!.clientSecret : null, approvedHosts: provider.endpointHosts, updatedBy: by, extra,
    });
    invalidateProviderCache();
    return ok;
}
export async function clearProviderSecret(id: string): Promise<boolean> {
    const ok = await oauthStore().deleteProviderConfig(id);
    invalidateProviderCache();
    return ok;
}

/** Grupos del catalogo con AL MENOS un scope concedido (la comprobacion fina por accion usa `requiresScopes`). */
export function providerScopeGroups(provider: Pick<ProviderRuntime, 'scopes'>, grantedScopes: readonly string[]): string[] {
    const granted = new Set(grantedScopes);
    return Array.from(new Set(provider.scopes.filter((s) => granted.has(s.id)).map((s) => s.group))).sort();
}

/** Valida una URL de endpoint de un proveedor ya registrado (defensa en profundidad antes de cada llamada). */
export const providerUrlOk = (provider: Pick<ProviderRuntime, 'allowedHosts'>, url: string): boolean => checkOAuthEndpointUrl(url, provider.allowedHosts) === null;

export interface ProviderAdminView {
    id: string; displayName: string; icon: string | null; source: 'extension' | 'builtin'; extensionId: string | null; status: ProviderRuntime['status'];
    /** URL a registrar como "URI de redireccionamiento autorizado" en la consola del proveedor. */
    redirectUri: string | null;
    endpointHosts: string[];
    clientIdConfigured: boolean;
    /** De donde sale el client secret (jamas su valor): tabla de la instancia, variable de entorno heredada, ninguno o pendiente de re-aprobar. */
    secretSource: 'instance' | 'env' | 'none' | 'needs_reapproval';
    scopes: Array<{ id: string; group: string; es: string; en: string; risk: string }>;
    actions: number;
}

/** Vista de administracion (SIN secretos) de los proveedores registrados. */
export async function describeProvidersForAdmin(origin: string | null): Promise<ProviderAdminView[]> {
    const out: ProviderAdminView[] = [];
    for (const p of (await loadProviders()).values()) {
        const row = await oauthStore().getProviderConfig(p.id).catch(() => null);
        const secretSource: ProviderAdminView['secretSource'] = p.status === 'needs_reapproval' ? 'needs_reapproval' : row?.clientSecret && p.clientSecret ? 'instance' : p.clientSecret ? 'env' : 'none';
        out.push({
            id: p.id, displayName: p.displayName, icon: p.icon, source: p.source, extensionId: p.extensionId, status: p.status,
            redirectUri: origin ? `${origin}${p.redirectPath}` : null, endpointHosts: p.endpointHosts, clientIdConfigured: !!p.clientId, secretSource,
            scopes: p.scopes.map((s) => ({ id: s.id, group: s.group, es: s.es, en: s.en, risk: s.risk })), actions: p.actions.length,
        });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
}
