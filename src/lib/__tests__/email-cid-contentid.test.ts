import { afterEach, describe, expect, it, vi } from 'vitest';
import { findAttachmentForCid, normalizeContentId } from '../email-utils';
import { extractAttachmentsFromRawMime, extractContentIdFromHeaders } from '../mime-attachments';
import { buildQuickReply } from '../mail-list';

const png = (extra: Record<string, unknown> = {}) => ({ filename: 'image001.png', mimeType: 'image/png', key: 'k/image001.png', ...extra });

describe('normalizeContentId', () => {
    it('quita angulos y espacios, conserva el resto', () => {
        expect(normalizeContentId('<ii_abc123@mail.gmail.com>')).toBe('ii_abc123@mail.gmail.com');
        expect(normalizeContentId('  abc@x  ')).toBe('abc@x');
        expect(normalizeContentId('%3Cabc@x%3E')).toBe('abc@x'); // cid: codificado en URL
    });
    it('rechaza vacios, con espacios internos, control o demasiado largos', () => {
        expect(normalizeContentId('')).toBeNull();
        expect(normalizeContentId('<>')).toBeNull();
        expect(normalizeContentId(undefined)).toBeNull();
        expect(normalizeContentId(42)).toBeNull();
        expect(normalizeContentId('a b')).toBeNull();
        expect(normalizeContentId('a\r\nb')).toBeNull();
        expect(normalizeContentId('x'.repeat(256))).toBeNull();
    });
});

describe('findAttachmentForCid: Content-ID primero, nombre como respaldo', () => {
    it('resuelve por contentId aunque el filename no tenga nada que ver con el cid', () => {
        const atts = [
            { filename: 'foto-oficina.png', mimeType: 'image/png', key: 'k/a', contentId: 'ii_lq8x1@mail.gmail.com' },
            { filename: 'otra.png', mimeType: 'image/png', key: 'k/b', contentId: 'ii_zzz@mail.gmail.com' },
        ];
        expect(findAttachmentForCid('ii_lq8x1@mail.gmail.com', atts)?.key).toBe('k/a');
        expect(findAttachmentForCid('ii_zzz@mail.gmail.com', atts)?.key).toBe('k/b');
    });

    it('es insensible a mayusculas, angulos y codificacion URL', () => {
        const atts = [{ filename: 'x.png', mimeType: 'image/png', key: 'k/x', contentId: 'ABC@Mail.Com' }];
        expect(findAttachmentForCid('abc@mail.com', atts)?.key).toBe('k/x');
        expect(findAttachmentForCid('%3Cabc@mail.com%3E', atts)?.key).toBe('k/x');
    });

    it('el Content-ID gana sobre una coincidencia por nombre contradictoria', () => {
        const atts = [
            { filename: 'logo.png', mimeType: 'image/png', key: 'k/nombre' },
            { filename: 'otro.png', mimeType: 'image/png', key: 'k/cid', contentId: 'logo.png' },
        ];
        expect(findAttachmentForCid('logo.png', atts)?.key).toBe('k/cid');
    });

    it('sin contentId (correos antiguos) cae al filename', () => {
        const atts = [png(), { filename: 'logo.jpg', mimeType: 'image/jpeg', key: 'k/logo.jpg', contentId: null }];
        expect(findAttachmentForCid('image001.png@01D9', atts)?.key).toBe('k/image001.png');
        expect(findAttachmentForCid('logo.jpg', atts)?.key).toBe('k/logo.jpg');
    });

    it('un contentId que no coincide con nada cae al filename', () => {
        const atts = [png({ contentId: 'otro@x' })];
        expect(findAttachmentForCid('image001.png', atts)?.key).toBe('k/image001.png');
    });

    it('contentId duplicado (invalido) no adivina: usa el respaldo por nombre', () => {
        const atts = [
            { filename: 'a.png', mimeType: 'image/png', key: '1', contentId: 'dup@x' },
            { filename: 'b.png', mimeType: 'image/png', key: '2', contentId: 'dup@x' },
        ];
        expect(findAttachmentForCid('dup@x', atts)).toBeNull();
        expect(findAttachmentForCid('b.png', atts)?.key).toBe('2');
    });

    it('acepta application/octet-stream y sin tipo por contentId, pero no PDF ni claves PENDING/BLOCKED', () => {
        const octet = [{ filename: 'f', mimeType: 'application/octet-stream', key: 'k/1', contentId: 'c1@x' }];
        expect(findAttachmentForCid('c1@x', octet)?.key).toBe('k/1');
        const untyped = [{ filename: 'f', mimeType: null, key: 'k/2', contentId: 'c2@x' }];
        expect(findAttachmentForCid('c2@x', untyped)?.key).toBe('k/2');
        const pdf = [{ filename: 'f.pdf', mimeType: 'application/pdf', key: 'k/3', contentId: 'c3@x' }];
        expect(findAttachmentForCid('c3@x', pdf)).toBeNull();
        const pending = [{ filename: 'f.png', mimeType: 'image/png', key: 'PENDING', contentId: 'c4@x' }];
        expect(findAttachmentForCid('c4@x', pending)).toBeNull();
        const blocked = [{ filename: 'f.png', mimeType: 'image/png', key: 'BLOCKED', contentId: 'c5@x' }];
        expect(findAttachmentForCid('c5@x', blocked)).toBeNull();
    });

    it('adjuntos sin contentId ni coincidencia de nombre -> null', () => {
        expect(findAttachmentForCid('nada@x', [png()])).toBeNull();
        expect(findAttachmentForCid('', [png()])).toBeNull();
        expect(findAttachmentForCid('x', null)).toBeNull();
    });
});

describe('Content-ID en el MIME crudo', () => {
    it('extractContentIdFromHeaders: angulos, mayusculas, plegado y ausencia', () => {
        expect(extractContentIdFromHeaders('Content-Type: image/png\r\nContent-ID: <ii_1@mail.gmail.com>\r\n')).toBe('ii_1@mail.gmail.com');
        expect(extractContentIdFromHeaders('content-id: abc@x')).toBe('abc@x');
        expect(extractContentIdFromHeaders('Content-ID:\r\n <folded@x>')).toBe('folded@x');
        expect(extractContentIdFromHeaders('Content-Type: image/png')).toBeUndefined();
        expect(extractContentIdFromHeaders('X-Content-ID: nope')).toBeUndefined();
    });

    it('extractAttachmentsFromRawMime devuelve el contentId de imagenes inline (con y sin Content-Disposition)', () => {
        const b64 = Buffer.from('PNGDATA-pretend').toString('base64');
        const mime = [
            'From: a@x.com',
            'Content-Type: multipart/related; boundary="BOUND"',
            '',
            '--BOUND',
            'Content-Type: text/html; charset=utf-8',
            '',
            '<img src="cid:ii_1@mail.gmail.com"><img src="cid:image002.png@01D9">',
            '--BOUND',
            'Content-Type: image/png; name="foto.png"',
            'Content-Disposition: inline; filename="foto.png"',
            'Content-Transfer-Encoding: base64',
            'Content-ID: <ii_1@mail.gmail.com>',
            '',
            b64,
            '--BOUND',
            'Content-Type: image/png; name="image002.png"',
            'Content-Transfer-Encoding: base64',
            'Content-ID: <image002.png@01D9>',
            '',
            b64,
            '--BOUND',
            'Content-Type: application/pdf; name="doc.pdf"',
            'Content-Disposition: attachment; filename="doc.pdf"',
            'Content-Transfer-Encoding: base64',
            '',
            b64,
            '--BOUND--',
            '',
        ].join('\r\n');
        const parts = extractAttachmentsFromRawMime(mime);
        expect(parts.map((p) => [p.filename, p.contentId])).toEqual([
            ['foto.png', 'ii_1@mail.gmail.com'],
            ['image002.png', 'image002.png@01D9'],
            ['doc.pdf', undefined],
        ]);
        // Y lo extraido se resuelve solo con el contentId aunque el nombre no coincida con el cid.
        const asDb = parts.map((p, i) => ({ filename: p.filename, mimeType: p.contentType, key: `k/${i}`, contentId: p.contentId ?? null }));
        expect(findAttachmentForCid('ii_1@mail.gmail.com', asDb)?.filename).toBe('foto.png');
    });
});

describe('buildQuickReply con cabecera localizada', () => {
    it('usa el texto del idioma activo y escapa el remitente', () => {
        const r = buildQuickReply(
            { from: 'Ana <a@x.com>', subject: 'Hola', createdAt: '2026-01-01' },
            '<p>hi</p>',
            '1 ene',
            (date, from) => `El ${date}, ${from} escribió:`,
        );
        expect(r.body).toContain('El 1 ene, Ana &lt;a@x.com&gt; escribió:');
        expect(r.body).not.toContain('wrote:');
    });
    it('sin cabecera personalizada conserva el texto en ingles y tambien escapa', () => {
        const r = buildQuickReply({ from: 'Ana <a@x.com>', subject: 'Hola', createdAt: '' }, '', '1 ene');
        expect(r.body).toContain('On 1 ene, Ana &lt;a@x.com&gt; wrote:');
    });
});

describe('saveAttachmentContentIds (SQL best-effort)', () => {
    afterEach(() => { vi.resetModules(); vi.doUnmock('@/lib/prisma'); });

    async function load(exec: (...args: any[]) => Promise<number>) {
        vi.doMock('@/lib/prisma', () => ({ prisma: { $executeRaw: exec } }));
        return import('../attachment-content-id');
    }

    it('actualiza las filas validas y omite entradas invalidas / PENDING / BLOCKED', async () => {
        const exec = vi.fn().mockResolvedValue(1);
        const { saveAttachmentContentIds } = await load(exec);
        const n = await saveAttachmentContentIds([
            { emailId: 'e1', key: 'k/1', contentId: '<abc@x>' },
            { emailId: 'e1', key: 'PENDING', contentId: 'abc@x' },
            { emailId: 'e1', key: 'BLOCKED', contentId: 'abc@x' },
            { emailId: 'e1', key: 'k/2', contentId: '' },
            { emailId: '', key: 'k/3', contentId: 'abc@x' },
            { emailId: 'e1', key: 'k/4', contentId: undefined },
        ]);
        expect(n).toBe(1);
        expect(exec).toHaveBeenCalledTimes(1);
        // Plantilla etiquetada: [strings, contentId normalizado, emailId, key]
        expect(exec.mock.calls[0].slice(1)).toEqual(['abc@x', 'e1', 'k/1']);
    });

    it('si la columna no existe todavia no lanza y no sigue intentando', async () => {
        const exec = vi.fn().mockRejectedValue(new Error('column "contentId" of relation "Attachment" does not exist'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { saveAttachmentContentIds, __resetContentIdWarning } = await load(exec);
        __resetContentIdWarning();
        await expect(saveAttachmentContentIds([
            { emailId: 'e1', key: 'k/1', contentId: 'a@x' },
            { emailId: 'e1', key: 'k/2', contentId: 'b@x' },
        ])).resolves.toBe(0);
        expect(exec).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });

    it('otros errores tampoco rompen la ingesta (se registran y se sigue)', async () => {
        const exec = vi.fn().mockRejectedValueOnce(new Error('connection reset')).mockResolvedValueOnce(1);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { saveAttachmentContentIds } = await load(exec);
        await expect(saveAttachmentContentIds([
            { emailId: 'e1', key: 'k/1', contentId: 'a@x' },
            { emailId: 'e1', key: 'k/2', contentId: 'b@x' },
        ])).resolves.toBe(1);
        warn.mockRestore();
    });
});
