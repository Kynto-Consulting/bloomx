import { describe, expect, it } from 'vitest';
import { analyzeMeetingUrl, findMeetingUrlInText, meetingProviderName, providerIdForLink, recognizeMeetingUrl, safeConferenceUrl } from '../hosts';
import { apiBase } from '../api-bases';
import { errorBody, parseExtensionError, safeMessage } from '../errors';
import { normalizeMeeting } from '../normalize';
import { effectiveConference } from '../event-fields';
import { ConferencingError, legacyValueFromProvider, providerFromLegacyValue } from '../types';

describe('hosts: validacion de enlaces de reunion', () => {
    it('reconoce Meet, Zoom, Teams, Webex y Jitsi por HOST', () => {
        expect(recognizeMeetingUrl('https://meet.google.com/abc-defg-hij')?.provider).toBe('google-meet');
        expect(recognizeMeetingUrl('https://us02web.zoom.us/j/123456789?pwd=abc')?.provider).toBe('zoom');
        expect(recognizeMeetingUrl('https://empresa.zoom.us/j/1')?.providerName).toBe('Zoom');
        expect(recognizeMeetingUrl('https://teams.microsoft.com/l/meetup-join/19%3ameeting')?.provider).toBe('teams');
        expect(recognizeMeetingUrl('https://empresa.webex.com/meet/alguien')?.provider).toBe('webex');
        expect(recognizeMeetingUrl('https://meet.jit.si/MiSala123')?.provider).toBe('jitsi');
    });

    it('rechaza esquemas no https, credenciales, puertos y control chars', () => {
        for (const bad of [
            'http://meet.google.com/abc-defg-hij',
            'javascript:alert(1)',
            'data:text/html,<b>x</b>',
            'https://user:pass@zoom.us/j/1',
            'https://zoom.us:8443/j/1',
            'https://meet.google.com/abc-defg-hij\r\nX-Evil: 1',
            'https://zoom.us/j/1 onclick=x',
            'mailto:a@b.com',
            '',
            undefined,
            42,
        ]) {
            expect(analyzeMeetingUrl(bad as any)).toBeNull();
        }
    });

    it('suplantacion de host: zoom.us.evil.com, meet.google.com@evil.com, evilzoom.us no se reconocen', () => {
        expect(recognizeMeetingUrl('https://zoom.us.evil.com/j/1')).toBeNull();
        expect(recognizeMeetingUrl('https://evilzoom.us/j/1')).toBeNull();
        expect(recognizeMeetingUrl('https://meet.google.com.attacker.io/abc-defg-hij')).toBeNull();
        expect(analyzeMeetingUrl('https://meet.google.com@evil.com/abc-defg-hij')).toBeNull();
        // https valido de otro host: seguro de mostrar, pero NO reconocido (sin boton de confianza)
        const other = analyzeMeetingUrl('https://zoom.us.evil.com/j/1');
        expect(other).toMatchObject({ recognized: false, provider: 'custom', providerName: 'zoom.us.evil.com' });
    });

    it('forma de ruta: Meet exige codigo abc-defg-hij; Zoom exige /j/ etc.', () => {
        expect(recognizeMeetingUrl('https://meet.google.com/landing')).toBeNull();
        expect(recognizeMeetingUrl('https://zoom.us/')).toBeNull();
        expect(recognizeMeetingUrl('https://zoom.us/signin')).toBeNull();
    });

    it('findMeetingUrlInText extrae el enlace reconocido y limpia puntuacion final', () => {
        expect(findMeetingUrlInText('Unete: https://meet.google.com/abc-defg-hij.')).toBe('https://meet.google.com/abc-defg-hij');
        expect(findMeetingUrlInText('nada https://evil.example/x y https://zoom.us/j/99, gracias')).toBe('https://zoom.us/j/99');
        expect(findMeetingUrlInText('solo texto')).toBeNull();
        expect(findMeetingUrlInText(null)).toBeNull();
    });

    it('providerIdForLink / meetingProviderName / safeConferenceUrl', () => {
        expect(providerIdForLink('https://meet.google.com/abc-defg-hij')).toBe('google-meet');
        expect(providerIdForLink('https://x.zoom.us/j/1')).toBe('zoom');
        expect(providerIdForLink('https://teams.microsoft.com/l/meetup-join/x')).toBe('microsoft-teams');
        expect(providerIdForLink('https://webex.com/meet/x')).toBeNull();
        expect(meetingProviderName('https://empresa.example.org/sala')).toBe('empresa.example.org');
        expect(safeConferenceUrl('https://empresa.example.org/sala')).toBe('https://empresa.example.org/sala');
        expect(safeConferenceUrl('http://empresa.example.org/sala')).toBeNull();
    });
});

describe('api-bases: bases configurables solo para tests/localhost', () => {
    it('sin variable: URL oficial', () => {
        expect(apiBase('ZOOM_API_BASE', {})).toBe('https://api.zoom.us/v2');
        expect(apiBase('GOOGLE_TOKEN_URL', {})).toBe('https://oauth2.googleapis.com/token');
    });
    it('NODE_ENV != production: acepta cualquier base http(s)', () => {
        expect(apiBase('ZOOM_API_BASE', { ZOOM_API_BASE: 'http://127.0.0.1:54340/zoom/v2/', NODE_ENV: 'development' })).toBe('http://127.0.0.1:54340/zoom/v2');
        expect(apiBase('GOOGLE_API_BASE', { GOOGLE_API_BASE: 'https://fake.example.test', NODE_ENV: 'test' })).toBe('https://fake.example.test');
    });
    it('production: solo localhost; un host remoto se ignora (no se puede redirigir el trafico con credenciales)', () => {
        expect(apiBase('ZOOM_API_BASE', { ZOOM_API_BASE: 'https://evil.example/v2', NODE_ENV: 'production' })).toBe('https://api.zoom.us/v2');
        expect(apiBase('GOOGLE_TOKEN_URL', { GOOGLE_TOKEN_URL: 'https://evil.example/token', NODE_ENV: 'production' })).toBe('https://oauth2.googleapis.com/token');
        expect(apiBase('ZOOM_API_BASE', { ZOOM_API_BASE: 'http://localhost:9/v2', NODE_ENV: 'production' })).toBe('http://localhost:9/v2');
        expect(apiBase('ZOOM_API_BASE', { ZOOM_API_BASE: 'http://[::1]:9/v2', NODE_ENV: 'production' })).toBe('http://[::1]:9/v2');
    });
    it('descarta valores invalidos o con credenciales', () => {
        expect(apiBase('ZOOM_API_BASE', { ZOOM_API_BASE: 'no es url', NODE_ENV: 'test' })).toBe('https://api.zoom.us/v2');
        expect(apiBase('ZOOM_API_BASE', { ZOOM_API_BASE: 'ftp://x/y', NODE_ENV: 'test' })).toBe('https://api.zoom.us/v2');
        expect(apiBase('ZOOM_API_BASE', { ZOOM_API_BASE: 'http://u:p@localhost/v2', NODE_ENV: 'test' })).toBe('https://api.zoom.us/v2');
    });
});

describe('errores tipados de extensiones', () => {
    it('parsea "codigo: mensaje [retryAfter=N]"', () => {
        const e = parseExtensionError('rate_limited: Too many requests [retryAfter=30]');
        expect(e).toBeInstanceOf(ConferencingError);
        expect(e.code).toBe('rate_limited');
        expect(e.retryAfter).toBe(30);
        expect(e.message).toBe('Too many requests');
        expect(parseExtensionError('token_revoked: reconnect').code).toBe('token_revoked');
        expect(parseExtensionError('not_connected: connect your account').code).toBe('not_connected');
    });
    it('sin prefijo valido => provider_error; redacta tokens largos y control chars', () => {
        expect(parseExtensionError('Something odd happened').code).toBe('provider_error');
        expect(parseExtensionError('bogus_code: x').code).toBe('provider_error');
        const leaky = safeMessage('fallo con ya29.' + 'A'.repeat(60) + '\r\nX-Inject: 1');
        expect(leaky).not.toMatch(/A{40}/);
        expect(leaky).not.toMatch(/[\r\n]/);
    });
    it('errorBody tiene forma estable', () => {
        expect(errorBody(new ConferencingError('rate_limited', 'slow', { retryAfter: 5 }))).toEqual({ error: { code: 'rate_limited', message: 'slow', retryAfter: 5 } });
    });
});

describe('normalizeMeeting (el resultado de una extension es un dato externo)', () => {
    it('resultado de Zoom', () => {
        const m = normalizeMeeting('zoom', {
            joinUrl: 'https://us02web.zoom.us/j/123?pwd=x',
            hostUrl: 'https://us02web.zoom.us/s/123?zak=tok',
            meetingId: 123,
            passcode: 'abc123',
            dialIn: [{ country: 'PE', number: '+51 1 234 5678' }, { number: '<script>' }],
            topic: 'Sync',
            mode: 'server-to-server',
        });
        expect(m).toMatchObject({ provider: 'zoom', providerName: 'Zoom', meetingId: '123', passcode: 'abc123', mode: 'server-to-server', topic: 'Sync' });
        expect(m.dialIn).toEqual([{ country: 'PE', number: '+51 1 234 5678' }]);
    });
    it('Meet: acepta meetUrl heredado y deduce el id del codigo', () => {
        const m = normalizeMeeting('google-meet', { meetUrl: 'https://meet.google.com/abc-defg-hij' });
        expect(m.meetingId).toBe('abc-defg-hij');
        expect(m.joinUrl).toBe('https://meet.google.com/abc-defg-hij');
    });
    it('enlace invalido => provider_error; host del anfitrion invalido se descarta; modo desconocido se ignora', () => {
        expect(() => normalizeMeeting('zoom', { joinUrl: 'javascript:alert(1)' })).toThrowError(ConferencingError);
        expect(() => normalizeMeeting('zoom', {})).toThrowError(/invalid meeting link/);
        const m = normalizeMeeting('zoom', { joinUrl: 'https://zoom.us/j/1', hostUrl: 'http://evil', mode: 'rooted' }, 'user-oauth');
        expect(m.hostUrl).toBeNull();
        expect(m.mode).toBe('user-oauth');
    });
    it('adjunto ICS: solo text/calendar base64 acotado', () => {
        const ok = normalizeMeeting('zoom', { joinUrl: 'https://zoom.us/j/1', attachment: { filename: 'a/b:c.ics', mimeType: 'text/calendar;charset=utf-8', contentBase64: 'QkVHSU46VkNBTEVOREFS' } });
        expect(ok.attachment?.filename).toBe('a_b_c.ics');
        expect(normalizeMeeting('zoom', { joinUrl: 'https://zoom.us/j/1', attachment: { filename: 'x.exe', mimeType: 'application/octet-stream', contentBase64: 'QQ==' } }).attachment).toBeUndefined();
        expect(normalizeMeeting('zoom', { joinUrl: 'https://zoom.us/j/1', attachment: { filename: 'x.ics', mimeType: 'text/calendar', contentBase64: '!!!' } }).attachment).toBeUndefined();
    });
});

describe('compatibilidad de datos', () => {
    it('effectiveConference deriva el enlace de location en eventos antiguos', () => {
        expect(effectiveConference({ location: 'https://meet.google.com/abc-defg-hij' })).toEqual({ conferenceUrl: 'https://meet.google.com/abc-defg-hij', conferenceProvider: 'google-meet' });
        expect(effectiveConference({ location: 'Sala 3, piso 2' })).toEqual({ conferenceUrl: null, conferenceProvider: null });
        expect(effectiveConference({ location: 'x', conferenceUrl: 'https://x.zoom.us/j/1', conferenceProvider: 'zoom' })).toEqual({ conferenceUrl: 'https://x.zoom.us/j/1', conferenceProvider: 'zoom' });
        // columna corrupta (no https): se ignora y se deriva de location
        expect(effectiveConference({ location: 'https://x.zoom.us/j/9', conferenceUrl: 'javascript:1' }).conferenceUrl).toBe('https://x.zoom.us/j/9');
    });
    it('valores historicos de AppointmentSchedule.conferencing', () => {
        expect(providerFromLegacyValue('meet')).toBe('google-meet');
        expect(providerFromLegacyValue('zoom')).toBe('zoom');
        expect(providerFromLegacyValue(null)).toBeNull();
        expect(legacyValueFromProvider('google-meet')).toBe('meet');
        expect(legacyValueFromProvider('zoom')).toBe('zoom');
        expect(legacyValueFromProvider('custom')).toBe('custom');
        // Teams no es un valor historico de las citas: no se mapea ni en un sentido ni en el otro
        expect(legacyValueFromProvider('microsoft-teams')).toBeNull();
        expect(providerFromLegacyValue('microsoft-teams')).toBeNull();
        expect(providerFromLegacyValue('teams')).toBeNull();
    });
});

describe('registro: Microsoft Teams', () => {
    it('esta registrado con su extension, nombre e icono, sin alterar zoom/meet/custom', async () => {
        const t = await import('../types');
        expect(t.CONFERENCING_PROVIDER_IDS).toEqual(['google-meet', 'zoom', 'microsoft-teams', 'custom']);
        expect(t.isConferencingProviderId('microsoft-teams')).toBe(true);
        expect(t.isConferencingProviderId('teams')).toBe(false);
        expect(t.PROVIDER_INFO['microsoft-teams']).toEqual({ id: 'microsoft-teams', name: 'Microsoft Teams', icon: 'microsoft-teams', extensionId: 'core-microsoft-teams' });
        expect(t.PROVIDER_INFO.zoom.extensionId).toBe('core-zoom');
        expect(t.PROVIDER_INFO['google-meet'].extensionId).toBe('core-google-meet');
        expect(t.PROVIDER_INFO.custom.extensionId).toBeNull();
    });
    it('enlaces de union: hosts validos e invalidos', () => {
        for (const u of ['https://teams.microsoft.com/l/meetup-join/19%3ameeting', 'https://teams.live.com/meet/9876543210', 'https://gov.teams.microsoft.com/l/meetup-join/x']) {
            expect(recognizeMeetingUrl(u)?.provider).toBe('teams');
        }
        for (const u of ['http://teams.microsoft.com/l/meetup-join/x', 'https://teams.microsoft.com.evil.com/l/meetup-join/x', 'https://evilteams.microsoft.com.example/meet/1', 'https://teams.microsoft.com/otra/ruta', 'https://u:p@teams.microsoft.com/l/meetup-join/x']) {
            expect(recognizeMeetingUrl(u)).toBeNull();
        }
    });
    it('normaliza el resultado de la extension y rechaza enlaces ajenos', async () => {
        const { normalizeMeeting } = await import('../normalize');
        const m = normalizeMeeting('microsoft-teams', { joinUrl: 'https://teams.microsoft.com/l/meetup-join/19%3ax', meetingId: 'AAMk', mode: 'microsoft-account' });
        expect(m).toMatchObject({ provider: 'microsoft-teams', providerName: 'Microsoft Teams', meetingId: 'AAMk', mode: 'microsoft-account' });
        expect(() => normalizeMeeting('microsoft-teams', { joinUrl: 'javascript:alert(1)' })).toThrow(/invalid meeting link/);
    });
});
