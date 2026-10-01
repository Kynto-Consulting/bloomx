import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { auditLog } from '@/lib/security';
import { prisma } from '@/lib/prisma';
import { buildActionPath, validateActionInput, OAUTH_ACTION_LIMITS, type OAuthActionDef } from '@/lib/expansions/oauth-schema';
import { BridgeError, extensionIdString, idString, type BridgeDeps } from '@/lib/expansions/host-services/bridge-route';
import { ProviderHttpError, providerFetch } from './http';
import { getProvider, providerScopeGroups, providerUrlOk, type ProviderRuntime } from './providers';
import { describePrincipals, getSharedAccessToken, type SharedPrincipal } from './principals';
import { getAccessToken, grantedScopeSet, listUserAccounts, OAuthAccountError } from './tokens';

/**
 * INTERMEDIARIO OAUTH del nucleo: `services.oauth` / `ctx.libs.<proveedor>` de las extensiones llegan aqui (POST /api/internal/host/oauth,
 * firmado por el backend). La extension pide una ACCION declarada por el proveedor; el nucleo:
 *   1. autentica al backend (Ed25519) y fija usuario y extension (la extension no los elige);
 *   2. exige que el grupo de la accion este en los `grantedGroups` que el backend firmo desde el manifest (OAUTH_ACCOUNT:<prov>:<grupo>);
 *      las identidades compartidas (organizador / cuenta de servicio) exigen ademas `sharedAllowed` (OAUTH_SHARED:<prov>);
 *   3. toma SOLO cuentas del usuario, comprueba que los scopes de la accion estan concedidos a la cuenta;
 *   4. valida los parametros contra la accion (campos no declarados => error) y sustituye la ruta CODIFICADA (sin inyectar segmentos);
 *   5. llama a `apiBase + ruta` (host de allowedHosts, DNS publico, sin redirecciones) con el token, refrescando una vez si hace falta;
 *   6. devuelve SOLO { status, data }: nunca el token, ni cabeceras del proveedor, con tope de tamano; cuotas y auditoria sin cuerpos.
 */

const groupString = z.string().min(1).max(32).regex(/^[a-z][a-z0-9-]{0,31}$/);
const providerString = z.string().min(2).max(32).regex(/^[a-z][a-z0-9-]{1,31}$/);
const base = { userId: idString, extensionId: extensionIdString, grantedGroups: z.array(groupString).max(32), sharedAllowed: z.boolean().optional() };

export const oauthBridgeRequest = z.discriminatedUnion('op', [
    z.strictObject({ ...base, op: z.literal('accounts'), args: z.strictObject({ provider: providerString }) }),
    z.strictObject({ ...base, op: z.literal('principals'), args: z.strictObject({ provider: providerString }) }),
    z.strictObject({
        ...base, op: z.literal('call'),
        args: z.strictObject({
            provider: providerString,
            action: z.string().min(1).max(140).regex(/^[a-z][a-zA-Z0-9]{0,31}(?:\.[a-zA-Z][a-zA-Z0-9]{0,31}){0,3}$/),
            params: z.record(z.string(), z.unknown()).default({}),
            accountId: idString.optional(),
            principal: z.enum(['user', 'organizer', 'service']).optional(),
        }),
    }),
]);
export type OAuthBridgeRequest = z.infer<typeof oauthBridgeRequest>;

export interface BrokerDeps extends Pick<BridgeDeps, 'rateLimit'> {
    now?: () => number;
}

const READ_LIMIT = 120;
const WRITE_LIMIT = 30;

function actionOf(provider: ProviderRuntime, id: string): OAuthActionDef | null {
    return provider.actions.find((a) => a.id === id) ?? null;
}

function clamp(n: number | undefined): number {
    return Math.min(Math.max(n ?? OAUTH_ACTION_LIMITS.defaultResponseBytes, 1_000), OAUTH_ACTION_LIMITS.maxResponseBytes);
}

/** multipart/related (Drive): una parte JSON de metadatos y una parte con el contenido en base64. */
export function buildMultipart(metadata: unknown, content: string, mimeType: string): { body: string; contentType: string } {
    const boundary = `bloomx${randomBytes(12).toString('hex')}`;
    const safeMime = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(mimeType) ? mimeType : 'application/octet-stream';
    const body =
        `\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}` +
        `\r\n--${boundary}\r\nContent-Type: ${safeMime}\r\nContent-Transfer-Encoding: base64\r\n\r\n${content.replace(/[^A-Za-z0-9+/=_-]/g, '')}` +
        `\r\n--${boundary}--`;
    return { body, contentType: `multipart/related; boundary="${boundary}"` };
}

export async function handleOAuthBridge(deps: BrokerDeps, req: OAuthBridgeRequest): Promise<unknown> {
    const provider = await getProvider(req.args.provider);
    if (!provider) throw new BridgeError('not_found');
    if (provider.status !== 'ready') throw new BridgeError('not_configured');

    if (req.op === 'accounts' || req.op === 'principals') {
        const accounts = await listUserAccounts(req.userId, provider);
        if (req.op === 'principals') {
            const p = await describePrincipals(provider, accounts.length);
            // Las identidades compartidas solo se REVELAN a quien tiene el permiso OAUTH_SHARED (no se filtra la configuracion del dominio).
            return req.sharedAllowed === true ? p : { user: p.user, organizer: false, service: false, mode: '', accounts: { organizerEmail: '', impersonateUser: '' } };
        }
        return accounts.map((a) => ({
            id: a.id,
            provider: provider.id,
            groups: providerScopeGroups(provider, Array.from(grantedScopeSet(a.scope))),
            status: a.access_token || a.refresh_token ? 'active' : 'needs-reconnect',
        }));
    }

    const { action: actionId, params, accountId } = req.args;
    const principal = req.args.principal ?? 'user';
    const action = actionOf(provider, actionId);
    if (!action) throw new BridgeError('invalid_args');
    // Minimo privilegio: el grupo de la accion debe estar entre los que el manifest de la extension concede (firmado por el backend).
    if (!req.grantedGroups.includes(action.group)) throw new BridgeError('forbidden');
    // Identidades compartidas del dominio: permiso aparte (OAUTH_SHARED:<proveedor>) y sin accountId.
    if (principal !== 'user' && (req.sharedAllowed !== true || accountId)) throw new BridgeError(accountId ? 'invalid_args' : 'forbidden');

    const input = validateActionInput(action, params);
    if (!input.ok) throw new BridgeError('invalid_args');

    const write = action.write === true || action.method !== 'GET';
    const rl = await deps.rateLimit(`oauth-call:${req.userId}:${req.extensionId}:${provider.id}:${write ? 'w' : 'r'}`, write ? WRITE_LIMIT : READ_LIMIT, 60_000);
    if (!rl.ok) throw new BridgeError('rate_limited', rl.retryAfter);

    const apiBase = action.apiBase ?? provider.apiBase;
    if (!apiBase) throw new BridgeError('not_configured');
    const started = Date.now();
    let status = 0;
    try {
        const resolveToken = async (): Promise<{ accessToken: string; scope: string | null; accountId?: string }> => {
            try {
                if (principal === 'user') return await getAccessToken(provider, req.userId, { accountId });
                return await getSharedAccessToken(provider, principal as SharedPrincipal, action.requiresScopes ?? []);
            } catch (error) {
                throw mapAccountError(error);
            }
        };
        const token = await resolveToken();
        // Scopes de la accion concedidos a ESTA identidad (los alias OIDC se normalizan).
        const granted = grantedScopeSet(token.scope);
        for (const need of action.requiresScopes ?? []) if (!granted.has(need)) throw new BridgeError('scope_missing');

        const query = new URLSearchParams({ ...(action.fixedQuery ?? {}), ...input.query });
        const url = `${apiBase.replace(/\/+$/, '')}${buildActionPath(action.path, input.path)}${query.toString() ? `?${query.toString()}` : ''}`;
        if (!providerUrlOk(provider, url.split('?')[0])) throw new BridgeError('forbidden');

        let payload: { body?: string; contentType?: string } = {};
        if (action.upload) {
            const metadata = input.body[action.upload.metadata];
            const content = input.body[action.upload.content];
            const mime = action.upload.mimeType ? input.body[action.upload.mimeType] : undefined;
            if (typeof content !== 'string' || !content || typeof metadata !== 'object' || metadata === null) throw new BridgeError('invalid_args');
            const mp = buildMultipart(metadata, content, typeof mime === 'string' ? mime : 'application/octet-stream');
            payload = { body: mp.body, contentType: mp.contentType };
        } else if (Object.keys(input.body).length > 0) {
            const json = JSON.stringify(input.body);
            if (json.length > OAUTH_ACTION_LIMITS.maxBodyBytes) throw new BridgeError('quota_exceeded');
            payload = { body: json, contentType: 'application/json' };
        }
        const send = (accessToken: string) =>
            providerFetch(provider.allowedHosts, url, {
                method: action.method,
                headers: { Authorization: `Bearer ${accessToken}`, ...(payload.contentType ? { 'Content-Type': payload.contentType } : {}) },
                body: payload.body,
                maxBytes: clamp(action.maxResponseBytes),
                timeoutMs: 20_000,
            });
        let res = await send(token.accessToken);
        if (res.status === 401 && principal === 'user' && token.accountId) {
            // Token revocado/caducado antes de tiempo: se fuerza UN refresco y se reintenta una vez.
            await prisma.account.update({ where: { id: token.accountId }, data: { expires_at: 1 } }).catch(() => undefined);
            let again;
            try { again = await getAccessToken(provider, req.userId, { accountId: token.accountId }); } catch (error) { throw mapAccountError(error); }
            res = await send(again.accessToken);
        }
        status = res.status;
        // Solo el cuerpo: nunca cabeceras del proveedor (podrian traer cookies o identificadores internos).
        const data = res.json !== null ? res.json : res.text ? { text: res.text.slice(0, 64 * 1024) } : null;
        return { status: res.status, data };
    } catch (error) {
        if (error instanceof BridgeError) throw error;
        if (error instanceof ProviderHttpError) throw new BridgeError(error.code === 'oauth_response_too_large' ? 'quota_exceeded' : 'provider_error');
        throw error;
    } finally {
        // Auditoria SIN parametros, cuerpos ni tokens: quien, que accion, con que identidad, resultado y duracion.
        auditLog('oauth.action', { userId: req.userId, extensionId: req.extensionId, provider: provider.id, action: actionId, group: action.group, principal, write, status, ms: Date.now() - started });
    }
}

function mapAccountError(error: unknown): BridgeError | unknown {
    if (error instanceof OAuthAccountError) {
        if (error.code === 'OAUTH_NOT_LINKED') return new BridgeError('not_linked');
        if (error.code === 'OAUTH_RECONNECT_REQUIRED') return new BridgeError('reconnect_required');
        if (error.code === 'OAUTH_NOT_CONFIGURED') return new BridgeError('not_configured');
        if (error.code === 'OAUTH_SCOPE_MISSING') return new BridgeError('scope_missing');
        return new BridgeError('provider_error');
    }
    return error;
}
