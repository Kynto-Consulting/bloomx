import { describe, expect, it } from 'vitest';
import { UI_COMPONENT_TYPES, UI_COMPONENTS, validateUi } from '../ui-schema';
import { checkExpression } from '../expressions';
import { EXAMPLE_BACKEND, EXAMPLE_OVERLAYS, UI_EXAMPLES, flattenExamples } from '../ui-examples';
import { PLAYGROUND_SAMPLES } from '../playground/samples';
import { analyze } from '../playground/analyze';
import { parseBackendScript } from '../playground/simulate';
import { RAW_CLASS, RAW_LITERAL } from '@/lib/__tests__/helpers/raw-colors';

describe('UI_EXAMPLES', () => {
    it('hay al menos un ejemplo por cada componente del catalogo (y ninguno de mas)', () => {
        const missing = UI_COMPONENT_TYPES.filter((type) => !(UI_EXAMPLES[type]?.length > 0));
        expect(missing, `componentes sin ejemplo: ${missing.join(', ')}`).toEqual([]);
        const extra = Object.keys(UI_EXAMPLES).filter((type) => !(type in UI_COMPONENTS));
        expect(extra, 'ejemplos de componentes que no existen').toEqual([]);
    });

    it('cada ejemplo usa su propio tipo en algun punto del arbol', () => {
        for (const [type, list] of Object.entries(UI_EXAMPLES)) {
            for (const example of list) {
                const json = JSON.stringify(example.node);
                // un MODAL tambien puede ejemplificarse con el boton que abre un overlay del manifest
                expect(json.includes(`"type":"${type}"`) || json.includes('OPEN_OVERLAY'), `${type}: ${example.title}`).toBe(true);
            }
        }
    });

    for (const example of flattenExamples()) {
        it(`valida sin errores: ${example.id} (${example.title})`, () => {
            const result = validateUi(example.node, { root: example.type, checkExpression });
            expect(result.errors, JSON.stringify(result.errors)).toEqual([]);
            expect(result.warnings, JSON.stringify(result.warnings)).toEqual([]);
        });
    }

    it('los overlays y el guion de backend de ejemplo son validos', () => {
        for (const [id, node] of Object.entries(EXAMPLE_OVERLAYS)) expect(validateUi(node, { root: `overlays.${id}`, checkExpression }).errors).toEqual([]);
        expect(parseBackendScript(JSON.stringify(EXAMPLE_BACKEND)).errors).toEqual([]);
    });

    it('todas las funciones que llaman los ejemplos existen en el guion simulado', () => {
        const used = new Set<string>();
        for (const example of flattenExamples()) for (const m of JSON.stringify(example.node).matchAll(/"function":"([^"]+)"/g)) used.add(m[1]);
        for (const fn of used) expect(EXAMPLE_BACKEND, fn).toHaveProperty(fn);
    });

    it('no contienen paleta cruda ni estilos (solo props semanticas)', () => {
        const json = JSON.stringify(UI_EXAMPLES).replace(/"#3b82f6"/, '""'); // dato de usuario (COLOR_PICKER)
        expect(json.match(RAW_CLASS) ?? []).toEqual([]);
        expect(json.match(RAW_LITERAL) ?? []).toEqual([]);
        expect(json).not.toMatch(/"(?:className|style|color)":/);
    });
});

describe('PLAYGROUND_SAMPLES', () => {
    it('el manifest nuevo no tiene errores ni avisos de obsolescencia', () => {
        const a = analyze(PLAYGROUND_SAMPLES.find((s) => s.id === 'manifest')!.text);
        expect(a.kind).toBe('manifest');
        expect(a.issues.filter((i) => i.category === 'error'), JSON.stringify(a.issues)).toEqual([]);
        expect(a.counts.deprecations).toBe(0);
        expect(a.targets.map((t) => t.key)).toEqual(['mount:0', 'mount:1', 'overlay:detalle']);
    });

    it('los manifests heredados se migran con avisos y sin errores', () => {
        for (const id of ['legacy-column', 'legacy-table', 'legacy-modal']) {
            const a = analyze(PLAYGROUND_SAMPLES.find((s) => s.id === id)!.text);
            expect(a.issues.filter((i) => i.category === 'error'), `${id}: ${JSON.stringify(a.issues)}`).toEqual([]);
            expect(a.counts.deprecations, id).toBeGreaterThan(0);
            expect(a.needsMigration, id).toBe(true);
            // migrar es idempotente: lo migrado ya no produce avisos de obsolescencia
            const again = analyze(a.migratedText!);
            expect(again.counts.deprecations, `${id} tras migrar`).toBe(0);
        }
    });
});
