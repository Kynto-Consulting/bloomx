import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import path from 'node:path';
import { extractFile, extractSdk, parseTsDoc } from '../extract';
import { FULL_JSON, SDK_SOURCES, SEARCH_JSON, generateFromRoot, sdkDir, sdkSourcesAvailable } from '../generate';
import {
    MODULES, TSDOCS, TSDOCS_SYMBOLS, aliasesFor, docLinkTargets, findSymbol, findSymbolByName, resolveAlias, splitLinks, tokenizeCode, tsdocsHref, tsdocsNeighbours,
} from '@/app/docs/_content/tsdocs';
import { I18nProvider } from '@/components/I18nProvider';
import { IndexView } from '@/app/docs/_components/tsdocs/IndexView';
import { SymbolView } from '@/app/docs/_components/tsdocs/SymbolView';
import { buildIndex, search } from '@/app/docs/_content/search';
import { generateStaticParams } from '@/app/docs/extension-tools/tsdocs/[...slug]/page';

const ROOT = process.cwd();
const norm = (s: string) => s.replace(/\r\n/g, '\n');
const HAVE_SDK = sdkSourcesAvailable(ROOT);
const FENCE = '```';

describe('extractor (fixture)', () => {
    const fixture = [
        'import type { Other } from "./other";',
        '/**',
        ' * Suma dos valores. Ver {@link Other}.',
        ' *',
        ' * @remarks Nota larga',
        ' *   en dos lineas.',
        ' * @param a - primer sumando',
        ' * @param b segundo sumando',
        ' * @returns la suma',
        ' * @example Basico',
        ` * ${FENCE}ts`,
        ' * add(1, 2); // 3',
        ` * ${FENCE}`,
        ' * @deprecated usa addAll',
        ' * @since 2.1',
        ' * @see {@link Other}',
        ' */',
        'export function add<T extends number = number>(a: T, b?: T, ...rest: number[]): number;',
        '',
        '/** Opciones. */',
        'export interface Opts<K = string> extends Base, Other {',
        '    /** Nombre.',
        '     * @default "x"',
        '     */',
        '    readonly name?: K;',
        '    /** Ejecuta.',
        '     * @param n cantidad',
        '     * @returns nada',
        '     */',
        '    run(n: number): void;',
        '    [key: string]: unknown;',
        '}',
        'export interface Base { a: 1 }',
        'export type Mode = "a" | "b" | 3;',
        'export enum Color { Red = "red", Blue = 2 }',
        'export const VERSION: "1.0";',
        'interface NotExported { x: 1 }',
        '',
    ].join('\n');
    const syms = extractFile({ module: 'fx', file: 'fixture.d.ts', text: fixture });
    const by = (n: string) => syms.find((s) => s.name === n)!;

    it('solo extrae lo exportado y clasifica por tipo', () => {
        expect(syms.map((s) => `${s.kind}:${s.name}`)).toEqual(['function:add', 'interface:Opts', 'interface:Base', 'type:Mode', 'enum:Color', 'const:VERSION']);
    });

    it('lee TSDoc: resumen, @remarks, @param, @returns, @example, @deprecated, @since, @see', () => {
        const d = by('add').doc;
        expect(d.summary).toBe('Suma dos valores. Ver {@link Other}.');
        expect(d.remarks).toContain('en dos lineas');
        expect(d.params).toEqual([{ name: 'a', text: 'primer sumando' }, { name: 'b', text: 'segundo sumando' }]);
        expect(d.returns).toBe('la suma');
        expect(d.examples).toEqual([{ lang: 'ts', code: 'add(1, 2); // 3', title: 'Basico' }]);
        expect(d.deprecated).toBe('usa addAll');
        expect(d.since).toBe('2.1');
        expect(d.see).toEqual(['{@link Other}']);
    });

    it('funciones: parametros, genericos, opcional, resto, retorno y firma', () => {
        const f = by('add');
        expect(f.typeParams).toEqual([{ name: 'T', constraint: 'number', default: 'number' }]);
        expect(f.params.map((p) => [p.name, p.type, p.optional, p.rest, p.doc])).toEqual([
            ['a', 'T', false, false, 'primer sumando'], ['b', 'T', true, false, 'segundo sumando'], ['rest', 'number[]', false, true, undefined],
        ]);
        expect(f.returns).toBe('number');
        expect(f.signature).toBe('export function add<T extends number = number>(a: T, b?: T, ...rest: number[]): number;');
    });

    it('interfaces: herencia, miembros (opcional/readonly/default/metodo/indice) y referencias', () => {
        const o = by('Opts');
        expect(o.extends).toEqual(['Base', 'Other']);
        expect(o.members.map((m) => [m.name, m.kind, m.optional, m.readonly])).toEqual([
            ['name', 'property', true, true], ['run', 'method', false, false], ['[key: string]', 'index', false, false],
        ]);
        expect(o.members[0].doc.default).toBe('"x"');
        expect(o.members[1].params).toEqual([{ name: 'n', type: 'number', optional: false, rest: false, doc: 'cantidad' }]);
        expect(o.members[1].doc.returns).toBe('nada');
        expect(o.refs).toContain('Base');
    });

    it('uniones literales y enums exponen sus valores', () => {
        expect(by('Mode').unionValues).toEqual(['"a"', '"b"', '3']);
        expect(by('Color').unionValues).toEqual(['"red"', '2']);
        expect(by('Color').signature).toContain('Red = "red"');
        expect(by('VERSION').signature).toBe('export const VERSION: "1.0";');
    });

    it('extractSdk resuelve usedBy y rechaza nombres duplicados entre modulos', () => {
        const data = extractSdk([{ module: 'fx', file: 'f.d.ts', text: fixture }]);
        expect(data.symbols.find((s) => s.name === 'Base')!.usedBy).toEqual(['Opts']);
        const dup = { module: 'a', file: 'a.d.ts', text: 'export interface X { a: 1 }' };
        expect(() => extractSdk([dup, { ...dup, module: 'b' }])).toThrow(/duplicado/);
    });

    it('parseTsDoc tolera comentarios vacios o ausentes', () => {
        expect(parseTsDoc(null).summary).toBe('');
        expect(parseTsDoc('/** */').examples).toEqual([]);
    });
});

describe('JSON generado del SDK', () => {
    it.skipIf(!HAVE_SDK)('esta al dia: regenerar en memoria coincide con lo commiteado (npm run docs:tsdocs)', () => {
        const { full, search: s } = generateFromRoot(ROOT);
        expect(norm(fs.readFileSync(path.join(ROOT, FULL_JSON), 'utf8')), `${FULL_JSON} desactualizado: npm run docs:tsdocs`).toBe(full);
        expect(norm(fs.readFileSync(path.join(ROOT, SEARCH_JSON), 'utf8')), `${SEARCH_JSON} desactualizado: npm run docs:tsdocs`).toBe(s);
    });

    it.skipIf(!HAVE_SDK)('todo simbolo exportado de los .d.ts del SDK tiene entrada, pagina estatica y fila de busqueda', () => {
        const params = new Set(generateStaticParams().map((p) => p.slug.join('/')));
        const searchNames = new Set(buildIndex('es').filter((e) => e.page === 'TSDocs').map((e) => e.heading));
        const exported: string[] = [];
        for (const src of SDK_SOURCES) {
            const text = fs.readFileSync(path.join(sdkDir(ROOT), src.file), 'utf8');
            for (const m of text.matchAll(/^export (?:declare )?(?:interface|type|function|const|enum|class) ([A-Za-z_$][\w$]*)/gm)) exported.push(m[1]);
        }
        expect(exported.length).toBeGreaterThan(150);
        for (const name of exported) {
            const s = findSymbolByName(name);
            expect(s, `${name} sin entrada en el JSON`).toBeTruthy();
            expect(params.has(`${s!.module}/${name}`), `${name} sin pagina`).toBe(true);
            expect(searchNames.has(name), `${name} sin entrada de busqueda`).toBe(true);
        }
        expect(TSDOCS_SYMBOLS.length).toBe(exported.length);
    });

    it('cada simbolo del JSON tiene pagina estatica, URL canonica unica y los alias redirigen a el', () => {
        const params = generateStaticParams().map((p) => p.slug.join('/'));
        expect(new Set(params).size).toBe(params.length);
        for (const m of MODULES) expect(params).toContain(m.id);
        const searchNames = new Set(buildIndex('es').filter((e) => e.page === 'TSDocs').map((e) => e.heading));
        for (const s of TSDOCS_SYMBOLS) {
            expect(params).toContain(`${s.module}/${s.name}`);
            expect(searchNames.has(s.name), `${s.name} sin entrada de busqueda`).toBe(true);
            expect(tsdocsHref(s)).toBe(`/docs/extension-tools/tsdocs/${s.module}/${s.name}`);
            for (const a of aliasesFor(s)) expect(resolveAlias(s.module, a)?.name).toBe(s.name);
        }
        expect(resolveAlias('host', 'storage')?.name).toBe('StorageService');
        expect(resolveAlias('manifest', 'ExtensionManifest')?.name).toBe('Manifest');
    });

    it('los enlaces entre tipos resuelven: refs, usedBy simetrico, {@link}, herencia y tokens de las firmas', () => {
        const names = new Set(TSDOCS_SYMBOLS.map((s) => s.name));
        expect(names.size).toBe(TSDOCS_SYMBOLS.length);
        for (const s of TSDOCS_SYMBOLS) {
            for (const r of s.refs) {
                expect(names.has(r), `${s.name} referencia a ${r}, que no existe`).toBe(true);
                expect(TSDOCS_SYMBOLS.find((x) => x.name === r)!.usedBy, `${r}.usedBy sin ${s.name}`).toContain(s.name);
            }
            for (const u of s.usedBy) expect(findSymbolByName(u), `${s.name}.usedBy -> ${u}`).toBeTruthy();
            for (const t of docLinkTargets(s)) expect(names.has(t), `{@link ${t}} roto en ${s.name}`).toBe(true);
            for (const e of s.extends) {
                const n = e.replace(/<.*$/, '');
                if (/^[A-Z]/.test(n)) expect(names.has(n) || /^(Error|Omit|Pick|Partial|Record|Array|Promise)$/.test(n), `${s.name} extiende ${n}`).toBe(true);
            }
            for (const t of tokenizeCode(s.signature)) if (t.kind === 'type') expect(findSymbolByName(t.text), `${s.name}: token ${t.text}`).toBeTruthy();
            for (const link of s.doc.see.flatMap((x) => splitLinks(x))) if (link.name) expect(findSymbolByName(link.name)).toBeTruthy();
        }
    });

    it('el contenido cubre el SDK pedido: Manifest, montajes, acciones, servicios del host, handlers y expresiones, con @example', () => {
        const need = ['Manifest', 'ManifestMount', 'MountPoint', 'UiAction', 'ActionHelpers', 'Expr', 'ExprHelpers', 'HandlerServices', 'StorageService', 'NotifyService', 'HandlerContext', 'Handler', 'defineManifest'];
        for (const n of need) expect(findSymbolByName(n), n).toBeTruthy();
        for (const n of ['Manifest', 'ManifestMount', 'ManifestIntercept', 'StorageService', 'NotifyService', 'HandlerContext', 'Handler', 'HandlerServices']) {
            expect(TSDOCS_SYMBOLS.find((s) => s.name === n)!.doc.examples.length, `${n} sin @example`).toBeGreaterThan(0);
        }
        expect(TSDOCS.modules.map((m) => m.id)).toEqual(['sdk', 'manifest', 'ui', 'host']);
    });

    it('el JSON no lleva rutas absolutas', () => {
        const raw = fs.readFileSync(path.join(ROOT, FULL_JSON), 'utf8');
        expect(raw).not.toMatch(/[A-Z]:\\\\|\/Users\/|\/home\//);
        for (const s of TSDOCS_SYMBOLS) expect(s.source.file.startsWith('bloomx-extensions/_shared/sdk/')).toBe(true);
        expect(findSymbol('manifest', 'Manifest')).toBeTruthy();
    });
});

describe('buscador global y tokenizador', () => {
    it('el buscador global de docs encuentra simbolos del SDK', () => {
        expect(search('es', 'ManifestMount', 3)[0]?.href).toBe('/docs/extension-tools/tsdocs/manifest/ManifestMount');
        expect(search('en', 'StorageService', 5).some((e) => e.href.endsWith('/host/StorageService'))).toBe(true);
    });

    it('tokeniza palabras clave, cadenas, comentarios y tipos conocidos sin perder texto', () => {
        const src = 'export type A = "x" | Manifest; // fin';
        const t = tokenizeCode(src, (n) => n === 'Manifest');
        expect(t.find((x) => x.kind === 'type')!.text).toBe('Manifest');
        expect(t.some((x) => x.kind === 'str' && x.text === '"x"')).toBe(true);
        expect(t.some((x) => x.kind === 'com')).toBe(true);
        expect(t.some((x) => x.kind === 'kw' && x.text === 'export')).toBe(true);
        expect(t.map((x) => x.text).join('')).toBe(src);
    });

    it('splitLinks separa {@link X} y marca los inexistentes', () => {
        expect(splitLinks('ver {@link Manifest} y {@link Nada | otro}')).toEqual([
            { text: 'ver ' }, { text: 'Manifest', name: 'Manifest' }, { text: ' y ' }, { text: 'otro', name: undefined },
        ]);
    });
});

describe('render SSR de TSDocs', () => {
    const wrap = (locale: 'es' | 'en', el: React.ReactElement) => renderToStaticMarkup(React.createElement(I18nProvider, { locale, children: el }));

    it('el indice, cada modulo y cada simbolo se renderizan en es y en con enlaces, firma y migas', () => {
        for (const locale of ['es', 'en'] as const) {
            const idx = wrap(locale, React.createElement(IndexView, {}));
            expect(idx).toContain('/docs/extension-tools/tsdocs/manifest/Manifest');
            expect(idx).toContain('role="search"');
            for (const m of MODULES) expect(wrap(locale, React.createElement(IndexView, { module: m.id }))).toContain(`id="ts-g-`);
            for (const s of TSDOCS_SYMBOLS) {
                const { prev, next } = tsdocsNeighbours(s);
                const out = wrap(locale, React.createElement(SymbolView, { symbol: s, prev, next }));
                expect(out, s.name).toContain(`<h1`);
                expect(out, s.name).toContain('aria-label="breadcrumb"');
                expect(out, s.name).not.toContain('[object Object]');
            }
        }
    }, 120_000);

    it('la pagina de Manifest enlaza a sus tipos y muestra ejemplos copiables', () => {
        const s = TSDOCS_SYMBOLS.find((x) => x.name === 'Manifest')!;
        const out = wrap('es', React.createElement(SymbolView, { symbol: s }));
        expect(out).toContain('href="/docs/extension-tools/tsdocs/manifest/ManifestMount"');
        expect(out).toContain('Copiar código');
        expect(out).toContain('bloomx-extensions/_shared/sdk/manifest.d.ts:');
    });
});
