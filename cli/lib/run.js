'use strict';

const fs = require('node:fs');
const client = require('./client');
const { readSecret, readLine } = require('./prompt');
const { renderText } = require('./render');

/** Ejecuta UN comando contra el servidor: confirmacion interactiva, step-up (contrasena/MFA sin eco), salida y codigo de salida. */

const lang = () => ((process.env.BLOOMX_LANG || process.env.LC_ALL || process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale || 'en').toLowerCase().startsWith('es') ? 'es' : 'en');
const T = (es, en) => (lang() === 'es' ? es : en);

function useColor(stream, opts) {
    if (opts.noColor || process.env.NO_COLOR) return false;
    return !!stream.isTTY;
}

function stepUpBody(secret) {
    const s = secret.trim();
    if (/^\d{6}$/.test(s)) return { code: s };
    if (/^[A-Za-z0-9]{4,}-[A-Za-z0-9-]{4,}$/.test(s) && s.length >= 10) return { recoveryCode: s };
    return { password: s };
}

/** Obtiene (o reutiliza) la prueba de step-up. En scripts: BLOOMX_STEPUP_PASSWORD / BLOOMX_STEPUP_CODE. */
async function obtainStepUp(ctx, signal) {
    if (ctx.session.stepUp && ctx.session.stepUpUntil > Date.now()) return ctx.session.stepUp;
    let body;
    if (process.env.BLOOMX_STEPUP_CODE) body = { code: process.env.BLOOMX_STEPUP_CODE };
    else if (process.env.BLOOMX_STEPUP_PASSWORD) body = { password: process.env.BLOOMX_STEPUP_PASSWORD };
    else if (process.stdin.isTTY) {
        const secret = await readSecret(T('Confirma tu identidad. Contraseña, código MFA de 6 dígitos o código de recuperación: ', 'Confirm your identity. Password, 6-digit MFA code or recovery code: '));
        if (!secret.trim()) throw new client.ApiError('Cancelled', { code: 'cancelled' });
        body = stepUpBody(secret);
    } else {
        throw new client.ApiError(T('Este comando requiere confirmar tu identidad y no hay terminal. Define BLOOMX_STEPUP_PASSWORD o BLOOMX_STEPUP_CODE.', 'This command requires re-authentication and there is no terminal. Set BLOOMX_STEPUP_PASSWORD or BLOOMX_STEPUP_CODE.'), { code: 'stepup_required' });
    }
    const r = await client.reauth(ctx.profile, body, signal);
    ctx.session.stepUp = r.stepUp;
    ctx.session.stepUpUntil = Math.min(Number(r.expiresAt) || Date.now() + 9 * 60_000, Date.now() + 9 * 60_000);
    return r.stepUp;
}

async function confirmInteractive(res) {
    if (!process.stdin.isTTY) return false;
    const a = await readLine(T(`¿Confirmar "${res.command}" (${res.risk})? [s/N] `, `Confirm "${res.command}" (${res.risk})? [y/N] `));
    return /^(y|yes|s|si|sí)$/i.test(a.trim());
}

function printError(res, jsonMode) {
    const e = res.error || { code: 'error', message: 'Command failed' };
    if (jsonMode) process.stderr.write(`${JSON.stringify({ error: e, exitCode: res.exitCode })}\n`);
    else process.stderr.write(`error: ${e.message}${e.code && e.code !== 'internal' ? `  [${e.code}]` : ''}\n`);
}

function emit(res, opts, argv) {
    const jsonMode = argv.includes('--json');
    if (jsonMode) {
        const text = JSON.stringify(res.json === undefined ? null : res.json, null, process.stdout.isTTY ? 2 : 0);
        if (opts.out) fs.writeFileSync(opts.out, `${text}\n`, { mode: 0o600 }); else process.stdout.write(`${text}\n`);
        return;
    }
    const out = res.output;
    if (!out) return;
    if (out.type === 'csv') {
        const text = out.text;
        if (opts.out) { fs.writeFileSync(opts.out, text, { mode: 0o600 }); process.stderr.write(`${T('Guardado en', 'Saved to')} ${opts.out}\n`); } else process.stdout.write(text);
        return;
    }
    const text = renderText(out, useColor(process.stdout, opts));
    if (text) { if (opts.out) fs.writeFileSync(opts.out, `${text}\n`, { mode: 0o600 }); else process.stdout.write(`${text}\n`); }
}

/**
 * ctx = { profile, opts, session: { stepUp, stepUpUntil } }.  Devuelve el codigo de salida.
 */
async function runCommand(ctx, argv, { input, signal } = {}) {
    const payload = { argv, locale: lang(), ...(input !== undefined ? { input } : {}) };
    const jsonMode = argv.includes('--json');
    let res;
    for (let attempt = 0; attempt < 4; attempt++) {
        if (ctx.session.stepUp && ctx.session.stepUpUntil > Date.now()) payload.stepUp = ctx.session.stepUp;
        res = await client.exec(ctx.profile, payload, signal);
        if (res.needs === 'confirm') {
            if (!(await confirmInteractive(res))) { process.stderr.write(`${T('Operación cancelada. Usa --yes para confirmar sin preguntar.', 'Operation cancelled. Pass --yes to confirm without prompting.')}\n`); return 4; }
            payload.confirm = true;
            continue;
        }
        if (res.needs === 'stepup') {
            ctx.session.stepUp = null;
            delete payload.stepUp;
            payload.confirm = true;
            await obtainStepUp(ctx, signal);
            continue;
        }
        break;
    }
    if (!res.ok) { printError(res, jsonMode); return res.exitCode || 1; }

    // jobs watch: sigue hasta que el trabajo termine (Ctrl+C lo detiene)
    const w = res.output && res.output.type === 'json' && res.output.data && res.output.data.watch ? res.output.data : null;
    if (w && !w.terminal) {
        while (!(signal && signal.aborted)) {
            await new Promise((r) => setTimeout(r, 2000));
            const again = await client.exec(ctx.profile, { argv, locale: lang(), ...(payload.stepUp ? { stepUp: payload.stepUp } : {}) }, signal);
            const d = again.output && again.output.type === 'json' ? again.output.data : null;
            if (!d) break;
            process.stderr.write(`${(d.job && d.job.status) || '?'}${d.job && d.job.progress !== undefined ? ` ${d.job.progress}%` : ''}\n`);
            if (d.terminal) { emit(again, ctx.opts, argv); return 0; }
        }
        return 0;
    }
    emit(res, ctx.opts, argv);
    return 0;
}

module.exports = { runCommand, obtainStepUp, T, lang, useColor, printError };
