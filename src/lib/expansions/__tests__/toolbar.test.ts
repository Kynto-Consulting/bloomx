import { describe, expect, it } from 'vitest';
import {
    DEFAULT_PINNED, LAST_USED_STORAGE_KEY, MAX_DEFAULT_PINNED, defaultPinnedKeys, fitPinnedCount, groupByExtension, initialsFor, isToolbarMountPoint,
    matchesQuery, readLastUsed, resolvePinnedKeys, sortItems, toolbarGlyph, toolbarItemKey, writeLastUsed, type ToolbarItem,
} from '../client/toolbar';
import { EXTENSION_PREFS_SETTINGS_KEY, normalizePrefs, pushPrefsToServer, withPinned, EMPTY_PREFS } from '../client/prefs';

const item = (key: string, over: Partial<ToolbarItem> = {}): ToolbarItem => ({
    key, extensionId: 'ext', extensionName: 'Ext', label: key, manifestPinned: false, priority: 500, order: 0, ...over,
});
const items = (n: number, over: (i: number) => Partial<ToolbarItem> = () => ({})) => Array.from({ length: n }, (_, i) => item(`k${i}`, { order: i, ...over(i) }));

describe('puntos de montaje de barra', () => {
    it('solo las cuatro barras usan la presentacion compacta', () => {
        for (const p of ['EMAIL_TOOLBAR', 'COMPOSER_TOOLBAR', 'CALENDAR_TOOLBAR', 'CONTACTS_TOOLBAR']) expect(isToolbarMountPoint(p)).toBe(true);
        for (const p of ['EMAIL_READER_SIDEBAR', 'SETTINGS_PANEL', 'CALENDAR_HEADER', 'OVERLAY']) expect(isToolbarMountPoint(p)).toBe(false);
    });
});

describe('claves', () => {
    it('estables, saneadas y acotadas', () => {
        expect(toolbarItemKey('core-notion', 'EMAIL_TOOLBAR', 'Notion')).toBe('core-notion:email_toolbar:notion');
        const k = toolbarItemKey('Core Zoom!', 'EMAIL_TOOLBAR', '<b>Zoom & Meet</b>');
        expect(k).toMatch(/^[a-z0-9._:-]+$/);
        expect(toolbarItemKey('a', 'X', 'y'.repeat(500)).length).toBeLessThanOrEqual(190);
        expect(toolbarItemKey('a', 'EMAIL_TOOLBAR', '')).toMatch(/:item$/);
    });
});

describe('anclados por defecto y decisiones del usuario', () => {
    it('sin nada declarado: las 2 primeras por prioridad/orden', () => {
        expect(defaultPinnedKeys(items(6))).toEqual(['k0', 'k1']);
        expect(DEFAULT_PINNED).toBe(2);
        expect(defaultPinnedKeys(items(6, (i) => ({ priority: 100 - i })))).toEqual(['k5', 'k4']);
    });
    it('con toolbar.pinned del manifest: esas (max 3), ordenadas por prioridad', () => {
        const list = items(6, (i) => ({ manifestPinned: i >= 2, priority: 10 - i }));
        expect(defaultPinnedKeys(list)).toEqual(['k5', 'k4', 'k3']);
        expect(MAX_DEFAULT_PINNED).toBe(3);
    });
    it('el usuario manda: true ancla, false desancla, sin dato = por defecto', () => {
        const list = items(5);
        expect(resolvePinnedKeys(list, {})).toEqual(['k0', 'k1']);
        expect(resolvePinnedKeys(list, { k3: true, k0: false })).toEqual(['k1', 'k3']);
        expect(resolvePinnedKeys(list, { k4: true })).toEqual(['k0', 'k1', 'k4']);
        expect(resolvePinnedKeys(list, { k0: false, k1: false })).toEqual([]);
        expect(resolvePinnedKeys(list, undefined)).toEqual(['k0', 'k1']);
        expect(resolvePinnedKeys(list, { inexistente: true })).toEqual(['k0', 'k1']);
    });
    it('el orden de la barra es estable: prioridad y despues orden original', () => {
        const list = [item('a', { priority: 5, order: 2 }), item('b', { priority: 5, order: 1 }), item('c', { priority: 1, order: 3 })];
        expect(sortItems(list).map((i) => i.key)).toEqual(['c', 'b', 'a']);
        expect(list.map((i) => i.key)).toEqual(['a', 'b', 'c']); // no muta
    });
});

describe('desbordamiento: cuantos caben', () => {
    const fit = (available: number, count: number, reserved = 43) => fitPinnedCount({ available, count, reserved });
    it('ancho holgado: caben todos; nunca mas que los anclados', () => {
        expect(fit(900, 3)).toBe(3);
        expect(fit(900, 0)).toBe(0);
    });
    it('cada boton (32 px + 2 de gap) que no cabe pasa al menu; el menu y el separador siempre se reservan', () => {
        expect(fit(43 + 32, 5)).toBe(1);
        expect(fit(43 + 31, 5)).toBe(0);
        expect(fit(43 + 66, 5)).toBe(2); // 2 x 32 + 2
        expect(fit(43 + 65, 5)).toBe(1);
        expect(fit(43 + 100, 5)).toBe(3); // 3 x 32 + 2 x 2
        expect(fit(43 + 134, 5)).toBe(4);
    });
    it('anchos degenerados (0, negativo, NaN, Infinity) no rompen', () => {
        expect(fit(0, 3)).toBe(0);
        expect(fit(-50, 3)).toBe(0);
        expect(fit(Number.NaN, 3)).toBe(0);
        expect(fit(Number.POSITIVE_INFINITY, 3)).toBe(0);
        expect(fit(20, 3)).toBe(0);
    });
    it('boton tactil de 36 px', () => {
        expect(fitPinnedCount({ available: 200, count: 9, button: 36, reserved: 47 })).toBe(Math.floor((153 + 2) / 38));
    });
    it('es monotono: mas ancho nunca da menos botones', () => {
        let last = 0;
        for (let w = 0; w <= 600; w += 7) { const n = fit(w, 12); expect(n).toBeGreaterThanOrEqual(last); last = n; }
    });
});

describe('glifo: icono o insignia', () => {
    const known = new Set(['Database', 'Sparkles', 'Briefcase']);
    const isKnown = (n: string) => known.has(n);
    it('un icono Lucide valido se usa tal cual', () => {
        expect(toolbarGlyph('Database', 'Notion', isKnown)).toEqual({ kind: 'icon', name: 'Database' });
    });
    it('un emoji o simbolo corto se conserva', () => {
        expect(toolbarGlyph('✨', 'Magia', isKnown)).toEqual({ kind: 'text', text: '✨' });
    });
    it('un nombre corto que no existe (GIF) se convierte en insignia con esas letras', () => {
        expect(toolbarGlyph('GIF', 'Giphy', isKnown)).toEqual({ kind: 'text', text: 'GIF' });
    });
    it('un nombre largo desconocido usa las iniciales del label; sin icono, tambien', () => {
        expect(toolbarGlyph('HubSpotLogo', 'HubSpot CRM', isKnown)).toEqual({ kind: 'text', text: 'HC' });
        expect(toolbarGlyph(undefined, 'Zoom', isKnown)).toEqual({ kind: 'text', text: 'ZO' });
        expect(toolbarGlyph('', 'Extraer acciones', isKnown)).toEqual({ kind: 'text', text: 'EA' });
    });
    it('iniciales: 1 palabra corta -> entera; larga -> 2 letras; 2+ palabras -> 2; vacio -> ?', () => {
        expect(initialsFor('gif')).toBe('GIF');
        expect(initialsFor('Trello')).toBe('TR');
        expect(initialsFor('Save to Notion')).toBe('ST');
        expect(initialsFor('  ')).toBe('?');
        expect(initialsFor('***')).toBe('?');
        expect(initialsFor('Ñandú')).toBe('ÑA');
    });
});

describe('menu: agrupar y buscar', () => {
    it('agrupa por extension conservando el orden de aparicion', () => {
        const list = [item('a1', { extensionId: 'A', extensionName: 'Alfa' }), item('b1', { extensionId: 'B', extensionName: 'Beta' }), item('a2', { extensionId: 'A', extensionName: 'Alfa' })];
        const groups = groupByExtension(list);
        expect(groups.map((g) => [g.extensionId, g.items.map((i) => i.key)])).toEqual([['A', ['a1', 'a2']], ['B', ['b1']]]);
    });
    it('busqueda sin acentos ni mayusculas sobre nombre, extension y descripcion', () => {
        const it1 = item('x', { label: 'Traducir', extensionName: 'Traductor', description: 'Convierte el correo a Inglés' });
        expect(matchesQuery(it1, '')).toBe(true);
        expect(matchesQuery(it1, 'TRADUC')).toBe(true);
        expect(matchesQuery(it1, 'ingles')).toBe(true);
        expect(matchesQuery(it1, 'traductor')).toBe(true);
        expect(matchesQuery(it1, 'zoom')).toBe(false);
    });
});

describe('ultima accion usada', () => {
    const mem = () => { const d = new Map<string, string>(); return { d, getItem: (k: string) => d.get(k) ?? null, setItem: (k: string, v: string) => { d.set(k, v); } }; };
    it('se guarda por barra y se lee saneada', () => {
        const s = mem();
        writeLastUsed('EMAIL_TOOLBAR', 'core-notion:email:notion', s);
        writeLastUsed('COMPOSER_TOOLBAR', 'core-giphy:c:gif', s);
        expect(readLastUsed('EMAIL_TOOLBAR', s)).toBe('core-notion:email:notion');
        expect(readLastUsed('COMPOSER_TOOLBAR', s)).toBe('core-giphy:c:gif');
        expect(readLastUsed('CONTACTS_TOOLBAR', s)).toBeNull();
        s.d.set(LAST_USED_STORAGE_KEY, JSON.stringify({ EMAIL_TOOLBAR: '<script>' }));
        expect(readLastUsed('EMAIL_TOOLBAR', s)).toBeNull();
        s.d.set(LAST_USED_STORAGE_KEY, 'no json');
        expect(readLastUsed('EMAIL_TOOLBAR', s)).toBeNull();
        expect(() => writeLastUsed('X', 'y', { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } })).not.toThrow();
        expect(readLastUsed('X', null)).toBeNull();
    });
});

describe('preferencias: anclados (system:extension-prefs.pins)', () => {
    it('normalizePrefs conserva solo claves seguras con valor booleano y limita la cantidad', () => {
        const many = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`e:t:a${i}`, true]));
        const out = normalizePrefs({ disabled: [], order: [], pins: { 'core-notion:email_toolbar:notion': true, 'a b': true, '<x>': true, ok: 'si', z: false, ...many } });
        expect(out.pins!['core-notion:email_toolbar:notion']).toBe(true);
        expect(out.pins!['a b']).toBeUndefined();
        expect(out.pins!['<x>']).toBeUndefined();
        expect(out.pins!.ok).toBeUndefined();
        expect(Object.keys(out.pins!).length).toBeLessThanOrEqual(300);
        expect(normalizePrefs({ pins: [1, 2] }).pins).toEqual({});
        expect(normalizePrefs({ pins: 'x' }).pins).toEqual({});
        expect(normalizePrefs({ disabled: ['a'] }).pins).toEqual({});
    });
    it('withPinned ancla, desancla y null vuelve al valor por defecto; ignora claves invalidas', () => {
        let p = withPinned(EMPTY_PREFS, 'a:b:c', true);
        expect(p.pins).toEqual({ 'a:b:c': true });
        p = withPinned(p, 'a:b:c', false);
        expect(p.pins).toEqual({ 'a:b:c': false });
        p = withPinned(p, 'a:b:c', null);
        expect(p.pins).toEqual({});
        expect(withPinned(EMPTY_PREFS, '<x>', true)).toBe(EMPTY_PREFS);
        expect(EMPTY_PREFS.pins).toEqual({}); // no se muto el original
    });
    it('viajan entre dispositivos dentro de expansionSettings (cifrado en el servidor), sin pisar otras claves', async () => {
        const calls: any[] = [];
        const fetchMock = async (url: string, init?: any) => {
            calls.push([url, init]);
            if (!init) return { ok: true, json: async () => ({ expansionSettings: { otra: { a: 1 } } }) };
            return { ok: true, json: async () => ({}) };
        };
        const prefs = withPinned(EMPTY_PREFS, 'core-notion:email_toolbar:notion', true);
        expect(await pushPrefsToServer(prefs, fetchMock as any)).toBe(true);
        const body = JSON.parse(calls[1][1].body);
        expect(body.expansionSettings.otra).toEqual({ a: 1 });
        expect(body.expansionSettings[EXTENSION_PREFS_SETTINGS_KEY].pins).toEqual({ 'core-notion:email_toolbar:notion': true });
    });
});
