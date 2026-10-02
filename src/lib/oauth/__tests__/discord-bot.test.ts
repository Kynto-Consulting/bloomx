import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakePrisma } from './harness';
import { json, manifestExtension } from './provider-harness';

// CREDENCIAL BOT del intermediario (Discord) con el manifest REAL de core-discordlib 1.1.0 y un "Discord" falso en proceso: inyeccion de `Authorization: Bot`
// sin exponer el token, host fijo, ids con traversal, grupos/permiso compartido, moderacion y servidores permitidos, 429/limites, tamano de respuesta,
// no filtracion en errores/auditoria, formato del token al guardarlo y regresion de las acciones OAuth existentes.
const h = vi.hoisted(() => ({ prisma: null as any, audits: [] as Array<{ event: string; data: any }> }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return h.prisma; } }));
vi.mock('@/lib/security', async () => {
    const actual = await vi.importActual<typeof import('@/lib/security')>('@/lib/security');
    return { ...actual, auditLog: vi.fn((event: string, data: any) => { h.audits.push({ event, data }); }) };
});
vi.mock('@/lib/db/pool', () => ({ getDbPool: () => { throw new Error('no db in unit tests'); } }));

import { __setOAuthTransport } from '../http';
import { __setOAuthStore, createMemoryOAuthStore } from '../store';
import { __setExtensionsSource, getProvider, saveSharedCredential, saveProviderSecret, credentialNamesOf } from '../providers';
import { handleOAuthBridge, oauthBridgeRequest } from '../broker';
import { __resetBotState, botPolicy, stripSecrets } from '../bot-broker';
import { divertOAuthCredentials, oauthCredentialStatus } from '../credentials-admin';

const TOKEN = 'QTk4NjIyNDgzNDcxOTI1MjQ4.Cl2FMQ.ZnCjm1XVW7vRze4b7Cq4se7kKWs';
const G1 = '333333333333333333';
const G2 = '999999999999999999';
const C1 = '444444444444444444'; // canal del servidor G1
const C2 = '555555555555555555'; // canal del servidor G2 (no permitido)
const CDM = '666666666666666666'; // MD (sin guild_id)
const M = '777777777777777777';
const U = '888888888888888888';
const APP = '222222222222222222';

type Seen = { url: string; method: string; auth: string | null; body: string | undefined; ua: string | null };
let seen: Seen[];
let config: Record<string, unknown>;
let reply: ((u: URL, method: string, body: string | undefined) => Response) | null;
let limiter: { ok: boolean; retryAfter: number };

const noDb = { rateLimit: async () => limiter };
const GROUPS = ['bot-read', 'bot-write', 'bot-mod'];
const call = (action: string, params: any, extra: { groups?: string[]; shared?: boolean; args?: Record<string, unknown> } = {}) =>
    handleOAuthBridge(noDb, oauthBridgeRequest.parse({ op: 'call', userId: 'u1', extensionId: 'consumer', grantedGroups: extra.groups ?? GROUPS, sharedAllowed: extra.shared ?? true, args: { provider: 'discord', action, params, ...(extra.args ?? {}) } }));
const code = async (p: Promise<unknown>) => { try { await p; return 'no-error'; } catch (e: any) { return e.code ?? String(e.message); } };

function discord(u: URL, method: string, body: string | undefined): Response {
    if (reply) return reply(u, method, body);
    const m = /^\/api\/v10\/channels\/(\d+)$/.exec(u.pathname);
    if (m && method === 'GET') return m[1] === CDM ? json(200, { id: CDM, type: 1 }) : json(200, { id: m[1], type: 0, guild_id: m[1] === C2 ? G2 : G1, name: 'general' });
    if (u.pathname === '/api/v10/users/@me/guilds') return json(200, [{ id: G1, name: 'uno' }, { id: G2, name: 'dos' }]);
    if (u.pathname.endsWith('/webhooks')) return json(200, [{ id: M, channel_id: C1, name: 'hook', token: 'WEBHOOK-TOKEN-SECRETO' }]);
    if (method === 'DELETE' || method === 'PUT') return new Response(null, { status: 204 });
    return json(200, { id: M, channel_id: C1, content: 'ok' });
}

beforeEach(async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ENCRYPTION_KEY', 'unit-test-key-0123456789abcdef0123456789');
    h.prisma = createFakePrisma().prisma;
    seen = []; h.audits = []; reply = null; limiter = { ok: true, retryAfter: 0 };
    config = { DISCORD_APPLICATION_ID: APP, DISCORD_DEFAULT_GUILD_ID: G1, allowedGuildIds: [], allowModeration: false };
    __setOAuthTransport(((url: string, init: any) => {
        seen.push({ url, method: init.method, auth: init.headers.Authorization ?? null, body: init.body, ua: init.headers['User-Agent'] ?? null });
        return Promise.resolve(discord(new URL(url), init.method, init.body));
    }) as never, async () => ['162.159.135.232']);
    __setOAuthStore(createMemoryOAuthStore());
    __setExtensionsSource(async () => [manifestExtension('discordlib', config)]);
    __resetBotState();
    await saveSharedCredential((await getProvider('discord'))!, 'DISCORD_BOT_TOKEN', TOKEN, 'admin1');
});
afterEach(() => { __setOAuthTransport(null); __setOAuthStore(null); __setExtensionsSource(null); vi.unstubAllEnvs(); });

/** Deja tambien el OAuth de usuario configurado (client id + secret): las acciones NO bot exigen un proveedor listo. */
async function oauthReady(extra: Record<string, unknown> = {}) {
    config.DISCORD_CLIENT_ID = 'cid-dc';
    __setExtensionsSource(async () => [manifestExtension('discordlib', config)]);
    await saveProviderSecret((await getProvider('discord'))!, 'secret-discord', 'admin1');
    await saveSharedCredential((await getProvider('discord'))!, 'DISCORD_BOT_TOKEN', TOKEN, 'admin1');
    void extra;
}

describe('credencial bot: inyeccion y no filtracion', () => {
    it('envia Authorization: Bot <token> a discord.com (host fijo, API v10) y devuelve solo { status, data } sin el token', async () => {
        const r: any = await call('bot.messages.send', { channelId: C1, content: 'hola' });
        const sent = seen.find((s) => s.method === 'POST')!;
        expect(sent.auth).toBe(`Bot ${TOKEN}`);
        expect(sent.url).toBe(`https://discord.com/api/v10/channels/${C1}/messages`);
        expect(sent.ua).toMatch(/^DiscordBot \(/);
        expect(JSON.parse(sent.body!)).toEqual({ content: 'hola', allowed_mentions: { parse: [] } });
        expect(Object.keys(r).sort()).toEqual(['data', 'status']);
        expect(JSON.stringify(r)).not.toContain(TOKEN);
    });

    it('elimina claves token/secret de CUALQUIER respuesta (webhooks de un canal) y el audit no lleva token, contenido ni parametros', async () => {
        const r: any = await call('bot.webhooks.list', { channelId: C1 });
        expect(JSON.stringify(r)).not.toContain('SECRETO');
        expect(r.data[0]).toEqual({ id: M, channel_id: C1, name: 'hook' });
        await call('bot.messages.send', { channelId: C1, content: 'texto sensible del mensaje' });
        const dump = JSON.stringify(h.audits);
        expect(dump).not.toContain(TOKEN);
        expect(dump).not.toContain('texto sensible');
        const a = h.audits.filter((x) => x.event === 'oauth.action').pop()!.data;
        expect(a).toMatchObject({ provider: 'discord', action: 'bot.messages.send', group: 'bot-write', principal: 'bot', write: true, guildId: G1, status: 200 });
        expect(stripSecrets({ a: { token: 'x', b: [{ secret: 1, ok: 2 }] } })).toEqual({ a: { b: [{ ok: 2 }] } });
    });

    it('errores de Discord: 401 (token revocado) => not_configured; 403 => status 403 con { code, message } acotado; ni rastro del token', async () => {
        reply = () => json(401, { message: '401: Unauthorized', code: 0, detail: TOKEN });
        expect(await code(call('bot.messages.send', { channelId: C1, content: 'x' }))).toBe('not_configured');
        reply = (u) => (/channels\/\d+$/.test(u.pathname) ? json(200, { id: C1, guild_id: G1 }) : json(403, { message: 'Missing Permissions', code: 50013, stack: TOKEN, errors: { x: 1 } }));
        const r: any = await call('bot.messages.send', { channelId: C1, content: 'x' });
        expect(r).toEqual({ status: 403, data: { code: 50013, message: 'Missing Permissions' } });
        expect(JSON.stringify(h.audits)).not.toContain(TOKEN);
    });

    it('sin token guardado, o guardado con formato invalido => not_configured (no se envia nada)', async () => {
        __setOAuthStore(createMemoryOAuthStore());
        expect(await code(call('bot.users.get', { userId: U }))).toBe('not_configured');
        await saveSharedCredential((await getProvider('discord'))!, 'DISCORD_BOT_TOKEN', 'esto no es un token', 'admin1');
        expect(await code(call('bot.users.get', { userId: U }))).toBe('not_configured');
        expect(seen.length).toBe(0);
    });

    it('el token del bot SOLO se guarda en el nucleo: credentialNamesOf lo incluye y oauthCredentialStatus no devuelve su valor', async () => {
        const p = (await getProvider('discord'))!;
        expect(credentialNamesOf(p)).toContain('DISCORD_BOT_TOKEN');
        __setExtensionsSource(async () => [{ ...manifestExtension('discordlib', config), id: 'core-discordlib' }]);
        const st = await oauthCredentialStatus('core-discordlib');
        expect(st.find((s) => s.name === 'DISCORD_BOT_TOKEN')).toMatchObject({ configured: true, source: 'domain' });
        expect(JSON.stringify(st)).not.toContain(TOKEN);
    });
});

describe('permisos y rutas', () => {
    it('exige OAUTH_SHARED (sharedAllowed) y el grupo concedido; no admite cuenta ni identidades organizer', async () => {
        expect(await code(call('bot.users.get', { userId: U }, { shared: false }))).toBe('forbidden');
        expect(await code(call('bot.messages.send', { channelId: C1, content: 'x' }, { groups: ['bot-read'] }))).toBe('forbidden');
        expect(await code(call('bot.users.get', { userId: U }, { args: { principal: 'organizer' } }))).toBe('invalid_args');
        expect(await code(call('bot.users.get', { userId: U }, { args: { accountId: 'acc1' } }))).toBe('invalid_args');
        expect((await call('bot.users.get', { userId: U }, { groups: ['bot-read'], args: { principal: 'service' } }) as any).status).toBe(200);
        expect(seen.length).toBe(1);
    });

    it('ids con traversal o formato invalido se rechazan antes de llamar (invalid_args)', async () => {
        for (const [action, params] of [
            ['bot.guilds.get', { guildId: '../../users/@me' }], ['bot.guilds.get', { guildId: `${G1}/channels` }], ['bot.channels.get', { channelId: '%2e%2e' }],
            ['bot.channels.get', { channelId: '123' }], ['bot.messages.get', { channelId: C1, messageId: `${M}?x=1` }], ['bot.users.get', { userId: '@me' }],
            ['bot.reactions.add', { channelId: C1, messageId: M, emoji: '../x' }], ['bot.messages.list', { channelId: C1, limit: 101 }], ['bot.members.list', { guildId: G1, limit: 201 }],
            ['bot.messages.send', { channelId: C1, content: 'x'.repeat(2001) }], ['bot.messages.send', { channelId: C1, content: 'x', allowed_mentions: { parse: ['everyone'] } }],
            ['bot.messages.send', { channelId: C1, content: 'x', flags: 4 }], ['bot.guilds.get', { guildId: G1, extra: 1 }],
        ] as const) expect(await code(call(action, params as any))).toBe('invalid_args');
        expect(seen.length).toBe(0);
    });

    it('acciones desconocidas o que no son del bot no usan la credencial bot', async () => {
        await oauthReady();
        expect(await code(call('bot.nope', {}))).toBe('invalid_args');
        expect(await code(call('guilds.get', { guildId: G1 }))).toBe('invalid_args');
    });

    it('emoji unicode y personalizado: se codifica como segmento de ruta', async () => {
        await call('bot.reactions.add', { channelId: C1, messageId: M, emoji: '👍' });
        await call('bot.reactions.add', { channelId: C1, messageId: M, emoji: 'party:123456789012345678' });
        const urls = seen.filter((s) => s.method === 'PUT').map((s) => s.url);
        expect(urls[0]).toContain(`/reactions/${encodeURIComponent('👍')}/@me`);
        expect(urls[1]).toContain('/reactions/party%3A123456789012345678/@me');
    });
});

describe('servidores permitidos y moderacion', () => {
    it('lista vacia = solo el servidor por defecto; con lista, solo esos; sin ninguno, nada', async () => {
        expect(botPolicy((await getProvider('discord'))!).allowedGuilds).toEqual([G1]);
        expect((await call('bot.guilds.get', { guildId: G1 }) as any).status).toBe(200);
        expect(await code(call('bot.guilds.get', { guildId: G2 }))).toBe('forbidden');
        config.allowedGuildIds = [G2, 'basura'];
        __setExtensionsSource(async () => [manifestExtension('discordlib', config)]);
        expect(await code(call('bot.guilds.get', { guildId: G1 }))).toBe('forbidden');
        expect((await call('bot.guilds.get', { guildId: G2 }) as any).status).toBe(200);
        config.allowedGuildIds = []; config.DISCORD_DEFAULT_GUILD_ID = '';
        __setExtensionsSource(async () => [manifestExtension('discordlib', config)]);
        expect(await code(call('bot.guilds.get', { guildId: G1 }))).toBe('forbidden');
        expect(await code(call('bot.messages.send', { channelId: C1, content: 'x' }))).toBe('forbidden');
        expect(await code(call('bot.guilds.list', {}))).toBe('forbidden');
    });

    it('los canales se resuelven a su servidor (cache): otro servidor y MD se rechazan; la comprobacion no depende del llamador', async () => {
        expect((await call('bot.messages.send', { channelId: C1, content: 'x' }) as any).status).toBe(200);
        expect(await code(call('bot.messages.send', { channelId: C2, content: 'x' }))).toBe('forbidden');
        expect(await code(call('bot.messages.list', { channelId: CDM }))).toBe('forbidden');
        const lookups = seen.filter((s) => s.method === 'GET' && /channels\/\d+$/.test(s.url)).length;
        await call('bot.messages.list', { channelId: C1 });
        expect(seen.filter((s) => s.method === 'GET' && /channels\/\d+$/.test(s.url)).length).toBe(lookups); // C1 en cache
        expect(seen.filter((s) => s.method === 'POST').length).toBe(1);
    });

    it('guilds.list devuelve solo los servidores permitidos', async () => {
        const r: any = await call('bot.guilds.list', {});
        expect(r.data).toEqual([{ id: G1, name: 'uno' }]);
    });

    it('moderacion DESACTIVADA por defecto: kick/ban/roles/borrar se rechazan aunque el grupo este concedido; con el ajuste y servidor permitido se ejecutan', async () => {
        for (const [a, p] of [['bot.members.kick', { guildId: G1, userId: U }], ['bot.members.ban', { guildId: G1, userId: U }], ['bot.roles.add', { guildId: G1, userId: U, roleId: M }], ['bot.messages.remove', { channelId: C1, messageId: M }], ['bot.commands.delete', { commandId: M }]] as const) {
            expect(await code(call(a, p as any))).toBe('forbidden');
        }
        expect(seen.length).toBe(0);
        config.allowModeration = true;
        __setExtensionsSource(async () => [manifestExtension('discordlib', config)]);
        expect((await call('bot.members.kick', { guildId: G1, userId: U }) as any).status).toBe(204);
        expect(seen.at(-1)).toMatchObject({ method: 'DELETE', url: `https://discord.com/api/v10/guilds/${G1}/members/${U}` });
        expect(await code(call('bot.members.kick', { guildId: G2, userId: U }))).toBe('forbidden');
        expect(await code(call('bot.members.kick', { guildId: G1, userId: U }, { groups: ['bot-read', 'bot-write'] }))).toBe('forbidden');
        expect(h.audits.filter((x) => x.event === 'oauth.action').some((x) => x.data.moderation === true)).toBe(true);
        // El ajuste debe ser booleano true: el texto "false"/"no" no activa nada.
        config.allowModeration = 'no';
        __setExtensionsSource(async () => [manifestExtension('discordlib', config)]);
        expect(await code(call('bot.members.kick', { guildId: G1, userId: U }))).toBe('forbidden');
    });

    it('comandos: el Application ID sale del ajuste (nunca de quien llama) y debe ser un segmento seguro', async () => {
        await call('bot.commands.create', { name: 'ping', description: 'Pong' });
        expect(seen.at(-1)!.url).toBe(`https://discord.com/api/v10/applications/${APP}/commands`);
        expect(await code(call('bot.commands.create', { name: 'Ping', description: 'x' }))).toBe('invalid_args');
        expect(await code(call('bot.commands.create', { name: 'ping', description: 'x', applicationId: '1' }))).toBe('invalid_args');
        config.DISCORD_APPLICATION_ID = '../../x';
        __setExtensionsSource(async () => [manifestExtension('discordlib', config)]);
        expect(await code(call('bot.commands.list', {}))).toBe('not_configured');
        config.DISCORD_APPLICATION_ID = '';
        __setExtensionsSource(async () => [manifestExtension('discordlib', config)]);
        expect(await code(call('bot.commands.list', {}))).toBe('not_configured');
    });
});

describe('limites de tasa, cuotas y tamano', () => {
    it('cuota del nucleo (por minuto / por hora de la accion) => rate_limited con retryAfter', async () => {
        limiter = { ok: false, retryAfter: 42 };
        try { await call('bot.messages.send', { channelId: C1, content: 'x' }); expect.unreachable(); } catch (e: any) { expect(e.code).toBe('rate_limited'); expect(e.retryAfter).toBe(42); }
    });

    it('429 con retry_after corto: espera acotada y reintenta UNA vez; si sigue, rate_limited', async () => {
        let n = 0;
        reply = (u) => (/channels\/\d+$/.test(u.pathname) ? json(200, { id: C1, guild_id: G1 }) : ++n === 1 ? json(429, { message: 'You are being rate limited.', retry_after: 0.05, global: false }, { 'retry-after': '1' }) : json(200, { id: M }));
        expect((await call('bot.messages.send', { channelId: C1, content: 'x' }) as any).status).toBe(200);
        expect(n).toBe(2);
        n = 0;
        reply = (u) => (/channels\/\d+$/.test(u.pathname) ? json(200, { id: C1, guild_id: G1 }) : (n++, json(429, { retry_after: 0.01 }, { 'retry-after': '3' })));
        expect(await code(call('bot.messages.edit', { channelId: C1, messageId: M, content: 'y' }))).toBe('rate_limited');
        expect(n).toBe(2);
    });

    it('429 con retry_after largo no espera: rate_limited con retryAfter en segundos', async () => {
        reply = (u) => (/channels\/\d+$/.test(u.pathname) ? json(200, { id: C1, guild_id: G1 }) : json(429, { retry_after: 12.4, global: true }, { 'retry-after': '13' }));
        try { await call('bot.messages.send', { channelId: C1, content: 'x' }); expect.unreachable(); } catch (e: any) { expect(e.code).toBe('rate_limited'); expect(e.retryAfter).toBe(13); }
    });

    it('cabeceras X-RateLimit-Remaining=0: la siguiente llamada al mismo cubo se corta sin salir al proveedor si la espera es larga', async () => {
        reply = (u) => (/channels\/\d+$/.test(u.pathname) ? json(200, { id: C1, guild_id: G1 }) : json(200, { id: M }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '30' }));
        await call('bot.messages.send', { channelId: C1, content: 'a' });
        const before = seen.length;
        try { await call('bot.messages.send', { channelId: C1, content: 'b' }); expect.unreachable(); } catch (e: any) { expect(e.code).toBe('rate_limited'); expect(e.retryAfter).toBeGreaterThan(20); }
        expect(seen.length).toBe(before);
    });

    it('respuesta mayor que maxResponseBytes => quota_exceeded; cuerpo de peticion acotado', async () => {
        reply = (u) => (/channels\/\d+$/.test(u.pathname) ? json(200, { id: C1, guild_id: G1 }) : json(200, [{ content: 'x'.repeat(300_000) }]));
        expect(await code(call('bot.messages.list', { channelId: C1 }))).not.toBe('no-error');
        reply = (u) => (/channels\/\d+$/.test(u.pathname) ? json(200, { id: C1, guild_id: G1 }) : json(200, { x: 'y'.repeat(60_000) }));
        expect(await code(call('bot.messages.send', { channelId: C1, content: 'x' }))).toBe('quota_exceeded');
    });
});

describe('principals, formato del token y regresion', () => {
    it('principals revela el estado del bot (sin valores) solo a quien tiene OAUTH_SHARED', async () => {
        const ask = (shared: boolean) => handleOAuthBridge(noDb, oauthBridgeRequest.parse({ op: 'principals', userId: 'u1', extensionId: 'consumer', grantedGroups: ['bot-read'], sharedAllowed: shared, args: { provider: 'discord' } })) as Promise<any>;
        expect((await ask(true)).bot).toEqual({ configured: true, guilds: 1, moderation: false });
        expect((await ask(false)).bot).toEqual({ configured: false, guilds: 0, moderation: false });
        expect(JSON.stringify(await ask(true))).not.toContain(TOKEN);
    });

    it('al guardar el token por el panel se valida el FORMATO (3 segmentos) y el valor no vuelve en ningun resultado', async () => {
        __setExtensionsSource(async () => [{ ...manifestExtension('discordlib', config), id: 'core-discordlib' }]);
        const bad = await divertOAuthCredentials('core-discordlib', { DISCORD_BOT_TOKEN: 'sin-puntos-' + 'a'.repeat(40) }, 'admin1');
        expect(bad.error).toBe('invalid_credential_format');
        expect(bad.set).toEqual([]);
        for (const t of ['a.b.c', `${TOKEN}\n<script>`, 'x'.repeat(200)]) expect((await divertOAuthCredentials('core-discordlib', { DISCORD_BOT_TOKEN: t }, 'admin1')).error).toBe('invalid_credential_format');
        const NEW = 'ZZk5ODYyMjQ4MzQ3MTkyNTI0OA.Xy9ABC.q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8';
        const ok = await divertOAuthCredentials('core-discordlib', { DISCORD_BOT_TOKEN: `  ${NEW}  ` }, 'admin1');
        expect(ok.error).toBeUndefined();
        expect(ok.set).toEqual(['DISCORD_BOT_TOKEN']);
        expect(JSON.stringify(ok)).not.toContain(NEW);
        await call('bot.users.get', { userId: U });
        expect(seen.at(-1)!.auth).toBe(`Bot ${NEW}`);
        const cleared = await divertOAuthCredentials('core-discordlib', { DISCORD_BOT_TOKEN: null }, 'admin1');
        expect(cleared.removed).toEqual(['DISCORD_BOT_TOKEN']);
        expect(await code(call('bot.users.get', { userId: U }))).toBe('not_configured');
    });

    it('regresion: las acciones OAuth del usuario siguen exigiendo cuenta vinculada y no usan la credencial del bot', async () => {
        await oauthReady();
        const r = await code(call('me', {}, { groups: ['identity'] }));
        expect(r).toBe('not_linked');
        expect(seen.length).toBe(0);
        expect(await code(call('bot.users.get', { userId: U }, { groups: ['identity'] }))).toBe('forbidden');
    });

    it('un proveedor sin botCredential no ofrece acciones bot', async () => {
        await oauthReady();
        const ext = manifestExtension('discordlib', config);
        delete ext.template.oauthProviders[0].botCredential;
        ext.template.oauthProviders[0].actions = ext.template.oauthProviders[0].actions.filter((a: any) => a.credential !== 'bot');
        __setExtensionsSource(async () => [ext]);
        expect(await code(call('bot.users.get', { userId: U }))).toBe('invalid_args');
    });
});
