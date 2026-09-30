import { describe, it, expect } from 'vitest';
import { extractCidReferences, findAttachmentForCid, replaceCidReferences } from '../email-utils';

const atts = [
    { filename: 'image001.png', mimeType: 'image/png', key: 'k/image001.png' },
    { filename: 'logo.jpg', mimeType: 'image/jpeg', key: 'k/logo.jpg' },
    { filename: 'informe.pdf', mimeType: 'application/pdf', key: 'k/informe.pdf' },
    { filename: 'sin-key.png', mimeType: 'image/png', key: null },
];

describe('cid', () => {
    it('extrae referencias cid de src y url()', () => {
        const html = '<img src="cid:image001.png@01D9"><div style="background:url(cid:logo.jpg)"></div><img src="cid:image001.png@01D9">';
        expect(extractCidReferences(html)).toEqual(['image001.png@01D9', 'logo.jpg']);
    });

    it('resuelve por filename, parte local o nombre sin extension', () => {
        expect(findAttachmentForCid('logo.jpg', atts)?.key).toBe('k/logo.jpg');
        expect(findAttachmentForCid('image001.png@01D9', atts)?.key).toBe('k/image001.png');
        expect(findAttachmentForCid('image001@01D9', atts)?.key).toBe('k/image001.png');
        expect(findAttachmentForCid('LOGO.JPG', atts)?.key).toBe('k/logo.jpg');
    });

    it('no resuelve adjuntos no imagen, sin key, ni coincidencias ambiguas', () => {
        expect(findAttachmentForCid('informe.pdf', atts)).toBeNull();
        expect(findAttachmentForCid('sin-key.png', atts)).toBeNull();
        expect(findAttachmentForCid('nada', atts)).toBeNull();
        const dup = [
            { filename: 'a.png', mimeType: 'image/png', key: '1' },
            { filename: 'a.png', mimeType: 'image/png', key: '2' },
        ];
        expect(findAttachmentForCid('a.png', dup)).toBeNull();
    });

    it('replaceCidReferences solo cambia las resueltas', () => {
        const out = replaceCidReferences('<img src="cid:a"><img src="cid:b">', (cid) => (cid === 'a' ? 'data:image/png;base64,AA' : null));
        expect(out).toBe('<img src="data:image/png;base64,AA"><img src="cid:b">');
    });
});
