import { afterEach, describe, expect, it } from 'vitest';
import { detectFileType, validateAttachment } from '../file-type';

const b = (...bytes: number[]) => Buffer.from(bytes);
const pad = (head: Buffer, len = 64) => Buffer.concat([head, Buffer.alloc(Math.max(0, len - head.length), 0x20)]);
const ascii = (s: string) => Buffer.from(s, 'latin1');

const PNG = pad(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));
const JPG = pad(b(0xff, 0xd8, 0xff, 0xe0));
const PDF = pad(ascii('%PDF-1.7\n'));
const ZIP = pad(b(0x50, 0x4b, 0x03, 0x04));
const DOCX = Buffer.concat([b(0x50, 0x4b, 0x03, 0x04), ascii('....[Content_Types].xml....word/document.xml....')]);
const PE = (() => {
    const buf = Buffer.alloc(0x100);
    buf.write('MZ', 0, 'latin1');
    buf.writeUInt32LE(0x80, 0x3c);
    buf.write('PE\0\0', 0x80, 'latin1');
    return buf;
})();
const ELF = pad(b(0x7f, 0x45, 0x4c, 0x46));
const HTML = ascii('<!DOCTYPE html><html><script>alert(1)</script></html>');
const SVG = ascii('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe('detectFileType (magic bytes)', () => {
    it('reconoce formatos comunes', () => {
        expect(detectFileType(PNG).mime).toBe('image/png');
        expect(detectFileType(JPG).mime).toBe('image/jpeg');
        expect(detectFileType(PDF).mime).toBe('application/pdf');
        expect(detectFileType(pad(ascii('GIF89a'))).mime).toBe('image/gif');
        expect(detectFileType(Buffer.concat([ascii('RIFF'), b(0, 0, 0, 0), ascii('WEBP')])).mime).toBe('image/webp');
        expect(detectFileType(ZIP).mime).toBe('application/zip');
        expect(detectFileType(DOCX).mime).toContain('wordprocessingml');
        expect(detectFileType(pad(b(0x1f, 0x8b))).family).toBe('archive');
        expect(detectFileType(Buffer.concat([b(0, 0, 0, 0x18), ascii('ftypisom')])).mime).toBe('video/mp4');
        expect(detectFileType(ascii('hola, esto es texto plano\nlinea 2')).mime).toBe('text/plain');
    });

    it('marca ejecutables como peligrosos', () => {
        expect(detectFileType(PE)).toMatchObject({ family: 'executable', dangerous: true });
        expect(detectFileType(ELF)).toMatchObject({ family: 'executable', dangerous: true });
        expect(detectFileType(pad(b(0xcf, 0xfa, 0xed, 0xfe)))).toMatchObject({ dangerous: true });
        expect(detectFileType(ascii('#!/bin/sh\nrm -rf /'))).toMatchObject({ dangerous: true });
    });

    it('un texto que empieza por "MZ" no es un ejecutable', () => {
        expect(detectFileType(ascii('MZ - resumen del proyecto\nlinea 2')).dangerous).toBe(false);
    });

    it('detecta contenido activo (html / svg / xml)', () => {
        expect(detectFileType(HTML)).toMatchObject({ mime: 'text/html', active: true });
        expect(detectFileType(SVG)).toMatchObject({ mime: 'image/svg+xml', active: true });
        expect(detectFileType(Buffer.from('﻿  <?xml version="1.0"?><svg></svg>', 'utf8'))).toMatchObject({ active: true });
    });

    it('vacio o binario desconocido', () => {
        expect(detectFileType(Buffer.alloc(0)).family).toBe('unknown');
        expect(detectFileType(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x00, 0x99])).family).toBe('unknown');
    });
});

describe('validateAttachment', () => {
    const OLD = process.env.INBOUND_BLOCK_DANGEROUS_EXT;
    afterEach(() => {
        if (OLD === undefined) delete process.env.INBOUND_BLOCK_DANGEROUS_EXT;
        else process.env.INBOUND_BLOCK_DANGEROUS_EXT = OLD;
    });

    it('imagen legitima: limpia y conserva el tipo', () => {
        const v = validateAttachment({ filename: 'foto.png', declaredMime: 'image/png', buffer: PNG, direction: 'upload' });
        expect(v).toMatchObject({ verdict: 'clean', storeMime: 'image/png', reason: 'ok' });
    });

    it('ejecutable disfrazado de imagen: bloqueado en ambos sentidos', () => {
        for (const direction of ['upload', 'inbound'] as const) {
            const v = validateAttachment({ filename: 'foto.png', declaredMime: 'image/png', buffer: PE, direction });
            expect(v.verdict).toBe('blocked');
            expect(v.reason).toBe('blocked_executable');
        }
    });

    it('HTML/SVG declarado como imagen: subida bloqueada, entrante saneado a binario opaco', () => {
        const up = validateAttachment({ filename: 'x.png', declaredMime: 'image/png', buffer: SVG, direction: 'upload' });
        expect(up.verdict).toBe('blocked');
        const inb = validateAttachment({ filename: 'x.png', declaredMime: 'image/png', buffer: SVG, direction: 'inbound' });
        expect(inb).toMatchObject({ verdict: 'sanitized', storeMime: 'application/octet-stream', reason: 'active_content' });
    });

    it('un .html honesto se conserva pero se guarda como binario opaco', () => {
        const v = validateAttachment({ filename: 'pagina.html', declaredMime: 'text/html', buffer: HTML, direction: 'inbound' });
        expect(v).toMatchObject({ verdict: 'sanitized', storeMime: 'application/octet-stream' });
    });

    it('zip disfrazado de imagen/pdf: subida bloqueada, entrante corrige el tipo', () => {
        const up = validateAttachment({ filename: 'a.pdf', declaredMime: 'application/pdf', buffer: ZIP, direction: 'upload' });
        expect(up.verdict).toBe('blocked');
        const inb = validateAttachment({ filename: 'a.pdf', declaredMime: 'application/pdf', buffer: ZIP, direction: 'inbound' });
        expect(inb).toMatchObject({ verdict: 'sanitized', storeMime: 'application/zip', reason: 'type_mismatch' });
    });

    it('docx real declarado como docx: limpio', () => {
        const v = validateAttachment({
            filename: 'a.docx',
            declaredMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            buffer: DOCX,
            direction: 'upload',
        });
        expect(v.verdict).toBe('clean');
    });

    it('texto plano declarado como imagen: subida bloqueada', () => {
        const v = validateAttachment({ filename: 'a.jpg', declaredMime: 'image/jpeg', buffer: ascii('esto no es un jpg, es texto'), direction: 'upload' });
        expect(v.verdict).toBe('blocked');
    });

    it('extension peligrosa: bloqueada; entrante se puede relajar con INBOUND_BLOCK_DANGEROUS_EXT=false', () => {
        const text = ascii('echo hola');
        expect(validateAttachment({ filename: 'x.exe', declaredMime: 'application/octet-stream', buffer: text, direction: 'upload' }).verdict).toBe('blocked');
        expect(validateAttachment({ filename: 'x.exe', declaredMime: 'application/octet-stream', buffer: text, direction: 'inbound' }).verdict).toBe('blocked');
        process.env.INBOUND_BLOCK_DANGEROUS_EXT = 'false';
        expect(validateAttachment({ filename: 'x.exe', declaredMime: 'application/octet-stream', buffer: text, direction: 'inbound' }).verdict).not.toBe('blocked');
    });

    it('octet-stream de tipo reconocible mejora el Content-Type', () => {
        const v = validateAttachment({ filename: 'sin-ext', declaredMime: 'application/octet-stream', buffer: PDF, direction: 'inbound' });
        expect(v).toMatchObject({ verdict: 'clean', storeMime: 'application/pdf' });
    });
});
