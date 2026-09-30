import { describe, expect, it } from 'vitest';
import { contrast } from '../color';
import {
    AGENDA_MIN_CONTRAST,
    agendaAccentText,
    agendaContrast,
    agendaSoft,
    agendaSolid,
    agendaTextOn,
    agendaTint,
    safeAgendaColor,
} from '../agenda-color';
import { THEMES } from '../themes';

// Colores tipicos que un usuario elige para calendarios / horarios (incluye los peores casos).
const USER_COLORS = [
    '#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#16a34a', '#0891b2', // paleta de citas
    '#00897b', // festivos
    '#ffff00', '#fde047', '#a5f3fc', '#f5f5f5', '#ffffff', '#000000', '#777777', '#808080', '#ff9800', '#4285f4', '#0b8043',
];

describe('agendaTextOn (texto legible sobre color de agenda)', () => {
    it.each(USER_COLORS)('%s: el texto elegido cumple AA (>= 4.5)', (color) => {
        const fg = agendaTextOn(color);
        expect(contrast(fg, color)).toBeGreaterThanOrEqual(AGENDA_MIN_CONTRAST);
        expect(agendaContrast(color)).toBeGreaterThanOrEqual(AGENDA_MIN_CONTRAST);
    });

    it('elige texto oscuro sobre colores claros y blanco sobre oscuros', () => {
        expect(agendaTextOn('#ffff00')).not.toBe('#ffffff');
        expect(agendaTextOn('#fde047')).not.toBe('#ffffff');
        expect(agendaTextOn('#000000')).toBe('#ffffff');
        expect(agendaTextOn('#1e3a8a')).toBe('#ffffff');
    });

    it('el blanco fijo NO habria cumplido en colores claros (regresion del bug original)', () => {
        expect(contrast('#ffffff', '#ffff00')).toBeLessThan(2);
        expect(contrast('#ffffff', '#00897b')).toBeLessThan(4.5);
    });

    it('acepta #rgb y mayusculas', () => {
        expect(agendaSolid('#FF0').background).toBe('#ffff00');
    });
});

describe('safeAgendaColor', () => {
    it('devuelve el respaldo para valores no hex (tambien evita inyeccion de CSS)', () => {
        expect(safeAgendaColor('red; background:url(x)')).toBe('#2563eb');
        expect(safeAgendaColor('rgb(1,2,3)')).toBe('#2563eb');
        expect(safeAgendaColor(undefined)).toBe('#2563eb');
        expect(safeAgendaColor(null, '#ff0000')).toBe('#ff0000');
        expect(safeAgendaColor('nope', 'tampoco')).toBe('#2563eb');
    });
    it('normaliza a #rrggbb minuscula', () => {
        expect(safeAgendaColor('#ABC')).toBe('#aabbcc');
    });
    it('los helpers no lanzan con datos invalidos', () => {
        expect(() => agendaTextOn('???')).not.toThrow();
        expect(() => agendaSoft('???', '#fff')).not.toThrow();
    });
});

describe('agendaAccentText / agendaSoft sobre las superficies de TODOS los temas', () => {
    for (const theme of THEMES) {
        const bg = theme.tokens.background;
        const card = theme.tokens.card;
        it(`${theme.id}: texto de acento legible sobre fondo y tarjeta`, () => {
            for (const color of USER_COLORS) {
                const text = agendaAccentText(color, [bg, card]);
                expect(contrast(text, bg)).toBeGreaterThanOrEqual(AGENDA_MIN_CONTRAST);
                expect(contrast(text, card)).toBeGreaterThanOrEqual(AGENDA_MIN_CONTRAST);
            }
        });
        it(`${theme.id}: chip suave (tinte + texto) cumple AA`, () => {
            for (const color of USER_COLORS) {
                const soft = agendaSoft(color, bg, 0.14);
                expect(contrast(soft.foreground, soft.background)).toBeGreaterThanOrEqual(AGENDA_MIN_CONTRAST);
                expect(contrast(soft.foreground, bg)).toBeGreaterThanOrEqual(AGENDA_MIN_CONTRAST);
            }
        });
    }

    it('agendaTint mezcla con la superficie (0 = superficie, 1 = color)', () => {
        expect(agendaTint('#ff0000', '#ffffff', 0)).toBe('#ffffff');
        expect(agendaTint('#ff0000', '#ffffff', 1)).toBe('#ff0000');
        expect(agendaTint('#ff0000', '#000000', 5)).toBe('#ff0000'); // se acota a [0,1]
    });

    it('conserva el color cuando ya cumple', () => {
        expect(agendaAccentText('#1e3a8a', ['#ffffff'])).toBe('#1e3a8a');
    });
});
