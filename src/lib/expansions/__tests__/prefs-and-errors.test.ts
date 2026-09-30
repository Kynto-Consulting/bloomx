// @vitest-environment jsdom
/**
 * Preferencias por usuario (desactivar/ordenar) y registro de errores de extensiones.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    EMPTY_PREFS, EXTENSION_PREFS_SETTINGS_KEY, __resetPrefsStore, activatePrefsUser, applyPrefsToExtensions, getPrefs, normalizePrefs, orderIds, pullPrefsFromServer,
    pushPrefsToServer, setPrefs, subscribePrefs, withEnabled, withMoved,
} from '../client/prefs';
import { __resetExtensionErrors, clearExtensionErrors, getExtensionErrors, reportExtensionError, subscribeExtensionErrors } from '../client/error-log';

beforeEach(() => { window.localStorage.clear(); __resetPrefsStore(); __resetExtensionErrors(); vi.spyOn(console, 'warn').mockImplementation(() => { }); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('preferencias de extensiones por usuario', () => {
    it('normalizePrefs descarta basura, ids invalidos, duplicados y limita el tamano', () => {
        expect(normalizePrefs(null)).toEqual({ disabled: [], order: [], pins: {} });
        expect(normalizePrefs('x')).toEqual({ disabled: [], order: [], pins: {} });
        expect(normalizePrefs({ disabled: ['a', 'a', 7, '<script>', 'b b', 'core-x'], order: 'no' })).toEqual({ disabled: ['a', 'core-x'], order: [], pins: {} });
        expect(normalizePrefs({ disabled: Array.from({ length: 500 }, (_, i) => `e${i}`) }).disabled).toHaveLength(200);
    });

    it('activar/desactivar y orden son inmutables y aplican a la lista de extensiones', () => {
        const a = withEnabled(EMPTY_PREFS, 'core-zoom', false);
        expect(EMPTY_PREFS.disabled).toEqual([]);
        expect(a.disabled).toEqual(['core-zoom']);
        expect(withEnabled(a, 'core-zoom', true).disabled).toEqual([]);
        expect(withEnabled(EMPTY_PREFS, 'no valido!', false)).toBe(EMPTY_PREFS);
        const ids = ['a', 'b', 'c', 'd'];
        const moved = withMoved(EMPTY_PREFS, ids, 'c', -1);
        expect(moved.order).toEqual(['a', 'c', 'b', 'd']);
        expect(withMoved(moved, ids, 'a', -1)).toBe(moved); // ya es el primero
        expect(orderIds(['a', 'b', 'nueva'], { disabled: [], order: ['b', 'zzz', 'a'] })).toEqual(['b', 'a', 'nueva']);
        const list = applyPrefsToExtensions([{ id: 'a' }, { id: 'b' }, { id: 'c' }], { disabled: ['a'], order: ['c', 'b'] });
        expect(list.map((e) => e.id)).toEqual(['c', 'b']);
    });

    it('el almacen persiste por usuario en localStorage y notifica a los suscriptores', () => {
        const listener = vi.fn();
        activatePrefsUser('u1');
        const off = subscribePrefs(listener);
        setPrefs({ disabled: ['core-zoom'], order: ['core-giphy'] }, { sync: false });
        expect(listener).toHaveBeenCalled();
        expect(getPrefs().disabled).toEqual(['core-zoom']);
        expect(JSON.parse(window.localStorage.getItem('bloomx:ext-prefs:v1:u1')!)).toMatchObject({ disabled: ['core-zoom'] });
        activatePrefsUser('u2');
        expect(getPrefs()).toEqual({ disabled: [], order: [], pins: {} }); // otro usuario: sus propias preferencias
        activatePrefsUser('u1');
        expect(getPrefs().disabled).toEqual(['core-zoom']);
        off();
    });

    it('sincroniza con el servidor sin pisar los demas ajustes', async () => {
        const calls: Array<{ url: string; init?: RequestInit }> = [];
        const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
            calls.push({ url, init });
            if (!init) return { ok: true, json: async () => ({ expansionSettings: { 'core-notion': { token: 'x' } } }) } as any;
            return { ok: true } as any;
        });
        expect(await pushPrefsToServer({ disabled: ['a'], order: [] }, fetchMock as any)).toBe(true);
        const body = JSON.parse(String(calls[1].init!.body));
        expect(body.expansionSettings['core-notion']).toEqual({ token: 'x' });
        expect(body.expansionSettings[EXTENSION_PREFS_SETTINGS_KEY]).toEqual({ disabled: ['a'], order: [] });
        expect(calls[1].init!.method).toBe('POST');
        const pulled = await pullPrefsFromServer((async () => ({ ok: true, json: async () => ({ expansionSettings: { [EXTENSION_PREFS_SETTINGS_KEY]: { disabled: ['z', '<x>'] } } }) })) as any);
        expect(pulled).toEqual({ disabled: ['z'], order: [], pins: {} });
        expect(await pullPrefsFromServer((async () => ({ ok: false })) as any)).toBeNull();
        expect(await pushPrefsToServer(EMPTY_PREFS, (async () => { throw new Error('offline'); }) as any)).toBe(false);
    });
});

describe('registro de errores de extensiones', () => {
    it('agrupa repetidos, ordena por reciente, persiste y notifica', () => {
        const listener = vi.fn();
        const off = subscribeExtensionErrors(listener);
        reportExtensionError({ extensionId: 'core-a', kind: 'validation', message: 'Valor no permitido', path: 'mounts[0].component.props.tone' });
        reportExtensionError({ extensionId: 'core-a', kind: 'validation', message: 'Valor no permitido', path: 'mounts[0].component.props.tone' });
        reportExtensionError({ extensionId: 'core-b', kind: 'action', message: 'save: Sin permiso' });
        expect(listener).toHaveBeenCalledTimes(3);
        expect(getExtensionErrors()).toHaveLength(2);
        expect(getExtensionErrors('core-a')[0]).toMatchObject({ count: 2, path: 'mounts[0].component.props.tone' });
        expect(JSON.parse(window.localStorage.getItem('bloomx:ext-errors:v1')!)).toHaveLength(2);
        clearExtensionErrors('core-a');
        expect(getExtensionErrors().map((e) => e.extensionId)).toEqual(['core-b']);
        clearExtensionErrors();
        expect(getExtensionErrors()).toEqual([]);
        off();
    });

    it('trunca mensajes largos, limita la memoria y nunca lanza', () => {
        reportExtensionError({ extensionId: 'x', kind: 'render', message: 'm'.repeat(5000) });
        expect(getExtensionErrors()[0].message.length).toBe(500);
        for (let i = 0; i < 150; i++) reportExtensionError({ extensionId: 'x', kind: 'render', message: `e${i}` });
        expect(getExtensionErrors().length).toBeLessThanOrEqual(100);
        expect(() => reportExtensionError({ extensionId: undefined as any, kind: 'render', message: undefined as any })).not.toThrow();
    });
});
