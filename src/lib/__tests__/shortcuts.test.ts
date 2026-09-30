import { describe, it, expect } from 'vitest';
import { resolveShortcutKey, isEditableTarget } from '../shortcuts';

const el = (tagName: string, extra: Record<string, any> = {}) => ({
    tagName,
    isContentEditable: false,
    getAttribute: (n: string) => extra[n] ?? null,
    ...extra,
});

describe('resolveShortcutKey', () => {
    it('normaliza a minusculas sobre elementos neutros', () => {
        expect(resolveShortcutKey({ key: 'J', target: el('BODY') })).toBe('j');
        expect(resolveShortcutKey({ key: 'Escape', target: el('DIV') })).toBe('escape');
    });

    it('ignora input, textarea, select, contentEditable y role=textbox', () => {
        expect(resolveShortcutKey({ key: 'j', target: el('INPUT') })).toBeNull();
        expect(resolveShortcutKey({ key: 'j', target: el('TEXTAREA') })).toBeNull();
        expect(resolveShortcutKey({ key: 'j', target: el('SELECT') })).toBeNull();
        expect(resolveShortcutKey({ key: 'j', target: el('DIV', { isContentEditable: true }) })).toBeNull();
        expect(resolveShortcutKey({ key: 'j', target: el('DIV', { role: 'textbox' }) })).toBeNull();
    });

    it('Escape dentro de un input solo si se permite', () => {
        expect(resolveShortcutKey({ key: 'Escape', target: el('INPUT') })).toBeNull();
        expect(resolveShortcutKey({ key: 'Escape', target: el('INPUT') }, { allowEscapeInInputs: true })).toBe('escape');
    });

    it('ignora modificadores, IME y eventos ya manejados', () => {
        expect(resolveShortcutKey({ key: 'c', ctrlKey: true, target: el('BODY') })).toBeNull();
        expect(resolveShortcutKey({ key: 'c', metaKey: true, target: el('BODY') })).toBeNull();
        expect(resolveShortcutKey({ key: 'c', altKey: true, target: el('BODY') })).toBeNull();
        expect(resolveShortcutKey({ key: 'c', isComposing: true, target: el('BODY') })).toBeNull();
        expect(resolveShortcutKey({ key: 'c', defaultPrevented: true, target: el('BODY') })).toBeNull();
    });

    it('con un dialogo abierto no dispara nada (no borra correo con Settings abierto)', () => {
        expect(resolveShortcutKey({ key: 'Backspace', target: el('BODY') }, { modalOpen: true })).toBeNull();
    });

    it('Enter sobre botones/enlaces se deja al navegador; sobre una fila enfocable si dispara', () => {
        expect(resolveShortcutKey({ key: 'Enter', target: el('BUTTON') })).toBeNull();
        expect(resolveShortcutKey({ key: 'Enter', target: el('A') })).toBeNull();
        expect(resolveShortcutKey({ key: 'Enter', target: el('DIV', { role: 'button' }) })).toBeNull();
        expect(resolveShortcutKey({ key: 'Enter', target: el('DIV', { tabIndex: 0 }) })).toBe('enter');
    });
});

describe('isEditableTarget', () => {
    it('null/undefined no es editable', () => {
        expect(isEditableTarget(null)).toBe(false);
        expect(isEditableTarget(undefined)).toBe(false);
    });
});
