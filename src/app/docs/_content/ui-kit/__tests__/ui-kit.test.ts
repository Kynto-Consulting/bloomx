import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { UI_COMPONENTS } from '@/lib/expansions/ui-schema';
import { DOC_PAGES, KIT_NAV, findKitEntry, kitNavSection } from '../../nav';
import { KIT_ORDER, KIT_SLUGS, KIT_TYPES, kitGroups, kitHref, slugToType, typeToSlug } from '../kit';
import { eventDocs, nestedDocs, propDocRows, actionsUsed, usageOf, manifestSnippet, payloadOf } from '../component-docs';
import { presetsFor } from '../presets';
import { createMockCaller, evaluateNodeText, formFields, parseFieldInput, parseMock, DEFAULT_MOCK, setNodeProp, simContext, createSimLog } from '../simulator-core';
import { collectUsages } from '../usages';
import USAGES from '../../ui-usages.json';
import { DOC_CONTENT } from '../../registry';

const FRONTEND = process.cwd();
const PAGE_FILE = path.join(FRONTEND, 'src', 'app', 'docs', 'extension-ui', '[component]', 'page.tsx');

describe('una pagina y una entrada de navegacion por cada componente del esquema', () => {
    it('los slugs son unicos y reversibles', () => {
        expect(new Set(KIT_SLUGS).size).toBe(KIT_TYPES.length);
        for (const type of KIT_TYPES) expect(slugToType(typeToSlug(type))).toBe(type);
        expect(kitHref('ICON_BUTTON')).toBe('/docs/extension-ui/icon-button');
    });

    it('generateStaticParams devuelve TODOS los componentes de UI_COMPONENTS', async () => {
        expect(fs.existsSync(PAGE_FILE)).toBe(true);
        const mod = await import('../../../extension-ui/[component]/page');
        const params = (mod.generateStaticParams() as Array<{ component: string }>).map((p) => p.component).sort();
        expect(params).toEqual(Object.keys(UI_COMPONENTS).map(typeToSlug).sort());
        expect(params.length).toBeGreaterThan(60);
    });

    it('la navegacion lateral agrupada lista cada componente exactamente una vez', () => {
        const listed = KIT_NAV.flatMap((g) => g.items.map((i) => i.type));
        expect([...listed].sort()).toEqual([...KIT_TYPES].sort());
        for (const group of KIT_NAV) {
            expect(group.title.es && group.title.en).toBeTruthy();
            for (const item of group.items) expect(item.href).toBe(kitHref(item.type));
        }
        expect(KIT_ORDER.length).toBe(KIT_TYPES.length);
        expect(kitNavSection().title.es).toBeTruthy();
        expect(findKitEntry('/docs/extension-ui/button')?.type).toBe('BUTTON');
        // las rutas del kit no son paginas planas de DOC_PAGES (viven en [component])
        expect(DOC_PAGES.some((p) => p.slug.startsWith('extension-ui/'))).toBe(false);
    });

    it('cada categoria del esquema tiene etiqueta en es y en', () => {
        for (const g of kitGroups()) { expect(g.label.es).toBeTruthy(); expect(g.label.en).toBeTruthy(); expect(g.types.length).toBeGreaterThan(0); }
    });

    it('la pagina principal enlaza cada componente desde su catalogo', () => {
        const links = new Set<string>();
        for (const l of ['es', 'en'] as const) for (const b of DOC_CONTENT['extension-ui'][l]) {
            if (b.t === 'table') for (const row of b.rows) for (const m of row[0].matchAll(/\]\((\/docs\/extension-ui\/[a-z-]+)\)/g)) links.add(m[1]);
        }
        for (const type of KIT_TYPES) expect(links.has(kitHref(type)), `sin enlace a ${type}`).toBe(true);
    });
});

describe('la tabla de props sale del esquema', () => {
    it('refleja nombre, tipo, requerido, valores y defecto de UI_COMPONENTS', () => {
        const rows = propDocRows(UI_COMPONENTS.BUTTON.props, 'es');
        expect(rows.map((r) => r.name)).toEqual(Object.keys(UI_COMPONENTS.BUTTON.props));
        const tone = rows.find((r) => r.name === 'tone')!;
        expect(tone.values).toContain('"danger"');
        expect(rows.find((r) => r.name === 'variant')!.def).toBe('"solid"');
        expect(rows.find((r) => r.name === 'onClick')!.isAction).toBe(true);
        expect(propDocRows(UI_COMPONENTS.ICON_BUTTON.props, 'en').find((r) => r.name === 'label')!.required).toBe(true);
        expect(rows.find((r) => r.name === 'label')!.doc).toBe(UI_COMPONENTS.BUTTON.props.label.doc);
    });

    it('cambiar un campo del esquema cambia la tabla (misma funcion, esquema mutado)', () => {
        const original = UI_COMPONENTS.BUTTON.props.size;
        const before = propDocRows(UI_COMPONENTS.BUTTON.props, 'es').find((r) => r.name === 'size')!;
        try {
            UI_COMPONENTS.BUTTON.props.size = { k: 'enum', values: ['sm', 'giant'], doc: 'Tamano de prueba', def: 'giant', required: true };
            const after = propDocRows(UI_COMPONENTS.BUTTON.props, 'es').find((r) => r.name === 'size')!;
            expect(after.values).toEqual(['"sm"', '"giant"']);
            expect(after.def).toBe('"giant"');
            expect(after.required).toBe(true);
            expect(after.doc).toBe('Tamano de prueba');
            expect(after).not.toEqual(before);
        } finally {
            UI_COMPONENTS.BUTTON.props.size = original;
        }
        expect(propDocRows(UI_COMPONENTS.BUTTON.props, 'es').find((r) => r.name === 'size')).toEqual(before);
    });

    it('eventos (props de accion, anidadas incluidas) y variables que reciben', () => {
        expect(eventDocs('BUTTON').map((e) => e.path)).toEqual(expect.arrayContaining(['onClick', 'onLoad']));
        expect(eventDocs('MENU').map((e) => e.path)).toContain('items[].onClick');
        expect(eventDocs('FORM').find((e) => e.path === 'onSubmit')!.payload).toContain('formData');
        expect(eventDocs('SELECT').find((e) => e.path === 'onChange')!.payload).toContain('value');
        expect(payloadOf('Accion (recibe `row`).')).toEqual(['row']);
        expect(nestedDocs(UI_COMPONENTS.TABLE.props, 'es').map((n) => n.path)).toContain('columns[]');
    });

    it('acciones usadas: salen de los ejemplos y de manifests reales', () => {
        expect(actionsUsed('BUTTON').length).toBeGreaterThan(0);
    });
});

describe('manifests reales', () => {
    it('cada uso citado existe y es un nodo del tipo indicado', () => {
        const entries = Object.entries((USAGES as any).components) as Array<[string, any]>;
        expect(entries.length).toBeGreaterThan(10);
        for (const [type, u] of entries) {
            expect(type in UI_COMPONENTS, `${type} no existe en el esquema`).toBe(true);
            expect(u.node.type).toBe(type);
            expect(u.file).toMatch(/^[a-z0-9-]+\/manifest\.json$/);
            expect(usageOf(type)?.file).toBe(u.file);
        }
        expect(manifestSnippet({ type: 'TEXT', props: { content: 'x' } }, 'EMAIL_TOOLBAR')).toContain('"point": "EMAIL_TOOLBAR"');
    });

    it('ui-usages.json esta al dia respecto a ../bloomx-extensions (si el repositorio esta presente)', () => {
        const root = path.resolve(FRONTEND, '..', 'bloomx-extensions');
        if (!fs.existsSync(root)) return;
        const files = fs.readdirSync(root, { withFileTypes: true })
            .filter((e) => e.isDirectory() && !e.name.startsWith('_') && fs.existsSync(path.join(root, e.name, 'manifest.json')))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((e) => ({ file: `${e.name}/manifest.json`, manifest: JSON.parse(fs.readFileSync(path.join(root, e.name, 'manifest.json'), 'utf8')) }));
        expect(collectUsages(files), 'ejecuta: npx tsx scripts/gen-ui-usages.ts').toEqual(USAGES);
    });
});

describe('presets del simulador', () => {
    it('todos los componentes tienen al menos un preset y TODOS validan con el esquema', () => {
        for (const type of KIT_TYPES) {
            const presets = presetsFor(type);
            expect(presets.length, `${type} sin presets`).toBeGreaterThan(0);
            for (const p of presets) {
                const ev = evaluateNodeText(JSON.stringify(p.node));
                expect(ev.errors, `${type}/${p.id}`).toEqual([]);
            }
        }
    });

    it('BUTTON ofrece estados, variantes, acciones y condicion', () => {
        const kinds = new Set(presetsFor('BUTTON').map((p) => p.kind));
        for (const k of ['example', 'state', 'variant', 'action', 'condition']) expect(kinds.has(k as any), k).toBe(true);
        const ids = presetsFor('BUTTON').map((p) => p.id);
        expect(ids).toEqual(expect.arrayContaining(['state-loading', 'state-disabled', 'variant-tone', 'variant-variant', 'action-direct', 'condition-hidden']));
    });
});

describe('nucleo del simulador', () => {
    it('JSON invalido: error de sintaxis con linea; esquema invalido: error con ruta; no se renderiza nada', () => {
        const syntax = evaluateNodeText('{ "type": "BUTTON", ');
        expect(syntax.status).toBe('invalid');
        expect(syntax.node).toBeUndefined();
        expect(syntax.errors[0].line).toBeGreaterThan(0);

        const schema = evaluateNodeText(JSON.stringify({ type: 'STACK', children: [{ type: 'TEXT' }, { type: 'BUTTON', props: { label: 'x', tone: 'sucsess', className: 'evil' } }] }));
        expect(schema.status).toBe('invalid');
        expect(schema.node).toBeUndefined();
        const paths = schema.errors.map((e) => e.path).join('\n');
        expect(paths).toMatch(/children\[1\]\.props\.tone/);
        // un estilo crudo no llega a renderizarse: se elimina con aviso (obsoleto) al migrar
        expect(schema.deprecations.map((e) => e.message).join('|')).toMatch(/className/);

        expect(evaluateNodeText('').status).toBe('empty');
        expect(evaluateNodeText(JSON.stringify({ mounts: [] })).errors[0].message).toMatch(/nodo/);
    });

    it('respeta los limites del esquema (bytes) y rechaza una expresion invalida con su ruta', () => {
        const big = evaluateNodeText(JSON.stringify({ type: 'TEXT', props: { content: 'x'.repeat(300000) } }));
        expect(big.status).toBe('invalid');
        expect(big.errors[0].message).toMatch(/límite/);
        const expr = evaluateNodeText(JSON.stringify({ type: 'TEXT', props: { content: '${state.a +}' } }));
        expect(expr.status).toBe('invalid');
        expect(expr.errors[0].path).toMatch(/props\.content/);
    });

    it('un nodo valido devuelve el nodo migrado', () => {
        const ok = evaluateNodeText(JSON.stringify({ type: 'BUTTON', props: { label: 'Ok', onClick: { action: 'TOAST', message: 'hola' } } }));
        expect(ok.status).toBe('ok');
        expect(ok.node?.type).toBe('BUTTON');
    });

    it('backend simulado: exito y error configurables, sin red', async () => {
        const calls: string[] = [];
        const original = globalThis.fetch;
        globalThis.fetch = (() => { throw new Error('el simulador no debe usar la red'); }) as any;
        try {
            let cfg = parseMock({ ...DEFAULT_MOCK, delayMs: 0 });
            const caller = createMockCaller(() => cfg, (c) => calls.push(`${c.fn}:${c.response.success}`));
            expect(await caller('x', 'saveNote', { a: 1 })).toEqual({ success: true, result: { ok: true, items: [1, 2, 3] } });
            cfg = parseMock({ ...DEFAULT_MOCK, mode: 'error', errorText: 'boom', delayMs: 0 });
            expect(await caller('x', 'saveNote', {})).toEqual({ success: false, error: 'boom' });
            expect(calls).toEqual(['saveNote:true', 'saveNote:false']);
            expect(parseMock({ ...DEFAULT_MOCK, resultText: '{ mal' }).resultError).toBeTruthy();
            expect(parseMock({ ...DEFAULT_MOCK, delayMs: 999999 }).delayMs).toBe(10000);
        } finally { globalThis.fetch = original; }
    });

    it('contexto por punto de montaje y modo compacto de toolbar', () => {
        expect(simContext('EMAIL_TOOLBAR', 'compact').toolbarButtonMode).toBe('compact');
        expect(simContext('EMAIL_TOOLBAR', 'off').toolbarButtonMode).toBeUndefined();
        expect(simContext('SIDEBAR_PANEL', 'compact').toolbarButtonMode).toBeUndefined();
        expect(simContext('COMPOSER_TOOLBAR').subject).toBeTruthy();
        expect(simContext('CALENDAR_EVENT_PANEL').event).toBeTruthy();
    });

    it('formulario generado: tipos de control y edicion de props', () => {
        const fields = formFields(UI_COMPONENTS.BUTTON.props);
        const kind = (n: string) => fields.find((f) => f.name === n)!.kind;
        expect([kind('label'), kind('tone'), kind('loading'), kind('onClick'), kind('toolbar')]).toEqual(['text', 'enum', 'boolean', 'json', 'json']);
        expect(parseFieldInput(fields.find((f) => f.name === 'tone')!, 'danger')).toEqual({ ok: true, value: 'danger' });
        expect(parseFieldInput(fields.find((f) => f.name === 'tone')!, 'rainbow').ok).toBe(false);
        expect(parseFieldInput(fields.find((f) => f.name === 'onClick')!, '{ mal').ok).toBe(false);
        expect(parseFieldInput(formFields(UI_COMPONENTS.TEXT.props).find((f) => f.name === 'lines')!, 'abc').ok).toBe(false);
        const node = setNodeProp({ type: 'BUTTON', props: { label: 'a' } }, 'tone', 'danger');
        expect(node.props).toEqual({ label: 'a', tone: 'danger' });
        expect(setNodeProp(node, 'tone', undefined).props).toEqual({ label: 'a' });
        const log = createSimLog(2, () => new Date(2026, 0, 1, 10, 0, 0));
        let list: any[] = [];
        for (const name of ['a', 'b', 'c']) list = log.append(list, log.make({ kind: 'action', name }));
        expect(list.map((e) => e.name)).toEqual(['b', 'c']);
        expect(list[0].time).toBe('10:00:00');
    });
});

describe('componentes de pagina completa en docs y simulador', () => {
    const PAGE_TYPES = ['PAGE_HEADER', 'SPLIT_PANE', 'KPI_CARD', 'CHART', 'TIMELINE', 'TREE', 'STEPPER'];
    it('cada uno tiene ejemplo interactivo (preset) valido, descripcion en ingles y pagina en el kit', async () => {
        const { EN_DOC } = await import('../kit');
        for (const type of PAGE_TYPES) {
            expect(KIT_TYPES, type).toContain(type);
            expect(EN_DOC[type], `EN_DOC.${type}`).toBeTruthy();
            expect(presetsFor(type).some((p) => p.kind === 'example'), `${type} sin ejemplo`).toBe(true);
        }
    });
    it('la TABLE avanzada tiene un ejemplo con busqueda, filtros y acciones masivas', () => {
        const json = presetsFor('TABLE').filter((p) => p.kind === 'example').map((p) => JSON.stringify(p.node)).join('');
        for (const key of ['searchable', 'bulkActions', 'defaultSort', 'onRetry']) expect(json, key).toContain(key);
    });
    it('la pagina principal de extension-ui los lista (es y en) con la nota de alias', () => {
        for (const locale of ['es', 'en'] as const) {
            const text = JSON.stringify(DOC_CONTENT['extension-ui'][locale]);
            expect(text).toContain('page-components');
            for (const type of PAGE_TYPES) expect(text, `${locale}/${type}`).toContain(`/docs/extension-ui/${typeToSlug(type)}`);
            expect(text).toContain('EMPTY_STATE');
        }
    });
});
