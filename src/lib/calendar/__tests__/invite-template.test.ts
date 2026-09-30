import { describe, expect, it } from 'vitest';
import { analyzeMeetLink, getMeetProvider, renderInviteEmailHtml } from '../invite-template.js';
import { analyzeMeetingUrl } from '../../conferencing/hosts';
import { buildAppointmentConfirmationHtml, buildMeetingAnnouncementHtml } from '../email-templates';

const render = (over: Record<string, unknown> = {}) =>
    renderInviteEmailHtml({ type: 'meeting', title: 'Sync', brandName: 'Bloom', ...over });

describe('invite-template: boton Unirse', () => {
    it('https reconocido => boton con el nombre correcto del proveedor', () => {
        const cases: Array<[string, string]> = [
            ['https://meet.google.com/abc-defg-hij', 'Google Meet'],
            ['https://acme.zoom.us/j/123456789', 'Zoom'],
            ['https://teams.microsoft.com/l/meetup-join/xyz', 'Microsoft Teams'],
            ['https://acme.webex.com/meet/jane', 'Webex'],
            ['https://meet.jit.si/MiSala', 'Jitsi Meet'],
        ];
        for (const [url, name] of cases) {
            const html = render({ meetUrl: url });
            expect(html).toContain(`>Unirse a ${name}</a>`);
            expect(html).toContain(`href="${url}"`);
        }
    });

    it('https valido pero de host no reconocido => boton generico con el enlace', () => {
        const html = render({ meetUrl: 'https://reuniones.empresa.pe/sala-1' });
        expect(html).toContain('>Unirse a la reunión</a>');
    });

    it('location https se trata como enlace (compatibilidad con la confirmacion de cita)', () => {
        const html = render({ location: 'https://zoom.us/j/123456789' });
        expect(html).toContain('>Unirse a Zoom</a>');
    });

    const bad = [
        'http://meet.google.com/abc-defg-hij',
        'javascript:alert(1)',
        'https://meet.google.com@evil.com/abc-defg-hij',
        'https://user:pw@zoom.us/j/123',
        'data:text/html,hola',
    ];
    for (const url of bad) {
        it(`sin boton ni href para ${url}: se muestra como texto`, () => {
            const html = render({ meetUrl: url });
            expect(html).not.toContain('>Unirse');
            expect(html).not.toContain('href="javascript');
            expect(html).not.toContain('href="http://meet.google.com');
            expect(html).not.toContain('href="data:');
            expect(html).not.toContain('href="https://meet.google.com@evil.com');
            expect(html).not.toContain('href="https://user:pw@');
            // El texto sigue visible (escapado) en la fila Enlace.
            expect(html).toContain('Enlace');
        });
    }

    it('host falso: zoom.us.evil.com NO se etiqueta como Zoom y evilmeet.google.com.attacker.io NO como Meet', () => {
        const a = render({ meetUrl: 'https://zoom.us.evil.com/j/123456789' });
        expect(a).not.toContain('Unirse a Zoom');
        const b = render({ meetUrl: 'https://evilmeet.google.com.attacker.io/abc-defg-hij' });
        expect(b).not.toContain('Unirse a Google Meet');
        expect(getMeetProvider('https://zoom.us.evil.com/j/1')).toBe('Videollamada');
        expect(getMeetProvider('https://teams.microsoft.com.evil.io/l/meetup-join/x')).toBe('Videollamada');
    });

    it('primaryAction explicita se respeta; una URL insegura NO se dibuja como enlace (ni siquiera "#")', () => {
        const ok = render({ primaryAction: { label: 'Ir', url: 'https://app.example.com/go' } });
        expect(ok).toContain('href="https://app.example.com/go"');
        for (const url of ['javascript:alert(1)', 'data:text/html,x', 'http://evil.example/x', 'https://user:pw@evil.example/']) {
            const html = render({ primaryAction: { label: 'Ir', url } });
            expect(html).not.toContain('>Ir</a>');
            expect(html).not.toContain(`href="${url}"`);
        }
    });
});

describe('invite-template: dial-in, escape y reglas de diseno', () => {
    it('muestra contrasena y numeros de marcacion cuando existen', () => {
        const html = render({
            meetUrl: 'https://zoom.us/j/123456789',
            passcode: '987654',
            dialIn: [{ country: 'US', number: '+1 669 900 6833', code: '123 456 789' }, { number: '+51 1 700 9999' }],
        });
        expect(html).toContain('Contraseña');
        expect(html).toContain('987654');
        expect(html).toContain('Teléfono');
        expect(html).toContain('US: +1 669 900 6833');
        expect(html).toContain('Código 123 456 789');
        expect(html).toContain('+51 1 700 9999');
    });

    it('sin passcode ni dial-in no aparecen esas filas', () => {
        const html = render({ meetUrl: 'https://zoom.us/j/123456789' });
        expect(html).not.toContain('Contraseña');
        expect(html).not.toContain('Teléfono');
    });

    it('escapa HTML en titulo, descripcion, marcacion, organizador y texto del enlace', () => {
        const html = render({
            title: '<script>alert(1)</script>',
            description: '<img src=x onerror=alert(1)>',
            passcode: '<b>1</b>',
            dialIn: [{ country: '<i>', number: '<u>1</u>', code: '"><svg>' }],
            organizer: { email: 'a@b.com', name: '<b>Org</b>' },
            meetUrl: 'http://<script>x</script>.evil/',
        });
        expect(html).not.toContain('<script>');
        expect(html).not.toContain('<img src=x');
        expect(html).not.toContain('<b>1</b>');
        expect(html).not.toContain('<u>1</u>');
        expect(html).not.toContain('<svg>');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    it('mantiene las reglas de diseno: tablas, estilos en linea, sin CSS ni imagenes externas salvo el logo', () => {
        const html = render({ meetUrl: 'https://zoom.us/j/123456789', passcode: '1', dialIn: [{ number: '+1' }] });
        expect(html).toContain('role="presentation"');
        expect(html).toContain('width="600"');
        expect(html).not.toMatch(/<link|@import|<script|<img/i);
        expect(html).toContain('<meta name="color-scheme" content="light dark">');
    });

    it('type "meeting" (anuncio) sigue funcionando por los builders tipados', () => {
        const html = buildMeetingAnnouncementHtml({
            topic: 'Kickoff',
            meetUrl: 'https://meet.google.com/abc-defg-hij',
            passcode: '42',
            dialIn: [{ country: 'PE', number: '+51 1 700 0000' }],
            startsAt: new Date('2030-01-15T15:00:00Z'),
            endsAt: new Date('2030-01-15T16:00:00Z'),
            timezone: 'America/Lima',
        });
        expect(html).toContain('Reunión');
        expect(html).toContain('>Unirse a Google Meet</a>');
        expect(html).toContain('PE: +51 1 700 0000');
    });

    it('confirmacion de cita: boton Unirse solo con https reconocido', () => {
        const common = {
            guestName: 'Ana', guestEmail: 'ana@example.com', hostName: 'Host', hostEmail: 'host@example.com',
            scheduleName: 'Demo', startsAt: new Date('2030-01-15T15:00:00Z'), endsAt: new Date('2030-01-15T16:00:00Z'),
            cancelUrl: 'https://app.example.com/cancel/x', timezone: 'America/Lima',
        };
        const ok = buildAppointmentConfirmationHtml({ ...common, meetUrl: 'https://zoom.us/j/123456789' });
        expect(ok).toContain('Unirse a Zoom');
        expect(ok).toContain('Cancelar cita');
        const spoof = buildAppointmentConfirmationHtml({ ...common, meetUrl: 'https://zoom.us.evil.com/j/123456789' });
        expect(spoof).not.toContain('Unirse a Zoom');
        const none = buildAppointmentConfirmationHtml({ ...common, meetUrl: null });
        expect(none).not.toContain('Unirse');
    });
});

describe('invite-template: paridad con conferencing/hosts', () => {
    const corpus = [
        'https://meet.google.com/abc-defg-hij',
        'https://meet.google.com/lookup/abc123',
        'https://meet.google.com/',
        'https://zoom.us/j/123456789',
        'https://us02web.zoom.us/j/123456789?pwd=abc',
        'https://zoom.us/my/room',
        'https://zoom.us/',
        'https://zoom.us.evil.com/j/123',
        'https://notzoom.us/j/123',
        'https://teams.microsoft.com/l/meetup-join/19%3ameeting',
        'https://teams.live.com/meet/9300',
        'https://acme.webex.com/meet/jane',
        'https://meet.jit.si/MiSala',
        'https://8x8.vc/acme/room',
        'https://example.org/room',
        'http://meet.google.com/abc-defg-hij',
        'https://meet.google.com@evil.com/abc-defg-hij',
        'https://user:pw@zoom.us/j/1',
        'https://zoom.us:8443/j/1',
        'https://zoom.us:443/j/1',
        'https://ZOOM.US/j/1',
        'javascript:alert(1)',
        'ftp://zoom.us/j/1',
        'not a url',
        '',
        '   ',
        'https://localhost/x',
        'https://zoom.us/j/1 extra',
    ];
    for (const raw of corpus) {
        it(`misma decision para ${JSON.stringify(raw)}`, () => {
            const a = analyzeMeetLink(raw);
            const b = analyzeMeetingUrl(raw);
            expect(Boolean(a)).toBe(Boolean(b));
            if (a && b) {
                expect(a.recognized).toBe(b.recognized);
                expect(a.provider).toBe(b.provider);
                expect(a.providerName).toBe(b.providerName);
            }
        });
    }
});
