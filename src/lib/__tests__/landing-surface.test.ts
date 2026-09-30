import { describe, expect, it } from 'vitest';
import { contrast, mix } from '../color';
import { AA_RATIO, IMAGE_BASE, TEXT_LIGHT, heroSurface, pageSurface, patternStyle, toneForColors, toneForImage } from '../landing-surface';
import { sanitizeLandingConfig } from '../landing-config';

const HEX = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#808080', '#777777', '#767676', '#2563eb', '#f59e0b', '#7c3aed', '#fde68a', '#0f172a'];

describe('toneForColors: contraste AA calculado', () => {
    it('color plano: texto legible (>= 4.5) para cualquier color', () => {
        for (const c of HEX) {
            const tone = toneForColors([c]);
            const effective = mix(c, tone.scrimColor, tone.scrim);
            expect(contrast(tone.fg, effective), c).toBeGreaterThanOrEqual(AA_RATIO);
        }
    });
    it('degradado: AA contra TODOS los tramos', () => {
        for (const a of HEX) {
            for (const b of HEX) {
                const tone = toneForColors([0, 0.25, 0.5, 0.75, 1].map((t) => mix(a, b, t)));
                for (const t of [0, 0.1, 0.33, 0.5, 0.8, 1]) {
                    const px = mix(mix(a, b, t), tone.scrimColor, tone.scrim);
                    expect(contrast(tone.fg, px), `${a}->${b} @${t}`).toBeGreaterThanOrEqual(AA_RATIO - 0.05);
                }
            }
        }
    });
    it('no usa velo si no hace falta (fondo oscuro con texto claro)', () => {
        expect(toneForColors(['#0f172a']).scrim).toBe(0);
        expect(toneForColors(['#0f172a']).fg).toBe(TEXT_LIGHT);
    });
    it('fondo claro -> texto oscuro sin velo', () => {
        const t = toneForColors(['#fde68a']);
        expect(t.fg).not.toBe(TEXT_LIGHT);
        expect(t.scrim).toBe(0);
    });
});

describe('toneForImage: peor caso (pixel blanco o negro)', () => {
    it('overlay 0 igualmente sube el velo hasta cumplir AA contra un pixel blanco', () => {
        const t = toneForImage(0);
        expect(t.scrim).toBeGreaterThan(0.4);
        expect(contrast(t.fg, mix('#ffffff', t.scrimColor, t.scrim))).toBeGreaterThanOrEqual(AA_RATIO);
        expect(contrast(t.fg, mix('#000000', t.scrimColor, t.scrim))).toBeGreaterThanOrEqual(AA_RATIO);
    });
    it('respeta un overlay mayor al minimo y sigue cumpliendo', () => {
        const t = toneForImage(0.8);
        expect(t.scrim).toBe(0.8);
        expect(t.ratio).toBeGreaterThanOrEqual(AA_RATIO);
    });
    it.each([undefined, NaN, -1, 5])('overlay raro (%s) no rompe', (o) => {
        const t = toneForImage(o as number);
        expect(t.scrim).toBeGreaterThan(0);
        expect(t.scrim).toBeLessThanOrEqual(1);
        expect(t.ratio).toBeGreaterThanOrEqual(AA_RATIO);
    });
    it('la base bajo la imagen tambien da AA con texto claro (si la imagen no carga)', () => {
        expect(contrast(TEXT_LIGHT, IMAGE_BASE)).toBeGreaterThanOrEqual(AA_RATIO);
    });
});

describe('superficies', () => {
    it('sin config: hero = token (bg-primary con text-primary-foreground) y sin fondo de pagina', () => {
        expect(heroSurface({})).toEqual({ kind: 'token' });
        expect(pageSurface({})).toBeNull();
    });
    it('imagen > degradado > token', () => {
        const both = sanitizeLandingConfig({ hero: { imageUrl: 'https://a.com/i.jpg', gradient: { from: '#000', to: '#fff' } } });
        expect(heroSurface(both).kind).toBe('image');
        const grad = sanitizeLandingConfig({ hero: { gradient: { from: '#000', to: '#fff' } } });
        expect(heroSurface(grad).kind).toBe('gradient');
    });
    it('fondo de pagina segun tipo', () => {
        expect(pageSurface(sanitizeLandingConfig({ background: { type: 'color', color: '#123456' } }))?.kind).toBe('color');
        expect(pageSurface(sanitizeLandingConfig({ background: { type: 'image', imageUrl: 'https://a.com/i.jpg' } }))?.kind).toBe('image');
        // tipo declarado sin su dato -> null
        expect(pageSurface(sanitizeLandingConfig({ background: { type: 'image' } }))).toBeNull();
    });
    it('tramas solo devuelven CSS propio', () => {
        expect(patternStyle('none')).toBeNull();
        for (const p of ['dots', 'grid', 'diagonal'] as const) expect(patternStyle(p)?.backgroundImage).not.toMatch(/url\(/);
    });
});
