import type { AdminActor, LevelInfo } from '@/lib/admin-auth';
import { commandLevel } from '@/lib/admin-levels';
import { auditLog, getClientIp, rateLimitAsync } from '@/lib/security';
import { verifyReauthToken } from '@/lib/mail-transfer/auth';
import { callAdminRoute } from './bridge';
import { COMMANDS } from './catalog';
import { MAX_LINE_BYTES, ParseError, extractGlobals, matchCommand, parseArgs, tokenize } from './parser';
import { sanitizeCommand } from './redact';
import { outputSize, renderText, toJsonData } from './render';
import { scopeAllows } from './tokens';
import { CmdError, type CmdContext, type CmdOutput, type CommandDef, type ExecResponse, type L10n, type Locale, type Risk, type Scope, type SessionInfo } from './types';

/**
 * Motor de ejecucion. El llamador (rutas /api/admin/cli/**) ya AUTENTICO al administrador; aqui se aplican, en este orden y
 * fallando cerrado: analisis -> ambito (scope) -> limite de tasa -> confirmacion + step-up -> ejecucion con tiempo maximo ->
 * tope de salida -> auditoria (siempre, con el comando saneado). Sin ejecucion arbitraria: solo comandos del catalogo.
 */

export const LIMITS = {
    maxLineBytes: MAX_LINE_BYTES,
    maxOutputBytes: 1024 * 1024,
    maxInputBytes: 512 * 1024,
    timeoutMs: 25_000,
    perMinute: 60,
    perMinuteIp: 120,
} as const;

/** Codigos de salida: 0 ok, 1 error del comando, 2 uso incorrecto, 3 sin permiso, 4 falta confirmacion o step-up, 5 limite/tiempo, 127 comando desconocido. */
export const EXIT = { ok: 0, error: 1, usage: 2, denied: 3, needs: 4, limited: 5, unknown: 127 } as const;

const REQUIRED_SCOPE: Record<Risk, Scope> = { read: 'read', write: 'write', destructive: 'write', security: 'security' };
export const requiresStepUp = (risk: Risk) => risk === 'destructive' || risk === 'security';

export interface ExecRequest {
    line?: string;
    argv?: string[];
    input?: string;
    confirm?: boolean;
    stepUp?: string;
    locale?: Locale;
}

export interface ExecAuth {
    actor: AdminActor & LevelInfo;
    session: SessionInfo;
    ip: string;
    userAgent?: string | null;
    managerSession?: string | null;
}

export const stepUpKey = (a: { id?: string; email?: string }) => a.id || a.email || 'admin';

function statusExit(status: number): number {
    if (status === 401 || status === 403) return EXIT.denied;
    if (status === 429 || status === 408 || status === 504) return EXIT.limited;
    if (status === 400 || status === 413 || status === 422) return EXIT.usage;
    return EXIT.error;
}

function makeContext(req: ExecRequest, auth: ExecAuth, locale: Locale): CmdContext {
    const call: CmdContext['call'] = (c) => callAdminRoute(c, { actor: auth.actor, ip: auth.ip, userAgent: auth.userAgent, managerSession: auth.managerSession, reauthProof: req.stepUp ?? null });
    return {
        locale, actor: { kind: auth.actor.kind, id: auth.actor.id, email: auth.actor.email, level: auth.actor.level, levelSource: auth.actor.levelSource }, ip: auth.ip, input: req.input, session: auth.session, source: auth.session.source,
        t: (l: L10n) => l[locale], managerSession: auth.managerSession,
        call,
        callOk: async (c) => {
            const r = await call(c);
            if (r.status >= 200 && r.status < 300) return r;
            const code = typeof r.data?.code === 'string' ? r.data.code : r.status === 401 ? 'unauthorized' : r.status === 403 ? 'forbidden' : 'request_failed';
            const msg = typeof r.data?.error === 'string' ? r.data.error : code;
            throw new CmdError(code, msg, statusExit(r.status), r.status);
        },
        backend: async (path) => {
            if (!auth.managerSession || !/^\/api\/(manager\/domains|auth\/me)$/.test(path)) return { status: 403, data: {} };
            const { backendUrl } = await import('@/lib/admin/extensions-instance');
            try {
                const res = await fetch(`${backendUrl()}${path}`, { headers: { Cookie: `auth_session=${auth.managerSession}` }, cache: 'no-store', signal: AbortSignal.timeout(6000) });
                return { status: res.status, data: await res.json().catch(() => ({})) };
            } catch { return { status: 502, data: {} }; }
        },
    };
}

function audit(event: string, auth: ExecAuth, data: Record<string, unknown>) {
    auditLog(event, {
        userId: auth.actor.id, actorId: auth.actor.id, actorKind: auth.actor.kind, actorEmail: auth.actor.email, ip: auth.ip,
        userAgent: (auth.userAgent ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120) || undefined, via: auth.session.source, credRef: auth.session.tokenId ? auth.session.tokenId.slice(0, 8) : undefined,
        ...data,
    });
}

const fail = (code: string, message: string, exitCode: number, extra: Partial<ExecResponse> = {}): ExecResponse => ({ ok: false, exitCode, error: { code, message }, ...extra });

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const t = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new CmdError('timeout', `Command exceeded ${Math.round(ms / 1000)} s (it may still be running on the server; check \`audit\`).`, EXIT.limited, 504)), ms); });
    return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

/**
 * Autorizacion de un comando para un actor: (1) permission_level >= el nivel del comando (lib/admin-levels.ts, falla cerrado si falta) y
 * (2) el ambito del token/sesion cubre el riesgo (read / write / security). Pura: la prueba de matriz comando x nivel la usa tal cual.
 */
export function authorizeCommand(def: CommandDef, auth: Pick<ExecAuth, 'actor' | 'session'>): { code: 'insufficient_level' | 'insufficient_scope'; message: string; required: number | string } | null {
    const needLevel = commandLevel(def.name);
    if (auth.actor.level < needLevel) return { code: 'insufficient_level', required: needLevel, message: `This command needs permission_level >= ${needLevel} (yours: ${auth.actor.level}).` };
    const need = REQUIRED_SCOPE[def.risk];
    if (!scopeAllows(auth.session.scopes, need)) return { code: 'insufficient_scope', required: need, message: `This command needs the "${need}" scope (your session has: ${auth.session.scopes.join(', ')}).` };
    return null;
}

export async function executeCommand(req: ExecRequest, auth: ExecAuth, commands: readonly CommandDef[] = COMMANDS): Promise<ExecResponse> {
    const started = Date.now();
    const locale: Locale = req.locale === 'en' ? 'en' : 'es';
    let argv: string[];
    try {
        if (req.argv) {
            if (!Array.isArray(req.argv) || req.argv.length > 200 || req.argv.some((a) => typeof a !== 'string')) throw new ParseError('invalid_argv', 'Invalid argv');
            const bytes = req.argv.reduce((n, a) => n + Buffer.byteLength(a, 'utf8') + 1, 0);
            if (bytes > LIMITS.maxLineBytes) throw new ParseError('line_too_long', `Command exceeds ${LIMITS.maxLineBytes} bytes`);
            argv = req.argv;
        } else if (typeof req.line === 'string') argv = tokenize(req.line);
        else throw new ParseError('missing_command', 'Provide "line" or "argv"');
        if (req.input !== undefined && (typeof req.input !== 'string' || Buffer.byteLength(req.input, 'utf8') > LIMITS.maxInputBytes)) throw new ParseError('input_too_large', `Input exceeds ${LIMITS.maxInputBytes} bytes`);
    } catch (e) {
        const err = e as ParseError;
        audit('admin.cli.rejected', auth, { reason: 'parse', errorCode: err.code });
        return fail(err.code ?? 'parse_error', err.message, EXIT.usage);
    }

    const { rest, globals } = extractGlobals(argv);
    if (rest.length === 0) return { ok: true, exitCode: 0, output: { type: 'text', text: '' } };

    // `cmd --help` == `help cmd`
    const effective = globals.help && rest[0] !== 'help' ? ['help', ...rest] : rest;
    const matched = matchCommand(commands, effective);
    if (!matched) {
        const near = commands.filter((c) => !c.hidden && c.name.startsWith(effective[0])).slice(0, 5).map((c) => c.name);
        audit('admin.cli.rejected', auth, { reason: 'unknown_command', command: sanitizeCommand(effective, null) });
        return fail('unknown_command', `Unknown command: ${effective.slice(0, 2).join(' ').slice(0, 60)}${near.length ? `. Did you mean: ${near.join(', ')}?` : '. Try `help`.'}`, EXIT.unknown);
    }
    const def = matched.def;
    const cmdLine = sanitizeCommand(effective, def);
    const base = { command: def.name, risk: def.risk };

    // 0. Autorizacion ANTES que el analisis de argumentos (no se revela el uso de comandos no permitidos): nivel y ambito.
    const denied = authorizeCommand(def, auth);
    if (denied) {
        audit('admin.cli.denied', auth, { reason: denied.code, command: cmdLine, risk: def.risk, required: denied.required, level: auth.actor.level });
        return fail(denied.code, denied.message, EXIT.denied, base);
    }

    let args;
    try { args = parseArgs(def, matched.rest); } catch (e) {
        audit('admin.cli.rejected', auth, { reason: 'usage', command: cmdLine, errorCode: (e as ParseError).code });
        return fail((e as ParseError).code ?? 'usage', (e as Error).message, EXIT.usage, base);
    }

    // 2. Limite de tasa por administrador y por IP (async: Redis si esta configurado).
    const adminKey = auth.actor.id || auth.actor.email || auth.ip;
    const [rlAdmin, rlIp] = await Promise.all([
        rateLimitAsync(`admin:cli:${adminKey}`, LIMITS.perMinute, 60_000),
        rateLimitAsync(`admin:cli:ip:${auth.ip}`, LIMITS.perMinuteIp, 60_000),
    ]);
    if (!rlAdmin.ok || !rlIp.ok) {
        audit('admin.cli.denied', auth, { reason: 'rate_limited', command: cmdLine, risk: def.risk });
        return fail('rate_limited', `Too many commands. Retry in ${Math.max(rlAdmin.retryAfter, rlIp.retryAfter)} s.`, EXIT.limited, base);
    }

    // 3. Confirmacion explicita + step-up para destructive / security.
    if (requiresStepUp(def.risk)) {
        if (!(globals.yes || req.confirm === true)) {
            return { ok: false, exitCode: EXIT.needs, needs: 'confirm', error: { code: 'confirmation_required', message: `"${def.name}" is ${def.risk}. Confirm interactively or pass --yes.` }, ...base };
        }
        const proof = verifyReauthToken(req.stepUp, stepUpKey(auth.actor), null);
        if (!proof.ok) {
            return { ok: false, exitCode: EXIT.needs, needs: 'stepup', error: { code: 'stepup_required', message: def.mfaStepUp && auth.actor.kind === 'user' ? 'Re-authentication with an MFA code is required for this command.' : 'Re-authentication (password or MFA code) is required for this command.' }, ...base };
        }
        if (def.mfaStepUp && auth.actor.kind === 'user' && proof.method !== 'mfa') {
            return { ok: false, exitCode: EXIT.needs, needs: 'stepup', error: { code: 'mfa_stepup_required', message: 'This command needs a fresh MFA code (a password is not enough).' }, ...base };
        }
    }

    // 4. managerOnly: sin sesion de manager no se intenta (el mensaje explica el motivo).
    // (lo comprueban los propios handlers con requireManager para devolver el texto localizado)

    const ctx = makeContext(req, auth, locale);
    let output: CmdOutput;
    try {
        output = await withTimeout(def.handler({ args, ctx }), LIMITS.timeoutMs);
    } catch (e) {
        const err = e instanceof CmdError ? e : null;
        if (!err) console.error('[ADMIN_CLI]', def.name, e instanceof Error ? e.message.slice(0, 200) : 'error');
        const code = err?.code ?? 'internal';
        const message = err ? err.message : 'Internal error (details are in the server log).';
        const exitCode = err?.exitCode ?? EXIT.error;
        audit('admin.cli.exec', auth, { command: cmdLine, risk: def.risk, outcome: 'error', errorCode: code, exit: exitCode, durationMs: Date.now() - started });
        return fail(code, message, exitCode, { ...base, durationMs: Date.now() - started });
    }

    if (outputSize(output) > LIMITS.maxOutputBytes) {
        audit('admin.cli.exec', auth, { command: cmdLine, risk: def.risk, outcome: 'error', errorCode: 'output_too_large', exit: EXIT.error, durationMs: Date.now() - started });
        return fail('output_too_large', `Output exceeds ${LIMITS.maxOutputBytes / 1024} KB. Use filters or pagination.`, EXIT.error, base);
    }
    audit('admin.cli.exec', auth, { command: cmdLine, risk: def.risk, outcome: 'ok', exit: 0, durationMs: Date.now() - started });
    const res: ExecResponse = { ok: true, exitCode: 0, output, durationMs: Date.now() - started, ...base };
    if (globals.json) res.json = toJsonData(output);
    else res.text = renderText(output, { color: false });
    return res;
}

export { getClientIp };
