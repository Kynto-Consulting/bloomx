import type { TsDocsData, TsSymbol } from '@/lib/tsdocs/extract';
import data from './generated/sdk-tsdocs.json';
import { TSDOCS_BASE } from './tsdocs-lite';

export * from './tsdocs-lite';

/** Datos completos (solo servidor / tests): el cliente usa tsdocs-lite para no cargar el JSON entero. */
export const TSDOCS = data as unknown as TsDocsData;
export const TSDOCS_SYMBOLS: TsSymbol[] = TSDOCS.symbols;
export { TSDOCS_BASE };

export function findSymbol(module: string, name: string): TsSymbol | undefined {
    return TSDOCS_SYMBOLS.find((s) => s.name === name && s.module === module);
}

/** Alias de URL (minusculas sin sufijo Service, nombres historicos) -> simbolo canonico. Redirigen a la URL canonica. */
const NAME_ALIASES: Record<string, string> = { ExtensionManifest: 'Manifest' };
export function aliasesFor(s: TsSymbol): string[] {
    const out = new Set<string>();
    if (s.category === 'host-service') out.add(s.name.replace(/Service$/, '').toLowerCase());
    for (const [alias, target] of Object.entries(NAME_ALIASES)) if (target === s.name) out.add(alias);
    out.delete(s.name);
    return [...out];
}
export function resolveAlias(module: string, name: string): TsSymbol | undefined {
    return TSDOCS_SYMBOLS.find((s) => s.module === module && aliasesFor(s).includes(name));
}

/** Orden global (modulo y aparicion) para anterior/siguiente. */
export function tsdocsNeighbours(s: TsSymbol): { prev?: TsSymbol; next?: TsSymbol } {
    const i = TSDOCS_SYMBOLS.indexOf(s);
    return { prev: TSDOCS_SYMBOLS[i - 1], next: TSDOCS_SYMBOLS[i + 1] };
}

/** Todos los {@link X} de la documentacion de un simbolo (para el test de enlaces rotos). */
export function docLinkTargets(s: TsSymbol): string[] {
    const texts: string[] = [s.doc.summary, s.doc.remarks ?? '', ...s.doc.see, ...s.members.flatMap((m) => [m.doc.summary, m.doc.remarks ?? '', ...m.doc.see])];
    const out: string[] = [];
    for (const t of texts) for (const m of t.matchAll(/{@links+([A-Za-z_$][w$]*)/g)) out.push(m[1]);
    return out;
}
