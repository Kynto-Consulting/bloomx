import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    buildAppointmentBookedContext,
    buildCalendarEventContext,
    buildComposeOpenedContext,
    buildContactDeletedContext,
    buildContactSavedContext,
    buildEmailOpenedContext,
    buildEmailSentContext,
    fireLifecycleHook,
    shouldFireOnce,
} from '../server-hooks';
import { rateLimitReset } from '@/lib/security';
import { generateEd25519KeyPair } from '@/lib/bloomx-signature';

const ok = () => ({ ok: true, status: 200, json: async () => ({ results: [] }) }) as any;
const savedEnv = { ...process.env };
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
    delete process.env.EXTENSION_HOOKS_DISABLED;
    delete process.env.BLOOMX_DOMAIN_PRIVATE_KEY;
    vi.spyOn(console, 'error').mockImplementation(() => { });
});
afterEach(() => {
    process.env = { ...savedEnv };
    vi.restoreAllMocks();
});

describe('constructores de contexto minimo', () => {
    it('EMAIL_OPENED: solo emailId, folder, fromEmail (sin nombre) e isRead', () => {
        expect(buildEmailOpenedContext({ emailId: 'e1', folder: 'inbox', from: 'Ana Perez <ANA@X.com>', isRead: true, subject: 'secreto' } as any))
            .toEqual({ emailId: 'e1', folder: 'inbox', fromEmail: 'ana@x.com', isRead: true });
    });
    it('EMAIL_SENT: solo conteos; sin asunto, cuerpo ni destinatarios', () => {
        const ctx = buildEmailSentContext({ emailId: 'e', to: ['a@x.com', 'b@x.com'], cc: ['c@x.com'], bcc: [], hasAttachments: true, sentAt: new Date('2026-01-01T00:00:00Z'), subject: 's', html: 'h' } as any);
        expect(ctx).toEqual({ emailId: 'e', toCount: 2, ccCount: 1, bccCount: 0, hasAttachments: true, sentAt: '2026-01-01T00:00:00.000Z' });
        expect(JSON.stringify(ctx)).not.toContain('@');
    });
    it('COMPOSE_OPENED: modo validado y ids opcionales', () => {
        expect(buildComposeOpenedContext({ mode: 'hack' })).toEqual({ mode: 'new' });
        expect(buildComposeOpenedContext({ mode: 'reply', inReplyToEmailId: 'e1', draftId: 'd1' })).toEqual({ mode: 'reply', inReplyToEmailId: 'e1', draftId: 'd1' });
    });
    it('CALENDAR_EVENT_*: lista blanca y attendeeCount; sin titulo ni asistentes', () => {
        const ctx = buildCalendarEventContext({ eventId: 'v', calendarId: 'c', startsAt: '2026-05-01T10:00:00Z', endsAt: new Date('2026-05-01T11:00:00Z'), allDay: false, status: 'confirmed', attendees: [{ email: 'a@x.com' }], source: 'local', title: 'T', description: 'D' } as any);
        expect(ctx).toEqual({ eventId: 'v', calendarId: 'c', startsAt: '2026-05-01T10:00:00.000Z', endsAt: '2026-05-01T11:00:00.000Z', allDay: false, status: 'confirmed', attendeeCount: 1, source: 'local' });
    });
    it('CONTACT_SAVED/DELETED y APPOINTMENT_BOOKED', () => {
        expect(buildContactSavedContext({ contactId: 'c', email: 'A@X.com', created: true, source: 'local', notes: 'n' } as any)).toEqual({ contactId: 'c', email: 'a@x.com', created: true, source: 'local' });
        expect(buildContactDeletedContext({ contactId: 'c' })).toEqual({ contactId: 'c' });
        expect(buildAppointmentBookedContext({ bookingId: 'b', scheduleId: 's', startsAt: '2026-05-01T10:00:00Z', endsAt: '2026-05-01T11:00:00Z', guestEmail: 'G <g@x.com>', guestName: 'G', calendarEventId: 'ev' } as any))
            .toEqual({ bookingId: 'b', scheduleId: 's', startsAt: '2026-05-01T10:00:00.000Z', endsAt: '2026-05-01T11:00:00.000Z', guestEmail: 'g@x.com', calendarEventId: 'ev' });
    });
    it('recorta longitudes', () => {
        expect((buildContactDeletedContext({ contactId: 'x'.repeat(500) }).contactId as string)).toHaveLength(100);
    });
});

describe('fireLifecycleHook', () => {
    const withKey = () => { process.env.BLOOMX_DOMAIN_PRIVATE_KEY = generateEd25519KeyPair().privatePem; };

    it('modo legado (sin clave): no-op, no llama a fetch', () => {
        const fetchImpl = vi.fn(ok);
        expect(fireLifecycleHook('CONTACT_DELETED', 'u-legacy', { contactId: 'c' }, { fetchImpl: fetchImpl as any, inline: true })).toBe(false);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('EXTENSION_HOOKS_DISABLED: no-op', () => {
        withKey();
        process.env.EXTENSION_HOOKS_DISABLED = 'true';
        const fetchImpl = vi.fn(ok);
        expect(fireLifecycleHook('CONTACT_DELETED', 'u-dis', { contactId: 'c' }, { fetchImpl: fetchImpl as any, inline: true })).toBe(false);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('llama al backend con evento, contexto y userId FIRMADO (nunca del cuerpo)', async () => {
        withKey();
        const fetchImpl = vi.fn(async () => ok());
        expect(fireLifecycleHook('CONTACT_DELETED', 'u-fire', { contactId: 'c' }, { fetchImpl: fetchImpl as any, backendUrl: 'https://be', host: 'acme.com', inline: true, loadDisabled: async () => [] })).toBe(true);
        await flush();
        const [url, init] = fetchImpl.mock.calls[0] as any;
        expect(url).toBe('https://be/api/extension/hooks');
        expect(JSON.parse(init.body)).toEqual({ event: 'CONTACT_DELETED', context: { contactId: 'c' } });
        expect(init.headers['X-User-ID']).toBe('u-fire');
        expect(init.headers['X-BloomX-Signature']).toBeTruthy();
    });

    it('no lanza ante fallo de red, 5xx ni timeout', async () => {
        withKey();
        const boom = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
        expect(() => fireLifecycleHook('CONTACT_DELETED', 'u-e1', { contactId: 'c' }, { fetchImpl: boom as any, inline: true, loadDisabled: async () => [] })).not.toThrow();
        const five = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }) as any);
        expect(() => fireLifecycleHook('CONTACT_DELETED', 'u-e2', { contactId: 'c' }, { fetchImpl: five as any, inline: true, loadDisabled: async () => [] })).not.toThrow();
        const hang = vi.fn((_u: string, init: any) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('abort'), { name: 'AbortError' })))));
        expect(() => fireLifecycleHook('CONTACT_DELETED', 'u-e3', { contactId: 'c' }, { fetchImpl: hang as any, timeoutMs: 10, inline: true, loadDisabled: async () => [] })).not.toThrow();
        await new Promise((r) => setTimeout(r, 40));
        expect(hang).toHaveBeenCalled();
    });

    it('evento desconocido o sin usuario: no-op', () => {
        withKey();
        expect(fireLifecycleHook('NOPE' as any, 'u', {}, { fetchImpl: vi.fn(ok) as any, inline: true })).toBe(false);
        expect(fireLifecycleHook('CONTACT_DELETED', null, {}, { fetchImpl: vi.fn(ok) as any, inline: true })).toBe(false);
    });

    it('limite por usuario+evento: 60/min', () => {
        withKey();
        rateLimitReset('ext-hook:CONTACT_DELETED:u-rate');
        const fetchImpl = vi.fn(async () => ok());
        let fired = 0;
        for (let i = 0; i < 70; i++) if (fireLifecycleHook('CONTACT_DELETED', 'u-rate', { contactId: 'c' }, { fetchImpl: fetchImpl as any, inline: true })) fired++;
        expect(fired).toBe(60);
    });
});

describe('shouldFireOnce', () => {
    it('dedupe dentro de la ventana y vuelve a permitir despues', () => {
        expect(shouldFireOnce('k1', 1000, 0)).toBe(true);
        expect(shouldFireOnce('k1', 1000, 500)).toBe(false);
        expect(shouldFireOnce('k1', 1000, 1500)).toBe(true);
    });
});
