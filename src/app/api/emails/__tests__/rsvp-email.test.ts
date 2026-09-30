/** Respuesta RSVP: el correo al organizador sale de la plantilla unica (marca + idioma), con texto plano y asunto localizados. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const LOGO = 'https://cdn.acme.example/logo.png';
const ICS = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'METHOD:REQUEST', 'BEGIN:VEVENT', 'UID:uid-1@acme', 'DTSTAMP:20300101T000000Z',
    'DTSTART:20300115T150000Z', 'DTEND:20300115T160000Z', 'SUMMARY:Revision Q1', 'LOCATION:Sala 3',
    'ORGANIZER;CN=Laura:mailto:laura@acme.example', 'SEQUENCE:1', 'END:VEVENT', 'END:VCALENDAR',
].join('\r\n');

const h = vi.hoisted(() => ({
    send: vi.fn(async (_m: Record<string, unknown>) => ({ data: { id: 'm1' }, error: null })),
    prisma: {} as any,
}));
vi.mock('@/lib/resend', () => ({ resend: { emails: { send: h.send } } }));
vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }));
vi.mock('@/lib/session', () => ({ getCurrentUser: vi.fn(async () => ({ id: 'u2', email: 'ana@example.com', name: 'Ana <b>T</b>' })) }));
vi.mock('@/lib/storage', () => ({ getFromStorage: vi.fn(async () => ICS) }));
vi.mock('@/lib/calendar/defaults', () => ({ ensureDefaultCalendars: vi.fn(async () => [{ id: 'cal1', source: 'shared' }]) }));

import { NextRequest } from 'next/server';
import { POST } from '../[id]/rsvp/route';

const config = { config: { name: 'mail.acme.example', displayName: 'Acme', theme: { primaryColor: '#7c3aed', landing: { logo: { light: LOGO } } } } };

beforeEach(() => {
    h.send.mockClear();
    Object.assign(h.prisma, {
        email: { findFirst: vi.fn(async () => ({ id: 'e1', subject: 'Invitacion', attachments: [{ key: 'k', filename: 'invite.ics', mimeType: 'text/calendar' }] })) },
        emailEvent: { create: vi.fn(async () => ({})) },
        calendarEvent: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({})), update: vi.fn(async () => ({})) },
        contact: { upsert: vi.fn(async () => ({})) },
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => config })));
});
afterEach(() => vi.unstubAllGlobals());

const call = (response: string, headers: Record<string, string> = {}) => POST(
    new NextRequest('https://mail.acme.example/api/emails/e1/rsvp', { method: 'POST', headers: { 'content-type': 'application/json', host: 'mail.acme.example', ...headers }, body: JSON.stringify({ response }) }),
    { params: Promise.resolve({ id: 'e1' }) },
);

describe('POST /api/emails/[id]/rsvp', () => {
    it('incluye HTML con marca y texto plano en el idioma del usuario (cookie)', async () => {
        const res = await call('declined', { cookie: 'bloomx-lang=en' });
        expect(res.status).toBe(200);
        const mail = h.send.mock.calls[0][0] as any;
        expect(mail.to).toEqual(['laura@acme.example']);
        expect(mail.subject).toBe('Declined: Revision Q1');
        expect(mail.html).toContain('<html lang="en"');
        expect(mail.html).toContain(`<img src="${LOGO}" alt="Acme"`);
        expect(mail.html).toContain('>Declined<');
        expect(mail.html).toContain('has declined your invitation');
        expect(mail.html).toContain('&lt;b&gt;T&lt;/b&gt;');
        expect(mail.html).not.toContain('<b>T</b>');
        expect(mail.text).toContain('has declined your invitation');
        expect(mail.attachments[0].filename).toBe('invite.ics');
    });

    it('sin cookie: idioma de la empresa/navegador, por defecto espanol', async () => {
        await call('accepted', { 'accept-language': 'es-PE' });
        const mail = h.send.mock.calls[0][0] as any;
        expect(mail.subject).toBe('Aceptó: Revision Q1');
        expect(mail.html).toContain('<html lang="es"');
        expect(mail.html).toContain('ha aceptado tu invitación');
    });

    it('respuesta invalida: 400 y no se envia nada', async () => {
        const res = await call('quiza');
        expect(res.status).toBe(400);
        expect(h.send).not.toHaveBeenCalled();
    });
});
