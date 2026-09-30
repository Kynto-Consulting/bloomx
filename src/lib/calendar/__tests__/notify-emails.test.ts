/**
 * sendEventInvites (invitaciones del servidor) y respuesta RSVP: HTML, texto y asunto salen de la plantilla unica con la
 * marca y el idioma correctos. Resend, BD y storage simulados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const LOGO = 'https://cdn.acme.example/logo.png';
const h = vi.hoisted(() => ({
    send: vi.fn(async (_m: Record<string, unknown>) => ({ data: { id: 'm1' }, error: null })),
    prisma: {
        calendarAttendee: { updateMany: vi.fn(async () => ({ count: 1 })) },
        email: { create: vi.fn(async () => ({})) },
    },
}));
vi.mock('@/lib/resend', () => ({ resend: { emails: { send: h.send } } }));
vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }));
vi.mock('@/lib/storage', () => ({ uploadToStorage: vi.fn(async () => undefined) }));

import { sendEventInvites } from '../notify';
import { getEmailBrand } from '../email-brand';

const event = {
    id: 'ev1', title: 'Revisión <b>Q1</b>', description: 'Traer datos', location: 'https://meet.google.com/abc-defg-hij',
    startsAt: new Date('2030-01-15T15:00:00Z'), endsAt: new Date('2030-01-15T16:00:00Z'),
    attendees: [{ email: 'ana@example.com', name: 'Ana', isOrganizer: false }],
};
const base = { userId: 'u1', userEmail: 'laura@acme.example', userName: 'Laura', event, recipients: ['ana@example.com'], timezone: 'America/Lima' };
const brand = getEmailBrand({ name: 'mail.acme.example', displayName: 'Acme', theme: { primaryColor: '#7c3aed', landing: { logo: { light: LOGO } } } });
const lastMail = () => h.send.mock.calls.at(-1)![0] as any;

beforeEach(() => { h.send.mockClear(); vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) }))); });
afterEach(() => vi.unstubAllGlobals());

describe('sendEventInvites', () => {
    it('HTML, texto y asunto en el idioma pedido, con la marca de la empresa', async () => {
        expect(await sendEventInvites({ ...base, brand, locale: 'en' })).toBe(1);
        const mail = lastMail();
        expect(mail.subject).toBe('Invitation: Revisión <b>Q1</b>');
        expect(mail.html).toContain('<html lang="en"');
        expect(mail.html).toContain(`<img src="${LOGO}" alt="Acme"`);
        expect(mail.html).toContain('#7c3aed');
        expect(mail.html).toContain('>Join Google Meet</a>');
        expect(mail.html).toContain('has invited you to this event');
        expect(mail.html).not.toContain('<b>Q1</b>');
        expect(mail.text).toContain('has invited you to this event');
        expect(mail.text).toContain('When: ');
        expect(mail.text).toContain('Organizer: Laura (laura@acme.example)');
        expect(mail.html).not.toMatch(/Cuándo|Invitación/);
    });

    it('sin marca ni idioma: Bloom en espanol (comportamiento previo)', async () => {
        await sendEventInvites({ ...base });
        const mail = lastMail();
        expect(mail.subject.startsWith('Invitación: ')).toBe(true);
        expect(mail.html).toContain('<html lang="es"');
        expect(mail.html).toContain('Bloom');
        expect(mail.text).toContain('Cuándo: ');
    });

    it('con `request`: resuelve marca e idioma de la peticion (dominio, cookie de idioma)', async () => {
        const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ config: { name: 'mail.acme.example', displayName: 'Acme', theme: { primaryColor: '#7c3aed', landing: { logo: { light: LOGO }, locale: 'es' } } } }) }));
        vi.stubGlobal('fetch', fetchMock);
        const request = new Request('https://mail.acme.example/api/calendar/events', { headers: { host: 'mail.acme.example', cookie: 'bloomx-lang=en' } });
        await sendEventInvites({ ...base, request });
        const mail = lastMail();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(mail.html).toContain(`alt="Acme"`);
        expect(mail.html).toContain('<html lang="en"'); // la preferencia del usuario (cookie) gana sobre landing.locale
    });

    it('no envia a nadie si no hay destinatarios validos ni organizador', async () => {
        expect(await sendEventInvites({ ...base, recipients: ['laura@acme.example'] })).toBe(0);
        expect(await sendEventInvites({ ...base, userEmail: null })).toBe(0);
        expect(h.send).not.toHaveBeenCalled();
    });
});
