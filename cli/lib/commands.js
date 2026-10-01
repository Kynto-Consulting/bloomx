'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const client = require('./client');
const config = require('./config');
const { readLine, readSecret, readAllStdin } = require('./prompt');
const { T, obtainStepUp, runCommand } = require('./run');

/** Comandos que viven en el CLIENTE: login, logout, profiles, use, completion, transfer import/download. */

function flagValue(args, name, fallback) {
    const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (i < 0) return fallback;
    if (args[i].includes('=')) return args[i].slice(args[i].indexOf('=') + 1);
    return args[i + 1] !== undefined ? args[i + 1] : fallback;
}
const hasFlag = (args, name) => args.includes(`--${name}`);

function fmtDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? String(iso) : d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

function saveProfile(name, profile) {
    const cfg = config.load();
    cfg.profiles[name] = profile;
    cfg.active = name;
    config.save(cfg);
}

/** bloomx login <url> [--profile n] [--email e] [--name label] [--scopes read,write] [--ttl h] [--code 123456] [--password-stdin] [--token t] */
async function login(args, opts) {
    const urlArg = args.find((a) => !a.startsWith('-')) || opts.url || process.env.BLOOMX_URL;
    if (!urlArg) throw new client.ApiError(T('Uso: bloomx login https://<tu-instancia>', 'Usage: bloomx login https://<your-instance>'));
    const url = client.normalizeUrl(urlArg);
    const name = opts.profile || config.profileNameFromUrl(url);

    // --token: valida el token con `whoami` y lo guarda (no se pide contrasena)
    const token = opts.token || process.env.BLOOMX_TOKEN;
    if (token) {
        const res = await client.exec({ url, token }, { argv: ['whoami', '--json'], locale: 'en' });
        if (!res.ok) throw new client.ApiError(res.error ? res.error.message : 'Token rejected', { code: 'invalid_token' });
        const me = res.json || {};
        saveProfile(name, { url, token, account: me.account, domain: me.domain, scopes: String(me.scopes || '').split(/,\s*/), expiresAt: null, savedAt: new Date().toISOString() });
        process.stdout.write(`${T('Conectado a', 'Connected to')} ${me.domain || url} ${T('como', 'as')} ${me.account} (${me.role || ''}).\n${T('Los comandos operan SOLO sobre ese dominio.', 'Commands operate ONLY on that domain.')}\n`);
        return 0;
    }

    const email = (flagValue(opts.rest, 'email') || (process.stdin.isTTY ? await readLine(T('Correo: ', 'Email: ')) : '')).trim();
    if (!email) throw new client.ApiError(T('Falta el correo (--email).', 'Missing the email (--email).'));
    let password;
    if (hasFlag(opts.rest, 'password-stdin')) password = (await readAllStdin(4096)).replace(/\r?\n$/, '');
    else password = await readSecret(T('Contraseña: ', 'Password: '));
    if (!password) throw new client.ApiError(T('Falta la contraseña.', 'Missing the password.'));

    const body = { email, password, name: flagValue(opts.rest, 'name') || `bloomx-cli@${require('node:os').hostname()}`.slice(0, 60) };
    const scopes = flagValue(opts.rest, 'scopes'); if (scopes) body.scopes = scopes.split(',');
    const ttl = flagValue(opts.rest, 'ttl'); if (ttl) body.ttlHours = Number(ttl);
    const code = flagValue(opts.rest, 'code') || process.env.BLOOMX_MFA_CODE; if (code) body.code = code;

    let { status, data } = await client.login({ url }, body);
    if (status === 200 && data && data.mfaRequired) {
        const c = process.stdin.isTTY ? await readSecret(T('Código MFA (o código de recuperación): ', 'MFA code (or recovery code): ')) : '';
        if (!c.trim()) throw new client.ApiError(T('Se requiere el código MFA (--code o BLOOMX_MFA_CODE).', 'MFA code required (--code or BLOOMX_MFA_CODE).'), { code: 'mfa_required' });
        if (/^\d{6}$/.test(c.trim())) body.code = c.trim(); else body.recoveryCode = c.trim();
        ({ status, data } = await client.login({ url }, body));
    }
    password = null; body.password = null; // no se conserva
    if (status !== 200 || !data || !data.token) {
        const msg = (data && data.error) || `HTTP ${status}`;
        const hint = data && data.code === 'domain_not_owned' ? T(' Esta cuenta no administra este dominio.', ' This account does not manage this domain.') : '';
        throw new client.ApiError(`${msg}.${hint}`, { status, code: (data && data.code) || 'login_failed', data });
    }
    saveProfile(name, { url, token: data.token, account: data.account && data.account.email, kind: data.account && data.account.kind, domain: data.domain, scopes: data.scopes, expiresAt: data.expiresAt, tokenId: data.tokenId, savedAt: new Date().toISOString() });
    process.stdout.write([
        `${T('Conectado a', 'Connected to')} ${data.domain || url} ${T('como', 'as')} ${data.account.email} (${data.account.kind === 'manager' ? T('manager dueño del dominio', 'manager and domain owner') : T('administrador de la instancia', 'instance administrator')}).`,
        `${T('Dominio acotado a esta sesión', 'Session scoped to domain')}: ${data.domain || '-'}   scopes: ${(data.scopes || []).join(', ')}`,
        `${T('El token caduca', 'The token expires')}: ${fmtDate(data.expiresAt)}   ${T('Guardado (0600) en', 'Stored (0600) in')} ${config.credentialsFile()}`,
        '',
    ].join('\n'));
    return 0;
}

async function logout(opts) {
    const cfg = config.load();
    const names = hasFlag(opts.rest, 'all') ? Object.keys(cfg.profiles) : [opts.profile || process.env.BLOOMX_PROFILE || cfg.active].filter(Boolean);
    if (names.length === 0) { process.stdout.write(`${T('No hay sesión guardada.', 'No saved session.')}\n`); return 0; }
    for (const n of names) {
        const p = cfg.profiles[n];
        if (!p) continue;
        const revoked = await client.logout(p); // revoca en el servidor (si ya caduco, no importa)
        delete cfg.profiles[n];
        if (cfg.active === n) cfg.active = Object.keys(cfg.profiles)[0] || null;
        process.stdout.write(`${T('Sesión cerrada', 'Logged out')}: ${n}${revoked ? '' : ` (${T('no se pudo revocar en el servidor; revócalo con "tokens revoke"', 'could not revoke on the server; revoke it with "tokens revoke"')})`}\n`);
    }
    config.save(cfg);
    return 0;
}

function profiles() {
    const cfg = config.load();
    const names = Object.keys(cfg.profiles);
    if (names.length === 0) { process.stdout.write(`${T('No hay perfiles. Ejecuta: bloomx login <url>', 'No profiles. Run: bloomx login <url>')}\n`); return 0; }
    for (const n of names) {
        const p = cfg.profiles[n];
        process.stdout.write(`${n === cfg.active ? '*' : ' '} ${n}  ${p.account || '-'}  ${p.domain || '-'}  ${T('caduca', 'expires')} ${fmtDate(p.expiresAt)}\n`);
    }
    return 0;
}

/** bloomx use <domain|profile>: cambia el perfil activo; el servidor valida que el dominio sea el de la sesion. */
async function use(args, opts) {
    const want = (args[0] || '').trim().toLowerCase();
    if (!want) throw new client.ApiError(T('Uso: bloomx use <dominio|perfil>', 'Usage: bloomx use <domain|profile>'));
    const cfg = config.load();
    const hit = Object.entries(cfg.profiles).find(([n, p]) => n.toLowerCase() === want || String(p.domain || '').toLowerCase() === want || config.profileNameFromUrl(p.url).toLowerCase() === want);
    if (!hit) throw new client.ApiError(T(`No hay una sesión para "${want}". Ejecuta: bloomx login https://${want}`, `No session for "${want}". Run: bloomx login https://${want}`), { code: 'unknown_profile' });
    const [name, p] = hit;
    const res = await client.exec({ ...p }, { argv: ['use', p.domain || want], locale: 'en' });
    if (!res.ok) throw new client.ApiError(res.error ? res.error.message : 'Validation failed', { code: 'domain_mismatch' });
    cfg.active = name; config.save(cfg);
    process.stdout.write(`${T('Perfil activo', 'Active profile')}: ${name} (${p.domain || '-'})\n`);
    void opts; return 0;
}

const BASH = (bin) => `_bloomx_complete() { local IFS=$'\\n'; COMPREPLY=( $(${bin} __complete "\${COMP_LINE#* }" 2>/dev/null) ); }\ncomplete -F _bloomx_complete bloomx\n`;
const ZSH = (bin) => `#compdef bloomx\n_bloomx() { local -a c; c=("\${(@f)$(${bin} __complete "\${words[2,-1]}" 2>/dev/null)}"); compadd -a c }\ncompdef _bloomx bloomx\n`;

function completionScript(shell) {
    if (shell === 'bash') return BASH('bloomx');
    if (shell === 'zsh') return ZSH('bloomx');
    throw new client.ApiError('Usage: bloomx completion <bash|zsh>');
}

async function completeLine(profile, line) {
    const r = await client.complete(profile, line, T('es', 'en'));
    return r.candidates.map((c) => c.value);
}

// ------------------------------------------------------------------------------------------------------------------
// transfer import <archivo> / transfer download <job> --out <archivo>
// ------------------------------------------------------------------------------------------------------------------

async function raw(ctx, method, p, { body, headers = {} } = {}) {
    return client.request(ctx.profile, method, `/api/admin/cli/transfer/${p}`, { body, headers: { ...headers, 'x-bloomx-stepup': ctx.session.stepUp || '' }, raw: true, timeoutMs: 120_000 });
}

async function jsonExec(ctx, argv) {
    const res = await client.exec(ctx.profile, { argv: [...argv, '--json'], locale: 'en', ...(ctx.session.stepUp ? { stepUp: ctx.session.stepUp } : {}) });
    if (!res.ok) throw new client.ApiError(res.error ? res.error.message : 'Command failed', { code: res.error && res.error.code });
    return res.json;
}

async function transferImport(args, ctx) {
    const file = args.find((a) => !a.startsWith('-'));
    if (!file) throw new client.ApiError(T('Uso: bloomx transfer import <archivo> [--resume <job>]', 'Usage: bloomx transfer import <file> [--resume <job>]'));
    const st = fs.statSync(file);
    if (!st.isFile() || st.size === 0) throw new client.ApiError(T('El archivo no existe o esta vacio.', 'The file does not exist or is empty.'));
    await obtainStepUp(ctx);
    let jobId = flagValue(args, 'resume');
    let chunkBytes; let total;
    if (jobId) {
        const cfg = await jsonExec(ctx, ['transfer', 'config']);
        chunkBytes = cfg.chunkBytes;
        total = Math.ceil(st.size / chunkBytes);
    }
    if (!jobId) {
        const created = await jsonExec(ctx, ['transfer', 'import-create', '--file-name', path.basename(file), '--size', String(st.size)]);
        jobId = (created.job && created.job.id) || created.id;
        chunkBytes = created.chunkBytes; total = created.totalChunks;
    }
    if (!jobId || !chunkBytes) throw new client.ApiError('Unexpected response creating the import job.');
    let received = new Set();
    if (flagValue(args, 'resume')) {
        const r = await raw(ctx, 'GET', `jobs/${encodeURIComponent(jobId)}/chunks`);
        const d = await r.res.json().catch(() => ({}));
        received = new Set(d.received || []);
    }
    const fd = fs.openSync(file, 'r');
    try {
        for (let i = 0; i < total; i++) {
            if (received.has(i)) continue;
            const len = Math.min(chunkBytes, st.size - i * chunkBytes);
            const buf = Buffer.alloc(len);
            fs.readSync(fd, buf, 0, len, i * chunkBytes);
            const sha = crypto.createHash('sha256').update(buf).digest('hex');
            let ok = false;
            for (let attempt = 0; attempt < 3 && !ok; attempt++) {
                const r = await raw(ctx, 'PUT', `jobs/${encodeURIComponent(jobId)}/chunks/${i}`, { body: new Uint8Array(buf), headers: { 'x-chunk-sha256': sha, 'Content-Type': 'application/octet-stream' } });
                ok = r.status === 200;
                if (!ok && (r.status === 401 || r.status === 403)) throw new client.ApiError(T('Sin permiso o step-up caducado.', 'Not allowed or step-up expired.'), { status: r.status });
                if (!ok && r.status !== 422 && r.status < 500) throw new client.ApiError(`Chunk ${i} rejected (HTTP ${r.status})`, { status: r.status });
            }
            if (!ok) throw new client.ApiError(`Chunk ${i} failed; resume with: bloomx transfer import ${file} --resume ${jobId}`);
            process.stderr.write(`\r${T('Subiendo', 'Uploading')} ${i + 1}/${total}`);
        }
    } finally { fs.closeSync(fd); }
    process.stderr.write('\n');
    await jsonExec(ctx, ['transfer', 'import-complete', jobId]);
    process.stdout.write(`${T('Subida completa. Trabajo', 'Upload complete. Job')}: ${jobId}\n${T('Siguientes pasos', 'Next steps')}:\n  bloomx jobs watch ${jobId}\n  bloomx transfer preview ${jobId}\n  bloomx transfer import-confirm ${jobId} --confirm-domain <dominio> --yes\n`);
    return 0;
}

async function transferDownload(args, ctx) {
    const job = args.find((a) => !a.startsWith('-'));
    const out = ctx.opts.out || flagValue(args, 'out');
    if (!job || !out) throw new client.ApiError(T('Uso: bloomx transfer download <job> --out <archivo>', 'Usage: bloomx transfer download <job> --out <file>'));
    await obtainStepUp(ctx);
    const link = await jsonExec(ctx, ['transfer', 'download-link', job, '--yes']);
    const u = new URL(link.url, ctx.profile.url);
    const r = await raw(ctx, 'GET', `jobs/${encodeURIComponent(job)}/download?exp=${encodeURIComponent(u.searchParams.get('exp') || '')}&sig=${encodeURIComponent(u.searchParams.get('sig') || '')}`);
    if (r.status !== 200) { const d = await r.res.json().catch(() => ({})); throw new client.ApiError((d && d.error) || `HTTP ${r.status}`, { status: r.status }); }
    const tmp = `${out}.part`;
    const ws = fs.createWriteStream(tmp, { mode: 0o600 });
    const hash = crypto.createHash('sha256');
    let n = 0;
    for await (const chunk of r.res.body) { hash.update(chunk); n += chunk.length; if (!ws.write(chunk)) await new Promise((res) => ws.once('drain', res)); }
    await new Promise((res) => ws.end(res));
    fs.renameSync(tmp, out);
    process.stdout.write(`${T('Descargado', 'Downloaded')} ${n} bytes -> ${out}\nsha256 ${hash.digest('hex')}\n`);
    return 0;
}

module.exports = { login, logout, profiles, use, completionScript, completeLine, transferImport, transferDownload, flagValue, fmtDate, runCommand };
