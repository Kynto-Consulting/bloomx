import { describe, expect, it } from 'vitest';
import { assetCspSource, resolveInlineCidImages, safeAssetUrl } from '../cid-display';
import { sealedMessages, SEALED_DICTIONARIES } from '../sealed/messages';
import { parseContactConflict } from '../contacts';

const ORIGIN = 'https://app.example.com';
const signed = (name: string) => `${ORIGIN}/api/assets/emails/2030/x/attachments/${name}?exp=1&sig=abc&dl=1`;
const atts = [
    { filename: 'foto-oficina.png', mimeType: 'image/png', key: 'k/a', contentId: 'ii_1@mail.gmail.com', url: signed('a.png') },
    { filename: 'logo.png', mimeType: 'image/png', key: 'k/b', url: signed('logo.png') },
];

describe('resolveInlineCidImages (cid: al mostrar el correo)', () => {
    it('resuelve por Content-ID (aunque el nombre no tenga relacion) y escapa la URL para atributo', () => {
        const r = resolveInlineCidImages('<p><img src="cid:ii_1@mail.gmail.com"></p>', atts);
        expect(r.html).toBe(`<p><img src="${signed('a.png').replace(/&/g, '&amp;')}"></p>`);
        expect(r.sources).toEqual([`${ORIGIN}/api/assets/`]);
    });

    it('cae al nombre de archivo si no hay Content-ID guardado', () => {
        const r = resolveInlineCidImages('<img src="cid:logo.png@01D9">', atts);
        expect(r.html).toContain('/api/assets/emails/2030/x/attachments/logo.png');
    });

    it('un cid desconocido se deja como esta', () => {
        const html = '<img src="cid:no-existe@x">';
        expect(resolveInlineCidImages(html, atts)).toEqual({ html, sources: [] });
    });

    it('solo toca src="cid:...": ni texto, ni otros atributos, ni esquemas distintos', () => {
        const html = '<p>cid:logo.png</p><a href="cid:logo.png">x</a><img data-x="cid:logo.png" src="javascript:alert(1)"><img src=\'cid:logo.png\'>';
        const r = resolveInlineCidImages(html, atts);
        expect(r.html).toContain('<p>cid:logo.png</p>');
        expect(r.html).toContain('<a href="cid:logo.png">x</a>');
        expect(r.html).toContain('data-x="cid:logo.png" src="javascript:alert(1)"');
        expect(r.html).toContain(`src='${signed('logo.png').replace(/&/g, '&amp;')}'`);
    });

    it('descarta URLs de adjunto que no sean del proxy /api/assets (http/https)', () => {
        const bad = [
            { filename: 'logo.png', mimeType: 'image/png', key: 'k/1', url: 'https://evil.example/x.png' },
            { filename: 'a.png', mimeType: 'image/png', key: 'k/2', url: 'javascript:alert(1)' },
            { filename: 'b.png', mimeType: 'image/png', key: 'k/3', url: '//evil.example/api/assets/b.png' },
            { filename: 'c.png', mimeType: 'image/png', key: 'k/4', url: 'https://u:p@app.example.com/api/assets/c.png' },
            { filename: 'd.png', mimeType: 'image/png', key: 'k/5', url: 'data:image/png;base64,AAAA' },
        ];
        for (const cid of ['logo.png', 'a.png', 'b.png', 'c.png', 'd.png']) {
            const html = `<img src="cid:${cid}">`;
            expect(resolveInlineCidImages(html, bad)).toEqual({ html, sources: [] });
        }
    });

    it('un Content-ID con comillas no puede romper el atributo (no se resuelve ni inyecta)', () => {
        const html = '<img src="cid:x&quot; onerror=&quot;alert(1)">';
        const r = resolveInlineCidImages(html, atts);
        expect(r.html).toBe(html);
        const withQuoteUrl = [{ filename: 'q.png', mimeType: 'image/png', key: 'k/q', contentId: 'q@x', url: `${ORIGIN}/api/assets/a"b.png?x=1&y=2` }];
        const out = resolveInlineCidImages('<img src="cid:q@x">', withQuoteUrl).html;
        expect(out).not.toContain('a"b'); // el navegador ya codifica la comilla en el path; el atributo sigue cerrado
        expect(out.match(/"/g)!.length).toBe(2);
    });

    it('ruta relativa: solo se resuelve si se conoce el origen de la app (el iframe tiene origen opaco)', () => {
        const rel = [{ filename: 'r.png', mimeType: 'image/png', key: 'k/r', contentId: 'r@x', url: '/api/assets/r.png?sig=1' }];
        expect(resolveInlineCidImages('<img src="cid:r@x">', rel).html).toBe('<img src="cid:r@x">');
        const r = resolveInlineCidImages('<img src="cid:r@x">', rel, ORIGIN);
        expect(r.html).toBe(`<img src="${ORIGIN}/api/assets/r.png?sig=1">`);
        expect(r.sources).toEqual([`${ORIGIN}/api/assets/`]);
    });

    it('adjuntos que no son imagen no se usan para cid por Content-ID', () => {
        const pdf = [{ filename: 'doc.pdf', mimeType: 'application/pdf', key: 'k/p', contentId: 'p@x', url: signed('doc.pdf') }];
        const html = '<img src="cid:p@x">';
        expect(resolveInlineCidImages(html, pdf).html).toBe(html);
    });

    it('sin adjuntos o sin cid devuelve el HTML tal cual', () => {
        expect(resolveInlineCidImages('<p>hola</p>', atts)).toEqual({ html: '<p>hola</p>', sources: [] });
        expect(resolveInlineCidImages('<img src="cid:a">', [])).toEqual({ html: '<img src="cid:a">', sources: [] });
        expect(resolveInlineCidImages('<img src="cid:a">', null).sources).toEqual([]);
    });
});

describe('safeAssetUrl / assetCspSource', () => {
    it('acepta solo el proxy /api/assets de http(s)', () => {
        expect(safeAssetUrl(signed('a.png'))).not.toBeNull();
        expect(safeAssetUrl('/api/assets/a')).not.toBeNull();
        expect(safeAssetUrl('https://x.com/other/path')).toBeNull();
        expect(safeAssetUrl('ftp://x.com/api/assets/a')).toBeNull();
        expect(safeAssetUrl(42)).toBeNull();
    });
    it('la fuente CSP es origen + /api/assets/ (nunca comodines ni la URL completa)', () => {
        expect(assetCspSource(signed('a.png'))).toBe(`${ORIGIN}/api/assets/`);
        expect(assetCspSource('https://x.com/elsewhere')).toBeNull();
        expect(assetCspSource('*')).toBeNull();
        expect(assetCspSource('https: data:')).toBeNull();
        expect(assetCspSource('/api/assets/a')).toBeNull();
        expect(assetCspSource('/api/assets/a', ORIGIN)).toBe(`${ORIGIN}/api/assets/`);
    });
});

describe('textos del envio sellado es/en', () => {
    it('es y en tienen las mismas claves y ningun texto vacio', () => {
        const es = SEALED_DICTIONARIES.es as any;
        const en = SEALED_DICTIONARIES.en as any;
        expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
        for (const k of Object.keys(es)) {
            const a = typeof es[k] === 'function' ? es[k](2) : es[k];
            const b = typeof en[k] === 'function' ? en[k](2) : en[k];
            expect(String(a).length, k).toBeGreaterThan(0);
            expect(String(b).length, k).toBeGreaterThan(0);
        }
    });
    it('elige idioma con es por defecto y advierte del riesgo del servidor de correo', () => {
        expect(sealedMessages('en').copyLink).toBe('Copy link');
        expect(sealedMessages('es').copyLink).toBe('Copiar enlace');
        expect(sealedMessages('fr').copyLink).toBe('Copiar enlace');
        expect(sealedMessages(undefined).passwordRisk).toMatch(/servidores de correo/i);
        expect(sealedMessages('en').passwordRisk).toMatch(/mail servers/i);
    });
});

describe('parseContactConflict', () => {
    it('extrae el contacto existente del 409 y descarta cuerpos invalidos', () => {
        expect(parseContactConflict({ error: 'x', existing: { id: 'c1', email: 'a@x.com', name: 'Ana', notes: null, source: 'google', extra: 'no' } }))
            .toEqual({ id: 'c1', email: 'a@x.com', name: 'Ana', notes: null, source: 'google' });
        expect(parseContactConflict({ existing: { id: '', email: 'a@x.com' } })).toBeNull();
        expect(parseContactConflict({ existing: { id: 'c1' } })).toBeNull();
        expect(parseContactConflict(null)).toBeNull();
        expect(parseContactConflict('x')).toBeNull();
    });
});
