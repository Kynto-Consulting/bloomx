import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseCsv, detectDelimiter, parseDelimited, normalizeHeaders, decodeCsvBytes, TableLimitError, TABLE_LIMITS } from '../elixir-csv';
import { parseXlsx, excelSerialToString, XlsxError, XLSX_LIMITS } from '../elixir-xlsx';

describe('detectDelimiter', () => {
    it('coma, punto y coma, tab y pipe', () => {
        expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
        expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
        expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
        expect(detectDelimiter('a|b|c\n1|2|3')).toBe('|');
    });
    it('ignora delimitadores dentro de comillas', () => {
        expect(detectDelimiter('"a,b";"c,d"\n1;2')).toBe(';');
    });
    it('decimales con coma en CSV de Excel en español', () => {
        expect(detectDelimiter('nombre;monto\nAna;1,5\nLuis;2,25')).toBe(';');
    });
    it('sin delimitador -> coma; respeta sep=', () => {
        expect(detectDelimiter('email\na@b.c')).toBe(',');
        expect(detectDelimiter('sep=|\na|b\n1|2')).toBe('|');
        expect(detectDelimiter('')).toBe(',');
    });
});

describe('parseCsv', () => {
    it('CSV simple', () => {
        const t = parseCsv('nombre,email\nAna,ana@x.com\nLuis,luis@x.com\n');
        expect(t.headers).toEqual(['nombre', 'email']);
        expect(t.rows).toEqual([{ nombre: 'Ana', email: 'ana@x.com' }, { nombre: 'Luis', email: 'luis@x.com' }]);
        expect(t.delimiter).toBe(',');
    });
    it('punto y coma (Excel es-PE) con decimales', () => {
        const t = parseCsv('nombre;monto\nAna;1,5\n');
        expect(t.headers).toEqual(['nombre', 'monto']);
        expect(t.rows[0]).toEqual({ nombre: 'Ana', monto: '1,5' });
    });
    it('quita el BOM de la primera cabecera', () => {
        const t = parseCsv('﻿email,nombre\na@b.c,Ana');
        expect(t.headers[0]).toBe('email');
        expect(t.rows[0].email).toBe('a@b.c');
    });
    it('comillas: comas, saltos de linea y comillas escapadas', () => {
        const t = parseCsv('a,b\n"x, y","l1\nl2"\n"di ""hola""",z');
        expect(t.rows[0]).toEqual({ a: 'x, y', b: 'l1\nl2' });
        expect(t.rows[1]).toEqual({ a: 'di "hola"', b: 'z' });
    });
    it('CRLF, CR y LF; fila final sin salto de linea', () => {
        expect(parseCsv('a,b\r\n1,2\r\n3,4').rows).toHaveLength(2);
        expect(parseCsv('a,b\r1,2\r3,4').rows).toHaveLength(2);
        expect(parseCsv('a,b\n1,2\n\n\n3,4\n').rows).toHaveLength(2);
    });
    it('campos vacios y filas cortas/largas', () => {
        const t = parseCsv('a,b,c\n1,,3\n4\n5,6,7,8');
        expect(t.rows).toEqual([{ a: '1', b: '', c: '3' }, { a: '4', b: '', c: '' }, { a: '5', b: '6', c: '7' }]);
        expect(t.warnings.join(' ')).toMatch(/más columnas/);
    });
    it('cabeceras vacias y duplicadas', () => {
        const t = parseCsv('a,,a,A\n1,2,3,4');
        expect(t.headers).toEqual(['a', 'columna_2', 'a_2', 'A_3']);
        expect(t.rows[0]).toEqual({ a: '1', columna_2: '2', a_2: '3', A_3: '4' });
        expect(t.warnings.length).toBeGreaterThan(0);
    });
    it('cabeceras peligrosas no contaminan prototipos', () => {
        const t = parseCsv('__proto__,constructor\n1,2');
        expect(t.headers).toEqual(['__proto___', 'constructor_']);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });
    it('recorta espacios y comillas con espacios alrededor', () => {
        const t = parseCsv('a , b\n  x  , "y"  ');
        expect(t.headers).toEqual(['a', 'b']);
        expect(t.rows[0]).toEqual({ a: 'x', b: 'y' });
    });
    it('comilla en medio de un campo sin comillas es literal', () => {
        expect(parseCsv('a,b\n5" pantalla,x').rows[0]).toEqual({ a: '5" pantalla', b: 'x' });
    });
    it('vacio', () => {
        expect(parseCsv('')).toMatchObject({ headers: [], rows: [] });
        expect(parseCsv('\n\n')).toMatchObject({ headers: [], rows: [] });
    });
    it('solo cabecera', () => {
        const t = parseCsv('email,nombre');
        expect(t.headers).toEqual(['email', 'nombre']);
        expect(t.rows).toEqual([]);
    });
    it('delimitador forzado y linea sep= descartada', () => {
        expect(parseCsv('a;b\n1;2', { delimiter: ',' }).headers).toEqual(['a;b']);
        expect(parseCsv('sep=;\na;b\n1;2').rows[0]).toEqual({ a: '1', b: '2' });
    });
    it('emoji y acentos', () => {
        expect(parseCsv('n\nÁlvaro 😀').rows[0].n).toBe('Álvaro 😀');
    });
    it('limite de filas', () => {
        expect(() => parseDelimited('a\n1\n2\n3', ',', 2)).toThrow(TableLimitError);
        expect(TABLE_LIMITS.maxRows).toBeGreaterThan(1000);
    });
    it('limite de columnas', () => {
        const header = Array.from({ length: TABLE_LIMITS.maxCols + 1 }, (_, i) => 'c' + i).join(',');
        expect(() => parseCsv(header + '\n1')).toThrow(TableLimitError);
    });
    it('normalizeHeaders', () => {
        expect(normalizeHeaders([' Nombre   completo ', '', 'x', 'X'])).toEqual(['Nombre completo', 'columna_2', 'x', 'X_2']);
    });
});

describe('decodeCsvBytes', () => {
    it('UTF-8 con y sin BOM', () => {
        expect(decodeCsvBytes(new TextEncoder().encode('Ñandú'))).toBe('Ñandú');
        const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('email\na@b.c')]);
        expect(parseCsv(decodeCsvBytes(withBom)).headers).toEqual(['email']);
    });
    it('Windows-1252 (CSV ANSI de Excel) cuando no es UTF-8 valido', () => {
        const bytes = new Uint8Array([0x50, 0x65, 0xf1, 0x61, 0x3b, 0x4a, 0x6f, 0x73, 0xe9]); // "Peña;José"
        expect(decodeCsvBytes(bytes)).toBe('Peña;José');
    });
    it('UTF-16 LE con BOM', () => {
        const u16 = Buffer.from('﻿a;b\n1;2', 'utf16le');
        expect(parseCsv(decodeCsvBytes(new Uint8Array(u16))).rows[0]).toEqual({ a: '1', b: '2' });
    });
});

// ── XLSX ──────────────────────────────────────────────────────────────────────

const crc32 = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
})();

function makeZip(files: Record<string, string>, opts: { stored?: boolean; lieSize?: boolean } = {}): Uint8Array {
    const parts: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const [name, content] of Object.entries(files)) {
        const data = Buffer.from(content, 'utf8');
        const comp = opts.stored ? data : deflateRawSync(data);
        const method = opts.stored ? 0 : 8;
        const nameB = Buffer.from(name);
        const declared = opts.lieSize ? 10 : data.length;
        const lh = Buffer.alloc(30);
        lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8);
        lh.writeUInt32LE(crc32(data), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(declared, 22);
        lh.writeUInt16LE(nameB.length, 26);
        parts.push(lh, nameB, comp);
        const ch = Buffer.alloc(46);
        ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10);
        ch.writeUInt32LE(crc32(data), 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(declared, 24);
        ch.writeUInt16LE(nameB.length, 28); ch.writeUInt32LE(offset, 42);
        central.push(ch, nameB);
        offset += lh.length + nameB.length + comp.length;
    }
    const cd = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(Object.keys(files).length, 8); eocd.writeUInt16LE(Object.keys(files).length, 10);
    eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
    return new Uint8Array(Buffer.concat([...parts, cd, eocd]));
}

const WB = '<workbook xmlns:r="x"><sheets><sheet name="Hoja1" sheetId="1" r:id="rId1"/></sheets></workbook>';
const RELS = '<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/></Relationships>';

describe('parseXlsx', () => {
    it('lee un archivo real generado por SheetJS (fixture): texto, numeros, fechas, booleanos, entidades', async () => {
        const buf = readFileSync(path.join(__dirname, 'fixtures', 'sample.xlsx'));
        const t = await parseXlsx(new Uint8Array(buf));
        expect(t.headers).toEqual(['Nombre', 'Email', 'Fecha', 'Monto', 'Activo', 'Nota']);
        expect(t.rows).toHaveLength(3);
        expect(t.rows[0]).toMatchObject({ Nombre: 'Ana Pérez', Email: 'ana@x.com', Fecha: '2024-01-15', Monto: '1234.5', Activo: 'TRUE', Nota: 'A & B <c>' });
        expect(t.rows[1]).toMatchObject({ Fecha: '2024-02-29 13:30:00', Monto: '0.1', Activo: 'FALSE' });
        expect(t.rows[2]).toMatchObject({ Nombre: 'Ñandú', Fecha: '', Nota: '007' });
    });

    it('archivo sintetico: cadenas compartidas, inlineStr, fechas por estilo y huecos', async () => {
        const zip = makeZip({
            'xl/workbook.xml': WB,
            'xl/_rels/workbook.xml.rels': RELS,
            'xl/sharedStrings.xml': '<sst><si><t>email</t></si><si><t>fecha</t></si><si><r><t>a</t></r><r><t xml:space="preserve">&amp;b</t></r></si></sst>',
            'xl/styles.xml': '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>',
            'xl/worksheets/sheet1.xml': '<worksheet><sheetData>' +
                '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
                '<row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3" s="1"><v>45306</v></c><c r="C3" s="2"><v>45306.5</v></c><c r="D3" t="inlineStr"><is><t>ins</t></is></c></row>' +
                '</sheetData></worksheet>',
        });
        const t = await parseXlsx(zip);
        expect(t.headers).toEqual(['email', 'columna_2', 'fecha']);
        expect(t.rows).toEqual([{ email: 'a&b', columna_2: '2024-01-15', fecha: '2024-01-15' }]);
        expect(t.warnings.join(' ')).toMatch(/más columnas/);
    });

    it('funciona con entradas sin comprimir (stored) y notacion cientifica', async () => {
        const zip = makeZip({
            'xl/workbook.xml': WB, 'xl/_rels/workbook.xml.rels': RELS,
            'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row><row r="2"><c r="A2"><v>1E-3</v></c></row></sheetData></worksheet>',
        }, { stored: true });
        expect((await parseXlsx(zip)).rows).toEqual([{ x: '0.001' }]);
    });

    it('date1904', async () => {
        const zip = makeZip({
            'xl/workbook.xml': '<workbook xmlns:r="x"><workbookPr date1904="1"/><sheets><sheet name="H" sheetId="1" r:id="rId1"/></sheets></workbook>',
            'xl/_rels/workbook.xml.rels': RELS,
            'xl/styles.xml': '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
            'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>f</t></is></c></row><row r="2"><c r="A2" s="1"><v>0</v></c></row></sheetData></worksheet>',
        });
        expect((await parseXlsx(zip)).rows[0].f).toBe('1904-01-01');
    });

    it('rechaza archivos que no son xlsx', async () => {
        await expect(parseXlsx(new TextEncoder().encode('a,b\n1,2'))).rejects.toBeInstanceOf(XlsxError);
        await expect(parseXlsx(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, ...new Array(40).fill(0)]))).rejects.toThrow(/xls/);
        await expect(parseXlsx(makeZip({ 'otro.txt': 'x' }))).rejects.toBeInstanceOf(XlsxError);
    });

    it('rechaza archivos por encima del limite', async () => {
        const big = new Uint8Array(XLSX_LIMITS.maxFileBytes + 1);
        big[0] = 0x50; big[1] = 0x4b;
        await expect(parseXlsx(big)).rejects.toThrow(/excede/);
    });

    it('zip bomb: se corta por bytes reales aunque la cabecera diga otra cosa', async () => {
        // 70 MB de ceros comprimen a ~70 KB: supera maxEntryBytes (60 MB) al descomprimir.
        const bomb = '<worksheet>' + ' '.repeat(70 * 1024 * 1024) + '</worksheet>';
        const zip = makeZip({ 'xl/workbook.xml': WB, 'xl/_rels/workbook.xml.rels': RELS, 'xl/worksheets/sheet1.xml': bomb }, { lieSize: true });
        await expect(parseXlsx(zip)).rejects.toThrow(/demasiado grande/);
    }, 30_000);

    it('excelSerialToString', () => {
        expect(excelSerialToString(45306, 'date')).toBe('2024-01-15');
        expect(excelSerialToString(45306.75, 'datetime')).toBe('2024-01-15 18:00:00');
        expect(excelSerialToString(0.5, 'time')).toBe('12:00:00');
        expect(excelSerialToString(61, 'date')).toBe('1900-03-01');
    });
});
