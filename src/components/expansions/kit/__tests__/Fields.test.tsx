// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RAW_LITERAL } from '@/lib/__tests__/helpers/raw-colors';
import {
    byText, click, flush, installCleanup, key, kitSuite, mount, q, qa, typeInto, applyBrand, assertThemeSafe, PALETTES, BRAND_MODES,
} from './harness';
import {
    CheckboxField, ColorPickerField, ContactPickerField, DatePickerField, Field, FileInputField, type FieldA11y, RadioGroupField, SelectField, SliderField,
    TagInputField, TextArea, TextInput, TimePickerField, ToggleField,
} from '../Fields';

const h = React.createElement;
const OPTIONS = [{ value: 1, label: 'Uno' }, { value: 'dos', label: 'Dos', description: 'Segunda' }, { value: 3, label: 'Tres', disabled: true }];
const blur = async (el: Element | null) => { await act(async () => { (el as HTMLElement).dispatchEvent(new FocusEvent('focusout', { bubbles: true })); }); };
const focus = async (el: Element | null) => { await act(async () => { (el as HTMLElement).focus(); }); };
// Color de DATO construido en ejecucion (el codigo de tests tampoco lleva literales de color).
const hex = (digits: string) => ['#', digits].join('');

// ------------------------------------------------------------------ temas
const everything = () => h('div', null,
    h(TextInput, { label: 'Nombre', helperText: 'Ayuda', required: true, error: 'Error', placeholder: 'x' }),
    h(TextArea, { label: 'Notas', maxLength: 50, mono: true }),
    h(SelectField, { label: 'Elige', options: OPTIONS, required: true }),
    h(CheckboxField, { label: 'Acepto', error: 'Falta' }),
    h(RadioGroupField, { label: 'Radio', options: OPTIONS, orientation: 'horizontal', defaultValue: 1 }),
    h(ToggleField, { label: 'Activo', defaultValue: true }),
    h(ToggleField, { label: 'Inactivo' }),
    h(SliderField, { label: 'Nivel', defaultValue: 30 }),
    h(DatePickerField, { label: 'Fecha', defaultValue: '2025-01-31' }),
    h(TimePickerField, { label: 'Hora', defaultValue: '10:30' }),
    h(FileInputField, { label: 'Archivos', multiple: true, accept: 'image/*,.pdf', defaultValue: [{ name: 'a.pdf', size: 2048, type: 'application/pdf' }] }),
    h(TagInputField, { label: 'Etiquetas', defaultValue: ['ok@x.com', 'mal'], validate: 'email' }),
    h(ContactPickerField, { label: 'Para', defaultValue: ['a@b.com'], contacts: [{ name: 'Ana', email: 'ana@x.com' }] }),
);
kitSuite('Fields', everything);

describe('ColorPickerField: tema', () => {
    installCleanup();
    // El hex es un DATO del usuario (aparece en value y en el texto): se retira para comprobar el resto del marcado.
    it.each(PALETTES)('sin paleta cruda ni estilos de color (%s)', async (palette) => {
        for (const mode of BRAND_MODES) {
            const css = applyBrand(palette, mode);
            const m = await mount(h(ColorPickerField, { label: 'Color', defaultValue: hex('ff8800') }));
            const clone = m.container.cloneNode(true) as HTMLElement;
            clone.querySelectorAll('input').forEach((i) => i.removeAttribute('value'));
            clone.querySelectorAll('span[aria-hidden]').forEach((s) => { s.textContent = ''; });
            assertThemeSafe(clone, css);
            expect(q('input[type=color]')!.getAttribute('style')).toBeNull();
            await m.unmount();
        }
    });
    it('el hex nunca pinta la interfaz (sin style en ningun nodo)', async () => {
        await mount(h(ColorPickerField, { label: 'Color', value: hex('123456') }));
        expect(qa('[style]')).toHaveLength(0);
        expect(q('span[aria-hidden]')!.textContent).toBe(hex('123456'));
    });
});

// ------------------------------------------------------------------ Field
describe('Field', () => {
    installCleanup();
    it('etiqueta, asterisco, ayuda y error enlazados por id', async () => {
        await mount(h(Field, { label: 'Campo', helperText: 'Pista', error: 'Mal', required: true, children: (a: FieldA11y) => h('input', { id: a.id, 'aria-describedby': a.describedBy, 'aria-invalid': a.invalid || undefined }) }));
        const input = q<HTMLInputElement>('input')!;
        const label = q<HTMLLabelElement>('label')!;
        expect(label.htmlFor).toBe(input.id);
        expect(label.textContent).toContain('*');
        expect(q('label span[aria-hidden=true]')).toBeTruthy();
        const ids = input.getAttribute('aria-describedby')!.split(' ');
        expect(ids).toHaveLength(2);
        expect(document.getElementById(ids[0])!.textContent).toBe('Pista');
        const err = document.getElementById(ids[1])!;
        expect(err.textContent).toBe('Mal');
        expect(err.getAttribute('role')).toBe('alert');
        expect(input.getAttribute('aria-invalid')).toBe('true');
    });
    it('sin ayuda ni error no hay describedby ni alert', async () => {
        await mount(h(Field, { label: 'Campo', children: (a: FieldA11y) => h('input', { id: a.id, 'aria-describedby': a.describedBy }) }));
        expect(q('input')!.getAttribute('aria-describedby')).toBeNull();
        expect(q('[role=alert]')).toBeNull();
    });
});

// ------------------------------------------------------------------ TextInput / TextArea
describe('TextInput', () => {
    installCleanup();
    it('label asociada, required, describedby/invalid con error externo', async () => {
        await mount(h(TextInput, { label: 'Correo', type: 'email', required: true, helperText: 'Tu correo', error: 'Correo no valido' }));
        const input = q<HTMLInputElement>('input')!;
        expect(input.type).toBe('email');
        expect(q<HTMLLabelElement>('label')!.htmlFor).toBe(input.id);
        expect(input.getAttribute('aria-required')).toBe('true');
        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(q('[role=alert]')!.textContent).toBe('Correo no valido');
        expect(input.getAttribute('aria-describedby')!.split(' ')).toContain(q('[role=alert]')!.id);
    });
    it('no controlado y controlado', async () => {
        const fn = vi.fn();
        const m = await mount(h(TextInput, { label: 'N', defaultValue: 'a', onChange: fn }));
        await typeInto(q<HTMLInputElement>('input'), 'hola');
        expect(fn).toHaveBeenLastCalledWith('hola');
        expect(q<HTMLInputElement>('input')!.value).toBe('hola');
        await m.render(h(TextInput, { label: 'N', value: 'fijo', onChange: fn }));
        expect(q<HTMLInputElement>('input')!.value).toBe('fijo');
        await typeInto(q<HTMLInputElement>('input'), 'otro');
        expect(fn).toHaveBeenLastCalledWith('otro');
        expect(q<HTMLInputElement>('input')!.value).toBe('fijo'); // controlado: manda el padre
    });
    it('number entrega number o cadena vacia', async () => {
        const fn = vi.fn();
        await mount(h(TextInput, { label: 'N', type: 'number', min: 1, max: 9, step: 2, onChange: fn }));
        const input = q<HTMLInputElement>('input')!;
        expect([input.min, input.max, input.step]).toEqual(['1', '9', '2']);
        await typeInto(input, '5');
        expect(fn).toHaveBeenLastCalledWith(5);
        await typeInto(input, '');
        expect(fn).toHaveBeenLastCalledWith('');
    });
    it('valida con rules al perder el foco y usa el mensaje propio', async () => {
        await mount(h(TextInput, { label: 'N', rules: { required: true, message: 'Falta nombre' } }));
        expect(q('[role=alert]')).toBeNull();
        await blur(q('input'));
        expect(q('[role=alert]')!.textContent).toBe('Falta nombre');
        expect(q('input')!.getAttribute('aria-invalid')).toBe('true');
        await typeInto(q<HTMLInputElement>('input'), 'Ana');
        expect(q('[role=alert]')).toBeNull();
    });
    it('required del campo + minLength en ingles/espanol', async () => {
        await mount(h(TextInput, { label: 'N', required: true, rules: { minLength: 3 }, defaultValue: 'ab' }));
        await blur(q('input'));
        expect(q('[role=alert]')!.textContent).toBe('Minimo 3 caracteres');
    });
    it('readOnly no cambia; tipo invalido cae a text; sin etiqueta usa placeholder como nombre', async () => {
        const fn = vi.fn();
        await mount(h(TextInput, { type: 'evil' as never, readOnly: true, placeholder: 'Buscar', defaultValue: 'x', onChange: fn }));
        const input = q<HTMLInputElement>('input')!;
        expect(input.type).toBe('text');
        expect(input.getAttribute('aria-label')).toBe('Buscar');
        await typeInto(input, 'y');
        expect(fn).not.toHaveBeenCalled();
    });
    it('props hostiles no rompen ni filtran atributos', async () => {
        await mount(h(TextInput, { label: {} as never, value: { a: 1 } as never, maxLength: 'x' as never, min: NaN, size: 'gigante' as never, placeholder: 5 as never, className: 'evil', style: { color: 'red' }, onChange: 'no' as never } as never));
        const input = q<HTMLInputElement>('input')!;
        expect(input.value).toBe('');
        expect(input.className).not.toContain('evil');
        expect(input.getAttribute('style')).toBeNull();
        await typeInto(input, 'x');
    });
});

describe('TextArea', () => {
    installCleanup();
    it('rows acotadas, contador enlazado y mono', async () => {
        await mount(h(TextArea, { label: 'Notas', rows: 99, maxLength: 20, mono: true, defaultValue: 'hola' }));
        const ta = q<HTMLTextAreaElement>('textarea')!;
        expect(ta.rows).toBe(40);
        expect(ta.maxLength).toBe(20);
        expect(ta.className).toContain('font-mono');
        const counter = document.getElementById(ta.getAttribute('aria-describedby')!)!;
        expect(counter.textContent).toBe('4/20');
        expect(q<HTMLLabelElement>('label')!.htmlFor).toBe(ta.id);
    });
    it('onChange con texto y error accesible', async () => {
        const fn = vi.fn();
        await mount(h(TextArea, { label: 'Notas', onChange: fn, error: 'Mal', helperText: 'Ayuda' }));
        await typeInto(q<HTMLTextAreaElement>('textarea'), 'abc');
        expect(fn).toHaveBeenCalledWith('abc');
        expect(q('textarea')!.getAttribute('aria-invalid')).toBe('true');
        expect(q('textarea')!.getAttribute('aria-describedby')!.split(' ')).toContain(q('[role=alert]')!.id);
    });
    it('hostil', async () => {
        await mount(h(TextArea, { value: [1, 2] as never, rows: 'x' as never, maxLength: -5 }));
        expect(q('textarea')).toBeTruthy();
    });
});

// ------------------------------------------------------------------ SelectField
describe('SelectField', () => {
    installCleanup();
    it('devuelve el valor ORIGINAL (number y string) y muestra el placeholder como primera opcion vacia', async () => {
        const fn = vi.fn();
        await mount(h(SelectField, { label: 'Elige', options: OPTIONS, placeholder: 'Escoge...', onChange: fn }));
        const select = q<HTMLSelectElement>('select')!;
        expect(q<HTMLLabelElement>('label')!.htmlFor).toBe(select.id);
        expect(select.options[0].textContent).toBe('Escoge...');
        expect(select.options[0].value).toBe('');
        expect(select.options[3].disabled).toBe(true);
        await typeInto(select, '0');
        expect(fn).toHaveBeenLastCalledWith(1);
        await typeInto(select, '1');
        expect(fn).toHaveBeenLastCalledWith('dos');
        await typeInto(select, '');
        expect(fn).toHaveBeenLastCalledWith('');
    });
    it('seleccion controlada por valor numerico y valueKey/labelKey heredados', async () => {
        await mount(h(SelectField, { label: 'X', options: [{ id: 7, nombre: 'Siete' }, { id: 8, nombre: 'Ocho' }] as never, valueKey: 'id', labelKey: 'nombre', value: 8 }));
        const select = q<HTMLSelectElement>('select')!;
        expect(select.selectedOptions[0].textContent).toBe('Ocho');
    });
    it('hostil: opciones mal formadas, claves peligrosas, valores objeto', async () => {
        await mount(h(SelectField, { options: [null, 5, 'a', { value: {} }, { label: 'sin valor' }, { value: 'ok', label: 7 }, [1]] as never, valueKey: '__proto__', labelKey: 'constructor', value: {} as never }));
        expect(q('select')).toBeTruthy();
        await mount(h(SelectField, { options: 'nope' as never }));
        await mount(h(SelectField, { options: [{ value: 'a' }, { value: 'b' }] as never, valueKey: 'value; drop', value: 'b' }));
    });
    it('error: invalid + describedby; required', async () => {
        await mount(h(SelectField, { label: 'E', options: OPTIONS, required: true, error: 'Elige una' }));
        const select = q('select')!;
        expect(select.getAttribute('aria-invalid')).toBe('true');
        expect(select.getAttribute('aria-required')).toBe('true');
        expect(select.getAttribute('aria-describedby')).toBe(q('[role=alert]')!.id);
    });
    it('readOnly ignora cambios', async () => {
        const fn = vi.fn();
        await mount(h(SelectField, { options: OPTIONS, readOnly: true, onChange: fn }));
        await typeInto(q<HTMLSelectElement>('select'), '0');
        expect(fn).not.toHaveBeenCalled();
    });
});

// ------------------------------------------------------------------ Checkbox / Radio / Toggle
describe('CheckboxField', () => {
    installCleanup();
    it('label clicable y onChange(boolean)', async () => {
        const fn = vi.fn();
        await mount(h(CheckboxField, { label: 'Acepto', required: true, onChange: fn }));
        const box = q<HTMLInputElement>('input[type=checkbox]')!;
        expect(box.closest('label')!.textContent).toContain('Acepto');
        expect(box.getAttribute('aria-required')).toBe('true');
        await click(q('label'));
        expect(fn).toHaveBeenLastCalledWith(true);
        expect(box.checked).toBe(true);
        await click(box);
        expect(fn).toHaveBeenLastCalledWith(false);
    });
    it('controlado por checked o value, error accesible y required falla si esta desmarcada', async () => {
        await mount(h(CheckboxField, { label: 'A', checked: true }));
        expect(q<HTMLInputElement>('input')!.checked).toBe(true);
        await mount(h(CheckboxField, { label: 'B', value: 'true' as never, required: true, rules: {} }));
        const box = qa<HTMLInputElement>('input')[1];
        expect(box.checked).toBe(false); // un string no es booleano
        await blur(box);
        expect(qa('[role=alert]')).toHaveLength(1);
        expect(box.getAttribute('aria-invalid')).toBe('true');
        expect(box.getAttribute('aria-describedby')).toBe(q('[role=alert]')!.id);
    });
});

describe('RadioGroupField', () => {
    installCleanup();
    it('radiogroup etiquetado, radios nativos con el mismo name y valor original', async () => {
        const fn = vi.fn();
        await mount(h(RadioGroupField, { label: 'Plan', options: OPTIONS, required: true, onChange: fn, helperText: 'Elige' }));
        const group = q('[role=radiogroup]')!;
        expect(group.getAttribute('aria-labelledby')).toBe(q('span[id$="-lbl"]')!.id);
        expect(group.getAttribute('aria-required')).toBe('true');
        const radios = qa<HTMLInputElement>('input[type=radio]');
        expect(radios).toHaveLength(3);
        expect(new Set(radios.map((r) => r.name)).size).toBe(1);
        expect(radios[2].disabled).toBe(true);
        expect(byText('Segunda')).toBeTruthy();
        await click(radios[0]);
        expect(fn).toHaveBeenLastCalledWith(1);
        await click(radios[1]);
        expect(fn).toHaveBeenLastCalledWith('dos');
        expect(radios[1].checked).toBe(true);
        expect(radios[0].checked).toBe(false);
    });
    it('orientation y error', async () => {
        await mount(h(RadioGroupField, { label: 'P', options: ['a', 'b'] as never, orientation: 'horizontal', error: 'Mal' }));
        expect(q('[role=radiogroup]')!.className).toContain('flex-wrap');
        expect(q('[role=radiogroup]')!.getAttribute('aria-invalid')).toBe('true');
        expect(q('[role=radiogroup]')!.getAttribute('aria-describedby')).toBe(q('[role=alert]')!.id);
    });
    it('hostil', async () => {
        await mount(h(RadioGroupField, { options: [{}, null, 3] as never, orientation: 'diagonal' as never, value: {} as never }));
        expect(qa('input[type=radio]')).toHaveLength(1);
    });
});

describe('ToggleField', () => {
    installCleanup();
    it('switch accesible: aria-checked, etiqueta, clic y teclado', async () => {
        const fn = vi.fn();
        await mount(h(ToggleField, { label: 'Notificar', onChange: fn }));
        const sw = q<HTMLButtonElement>('[role=switch]')!;
        expect(sw.getAttribute('aria-checked')).toBe('false');
        expect(sw.getAttribute('aria-labelledby')).toBe(q('span[id$="-lbl"]')!.id);
        expect(sw.className).toContain('bg-input');
        await click(sw);
        expect(fn).toHaveBeenLastCalledWith(true);
        expect(sw.getAttribute('aria-checked')).toBe('true');
        expect(sw.className).toContain('bg-primary');
        await key(sw, ' ');
        expect(fn).toHaveBeenLastCalledWith(false);
        await key(sw, 'Enter');
        expect(fn).toHaveBeenLastCalledWith(true);
        await key(sw, 'a');
        expect(fn).toHaveBeenCalledTimes(3);
        await click(q('span[id$="-lbl"]'));
        expect(fn).toHaveBeenLastCalledWith(false);
    });
    it('disabled/readOnly no alternan; error enlazado', async () => {
        const fn = vi.fn();
        await mount(h(ToggleField, { label: 'A', readOnly: true, onChange: fn, error: 'Mal' }));
        const sw = q('[role=switch]')!;
        await click(sw); await key(sw, ' ');
        expect(fn).not.toHaveBeenCalled();
        expect(sw.getAttribute('aria-describedby')).toBe(q('[role=alert]')!.id);
        expect(sw.getAttribute('aria-invalid')).toBe('true');
    });
});

// ------------------------------------------------------------------ Slider / Date / Time / Color
describe('SliderField', () => {
    installCleanup();
    it('range nativo con min/max/step, salida y onChange numerico', async () => {
        const fn = vi.fn();
        await mount(h(SliderField, { label: 'Volumen', min: 10, max: 50, step: 5, defaultValue: 20, onChange: fn }));
        const r = q<HTMLInputElement>('input[type=range]')!;
        expect([r.min, r.max, r.step, r.value]).toEqual(['10', '50', '5', '20']);
        expect(q<HTMLLabelElement>('label')!.htmlFor).toBe(r.id);
        expect(q('output')!.textContent).toBe('20');
        expect(r.className).toContain('accent-primary');
        await typeInto(r, '35');
        expect(fn).toHaveBeenLastCalledWith(35);
        expect(q('output')!.textContent).toBe('35');
    });
    it('showValue=false oculta la salida; rango invalido y valores raros se sanean', async () => {
        await mount(h(SliderField, { label: 'S', showValue: false, min: 9, max: 1, step: -3, value: 'abc' as never }));
        expect(q('output')).toBeNull();
        const r = q<HTMLInputElement>('input[type=range]')!;
        expect([r.min, r.max, r.step]).toEqual(['0', '100', '1']);
    });
});

describe('DatePickerField / TimePickerField', () => {
    installCleanup();
    it('fecha AAAA-MM-DD con min/max; valores invalidos se ignoran', async () => {
        const fn = vi.fn();
        await mount(h(DatePickerField, { label: 'Fecha', min: '2025-01-01', max: 'mañana', defaultValue: '2025-02-03', onChange: fn }));
        const d = q<HTMLInputElement>('input[type=date]')!;
        expect(d.value).toBe('2025-02-03');
        expect(d.min).toBe('2025-01-01');
        expect(d.max).toBe('');
        expect(q<HTMLLabelElement>('label')!.htmlFor).toBe(d.id);
        await typeInto(d, '2025-03-04');
        expect(fn).toHaveBeenLastCalledWith('2025-03-04');
        await mount(h(DatePickerField, { value: '03/04/2025' }));
        expect(qa<HTMLInputElement>('input[type=date]')[1].value).toBe('');
    });
    it('hora HH:MM con step', async () => {
        const fn = vi.fn();
        await mount(h(TimePickerField, { label: 'Hora', step: 900, defaultValue: '09:15', onChange: fn, error: 'Mal' }));
        const t = q<HTMLInputElement>('input[type=time]')!;
        expect(t.step).toBe('900');
        expect(t.value).toBe('09:15');
        expect(t.getAttribute('aria-invalid')).toBe('true');
        await typeInto(t, '10:45');
        expect(fn).toHaveBeenLastCalledWith('10:45');
    });
});

describe('ColorPickerField', () => {
    installCleanup();
    it('entrega el hex como dato; defecto generado en ejecucion; normaliza #rgb; rechaza basura', async () => {
        const fn = vi.fn();
        await mount(h(ColorPickerField, { label: 'Color', onChange: fn }));
        const c = q<HTMLInputElement>('input[type=color]')!;
        expect(c.value).toBe(hex('000000'));
        await typeInto(c, hex('ff0000'));
        expect(fn).toHaveBeenLastCalledWith(hex('ff0000'));
        expect(q('span[aria-hidden]')!.textContent).toBe(hex('ff0000'));
        await mount(h(ColorPickerField, { value: hex('abc') }));
        expect(qa<HTMLInputElement>('input[type=color]')[1].value).toBe(hex('aabbcc'));
        await mount(h(ColorPickerField, { value: 'rojo' }));
        expect(qa<HTMLInputElement>('input[type=color]')[2].value).toBe(hex('000000'));
        expect(q<HTMLLabelElement>('label')!.htmlFor).toBe(c.id);
    });
    it('el codigo fuente no contiene literales de color (guardia)', async () => {
        const fs = await import('node:fs');
        const src = fs.readFileSync(require.resolve('../Fields.tsx'), 'utf8');
        expect(src.match(RAW_LITERAL) ?? []).toEqual([]);
    });
});

// ------------------------------------------------------------------ FileInputField
function pickFiles(input: HTMLInputElement, files: File[]) {
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    return act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((r) => setTimeout(r, 20)); });
}
const fileOf = (name: string, bytes: number | string, type = 'text/plain') => new File([typeof bytes === 'number' ? new Uint8Array(bytes) : bytes], name, { type });

describe('FileInputField', () => {
    installCleanup();
    it('boton accesible con la etiqueta, input oculto y lista con boton quitar', async () => {
        const fn = vi.fn();
        await mount(h(FileInputField, { label: 'Adjuntos', multiple: true, onChange: fn }));
        const btn = q<HTMLButtonElement>('button')!;
        expect(btn.textContent).toBe('Elegir archivos');
        expect(btn.getAttribute('aria-labelledby')!.split(' ')).toEqual([btn.id, q('span[id$="-lbl"]')!.id]);
        const input = q<HTMLInputElement>('input[type=file]')!;
        expect(input.className).toContain('sr-only');
        expect(input.multiple).toBe(true);
        await pickFiles(input, [fileOf('a.txt', 10), fileOf('b.txt', 20)]);
        expect(fn).toHaveBeenLastCalledWith([{ name: 'a.txt', size: 10, type: 'text/plain' }, { name: 'b.txt', size: 20, type: 'text/plain' }]);
        expect(qa('li')).toHaveLength(2);
        await click(q('button[aria-label="Quitar a.txt"]'));
        expect(fn).toHaveBeenLastCalledWith([{ name: 'b.txt', size: 20, type: 'text/plain' }]);
        expect(qa('li')).toHaveLength(1);
    });
    it('rechaza archivos por encima de maxSizeMb con mensaje accesible', async () => {
        const fn = vi.fn();
        await mount(h(FileInputField, { label: 'Adjuntos', maxSizeMb: 0.01, onChange: fn }));
        await pickFiles(q<HTMLInputElement>('input[type=file]')!, [fileOf('grande.bin', 20_000)]);
        expect(fn).not.toHaveBeenCalled();
        const alert = q('[role=alert]')!;
        expect(alert.textContent).toContain('grande.bin');
        expect(alert.textContent).toContain('El archivo supera el limite');
        expect(q('button')!.getAttribute('aria-invalid')).toBe('true');
        await pickFiles(q<HTMLInputElement>('input[type=file]')!, [fileOf('chico.bin', 100)]);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(q('[role=alert]')).toBeNull();
    });
    it('readAs base64 y text entregan content', async () => {
        const fn = vi.fn();
        await mount(h(FileInputField, { label: 'A', readAs: 'base64', onChange: fn }));
        await pickFiles(q<HTMLInputElement>('input[type=file]')!, [fileOf('h.txt', 'hola')]);
        expect(fn).toHaveBeenLastCalledWith([{ name: 'h.txt', size: 4, type: 'text/plain', content: btoa('hola') }]);
        const fn2 = vi.fn();
        await mount(h(FileInputField, { label: 'B', readAs: 'text', onChange: fn2 }));
        await pickFiles(qa<HTMLInputElement>('input[type=file]')[1], [fileOf('h.txt', 'hola')]);
        expect(fn2).toHaveBeenLastCalledWith([{ name: 'h.txt', size: 4, type: 'text/plain', content: 'hola' }]);
    });
    it('sin multiple solo entrega el primero y acepta soltar archivos (drop) filtrando por accept', async () => {
        const fn = vi.fn();
        await mount(h(FileInputField, { label: 'A', accept: 'image/*,.pdf', onChange: fn }));
        const zone = q('.border-dashed')!;
        await act(async () => {
            const ev = new Event('drop', { bubbles: true, cancelable: true });
            Object.defineProperty(ev, 'dataTransfer', { value: { files: [fileOf('x.exe', 5, 'application/x-msdownload'), fileOf('y.png', 5, 'image/png'), fileOf('z.pdf', 5, 'application/pdf')] } });
            zone.dispatchEvent(ev);
            await new Promise((r) => setTimeout(r, 20));
        });
        expect(fn).toHaveBeenLastCalledWith([{ name: 'y.png', size: 5, type: 'image/png' }]);
        expect(q('[role=alert]')!.textContent).toContain('x.exe');
    });
    it('hostil: value no-arreglo, accept enorme, maxSizeMb invalido; disabled oculta quitar', async () => {
        await mount(h(FileInputField, { value: 'x' as never, accept: 'a'.repeat(500), maxSizeMb: 'x' as never }));
        expect(qa('li')).toHaveLength(0);
        await mount(h(FileInputField, { label: 'D', disabled: true, value: [{ name: 'a.txt', size: 3, type: '' }, null, 5] as never }));
        expect(qa('li')).toHaveLength(1);
        expect(qa('button[aria-label^="Quitar"]')).toHaveLength(0);
    });
});

// ------------------------------------------------------------------ TagInputField
describe('TagInputField', () => {
    installCleanup();
    const input = () => q<HTMLInputElement>('input[type=text], input[role=combobox]')!;

    it('Enter y coma anaden; Retroceso en vacio quita; duplicados y max', async () => {
        const fn = vi.fn();
        await mount(h(TagInputField, { label: 'Tags', max: 3, onChange: fn }));
        expect(q<HTMLLabelElement>('label')!.htmlFor).toBe(input().id);
        await typeInto(input(), 'uno');
        await key(input(), 'Enter');
        expect(fn).toHaveBeenLastCalledWith(['uno']);
        expect(input().value).toBe('');
        await typeInto(input(), 'dos,');
        expect(fn).toHaveBeenLastCalledWith(['uno', 'dos']);
        await typeInto(input(), 'UNO');
        await key(input(), 'Enter');
        expect(fn).toHaveBeenCalledTimes(2); // duplicado ignorado
        await typeInto(input(), 'tres');
        await key(input(), 'Enter');
        await typeInto(input(), 'cuatro');
        await key(input(), 'Enter');
        expect(fn).toHaveBeenLastCalledWith(['uno', 'dos', 'tres']); // max
        await typeInto(input(), 'x');
        await key(input(), 'Backspace');
        expect(fn).toHaveBeenLastCalledWith(['uno', 'dos', 'tres']); // hay texto: no quita
        await typeInto(input(), '');
        await key(input(), 'Backspace');
        expect(fn).toHaveBeenLastCalledWith(['uno', 'dos']);
    });
    it('pegar con comas/espacios divide en etiquetas', async () => {
        const fn = vi.fn();
        await mount(h(TagInputField, { label: 'Tags', onChange: fn }));
        await act(async () => {
            const ev = new Event('paste', { bubbles: true, cancelable: true });
            Object.defineProperty(ev, 'clipboardData', { value: { getData: () => 'a, b  c;d' } });
            input().dispatchEvent(ev);
        });
        expect(fn).toHaveBeenLastCalledWith(['a', 'b', 'c', 'd']);
    });
    it('chips con boton quitar accesible', async () => {
        const fn = vi.fn();
        await mount(h(TagInputField, { label: 'Tags', defaultValue: ['x', 'y'], onChange: fn }));
        await click(q('button[aria-label="Quitar x"]'));
        expect(fn).toHaveBeenLastCalledWith(['y']);
    });
    it('validate=email marca las invalidas (borde destructive + aria-invalid) y el campo queda invalido', async () => {
        await mount(h(TagInputField, { label: 'Para', validate: 'email', defaultValue: ['ok@x.com', 'mal'] }));
        const chips = qa('li[aria-invalid], li');
        const bad = chips.find((c) => c.textContent?.includes('mal'))!;
        const good = chips.find((c) => c.textContent?.includes('ok@x.com'))!;
        expect(bad.getAttribute('aria-invalid')).toBe('true');
        expect(bad.className).toContain('border-destructive');
        expect(good.getAttribute('aria-invalid')).toBeNull();
        expect(input().getAttribute('aria-invalid')).toBe('true');
        expect(q('[role=alert]')!.textContent).toBe('Escribe un correo valido');
    });
    it('sugerencias: combobox accesible, filtradas, flechas/Enter/Escape', async () => {
        const fn = vi.fn();
        await mount(h(TagInputField, { label: 'Tags', suggestions: ['rojo', 'rosa', 'azul', 7 as never], onChange: fn }));
        const i = input();
        expect(i.getAttribute('role')).toBe('combobox');
        expect(i.getAttribute('aria-expanded')).toBe('false');
        await focus(i);
        await typeInto(i, 'ro');
        expect(i.getAttribute('aria-expanded')).toBe('true');
        const list = q('[role=listbox]')!;
        expect(i.getAttribute('aria-controls')).toBe(list.id);
        expect(qa('[role=option]', list).map((o) => o.textContent)).toEqual(['rojo', 'rosa']);
        await key(i, 'ArrowDown');
        await key(i, 'ArrowDown');
        expect(i.getAttribute('aria-activedescendant')).toBe(qa('[role=option]')[1].id);
        expect(qa('[role=option]')[1].getAttribute('aria-selected')).toBe('true');
        await key(i, 'ArrowUp');
        await key(i, 'Enter');
        expect(fn).toHaveBeenLastCalledWith(['rojo']);
        await typeInto(i, 'az');
        expect(q('[role=listbox]')).toBeTruthy();
        await key(i, 'Escape');
        expect(q('[role=listbox]')).toBeNull();
        expect(i.getAttribute('aria-expanded')).toBe('false');
    });
    it('sin suggestions no es combobox; hostil', async () => {
        await mount(h(TagInputField, { value: 'nope' as never, max: 'x' as never, suggestions: 'no' as never, validate: 'evil' as never }));
        expect(q('[role=combobox]')).toBeNull();
        expect(qa('li')).toHaveLength(0);
    });
    it('error externo y rules por etiquetas (minItems) al perder el foco', async () => {
        await mount(h(TagInputField, { label: 'T', rules: { minItems: 2 }, defaultValue: ['a'] }));
        await blur(input());
        expect(q('[role=alert]')!.textContent).toBe('Elige al menos 2');
        expect(input().getAttribute('aria-describedby')).toBe(q('[role=alert]')!.id);
    });
});

// ------------------------------------------------------------------ ContactPickerField
describe('ContactPickerField (contactos locales)', () => {
    installCleanup();
    const contacts = [{ name: 'Ana Perez', email: 'ana@x.com' }, { name: 'Beto', email: 'beto@x.com' }, { email: 'malo' }, null as never];
    const combo = () => q<HTMLInputElement>('[role=combobox]')!;

    it('combobox ARIA, filtra, flechas + Enter eligen y muestra nombre + correo', async () => {
        const fn = vi.fn();
        await mount(h(ContactPickerField, { label: 'Para', contacts, onChange: fn }));
        const c = combo();
        expect(q<HTMLLabelElement>('label')!.htmlFor).toBe(c.id);
        expect(c.getAttribute('aria-expanded')).toBe('false');
        await focus(c);
        expect(c.getAttribute('aria-expanded')).toBe('true');
        expect(qa('[role=option]')).toHaveLength(2); // el correo invalido y el nulo no aparecen
        expect(c.getAttribute('aria-controls')).toBe(q('[role=listbox]')!.id);
        await typeInto(c, 'bet');
        expect(qa('[role=option]')).toHaveLength(1);
        await key(c, 'ArrowDown');
        expect(c.getAttribute('aria-activedescendant')).toBe(qa('[role=option]')[0].id);
        await key(c, 'Enter');
        expect(fn).toHaveBeenLastCalledWith(['beto@x.com']);
        const chip = q('ul li')!;
        expect(chip.textContent).toContain('Beto');
        expect(chip.textContent).toContain('beto@x.com');
        expect(q('[role=listbox]')).toBeNull();
    });
    it('Escape cierra; Retroceso en vacio quita el ultimo; boton quitar accesible', async () => {
        const fn = vi.fn();
        await mount(h(ContactPickerField, { label: 'Para', contacts, defaultValue: ['ana@x.com', 'beto@x.com'], onChange: fn }));
        const c = combo();
        await focus(c);
        expect(q('[role=listbox]')).toBeNull(); // ya estan elegidos: no quedan opciones
        await typeInto(c, '');
        await key(c, 'Backspace');
        expect(fn).toHaveBeenLastCalledWith(['ana@x.com']);
        await click(q('button[aria-label="Quitar ana@x.com"]'));
        expect(fn).toHaveBeenLastCalledWith([]);
        await focus(c);
        expect(q('[role=listbox]')).toBeTruthy();
        await key(c, 'Escape');
        expect(q('[role=listbox]')).toBeNull();
        expect(c.getAttribute('aria-expanded')).toBe('false');
    });
    it('permite escribir un correo valido libre + Enter; uno invalido no se anade', async () => {
        const fn = vi.fn();
        await mount(h(ContactPickerField, { label: 'Para', onChange: fn }));
        const c = combo();
        await typeInto(c, 'nuevo@dominio.com');
        await key(c, 'Enter');
        expect(fn).toHaveBeenLastCalledWith(['nuevo@dominio.com']);
        await typeInto(c, 'invalido');
        await key(c, 'Enter');
        expect(fn).toHaveBeenCalledTimes(1);
    });
    it('multiple=false reemplaza; max limita', async () => {
        const fn = vi.fn();
        await mount(h(ContactPickerField, { label: 'Uno', multiple: false, contacts, defaultValue: ['ana@x.com'], onChange: fn }));
        await typeInto(combo(), 'beto');
        await key(combo(), 'ArrowDown');
        await key(combo(), 'Enter');
        expect(fn).toHaveBeenLastCalledWith(['beto@x.com']);
        const fn2 = vi.fn();
        await mount(h(ContactPickerField, { label: 'Max', max: 1, defaultValue: ['a@b.com'], onChange: fn2 }));
        const c2 = qa<HTMLInputElement>('[role=combobox]')[1];
        await typeInto(c2, 'otro@b.com');
        await key(c2, 'Enter');
        expect(fn2).not.toHaveBeenCalled();
    });
    it('click en opcion elige; error accesible; hostil', async () => {
        const fn = vi.fn();
        await mount(h(ContactPickerField, { label: 'Para', contacts, onChange: fn, error: 'Falta' }));
        expect(combo().getAttribute('aria-invalid')).toBe('true');
        expect(combo().getAttribute('aria-describedby')).toBe(q('[role=alert]')!.id);
        await focus(combo());
        await click(qa('[role=option]')[0]);
        expect(fn).toHaveBeenLastCalledWith(['ana@x.com']);
        await mount(h(ContactPickerField, { value: { x: 1 } as never, contacts: 'no' as never, max: -1, loadSuggestions: 'x' as never }));
    });
});

describe('ContactPickerField (loadSuggestions)', () => {
    installCleanup();
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });
    const combo = () => q<HTMLInputElement>('[role=combobox]')!;
    const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

    it('debounce de 200 ms: solo la ultima consulta llega al servidor', async () => {
        const load = vi.fn(async (query: string) => [{ name: `Res ${query}`, email: `${query}@x.com` }]);
        await mount(h(ContactPickerField, { label: 'Para', loadSuggestions: load }));
        await focus(combo());
        await typeInto(combo(), 'a');
        await advance(100);
        await typeInto(combo(), 'ab');
        await advance(100);
        await typeInto(combo(), 'abc');
        await advance(199);
        expect(load).not.toHaveBeenCalled();
        await advance(1);
        expect(load).toHaveBeenCalledTimes(1);
        expect(load).toHaveBeenCalledWith('abc');
        expect(qa('[role=option]').map((o) => o.textContent)).toEqual(['Res abcabc@x.com']);
        expect(combo().getAttribute('aria-expanded')).toBe('true');
    });
    it('descarta respuestas viejas (la lenta no pisa a la reciente)', async () => {
        const resolvers: Record<string, (v: Array<{ email: string }>) => void> = {};
        const load = vi.fn((query: string) => new Promise<Array<{ email: string }>>((r) => { resolvers[query] = r; }));
        await mount(h(ContactPickerField, { label: 'Para', loadSuggestions: load }));
        await focus(combo());
        await typeInto(combo(), 'a');
        await advance(200);
        await typeInto(combo(), 'ab');
        await advance(200);
        expect(load).toHaveBeenCalledTimes(3 - 1 + 0 || 2);
        await act(async () => { resolvers['ab']([{ email: 'nuevo@x.com' }]); });
        await act(async () => { resolvers['a']([{ email: 'viejo@x.com' }]); });
        expect(qa('[role=option]').map((o) => o.textContent)).toEqual(['nuevo@x.com']);
    });
    it('elige con teclado desde resultados remotos; el rechazo de la promesa no rompe', async () => {
        const fn = vi.fn();
        const load = vi.fn(async (query: string) => { if (query === 'boom') throw new Error('x'); return [{ name: 'Remota', email: 'remota@x.com' }, { email: 'no-valido' }]; });
        await mount(h(ContactPickerField, { label: 'Para', loadSuggestions: load, onChange: fn }));
        await focus(combo());
        await typeInto(combo(), 'r');
        await advance(200);
        expect(qa('[role=option]')).toHaveLength(1);
        await key(combo(), 'ArrowDown');
        await key(combo(), 'Enter');
        expect(fn).toHaveBeenLastCalledWith(['remota@x.com']);
        expect(q('ul li')!.textContent).toContain('Remota');
        await typeInto(combo(), 'boom');
        await advance(200);
        expect(q('[role=listbox]')).toBeNull();
        expect(combo()).toBeTruthy();
    });
    it('muestra estado de carga accesible mientras espera', async () => {
        const load = vi.fn(() => new Promise<never[]>(() => { /* nunca responde */ }));
        await mount(h(ContactPickerField, { label: 'Para', loadSuggestions: load }));
        await focus(combo());
        await typeInto(combo(), 'x');
        await advance(200);
        expect(q('[role=status]')!.textContent).toBe('Cargando...');
    });
});

// ------------------------------------------------------------------ onBlur comun, datetime-local, onFiles
describe('onBlur comun', () => {
    installCleanup();
    it('se dispara al perder el foco cada control simple', async () => {
        const fn = vi.fn();
        const cases: Array<[string, React.ReactElement, string]> = [
            ['TextInput', h(TextInput, { label: 'a', onBlur: fn }), 'input'],
            ['TextArea', h(TextArea, { label: 'a', onBlur: fn }), 'textarea'],
            ['Select', h(SelectField, { label: 'a', options: OPTIONS, onBlur: fn }), 'select'],
            ['Checkbox', h(CheckboxField, { label: 'a', onBlur: fn }), 'input'],
            ['Toggle', h(ToggleField, { label: 'a', onBlur: fn }), '[role=switch]'],
            ['Slider', h(SliderField, { label: 'a', onBlur: fn }), 'input'],
            ['Date', h(DatePickerField, { label: 'a', onBlur: fn }), 'input'],
            ['Time', h(TimePickerField, { label: 'a', onBlur: fn }), 'input'],
            ['Color', h(ColorPickerField, { label: 'a', onBlur: fn }), 'input'],
        ];
        for (const [name, el, sel] of cases) {
            fn.mockClear();
            const m = await mount(el);
            await blur(q(sel));
            expect(fn, name).toHaveBeenCalledTimes(1);
            await m.unmount();
        }
    });
    it('en compuestos solo cuando el foco sale del conjunto', async () => {
        const fn = vi.fn();
        await mount(h(RadioGroupField, { label: 'R', options: OPTIONS, onBlur: fn }));
        const [r1, r2] = qa<HTMLInputElement>('input[type=radio]');
        await act(async () => { r1.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: r2 })); });
        expect(fn).not.toHaveBeenCalled();
        await blur(r1);
        expect(fn).toHaveBeenCalledTimes(1);

        const fn2 = vi.fn();
        await mount(h(TagInputField, { label: 'T', defaultValue: ['a'], onBlur: fn2 }));
        const tagInput = q<HTMLInputElement>('input[type=text]')!;
        const chipBtn = q<HTMLButtonElement>('button[aria-label="Quitar a"]')!;
        await act(async () => { tagInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: chipBtn })); });
        expect(fn2).not.toHaveBeenCalled();
        await blur(tagInput);
        expect(fn2).toHaveBeenCalledTimes(1);

        const fn3 = vi.fn();
        await mount(h(ContactPickerField, { label: 'C', onBlur: fn3 }));
        await blur(qa('[role=combobox]')[0]);
        expect(fn3).toHaveBeenCalledTimes(1);

        const fn4 = vi.fn();
        await mount(h(FileInputField, { label: 'F', onBlur: fn4 }));
        await blur(qa('button').pop()!);
        expect(fn4).toHaveBeenCalledTimes(1);
    });
});

describe('TextInput type=datetime-local', () => {
    installCleanup();
    it('valor AAAA-MM-DDTHH:mm; invalido se ignora; min/max solo con formato valido', async () => {
        const fn = vi.fn();
        await mount(h(TextInput, { label: 'Cuando', type: 'datetime-local', defaultValue: '2025-03-04T10:30', min: '2025-01-01T00:00', max: 'nunca', maxLength: 5, onChange: fn }));
        const input = q<HTMLInputElement>('input')!;
        expect(input.type).toBe('datetime-local');
        expect(input.value).toBe('2025-03-04T10:30');
        expect(input.min).toBe('2025-01-01T00:00');
        expect(input.max).toBe('');
        expect(input.getAttribute('maxlength')).toBeNull();
        await typeInto(input, '2025-05-06T07:08');
        expect(fn).toHaveBeenLastCalledWith('2025-05-06T07:08');
        await mount(h(TextInput, { type: 'datetime-local', value: 'ayer' }));
        expect(qa<HTMLInputElement>('input')[1].value).toBe('');
    });
});

describe('FileInputField onFiles', () => {
    installCleanup();
    it('entrega los File crudos aceptados ademas de los descriptores', async () => {
        const onFiles = vi.fn();
        const onChange = vi.fn();
        await mount(h(FileInputField, { label: 'A', multiple: true, maxSizeMb: 0.01, onFiles, onChange }));
        const ok = fileOf('ok.txt', 10);
        await pickFiles(q<HTMLInputElement>('input[type=file]')!, [ok, fileOf('grande.bin', 20_000)]);
        expect(onFiles).toHaveBeenCalledTimes(1);
        expect(onFiles.mock.calls[0][0]).toEqual([ok]);
        expect(onFiles.mock.calls[0][0][0]).toBeInstanceOf(File);
        expect(onChange).toHaveBeenLastCalledWith([{ name: 'ok.txt', size: 10, type: 'text/plain' }]);
    });
});
