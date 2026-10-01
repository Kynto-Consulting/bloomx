import { callAdminRoute } from './bridge';
import { COMMANDS, CLIENT_BUILTINS } from './catalog';
import type { ExecAuth } from './exec';
import { matchCommand } from './parser';
import type { CommandDef, Locale } from './types';

/**
 * Autocompletado de una linea parcial (Tab). Devuelve candidatos para el ULTIMO token:
 *  - comandos y subcomandos, banderas (--x), valores de enum, y valores dinamicos (usuarios por correo, extensiones, comandos).
 * Solo lee (nunca ejecuta nada); los candidatos dinamicos respetan el aislamiento de la instancia (usan las rutas reales).
 */

export interface Candidate { value: string; hint?: string; kind: 'command' | 'flag' | 'value' | 'user' | 'extension' }
export interface Completion { prefix: string; candidates: Candidate[] }

/** Version tolerante de tokenize: una comilla sin cerrar se toma como parte del token en curso. */
export function splitPartial(line: string): { done: string[]; current: string; open: boolean } {
    const out: string[] = [];
    let cur = '';
    let has = false;
    let quote: '"' | "'" | null = null;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quote) {
            if (ch === quote) quote = null; else if (ch === '\\' && quote === '"' && i + 1 < line.length) cur += line[++i]; else cur += ch;
            continue;
        }
        if (ch === '"' || ch === "'") { quote = ch; has = true; continue; }
        if (ch === '\\' && i + 1 < line.length) { cur += line[++i]; has = true; continue; }
        if (ch === ' ' || ch === '\t') { if (has) { out.push(cur); cur = ''; has = false; } continue; }
        cur += ch; has = true;
    }
    return { done: out, current: has ? cur : '', open: quote !== null };
}

const starts = (v: string, p: string) => v.toLowerCase().startsWith(p.toLowerCase());

export async function completeLine(line: string, auth: ExecAuth | null, locale: Locale = 'es', commands: readonly CommandDef[] = COMMANDS): Promise<Completion> {
    const { done, current } = splitPartial(line.slice(0, 8192));
    const visible = commands.filter((c) => !c.hidden);
    const out: Candidate[] = [];
    const seen = new Set<string>();
    const add = (c: Candidate) => { if (!seen.has(c.value) && starts(c.value, current)) { seen.add(c.value); out.push(c); } };

    const m = matchCommand(visible, done);
    const words = done.length;

    // Siguiente palabra de comando / subcomando
    const nextWords = (prefixWords: string[]) => {
        for (const c of visible) {
            const w = c.name.split(' ');
            if (w.length > prefixWords.length && prefixWords.every((p, i) => w[i] === p)) add({ value: w[prefixWords.length], kind: 'command', hint: w.length === prefixWords.length + 1 ? c.summary[locale] : undefined });
        }
        if (prefixWords.length === 0) for (const b of CLIENT_BUILTINS) add({ value: b.name, kind: 'command', hint: b.summary[locale] });
    };

    if (!m) {
        nextWords(done);
        return { prefix: current, candidates: out.slice(0, 50) };
    }

    const { def, rest } = m;
    // Aun puede haber subcomandos (users sessions -> revoke)
    if (rest.length === 0) nextWords(def.name.split(' '));

    // Banderas
    const flagDefs = def.flags ?? [];
    const prev = done[words - 1];
    if (current.startsWith('-')) {
        for (const f of flagDefs) add({ value: `--${f.name}`, kind: 'flag', hint: f.description[locale] });
        for (const g of ['--json', '--yes', '--help']) add({ value: g, kind: 'flag' });
        return { prefix: current, candidates: out.slice(0, 50) };
    }
    // Valor de bandera enum / dinamica
    const flagForValue = prev?.startsWith('--') && !prev.includes('=') ? flagDefs.find((f) => `--${f.name}` === prev) : undefined;
    if (flagForValue && flagForValue.type !== 'boolean') {
        for (const v of flagForValue.values ?? []) add({ value: v, kind: 'value' });
        if (flagForValue.complete) await dynamicValues(flagForValue.complete, current, auth, locale, add);
        return { prefix: current, candidates: out.slice(0, 50) };
    }

    // Posicionales: indice = posicionales ya escritos (sin banderas)
    const posWords: string[] = [];
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a.startsWith('-') && a.length > 1) {
            const f = flagDefs.find((x) => `--${x.name}` === a.split('=')[0]);
            if (f && f.type !== 'boolean' && !a.includes('=')) i++;
            continue;
        }
        posWords.push(a);
    }
    const defs = def.positionals ?? [];
    const idx = Math.min(posWords.length, Math.max(0, defs.length - 1));
    const pd = defs[posWords.length] ?? (defs.length && defs[defs.length - 1].variadic ? defs[defs.length - 1] : undefined);
    void idx;
    if (pd) {
        for (const v of pd.values ?? []) add({ value: v, kind: 'value' });
        if (pd.complete) await dynamicValues(pd.complete, current, auth, locale, add);
    }
    if (rest.length === 0 && flagDefs.length && !pd) for (const f of flagDefs.slice(0, 8)) add({ value: `--${f.name}`, kind: 'flag', hint: f.description[locale] });
    return { prefix: current, candidates: out.slice(0, 50) };
}

async function dynamicValues(source: 'user' | 'extension' | 'command', cur: string, auth: ExecAuth | null, locale: Locale, add: (c: Candidate) => void) {
    if (source === 'command') {
        for (const c of COMMANDS) if (!c.hidden) add({ value: c.name.split(' ')[0], kind: 'command' });
        return;
    }
    if (!auth) return;
    try {
        if (source === 'user') {
            if (cur.length < 2) { add({ value: 'me', kind: 'user' }); return; }
            const r = await callAdminRoute({ method: 'GET', path: '/search', query: { q: cur } }, { actor: auth.actor, ip: auth.ip, userAgent: auth.userAgent });
            for (const u of (r.data?.users as Array<{ email: string; name: string | null }>) ?? []) add({ value: u.email, kind: 'user', hint: u.name ?? undefined });
        } else if (source === 'extension') {
            const { fetchCatalog } = await import('@/lib/admin/extensions-catalog');
            for (const e of (await fetchCatalog()).slice(0, 200)) add({ value: e.id, kind: 'extension', hint: (e as { name?: string }).name });
        }
    } catch { /* sin candidatos dinamicos: no es un error */ }
    void locale;
}
