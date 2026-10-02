/** icon-image.ts: de donde sale la imagen de un icono (backend / data URL validado) y que se rechaza. */
import { describe, expect, it } from 'vitest';
import { brandIconUrl, parseIconDataUrl, recolorCurrentColor, resolveBackendIconUrl, svgLooksSafe } from '../icon-image';

const BASE = 'https://backend.test';
const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);

describe('resolveBackendIconUrl / brandIconUrl', () => {
    it('solo rutas /api/extensions/icons/<id>[?h=hash] (o la misma URL absoluta del backend)', () => {
        expect(resolveBackendIconUrl('/api/extensions/icons/core-zoom?h=0123456789abcdef', BASE)).toBe(`${BASE}/api/extensions/icons/core-zoom?h=0123456789abcdef`);
        expect(resolveBackendIconUrl('/api/extensions/icons/brand.zoom', BASE)).toBe(`${BASE}/api/extensions/icons/brand.zoom`);
        expect(resolveBackendIconUrl(`${BASE}/api/extensions/icons/core-zoom?h=0123456789abcdef`, BASE)).toBeTruthy();
        for (const bad of ['https://evil.test/api/extensions/icons/x', '/api/extensions/icons/../x', '/api/other', '//evil.test/x', 'javascript:alert(1)', '/api/extensions/icons/x?h=<script>', null, 42]) {
            expect(resolveBackendIconUrl(bad, BASE), String(bad)).toBeNull();
        }
    });
    it('brand.<slug> solo con slugs validos', () => {
        expect(brandIconUrl('zoom', BASE)).toBe(`${BASE}/api/extensions/icons/brand.zoom`);
        expect(brandIconUrl('../x', BASE)).toBeNull();
        expect(brandIconUrl('Zoom', BASE)).toBeNull();
    });
});

describe('parseIconDataUrl', () => {
    it('acepta png / webp / svg con firma valida y respeta el limite', () => {
        expect(parseIconDataUrl(`data:image/png;base64,${b64(PNG)}`)?.mime).toBe('image/png');
        expect(parseIconDataUrl(`data:image/webp;base64,${b64(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]))}`)?.mime).toBe('image/webp');
        expect(parseIconDataUrl(`data:image/svg+xml;base64,${b64('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>')}`)?.mime).toBe('image/svg+xml');
        expect(parseIconDataUrl(`data:image/png;base64,${b64(Buffer.concat([PNG, Buffer.alloc(70 * 1024)]))}`)).toBeNull();
    });
    it('rechaza prefijos fuera de la lista, firmas falsas, no-base64 y SVG activos', () => {
        const bad = [
            'data:image/gif;base64,R0lGODlh', 'data:text/html;base64,PGI+', 'data:image/png,AAAA', 'http://x/y.png', '',
            `data:image/png;base64,${b64('no es un png de verdad')}`,
            `data:image/svg+xml;base64,${b64('<svg><script>1</script></svg>')}`,
            `data:image/svg+xml;base64,${b64('<svg><foreignObject/></svg>')}`,
            `data:image/svg+xml;base64,${b64('<svg><path fill="url(https://evil.test/a)"/></svg>')}`,
            `data:image/svg+xml;base64,${b64('<svg onload="x()"></svg>')}`,
        ];
        for (const v of bad) expect(parseIconDataUrl(v), v.slice(0, 40)).toBeNull();
        expect(svgLooksSafe('<svg><use href="#a"/></svg>')).toBe(false);
    });
});

describe('recolorCurrentColor', () => {
    it('currentColor -> color del tema; sin currentColor no cambia', () => {
        const mono = parseIconDataUrl(`data:image/svg+xml;base64,${b64('<svg xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M0 0"/></svg>')}`)!;
        const out = recolorCurrentColor(mono, '#abcdef');
        expect(Buffer.from(out.split(',')[1], 'base64').toString()).toContain('fill="#abcdef"');
        expect(recolorCurrentColor(mono, 'rojo')).toBe(mono.src);
        const own = parseIconDataUrl(`data:image/svg+xml;base64,${b64('<svg xmlns="http://www.w3.org/2000/svg"><path fill="#0b5cff" d="M0 0"/></svg>')}`)!;
        expect(recolorCurrentColor(own, '#abcdef')).toBe(own.src);
    });
});
