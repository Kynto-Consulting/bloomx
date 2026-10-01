import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { assertLocalPg, createUser, uid } from '../../__tests__/helpers/pg';
import { prisma } from '../../prisma';
import { isEncrypted } from '../../encryption';
import { invalidateProviderCache } from '../../oauth/providers';

/**
 * Postgres REAL embebido (sin servicios externos): el refresh_token cifrado de Account se descifra en la ruta de
 * creacion de reuniones, el registro ConferenceMeeting da idempotencia/propiedad con concurrencia real y la cuenta
 * Zoom revocada se marca como caida. Google y Zoom se simulan con fetch.
 */

let session: { id: string; email: string } | null = null;
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => session }));

const rawAccount = async (id: string) => (await prisma.$queryRaw<any[]>`SELECT "access_token","refresh_token","expires_at" FROM "Account" WHERE "id" = ${id}`)[0];

const goodMeeting = { joinUrl: 'https://meet.google.com/abc-defg-hij', meetingId: 'spaces/abc', mode: 'google-account' };

beforeAll(() => {
    assertLocalPg();
    vi.stubEnv('GOOGLE_CLIENT_ID', 'cid-test');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'csecret-test');
    vi.stubEnv('GOOGLE_TOKEN_URL', 'http://127.0.0.1:9/google/token');
    vi.stubEnv('ZOOM_CLIENT_ID', 'zid-test');
    vi.stubEnv('ZOOM_CLIENT_SECRET', 'zsecret-test');
    vi.stubEnv('ZOOM_OAUTH_BASE', 'http://127.0.0.1:9/zoom');
    vi.stubEnv('TOP_DOMAIN', 'brand.test');
    for (const m of ['log', 'error', 'warn'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});
afterAll(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
beforeEach(() => { session = null; vi.unstubAllGlobals(); invalidateProviderCache(); });

/**
 * fetch HERMETICO: el registro de proveedores consulta {backend}/api/config (config de GoogleLib) ANTES de refrescar el token. Aqui /api/config se
 * responde en local (404 = sin config -> variables heredadas GOOGLE_*; o la config de GoogleLib) y el resto de llamadas se anotan en `seen`.
 */
function hermeticFetch(opts: { config?: unknown; tokenResponse: unknown; seen: any[] }) {
    return vi.fn(async (url: string, init?: any) => {
        if (String(url).includes('/api/config')) {
            return opts.config === undefined ? new Response('{}', { status: 404 }) : new Response(JSON.stringify(opts.config), { status: 200 });
        }
        opts.seen.push({ url: String(url), body: String(init?.body) });
        return new Response(JSON.stringify(opts.tokenResponse), { status: 200 });
    });
}

const googleLibConfig = (clientId: string) => ({ extensions: [{ id: 'core-googlelib', settings: { config: { GOOGLE_CLIENT_ID: clientId } }, template: JSON.stringify({ id: 'core-googlelib', version: '1.0.0', settingsSchema: { fields: [{ key: 'GOOGLE_CLIENT_ID', type: 'string', label: 'ID' }, { key: 'GOOGLE_CLIENT_SECRET', type: 'string', secret: true, label: 'S' }] }, oauthProviders: [{ id: 'google', displayName: 'Google', authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token', apiBase: 'https://www.googleapis.com', allowedHosts: ['accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com'], scopes: [{ id: 'openid', group: 'userinfo', es: 'a', en: 'a', risk: 'low' }], pkce: true, clientIdSetting: 'GOOGLE_CLIENT_ID', clientSecretCredential: 'GOOGLE_CLIENT_SECRET', redirectPath: '/api/auth/callback/google' }] }) }] });


describe('Account.refresh_token cifrado -> ruta de creacion', () => {
    it('getLinkedAuth descifra el refresh_token, refresca contra Google (texto plano) y re-guarda cifrado', async () => {
        const user = await createUser(prisma);
        const acc = await prisma.account.create({
            data: {
                userId: user.id, type: 'oauth', provider: 'google', providerAccountId: uid('g'),
                access_token: 'OLD-ACCESS', refresh_token: 'RT-plain-123', expires_at: 1, // caducado
                scope: 'openid email https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/meetings.space.created',
            },
        });
        // En BD esta cifrado
        const before = await rawAccount(acc.id);
        expect(isEncrypted(before.refresh_token)).toBe(true);
        expect(before.refresh_token).not.toContain('RT-plain-123');

        const seen: any[] = [];
        // Sin config del proveedor (backend sin GoogleLib): se usan las variables heredadas GOOGLE_* (comportamiento de siempre).
        vi.stubGlobal('fetch', hermeticFetch({ seen, tokenResponse: { access_token: 'NEW-ACCESS', expires_in: 3600, scope: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/meetings.space.created' } }));

        const { getLinkedAuth } = await import('../auth-context');
        const r = await getLinkedAuth(user.id);
        expect(r.auth.google).toMatchObject({ accessToken: 'NEW-ACCESS', accountId: acc.id, source: 'user-account' });
        expect(r.auth.google!.scope).toContain('meetings.space.created');
        // Google recibio el refresh_token DESCIFRADO y el cliente OAuth del frontend
        const tokenCall = seen.find((c) => c.url === 'http://127.0.0.1:9/google/token');
        expect(tokenCall, 'llamada al endpoint de token').toBeTruthy();
        const params = new URLSearchParams(tokenCall.body);
        expect(params.get('refresh_token')).toBe('RT-plain-123');
        expect(params.get('client_id')).toBe('cid-test');
        // y lo guardado sigue cifrado
        const after = await rawAccount(acc.id);
        expect(isEncrypted(after.access_token)).toBe(true);
        expect(isEncrypted(after.refresh_token)).toBe(true);
        expect(after.access_token).not.toContain('NEW-ACCESS');
    });

    it('con la config de GoogleLib en el backend usa SU client id (no el heredado) y sigue descifrando/re-guardando cifrado', async () => {
        const user = await createUser(prisma);
        const acc = await prisma.account.create({
            data: { userId: user.id, type: 'oauth', provider: 'google', providerAccountId: uid('g'), access_token: 'OLD-ACCESS', refresh_token: 'RT-lib-456', expires_at: 1, scope: 'openid https://www.googleapis.com/auth/calendar' },
        });
        const seen: any[] = [];
        vi.stubGlobal('fetch', hermeticFetch({ seen, config: googleLibConfig('cid-from-googlelib'), tokenResponse: { access_token: 'NEW-LIB', expires_in: 3600 } }));
        const { getLinkedAuth } = await import('../auth-context');
        const r = await getLinkedAuth(user.id);
        expect(r.auth.google).toMatchObject({ accessToken: 'NEW-LIB', accountId: acc.id });
        const tokenCall = seen.find((c) => c.url.includes('/google/token'));
        expect(tokenCall).toBeTruthy();
        const params = new URLSearchParams(tokenCall.body);
        expect(params.get('client_id')).toBe('cid-from-googlelib');
        expect(params.get('client_secret')).toBe('csecret-test'); // endpoints oficiales: el secreto heredado sigue valiendo
        expect(params.get('refresh_token')).toBe('RT-lib-456');
        expect(isEncrypted((await rawAccount(acc.id)).refresh_token)).toBe(true);
    });

    it('la ruta POST /google-meet llega a la extension con el access token del PROPIO usuario (nunca el de otro)', async () => {
        const me = await createUser(prisma);
        const other = await createUser(prisma);
        for (const [u, token] of [[me, 'ACCESS-ME'], [other, 'ACCESS-OTHER']] as const) {
            await prisma.account.create({
                data: { userId: u.id, type: 'oauth', provider: 'google', providerAccountId: uid('g'), access_token: token, refresh_token: `RT-${token}`, expires_at: Math.floor(Date.now() / 1000) + 3000, scope: 'https://www.googleapis.com/auth/calendar' },
            });
        }
        const bridgeBodies: any[] = [];
        vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
            if (String(url).endsWith('/api/extension/execute')) {
                bridgeBodies.push({ body: JSON.parse(init.body), headers: init.headers });
                return new Response(JSON.stringify({ success: true, result: goodMeeting }), { status: 200, headers: { 'x-bloomx-auth': 'signed' } });
            }
            throw new Error(`fetch inesperado: ${url}`);
        }));

        session = { id: me.id, email: me.email };
        const { POST } = await import('../../../app/api/calendar/conferencing/[provider]/route');
        const res = await POST(
            new NextRequest('http://brand.test/api/calendar/conferencing/google-meet', {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'idempotency-key': 'pg-route-key-1', 'x-forwarded-for': '10.1.1.1' },
                body: JSON.stringify({ topic: 'Plan' }),
            }),
            { params: Promise.resolve({ provider: 'google-meet' }) },
        );
        expect(res.status).toBe(200);
        expect((await res.json()).meeting.joinUrl).toBe('https://meet.google.com/abc-defg-hij');
        expect(bridgeBodies).toHaveLength(1);
        expect(bridgeBodies[0].body.extensionId).toBe('core-google-meet');
        expect(bridgeBodies[0].body.context.auth.google.accessToken).toBe('ACCESS-ME');
        expect(JSON.stringify(bridgeBodies[0])).not.toContain('ACCESS-OTHER');
        expect(bridgeBodies[0].headers['X-User-ID']).toBe(me.id);

        // Reintento con la misma clave: misma reunion y SIN segunda llamada a la extension
        const again = await POST(
            new NextRequest('http://brand.test/api/calendar/conferencing/google-meet', {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'idempotency-key': 'pg-route-key-1', 'x-forwarded-for': '10.1.1.1' },
                body: JSON.stringify({ topic: 'Plan' }),
            }),
            { params: Promise.resolve({ provider: 'google-meet' }) },
        );
        expect(again.status).toBe(200);
        expect(bridgeBodies).toHaveLength(1);
    });
});

describe('ConferenceMeeting (registro real): idempotencia concurrente y propiedad', () => {
    it('10 peticiones simultaneas con la misma clave crean UNA reunion', async () => {
        const user = await createUser(prisma);
        const actor = { userId: user.id, email: user.email, domain: 'brand.test' };
        let calls = 0;
        const call = async () => {
            calls++;
            await new Promise((r) => setTimeout(r, 50));
            return { ok: true as const, authMode: 'signed' as const, result: { joinUrl: `https://zoom.us/j/${7000 + calls}`, meetingId: String(7000 + calls) } };
        };
        const linked = async () => ({ auth: {}, problems: {} });
        const { createMeeting } = await import('../service');
        const key = `pg-${uid('k')}`.slice(0, 60);
        const results = await Promise.all(Array.from({ length: 10 }, () => createMeeting(actor, 'zoom', { topic: 'x' }, { idempotencyKey: key, deps: { call, linked } })));
        expect(calls).toBe(1);
        expect(new Set(results.map((r) => r.joinUrl)).size).toBe(1);
        const rows = await prisma.conferenceMeeting.findMany({ where: { userId: user.id, idempotencyKey: key } });
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('ready');
    });

    it('propiedad: otro usuario no puede borrar la reunion; el dueno si; tras borrar ya no es suya', async () => {
        const owner = await createUser(prisma);
        const attacker = await createUser(prisma);
        const linked = async () => ({ auth: {}, problems: {} });
        const calls: string[] = [];
        const call = async (init: any) => {
            calls.push(init.action);
            return { ok: true as const, authMode: 'signed' as const, result: init.action === 'createMeeting' ? { joinUrl: 'https://zoom.us/j/424242', meetingId: '424242' } : { deleted: true } };
        };
        const { createMeeting, deleteMeeting } = await import('../service');
        await createMeeting({ userId: owner.id, domain: 'brand.test' }, 'zoom', {}, { deps: { call, linked } });
        await expect(deleteMeeting({ userId: attacker.id, domain: 'brand.test' }, 'zoom', '424242', { call, linked })).rejects.toMatchObject({ code: 'invalid_input' });
        expect(calls).toEqual(['createMeeting']);
        await deleteMeeting({ userId: owner.id, domain: 'brand.test' }, 'zoom', '424242', { call, linked });
        expect(calls).toEqual(['createMeeting', 'deleteMeeting']);
        await expect(deleteMeeting({ userId: owner.id, domain: 'brand.test' }, 'zoom', '424242', { call, linked })).rejects.toMatchObject({ code: 'invalid_input' });
    });

    it('evento con conferenceMeetingId ajeno NO obtiene derechos de borrado (solo manda el registro)', async () => {
        const owner = await createUser(prisma);
        const attacker = await createUser(prisma);
        const { userOwnsMeeting, completeMeeting, claimMeeting } = await import('../ledger');
        const claim = await claimMeeting({ userId: owner.id, provider: 'zoom', idempotencyKey: 'k-own-1234' });
        await completeMeeting((claim as any).id, { userId: owner.id, provider: 'zoom', idempotencyKey: 'k-own-1234' }, { provider: 'zoom', providerName: 'Zoom', joinUrl: 'https://zoom.us/j/99', meetingId: '99' });
        const cal = await prisma.calendar.create({ data: { userId: attacker.id, name: 'c', color: '#000000' } as any });
        await prisma.calendarEvent.create({ data: { userId: attacker.id, calendarId: cal.id, title: 'e', startsAt: new Date(), endsAt: new Date(Date.now() + 3600_000), conferenceProvider: 'zoom', conferenceMeetingId: '99' } as any });
        expect(await userOwnsMeeting(attacker.id, 'zoom', '99')).toBe(false);
        expect(await userOwnsMeeting(owner.id, 'zoom', '99')).toBe(true);
    });

    it('reserva abandonada (pending viejo) se reutiliza; pending reciente espera al resultado', async () => {
        const user = await createUser(prisma);
        const { claimMeeting, PENDING_STALE_MS } = await import('../ledger');
        const a = await claimMeeting({ userId: user.id, provider: 'zoom', idempotencyKey: 'stale-key-001' });
        expect(a.kind).toBe('claimed');
        expect((await claimMeeting({ userId: user.id, provider: 'zoom', idempotencyKey: 'stale-key-001' })).kind).toBe('in_progress');
        await prisma.$executeRaw`UPDATE "ConferenceMeeting" SET "updatedAt" = now() - ${`${PENDING_STALE_MS + 1000} milliseconds`}::interval WHERE "userId" = ${user.id}`;
        expect((await claimMeeting({ userId: user.id, provider: 'zoom', idempotencyKey: 'stale-key-001' })).kind).toBe('claimed');
    });
});

describe('Zoom OAuth de usuario', () => {
    it('refresca con el refresh_token descifrado, guarda el nuevo par cifrado y, si Zoom revoca, marca la cuenta caida', async () => {
        const user = await createUser(prisma);
        const acc = await prisma.account.create({
            data: { userId: user.id, type: 'oauth', provider: 'zoom', providerAccountId: uid('z'), access_token: 'Z-OLD', refresh_token: 'ZRT-1', expires_at: 1, scope: 'meeting:write' },
        });
        const seen: string[] = [];
        let revoke = false;
        vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
            seen.push(String(init?.body));
            if (revoke) return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
            return new Response(JSON.stringify({ access_token: 'Z-NEW', refresh_token: 'ZRT-2', expires_in: 3600, scope: 'meeting:write' }), { status: 200 });
        }));
        const { getZoomAccessToken } = await import('../../zoom/account');
        const t = await getZoomAccessToken(user.id);
        expect(t.accessToken).toBe('Z-NEW');
        expect(new URLSearchParams(seen[0]).get('refresh_token')).toBe('ZRT-1');
        const raw = await rawAccount(acc.id);
        expect(isEncrypted(raw.access_token) && isEncrypted(raw.refresh_token)).toBe(true);
        const fresh = await prisma.account.findUnique({ where: { id: acc.id } });
        expect(fresh!.refresh_token).toBe('ZRT-2'); // token de un solo uso rotado

        // revocado
        await prisma.account.update({ where: { id: acc.id }, data: { expires_at: 1 } });
        revoke = true;
        await expect(getZoomAccessToken(user.id)).rejects.toMatchObject({ code: 'token_revoked' });
        const dead = await prisma.account.findUnique({ where: { id: acc.id } });
        expect(dead!.refresh_token).toBeNull();
        await expect(getZoomAccessToken(user.id)).rejects.toMatchObject({ code: 'token_revoked' });
        // otro usuario sin cuenta: not_connected (no reutiliza la de nadie)
        const stranger = await createUser(prisma);
        await expect(getZoomAccessToken(stranger.id)).rejects.toMatchObject({ code: 'not_connected' });
    });
});
