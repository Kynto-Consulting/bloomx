/**
 * Schema de UI de extensiones: fixtures validas e invalidas, props hostiles, limites, migracion del formato antiguo
 * (incluidos los 21 manifests reales) y PARIDAD de las copias entre repos.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    COMMON_PROPS, FORBIDDEN_PROP_KEYS, GAPS, TONES, UI_ACTIONS, UI_COMPONENTS, UI_LIMITS, coerceProps, formatUiIssues, migrateLegacyUi, migrateManifestUi,
    suggest, validateManifestUi, validateUi,
} from '../ui-schema';
import { checkExpression } from '../expressions';
import { normalizeMount, validateManifest } from '../manifest-schema';

const ROOT = path.resolve(__dirname, '../../../..');
const EXT_ROOT = path.resolve(ROOT, '../bloomx-extensions');
const BACKEND_ROOT = path.resolve(ROOT, '../bloomx-backend');
const opts = { root: 'body', checkExpression };
const migrate = (ui: any) => migrateLegacyUi<any>(ui);
const ok = (node: unknown) => validateUi(node, opts);
const errs = (node: unknown) => validateUi(node, opts).errors;

describe('validateUi: arboles validos', () => {
    it('un arbol con layout, texto, boton, formulario y tabla valida sin errores ni avisos', () => {
        const result = ok({
            type: 'STACK', props: { gap: 4, align: 'stretch' },
            children: [
                { type: 'HEADING', props: { content: 'Hola ${context.subject | truncate:20}', level: 2 } },
                { type: 'TEXT', props: { content: 'Texto', variant: 'muted' } },
                { type: 'BUTTON', props: { label: 'Guardar', tone: 'primary', variant: 'solid', loading: '${state.$loading.save}', onClick: { action: 'CALL_BACKEND', function: 'save', args: { a: '${state.a}' }, retry: { attempts: 3 }, onSuccess: { action: 'TOAST', message: 'ok', variant: 'success' } } } },
                { type: 'FORM', props: { submitLabel: 'Enviar', onSubmit: { action: 'CALL_BACKEND', function: 'send' }, fields: [{ name: 'email', label: 'Correo', type: 'email', required: true, rules: { email: true, message: 'Correo no valido' } }] } },
                { type: 'TABLE', props: { columns: [{ key: 'name', label: 'Nombre', sortable: true }], rows: '${state.rows}', pageSize: 10 } },
            ],
        });
        expect(result.errors).toEqual([]);
        expect(result.ok).toBe(true);
        expect(result.nodes).toBe(6);
    });

    it('cada componente del catalogo tiene documentacion y cada prop una descripcion', () => {
        for (const [type, spec] of Object.entries(UI_COMPONENTS)) {
            expect(spec.doc.length, type).toBeGreaterThan(5);
            for (const [name, prop] of Object.entries(spec.props)) {
                expect(prop.k, `${type}.${name}`).toBeTruthy();
                expect(prop.doc, `${type}.${name} sin doc`).toBeTruthy();
            }
        }
        for (const [name, spec] of Object.entries(UI_ACTIONS)) expect(spec.doc.length, name).toBeGreaterThan(5);
        for (const [name, prop] of Object.entries(COMMON_PROPS)) expect(prop.doc, name).toBeTruthy();
    });

    it('todas las escalas semanticas del kit estan cubiertas por el schema', () => {
        expect(UI_COMPONENTS.STACK.props.gap.values).toEqual(GAPS);
        expect(UI_COMPONENTS.BADGE.props.tone.values).toEqual(TONES);
        for (const type of ['BUTTON', 'ALERT', 'CHIP', 'TEXT', 'PROGRESS', 'STAT', 'AVATAR']) expect(UI_COMPONENTS[type].props.tone.values, type).toEqual(TONES);
    });
});

describe('validateUi: errores legibles con ruta', () => {
    it('enum invalido -> ruta exacta, valores permitidos y sugerencia', () => {
        const [error] = errs({ type: 'STACK', children: [{ type: 'TEXT' }, { type: 'TEXT' }, { type: 'BADGE', props: { label: 'x', tone: 'sucsess' } }] });
        expect(error.path).toBe('body.children[2].props.tone');
        expect(error.message).toMatch(/neutral, primary, success, warning, danger, info/);
        expect(error.message).toMatch(/quisiste decir success/);
    });

    it('componente desconocido con sugerencia y falta de type', () => {
        expect(errs({ type: 'BUTON' })[0]).toMatchObject({ path: 'body.type', code: 'unknown-component' });
        expect(errs({ type: 'BUTON' })[0].message).toMatch(/BUTTON/);
        expect(errs({ props: {} })[0]).toMatchObject({ path: 'body.type', code: 'required' });
        expect(errs('texto')[0].code).toBe('type');
        expect(errs(null)[0].code).toBe('required');
    });

    it('tipos incorrectos: numero, booleano, texto, objeto', () => {
        expect(errs({ type: 'GRID', props: { columns: 'mil' } })[0].path).toBe('body.props.columns');
        expect(errs({ type: 'PROGRESS', props: { value: 'x' } })[0].code).toBe('type');
        expect(errs({ type: 'BUTTON', props: { loading: 'si' } })[0].code).toBe('type');
        expect(errs({ type: 'TEXT', props: { content: { a: 1 } } })[0].code).toBe('type');
        expect(errs({ type: 'TABLE', props: { columns: 'x' } })[0].code).toBe('type');
        expect(errs({ type: 'TEXT', props: 'x' })[0].path).toBe('body.props');
    });

    it('rangos numericos y nombres invalidos', () => {
        expect(errs({ type: 'HEADING', props: { level: 9 } })[0].code).toBe('enum');
        expect(errs({ type: 'TEXTAREA', props: { rows: 500 } })[0].code).toBe('range');
        expect(errs({ type: 'INPUT', props: { bind: '__proto__.x' } })[0].code).toBe('bad-name');
        expect(errs({ type: 'INPUT', props: { bind: 'con espacios' } })[0].code).toBe('bad-name');
    });

    it('acciones: nombre desconocido, campos requeridos y encadenadas con ruta', () => {
        const e = errs({ type: 'BUTTON', props: { label: 'x', onClick: [{ action: 'TOAST', message: 'ok' }, { action: 'CALL_BACKEND' }] } });
        expect(e[0]).toMatchObject({ path: 'body.props.onClick[1].function', code: 'required' });
        expect(errs({ type: 'BUTTON', props: { onClick: { action: 'CALL_BACKED', function: 'x' } } })[0].message).toMatch(/CALL_BACKEND/);
        expect(errs({ type: 'BUTTON', props: { onClick: { action: 'SET_STATE' } } })[0].path).toBe('body.props.onClick.key');
        expect(errs({ type: 'BUTTON', props: { onClick: { action: 'CALL_BACKEND', function: 'f', retry: { attempts: 99 } } } })[0].path).toBe('body.props.onClick.retry.attempts');
        expect(errs({ type: 'BUTTON', props: { onClick: 'CALL_BACKEND' } })[0].code).toBe('type');
        expect(errs({ type: 'BUTTON', props: { onClick: { action: 'CALL_BACKEND', function: 'f', onSuccess: { action: 'NOPE' } } } })[0].path).toBe('body.props.onClick.onSuccess.action');
    });

    it('slots anidados (tabs, wizard, condicional) se validan con su ruta', () => {
        const e = errs({ type: 'TABS', props: { tabs: [{ label: 'A', content: [{ type: 'TEXT', props: { tone: 'x' } }] }] } });
        expect(e[0].path).toBe('body.props.tabs[0].content[0].props.tone');
        const c = errs({ type: 'CONDITIONAL', props: { condition: '${a', true: [{ type: 'NOPE' }] } });
        expect(c.map((x) => x.path)).toEqual(expect.arrayContaining(['body.props.condition', 'body.props.true[0].type']));
    });

    it('expresiones invalidas: mensaje con posicion; filtros desconocidos; llamadas a funcion', () => {
        expect(checkExpression('a +')).toMatch(/incompleta/);
        expect(checkExpression('a | nofilter')).toMatch(/filtro desconocido/);
        expect(checkExpression('context.x()')).toMatch(/filtros/);
        expect(checkExpression('a # b')).toMatch(/posicion/);
        expect(checkExpression('a * b % c / 2')).toBeNull();
        const e = errs({ type: 'TEXT', props: { content: 'Hola ${a +}' } });
        expect(e[0]).toMatchObject({ path: 'body.props.content', code: 'bad-expression' });
    });

    it('advertencias: prop desconocida con sugerencia y children en componentes sin hijos', () => {
        const r = ok({ type: 'BUTTON', props: { lable: 'x' }, children: [{ type: 'TEXT' }] });
        expect(r.ok).toBe(true);
        expect(r.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['unknown-prop', 'unexpected-children']));
        expect(r.warnings.find((w) => w.code === 'unknown-prop')!.message).toMatch(/label/);
        expect(ok({ type: 'TEXT', foo: 1 } as any).warnings[0].code).toBe('unknown-node-key');
    });

    it('requeridos: ICON_BUTTON sin label', () => {
        expect(errs({ type: 'ICON_BUTTON', props: { icon: 'Mail' } }).some((e) => e.path === 'body.props.label')).toBe(true);
    });
});

describe('validateUi: props hostiles', () => {
    it.each(['className', 'style', 'color', 'bg', 'backgroundColor', 'background', 'dangerouslySetInnerHTML', 'innerHTML', 'html', 'border', 'shadow', 'fill', 'key', 'ref'])('prop `%s` rechazada', (key) => {
        const [e] = errs({ type: 'STACK', props: { [key]: 'x' } });
        expect(e).toMatchObject({ path: `body.props.${key}`, code: 'forbidden-prop' });
    });

    it('todas las claves prohibidas estan listadas y ningun componente las declara', () => {
        for (const spec of Object.values(UI_COMPONENTS)) for (const key of Object.keys(spec.props)) expect(FORBIDDEN_PROP_KEYS, key).not.toContain(key);
    });

    it('eventos DOM, __proto__ y constructor', () => {
        expect(errs({ type: 'BUTTON', props: { onclick: 'alert(1)' } })[0].code).toBe('forbidden-prop');
        expect(errs(JSON.parse('{"type":"TEXT","props":{"__proto__":{"x":1},"content":"a"}}'))[0]).toMatchObject({ code: 'forbidden-prop', path: 'body.props.__proto__' });
        expect(errs(JSON.parse('{"type":"TABLE","props":{"rows":[{"__proto__":1}]}}'))[0].code).toBe('forbidden-prop');
    });

    it('HTML en props de texto, CSS url(), URLs javascript:/data: y hex en props semanticas', () => {
        expect(errs({ type: 'TEXT', props: { content: '<script>alert(1)</script>' } })[0].code).toBe('html-not-allowed');
        expect(errs({ type: 'TEXT', props: { content: '<img src=x onerror=alert(1)>' } })[0].code).toBe('html-not-allowed');
        expect(errs({ type: 'TEXT', props: { content: 'url(https://x)' } })[0].code).toBe('css-not-allowed');
        expect(errs({ type: 'LINK', props: { label: 'x', url: 'javascript:alert(1)' } })[0].code).toBe('unsafe-url');
        expect(errs({ type: 'LINK', props: { label: 'x', url: 'data:text/html,<b>' } })[0].code).toBe('unsafe-url');
        expect(errs({ type: 'LINK', props: { label: 'x', url: 'ftp://x' } })[0].code).toBe('bad-url');
        expect(errs({ type: 'BADGE', props: { label: 'x', tone: '#ff0000' } })[0].code).toBe('enum');
        expect(errs({ type: 'BADGE', props: { label: 'x', tone: 'url(javascript:1)' } })[0].code).toBe('enum');
        // texto normal con # o <= no es HTML
        expect(ok({ type: 'TEXT', props: { content: 'Issue #12 <= 5 y a<b' } }).errors).toEqual([]);
    });

    it('COLOR_PICKER solo acepta hex como dato (value/defaultValue)', () => {
        expect(errs({ type: 'COLOR_PICKER', props: { name: 'c', value: '#aabbcc' } })).toEqual([]);
        expect(errs({ type: 'COLOR_PICKER', props: { name: 'c', value: 'red' } })[0].code).toBe('bad-color');
    });

    it('patrones regex invalidos o con backtracking catastrofico', () => {
        expect(errs({ type: 'INPUT', props: { rules: { pattern: '(' } } })[0].code).toBe('bad-pattern');
        expect(errs({ type: 'INPUT', props: { rules: { pattern: '(a+)+$' } } })[0].code).toBe('costly-pattern');
        expect(errs({ type: 'INPUT', props: { rules: { pattern: 'a'.repeat(300) } } })[0].code).toBe('too-long');
        expect(errs({ type: 'INPUT', props: { rules: { pattern: '^[a-z]{3}\\d+$' } } })).toEqual([]);
    });
});

describe('validateUi: limites', () => {
    it('demasiados nodos', () => {
        const children = Array.from({ length: UI_LIMITS.maxNodes + 5 }, () => ({ type: 'SPACER' }));
        const chunks: any[] = [];
        for (let i = 0; i < children.length; i += 100) chunks.push({ type: 'STACK', children: children.slice(i, i + 100) });
        expect(errs({ type: 'STACK', children: chunks }).some((e) => e.code === 'too-many-nodes')).toBe(true);
    });

    it('profundidad excesiva', () => {
        let node: any = { type: 'TEXT', props: { content: 'x' } };
        for (let i = 0; i < UI_LIMITS.maxDepth + 3; i++) node = { type: 'STACK', children: [node] };
        expect(errs(node).some((e) => e.code === 'too-deep')).toBe(true);
        let shallow: any = { type: 'TEXT', props: { content: 'x' } };
        for (let i = 0; i < 10; i++) shallow = { type: 'STACK', children: [shallow] };
        expect(errs(shallow)).toEqual([]);
    });

    it('texto, arreglo y tamano total', () => {
        expect(errs({ type: 'TEXT', props: { content: 'x'.repeat(UI_LIMITS.maxString + 1) } })[0].code).toBe('too-long');
        expect(errs({ type: 'TABLE', props: { rows: Array.from({ length: UI_LIMITS.maxArray + 1 }, (_, i) => ({ i })) } })[0].code).toBe('too-many');
        const big = { type: 'STACK', children: Array.from({ length: 30 }, () => ({ type: 'TEXT', props: { content: 'y'.repeat(9000) } })) };
        expect(errs(big).some((e) => e.code === 'too-large')).toBe(true);
    });

    it('referencias circulares no rompen el validador', () => {
        const a: any = { type: 'STACK', props: {} };
        a.props.self = a;
        expect(errs(a)[0].code).toBe('not-json');
    });
});

describe('coerceProps (saneado en ejecucion)', () => {
    it('enums fuera de rango caen al defecto, numeros se acotan, booleanos se coaccionan', () => {
        const notes: string[] = [];
        const r = coerceProps('BUTTON', { tone: 'rainbow', variant: 'solid', size: {}, loading: 'true', className: 'x', onclick: 'y' }, (k, m) => notes.push(`${k}:${m}`));
        expect(r.tone).toBeUndefined();
        expect(r.variant).toBe('solid');
        expect(r.size).toBe('md');
        expect(r.loading).toBe(true);
        expect('className' in r).toBe(false);
        expect('onclick' in r).toBe(false);
        expect(notes.join('|')).toMatch(/rainbow/);
        expect(coerceProps('GRID', { columns: '3', gap: '4' })).toMatchObject({ columns: 3, gap: 4 });
        expect(coerceProps('TEXTAREA', { rows: 9999 }).rows).toBe(40);
        expect(coerceProps('STACK', { gap: 'url(x)' }).gap).toBe(3); // defecto de STACK
        expect(coerceProps('NOPE', { x: 1 })).toEqual({ x: 1 });
        expect(coerceProps('STACK', null)).toEqual({});
    });

    it('las acciones y slots pasan intactos', () => {
        const onClick = { action: 'TOAST', message: 'x' };
        expect(coerceProps('BUTTON', { onClick }).onClick).toBe(onClick);
    });
});

describe('migrateLegacyUi', () => {
    it('adapta COLUMN/variant/className/bindTo y avisa de lo obsoleto', () => {
        const legacy = {
            type: 'COLUMN', props: { className: 'p-4' },
            children: [
                { type: 'BUTTON', props: { label: 'Go', variant: 'primary', className: 'w-full justify-start', onClick: { action: 'TOAST', message: 'x' } } },
                { type: 'TEXT', props: { content: 'Error', variant: 'error' } },
                { type: 'TEXT', props: { content: 'Titulo', variant: 'h4' } },
                { type: 'INPUT', props: { bindTo: 'q', multiline: true, placeholder: 'p' } },
                { type: 'ALERT', props: { variant: 'info', description: 'd' } },
                { type: 'BADGE', props: { label: 'b', variant: 'success' } },
            ],
        };
        const snapshot = JSON.stringify(legacy);
        const { ui, notices } = migrate(legacy);
        expect(JSON.stringify(legacy)).toBe(snapshot); // no muta
        expect(ui.type).toBe('STACK');
        expect(ui.props).not.toHaveProperty('className');
        const [button, error, heading, input, alert, badge] = ui.children;
        expect(button.props).toMatchObject({ variant: 'solid', tone: 'primary', fullWidth: true, align: 'start' });
        expect(error).toMatchObject({ type: 'ALERT', props: { tone: 'danger', message: 'Error' } });
        expect(heading).toMatchObject({ type: 'HEADING', props: { level: 4 } });
        expect(input).toMatchObject({ type: 'TEXTAREA', props: { bind: 'q' } });
        expect(alert.props).toMatchObject({ tone: 'info', message: 'd' });
        expect(badge.props).toMatchObject({ tone: 'success', variant: 'soft' });
        expect(notices.length).toBeGreaterThan(5);
        expect(notices.some((n) => /className/.test(n.message))).toBe(true);
        // el resultado valida
        expect(validateUi(ui, opts).errors).toEqual([]);
        // idempotente
        expect(migrate(ui).ui).toEqual(ui);
    });

    it('BUTTON con menuOptions -> MENU; TABS/ACCORDION con hijos -> props; BOX/FLEX/SPACER/GRID a la escala', () => {
        const { ui } = migrate({
            type: 'COLUMN', children: [
                { type: 'BUTTON', props: { label: 'M', menuOptions: [{ label: 'a', onClick: { action: 'TOAST', message: 'a' } }] } },
                { type: 'TABS', children: [{ type: 'TAB_ITEM', props: { label: 'T', value: 't' }, children: [{ type: 'TEXT', props: { content: 'c' } }] }] },
                { type: 'ACCORDION', children: [{ type: 'ACCORDION_ITEM', props: { title: 'A' }, children: [{ type: 'TEXT', props: { content: 'c' } }] }] },
                { type: 'FLEX', props: { direction: 'column', gap: 10, align: 'flex-start', justify: 'space-between' } },
                { type: 'SPACER', props: { size: 16 } },
                { type: 'GRID', props: { columns: 9, gap: 2, maxHeight: 240 } },
                { type: 'DATA_TABLE', props: { data: [], columns: [], actions: [] } },
                { type: 'EMPTY_STATE', props: { title: 't', icon: '📭' } },
                { type: 'CODE_BLOCK', props: { code: 'x' } },
                { type: 'IFRAME', props: { html: '<b>x</b>' } },
            ],
        });
        const c = ui.children;
        expect(c[0]).toMatchObject({ type: 'MENU', props: { items: [{ label: 'a' }] } });
        expect(c[1].props.tabs[0]).toMatchObject({ label: 'T', value: 't' });
        expect(c[2].props.sections[0].title).toBe('A');
        expect(c[3]).toMatchObject({ type: 'STACK', props: { gap: 2, align: 'start', justify: 'between' } });
        expect(c[4].props.size).toBe(4);
        expect(c[5].props).toMatchObject({ columns: 6, gap: 2, maxHeight: 'md' });
        expect(c[6].type).toBe('TABLE');
        expect(c[7]).toMatchObject({ type: 'EMPTY', props: { title: 't' } });
        expect(c[7].props.icon).toBeUndefined();
        expect(c[8]).toMatchObject({ type: 'CODE', props: { block: true, content: 'x' } });
        expect(c[9]).toMatchObject({ type: 'ALERT', props: { tone: 'warning' } });
        expect(validateUi(ui, opts).errors).toEqual([]);
    });

    it('elimina siempre style/color/HTML/eventos DOM con aviso, tambien dentro de slots y acciones', () => {
        const { ui, notices } = migrate({
            type: 'STACK', props: { style: { color: 'red' }, onclick: 'x' },
            children: [{ type: 'CONDITIONAL', props: { condition: true, true: [{ type: 'TEXT', props: { content: 'x', color: 'red', className: 'text-red-500' } }] } }],
        });
        expect(JSON.stringify(ui)).not.toMatch(/red|style|className|onclick/);
        expect(notices.filter((n) => n.code === 'style-removed').length).toBeGreaterThanOrEqual(2);
        expect(ui.children[0].props.true[0].props.tone).toBe('danger');
    });

    it('WIZARD heredado pasa a nav manual SOLO si su contenido usa NEXT_STEP/PREV_STEP; MODAL con width en px a la escala', () => {
        const step = { title: 'p', content: [{ type: 'BUTTON', props: { label: 'Sig', onClick: { action: 'NEXT_STEP' } } }] };
        const { ui } = migrate({ type: 'MODAL', props: { title: 't', width: '420px', children: [{ type: 'WIZARD', props: { steps: [step] } }, { type: 'WIZARD', props: { steps: [{ title: 'q', content: [] }] } }] } });
        expect(ui.props.width).toBe('sm');
        expect(ui.children[0].props.nav).toBe('manual');
        expect(ui.children[1].props.nav).toBe('manual'); // documento heredado: el comportamiento antiguo era manual
        expect(migrate({ type: 'WIZARD', props: { steps: [{ title: 'q', content: [] }] } }).ui.props.nav).toBeUndefined(); // documento moderno: nav auto por defecto
    });

    it('el UI ya escrito con el kit nuevo pasa intacto (sin valores por defecto del formato antiguo)', () => {
        const modern = { type: 'STACK', props: { gap: 3 }, children: [{ type: 'BUTTON', props: { label: 'x', tone: 'primary', variant: 'solid' } }, { type: 'SPACER', props: { size: 3 } }, { type: 'GRID', props: { columns: 3, maxHeight: 'lg' } }] };
        const { ui, notices } = migrate(modern);
        expect(ui).toEqual(modern);
        expect(notices).toEqual([]);
    });
});

describe('migrateManifestUi y los manifests reales', () => {
    const hasExt = fs.existsSync(EXT_ROOT);
    const ids = hasExt ? fs.readdirSync(EXT_ROOT).filter((d) => !d.startsWith('_') && fs.existsSync(path.join(EXT_ROOT, d, 'manifest.json'))) : [];

    // Lista explicita (no un numero): al anadir una extension el test dice cual falta o sobra.
    const EXPECTED = ['appointments', 'calendar', 'composer-helper', 'dlp', 'domain-metrics', 'giphy', 'google-drive', 'google-meet', 'google-sync', 'googlelib', 'hubspot', 'mail-groups', 'microsoft-teams', 'microsoftlib', 'notion', 'organizer', 'quick-notes', 'sealer', 'signature', 'slack-notify', 'slacklib', 'slash-commands', 'smart-reply', 'summarizer', 'translator', 'trello', 'webhooks', 'zoom', 'zoomlib'];
    it.skipIf(!hasExt)('las extensiones del repositorio son las esperadas', () => { expect([...ids].sort()).toEqual(EXPECTED); });

    it.skipIf(!hasExt).each(ids)('%s: el UI migrado valida sin errores (y el manifest sigue siendo valido)', (id) => {
        const manifest = JSON.parse(fs.readFileSync(path.join(EXT_ROOT, id, 'manifest.json'), 'utf8'));
        expect(validateManifest(manifest).ok).toBe(true);
        const normalized = { ...manifest, mounts: Array.isArray(manifest.mounts) ? manifest.mounts.map(normalizeMount) : manifest.mounts };
        const { ui, notices } = migrateManifestUi(normalized);
        const result = validateManifestUi(ui, { checkExpression });
        expect(formatUiIssues(result.errors, 20)).toBe('');
        // el resultado migrado ya no produce avisos de obsolescencia
        expect(migrateManifestUi(ui).notices).toEqual([]);
        expect(notices.every((n) => ['deprecated', 'style-removed', 'unsupported'].includes(n.code))).toBe(true);
    });

    it('el formato antiguo de mount (component como texto) se normaliza', () => {
        const { ui } = migrateManifestUi({ mounts: [{ point: 'SETTINGS_TAB', component: 'MODAL', props: { title: 'T', children: [{ type: 'TEXT', props: { content: 'x' } }] } }] });
        expect(ui.mounts[0].component).toMatchObject({ type: 'MODAL', children: [{ type: 'TEXT' }] });
    });
});

describe('suggest', () => {
    it('devuelve el candidato mas cercano o null', () => {
        expect(suggest('sucsess', ['success', 'danger'])).toBe('success');
        expect(suggest('zzzzzz', ['success', 'danger'])).toBeNull();
    });
});

describe('paridad de las copias entre repos', () => {
    const read = (file: string) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const files: Array<[string, string, string]> = [
        ['ui-schema.ts', 'src/lib/expansions/ui-schema.ts', 'src/lib/extensions/ui-schema.ts'],
        ['expressions.ts', 'src/lib/expansions/expressions.ts', 'src/lib/extensions/expressions.ts'],
    ];
    it.each(files)('%s es identico en extensiones, backend y frontend', (name, _front, backPath) => {
        const front = read(path.join(ROOT, 'src/lib/expansions', name));
        const canonical = path.join(EXT_ROOT, '_shared', name);
        if (fs.existsSync(canonical)) expect(read(canonical), `_shared/${name} difiere del frontend`).toBe(front);
        const back = path.join(BACKEND_ROOT, backPath);
        if (fs.existsSync(back)) expect(read(back), `backend ${name} difiere del frontend`).toBe(front);
    });
});

describe('toolbar: pista de presentacion en las barras de acciones', () => {
    const button = (toolbar: unknown) => ({ type: 'BUTTON', props: { label: 'Notion', icon: 'Database', onClick: { action: 'TOAST', message: 'x' }, toolbar } });
    it('BUTTON, ICON_BUTTON y MENU aceptan toolbar { pinned, priority, label, description }', () => {
        const hint = { pinned: true, priority: 10, label: 'Notion', description: 'Guarda el correo en Notion' };
        expect(errs(button(hint))).toEqual([]);
        expect(errs({ type: 'ICON_BUTTON', props: { icon: 'Star', label: 'Estrella', onClick: { action: 'TOAST', message: 'x' }, toolbar: hint } })).toEqual([]);
        expect(errs({ type: 'MENU', props: { label: 'Mas', items: [], toolbar: hint } })).toEqual([]);
    });
    it('rechaza tipos incorrectos, prioridades fuera de rango y claves desconocidas', () => {
        expect(errs(button({ pinned: 'si' })).length).toBeGreaterThan(0);
        expect(errs(button({ priority: -1 })).length).toBeGreaterThan(0);
        expect(errs(button({ priority: 5000 })).length).toBeGreaterThan(0);
        expect(errs(button('anclada')).length).toBeGreaterThan(0);
        expect(JSON.stringify(errs(button({ className: 'bg-primary' })))).toMatch(/className|desconoc|unknown/i);
    });
});
