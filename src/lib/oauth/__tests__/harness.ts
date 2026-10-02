import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';

/**
 * Servidor OAuth/OIDC FALSO en proceso (hace de accounts.google.com, oauth2.googleapis.com y www.googleapis.com) y BD falsa de Prisma, para
 * probar el flujo completo SIN credenciales reales de Google. Cubre: autorizacion (el test "consiente" a mano), intercambio de codigo con
 * PKCE S256 verificado, id_token RS256 firmado con un JWKS rotatable, userinfo, refresh con rotacion, revocacion y errores del proveedor.
 */

export interface FakeGoogleOptions { clientId: string; clientSecret: string; issuer?: string }

export class FakeGoogle {
    readonly calls: Array<{ url: string; method: string; form: Record<string, string>; auth: string | null }> = [];
    readonly logBodies: string[] = [];
    kid = 'k1';
    private privateKey!: CryptoKey;
    publicJwk!: JWK;
    private codes = new Map<string, { challenge: string | null; nonce: string | null; redirectUri: string; scope: string; email: string; sub: string; emailVerified: boolean | undefined; used: boolean }>();
    refreshTokens = new Map<string, { sub: string; scope: string }>();
    refreshCount = 0;
    refreshDelayMs = 0;
    rotateRefresh = false;
    failRefreshWith: string | null = null;
    revokeStatus = 200;
    jwksFailing = false;
    jwksFetches = 0;
    /** Mutadores para casos negativos. */
    idTokenOverrides: { aud?: string; iss?: string; nonce?: string | null; exp?: number; azp?: string; omitNonce?: boolean; alg?: string; badSignature?: boolean; sub?: string } = {};
    profileOverrides: Record<string, unknown> = {};
    opts: Required<FakeGoogleOptions>;

    constructor(opts: FakeGoogleOptions) { this.opts = { issuer: 'https://accounts.google.com', ...opts }; }

    async init() {
        const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
        this.privateKey = privateKey as unknown as CryptoKey;
        this.publicJwk = { ...(await exportJWK(publicKey)), kid: this.kid, alg: 'RS256', use: 'sig' };
    }

    async rotateKey(newKid: string) {
        this.kid = newKid;
        await this.init();
    }

    /** El usuario "consiente" en la pantalla de Google: devuelve el `code` que Google enviaria al callback. */
    consent(authUrl: string, profile: { email: string; sub: string; emailVerified?: boolean }): string {
        const u = new URL(authUrl);
        const code = `code-${randomBytes(6).toString('hex')}`;
        this.codes.set(code, {
            challenge: u.searchParams.get('code_challenge'),
            nonce: u.searchParams.get('nonce'),
            redirectUri: u.searchParams.get('redirect_uri') ?? '',
            scope: u.searchParams.get('scope') ?? '',
            email: profile.email,
            sub: profile.sub,
            emailVerified: profile.emailVerified,
            used: false,
        });
        return code;
    }

    private async idToken(c: { nonce: string | null; email: string; sub: string; scope: string; emailVerified: boolean | undefined }) {
        const o = this.idTokenOverrides;
        const claims: Record<string, unknown> = { email: c.email, email_verified: (c.emailVerified as unknown) === null ? undefined : c.emailVerified ?? true, name: 'Test User', picture: 'https://example.test/p.png' };
        if (!o.omitNonce) claims.nonce = o.nonce !== undefined ? o.nonce : c.nonce;
        if (o.azp) claims.azp = o.azp;
        const now = Math.floor(Date.now() / 1000);
        let jwt = new SignJWT(claims as never).setProtectedHeader({ alg: 'RS256', kid: this.kid }).setSubject(o.sub ?? c.sub).setIssuer(o.iss ?? this.opts.issuer).setAudience(o.aud ?? this.opts.clientId).setIssuedAt(now - 5).setExpirationTime(o.exp ?? now + 3000);
        let token = await jwt.sign(this.privateKey);
        if (o.alg === 'none') {
            const [h, p] = token.split('.');
            const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
            token = `${header}.${p}.`;
            void h;
        }
        if (o.badSignature) token = token.slice(0, -4) + (token.endsWith('AAAA') ? 'BBBB' : 'AAAA');
        return token;
    }

    /** Transporte para providerFetch: responde como los endpoints de Google. */
    transport = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<Response> => {
        const form = init.body ? Object.fromEntries(new URLSearchParams(init.body)) : {};
        this.calls.push({ url, method: init.method, form, auth: init.headers.Authorization ?? null });
        const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
        const u = new URL(url);
        if (u.host === 'oauth2.googleapis.com' && u.pathname === '/token') {
            if (form.client_id !== this.opts.clientId || form.client_secret !== this.opts.clientSecret) return json(401, { error: 'invalid_client' });
            if (form.grant_type === 'authorization_code') {
                const c = this.codes.get(form.code);
                if (!c || c.used) return json(400, { error: 'invalid_grant' });
                if (form.redirect_uri !== c.redirectUri) return json(400, { error: 'redirect_uri_mismatch' });
                if (c.challenge) {
                    const computed = form.code_verifier ? createHash('sha256').update(form.code_verifier, 'ascii').digest('base64url') : null;
                    if (computed !== c.challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
                } else if (form.code_verifier) return json(400, { error: 'invalid_grant' });
                c.used = true;
                const refresh = `rt-${randomBytes(6).toString('hex')}`;
                this.refreshTokens.set(refresh, { sub: c.sub, scope: c.scope });
                return json(200, { access_token: `at-${randomBytes(6).toString('hex')}`, expires_in: 3599, refresh_token: refresh, scope: c.scope, token_type: 'Bearer', id_token: await this.idToken(c) });
            }
            if (form.grant_type === 'refresh_token') {
                this.refreshCount += 1;
                if (this.refreshDelayMs) await new Promise((r) => setTimeout(r, this.refreshDelayMs));
                if (this.failRefreshWith) return json(400, { error: this.failRefreshWith });
                const rt = this.refreshTokens.get(form.refresh_token);
                if (!rt) return json(400, { error: 'invalid_grant' });
                const body: Record<string, unknown> = { access_token: `at-${randomBytes(6).toString('hex')}`, expires_in: 3599, scope: rt.scope, token_type: 'Bearer' };
                if (this.rotateRefresh) {
                    this.refreshTokens.delete(form.refresh_token);
                    const next = `rt-${randomBytes(6).toString('hex')}`;
                    this.refreshTokens.set(next, rt);
                    body.refresh_token = next;
                }
                return json(200, body);
            }
            return json(400, { error: 'unsupported_grant_type' });
        }
        if (u.host === 'oauth2.googleapis.com' && u.pathname === '/revoke') {
            this.refreshTokens.delete(form.token);
            return json(this.revokeStatus, {});
        }
        if (u.host === 'www.googleapis.com' && u.pathname === '/oauth2/v3/certs') {
            this.jwksFetches += 1;
            if (this.jwksFailing) return json(503, {});
            return json(200, { keys: [this.publicJwk] }, { 'cache-control': 'public, max-age=3600' });
        }
        if (u.host === 'www.googleapis.com' && u.pathname === '/oauth2/v2/userinfo') {
            return json(200, { id: this.lastSub, email: this.lastEmail, verified_email: (this.lastVerified as unknown) === null ? undefined : this.lastVerified ?? true, name: 'Test User', picture: 'https://example.test/p.png', ...this.profileOverrides });
        }
        return json(404, { error: 'not_found' });
    };

    lastSub = '';
    lastEmail = '';
    lastVerified: boolean | undefined = true;
    /** Fija el perfil que devolvera userinfo (el test lo alinea con el que consintio). */
    setProfile(p: { sub: string; email: string; verified?: boolean }) { this.lastSub = p.sub; this.lastEmail = p.email; this.lastVerified = p.verified; }
}

/** BD falsa de Prisma (solo lo que usa el flujo). No cifra: el cifrado en reposo lo cubre account-tokens.test.ts. */
export function createFakePrisma() {
    type Acc = { id: string; userId: string; type: string; provider: string; providerAccountId: string; access_token: string | null; refresh_token: string | null; id_token: string | null; expires_at: number | null; scope: string | null; token_type: string | null; provider_hash?: string | null; provider_data?: string | null };
    const accounts: Acc[] = [];
    const users: Array<{ id: string; email: string; name: string | null; avatar: string | null; password: string }> = [];
    let seq = 0;
    const matchAcc = (where: any) => (a: Acc) => where.id ? a.id === where.id : where.provider_providerAccountId ? a.provider === where.provider_providerAccountId.provider && a.providerAccountId === where.provider_providerAccountId.providerAccountId : Object.entries(where).every(([k, v]) => (a as any)[k] === v);
    const prisma = {
        account: {
            findUnique: async ({ where }: any) => accounts.find(matchAcc(where)) ?? null,
            findMany: async ({ where, select }: any = {}) => accounts.filter((a) => !where || Object.entries(where).every(([k, v]) => (a as any)[k] === v)).map((a) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, (a as any)[k]])) : { ...a })),
            upsert: async ({ where, create, update }: any) => {
                const found = accounts.find(matchAcc(where));
                if (found) { Object.assign(found, Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined))); return found; }
                const row = { id: `acc${++seq}`, access_token: null, refresh_token: null, id_token: null, expires_at: null, scope: null, token_type: null, ...create } as Acc;
                accounts.push(row);
                return row;
            },
            update: async ({ where, data }: any) => { const a = accounts.find(matchAcc(where)); if (!a) throw new Error('not found'); Object.assign(a, data); return a; },
            deleteMany: async ({ where }: any) => { const keep = accounts.filter((a) => !Object.entries(where).every(([k, v]) => (a as any)[k] === v)); const count = accounts.length - keep.length; accounts.length = 0; accounts.push(...keep); return { count }; },
        },
        user: {
            findUnique: async ({ where }: any) => users.find((u) => (where.id ? u.id === where.id : u.email === where.email)) ?? null,
            create: async ({ data }: any) => { const u = { id: `usr${++seq}`, name: null, avatar: null, ...data }; users.push(u); return u; },
        },
    };
    return { prisma, accounts, users };
}
