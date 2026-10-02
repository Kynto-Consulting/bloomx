import { auditLog } from '@/lib/security';
import { OAUTH_ACTION_LIMITS, OAUTH_VARIABLE_VALUE_RE, safePatternTest, type OAuthActionDef } from '@/lib/expansions/oauth-schema';
import { BridgeError } from '@/lib/expansions/host-services/bridge-route';
import { buildActionRequestUrl } from './action-url';
import { ProviderHttpError, providerFetch, type ProviderResponse } from './http';
import { getSharedCredentialByName, type ProviderRuntime } from './providers';

/**
 * CREDENCIAL BOT del intermediario (acciones `credential: "bot"`, p. ej. Discord). El token del bot lo guarda SOLO el nucleo (cifrado, anclado a los
 * hosts aprobados) y se inyecta aqui como `Authorization: Bot <token>`; jamas se devuelve, ni se registra, ni llega a una extension.
 *
 * Reglas (todas se aplican ANTES de llamar al proveedor y fallan cerradas):
 *  - exige OAUTH_SHARED:<proveedor> (`sharedAllowed`, firmado por el backend) y el grupo bot-* de la accion en `grantedGroups`;
 *  - moderacion: la accion `moderation` solo corre si el admin activo el ajuste `moderationSetting`;
 *  - servidores: la accion con `guild` solo corre sobre un servidor de `allowedGuildsSetting` (vacia = solo `defaultGuildSetting`; sin ninguno = nada);
 *    los canales/hilos se resuelven a su servidor con GET /channels/{id} (cache corta) y un canal sin servidor (MD) se rechaza;
 *  - host fijo (allowedHosts del proveedor, DNS publico, sin redirecciones), ruta codificada, respuesta acotada, claves `token`/`secret` eliminadas;
 *  - limites de tasa del proveedor: X-RateLimit-* por cubo y 429 con retry_after => espera acotada (<= 3 s, una vez) o `rate_limited` con retryAfter.
 */

export const SNOWFLAKE_RE = /^[0-9]{17,20}$/;
const MAX_WAIT_MS = 3_000;
const USER_AGENT = 'DiscordBot (https://github.com/Kynto-Consulting/bloomx, 1.1.0)';
const CHANNEL_TTL_MS = 10 * 60_000;
const CHANNEL_CACHE_MAX = 5_000;

const channelGuild = new Map<string, { guildId: string | null; at: number }>();
const buckets = new Map<string, { remaining: number; resetAt: number }>();
export function __resetBotState(): void { channelGuild.clear(); buckets.clear(); }

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : String(typeof v === 'string' ? v : '').split(/[\s,;]+/)).map((x) => x.trim()).filter((x) => SNOWFLAKE_RE.test(x));

export interface BotPolicy { allowedGuilds: string[]; moderation: boolean; defaultGuild: string }
/** Politica del admin a partir de los ajustes NO secretos de la extension. Lista vacia + sin servidor por defecto => ningun servidor permitido. */
export function botPolicy(provider: Pick<ProviderRuntime, 'bot' | 'settingsConfig'>): BotPolicy {
    const def = provider.bot;
    const cfg = provider.settingsConfig ?? {};
    const defaultGuild = def?.defaultGuildSetting && typeof cfg[def.defaultGuildSetting] === 'string' && SNOWFLAKE_RE.test((cfg[def.defaultGuildSetting] as string).trim()) ? (cfg[def.defaultGuildSetting] as string).trim() : '';
    const configured = def?.allowedGuildsSetting ? list(cfg[def.allowedGuildsSetting]) : [];
    const allowedGuilds = configured.length ? Array.from(new Set(configured)) : defaultGuild ? [defaultGuild] : [];
    const m = def?.moderationSetting ? cfg[def.moderationSetting] : false;
    return { allowedGuilds, moderation: m === true || m === 'true', defaultGuild };
}

/** Elimina claves sensibles (token de webhooks/interacciones, secretos) de CUALQUIER respuesta del bot (defensa en profundidad). */
export function stripSecrets(value: unknown, depth = 0): unknown {
    if (depth > 8 || value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((v) => stripSecrets(v, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (k === 'token' || k === 'secret' || k === 'client_secret' || k === 'access_token' || k === 'refresh_token') continue;
        out[k] = stripSecrets(v, depth + 1);
    }
    return out;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface BotCallInput {
    provider: ProviderRuntime;
    action: OAuthActionDef;
    input: { path: Record<string, string | number>; query: Record<string, string>; body: Record<string, unknown> };
    userId: string;
    extensionId: string;
    rateLimit: (key: string, limit: number, windowMs: number) => Promise<{ ok: boolean; retryAfter: number }>;
    write: boolean;
    sleepImpl?: (ms: number) => Promise<void>;
}

async function resolveChannelGuild(provider: ProviderRuntime, token: string, channelId: string): Promise<string | null> {
    const hit = channelGuild.get(channelId);
    if (hit && Date.now() - hit.at < CHANNEL_TTL_MS) return hit.guildId;
    const url = buildActionRequestUrl(provider, { path: '/api/v10/channels/{channelId}' }, { path: { channelId }, query: {} }, {});
    if (!url) throw new BridgeError('forbidden');
    let res: ProviderResponse;
    try {
        res = await providerFetch(provider.allowedHosts, url, { method: 'GET', headers: { Authorization: `Bot ${token}`, 'User-Agent': USER_AGENT }, maxBytes: 64_000, timeoutMs: 10_000 });
    } catch { throw new BridgeError('provider_error'); }
    if (res.status === 401) throw new BridgeError('not_configured');
    if (res.status === 429) throw new BridgeError('rate_limited', Math.max(1, Math.ceil((res.rate?.retryAfterMs ?? 1000) / 1000)));
    if (!res.ok || typeof res.json !== 'object' || res.json === null) throw new BridgeError(res.status === 404 ? 'not_found' : 'forbidden');
    const gid = (res.json as { guild_id?: unknown }).guild_id;
    const guildId = typeof gid === 'string' && SNOWFLAKE_RE.test(gid) ? gid : null;
    if (channelGuild.size >= CHANNEL_CACHE_MAX) channelGuild.clear();
    channelGuild.set(channelId, { guildId, at: Date.now() });
    return guildId;
}

export async function handleBotCall(c: BotCallInput): Promise<{ status: number; data: unknown }> {
    const { provider, action, input } = c;
    const def = provider.bot;
    if (!def || provider.status === 'needs_reapproval' || provider.status === 'pending_approval') throw new BridgeError('not_configured');
    const policy = botPolicy(provider);
    if (action.moderation === true && !policy.moderation) throw new BridgeError('forbidden');

    const started = Date.now();
    let status = 0;
    let guildForAudit = '';
    try {
        const token = await getSharedCredentialByName(provider, def.tokenCredential);
        // El formato se re-comprueba en CADA uso (un valor corrupto o anterior al patron no se envia).
        if (!token || !safePatternTest(def.tokenPattern, token)) throw new BridgeError('not_configured');

        // Ajustes que rellenan marcadores de ruta (p. ej. el Application ID): juego de caracteres fijo.
        const settingValues: Record<string, string> = {};
        for (const [placeholder, key] of Object.entries(action.pathSettings ?? {})) {
            const v = typeof provider.settingsConfig?.[key] === 'string' ? (provider.settingsConfig[key] as string).trim() : '';
            if (!v || !OAUTH_VARIABLE_VALUE_RE.test(v) || v.includes('..')) throw new BridgeError('not_configured');
            settingValues[placeholder] = v;
        }

        // Servidores permitidos.
        const g = action.guild;
        if (g?.param) {
            const gid = String(input.path[g.param] ?? '');
            if (!SNOWFLAKE_RE.test(gid) || !policy.allowedGuilds.includes(gid)) throw new BridgeError('forbidden');
            guildForAudit = gid;
        } else if (g?.channelParam) {
            const cid = String(input.path[g.channelParam] ?? '');
            if (!SNOWFLAKE_RE.test(cid) || policy.allowedGuilds.length === 0) throw new BridgeError('forbidden');
            const gid = await resolveChannelGuild(provider, token, cid);
            if (!gid || !policy.allowedGuilds.includes(gid)) throw new BridgeError('forbidden');
            guildForAudit = gid;
        } else if (g?.filterList && policy.allowedGuilds.length === 0) {
            throw new BridgeError('forbidden');
        }

        const rl = await c.rateLimit(`oauth-call:${c.userId}:${c.extensionId}:${provider.id}:${c.write ? 'w' : 'r'}`, c.write ? 30 : 120, 60_000);
        if (!rl.ok) throw new BridgeError('rate_limited', rl.retryAfter);
        if (action.quotaPerHour) {
            const hourly = await c.rateLimit(`oauth-quota:${c.userId}:${c.extensionId}:${provider.id}:${action.id}`, action.quotaPerHour, 3_600_000);
            if (!hourly.ok) throw new BridgeError('rate_limited', hourly.retryAfter);
        }

        const url = buildActionRequestUrl(provider, action, { ...input, path: { ...input.path, ...settingValues } }, {});
        if (!url) throw new BridgeError('forbidden');

        let body: string | undefined;
        if (Object.keys(input.body).length > 0 || action.fixedBody) {
            body = JSON.stringify({ ...input.body, ...(action.fixedBody ?? {}) });
            if (body.length > OAUTH_ACTION_LIMITS.maxBodyBytes) throw new BridgeError('quota_exceeded');
        }
        const wait = c.sleepImpl ?? sleep;
        // Cubo de limite de tasa por ruta + servidor/canal: si Discord indico 0 restantes, se espera (acotado) o se devuelve rate_limited.
        const bucketKey = `${action.method} ${action.path}:${guildForAudit || Object.values(input.path)[0] || ''}`;
        const send = () => providerFetch(provider.allowedHosts, url, {
            method: action.method,
            headers: { Authorization: `Bot ${token}`, 'User-Agent': USER_AGENT, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
            body,
            maxBytes: Math.min(Math.max(action.maxResponseBytes ?? OAUTH_ACTION_LIMITS.defaultResponseBytes, 1_000), OAUTH_ACTION_LIMITS.maxResponseBytes),
            timeoutMs: 15_000,
        });
        const gate = async () => {
            const b = buckets.get(bucketKey);
            if (b && b.remaining <= 0 && b.resetAt > Date.now()) {
                const ms = b.resetAt - Date.now();
                if (ms > MAX_WAIT_MS) throw new BridgeError('rate_limited', Math.ceil(ms / 1000));
                await wait(ms);
            }
        };
        const note = (r: ProviderResponse) => {
            if (r.rate?.remaining !== undefined && r.rate.resetAfterMs !== undefined) {
                if (buckets.size > 2_000) buckets.clear();
                buckets.set(bucketKey, { remaining: r.rate.remaining, resetAt: Date.now() + r.rate.resetAfterMs });
            }
        };
        await gate();
        let res = await send();
        note(res);
        if (res.status === 429) {
            const j = res.json as { retry_after?: unknown } | null;
            const retryMs = Math.round((typeof j?.retry_after === 'number' ? j.retry_after : (res.rate?.retryAfterMs ?? 1000) / 1000) * 1000);
            if (retryMs > MAX_WAIT_MS) throw new BridgeError('rate_limited', Math.max(1, Math.ceil(retryMs / 1000)));
            await wait(retryMs);
            res = await send();
            note(res);
            if (res.status === 429) throw new BridgeError('rate_limited', Math.max(1, Math.ceil((res.rate?.retryAfterMs ?? 1000) / 1000)));
        }
        status = res.status;
        // Un token de bot invalido/revocado es un problema de configuracion del admin, no del consumidor.
        if (res.status === 401) throw new BridgeError('not_configured');
        if (res.status >= 400) {
            const j = res.json as { code?: unknown; message?: unknown } | null;
            return { status: res.status, data: { ...(typeof j?.code === 'number' ? { code: j.code } : {}), ...(typeof j?.message === 'string' ? { message: j.message.slice(0, 200) } : {}) } };
        }
        let data: unknown = res.json !== null ? stripSecrets(res.json) : res.text ? { text: res.text.slice(0, 2_000) } : null;
        if (g?.filterList && Array.isArray(data)) data = data.filter((x) => typeof x === 'object' && x !== null && policy.allowedGuilds.includes(String((x as { id?: unknown }).id)));
        return { status: res.status, data };
    } catch (error) {
        if (error instanceof BridgeError) throw error;
        if (error instanceof ProviderHttpError) throw new BridgeError(error.code === 'oauth_response_too_large' ? 'quota_exceeded' : 'provider_error');
        throw error;
    } finally {
        // Auditoria SIN contenido de mensajes, parametros ni token: quien, que accion, servidor, resultado y duracion.
        auditLog('oauth.action', { userId: c.userId, extensionId: c.extensionId, provider: provider.id, action: action.id, group: action.group, principal: 'bot', write: c.write, ...(guildForAudit ? { guildId: guildForAudit } : {}), moderation: action.moderation === true, status, ms: Date.now() - started });
    }
}
