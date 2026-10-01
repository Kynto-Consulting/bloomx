'use strict';

// Port del analizador del servidor (src/lib/admin-cli/parser.ts): comillas simples/dobles y escapes, SIN expansion de shell.
// El servidor vuelve a analizar la linea; esto solo sirve al cliente (shell, --file/--stdin, historial, completado).

const MAX_LINE_BYTES = 8 * 1024;

function tokenize(line) {
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) throw new Error(`Line exceeds ${MAX_LINE_BYTES} bytes`);
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(line)) throw new Error('Control characters are not allowed');
    const out = [];
    let cur = '';
    let has = false;
    let i = 0;
    while (i < line.length) {
        const ch = line[i];
        if (ch === ' ' || ch === '\t') { if (has) { out.push(cur); cur = ''; has = false; } i++; continue; }
        if (ch === "'") {
            const end = line.indexOf("'", i + 1);
            if (end < 0) throw new Error('Unterminated single quote');
            cur += line.slice(i + 1, end); has = true; i = end + 1; continue;
        }
        if (ch === '"') {
            i++;
            let closed = false;
            while (i < line.length) {
                const c = line[i];
                if (c === '\\') {
                    const n = line[i + 1];
                    if (n === undefined) throw new Error('Dangling escape');
                    cur += n === 'n' ? '\n' : n === 't' ? '\t' : n; i += 2; continue;
                }
                if (c === '"') { closed = true; i++; break; }
                cur += c; i++;
            }
            if (!closed) throw new Error('Unterminated double quote');
            has = true; continue;
        }
        if (ch === '\\') {
            const n = line[i + 1];
            if (n === undefined) throw new Error('Dangling escape');
            cur += n; has = true; i += 2; continue;
        }
        cur += ch; has = true; i++;
    }
    if (has) out.push(cur);
    return out;
}

function quoteArg(a) {
    if (a !== '' && /^[A-Za-z0-9_@%+=:,./*-]+$/.test(a)) return a;
    return `"${a.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

const SECRET_FLAG = /^(--(?:password|value|public-key|secret|token|code|recovery-code))(=|$)/i;

/** Enmascara el valor de las banderas secretas (para el historial del shell y los mensajes). */
function maskSecrets(line) {
    try {
        const parts = tokenize(line);
        const out = [];
        for (let i = 0; i < parts.length; i++) {
            const m = SECRET_FLAG.exec(parts[i]);
            if (m && m[2] === '=') out.push(`${m[1]}=***`);
            else if (m) { out.push(parts[i], '***'); i++; } else out.push(parts[i]);
        }
        return out.map(quoteArg).join(' ');
    } catch {
        return line.replace(/(--(?:password|value|public-key|secret|token)[= ])\S+/gi, '$1***');
    }
}

/** Indice donde empieza el token en curso. */
function tokenStart(line) {
    let start = 0; let quote = null;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quote) { if (c === quote) quote = null; continue; }
        if (c === '"' || c === "'") { quote = c; continue; }
        if (c === '\\') { i++; continue; }
        if (c === ' ' || c === '\t') start = i + 1;
    }
    return start;
}

module.exports = { tokenize, quoteArg, maskSecrets, tokenStart, MAX_LINE_BYTES };
