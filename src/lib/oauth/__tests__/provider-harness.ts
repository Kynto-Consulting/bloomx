import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';

/**
 * Servidor OAuth/OIDC FALSO GENERICO en proceso para probar proveedores de extensiones (MicrosoftLib, ZoomLib, SlackLib...) con su
 * manifest REAL, sin credenciales reales ni red. Cada prueba registra las rutas del proveedor (`route(host, path, handler)`) y usa las
 * piezas comunes: codigos de autorizacion de un solo uso con PKCE S256 verificado, autenticacion de cliente `post`/`basic`, refresh con
 * rotacion, firma de id_token RS256 con JWKS y registro de llamadas (para comprobar que el secreto jamas viaja donde no debe).
 */

export const EXT_ROOT = path.resolve(process.cwd(), '..', 'bloomx-extensions');

/** Extension del repositorio tal como la entrega /api/config del backend: { id, template: manifest, settings: { config } }. */
export function manifestExtension(dir: string, config: Record<string, unknown> = {}): { id: string; template: any; settings: { config: Record<string, unknown> } } {
    // Las carpetas de plantilla (_...) usan manifest.template.json para no publicarse como extension instalable.
    const file = ['manifest.json', 'manifest.template.json'].map((n) => path.join(EXT_ROOT, dir, n)).find((f) => existsSync(f));
    if (!file) throw new Error('sin manifest en ' + dir);
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    return { id: manifest.id, template: manifest, settings: { config } };
}

export interface FakeCall { url: string; method: string; form: Record<string, string>; headers: Record<string, string>; body: string | undefined }
export type FakeHandler = (req: { url: URL; method: string; headers: Record<string, string>; form: Record<string, string>; body: string | undefined }) => Response | Promise<Response>;

export interface CodeRecord { challenge: string | null; nonce: string | null; redirectUri: string; scope: string; userScope: string; subject: Record<string, any>; used: boolean }

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export class FakeIdP {
    readonly calls: FakeCall[] = [];
    readonly routes = new Map<string, FakeHandler>();
    readonly codes = new Map<string, CodeRecord>();
    readonly refreshTokens = new Map<string, { subject: Record<string, any>; scope: string }>();
    kid = 'k1';
    publicJwk!: JWK;
    private privateKey!: CryptoKey;
    refreshCount = 0;
    rotateRefresh = false;
    failRefreshWith: string | null = null;
    revoked: string[] = [];
    revokeStatus = 200;
    jwksFetches = 0;

    constructor(public opts: { clientId: string; clientSecret: string; tokenAuth?: 'post' | 'basic' }) {}

    async init() {
        const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
        this.privateKey = privateKey as unknown as CryptoKey;
        this.publicJwk = { ...(await exportJWK(publicKey)), kid: this.kid, alg: 'RS256', use: 'sig' };
    }

    route(host: string, pathname: string, handler: FakeHandler) { this.routes.set(`${host}${pathname}`, handler); return this; }

    /** El usuario "consiente" en la pantalla del proveedor: devuelve el `code` que el proveedor enviaria al callback (guarda challenge, nonce, redirect_uri y scopes pedidos). */
    consent(authUrl: string, subject: Record<string, any>): string {
        const u = new URL(authUrl);
        const code = `code-${randomBytes(6).toString('hex')}`;
        this.codes.set(code, {
            challenge: u.searchParams.get('code_challenge'), nonce: u.searchParams.get('nonce'), redirectUri: u.searchParams.get('redirect_uri') ?? '',
            scope: u.searchParams.get('scope') ?? '', userScope: u.searchParams.get('user_scope') ?? '', subject, used: false,
        });
        return code;
    }

    /** Valida la autenticacion del cliente segun `tokenAuth`. Devuelve null si es correcta o la respuesta de error. */
    checkClient(req: { headers: Record<string, string>; form: Record<string, string> }): Response | null {
        const { clientId, clientSecret } = this.opts;
        if (this.opts.tokenAuth === 'basic') {
            const expected = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
            if (req.headers.Authorization !== expected) return json(401, { error: 'invalid_client' });
            if ('client_secret' in req.form) return json(400, { error: 'invalid_request', error_description: 'client_secret en el cuerpo con Basic' });
            return null;
        }
        if (req.form.client_id !== clientId || req.form.client_secret !== clientSecret) return json(401, { error: 'invalid_client' });
        if (req.headers.Authorization) return json(400, { error: 'invalid_request', error_description: 'Authorization inesperada con client_secret_post' });
        return null;
    }

    /** Canje de `code` (un solo uso, redirect_uri exacta, PKCE S256). Devuelve el registro del codigo o la respuesta de error. */
    redeem(form: Record<string, string>): CodeRecord | Response {
        const c = this.codes.get(form.code);
        if (!c || c.used) return json(400, { error: 'invalid_grant' });
        if (form.redirect_uri !== c.redirectUri) return json(400, { error: 'redirect_uri_mismatch' });
        if (c.challenge) {
            const computed = form.code_verifier ? createHash('sha256').update(form.code_verifier, 'ascii').digest('base64url') : null;
            if (computed !== c.challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
        } else if (form.code_verifier) return json(400, { error: 'invalid_grant' });
        c.used = true;
        return c;
    }

    newRefresh(subject: Record<string, any>, scope: string): string {
        const rt = `rt-${randomBytes(6).toString('hex')}`;
        this.refreshTokens.set(rt, { subject, scope });
        return rt;
    }

    /** Endpoint de token estandar (RFC 6749): authorization_code y refresh_token, con rotacion opcional e id_token opcional. */
    standardToken(opts: { idToken?: (c: CodeRecord) => Promise<string> | string } = {}): FakeHandler {
        return async (req) => {
            const bad = this.checkClient(req);
            if (bad) return bad;
            const f = req.form;
            if (f.grant_type === 'authorization_code') {
                const c = this.redeem(f);
                if (c instanceof Response) return c;
                const rt = this.newRefresh(c.subject, c.scope);
                const body: Record<string, unknown> = { access_token: `at-${randomBytes(6).toString('hex')}`, expires_in: 3599, refresh_token: rt, scope: c.scope, token_type: 'Bearer' };
                if (opts.idToken && c.scope.split(/\s+/).includes('openid')) body.id_token = await opts.idToken(c);
                return json(200, body);
            }
            if (f.grant_type === 'refresh_token') {
                this.refreshCount += 1;
                if (this.failRefreshWith) return json(400, { error: this.failRefreshWith });
                const rt = this.refreshTokens.get(f.refresh_token);
                if (!rt) return json(400, { error: 'invalid_grant' });
                const body: Record<string, unknown> = { access_token: `at-${randomBytes(6).toString('hex')}`, expires_in: 3599, scope: rt.scope, token_type: 'Bearer' };
                if (this.rotateRefresh) {
                    this.refreshTokens.delete(f.refresh_token);
                    body.refresh_token = this.newRefresh(rt.subject, rt.scope);
                }
                return json(200, body);
            }
            return json(400, { error: 'unsupported_grant_type' });
        };
    }

    /** RFC 7009: registra el token revocado (best-effort). */
    revokeEndpoint(): FakeHandler {
        return (req) => {
            const bad = this.checkClient(req);
            if (bad) return bad;
            this.revoked.push(req.form.token);
            this.refreshTokens.delete(req.form.token);
            return json(this.revokeStatus, {});
        };
    }

    jwksEndpoint(): FakeHandler {
        return () => { this.jwksFetches += 1; return json(200, { keys: [this.publicJwk] }, { 'cache-control': 'public, max-age=3600' }); };
    }

    async signIdToken(claims: { iss: string; aud: string; sub: string; nonce?: string | null; exp?: number; extra?: Record<string, unknown>; alg?: 'none'; badSignature?: boolean }): Promise<string> {
        const now = Math.floor(Date.now() / 1000);
        const jwt = new SignJWT({ ...(claims.extra ?? {}), ...(claims.nonce ? { nonce: claims.nonce } : {}) } as never)
            .setProtectedHeader({ alg: 'RS256', kid: this.kid }).setSubject(claims.sub).setIssuer(claims.iss).setAudience(claims.aud).setIssuedAt(now - 5).setExpirationTime(claims.exp ?? now + 3000);
        let token = await jwt.sign(this.privateKey);
        if (claims.alg === 'none') token = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${token.split('.')[1]}.`;
        if (claims.badSignature) token = token.slice(0, -4) + (token.endsWith('AAAA') ? 'BBBB' : 'AAAA');
        return token;
    }

    /** Transporte para providerFetch. */
    transport = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<Response> => {
        const u = new URL(url);
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase() === 'authorization' ? 'Authorization' : k] = v;
        const form = init.body && /x-www-form-urlencoded/.test(headers['Content-Type'] ?? '') ? Object.fromEntries(new URLSearchParams(init.body)) : {};
        this.calls.push({ url, method: init.method, form, headers, body: init.body });
        const handler = this.routes.get(`${u.host}${u.pathname}`);
        if (!handler) return json(404, { error: 'not_found' });
        return handler({ url: u, method: init.method, headers, form, body: init.body });
    };
}
