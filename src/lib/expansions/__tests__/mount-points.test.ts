import { describe, expect, it } from 'vitest';
import { buildMountContext, MOUNT_POINT_CONTEXT } from '../context';
import { KNOWN_MOUNT_POINTS } from '../manifest-schema';

const FORBIDDEN = { auth: { google: 'tok' }, user: { id: 'u' }, env: { KEY: 'v' }, services: { mail: {} }, extension: { id: 'x' }, onClose: () => 1 };
const has = (ctx: any, key: string) => JSON.stringify(ctx).includes(`"${key}"`);

describe('MOUNT_POINT_CONTEXT', () => {
    it('documenta todos los puntos nuevos', () => {
        for (const point of ['EMAIL_READER_SIDEBAR', 'EMAIL_LIST_ROW_ACTION', 'CONTEXT_MENU', 'SIDEBAR_PANEL', 'COMPOSER_SIDEBAR', 'COMPOSER_TOOLBAR', 'CALENDAR_TOOLBAR', 'CALENDAR_EVENT_PANEL', 'CONTACTS_TOOLBAR', 'CONTACT_CARD_PANEL', 'SETTINGS_PANEL']) {
            expect(MOUNT_POINT_CONTEXT[point]).toMatchObject({ surface: expect.any(String), description: expect.any(String) });
            expect(Object.keys(MOUNT_POINT_CONTEXT[point].contextKeys).length).toBeGreaterThan(0);
        }
    });
    it('todas las claves documentadas son puntos conocidos', () => {
        for (const point of Object.keys(MOUNT_POINT_CONTEXT)) expect(KNOWN_MOUNT_POINTS).toContain(point);
    });
});

describe('buildMountContext', () => {
    const email = { id: 'e1', from: 'Ana <ana@x.com>', to: 'me@x.com', cc: '', subject: 'Hola', folder: 'inbox', createdAt: '2026-01-02T03:04:05Z', read: false, labels: [{ name: 'work' }], attachments: [{}], content: '<p>Hola <b>mundo</b></p>', htmlKey: 'secret/key' };

    it.each(['EMAIL_READER_SIDEBAR', 'EMAIL_LIST_ROW_ACTION', 'CONTEXT_MENU'])('%s: resumen del correo, emailContent resuelto y fromContact', (point) => {
        const ctx = buildMountContext(point, { ...email, ...FORBIDDEN });
        expect(ctx.email).toEqual({ id: 'e1', from: 'Ana <ana@x.com>', to: 'me@x.com', cc: '', subject: 'Hola', folder: 'inbox', date: '2026-01-02T03:04:05.000Z', isRead: false, labels: ['work'], hasAttachments: true });
        expect(ctx.emailContent).toBe('Hola mundo');
        expect(ctx.fromContact).toMatchObject({ email: 'ana@x.com', firstName: 'Ana' });
        expect(has(ctx, 'htmlKey')).toBe(false);
        for (const key of ['auth', 'user', 'env', 'services', 'extension', 'onClose']) expect(has(ctx, key)).toBe(false);
    });

    it('acepta { email, content } como entrada', () => {
        const ctx = buildMountContext('EMAIL_READER_SIDEBAR', { email: { ...email, content: undefined }, content: '<div>Texto</div>' });
        expect(ctx.emailContent).toBe('Texto');
        expect(ctx.email.id).toBe('e1');
    });

    it('CALENDAR_EVENT_PANEL', () => {
        const ctx = buildMountContext('CALENDAR_EVENT_PANEL', { event: { id: 'v1', title: 'T', startsAt: '2026-05-01T10:00:00Z', endsAt: '2026-05-01T11:00:00Z', externalId: 'g-1', inviteUid: 'u', attendees: [{ email: 'a@x.com', token: 'z' }] }, calendarId: 'c1', isReadOnly: true, ...FORBIDDEN });
        expect(ctx.calendarId).toBe('c1');
        expect(ctx.isReadOnly).toBe(true);
        expect(ctx.event.title).toBe('T');
        expect(has(ctx, 'externalId')).toBe(false);
        expect(has(ctx, 'inviteUid')).toBe(false);
        expect(has(ctx, 'token')).toBe(false);
        expect(has(ctx, 'auth')).toBe(false);
    });

    it('CALENDAR_TOOLBAR y CONTACTS_TOOLBAR', () => {
        const from = new Date('2026-05-01T00:00:00Z');
        expect(buildMountContext('CALENDAR_TOOLBAR', { range: { from, to: '2026-05-31T00:00:00Z' }, view: 'month', isGoogleLinked: true, ...FORBIDDEN }))
            .toEqual({ range: { from: from.toISOString(), to: '2026-05-31T00:00:00.000Z' }, view: 'month', isGoogleLinked: true });
        expect(buildMountContext('CONTACTS_TOOLBAR', { contactCount: 3, isGoogleLinked: false, selectedIds: ['a', 'b'], ...FORBIDDEN }))
            .toEqual({ contactCount: 3, isGoogleLinked: false, selectedIds: ['a', 'b'] });
    });

    it('CONTACT_CARD_PANEL recorta a { id, email, name, notes, source }', () => {
        const ctx = buildMountContext('CONTACT_CARD_PANEL', { contact: { id: 'c', email: 'a@x.com', name: 'A', notes: 'n', source: 'local', externalId: 'g' } });
        expect(ctx).toEqual({ contact: { id: 'c', email: 'a@x.com', name: 'A', notes: 'n', source: 'local' } });
    });

    it('SIDEBAR_PANEL y SETTINGS_PANEL', () => {
        expect(buildMountContext('SIDEBAR_PANEL', { folder: 'inbox', unreadCounts: { inbox: 2 }, ...FORBIDDEN })).toEqual({ folder: 'inbox', unreadCounts: { inbox: 2 } });
        const settings = buildMountContext('SETTINGS_PANEL', { extensionId: 'x', settings: { theme: 'dark' }, ...FORBIDDEN });
        expect(settings).toEqual({ extensionId: 'x', settings: { theme: 'dark' } });
    });

    it('composer: conserva el contexto existente (emailContent, subject...) y callbacks del anfitrion', () => {
        const insert = () => 1;
        const composer = { emailContent: 'cuerpo', subject: 's', to: ['a@x.com'], insertContent: insert };
        const ctx = buildMountContext('COMPOSER_SIDEBAR', composer);
        expect(ctx.emailContent).toBe('cuerpo');
        expect(ctx.insertContent).toBe(insert);
    });

    it('puntos previos se comportan como buildReadingContext; entradas raras no lanzan', () => {
        expect(buildMountContext('CALENDAR_HEADER', { isGoogleLinked: true })).toEqual({ isGoogleLinked: true });
        for (const point of Object.keys(MOUNT_POINT_CONTEXT)) {
            expect(() => buildMountContext(point, null)).not.toThrow();
            expect(() => buildMountContext(point, 'x')).not.toThrow();
        }
    });
});
