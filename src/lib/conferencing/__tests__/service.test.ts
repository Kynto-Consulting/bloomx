import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Fachada de conferencias con dobles: registro ConferenceMeeting en memoria (incluye el indice unico -> P2002),
 * extension simulada (`deps.call`), cuentas vinculadas simuladas. Sin BD, red ni servicios reales.
 */

// La primera importacion transforma toda la cadena (prisma, google, bridge...): margen amplio para maquinas lentas.
vi.setConfig({ testTimeout: 60_000 });

type Row = { id: string; userId: string; provider: string; meetingId: string; joinUrl: string; hostUrl: string | null; idempotencyKey: string | null; status: string; payload: any; updatedAt: Date };

let rows: Row[] = [];
let events: Array<{ userId: string; externalId: string }> = [];
let seq = 0;

const dup = () => Object.assign(new Error('Unique constraint'), { code: 'P2002' });
const matches = (r: Row, where: any) =>
    Object.entries(where || {}).every(([k, v]) => {
        if (v && typeof v === 'object' && 'not' in (v as any)) return (r as any)[k] !== (v as any).not;
        return (r as any)[k] === v;
    });

async function setup() {
    vi.resetModules();
    rows = [];
    seq = 0;
    vi.doMock('@/lib/prisma', () => ({
        prisma: {
            conferenceMeeting: {
                create: async ({ data }: any) => {
                    if (data.idempotencyKey && rows.some((r) => r.userId === data.userId && r.provider === data.provider && r.idempotencyKey === data.idempotencyKey)) throw dup();
                    const row: Row = { id: `cm${++seq}`, hostUrl: null, payload: null, idempotencyKey: null, status: 'ready', meetingId: '', joinUrl: '', updatedAt: new Date(), ...data };
                    rows.push(row);
                    return { id: row.id };
                },
                findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
                update: async ({ where, data }: any) => {
                    const r = rows.find((x) => x.id === where.id)!;
                    Object.assign(r, data, { updatedAt: new Date() });
                    return r;
                },
                updateMany: async ({ where, data }: any) => {
                    rows.filter((r) => matches(r, where)).forEach((r) => Object.assign(r, data));
                    return { count: 1 };
                },
                deleteMany: async ({ where }: any) => {
                    const before = rows.length;
                    rows = rows.filter((r) => !matches(r, where));
                    return { count: before - rows.length };
                },
            },
            calendarEvent: { findFirst: async ({ where }: any) => events.find((e) => e.userId === where.userId && e.externalId === where.externalId) ?? null },
        },
    }));
    const service = await import('../service');
    const types = await import('../types');
    return { ...service, ...types };
}

const actor = { userId: 'u1', email: 'u1@brand.com', domain: 'brand.com' };
const zoomOk = { ok: true as const, authMode: 'signed' as const, result: { joinUrl: 'https://us02web.zoom.us/j/555?pwd=p', hostUrl: 'https://us02web.zoom.us/s/555?zak=t', meetingId: 555, passcode: 'pw1', topic: 'Sync', mode: 'server-to-server', attachment: { filename: 'sync.ics', mimeType: 'text/calendar', contentBase64: 'QkVHSU4=' } } };
const linkedNone = async () => ({ auth: {}, problems: { google: 'not_connected' as const, zoom: 'not_connected' as const } });

beforeEach(() => { events = []; vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

describe('createMeeting', () => {
    it('delega en la extension core-zoom con los params saneados y la cuenta Zoom del usuario (no la de Google)', async () => {
        const { createMeeting } = await setup();
        const call = vi.fn(async (_init: any) => zoomOk);
        const linked = async () => ({
            auth: { zoom: { accessToken: 'ZT', accountId: 'a1', source: 'user-account' as const }, google: { accessToken: 'GT', accountId: 'a2', source: 'user-account' as const } },
            problems: {},
        });
        const m = await createMeeting(actor, 'zoom', { topic: '  Sync\r\nX: 1 ', startsAt: '2030-01-01T10:00:00Z', endsAt: '2030-01-01T11:00:00Z', attendees: ['A@x.com', 'bad', 'a@x.com'] }, { idempotencyKey: 'key-12345678', deps: { call, linked } });
        expect(m).toMatchObject({ provider: 'zoom', joinUrl: 'https://us02web.zoom.us/j/555?pwd=p', meetingId: '555', passcode: 'pw1' });
        expect(m.attachment?.filename).toBe('sync.ics');
        const arg = call.mock.calls[0][0] as any;
        expect(arg.extensionId).toBe('core-zoom');
        expect(arg.action).toBe('createMeeting');
        expect(arg.userId).toBe('u1');
        expect(arg.params.topic).toBe('Sync X: 1');
        expect(arg.params.attendees).toEqual(['a@x.com']);
        expect(arg.params.idempotencyKey).toBe('key-12345678');
        // Solo el token del proveedor correspondiente viaja a esa extension
        expect(arg.context.auth).toEqual({ zoom: { accessToken: 'ZT', accountId: 'a1', source: 'user-account' } });
        expect(JSON.stringify(arg)).not.toContain('GT');
    });

    it('IDEMPOTENCIA: misma Idempotency-Key => una sola reunion (reintento y peticiones simultaneas)', async () => {
        const { createMeeting } = await setup();
        let n = 0;
        const call = vi.fn(async () => {
            n++;
            await new Promise((r) => setTimeout(r, 20));
            return { ...zoomOk, result: { ...zoomOk.result, meetingId: 1000 + n, joinUrl: `https://zoom.us/j/${1000 + n}` } };
        });
        const deps = { call, linked: linkedNone };
        const [a, b] = await Promise.all([
            createMeeting(actor, 'zoom', { topic: 'x' }, { idempotencyKey: 'same-key-0001', deps }),
            createMeeting(actor, 'zoom', { topic: 'x' }, { idempotencyKey: 'same-key-0001', deps }),
        ]);
        const c = await createMeeting(actor, 'zoom', { topic: 'x' }, { idempotencyKey: 'same-key-0001', deps });
        expect(call).toHaveBeenCalledTimes(1);
        expect(a.joinUrl).toBe(b.joinUrl);
        expect(c.joinUrl).toBe(a.joinUrl);
        // otra clave u otro usuario => otra reunion
        await createMeeting(actor, 'zoom', { topic: 'x' }, { idempotencyKey: 'other-key-0002', deps });
        await createMeeting({ ...actor, userId: 'u2' }, 'zoom', { topic: 'x' }, { idempotencyKey: 'same-key-0001', deps });
        expect(call).toHaveBeenCalledTimes(3);
    });

    it('si el proveedor falla se libera la clave y el reintento crea la reunion', async () => {
        const { createMeeting } = await setup();
        const call = vi
            .fn()
            .mockResolvedValueOnce({ ok: false, kind: 'rejected', authMode: 'signed', error: new (await import('../types')).ConferencingError('provider_error', 'boom') })
            .mockResolvedValueOnce(zoomOk);
        await expect(createMeeting(actor, 'zoom', {}, { idempotencyKey: 'retry-key-01', deps: { call, linked: linkedNone } })).rejects.toMatchObject({ code: 'provider_error' });
        expect(rows.filter((r) => r.status === 'pending')).toHaveLength(0);
        const m = await createMeeting(actor, 'zoom', {}, { idempotencyKey: 'retry-key-01', deps: { call, linked: linkedNone } });
        expect(m.meetingId).toBe('555');
    });

    it('errores tipados de la extension se propagan (token_revoked, rate_limited con retryAfter, invalid_credentials)', async () => {
        const { createMeeting, ConferencingError } = await setup();
        for (const [code, retryAfter] of [['token_revoked', undefined], ['rate_limited', 30], ['invalid_credentials', undefined], ['not_connected', undefined]] as const) {
            const call = vi.fn(async () => ({ ok: false as const, kind: 'rejected' as const, authMode: 'signed' as const, error: new ConferencingError(code, 'msg', { retryAfter }) }));
            await expect(createMeeting(actor, 'google-meet', {}, { deps: { call, linked: linkedNone } })).rejects.toMatchObject({ code, retryAfter });
        }
    });

    it('resultado con enlace invalido (javascript:) => provider_error y NO queda registrado', async () => {
        const { createMeeting } = await setup();
        const call = vi.fn(async () => ({ ok: true as const, authMode: 'signed' as const, result: { joinUrl: 'javascript:alert(1)', meetingId: 'x' } }));
        await expect(createMeeting(actor, 'zoom', {}, { idempotencyKey: 'bad-link-001', deps: { call, linked: linkedNone } })).rejects.toMatchObject({ code: 'provider_error' });
        expect(rows.filter((r) => r.status === 'ready')).toHaveLength(0);
    });

    it('extension NO instalada + cuenta vinculada => adaptador del host con el token del PROPIO usuario', async () => {
        const { createMeeting } = await setup();
        const call = vi.fn(async () => ({ ok: false as const, kind: 'not_installed' as const, authMode: null, error: new (await import('../types')).ConferencingError('unavailable', 'nope') }));
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ meetingUri: 'https://meet.google.com/abc-defg-hij', name: 'spaces/xyz' }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const linked = async () => ({ auth: { google: { accessToken: 'GOOGLE-USER-TOKEN', accountId: 'a', source: 'user-account' as const } }, problems: {} });
        const m = await createMeeting(actor, 'google-meet', { topic: 't' }, { deps: { call, linked } });
        expect(m.joinUrl).toBe('https://meet.google.com/abc-defg-hij');
        expect((fetchMock.mock.calls[0] as any)[1].headers.Authorization).toBe('Bearer GOOGLE-USER-TOKEN');
        vi.unstubAllGlobals();
    });

    it('extension NO instalada y sin cuenta => not_connected; cuenta caida => token_revoked', async () => {
        const { createMeeting, ConferencingError } = await setup();
        const call = vi.fn(async () => ({ ok: false as const, kind: 'unreachable' as const, authMode: null, error: new ConferencingError('unavailable', 'down') }));
        await expect(createMeeting(actor, 'zoom', {}, { deps: { call, linked: linkedNone } })).rejects.toMatchObject({ code: 'not_connected' });
        const revoked = async () => ({ auth: {}, problems: { zoom: 'token_revoked' as const } });
        await expect(createMeeting(actor, 'zoom', {}, { deps: { call, linked: revoked } })).rejects.toMatchObject({ code: 'token_revoked' });
    });

    it('custom: valida https, sin llamar a nadie; javascript: y http se rechazan', async () => {
        const { createMeeting } = await setup();
        const call = vi.fn();
        const m = await createMeeting(actor, 'custom', { customUrl: 'https://meet.jit.si/MiSala123' }, { deps: { call } });
        expect(m).toMatchObject({ provider: 'custom', joinUrl: 'https://meet.jit.si/MiSala123', mode: 'custom-link' });
        await expect(createMeeting(actor, 'custom', { customUrl: 'javascript:1' }, { deps: { call } })).rejects.toMatchObject({ code: 'invalid_input' });
        await expect(createMeeting(actor, 'custom', { customUrl: 'http://x.com/a' }, { deps: { call } })).rejects.toMatchObject({ code: 'invalid_input' });
        await expect(createMeeting(actor, 'custom', {}, { deps: { call } })).rejects.toMatchObject({ code: 'invalid_input' });
        expect(call).not.toHaveBeenCalled();
    });

    it('fechas: fin <= inicio es invalid_input', async () => {
        const { createMeeting } = await setup();
        await expect(createMeeting(actor, 'zoom', { startsAt: '2030-01-01T11:00:00Z', endsAt: '2030-01-01T10:00:00Z' }, { deps: { call: vi.fn(), linked: linkedNone } })).rejects.toMatchObject({ code: 'invalid_input' });
    });

    it('PROPIEDAD: attachToEventId solo con un evento del propio usuario', async () => {
        const { createMeeting } = await setup();
        events = [{ userId: 'victim', externalId: 'gcal-victim-1' }, { userId: 'u1', externalId: 'gcal-mine-1' }];
        const call = vi.fn(async (_init: any) => ({ ...zoomOk, result: { joinUrl: 'https://meet.google.com/abc-defg-hij', meetingId: 'cal:gcal-mine-1' } }));
        const deps = { call, linked: linkedNone };
        await expect(createMeeting(actor, 'google-meet', { attachToEventId: 'gcal-victim-1' }, { deps })).rejects.toMatchObject({ code: 'invalid_input' });
        expect(call).not.toHaveBeenCalled();
        const ok = await createMeeting(actor, 'google-meet', { attachToEventId: 'gcal-mine-1' }, { deps });
        expect(ok.meetingId).toBe('cal:gcal-mine-1');
        expect((call.mock.calls[0][0] as any).params.attachToEventId).toBe('gcal-mine-1');
        // y solo para Google Meet
        await expect(createMeeting(actor, 'zoom', { attachToEventId: 'gcal-mine-1' }, { deps })).rejects.toMatchObject({ code: 'invalid_input' });
    });
});

describe('deleteMeeting: propiedad estricta', () => {
    it('solo borra reuniones creadas por el propio usuario (en modo instancia el token es de toda la cuenta)', async () => {
        const { createMeeting, deleteMeeting } = await setup();
        const call = vi.fn(async (init: any) => (init.action === 'deleteMeeting' ? { ok: true as const, authMode: 'signed' as const, result: { deleted: true } } : zoomOk));
        const deps = { call, linked: linkedNone };
        await createMeeting(actor, 'zoom', {}, { idempotencyKey: 'own-meeting-1', deps });

        // otro usuario intenta borrar la reunion 555
        await expect(deleteMeeting({ ...actor, userId: 'attacker' }, 'zoom', '555', deps)).rejects.toMatchObject({ code: 'invalid_input' });
        // id inventado
        await expect(deleteMeeting(actor, 'zoom', '999999', deps)).rejects.toMatchObject({ code: 'invalid_input' });
        expect(call.mock.calls.filter((c: any) => c[0].action === 'deleteMeeting')).toHaveLength(0);

        await deleteMeeting(actor, 'zoom', '555', deps);
        const del = call.mock.calls.find((c: any) => c[0].action === 'deleteMeeting')![0] as any;
        expect(del.params).toEqual({ meetingId: '555' });
        expect(rows.find((r) => r.meetingId === '555')!.status).toBe('deleted');
        // ya borrada: no vuelve a ser "suya"
        await expect(deleteMeeting(actor, 'zoom', '555', deps)).rejects.toMatchObject({ code: 'invalid_input' });
    });
});

describe('testConnection', () => {
    it('devuelve modo/detalle y traduce ok:false y errores tipados', async () => {
        const { testConnection, ConferencingError } = await setup();
        const ok = vi.fn(async () => ({ ok: true as const, authMode: 'signed' as const, result: { ok: true, mode: 'server-to-server', detail: 'Cuenta: a@b.com' } }));
        expect(await testConnection(actor, 'zoom', { call: ok, linked: linkedNone })).toEqual({ mode: 'server-to-server', detail: 'Cuenta: a@b.com' });
        const bad = vi.fn(async () => ({ ok: true as const, authMode: 'signed' as const, result: { ok: false, detail: 'invalid client' } }));
        await expect(testConnection(actor, 'zoom', { call: bad, linked: linkedNone })).rejects.toMatchObject({ code: 'provider_error' });
        const typed = vi.fn(async () => ({ ok: false as const, kind: 'rejected' as const, authMode: 'signed' as const, error: new ConferencingError('invalid_credentials', 'bad secret') }));
        await expect(testConnection(actor, 'google-meet', { call: typed, linked: linkedNone })).rejects.toMatchObject({ code: 'invalid_credentials' });
    });
});
