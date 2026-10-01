import type { CommandDef } from './types';

/**
 * Saneado de comandos para la AUDITORIA: nunca se registran contrasenas, tokens, codigos MFA, claves ni cuerpos JSON.
 * Pura y testeable. La auditoria guarda el comando saneado, no la linea original.
 */

const SENSITIVE_NAME = /pass|secret|token|key|code|otp|credential|authorization|cookie|bearer|recovery|private|signature|csv/i;
/** Banderas cuyo valor es un volcado (JSON/CSV): solo se registra su tamano. */
const BLOB_NAME = /^(json|data|config|theme|landing|csv|body|input)$/i;
const TOKEN_RE = /\bbxa_[A-Za-z0-9_-]{6,}\b/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const MAX_VALUE = 120;

export const REDACTED = '***';

function scrub(v: string): string {
    const s = v.replace(TOKEN_RE, 'bxa_***').replace(BEARER_RE, 'Bearer ***');
    return s.length > MAX_VALUE ? `${s.slice(0, MAX_VALUE)}...` : s;
}

/** Devuelve la linea saneada. Sin definicion (comando desconocido) solo se conservan las primeras palabras. */
export function sanitizeCommand(argv: readonly string[], def?: CommandDef | null): string {
    const nameWords = def ? def.name.split(' ').length : Math.min(2, argv.length);
    const out: string[] = argv.slice(0, nameWords).map(scrub);
    if (!def) return out.join(' ') + (argv.length > nameWords ? ` [${argv.length - nameWords} args]` : '');

    const flagDefs = def.flags ?? [];
    const posDefs = def.positionals ?? [];
    const rest = argv.slice(nameWords);
    let posIndex = 0;
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === '--') { out.push(a); continue; }
        if (a.startsWith('-') && a.length > 1 && !/^-\d/.test(a)) {
            const isLong = a.startsWith('--');
            const eq = isLong ? a.indexOf('=') : -1;
            const name = isLong ? (eq >= 0 ? a.slice(2, eq) : a.slice(2)) : a.slice(1);
            const f = flagDefs.find((x) => (isLong ? x.name === name : x.alias === name));
            const secret = f?.secret || SENSITIVE_NAME.test(name) || (f ? false : true);
            const blob = BLOB_NAME.test(name) || f?.type === 'json';
            const takesValue = f ? f.type !== 'boolean' : true;
            if (eq >= 0) {
                out.push(`${a.slice(0, eq)}=${secret ? REDACTED : blob ? `<${a.length - eq - 1} chars>` : scrub(a.slice(eq + 1))}`);
            } else if (takesValue && i + 1 < rest.length) {
                out.push(a, secret ? REDACTED : blob ? `<${rest[i + 1].length} chars>` : scrub(rest[i + 1]));
                i++;
            } else out.push(a);
            continue;
        }
        const p = posDefs[Math.min(posIndex, posDefs.length - 1)];
        posIndex++;
        out.push(p?.secret || (p && SENSITIVE_NAME.test(p.name)) ? REDACTED : scrub(a));
    }
    return out.join(' ');
}
