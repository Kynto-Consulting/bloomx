import { describe, it, expect } from 'vitest';
import { sanitizePastedColors, parseCssColor, isBackgroundDependentColor } from '../paste-utils';

describe('parseCssColor', () => {
    it('lee hex, rgb(a) y nombres', () => {
        expect(parseCssColor('#000')).toEqual({ r: 0, g: 0, b: 0 });
        expect(parseCssColor('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
        expect(parseCssColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30 });
        expect(parseCssColor('rgba(0,0,0,0.1)')).toBeNull();
        expect(parseCssColor('windowtext')).toEqual({ r: 0, g: 0, b: 0 });
        expect(parseCssColor('var(--x)')).toBeNull();
    });
});

describe('isBackgroundDependentColor', () => {
    it('negros, grises oscuros y blancos dependen del fondo; colores de marca no', () => {
        for (const c of ['#000', '#111111', 'rgb(20,20,20)', 'black', '#ffffff', '#f5f5f5']) expect(isBackgroundDependentColor(c)).toBe(true);
        for (const c of ['#1155cc', '#ff0000', '#000080', '#ffff00', '#666666']) expect(isBackgroundDependentColor(c)).toBe(false);
    });
});

describe('sanitizePastedColors', () => {
    it('quita color de texto negro inline y conserva el resto del estilo', () => {
        const out = sanitizePastedColors('<p style="color: rgb(0, 0, 0); font-weight: 700">Hola</p>');
        expect(out).toBe('<p style="font-weight: 700">Hola</p>');
    });

    it('elimina el atributo style si queda vacio', () => {
        expect(sanitizePastedColors('<span style="color:#000000;">x</span>')).toBe('<span>x</span>');
    });

    it('conserva colores intermedios y de marca', () => {
        const html = '<span style="color:#1155cc;background-color:#ffff00">x</span>';
        expect(sanitizePastedColors(html)).toBe('<span style="color: #1155cc; background-color: #ffff00">x</span>');
    });

    it('quita fondos blancos/negros y <font color>', () => {
        expect(sanitizePastedColors('<div style="background-color:#fff">x</div>')).toBe('<div>x</div>');
        expect(sanitizePastedColors('<font color="#000000">x</font>')).toBe('<font>x</font>');
        expect(sanitizePastedColors('<font color="#ff0000">x</font>')).toBe('<font color="#ff0000">x</font>');
    });

    it('no toca texto sin estilos ni otras propiedades', () => {
        expect(sanitizePastedColors('<p style="text-align:center">a</p>')).toBe('<p style="text-align: center">a</p>');
        expect(sanitizePastedColors('plain')).toBe('plain');
    });
});
