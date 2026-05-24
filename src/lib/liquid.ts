/**
 * liquid.ts — Full Liquid-compatible template engine for email personalisation.
 *
 * Supports:
 *   Variables   {{ field }}, {{ field | filter | ... }}, {{ "literal" }}, {{ now }}
 *   Filters     35+ string · number · array · date filters (see applyFilter)
 *   Blocks      if / elsif / else / endif
 *               unless / else / endunless
 *               for <var> in <expr> [limit:N offset:N reversed] / else / endfor
 *               case / when [val or val] / else / endcase
 *               assign, capture / endcapture
 *               comment / endcomment
 *               raw / endraw
 *               increment, decrement
 *               cycle ["group":] "a", "b", ...
 *               break, continue  (inside for)
 *   Ranges      {% for i in (1..5) %} or {% for i in (start..end) %}
 *   forloop     forloop.index / index0 / rindex / rindex0 / first / last / length
 *   Conditions  ==, !=, >, <, >=, <=, contains, and, or  (quotes-aware splitting)
 */

export type LiquidRow = Record<string, string>;

// ── Internal types ────────────────────────────────────────────────────────────

type LiquidVal = string | string[];
type Ctx = { scopes: Array<Record<string, LiquidVal>>; counters: Record<string, number> };

// ── Context helpers ───────────────────────────────────────────────────────────

function mkCtx(data: LiquidRow): Ctx {
    return { scopes: [{ ...data }], counters: {} };
}
function ctxGet(ctx: Ctx, key: string): LiquidVal {
    for (let i = ctx.scopes.length - 1; i >= 0; i--) {
        if (Object.prototype.hasOwnProperty.call(ctx.scopes[i], key)) return ctx.scopes[i][key];
    }
    return '';
}
function ctxSet(ctx: Ctx, key: string, val: LiquidVal): void {
    // assign/capture always set on the outermost (root) scope so they persist across for loops
    ctx.scopes[0][key] = val;
}
function ctxPush(ctx: Ctx, vars: Record<string, LiquidVal>): void {
    ctx.scopes.push({ ...vars });
}
function ctxPop(ctx: Ctx): void {
    if (ctx.scopes.length > 1) ctx.scopes.pop();
}
function toStr(val: LiquidVal): string {
    return Array.isArray(val) ? val.join('') : (val ?? '');
}

// ── Tokenizer ─────────────────────────────────────────────────────────────────

type Tok =
    | { k: 'raw'; text: string }
    | { k: 'out'; expr: string }
    | { k: 'tag'; name: string; args: string };

function tokenize(tpl: string): Tok[] {
    const toks: Tok[] = [];
    const re = /\{\{-?([\s\S]*?)-?\}\}|\{%-?([\s\S]*?)-?%\}/g;
    let last = 0, m: RegExpExecArray | null;
    while ((m = re.exec(tpl)) !== null) {
        if (m.index > last) toks.push({ k: 'raw', text: tpl.slice(last, m.index) });
        if (m[0].startsWith('{{')) {
            toks.push({ k: 'out', expr: (m[1] || '').trim() });
        } else {
            const inner = (m[2] || '').trim();
            const sp = inner.search(/\s/);
            const name = (sp === -1 ? inner : inner.slice(0, sp)).toLowerCase();
            const args = sp === -1 ? '' : inner.slice(sp + 1).trim();
            toks.push({ k: 'tag', name, args });
        }
        last = m.index + m[0].length;
    }
    if (last < tpl.length) toks.push({ k: 'raw', text: tpl.slice(last) });
    return toks;
}

// ── Date formatting ───────────────────────────────────────────────────────────

function fmtDate(d: Date, fmt: string): string {
    const mo = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const mos = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dy = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dys = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return fmt
        .replace(/%Y/g, String(d.getFullYear())).replace(/%y/g, String(d.getFullYear()).slice(-2))
        .replace(/%m/g, String(d.getMonth() + 1).padStart(2, '0')).replace(/%d/g, String(d.getDate()).padStart(2, '0'))
        .replace(/%e/g, String(d.getDate())).replace(/%B/g, mo[d.getMonth()]).replace(/%b/g, mos[d.getMonth()])
        .replace(/%A/g, dy[d.getDay()]).replace(/%a/g, dys[d.getDay()])
        .replace(/%H/g, String(d.getHours()).padStart(2, '0')).replace(/%I/g, String(d.getHours() % 12 || 12).padStart(2, '0'))
        .replace(/%M/g, String(d.getMinutes()).padStart(2, '0')).replace(/%S/g, String(d.getSeconds()).padStart(2, '0'))
        .replace(/%p/g, d.getHours() < 12 ? 'AM' : 'PM');
}

// ── String filters ────────────────────────────────────────────────────────────

function applyStrFilter(val: string, f: string): string {
    f = f.trim();
    if (f === 'upcase') return val.toUpperCase();
    if (f === 'downcase') return val.toLowerCase();
    if (f === 'capitalize') return val ? val[0].toUpperCase() + val.slice(1) : '';
    if (f === 'strip') return val.trim();
    if (f === 'lstrip') return val.trimStart();
    if (f === 'rstrip') return val.trimEnd();
    if (f === 'strip_html') return val.replace(/<[^>]*>/g, '');
    if (f === 'strip_newlines') return val.replace(/\r?\n/g, '');
    if (f === 'newline_to_br') return val.replace(/\r?\n/g, '<br>\n');
    if (f === 'escape') return val.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    if (f === 'escape_once') return val.replace(/&(?!amp;|lt;|gt;|quot;|#39;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    if (f === 'url_encode') return encodeURIComponent(val).replace(/%20/g, '+');
    if (f === 'url_decode') { try { return decodeURIComponent(val.replace(/\+/g, ' ')); } catch { return val; } }
    if (f === 'base64_encode') { try { return btoa(unescape(encodeURIComponent(val))); } catch { return val; } }
    if (f === 'base64_decode') { try { return decodeURIComponent(escape(atob(val))); } catch { return val; } }
    if (f === 'size') return String([...val].length);
    if (f === 'first') return val[0] ?? '';
    if (f === 'last') return val[val.length - 1] ?? '';
    if (f === 'reverse') return [...val].reverse().join('');
    if (f === 'abs') return String(Math.abs(parseFloat(val) || 0));
    if (f === 'ceil') return String(Math.ceil(parseFloat(val) || 0));
    if (f === 'floor') return String(Math.floor(parseFloat(val) || 0));
    if (f === 'round') return String(Math.round(parseFloat(val) || 0));

    let m: RegExpMatchArray | null;
    if ((m = f.match(/^at_least:\s*([\d.-]+)$/))) return String(Math.max(parseFloat(val) || 0, parseFloat(m[1])));
    if ((m = f.match(/^at_most:\s*([\d.-]+)$/))) return String(Math.min(parseFloat(val) || 0, parseFloat(m[1])));
    if ((m = f.match(/^truncate:\s*(\d+)(?:,\s*["']([^"']*)["'])?$/))) {
        const n = parseInt(m[1]), e = m[2] ?? '...', chars = [...val];
        return chars.length > n ? chars.slice(0, Math.max(0, n - [...e].length)).join('') + e : val;
    }
    if ((m = f.match(/^truncatewords:\s*(\d+)(?:,\s*["']([^"']*)["'])?$/))) {
        const words = val.split(/\s+/), n = parseInt(m[1]), e = m[2] ?? '...';
        return words.length > n ? words.slice(0, n).join(' ') + e : val;
    }
    if ((m = f.match(/^replace:\s*["']([^"']*)["'],\s*["']([^"']*)["']$/))) return val.split(m[1]).join(m[2]);
    if ((m = f.match(/^replace_first:\s*["']([^"']*)["'],\s*["']([^"']*)["']$/))) return val.replace(m[1], m[2]);
    if ((m = f.match(/^replace_last:\s*["']([^"']*)["'],\s*["']([^"']*)["']$/))) {
        const idx = val.lastIndexOf(m[1]);
        return idx === -1 ? val : val.slice(0, idx) + m[2] + val.slice(idx + m[1].length);
    }
    if ((m = f.match(/^remove:\s*["']([^"']*)["']$/))) return val.split(m[1]).join('');
    if ((m = f.match(/^remove_first:\s*["']([^"']*)["']$/))) return val.replace(m[1], '');
    if ((m = f.match(/^prepend:\s*["']([^"']*)["']$/))) return m[1] + val;
    if ((m = f.match(/^append:\s*["']([^"']*)["']$/))) return val + m[1];
    if ((m = f.match(/^default:\s*["']([^"']*)["']$/))) return val && val.trim() && val !== 'false' && val !== 'nil' ? val : m[1];
    if ((m = f.match(/^default:\s*([\d.]+)$/))) return val && val.trim() && val !== 'false' && val !== 'nil' ? val : m[1];
    if ((m = f.match(/^round:\s*(\d+)$/))) return (parseFloat(val) || 0).toFixed(parseInt(m[1]));
    if ((m = f.match(/^times:\s*([\d.]+)$/))) return String((parseFloat(val) || 0) * parseFloat(m[1]));
    if ((m = f.match(/^plus:\s*([\d.]+)$/))) return String((parseFloat(val) || 0) + parseFloat(m[1]));
    if ((m = f.match(/^minus:\s*([\d.]+)$/))) return String((parseFloat(val) || 0) - parseFloat(m[1]));
    if ((m = f.match(/^divided_by:\s*([\d.]+)$/))) {
        const d = parseFloat(m[1]);
        return d === 0 ? '0' : String((parseFloat(val) || 0) / d);
    }
    if ((m = f.match(/^modulo:\s*([\d.]+)$/))) return String((parseFloat(val) || 0) % parseFloat(m[1]));
    if ((m = f.match(/^slice:\s*(-?\d+)(?:,\s*(\d+))?$/))) {
        const chars = [...val], start = parseInt(m[1]);
        const len = m[2] !== undefined ? parseInt(m[2]) : undefined;
        return len !== undefined ? chars.slice(start, start + len).join('') : chars.slice(start).join('');
    }
    if ((m = f.match(/^date:\s*["']([^"']*)["']$/))) {
        const d = (val === 'now' || val === 'today') ? new Date() : new Date(val);
        return isNaN(d.getTime()) ? val : fmtDate(d, m[1]);
    }
    return val; // unknown filter — passthrough
}

// ── All filters (string + array-aware) ───────────────────────────────────────

function applyFilter(val: LiquidVal, f: string): LiquidVal {
    f = f.trim();
    let m: RegExpMatchArray | null;

    // split: always converts string → array
    if ((m = f.match(/^split:\s*["']([^"']*)["']$/))) {
        const s = toStr(val);
        return m[1] === '' ? [...s] : s.split(m[1]);
    }

    if (Array.isArray(val)) {
        const arr = val;
        if (f === 'first') return arr[0] ?? '';
        if (f === 'last') return arr[arr.length - 1] ?? '';
        if (f === 'size') return String(arr.length);
        if (f === 'reverse') return [...arr].reverse();
        if (f === 'sort') return [...arr].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        if (f === 'sort_natural') return [...arr].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
        if (f === 'uniq') return [...new Set(arr)];
        if (f === 'compact') return arr.filter(v => v !== '' && v !== 'nil' && v !== 'null' && v != null);
        if (f === 'flatten') return (arr as unknown[]).flat(Infinity).map(String);
        if (f === 'sum') return String(arr.reduce((acc, v) => acc + (parseFloat(v) || 0), 0));
        if (f === 'min') return arr.reduce((a, b) => (parseFloat(a) || 0) < (parseFloat(b) || 0) ? a : b, arr[0] ?? '');
        if (f === 'max') return arr.reduce((a, b) => (parseFloat(a) || 0) > (parseFloat(b) || 0) ? a : b, arr[0] ?? '');
        if ((m = f.match(/^join(?::\s*["']([^"']*)["'])?$/))) return arr.join(m[1] ?? ', ');
        if ((m = f.match(/^slice:\s*(-?\d+)(?:,\s*(\d+))?$/))) {
            const start = parseInt(m[1]);
            const len = m[2] !== undefined ? parseInt(m[2]) : undefined;
            return len !== undefined ? arr.slice(start, start + len) : arr.slice(start);
        }
        if ((m = f.match(/^push:\s*["']([^"']*)["']$/))) return [...arr, m[1]];
        if ((m = f.match(/^concat:\s*["']([^"']*)["']$/))) return [...arr, m[1]];
        if ((m = f.match(/^map:\s*["']([^"']*)["']$/))) return arr; // object arrays unsupported
        if ((m = f.match(/^where:\s*["']([^"']*)["'],\s*["']([^"']*)["']$/))) return arr; // object arrays unsupported
        // Fall through to string filter (join first)
        return applyStrFilter(arr.join(''), f);
    }

    return applyStrFilter(toStr(val), f);
}

// ── Filter chain parser ───────────────────────────────────────────────────────

function parseFilterChain(chain: string): string[] {
    const filters: string[] = [];
    let cur = '', inQ = false, qC = '';
    for (const c of chain) {
        if ((c === '"' || c === "'") && !inQ) { inQ = true; qC = c; cur += c; }
        else if (c === qC && inQ) { inQ = false; cur += c; }
        else if (c === '|' && !inQ) { if (cur.trim()) filters.push(cur.trim()); cur = ''; }
        else cur += c;
    }
    if (cur.trim()) filters.push(cur.trim());
    return filters;
}

function firstPipe(expr: string): number {
    let inQ = false, qC = '';
    for (let i = 0; i < expr.length; i++) {
        const c = expr[i];
        if ((c === '"' || c === "'") && !inQ) { inQ = true; qC = c; }
        else if (c === qC && inQ) inQ = false;
        else if (c === '|' && !inQ) return i;
    }
    return -1;
}

// ── Expression resolver ───────────────────────────────────────────────────────

function resolveExpr(expr: string, ctx: Ctx): LiquidVal {
    const pi = firstPipe(expr);
    const base = (pi === -1 ? expr : expr.slice(0, pi)).trim();
    const filterStr = pi === -1 ? '' : expr.slice(pi + 1);

    let val: LiquidVal;
    if (base === 'now' || base === 'today') {
        val = 'now'; // resolved by date filter; toStr falls back to "now"
    } else if ((base.startsWith('"') && base.endsWith('"')) || (base.startsWith("'") && base.endsWith("'"))) {
        val = base.slice(1, -1);
    } else if (base !== '' && !isNaN(Number(base))) {
        val = base;
    } else if (base === 'true' || base === 'false') {
        val = base;
    } else if (base === 'nil' || base === 'null' || base === 'blank' || base === 'empty') {
        val = '';
    } else {
        val = ctxGet(ctx, base);
    }

    if (!filterStr.trim()) return val;
    return parseFilterChain(filterStr).filter(Boolean).reduce((v, f) => applyFilter(v, f), val);
}

// ── Condition evaluation ──────────────────────────────────────────────────────

function getStr(ctx: Ctx, k: string): string {
    k = k.trim();
    if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) return k.slice(1, -1);
    if (k !== '' && !isNaN(Number(k))) return k;
    return toStr(ctxGet(ctx, k));
}

function evalAtom(expr: string, ctx: Ctx): boolean {
    expr = expr.trim();
    let m: RegExpMatchArray | null;
    const gN = (k: string) => parseFloat(getStr(ctx, k)) || 0;
    const gS = (k: string) => getStr(ctx, k);

    if ((m = expr.match(/^(.+?)\s+contains\s+(.+)$/))) return gS(m[1]).toLowerCase().includes(gS(m[2]).toLowerCase());
    if ((m = expr.match(/^(.+?)\s*==\s*(.+)$/))) return gS(m[1]) === gS(m[2]);
    if ((m = expr.match(/^(.+?)\s*!=\s*(.+)$/))) return gS(m[1]) !== gS(m[2]);
    if ((m = expr.match(/^(.+?)\s*>=\s*(.+)$/))) return gN(m[1]) >= gN(m[2]);
    if ((m = expr.match(/^(.+?)\s*<=\s*(.+)$/))) return gN(m[1]) <= gN(m[2]);
    if ((m = expr.match(/^(.+?)\s*>\s*(.+)$/))) return gN(m[1]) > gN(m[2]);
    if ((m = expr.match(/^(.+?)\s*<\s*(.+)$/))) return gN(m[1]) < gN(m[2]);

    const v = toStr(ctxGet(ctx, expr));
    return v !== '' && v !== 'false' && v !== 'nil' && v !== 'null';
}

/** Split by ' or ' or ' and ' respecting quoted values */
function splitByOp(expr: string, op: string): string[] {
    const parts: string[] = [];
    const search = ' ' + op + ' ';
    let cur = '', inQ = false, qC = '', i = 0;
    const src = ' ' + expr + ' ';
    while (i < src.length) {
        const c = src[i];
        if ((c === '"' || c === "'") && !inQ) { inQ = true; qC = c; cur += c; i++; continue; }
        if (c === qC && inQ) { inQ = false; cur += c; i++; continue; }
        if (!inQ && src.slice(i, i + search.length) === search) {
            parts.push(cur.trim()); cur = ''; i += search.length; continue;
        }
        cur += c; i++;
    }
    const last = cur.trim();
    if (last) parts.push(last);
    return parts;
}

function evalCond(expr: string, ctx: Ctx): boolean {
    const orParts = splitByOp(expr, 'or');
    if (orParts.length > 1) return orParts.some(p => evalCond(p, ctx));
    const andParts = splitByOp(expr, 'and');
    if (andParts.length > 1) return andParts.every(p => evalAtom(p, ctx));
    return evalAtom(expr, ctx);
}

// ── AST Node types ────────────────────────────────────────────────────────────

type Node =
    | { t: 'raw'; text: string }
    | { t: 'out'; expr: string }
    | { t: 'if'; cond: string; body: Node[]; elsifs: { cond: string; body: Node[] }[]; elseBody: Node[] }
    | { t: 'unless'; cond: string; body: Node[]; elseBody: Node[] }
    | { t: 'for'; varName: string; iterExpr: string; params: string; body: Node[]; elseBody: Node[] }
    | { t: 'case'; expr: string; whens: { vals: string[]; body: Node[] }[]; elseBody: Node[] }
    | { t: 'assign'; varName: string; expr: string }
    | { t: 'capture'; varName: string; body: Node[] }
    | { t: 'raw_block'; text: string }
    | { t: 'break' }
    | { t: 'continue' }
    | { t: 'increment'; varName: string }
    | { t: 'decrement'; varName: string }
    | { t: 'cycle'; group: string; args: string[] };

// ── Parser ────────────────────────────────────────────────────────────────────

const CLOSE_TAGS = new Set(['endif', 'endunless', 'endfor', 'endcase', 'endcomment', 'endraw', 'endcapture']);

function parse(toks: Tok[]): Node[] {
    let pos = 0;

    /** Return current token as tag, or undefined */
    const curTag = (): Extract<Tok, { k: 'tag' }> | undefined => {
        const t = toks[pos];
        return t?.k === 'tag' ? (t as Extract<Tok, { k: 'tag' }>) : undefined;
    };
    /** Consume current token if it's a tag with the given name */
    const eatTag = (name: string): boolean => {
        const t = curTag();
        if (t?.name === name) { pos++; return true; }
        return false;
    };

    function nodes(until?: Set<string>): Node[] {
        const ns: Node[] = [];

        while (pos < toks.length) {
            const tok = toks[pos];

            if (tok.k === 'raw') { ns.push({ t: 'raw', text: tok.text }); pos++; continue; }
            if (tok.k === 'out') { ns.push({ t: 'out', expr: tok.expr }); pos++; continue; }

            const { name, args } = tok;
            if (until?.has(name)) break;          // stop; don't consume — parent handles it
            if (CLOSE_TAGS.has(name)) { pos++; continue; } // stray close tag — skip

            pos++; // consume open tag

            switch (name) {
                case 'comment': {
                    while (pos < toks.length) { const t = toks[pos++]; if (t.k === 'tag' && t.name === 'endcomment') break; }
                    break;
                }
                case 'raw': {
                    let raw = '';
                    while (pos < toks.length) {
                        const t = toks[pos];
                        if (t.k === 'tag' && t.name === 'endraw') { pos++; break; }
                        raw += t.k === 'raw' ? t.text : t.k === 'out' ? `{{${t.expr}}}` : `{%${t.name} ${t.args}%}`;
                        pos++;
                    }
                    ns.push({ t: 'raw_block', text: raw });
                    break;
                }
                case 'assign': {
                    const m = args.match(/^(\w+)\s*=\s*([\s\S]+)$/);
                    if (m) ns.push({ t: 'assign', varName: m[1], expr: m[2].trim() });
                    break;
                }
                case 'capture': {
                    const varName = args.trim();
                    const body = nodes(new Set(['endcapture']));
                    eatTag('endcapture');
                    ns.push({ t: 'capture', varName, body });
                    break;
                }
                case 'increment': ns.push({ t: 'increment', varName: args.trim() }); break;
                case 'decrement': ns.push({ t: 'decrement', varName: args.trim() }); break;
                case 'break': ns.push({ t: 'break' }); break;
                case 'continue': ns.push({ t: 'continue' }); break;
                case 'cycle': {
                    let group = '', cycleArgs: string[];
                    const gm = args.match(/^["']([^"']*)["']\s*:\s*(.+)$/);
                    if (gm) { group = gm[1]; cycleArgs = gm[2].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')); }
                    else { cycleArgs = args.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')); }
                    ns.push({ t: 'cycle', group, args: cycleArgs });
                    break;
                }
                case 'if': {
                    const body = nodes(new Set(['elsif', 'else', 'endif']));
                    const elsifs: { cond: string; body: Node[] }[] = [];
                    let elseBody: Node[] = [];
                    while (pos < toks.length) {
                        const t = toks[pos];
                        if (t.k !== 'tag') break;
                        if (t.name === 'endif') { pos++; break; }
                        if (t.name === 'elsif') {
                            pos++;
                            const eb = nodes(new Set(['elsif', 'else', 'endif']));
                            elsifs.push({ cond: t.args, body: eb });
                        } else if (t.name === 'else') {
                            pos++;
                            elseBody = nodes(new Set(['endif']));
                        } else break;
                    }
                    eatTag('endif');
                    ns.push({ t: 'if', cond: args, body, elsifs, elseBody });
                    break;
                }
                case 'unless': {
                    const body = nodes(new Set(['else', 'endunless']));
                    let elseBody: Node[] = [];
                    if (eatTag('else')) elseBody = nodes(new Set(['endunless']));
                    eatTag('endunless');
                    ns.push({ t: 'unless', cond: args, body, elseBody });
                    break;
                }
                case 'for': {
                    const fm = args.match(/^(\w+)\s+in\s+(\S+)\s*(.*)$/);
                    if (!fm) break;
                    const [, varName, iterExpr, params] = fm;
                    const body = nodes(new Set(['else', 'endfor']));
                    let elseBody: Node[] = [];
                    if (eatTag('else')) elseBody = nodes(new Set(['endfor']));
                    eatTag('endfor');
                    ns.push({ t: 'for', varName, iterExpr, params: (params || '').trim(), body, elseBody });
                    break;
                }
                case 'case': {
                    const caseExpr = args.trim();
                    const whens: { vals: string[]; body: Node[] }[] = [];
                    let elseBody: Node[] = [];
                    // skip whitespace/raw until first when/else/endcase
                    while (pos < toks.length) {
                        const t = toks[pos];
                        if (t.k === 'tag' && (t.name === 'when' || t.name === 'else' || t.name === 'endcase')) break;
                        pos++;
                    }
                    while (pos < toks.length) {
                        const t = toks[pos];
                        if (t.k !== 'tag') { pos++; continue; }
                        if (t.name === 'endcase') { pos++; break; }
                        if (t.name === 'when') {
                            pos++;
                            const vals = t.args.split(/ or /).map(s => s.trim().replace(/^["']|["']$/g, ''));
                            const body = nodes(new Set(['when', 'else', 'endcase']));
                            whens.push({ vals, body });
                        } else if (t.name === 'else') {
                            pos++;
                            elseBody = nodes(new Set(['endcase']));
                        } else { pos++; break; }
                    }
                    eatTag('endcase');
                    ns.push({ t: 'case', expr: caseExpr, whens, elseBody });
                    break;
                }
                default: break; // unknown tag — ignore
            }
        }
        return ns;
    }

    return nodes();
}

// ── Evaluator ─────────────────────────────────────────────────────────────────

const SIG_BREAK = Symbol('break');
const SIG_CONTINUE = Symbol('continue');
type Signal = typeof SIG_BREAK | typeof SIG_CONTINUE;

function evalNodes(ns: Node[], ctx: Ctx, cyc: Record<string, number> = {}): string | Signal {
    let out = '';
    for (const node of ns) {
        switch (node.t) {
            case 'raw': out += node.text; break;
            case 'raw_block': out += node.text; break;
            case 'break': return SIG_BREAK;
            case 'continue': return SIG_CONTINUE;
            case 'out': out += toStr(resolveExpr(node.expr, ctx)); break;

            case 'assign': ctxSet(ctx, node.varName, resolveExpr(node.expr, ctx)); break;

            case 'capture': {
                const r = evalNodes(node.body, ctx, cyc);
                if (typeof r === 'string') ctxSet(ctx, node.varName, r);
                break;
            }
            case 'increment': {
                const n = ctx.counters[node.varName] ?? 0;
                out += String(n);
                ctx.counters[node.varName] = n + 1;
                break;
            }
            case 'decrement': {
                const n = (ctx.counters[node.varName] ?? 0) - 1;
                ctx.counters[node.varName] = n;
                out += String(n);
                break;
            }
            case 'cycle': {
                const key = node.group || node.args.join(',');
                const i = cyc[key] ?? 0;
                out += node.args[i % node.args.length] ?? '';
                cyc[key] = i + 1;
                break;
            }
            case 'if': {
                const branch = evalCond(node.cond, ctx)
                    ? node.body
                    : (node.elsifs.find(e => evalCond(e.cond, ctx))?.body ?? node.elseBody);
                const r = evalNodes(branch, ctx, cyc);
                if (typeof r !== 'string') return r;
                out += r;
                break;
            }
            case 'unless': {
                const branch = evalCond(node.cond, ctx) ? node.elseBody : node.body;
                const r = evalNodes(branch, ctx, cyc);
                if (typeof r !== 'string') return r;
                out += r;
                break;
            }
            case 'case': {
                const caseVal = toStr(resolveExpr(node.expr, ctx));
                const branch = node.whens.find(w => w.vals.includes(caseVal))?.body ?? node.elseBody;
                const r = evalNodes(branch, ctx, cyc);
                if (typeof r === 'string') out += r;
                break;
            }
            case 'for': {
                let items: string[];
                const rangeM = node.iterExpr.match(/^\((.+?)\.\.(.+?)\)$/);
                if (rangeM) {
                    const a = parseInt(toStr(resolveExpr(rangeM[1], ctx)) || rangeM[1]) || 0;
                    const b = parseInt(toStr(resolveExpr(rangeM[2], ctx)) || rangeM[2]) || 0;
                    items = a <= b
                        ? Array.from({ length: b - a + 1 }, (_, i) => String(a + i))
                        : Array.from({ length: a - b + 1 }, (_, i) => String(a - i));
                } else {
                    const v = resolveExpr(node.iterExpr, ctx);
                    items = Array.isArray(v) ? v : (toStr(v) ? [toStr(v)] : []);
                }

                const pm = node.params;
                const lm = pm.match(/\blimit:\s*(\d+)/);
                const om = pm.match(/\boffset:\s*(\d+)/);
                const limitN = lm ? parseInt(lm[1]) : undefined;
                const offsetN = om ? parseInt(om[1]) : 0;
                const isRev = /\breversed\b/.test(pm);

                let arr = items.slice(offsetN);
                if (limitN !== undefined) arr = arr.slice(0, limitN);
                if (isRev) arr = [...arr].reverse();

                if (arr.length === 0) {
                    const r = evalNodes(node.elseBody, ctx, cyc);
                    if (typeof r === 'string') out += r;
                    break;
                }

                const innerCyc: Record<string, number> = {};
                for (let i = 0; i < arr.length; i++) {
                    ctxPush(ctx, {
                        [node.varName]: arr[i],
                        'forloop.index': String(i + 1),
                        'forloop.index0': String(i),
                        'forloop.rindex': String(arr.length - i),
                        'forloop.rindex0': String(arr.length - i - 1),
                        'forloop.first': i === 0 ? 'true' : 'false',
                        'forloop.last': i === arr.length - 1 ? 'true' : 'false',
                        'forloop.length': String(arr.length),
                    });
                    const r = evalNodes(node.body, ctx, innerCyc);
                    ctxPop(ctx);
                    if (r === SIG_BREAK) break;
                    if (r === SIG_CONTINUE) continue;
                    if (typeof r === 'string') out += r;
                }
                break;
            }
        }
    }
    return out;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function renderTemplate(template: string, data: LiquidRow): string {
    try {
        const ctx = mkCtx(data);
        const toks = tokenize(template);
        const ast = parse(toks);
        const result = evalNodes(ast, ctx);
        return typeof result === 'string' ? result : '';
    } catch {
        return template; // fail gracefully
    }
}
