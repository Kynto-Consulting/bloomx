import { CmdError, type CommandDef, type FlagDef, type ParsedArgs } from './types';

/**
 * Analizador de linea de comandos. NO es un shell: no hay expansion de variables, globbing, pipes, redirecciones ni
 * sustitucion de comandos. Solo comillas simples/dobles y escapes con barra invertida. Nunca ejecuta nada del sistema.
 */

export const MAX_LINE_BYTES = 8 * 1024;

export class ParseError extends CmdError {
    constructor(code: string, message: string) {
        super(code, message, 2);
        this.name = 'ParseError';
    }
}

/**
 * Divide una linea en argumentos.
 *  - Espacios separan argumentos (fuera de comillas).
 *  - '...' literal (sin escapes). "..." admite \" \\ \n \t. Fuera de comillas, \x escapa el caracter x.
 *  - Una comilla sin cerrar o un escape final son errores. Los caracteres de control (salvo \t) se rechazan.
 */
export function tokenize(line: string): string[] {
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) throw new ParseError('line_too_long', `Line exceeds ${MAX_LINE_BYTES} bytes`);
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(line)) throw new ParseError('invalid_characters', 'Control characters are not allowed');
    const out: string[] = [];
    let cur = '';
    let has = false;
    let i = 0;
    while (i < line.length) {
        const ch = line[i];
        if (ch === ' ' || ch === '\t') {
            if (has) { out.push(cur); cur = ''; has = false; }
            i++;
            continue;
        }
        if (ch === "'") {
            const end = line.indexOf("'", i + 1);
            if (end < 0) throw new ParseError('unterminated_quote', 'Unterminated single quote');
            cur += line.slice(i + 1, end);
            has = true;
            i = end + 1;
            continue;
        }
        if (ch === '"') {
            i++;
            let closed = false;
            while (i < line.length) {
                const c = line[i];
                if (c === '\\') {
                    const n = line[i + 1];
                    if (n === undefined) throw new ParseError('dangling_escape', 'Dangling escape');
                    cur += n === 'n' ? '\n' : n === 't' ? '\t' : n;
                    i += 2;
                    continue;
                }
                if (c === '"') { closed = true; i++; break; }
                cur += c;
                i++;
            }
            if (!closed) throw new ParseError('unterminated_quote', 'Unterminated double quote');
            has = true;
            continue;
        }
        if (ch === '\\') {
            const n = line[i + 1];
            if (n === undefined) throw new ParseError('dangling_escape', 'Dangling escape');
            cur += n;
            has = true;
            i += 2;
            continue;
        }
        cur += ch;
        has = true;
        i++;
    }
    if (has) out.push(cur);
    return out;
}

/** Quita comillas para que un argumento vuelva a ser una linea valida (para historial/copia). */
export function quoteArg(a: string): string {
    if (a !== '' && /^[A-Za-z0-9_@%+=:,./*-]+$/.test(a)) return a;
    return `"${a.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

export interface GlobalFlags { json: boolean; yes: boolean; help: boolean }

/** Extrae --json / --yes|-y / --help|-h de cualquier posicion (antes de `--`). */
export function extractGlobals(argv: string[]): { rest: string[]; globals: GlobalFlags } {
    const globals: GlobalFlags = { json: false, yes: false, help: false };
    const rest: string[] = [];
    let literal = false;
    for (const a of argv) {
        if (literal) { rest.push(a); continue; }
        if (a === '--') { literal = true; rest.push(a); continue; }
        if (a === '--json') globals.json = true;
        else if (a === '--yes' || a === '-y') globals.yes = true;
        else if (a === '--help' || a === '-h') globals.help = true;
        else rest.push(a);
    }
    return { rest, globals };
}

export interface Matched { def: CommandDef; rest: string[] }

/** Busca el comando mas largo que sea prefijo de argv ("users sessions revoke ..." antes que "users sessions"). */
export function matchCommand(commands: readonly CommandDef[], argv: string[]): Matched | null {
    let best: Matched | null = null;
    let bestLen = 0;
    for (const def of commands) {
        const words = def.name.split(' ');
        if (words.length <= bestLen || words.length > argv.length) continue;
        if (words.every((w, i) => argv[i] === w)) { best = { def, rest: argv.slice(words.length) }; bestLen = words.length; }
    }
    return best;
}

function coerce(def: FlagDef, raw: string): unknown {
    switch (def.type) {
        case 'string': return raw;
        case 'number': {
            if (raw.trim() === '' || !Number.isFinite(Number(raw))) throw new ParseError('invalid_number', `--${def.name} expects a number`);
            const n = Number(raw);
            if (def.min !== undefined && n < def.min) throw new ParseError('out_of_range', `--${def.name} must be >= ${def.min}`);
            if (def.max !== undefined && n > def.max) throw new ParseError('out_of_range', `--${def.name} must be <= ${def.max}`);
            return n;
        }
        case 'boolean': {
            const v = raw.toLowerCase();
            if (['true', '1', 'yes', 'on'].includes(v)) return true;
            if (['false', '0', 'no', 'off'].includes(v)) return false;
            throw new ParseError('invalid_boolean', `--${def.name} expects true or false`);
        }
        case 'enum':
            if (!def.values?.includes(raw)) throw new ParseError('invalid_choice', `--${def.name} must be one of: ${def.values?.join(', ')}`);
            return raw;
        case 'json':
            try { return JSON.parse(raw); } catch { throw new ParseError('invalid_json', `--${def.name} expects valid JSON`); }
        case 'list':
            return raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
}

/** Valida y tipa los argumentos de UN comando. Rechaza banderas desconocidas y faltantes obligatorias. */
export function parseArgs(def: CommandDef, argv: string[]): ParsedArgs {
    const flagDefs = def.flags ?? [];
    const byName = new Map(flagDefs.map((f) => [f.name, f]));
    const byAlias = new Map(flagDefs.filter((f) => f.alias).map((f) => [f.alias!, f]));
    const positionals: string[] = [];
    const flags: Record<string, unknown> = {};
    let literal = false;

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (literal || !a.startsWith('-') || a === '-' || /^-\d/.test(a)) { positionals.push(a); continue; }
        if (a === '--') { literal = true; continue; }

        let name: string;
        let inline: string | undefined;
        let f: FlagDef | undefined;
        if (a.startsWith('--')) {
            const eq = a.indexOf('=');
            name = eq >= 0 ? a.slice(2, eq) : a.slice(2);
            inline = eq >= 0 ? a.slice(eq + 1) : undefined;
            f = byName.get(name);
            if (!f && name.startsWith('no-') && byName.get(name.slice(3))?.type === 'boolean') {
                flags[name.slice(3)] = false;
                continue;
            }
        } else {
            name = a.slice(1);
            f = byAlias.get(name);
        }
        if (!f) throw new ParseError('unknown_flag', `Unknown flag: ${a.length > 60 ? `${a.slice(0, 60)}...` : a.split('=')[0]}`);

        if (f.type === 'boolean' && inline === undefined) {
            const nxt = argv[i + 1];
            if (nxt !== undefined && /^(true|false)$/i.test(nxt)) { flags[f.name] = nxt.toLowerCase() === 'true'; i++; } else flags[f.name] = true;
            continue;
        }
        let raw = inline;
        if (raw === undefined) {
            raw = argv[i + 1];
            if (raw === undefined || (raw.startsWith('--') && f.type !== 'string')) throw new ParseError('missing_value', `--${f.name} needs a value`);
            i++;
        }
        const val = coerce(f, raw);
        flags[f.name] = f.type === 'list' && Array.isArray(flags[f.name]) ? [...(flags[f.name] as unknown[]), ...(val as unknown[])] : val;
    }

    for (const f of flagDefs) if (f.required && flags[f.name] === undefined) throw new ParseError('missing_flag', `Missing required flag --${f.name}`);

    const defs = def.positionals ?? [];
    const required = defs.filter((p) => p.required).length;
    if (positionals.length < required) throw new ParseError('missing_argument', `Missing argument <${defs[positionals.length]?.name ?? defs[required - 1]?.name}>`);
    const variadic = defs.some((p) => p.variadic);
    if (!variadic && positionals.length > defs.length) throw new ParseError('too_many_arguments', `Too many arguments (expected ${defs.length})`);
    defs.forEach((p, idx) => {
        if (p.values && positionals[idx] !== undefined && !p.values.includes(positionals[idx])) {
            throw new ParseError('invalid_choice', `<${p.name}> must be one of: ${p.values.join(', ')}`);
        }
        if (p.type === 'number' && positionals[idx] !== undefined && !Number.isFinite(Number(positionals[idx]))) {
            throw new ParseError('invalid_number', `<${p.name}> expects a number`);
        }
    });
    return { positionals, flags };
}
