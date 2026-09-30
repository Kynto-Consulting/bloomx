import { describe, expect, it } from 'vitest';
import { buildVcf, parseVcf, type PimContact } from '../mail-transfer/pim/vcard';

const GOOGLE = [
    'BEGIN:VCARD', 'VERSION:3.0', 'FN:Ana García', 'N:García;Ana;;;', 'EMAIL;TYPE=INTERNET;TYPE=HOME:Ana@Example.test',
    'item1.EMAIL;TYPE=INTERNET:ana.work@example.test', 'item1.X-ABLabel:Trabajo', 'TEL;TYPE=CELL:+34 600 111 222',
    'ORG:Acme\\, S.L.;Ventas', 'TITLE:Directora', 'NOTE:Linea 1\\nLinea 2\\, con coma\\; y punto y coma',
    'ADR;TYPE=HOME:;;Calle Mayor 1;Madrid;;28001;España', 'BDAY:1990-05-17', 'URL:https\\://ana.example.test/',
    'PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsK',
    ' CwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQU', 'UID:urn:uuid:1234-abcd', 'END:VCARD', '',
].join('\r\n');

describe('parseVcf', () => {
    it('Google (3.0): grupos, escapes, multi-valor, ORG estructurado, foto ignorada, folding', () => {
        const r = parseVcf(GOOGLE);
        expect(r.invalid).toBe(0);
        expect(r.contacts).toHaveLength(1);
        expect(r.contacts[0]).toEqual({
            uid: '1234-abcd', name: 'Ana García', emails: ['ana@example.test', 'ana.work@example.test'], phones: ['+34 600 111 222'],
            org: 'Acme, S.L., Ventas', title: 'Directora', notes: 'Linea 1\nLinea 2, con coma; y punto y coma',
            addresses: ['Calle Mayor 1, Madrid, 28001, España'], birthday: '1990-05-17', urls: ['https://ana.example.test/'],
        });
    });

    it('Apple (3.0) con N sin FN, folding y saltos LF', () => {
        const v = 'BEGIN:VCARD\nVERSION:3.0\nN:Pérez;Luis;;Dr.;\nTEL;type=CELL;type=VOICE;type=pref:600 000 001\nEMAIL;type=INTERNET;type=pref:luis@example.test\n'
            + 'NOTE:una nota muy\n  larga plegada\nBDAY;value=date:19801231\nEND:VCARD\n';
        const c = parseVcf(v).contacts[0];
        expect(c.name).toBe('Dr. Luis Pérez');
        expect(c.notes).toBe('una nota muy larga plegada');
        expect(c.birthday).toBe('1980-12-31');
        expect(c.phones).toEqual(['600 000 001']);
    });

    it('Outlook (2.1): QUOTED-PRINTABLE, CHARSET, soft breaks, parametros sin nombre', () => {
        const v = [
            'BEGIN:VCARD', 'VERSION:2.1', 'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Mu=C3=B1oz;Jos=C3=A9;;;',
            'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Jos=C3=A9 Mu=C3=B1oz', 'TEL;CELL;VOICE:+34 611 222 333',
            'EMAIL;PREF;INTERNET:jose@example.test', 'NOTE;ENCODING=QUOTED-PRINTABLE;CHARSET=ISO-8859-1:Ma=F1ana =',
            'a las diez', 'ORG:Empresa;Depto', 'BDAY:--0704', 'END:VCARD',
        ].join('\r\n');
        const c = parseVcf(v).contacts[0];
        expect(c.name).toBe('José Muñoz');
        expect(c.notes).toBe('Mañana a las diez');
        expect(c.phones).toEqual(['+34 611 222 333']);
        expect(c.emails).toEqual(['jose@example.test']);
        expect(c.org).toBe('Empresa, Depto');
        expect(c.birthday).toBe('--07-04');
    });

    it('vCard 4.0 (mailto:/tel:) y varias tarjetas', () => {
        const v = 'BEGIN:VCARD\r\nVERSION:4.0\r\nFN:A\r\nEMAIL:mailto:a@example.test\r\nTEL;VALUE=uri:tel:+34-600\r\nEND:VCARD\r\nBEGIN:VCARD\r\nVERSION:4.0\r\nFN:B\r\nEND:VCARD\r\n';
        const r = parseVcf(v);
        expect(r.contacts.map((c) => c.name)).toEqual(['A', 'B']);
        expect(r.contacts[0].emails).toEqual(['a@example.test']);
        expect(r.contacts[0].phones).toEqual(['+34-600']);
    });

    it('acepta Buffer (UTF-8 con BOM, UTF-16LE y latin1 sin BOM)', () => {
        const txt = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Niño\r\nEND:VCARD\r\n';
        expect(parseVcf(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(txt)])).contacts[0].name).toBe('Niño');
        expect(parseVcf(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(txt, 'utf16le')])).contacts[0].name).toBe('Niño');
        expect(parseVcf(Buffer.from(txt, 'latin1')).contacts[0].name).toBe('Niño');
    });

    it('basura: nunca lanza y cuenta invalidos', () => {
        expect(parseVcf('').contacts).toEqual([]);
        expect(parseVcf('hola mundo\0\0').invalid).toBe(0);
        const r = parseVcf('BEGIN:VCARD\nVERSION:3.0\nEND:VCARD\nBEGIN:VCARD\nFN:Sin fin\nBEGIN:VCARD\nFN:Ok\nEND:VCARD\nBEGIN:VCARD\nFN:Truncada');
        expect(r.contacts.map((c) => c.name)).toEqual(['Ok']);
        expect(r.invalid).toBe(3);
        expect(() => parseVcf(Buffer.from([0xff, 0x00, 0x80, 0xc3]))).not.toThrow();
        expect(parseVcf('BEGIN:VCARD\nFN:X\nEMAIL:no-es-correo\nEND:VCARD').contacts[0].emails).toEqual([]);
    });

    it('limites: contactos, longitud de campos, listas, bytes', () => {
        const many = Array.from({ length: 10 }, (_, i) => `BEGIN:VCARD\nFN:C${i}\nEND:VCARD`).join('\n');
        const r = parseVcf(many, { maxContacts: 3 });
        expect(r.contacts).toHaveLength(3);
        expect(r.truncated).toBe(true);
        const emails = Array.from({ length: 200 }, (_, i) => `EMAIL:e${i}@example.test`).join('\n');
        const big = parseVcf(`BEGIN:VCARD\nFN:${'x'.repeat(5000)}\nNOTE:${'n'.repeat(50000)}\n${emails}\nEND:VCARD`, { maxFieldLength: 100, maxNotesLength: 500, maxListItems: 5 });
        expect(big.contacts[0].name).toHaveLength(100);
        expect(big.contacts[0].notes).toHaveLength(500);
        expect(big.contacts[0].emails).toHaveLength(5);
        const cut = parseVcf(many, { maxBytes: 60 });
        expect(cut.truncated).toBe(true);
        expect(cut.contacts.length).toBeLessThan(10);
        // una foto enorme se descarta sin decodificar
        expect(parseVcf(`BEGIN:VCARD\nFN:F\nPHOTO;ENCODING=b:${'A'.repeat(2_000_000)}\nEND:VCARD`).contacts).toHaveLength(1);
    });

    it('un correo repetido en distinta capitalizacion no se duplica', () => {
        const c = parseVcf('BEGIN:VCARD\nFN:X\nEMAIL:A@example.test\nEMAIL:a@EXAMPLE.test\nEND:VCARD').contacts[0];
        expect(c.emails).toEqual(['a@example.test']);
    });
});

describe('buildVcf', () => {
    const full: PimContact = {
        uid: 'u-1', name: 'María Ñandú', emails: ['maria@example.test', 'm2@example.test'], phones: ['+34 600 000 000'],
        org: 'Acme, S.L.; Norte', title: 'CEO', notes: 'l1\nl2, con coma; punto y coma \\ barra', addresses: ['C/ Sol 1, 2º A; Madrid'],
        birthday: '1985-03-09', urls: ['https://example.test/a?b=1&c=2'],
    };

    it('genera vCard 4.0 con CRLF y pliegue a 75 octetos sin partir UTF-8', () => {
        const out = buildVcf([{ ...full, notes: 'ñ'.repeat(200) }]);
        expect(out.startsWith('BEGIN:VCARD\r\nVERSION:4.0\r\n')).toBe(true);
        expect(out.endsWith('END:VCARD\r\n')).toBe(true);
        expect(out).not.toMatch(/[^\r]\n/);
        for (const l of out.split('\r\n')) expect(Buffer.byteLength(l)).toBeLessThanOrEqual(75);
        expect(out).not.toContain('�');
    });

    it('round-trip completo', () => {
        const back = parseVcf(buildVcf([full])).contacts[0];
        expect(back).toEqual(full);
    });

    it('round-trip con campos vacios, sin nombre y multiples', () => {
        const list: PimContact[] = [
            { uid: null, name: null, emails: ['solo@example.test'], phones: [], org: null, title: null, notes: null, addresses: [], birthday: null, urls: [] },
            { ...full, uid: 'u-2', name: 'Uno', birthday: '--12-25' },
        ];
        const back = parseVcf(buildVcf(list));
        expect(back.contacts).toHaveLength(2);
        expect(back.contacts[0]).toEqual({ ...list[0], name: 'solo@example.test' });
        expect(back.contacts[1]).toEqual(list[1]);
        expect(buildVcf([])).toBe('');
    });

    it('no permite inyectar propiedades por saltos de linea', () => {
        const out = buildVcf([{ ...full, name: 'X\r\nEMAIL:evil@example.test', org: 'O\nTEL:1', title: 'T\rURL:http://e' }]);
        const back = parseVcf(out).contacts[0];
        expect(back.emails).toEqual(['maria@example.test', 'm2@example.test']);
        expect(back.phones).toEqual(['+34 600 000 000']);
        expect(back.urls).toEqual(['https://example.test/a?b=1&c=2']);
    });
});

describe('contact-notes', () => {
    it('round-trip del bloque de detalles y ambiguedad controlada', async () => {
        const { encodeContactNotes, decodeContactNotes } = await import('../mail-transfer/pim/contact-notes');
        const d = { notes: 'libre\nsegunda', phones: ['1', '2'], org: 'O', title: 'T', addresses: ['A'], birthday: '2000-01-02', urls: ['https://u.test'] };
        expect(decodeContactNotes(encodeContactNotes(d))).toEqual(d);
        expect(encodeContactNotes({ ...d, notes: null, phones: [], org: null, title: null, addresses: [], birthday: null, urls: [] })).toBeNull();
        // una linea "Web: x" pegada al texto libre (sin linea en blanco) no se toma como detalle
        expect(decodeContactNotes('hola\nWeb: x')).toMatchObject({ notes: 'hola\nWeb: x', urls: [] });
        expect(decodeContactNotes(null)).toEqual({ notes: null, phones: [], org: null, title: null, addresses: [], birthday: null, urls: [] });
    });
});
