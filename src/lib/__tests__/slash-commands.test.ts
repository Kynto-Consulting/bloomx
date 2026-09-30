import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
    collectOverlays,
    collectSlashCommands,
    filterSlashCommands,
    parseSlashInput,
    slashKeyAction,
} from '../slash-commands';
import { validateManifest } from '../expansions/manifest-schema';

const cmds = [{ key: 'shrug' }, { key: 'smile' }, { key: 'hr' }, { key: 'translate' }];

describe('parseSlashInput', () => {
    it('abre con "/" y con prefijo, al inicio o tras un espacio', () => {
        expect(parseSlashInput('/', cmds)).toMatchObject({ query: '', args: '', exactMatch: false, start: 0 });
        expect(parseSlashInput('/sh', cmds)).toMatchObject({ query: 'sh', exactMatch: false, start: 0 });
        expect(parseSlashInput('hola /sh', cmds)).toMatchObject({ query: 'sh', start: 5 });
    });

    it('no se activa dentro de palabras ni con URLs', () => {
        expect(parseSlashInput('and/or', cmds)).toBeNull();
        expect(parseSlashInput('https://x.com/a', cmds)).toBeNull();
        expect(parseSlashInput('sin barra', cmds)).toBeNull();
    });

    it('comando exacto con argumentos; sin comando real no hay argumentos (no roba Enter)', () => {
        expect(parseSlashInput('/translate al ingles', cmds)).toMatchObject({ query: 'translate', args: 'al ingles', exactMatch: true });
        expect(parseSlashInput('/HR', cmds)).toMatchObject({ exactMatch: true });
        expect(parseSlashInput('1 / 2', cmds)).toBeNull();
        expect(parseSlashInput('and / or', cmds)).toBeNull();
        expect(parseSlashInput('/nope algo', cmds)).toBeNull();
    });
});

describe('filterSlashCommands', () => {
    const list = [
        { key: 'shrug', description: 'Insert shrug' },
        { key: 'smile', description: 'Insert smile' },
        { key: 'zzz', description: 'sleep: shush' },
    ];
    it('claves por prefijo primero, luego por descripcion', () => {
        expect(filterSlashCommands(list, '').map((c) => c.key)).toEqual(['shrug', 'smile', 'zzz']);
        expect(filterSlashCommands(list, 'sh').map((c) => c.key)).toEqual(['shrug', 'zzz']);
        expect(filterSlashCommands(list, 'SM').map((c) => c.key)).toEqual(['smile']);
        expect(filterSlashCommands(list, 'x')).toEqual([]);
    });
});

describe('slashKeyAction (teclado)', () => {
    const base = { exactMatch: false, count: 3, index: 0 };
    it('flechas navegan con vuelta, Enter ejecuta, Tab completa, Escape cierra', () => {
        expect(slashKeyAction('ArrowDown', base)).toEqual({ type: 'move', index: 1 });
        expect(slashKeyAction('ArrowDown', { ...base, index: 2 })).toEqual({ type: 'move', index: 0 });
        expect(slashKeyAction('ArrowUp', base)).toEqual({ type: 'move', index: 2 });
        expect(slashKeyAction('Home', { ...base, index: 2 })).toEqual({ type: 'move', index: 0 });
        expect(slashKeyAction('End', base)).toEqual({ type: 'move', index: 2 });
        expect(slashKeyAction('Enter', { ...base, index: 1 })).toEqual({ type: 'execute', index: 1 });
        expect(slashKeyAction('Tab', base)).toEqual({ type: 'complete', index: 0 });
        expect(slashKeyAction('Escape', base)).toEqual({ type: 'close' });
        expect(slashKeyAction('a', base)).toEqual({ type: 'none' });
    });

    it('sin candidatos no se intercepta nada salvo Escape', () => {
        const empty = { exactMatch: false, count: 0, index: 0 };
        expect(slashKeyAction('Enter', empty)).toEqual({ type: 'none' });
        expect(slashKeyAction('ArrowDown', empty)).toEqual({ type: 'none' });
        expect(slashKeyAction('Escape', empty)).toEqual({ type: 'close' });
    });

    it('con comando exacto solo Enter/Escape; las flechas pasan al editor', () => {
        const exact = { exactMatch: true, count: 1, index: 0 };
        expect(slashKeyAction('Enter', exact)).toEqual({ type: 'execute', index: 0 });
        expect(slashKeyAction('ArrowDown', exact)).toEqual({ type: 'none' });
        expect(slashKeyAction('Tab', exact)).toEqual({ type: 'none' });
        expect(slashKeyAction('Escape', exact)).toEqual({ type: 'close' });
    });
});

describe('collectSlashCommands', () => {
    const install = (id: string, template: any) => ({ id, template });

    it('reune los comandos validos de las extensiones instaladas y descarta los malos', () => {
        const list = collectSlashCommands([
            install('a', {
                id: 'core-a', name: 'A', slashCommands: [
                    { key: 'ok', description: 'd', action: { action: 'TOAST', message: 'x' }, arguments: 'Titulo' },
                    { key: 'bad key', description: 'd', action: { action: 'TOAST' } },
                    { key: 'noaction', description: 'd' },
                    { key: 'nodesc', action: { action: 'TOAST' } },
                    null,
                ],
            }),
            install('b', { id: 'core-b', status: 'disabled', slashCommands: [{ key: 'off', description: 'd', action: { action: 'TOAST' } }] }),
            install('c', JSON.stringify({ id: 'core-c', slashCommands: [{ key: 'json', description: 'd', action: { action: 'TOAST' } }] })),
            install('d', null),
        ]);
        expect(list.map((c) => c.key)).toEqual(['ok', 'json']);
        expect(list[0]).toMatchObject({ extensionId: 'core-a', extensionName: 'A', arguments: 'Titulo' });
    });

    it('claves repetidas: gana la primera extension (sin distinguir mayusculas)', () => {
        const list = collectSlashCommands([
            install('a', { id: 'core-a', slashCommands: [{ key: 'hr', description: 'primero', action: { action: 'TOAST' } }] }),
            install('b', { id: 'core-b', slashCommands: [{ key: 'HR', description: 'segundo', action: { action: 'TOAST' } }] }),
        ]);
        expect(list).toHaveLength(1);
        expect(list[0].extensionId).toBe('core-a');
    });

    it('collectOverlays une overlays y mounts OVERLAY (normaliza component string)', () => {
        const overlays = collectOverlays(install('a', {
            id: 'core-a',
            overlays: { one: { type: 'MODAL' } },
            mounts: [
                { point: 'OVERLAY', id: 'two', component: { type: 'MODAL', props: {} } },
                { point: 'OVERLAY', id: 'three', component: 'MODAL', props: { title: 't' } },
                { point: 'EMAIL_TOOLBAR', component: { type: 'BUTTON' } },
            ],
        }));
        expect(Object.keys(overlays).sort()).toEqual(['one', 'three', 'two']);
        expect(overlays.three).toMatchObject({ type: 'MODAL', props: { title: 't' } });
    });
});

describe('manifests reales de bloomx-extensions', () => {
    const root = path.resolve(__dirname, '../../../../bloomx-extensions');
    const read = (id: string) => JSON.parse(readFileSync(path.join(root, id, 'manifest.json'), 'utf8'));
    const ids = ['slash-commands', 'composer-helper', 'calendar', 'translator'];

    it.each(ids)('%s valida contra el schema del frontend', (id) => {
        const verdict = validateManifest(read(id));
        expect(verdict.errors).toEqual([]);
    });

    it('slash-commands aporta /shrug, /smile, /hr y composer-helper /ai', () => {
        const all = collectSlashCommands(ids.map((id) => ({ id: read(id).id, template: read(id) })));
        const keys = all.map((c) => c.key);
        for (const k of ['shrug', 'smile', 'hr', 'ai', 'translate', 'calendar']) expect(keys).toContain(k);
    });
});
