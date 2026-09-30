import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyze, detectKind, groupIssues, locateJsonError, parseJson, positionToLineCol } from '../analyze';
import { COMPOSER_FUNCTIONS, createBackendSimulator, createComposerFunctions, createEventLog, formatTime, parseBackendScript } from '../simulate';
import { DRAFT_KEY, loadDraft, saveDraft, queueForPlayground, takePending } from '../storage';

describe('parseJson / posicion del error', () => {
    it('convierte posicion en linea y columna (base 1)', () => {
        expect(positionToLineCol('ab\ncd\nef', 0)).toEqual({ line: 1, column: 1 });
        expect(positionToLineCol('ab\ncd\nef', 4)).toEqual({ line: 2, column: 2 });
        expect(positionToLineCol('ab\ncd\nef', 6)).toEqual({ line: 3, column: 1 });
    });

    it('localiza el primer error con linea/columna', () => {
        const text = '{\n  "a": 1,\n  "b": ,\n  "c": 3\n}';
        const r = parseJson(text);
        expect(r.ok).toBe(false);
        if (!r.ok) { expect(r.line).toBe(3); expect(r.column).toBe(8); expect(r.message).toMatch(/Valor inesperado/); }
    });

    it.each([
        ['{"a":1,}', /Coma sobrante|nombre de propiedad/],
        ['[1,2,]', /Coma sobrante/],
        ["{'a':1}", /nombre de propiedad/],
        ['{"a":1', /Falta "}"/],
        ['{"a" 1}', /":"/],
        ['{"a":"x', /sin cerrar/],
        ['{"a":1} x', /Contenido inesperado/],
        ['// comentario\n{}', /Valor inesperado/],
    ])('detecta %j', (text, re) => {
        const r = parseJson(text);
        expect(r.ok).toBe(false);
        if (!r.ok) { expect(r.message).toMatch(re); expect(r.line).toBeGreaterThanOrEqual(1); }
    });

    it('acepta JSON valido y locateJsonError coincide con JSON.parse', () => {
        for (const ok of ['{}', '[]', '{"a":[1,2.5e3,-0,true,null,"x\\n\\u00e9"]}', '  {"a":{"b":{}}}\n']) {
            expect(locateJsonError(ok)).toBeNull();
            expect(parseJson(ok).ok).toBe(true);
        }
        expect(parseJson('').ok).toBe(false);
    });
});

describe('detectKind', () => {
    it('distingue manifest, nodo y desconocido', () => {
        expect(detectKind({ mounts: [] })).toBe('manifest');
        expect(detectKind({ overlays: {} })).toBe('manifest');
        expect(detectKind({ state: { a: 1 } })).toBe('manifest');
        expect(detectKind({ type: 'TEXT', props: {} })).toBe('node');
        expect(detectKind({ type: 'TEXT', mounts: [] })).toBe('manifest');
        expect(detectKind({ foo: 1 })).toBe('unknown');
        expect(detectKind([])).toBe('unknown');
        expect(detectKind(null)).toBe('unknown');
    });
});

describe('analyze', () => {
    it('vacio, JSON invalido y desconocido', () => {
        expect(analyze('  ').status).toBe('empty');
        const bad = analyze('{"a": }');
        expect(bad.status).toBe('invalid-json');
        expect(bad.issues[0]).toMatchObject({ source: 'json', category: 'error', line: 1, column: 7 });
        const unknown = analyze('{"foo":1}');
        expect(unknown.kind).toBe('unknown');
        expect(unknown.blocking).toBe(1);
    });

    it('nodo valido: sin problemas y un objetivo', () => {
        const a = analyze('{"type":"TEXT","props":{"content":"hola ${context.subject}"}}');
        expect(a.kind).toBe('node');
        expect(a.issues).toEqual([]);
        expect(a.targets).toHaveLength(1);
        expect(a.targets[0].broken).toBe(false);
    });

    it('errores de UI con ruta y expresion invalida; el objetivo pasa a __EXTENSION_ERROR__', () => {
        const a = analyze(JSON.stringify({ type: 'STACK', children: [{ type: 'TEXT', props: { content: 'x' } }, { type: 'BUTTON', props: { label: '${1 +}', tone: 'rojo' } }] }));
        const paths = a.issues.filter((i) => i.category === 'error').map((i) => i.path);
        expect(paths).toContain('ui.children[1].props.tone');
        expect(paths).toContain('ui.children[1].props.label');
        expect(a.targets[0].broken).toBe(true);
        expect(a.targets[0].node.type).toBe('__EXTENSION_ERROR__');
        expect(a.counts.errors).toBeGreaterThanOrEqual(2);
    });

    it('formato antiguo: avisos de obsolescencia (no errores) y migracion idempotente', () => {
        const legacy = JSON.stringify({ type: 'COLUMN', props: { className: 'p-2' }, children: [{ type: 'BUTTON', props: { label: 'Ok', variant: 'primary' } }] });
        const a = analyze(legacy);
        expect(a.counts.errors).toBe(0);
        expect(a.counts.deprecations).toBeGreaterThanOrEqual(3);
        expect(a.issues.some((i) => i.path === 'ui.type' && /COLUMN/.test(i.message))).toBe(true);
        expect(a.issues.some((i) => /className/.test(i.message))).toBe(true);
        expect(a.blocking).toBe(0);
        expect(a.needsMigration).toBe(true);
        const migrated = JSON.parse(a.migratedText!);
        expect(migrated.type).toBe('STACK');
        expect(analyze(a.migratedText!).counts.deprecations).toBe(0);
    });

    it('modo estricto: los avisos cuentan como errores', () => {
        const legacy = JSON.stringify({ type: 'COLUMN', children: [] });
        expect(analyze(legacy).blocking).toBe(0);
        const strict = analyze(legacy, { strict: true });
        expect(strict.blocking).toBeGreaterThan(0);
        expect(strict.issues.every((i) => i.severity === 'error')).toBe(true);
        expect(strict.counts.deprecations).toBeGreaterThan(0);
    });

    it('manifest: errores de estructura, mounts y overlays como objetivos', () => {
        const a = analyze(JSON.stringify({
            id: 'x', name: 'X', version: '1.0.0',
            mounts: [{ point: 'EMAIL_FOOTER', component: { type: 'TEXT', props: { content: 'hola' } } }, { point: 'EMAIL_TOOLBAR', component: { type: 'BUTTON', props: { label: 'b', onClick: { action: 'CALL_BACKEND', function: 'nope' } } } }],
            overlays: { panel: { type: 'MODAL', props: { title: 't' }, children: [] } },
        }));
        expect(a.kind).toBe('manifest');
        expect(a.extensionId).toBe('x');
        expect(a.targets.map((t) => t.key)).toEqual(['mount:0', 'mount:1', 'overlay:panel']);
        expect(a.issues.some((i) => i.source === 'manifest' && i.category === 'error' && /nope|api/.test(i.message))).toBe(true);
        expect(Object.keys(a.overlays)).toEqual(['panel']);
    });

    it('groupIssues agrupa por origen', () => {
        const a = analyze('{"type":"COLUMN"}');
        const groups = groupIssues(a.issues, 'deprecation');
        expect(groups[0].source).toBe('ui');
    });
});

describe('guion del backend simulado', () => {
    it('valida entradas y reporta rutas', () => {
        const r = parseBackendScript(JSON.stringify({ a: { result: 1 }, b: { error: 'x', times: 0 }, c: { delayMs: -1, result: 1 }, d: 5, e: {}, f: { result: 1, times: 2 } }));
        expect(r.ok).toBe(false);
        expect(Object.keys(r.script)).toEqual(['a']);
        expect(r.errors.map((e) => e.path).sort()).toEqual(['b.times', 'c.delayMs', 'd', 'e', 'f.times']);
    });
    it('JSON roto da posicion', () => {
        const r = parseBackendScript('{"a": }');
        expect(r.ok).toBe(false);
        expect(r.errors[0].line).toBe(1);
    });
    it('vacio = guion vacio', () => {
        expect(parseBackendScript('')).toEqual({ ok: true, script: {}, errors: [] });
    });
});

describe('createBackendSimulator', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('respeta delayMs con timers falsos', async () => {
        const sim = createBackendSimulator(() => ({ slow: { result: { v: 1 }, delayMs: 300 } }));
        let done: any = null;
        const p = sim.callBackend('x', 'slow', {}, {}).then((r) => { done = r; });
        await vi.advanceTimersByTimeAsync(299);
        expect(done).toBeNull();
        await vi.advanceTimersByTimeAsync(1);
        await p;
        expect(done).toEqual({ success: true, result: { v: 1 } });
    });

    it('`times`: falla N veces y despues devuelve el resultado; reset reinicia', async () => {
        const sim = createBackendSimulator(() => ({ flaky: { error: 'boom', times: 2, result: 'ok' } }));
        expect((await sim.callBackend('x', 'flaky', {}, {})).error).toBe('boom');
        expect((await sim.callBackend('x', 'flaky', {}, {})).error).toBe('boom');
        expect(await sim.callBackend('x', 'flaky', {}, {})).toEqual({ success: true, result: 'ok' });
        expect(sim.counts()).toEqual({ flaky: 3 });
        sim.reset();
        expect((await sim.callBackend('x', 'flaky', {}, {})).success).toBe(false);
    });

    it('error sin times siempre falla; funcion desconocida da error claro; el guion se lee en cada llamada', async () => {
        let script: any = { always: { error: 'nope' } };
        const events: any[] = [];
        const sim = createBackendSimulator(() => script, (e) => events.push(e));
        expect((await sim.callBackend('x', 'always', {}, {})).success).toBe(false);
        expect((await sim.callBackend('x', 'always', {}, {})).success).toBe(false);
        const unknown = await sim.callBackend('x', 'missing', {}, {});
        expect(unknown.error).toMatch(/missing/);
        script = { missing: { result: 7 } };
        expect((await sim.callBackend('x', 'missing', {}, {})).result).toBe(7);
        expect(events.map((e) => [e.name, e.outcome])).toEqual([['always', 'error'], ['always', 'error'], ['missing', 'error'], ['missing', 'ok']]);
    });
});

describe('funciones del composer simuladas', () => {
    it('registran cada llamada como evento', async () => {
        const events: any[] = [];
        const fns = createComposerFunctions((e) => events.push(e));
        expect(Object.keys(fns).sort()).toEqual([...COMPOSER_FUNCTIONS].sort());
        fns.insertBody('<p>hola</p>');
        fns.appendBody('fin');
        await fns.setSubject('Asunto');
        fns.addAttachment({ filename: 'a.txt' });
        const uploaded = await fns.uploadAttachment({ name: 'b.pdf', size: 10 });
        expect(uploaded.filename).toBe('b.pdf');
        expect(events.map((e) => e.name)).toEqual(['insertBody', 'appendBody', 'setSubject', 'addAttachment', 'uploadAttachment']);
        expect(events.every((e) => e.kind === 'composer')).toBe(true);
    });
    it('registro de eventos con id, hora y limite', () => {
        const log = createEventLog(2, () => new Date(2026, 0, 1, 9, 5, 7));
        let list: any[] = [];
        for (const name of ['a', 'b', 'c']) list = log.append(list, log.make({ kind: 'composer', name }));
        expect(list.map((e) => e.name)).toEqual(['b', 'c']);
        expect(list[0].time).toBe('09:05:07');
        expect(list[1].id).toBeGreaterThan(list[0].id);
        expect(formatTime(new Date(2026, 0, 1, 0, 0, 0))).toBe('00:00:00');
    });
});

describe('storage (con try/catch)', () => {
    it('guarda y recupera el borrador y el envio galeria -> playground', () => {
        const store = new Map<string, string>();
        vi.stubGlobal('window', { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } } });
        expect(loadDraft()).toEqual({});
        expect(saveDraft({ text: '{}', theme: 'dark', viewport: 'mobile', strict: true })).toBe(true);
        expect(loadDraft()).toEqual({ text: '{}', theme: 'dark', viewport: 'mobile', strict: true });
        store.set(DRAFT_KEY, 'no es json');
        expect(loadDraft()).toEqual({});
        expect(queueForPlayground('{"type":"TEXT"}')).toBe(true);
        expect(takePending()).toBe('{"type":"TEXT"}');
        expect(takePending()).toBeNull();
        vi.unstubAllGlobals();
    });
    it('no lanza si localStorage falla', () => {
        vi.stubGlobal('window', { localStorage: { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } } });
        expect(loadDraft()).toEqual({});
        expect(saveDraft({ text: 'a' })).toBe(false);
        expect(takePending()).toBeNull();
        vi.unstubAllGlobals();
    });
});
