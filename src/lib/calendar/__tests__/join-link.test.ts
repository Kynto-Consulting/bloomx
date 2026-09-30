import { describe, expect, it } from 'vitest';
import { resolveJoinLink } from '../join-link';
import { conferenceFieldsFor, normalizeSequence, shouldApplyInvite, summarizeKnownState } from '../invite-state';

describe('resolveJoinLink (lector de correo)', () => {
    it('meetUrl de un proveedor reconocido => boton con URL normalizada', () => {
        const r = resolveJoinLink({ meetUrl: 'https://meet.google.com/abc-defg-hij' });
        expect(r).toMatchObject({ kind: 'join', provider: 'google-meet', providerName: 'Google Meet', url: 'https://meet.google.com/abc-defg-hij' });
        expect(resolveJoinLink({ meetUrl: 'https://ACME.zoom.us/j/123456789' })).toMatchObject({ kind: 'join', provider: 'zoom', providerName: 'Zoom', url: 'https://acme.zoom.us/j/123456789' });
        expect(resolveJoinLink({ meetUrl: 'https://teams.microsoft.com/l/meetup-join/xyz' })).toMatchObject({ kind: 'join', providerName: 'Microsoft Teams' });
        expect(resolveJoinLink({ meetUrl: 'https://acme.webex.com/meet/jane' })).toMatchObject({ kind: 'join', providerName: 'Webex' });
        expect(resolveJoinLink({ meetUrl: 'https://meet.jit.si/MiSala' })).toMatchObject({ kind: 'join', providerName: 'Jitsi Meet' });
    });

    it('usa la ubicacion o la descripcion de texto del ICS cuando no hay meetUrl', () => {
        expect(resolveJoinLink({ location: 'https://zoom.us/j/123456789' })).toMatchObject({ kind: 'join', provider: 'zoom' });
        const fromDesc = resolveJoinLink({ description: 'Unete: https://meet.google.com/abc-defg-hij.\nGracias' });
        expect(fromDesc).toMatchObject({ kind: 'join', provider: 'google-meet', url: 'https://meet.google.com/abc-defg-hij' });
    });

    it('sin enlace => none; ubicacion de texto => none', () => {
        expect(resolveJoinLink({})).toEqual({ kind: 'none' });
        expect(resolveJoinLink(null)).toEqual({ kind: 'none' });
        expect(resolveJoinLink({ location: 'Oficina central, piso 3' })).toEqual({ kind: 'none' });
    });

    const notButton = [
        'https://zoom.us.evil.com/j/123456789',
        'https://evilmeet.google.com.attacker.io/abc-defg-hij',
        'https://meet.google.com@evil.com/abc-defg-hij',
        'http://meet.google.com/abc-defg-hij',
        'javascript:alert(1)',
        'https://user:pw@zoom.us/j/123456789',
        'https://mi-sitio.example.org/reunion',
    ];
    for (const url of notButton) {
        it(`NO boton para ${url}: texto plano con aviso`, () => {
            const r = resolveJoinLink({ meetUrl: url });
            expect(r.kind).toBe('unrecognized');
            expect(r.kind === 'unrecognized' && r.text).toBe(url);
        });
    }

    it('una ubicacion tipo URL no reconocida tambien es solo texto', () => {
        expect(resolveJoinLink({ location: 'https://evil.example/zoom.us/j/1' }).kind).toBe('unrecognized');
    });

    it('el texto mostrado se sanea (sin controles) y se acota', () => {
        const r = resolveJoinLink({ meetUrl: 'https://evil.example/\u0000\n' + 'a'.repeat(1000) });
        expect(r.kind).toBe('unrecognized');
        if (r.kind === 'unrecognized') {
            expect(r.text.length).toBeLessThanOrEqual(300);
            // eslint-disable-next-line no-control-regex
            expect(r.text).not.toMatch(/[\u0000-\u001f]/);
        }
    });

    it('un meetUrl no reconocido no impide reconocer otro enlace valido en la ubicacion', () => {
        const r = resolveJoinLink({ meetUrl: 'https://evil.example/x', location: 'https://meet.google.com/abc-defg-hij' });
        expect(r.kind).toBe('join');
    });
});

describe('consistencia de invitaciones (SEQUENCE, cancelacion)', () => {
    it('sin estado previo siempre se aplica', () => {
        expect(shouldApplyInvite('REQUEST', 0, null)).toBe(true);
        expect(shouldApplyInvite('CANCEL', undefined, null)).toBe(true);
    });

    it('una actualizacion con SEQUENCE menor se ignora; igual o mayor se aplica', () => {
        const known = { sequence: 2, cancelled: false };
        expect(shouldApplyInvite('REQUEST', 1, known)).toBe(false);
        expect(shouldApplyInvite('REQUEST', 2, known)).toBe(true);
        expect(shouldApplyInvite('REQUEST', 3, known)).toBe(true);
    });

    it('una invitacion vieja no resucita un evento cancelado; una de SEQUENCE mayor si', () => {
        const known = { sequence: 2, cancelled: true };
        expect(shouldApplyInvite('REQUEST', 0, known)).toBe(false);
        expect(shouldApplyInvite('REQUEST', 2, known)).toBe(false);
        expect(shouldApplyInvite('REQUEST', 3, known)).toBe(true);
    });

    it('una cancelacion antigua se ignora; la de igual o mayor SEQUENCE se aplica', () => {
        const known = { sequence: 3, cancelled: false };
        expect(shouldApplyInvite('CANCEL', 2, known)).toBe(false);
        expect(shouldApplyInvite('CANCEL', 3, known)).toBe(true);
        expect(shouldApplyInvite('CANCEL', 4, known)).toBe(true);
        // Reprocesar la misma cancelacion es idempotente.
        expect(shouldApplyInvite('CANCEL', 3, { sequence: 3, cancelled: true })).toBe(true);
    });

    it('summarizeKnownState usa el mayor SEQUENCE y recuerda si fue cancelacion', () => {
        expect(summarizeKnownState([])).toBeNull();
        expect(summarizeKnownState([{ sequence: 0, method: 'REQUEST' }, { sequence: 2, method: 'REQUEST' }])).toEqual({ sequence: 2, cancelled: false });
        expect(summarizeKnownState([{ sequence: 1, method: 'REQUEST' }, { sequence: 2, method: 'CANCEL' }])).toEqual({ sequence: 2, cancelled: true });
        expect(summarizeKnownState([{ sequence: 2, method: 'CANCEL' }, { sequence: 1, method: 'REQUEST' }])).toEqual({ sequence: 2, cancelled: true });
    });

    it('normalizeSequence tolera basura', () => {
        expect(normalizeSequence('3')).toBe(3);
        expect(normalizeSequence(undefined)).toBe(0);
        expect(normalizeSequence(-1)).toBe(0);
        expect(normalizeSequence('x')).toBe(0);
    });

    it('conferenceFieldsFor solo rellena con enlace reconocido', () => {
        expect(conferenceFieldsFor('https://meet.google.com/abc-defg-hij')).toEqual({ conferenceUrl: 'https://meet.google.com/abc-defg-hij', conferenceProvider: 'google-meet' });
        expect(conferenceFieldsFor('https://zoom.us/j/123456789')).toMatchObject({ conferenceProvider: 'zoom' });
        expect(conferenceFieldsFor('https://acme.webex.com/meet/jane')).toMatchObject({ conferenceProvider: 'custom' });
        expect(conferenceFieldsFor('https://zoom.us.evil.com/j/1')).toEqual({ conferenceUrl: null, conferenceProvider: null });
        expect(conferenceFieldsFor('Sala 3')).toEqual({ conferenceUrl: null, conferenceProvider: null });
        expect(conferenceFieldsFor(null)).toEqual({ conferenceUrl: null, conferenceProvider: null });
    });
});
