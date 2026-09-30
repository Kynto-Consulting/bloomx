import { describe, expect, it } from 'vitest';
import { buildEventIcs, foldIcsLine, type BuildEventIcsInput } from '../ics-build';
import { parseInviteFromIcs } from '../ics';

const base: BuildEventIcsInput = {
    uid: 'abc123@bloom',
    sequence: 0,
    method: 'REQUEST',
    title: 'Reunion de equipo',
    description: 'Notas',
    location: null,
    startsAt: new Date('2030-01-15T15:00:00Z'),
    endsAt: new Date('2030-01-15T16:00:00Z'),
    organizer: { email: 'host@example.com', name: 'Host' },
    attendees: [{ email: 'guest@example.com', name: 'Guest' }],
    brandName: 'Bloom',
    dtstamp: new Date('2030-01-01T00:00:00Z'),
};

function unfold(ics: string) {
    return ics.replace(/\r\n /g, '');
}
function linesOf(ics: string) {
    return ics.split('\r\n').filter(Boolean);
}
function build(over: Partial<BuildEventIcsInput> = {}) {
    return buildEventIcs({ ...base, ...over });
}

describe('buildEventIcs: estructura', () => {
    it('REQUEST: METHOD, UID estable, SEQUENCE, STATUS y CRLF final', () => {
        const ics = unfold(build({ sequence: 3 }));
        expect(ics.endsWith('\r\n')).toBe(true);
        expect(ics).toContain('METHOD:REQUEST');
        expect(ics).toContain('UID:abc123@bloom');
        expect(ics).toContain('SEQUENCE:3');
        expect(ics).toContain('STATUS:CONFIRMED');
        expect(ics).toContain('DTSTART:20300115T150000Z');
        expect(ics).toContain('BEGIN:VALARM');
        expect(ics).toContain('ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=CHAIR;PARTSTAT=ACCEPTED;RSVP=FALSE;CN="Host":mailto:host@example.com');
        expect(ics).toContain('ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN="Guest":mailto:guest@example.com');
    });

    it('CANCEL: STATUS:CANCELLED, sin alarma ni conferencia, mismo UID y SEQUENCE mayor', () => {
        const ics = build({
            method: 'CANCEL',
            sequence: 4,
            conference: { provider: 'zoom', joinUrl: 'https://zoom.us/j/123456789' },
        });
        expect(ics).toContain('METHOD:CANCEL');
        expect(ics).toContain('STATUS:CANCELLED');
        expect(ics).toContain('UID:abc123@bloom');
        expect(ics).toContain('SEQUENCE:4');
        expect(ics).not.toContain('VALARM');
        expect(ics).not.toContain('CONFERENCE');
        expect(ics).not.toContain('zoom.us');
    });

    it('SEQUENCE invalido o negativo => 0; PUBLISH soportado', () => {
        expect(build({ sequence: -5 })).toContain('SEQUENCE:0');
        expect(build({ sequence: Number.NaN })).toContain('SEQUENCE:0');
        expect(build({ method: 'PUBLISH' })).toContain('METHOD:PUBLISH');
    });

    it('con timezone valido emite VTIMEZONE + TZID; con uno invalido usa UTC', () => {
        const tz = build({ timezone: 'America/Lima' });
        expect(tz).toContain('TZID:America/Lima');
        expect(tz).toContain('DTSTART;TZID=America/Lima:20300115T100000');
        const bad = build({ timezone: 'Not/AZone;INJECT' });
        expect(bad).not.toContain('VTIMEZONE');
        expect(bad).toContain('DTSTART:20300115T150000Z');
    });

    it('escapa TEXT segun RFC 5545', () => {
        const ics = build({ title: 'a\\b; c, d', description: 'l1\nl2' });
        expect(ics).toContain('SUMMARY:a\\\\b\\; c\\, d');
        expect(unfold(ics)).toContain('DESCRIPTION:l1\\nl2');
    });

    it('resultado parseable por parseInviteFromIcs', () => {
        const ics = build({ conference: { provider: 'google-meet', joinUrl: 'https://meet.google.com/abc-defg-hij' } });
        const parsed = parseInviteFromIcs(ics);
        expect(parsed?.uid).toBe('abc123@bloom');
        expect(parsed?.meetUrl).toBe('https://meet.google.com/abc-defg-hij');
        expect(parsed?.organizerEmail).toBe('host@example.com');
    });
});

describe('buildEventIcs: inyeccion de lineas (CWE-93)', () => {
    const EVIL = 'x\r\nATTENDEE:mailto:evil@attacker.io\r\nX-INJECT:1';
    const fields: Array<[string, Partial<BuildEventIcsInput>]> = [
        ['title', { title: EVIL }],
        ['description', { description: EVIL }],
        ['location', { location: EVIL }],
        ['organizer name', { organizer: { email: 'host@example.com', name: EVIL } }],
        ['organizer email', { organizer: { email: `host@example.com${EVIL}`, name: 'H' } }],
        ['attendee name', { attendees: [{ email: 'g@example.com', name: EVIL }] }],
        ['attendee email', { attendees: [{ email: `g@example.com${EVIL}` }] }],
        ['uid', { uid: `id${EVIL}` }],
        ['brandName', { brandName: EVIL }],
        ['timezone', { timezone: `America/Lima${EVIL}` }],
        ['conference url', { conference: { joinUrl: `https://zoom.us/j/123${EVIL}` } }],
        ['conference passcode', { conference: { joinUrl: 'https://zoom.us/j/123456', passcode: EVIL } }],
        ['conference dial-in', { conference: { joinUrl: 'https://zoom.us/j/123456', dialIn: [{ country: EVIL, number: EVIL, code: EVIL }] } }],
    ];

    for (const [name, over] of fields) {
        it(`ninguna linea inyectada desde: ${name}`, () => {
            const ics = build(over);
            const lines = linesOf(ics);
            // Ningun nombre de propiedad nuevo, ni ATTENDEE del atacante, ni X-INJECT al inicio de linea.
            expect(lines.some((l) => l.startsWith('X-INJECT'))).toBe(false);
            expect(lines.some((l) => l.startsWith('ATTENDEE') && l.includes('evil@attacker.io'))).toBe(false);
            expect(unfold(ics)).not.toMatch(/\r\n(?:ATTENDEE:mailto:evil|X-INJECT)/);
            // Sin CR/LF sueltos: cada CR va seguido de LF y viceversa.
            expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
            // Sin otros caracteres de control.
            // eslint-disable-next-line no-control-regex
            expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/);
        });
    }

    it('unicode separators (U+2028/U+0085) y NUL tampoco rompen lineas', () => {
        const ics = build({ title: 'a b\u0085c\u0000d' });
        expect(ics).toContain('SUMMARY:a b c d');
    });

    it('comillas en CN no rompen el parametro', () => {
        const ics = build({ attendees: [{ email: 'g@example.com', name: 'Ana "Jefa"; x:y' }] });
        expect(ics).toContain('CN="Ana \'Jefa\'; x:y":mailto:g@example.com');
    });

    it('correos invalidos se descartan (no hay mailto con basura)', () => {
        const ics = build({ attendees: [{ email: 'no-es-correo' }, { email: 'a b@c.com' }, { email: 'ok@example.com' }] });
        const att = linesOf(ics).filter((l) => l.startsWith('ATTENDEE'));
        expect(att).toHaveLength(2); // organizador + ok@
        expect(ics).not.toContain('no-es-correo');
    });
});

describe('buildEventIcs: plegado a 75 octetos', () => {
    it('ninguna linea supera 75 octetos y al desplegar se recupera el texto', () => {
        const title = 'Ñandú '.repeat(60) + '日本語のタイトル🎉'.repeat(10);
        const ics = build({ title });
        for (const line of ics.split('\r\n')) {
            expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
        }
        expect(unfold(ics)).toContain(`SUMMARY:${title.replace(/,/g, '\\,')}`);
    });

    it('nunca parte un caracter multibyte (sin U+FFFD al decodificar cada linea)', () => {
        const folded = foldIcsLine('SUMMARY:' + '€'.repeat(100) + '😀'.repeat(50));
        for (const line of folded.split('\r\n')) {
            const buf = Buffer.from(line, 'utf8');
            expect(buf.toString('utf8')).toBe(line);
            expect(line).not.toContain('�');
            expect(buf.length).toBeLessThanOrEqual(75);
        }
    });

    it('lineas cortas no se pliegan; las continuaciones empiezan con un espacio', () => {
        expect(foldIcsLine('SUMMARY:corto')).toBe('SUMMARY:corto');
        const parts = foldIcsLine('A'.repeat(200)).split('\r\n');
        expect(parts.length).toBeGreaterThan(2);
        expect(parts.slice(1).every((p) => p.startsWith(' '))).toBe(true);
    });
});

describe('buildEventIcs: conferencia', () => {
    it('Google Meet: LOCATION, URL, CONFERENCE y X-GOOGLE-CONFERENCE (sin X-ZOOM)', () => {
        const url = 'https://meet.google.com/abc-defg-hij';
        const ics = unfold(build({ conference: { provider: "google-meet", joinUrl: url } }));
        expect(ics).toContain(`LOCATION:${url}`);
        expect(ics).toContain(`URL:${url}`);
        expect(ics).toContain(`CONFERENCE;VALUE=URI;FEATURE=VIDEO;LABEL="Join Google Meet":${url}`);
        expect(ics).toContain(`X-GOOGLE-CONFERENCE:${url}`);
        expect(ics).not.toContain('X-ZOOM-JOIN-URL');
        expect(unfold(ics)).toContain(`Join Google Meet: ${url}`);
    });

    it('Zoom: X-ZOOM-JOIN-URL (sin X-GOOGLE) + passcode y dial-in en DESCRIPTION', () => {
        const url = 'https://acme.zoom.us/j/123456789?pwd=abc';
        const ics = unfold(
            build({
                conference: {
                    provider: 'zoom',
                    joinUrl: url,
                    passcode: '987654',
                    dialIn: [{ country: 'US', number: '+1 669 900 6833', code: '123 456 789' }],
                },
            }),
        );
        expect(ics).toContain(`X-ZOOM-JOIN-URL:${url}`);
        expect(ics).not.toContain('X-GOOGLE-CONFERENCE');
        expect(ics).toContain('Passcode: 987654');
        expect(ics).toContain('Dial-in:');
        expect(ics).toContain('US: +1 669 900 6833 (code 123 456 789)');
        expect(ics).toContain('LABEL="Join Zoom"');
    });

    it('proveedor propio https valido: CONFERENCE con el host como etiqueta, sin X-* de proveedor', () => {
        const ics = unfold(build({ conference: { provider: "custom", joinUrl: "https://reuniones.empresa.pe/sala-1" } }));
        expect(ics).toContain('CONFERENCE;VALUE=URI;FEATURE=VIDEO;LABEL="Join reuniones.empresa.pe":https://reuniones.empresa.pe/sala-1');
        expect(ics).not.toContain('X-GOOGLE-CONFERENCE');
        expect(ics).not.toContain('X-ZOOM-JOIN-URL');
    });

    it('location original se conserva en DESCRIPTION cuando hay conferencia', () => {
        const ics = unfold(build({ location: 'Sala 3', conference: { joinUrl: 'https://meet.google.com/abc-defg-hij' } }));
        expect(ics).toContain('Location: Sala 3');
    });

    const spoofed = [
        'https://zoom.us.evil.com/j/123456789',
        'https://evilmeet.google.com.attacker.io/abc-defg-hij',
        'https://meet.google.com.attacker.io/abc-defg-hij',
        'https://meet.google.com@evil.com/abc-defg-hij',
        'https://zoom.us@evil.com/j/123',
        'https://notzoom.us/j/123',
        'https://evil.com/?u=https://meet.google.com/abc-defg-hij',
        'https://evil.com/zoom.us/j/123',
    ];
    for (const url of spoofed) {
        it(`host falso ${url}: sin X-GOOGLE-CONFERENCE ni X-ZOOM-JOIN-URL`, () => {
            const ics = unfold(build({ conference: { provider: "google-meet", joinUrl: url } }));
            expect(ics).not.toContain('X-GOOGLE-CONFERENCE');
            expect(ics).not.toContain('X-ZOOM-JOIN-URL');
            expect(ics).not.toContain('LABEL="Join Google Meet"');
            expect(ics).not.toContain('LABEL="Join Zoom"');
        });
    }

    const unsafe = [
        'http://meet.google.com/abc-defg-hij',
        'javascript:alert(1)',
        'data:text/html,hola',
        'https://user:pw@zoom.us/j/123456789',
        'ftp://zoom.us/j/123',
        '//zoom.us/j/123',
        'https://zoom.us:8443/j/123',
        '',
    ];
    for (const url of unsafe) {
        it(`enlace no seguro "${url}": no hay conferencia ni LOCATION con el enlace`, () => {
            const ics = build({ conference: { provider: 'zoom', joinUrl: url } });
            expect(ics).not.toContain('CONFERENCE');
            expect(ics).not.toContain('X-ZOOM-JOIN-URL');
            expect(ics).not.toContain('\r\nURL:');
            expect(ics).not.toContain('LOCATION:');
            expect(ics).not.toContain('Join ');
        });
    }
});

describe('buildEventIcs: PRODID / X-WR-CALNAME con la marca del dominio y textos localizados', () => {
    const ZOOM = { provider: 'zoom', joinUrl: 'https://us02web.zoom.us/j/81234567890', passcode: '987654', dialIn: [{ country: 'PE', number: '+51 1 700', code: '12' }] };

    it('PRODID = -//<Marca>//BloomX Calendar//ES|EN (por defecto EN, como antes)', () => {
        expect(build({ brandName: 'Acme Corp', locale: 'es' })).toContain('\r\nPRODID:-//Acme Corp//BloomX Calendar//ES\r\n');
        expect(build({ brandName: 'Acme Corp', locale: 'en' })).toContain('\r\nPRODID:-//Acme Corp//BloomX Calendar//EN\r\n');
        expect(build({ brandName: 'Acme Corp' })).toContain('PRODID:-//Acme Corp//BloomX Calendar//EN');
        expect(build({ brandName: undefined })).toContain('PRODID:-//Bloom//BloomX Calendar//EN');
        expect(build({ brandName: '' })).toContain('PRODID:-//Bloom//BloomX Calendar//EN');
    });

    it('marca hostil: una sola linea PRODID, sin CR/LF ni control, sin barras, acotada', () => {
        const evil = 'Ac/me; Inc,\r\nBEGIN:VEVENT\r\nATTENDEE:mailto:x@evil.example\u0007' + 'z'.repeat(300);
        const ics = build({ brandName: evil });
        const lines = linesOf(unfold(ics));
        const prod = lines.filter((l) => l.startsWith('PRODID:'));
        expect(prod).toHaveLength(1);
        expect(prod[0]).toMatch(/^PRODID:-\/\/[^\u0000-\u001f]+\/\/BloomX Calendar\/\/EN$/);
        const owner = prod[0].slice('PRODID:-//'.length, -'//BloomX Calendar//EN'.length);
        expect(owner).not.toContain('/');
        expect(owner.replace(/\\[;,]/g, '_').length).toBeLessThanOrEqual(60);
        expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
        expect(lines.some((l) => l.startsWith('ATTENDEE:mailto:x@evil'))).toBe(false);
    });

    it('X-WR-CALNAME solo en PUBLISH (en REQUEST/CANCEL renombraria el calendario del invitado)', () => {
        expect(unfold(build({ method: 'PUBLISH', brandName: 'Acme, Inc' }))).toContain('\r\nX-WR-CALNAME:Acme\\, Inc\r\n');
        expect(build({ method: 'REQUEST' })).not.toContain('X-WR-CALNAME');
        expect(build({ method: 'CANCEL' })).not.toContain('X-WR-CALNAME');
    });

    it('descripcion, etiqueta de conferencia y alarma en el idioma pedido', () => {
        const en = unfold(build({ locale: 'en', location: 'Sala 3', conference: ZOOM }));
        expect(en).toContain('Join Zoom: https://us02web.zoom.us/j/81234567890');
        expect(en).toContain('LABEL="Join Zoom"');
        expect(en).toContain('Passcode: 987654');
        expect(en).toContain('Dial-in:');
        expect(en).toContain('(code 12)');
        expect(en).toContain('Reminder: Reunion de equipo');
        expect(en).toContain('Location: Sala 3');
        const es = unfold(build({ locale: 'es', location: 'Sala 3', conference: ZOOM }));
        expect(es).toContain('Unirse a Zoom: https://us02web.zoom.us/j/81234567890');
        expect(es).toContain('LABEL="Unirse a Zoom"');
        expect(es).toContain('Contraseña: 987654');
        expect(es).toContain('Marcación telefónica:');
        expect(es).toContain('(código 12)');
        expect(es).toContain('Recordatorio: Reunion de equipo');
        expect(es).toContain('Ubicación: Sala 3');
        expect(es).not.toContain('Passcode');
    });
});
