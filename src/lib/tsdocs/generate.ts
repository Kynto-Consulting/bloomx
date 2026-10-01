import fs from 'node:fs';
import path from 'node:path';
import { extractSdk, type TsDocsData, type TsSourceFile } from './extract';

/** Fuentes del SDK (repo hermano bloomx-extensions) y modulo con el que se publican. */
export const SDK_SOURCES: Array<{ module: string; file: string }> = [
    { module: 'sdk', file: 'index.d.ts' },
    { module: 'manifest', file: 'manifest.d.ts' },
    { module: 'ui', file: 'ui.d.ts' },
    { module: 'host', file: 'ctx.d.ts' },
];

export const SDK_DISPLAY_DIR = 'bloomx-extensions/_shared/sdk';
export const FULL_JSON = 'src/app/docs/_content/generated/sdk-tsdocs.json';
export const SEARCH_JSON = 'src/app/docs/_content/generated/sdk-tsdocs-search.json';

export function sdkDir(frontendRoot: string): string {
    return path.resolve(frontendRoot, '..', 'bloomx-extensions', '_shared', 'sdk');
}

export function sdkSourcesAvailable(frontendRoot: string): boolean {
    const dir = sdkDir(frontendRoot);
    return SDK_SOURCES.every((s) => fs.existsSync(path.join(dir, s.file)));
}

export function readSdkSources(frontendRoot: string): TsSourceFile[] {
    const dir = sdkDir(frontendRoot);
    return SDK_SOURCES.map((s) => ({
        module: s.module,
        file: `${SDK_DISPLAY_DIR}/${s.file}`,
        text: fs.readFileSync(path.join(dir, s.file), 'utf8').replace(/\r\n/g, '\n'),
    }));
}

export interface SearchRow { n: string; m: string; k: string; c: string; s: string; d?: 1 }

export function toSearchRows(data: TsDocsData): SearchRow[] {
    return data.symbols.map((s) => ({ n: s.name, m: s.module, k: s.kind, c: s.category, s: s.doc.summary.replace(/\s+/g, ' ').slice(0, 200), ...(s.doc.deprecated ? { d: 1 as const } : {}) }));
}

/** Contenido exacto de los JSON commiteados (una linea por simbolo: diffs revisables). */
export function serialize(data: TsDocsData): { full: string; search: string } {
    const full = `{"version":1,"modules":${JSON.stringify(data.modules)},"symbols":[\n${data.symbols.map((s) => JSON.stringify(s)).join(',\n')}\n]}\n`;
    const search = `[\n${toSearchRows(data).map((r) => JSON.stringify(r)).join(',\n')}\n]\n`;
    return { full, search };
}

export function generateFromRoot(frontendRoot: string): { data: TsDocsData; full: string; search: string } {
    const data = extractSdk(readSdkSources(frontendRoot));
    return { data, ...serialize(data) };
}
