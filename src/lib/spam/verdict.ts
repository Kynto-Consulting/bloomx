/**
 * Veredicto compacto guardado en Email.spamReasons (JSONB acotado a 2 KB) — puro, sin dependencias de servidor.
 *   { v:1, d: decision, b: banda, sg: [[id, peso, params?]] (lo que se muestra), rw: [[id, familia, peso, critica?]] (para re-simular),
 *     ext?: {c: suplantacion de companero, f: primera vez, t: confiable}, al?: id de la regla PERMITIDA que acerto }
 * Nunca contiene texto del correo: solo ids de senal, pesos y parametros cortos (dominios, extensiones).
 */
import type { Band, Decision, Signal, SignalFamily } from './types';

export const MAX_REASONS_BYTES = 2048;

export interface PackedVerdict {
    v: 1;
    d: Exclude<Decision, 'blocked'>;
    b: Band;
    sg: Array<[string, number] | [string, number, Record<string, string | number>]>;
    rw: Array<[string, SignalFamily, number] | [string, SignalFamily, number, 1]>;
    ext?: { c?: 1; f?: 1; t?: 1 };
    al?: string;
}

const size = (o: unknown) => JSON.stringify(o).length;

function shortParams(p: Signal['params']): Record<string, string | number> | undefined {
    if (!p) return undefined;
    const out: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(p)) out[k] = typeof v === 'string' ? v.slice(0, 40) : v;
    return Object.keys(out).length ? out : undefined;
}

export function packVerdict(input: {
    decision: PackedVerdict['d']; band: Band; signals: Signal[]; raw: Signal[]; ext?: PackedVerdict['ext']; allowId?: string | null;
}): PackedVerdict {
    const out: PackedVerdict = { v: 1, d: input.decision, b: input.band, sg: [], rw: [] };
    if (input.ext && Object.keys(input.ext).length) out.ext = input.ext;
    if (input.allowId) out.al = input.allowId.slice(0, 40);
    const byAbs = (a: Signal, b: Signal) => Math.abs(b.weight) - Math.abs(a.weight);
    for (const s of [...input.signals].sort(byAbs)) {
        const p = shortParams(s.params);
        const item: PackedVerdict['sg'][number] = p ? [s.id, s.weight, p] : [s.id, s.weight];
        if (size({ ...out, sg: [...out.sg, item] }) > MAX_REASONS_BYTES * 0.6) break;
        out.sg.push(item);
    }
    for (const s of [...input.raw].sort(byAbs)) {
        const item: PackedVerdict['rw'][number] = s.critical ? [s.id, s.family, Math.round(s.weight), 1] : [s.id, s.family, Math.round(s.weight)];
        if (size({ ...out, rw: [...out.rw, item] }) > MAX_REASONS_BYTES) break;
        out.rw.push(item);
    }
    return out;
}

/** Lee lo guardado con tolerancia total: cualquier forma inesperada -> null. */
export function unpackVerdict(value: unknown): PackedVerdict | null {
    const o = typeof value === 'string' ? safeParse(value) : value;
    if (!o || typeof o !== 'object') return null;
    const r = o as Partial<PackedVerdict>;
    if (r.v !== 1 || !Array.isArray(r.sg)) return null;
    const sg = r.sg.filter((x): x is PackedVerdict['sg'][number] => Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'number').slice(0, 40);
    const rw = (Array.isArray(r.rw) ? r.rw : []).filter((x): x is PackedVerdict['rw'][number] => Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'string' && typeof x[2] === 'number').slice(0, 60);
    const d = r.d === 'spam' || r.d === 'warned' || r.d === 'delivered' ? r.d : 'delivered';
    const b = r.b === 'spam' || r.b === 'suspicious' || r.b === 'clean' ? r.b : 'clean';
    return { v: 1, d, b, sg, rw, ...(r.ext && typeof r.ext === 'object' ? { ext: r.ext } : {}), ...(typeof r.al === 'string' ? { al: r.al } : {}) };
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }

export function rawSignalsOf(p: PackedVerdict): Signal[] {
    return p.rw.map((x) => ({ id: x[0], family: x[1], weight: x[2], ...(x[3] === 1 ? { critical: true } : {}) }));
}

export function displaySignalsOf(p: PackedVerdict): Signal[] {
    return p.sg.map((x) => ({ id: x[0], family: (x[0].split('.')[0] === 'auth' ? 'auth' : 'headers') as SignalFamily, weight: x[1], ...(x[2] ? { params: x[2] } : {}) }));
}
