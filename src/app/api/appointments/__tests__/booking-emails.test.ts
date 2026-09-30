/**
 * Correos de citas: el aviso al anfitrion y la cancelacion al anfitrion salen de la MISMA plantilla que la confirmacion
 * al invitado (marca de la empresa + idioma correcto). Resend y la BD estan simulados: no se envia nada real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const LOGO = 'https://cdn.acme.example/logo.png';

const h = vi.hoisted(() => ({
    send: vi.fn(async (_message: Record<string, unknown>) => ({ data: { id: 'msg_1' }, error: null })),
    prisma: {} as any,
}));

vi.mock('@/lib/resend', () => ({ resend: { emails: { send: h.send } } }));
vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }));
vi.mock('@/lib/storage', () => ({ uploadToStorage: vi.fn(async () => undefined) }));
vi.mock('@/lib/calendar/defaults', () => ({ ensureDefaultCalendars: vi.fn(async () => [{ id: 'cal1', source: 'local', isReadOnly: false }]) }));
vi.mock('@/lib/conferencing/service', () => ({ createMeeting: vi.fn(), deleteMeeting: vi.fn(async () => undefined) }));
vi.mock('@/lib/conferencing/http', () => ({ resolveDomain: () => 'acme.example' }));
vi.mock('@/lib/expansions/server-hooks', () => ({ buildAppointmentBookedContext: () => ({}), fireLifecycleHook: vi.fn() }));
vi.mock('@/lib/security', async () => {
    const actual = await vi.importActual<typeof import('@/lib/security')>('@/lib/security');
    return { ...actual, rateLimitAsync: vi.fn(async () => ({ ok: true, retryAfter: 0, backend: 'memory' })), getClientIp: () => '203.0.113.9' };
});
vi.mock('@/lib/appointments/slots', async () => {
    const actual = await vi.importActual<typeof import('@/lib/appointments/slots')>('@/lib/appointments/slots');
    return { ...actual, isBookableSlot: () => true, hasConflict: () => false };
});

import { NextRequest } from 'next/server';
import { signCancelToken } from '@/lib/appointments/cancel-token';
import { POST as book } from '../book/[scheduleId]/route';
import { POST as cancel } from '../book/[scheduleId]/cancel/route';

const domainConfig = (landing: Record<string, unknown> = {}) => ({
    config: {
        name: 'mail.acme.example',
        displayName: 'Acme Corp',
        theme: { primaryColor: '#7c3aed', landing: { logo: { light: LOGO }, footer: { text: 'Av. Principal 123' }, ...landing } },
    },
});

const fetchMock = vi.fn();
function stubDomain(body: unknown | null) {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => (body ? { ok: true, json: async () => body } : { ok: false, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);
}

const schedule = {
    id: 's1', name: 'Demo de producto', duration: 30, timezone: 'America/Lima', conferencing: null, availability: [],
    user: { id: 'u1', name: 'Laura Gómez', email: 'laura@acme.example' },
};

function mockPrisma() {
    const tx = {
        $executeRaw: vi.fn(async () => 0),
        calendarEvent: { findMany: vi.fn(async () => []), create: vi.fn(async () => ({ id: 'ev1' })) },
        appointmentBooking: {
            findMany: vi.fn(async () => []),
            create: vi.fn(async ({ data }: any) => ({ ...data })),
        },
    };
    Object.assign(h.prisma, {
        appointmentSchedule: { findFirst: vi.fn(async () => schedule) },
        calendarEvent: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null), deleteMany: vi.fn(async () => ({ count: 0 })) },
        appointmentBooking: { findMany: vi.fn(async () => []) },
        email: { create: vi.fn(async () => ({})) },
        $transaction: vi.fn(async (fn: any) => fn(tx)),
    });
}

function bookRequest(headers: Record<string, string> = {}, body: Record<string, unknown> = {}) {
    return new NextRequest('https://mail.acme.example/api/appointments/book/s1', {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: 'mail.acme.example', ...headers },
        body: JSON.stringify({
            guestName: 'Ana Torres', guestEmail: 'ana@example.com', startsAt: '2030-01-15T15:00:00.000Z',
            guestNotes: 'Quiero ver la <b>integración</b>\r\nBcc: evil@example.com', ...body,
        }),
    });
}

const params = { params: Promise.resolve({ scheduleId: 's1' }) };
const sent = () => h.send.mock.calls.map((c) => c[0] as any);
const sentTo = (to: string) => sent().find((m) => m.to.includes(to));
const normalize = (s: string) => s.replace(/\u202f/g, ' ').replace(/\u00a0/g, ' ');

beforeEach(() => {
    process.env.TOP_DOMAIN = 'mail.acme.example';
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://backend.test';
    process.env.NEXT_PUBLIC_APP_URL = 'https://mail.acme.example';
    h.send.mockClear();
    mockPrisma();
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.TOP_DOMAIN; });

describe('POST /api/appointments/book: invitado y anfitrion salen de la plantilla con marca', () => {
    it('empresa con logo, color e idioma en: ambos correos en ingles, con la marca y sin el diseno paralelo antiguo', async () => {
        stubDomain(domainConfig({ locale: 'en' }));
        const res = await book(bookRequest({ 'accept-language': 'en-US,en;q=0.9' }), params);
        expect(res.status).toBe(201);
        await vi.waitFor(() => expect(h.send).toHaveBeenCalledTimes(2));

        const guest = sentTo('ana@example.com');
        const host = sentTo('laura@acme.example');
        expect(guest.subject).toBe('Confirmed: Demo de producto');
        expect(host.subject).toBe('New booking: Ana Torres — Demo de producto');

        for (const mail of [guest, host]) {
            expect(mail.html).toContain(`<img src="${LOGO}" alt="Acme Corp"`);
            expect(mail.html).toContain('#7c3aed');
            expect(mail.html).toContain('Av. Principal 123');
            expect(mail.html).toContain('<html lang="en"');
            expect(mail.html).toContain('role="presentation"');
            expect(mail.attachments[0].filename).toBe('demo-de-producto.ics');
            expect(mail.text).toBeTruthy();
        }
        // Aviso al anfitrion: misma plantilla, no el bloque verde propio ni el texto fijo en ingles.
        expect(host.html).not.toContain('#16a34a');
        expect(host.html).not.toContain('NEW BOOKING');
        expect(host.html).toContain('>New booking<');
        expect(host.html).toContain('has booked an appointment with you');
        expect(host.html).toContain('href="mailto:ana@example.com"');
        expect(host.html).not.toContain('Cuándo');
        // Notas del invitado: escapadas, sin inyeccion de HTML ni de cabeceras.
        expect(host.html).not.toContain('<b>integración</b>');
        expect(host.html).toContain('&lt;b&gt;integración&lt;/b&gt;');
        expect(host.html).not.toMatch(/[\r\n]\s*Bcc:/);
        // Confirmacion al invitado: boton de cancelar localizado y enlace firmado.
        expect(guest.html).toContain('>Cancel appointment</a>');
        expect(guest.html).toMatch(/href="https:\/\/mail\.acme\.example\/book\/s1\/cancel\/bk[0-9a-f]+\.\d+\.[\w-]+"/);
        expect(guest.html).toContain('Your appointment with');
    });

    it('idioma: invitado por Accept-Language, anfitrion por la empresa (es aunque el invitado use en)', async () => {
        stubDomain(domainConfig()); // sin landing.locale
        await book(bookRequest({ 'accept-language': 'en-GB' }), params);
        await vi.waitFor(() => expect(h.send).toHaveBeenCalledTimes(2));
        expect(sentTo('ana@example.com').html).toContain('<html lang="en"');
        expect(sentTo('ana@example.com').subject).toBe('Confirmed: Demo de producto');
        expect(sentTo('laura@acme.example').html).toContain('<html lang="es"');
        expect(sentTo('laura@acme.example').subject).toBe('Nueva reserva: Ana Torres — Demo de producto');
        expect(sentTo('laura@acme.example').html).toContain('>Nueva reserva<');
    });

    it('backend de configuracion caido: marca por defecto (Bloom) y espanol, sin romper la reserva', async () => {
        stubDomain(null);
        const res = await book(bookRequest(), params);
        expect(res.status).toBe(201);
        await vi.waitFor(() => expect(h.send).toHaveBeenCalledTimes(2));
        const host = sentTo('laura@acme.example');
        expect(host.html).toContain('Bloom');
        expect(host.html).toContain('#2563eb');
        expect(host.html).not.toContain('<img');
        expect(host.html).toContain('>Nueva reserva<');
    });

    it('texto plano del anfitrion (snapshot): mismo idioma y datos que el HTML', async () => {
        stubDomain(domainConfig({ locale: 'en' }));
        await book(bookRequest({}, { guestNotes: 'Need the demo' }), params);
        await vi.waitFor(() => expect(h.send).toHaveBeenCalledTimes(2));
        expect(normalize(sentTo('laura@acme.example').text).split('\n')).toMatchInlineSnapshot(`
          [
            "Acme Corp · New booking",
            "Demo de producto",
            "Ana Torres (ana@example.com) has booked an appointment with you.",
            "",
            "When: Tuesday, Jan 15, 2030, 10:00 AM GMT-5 — 10:30 AM",
            "Guest: Ana Torres (ana@example.com)",
            "Notes: Need the demo",
            "",
            "The appointment is already in your calendar; the attached .ics file adds it to other calendars.",
          ]
        `);
    });

    it('HTML del anfitrion (snapshot estructural): filas Cuando / Invitado / Notas', async () => {
        stubDomain(domainConfig({ locale: 'es' }));
        await book(bookRequest({}, { guestNotes: 'Necesito la demo' }), params);
        await vi.waitFor(() => expect(h.send).toHaveBeenCalledTimes(2));
        const html: string = normalize(sentTo('laura@acme.example').html);
        const rows = Array.from(html.matchAll(/<td class="bxm-rule bxm-muted"[^>]*>([^<]+)<\/td>\s*<td class="bxm-rule bxm-ink"[^>]*>([\s\S]*?)<\/td>/g))
            .map((m) => `${m[1]}: ${m[2].replace(/<[^>]+>/g, '').trim()}`);
        expect(rows).toMatchInlineSnapshot(`
          [
            "Cuándo: martes, 15 de ene. de 2030, 10:00 a. m. PET — 10:30 a. m.",
            "Invitado: Ana Torres (ana@example.com)",
            "Notas: Necesito la demo",
          ]
        `);
        expect(html).toContain('Ana Torres (ana@example.com)</strong> ha reservado una cita contigo.');
    });
});

describe('POST /api/appointments/book/[id]/cancel: aviso de cancelacion al anfitrion', () => {
    const startsAt = new Date(Date.now() + 7 * 24 * 3600_000);
    const token = signCancelToken('bk0123456789', startsAt.getTime());
    const booking = {
        id: 'bk0123456789', scheduleId: 's1', status: 'confirmed', cancelToken: token, calendarEventId: null,
        guestName: 'Ana <b>Torres</b>', guestEmail: 'ana@example.com', startsAt, endsAt: new Date(startsAt.getTime() + 1800_000),
        schedule: { name: 'Demo de producto', timezone: 'America/Lima', user: { id: 'u1', name: 'Laura Gómez', email: 'laura@acme.example' } },
    };
    const cancelRequest = () => new NextRequest('https://mail.acme.example/api/appointments/book/s1/cancel', {
        method: 'POST', headers: { 'content-type': 'application/json', host: 'mail.acme.example', 'accept-language': 'es' }, body: JSON.stringify({ token }),
    });

    beforeEach(() => {
        Object.assign(h.prisma.appointmentBooking, {
            findFirst: vi.fn(async () => booking),
            updateMany: vi.fn(async () => ({ count: 1 })),
        });
    });

    it('sale de la plantilla con marca (no un <p> suelto) y en el idioma de la empresa', async () => {
        stubDomain(domainConfig({ locale: 'en' }));
        const res = await cancel(cancelRequest(), params);
        expect(res.status).toBe(200);
        await vi.waitFor(() => expect(h.send).toHaveBeenCalledTimes(1));
        const mail = sent()[0];
        expect(mail.to).toEqual(['laura@acme.example']);
        expect(mail.subject).toBe('Cancelled: Ana <b>Torres</b> — Demo de producto');
        expect(mail.html).toContain('<html lang="en"');
        expect(mail.html).toContain(`<img src="${LOGO}" alt="Acme Corp"`);
        expect(mail.html).toContain('#7c3aed');
        expect(mail.html).toContain('has cancelled their appointment');
        expect(mail.html).toContain('>Cancelled<');
        expect(mail.html).toContain('role="presentation"');
        expect(mail.html.trimStart().startsWith('<!DOCTYPE html>')).toBe(true);
        // El nombre del invitado llega escapado en el HTML.
        expect(mail.html).not.toContain('<b>Torres</b>');
        expect(mail.html).toContain('&lt;b&gt;Torres&lt;/b&gt;');
        expect(mail.text).toContain('has cancelled their appointment');
    });

    it('sin configuracion de empresa: Bloom y espanol', async () => {
        stubDomain(null);
        await cancel(cancelRequest(), params);
        await vi.waitFor(() => expect(h.send).toHaveBeenCalledTimes(1));
        const mail = sent()[0];
        expect(mail.html).toContain('ha cancelado su cita');
        expect(mail.html).toContain('Bloom');
        expect(mail.subject.startsWith('Cancelada: ')).toBe(true);
    });
});
