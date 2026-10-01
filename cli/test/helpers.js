'use strict';

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'bloomx.js');
const TOKEN = `bxa_${'T'.repeat(43)}`;
const GOOD = { email: 'boss@example.test', password: 'Correct-Horse-Battery-9', code: '123456' };

/** Servidor simulado de /api/admin/cli/**. Registra todo lo recibido para que los tests lo inspeccionen. */
function mockServer() {
    const log = { requests: [], reauthBodies: [], execPayloads: [], logins: [] };
    const state = { tokenValid: true, revoked: false };
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
            let json = null;
            try { json = body ? JSON.parse(body) : null; } catch { /* binario */ }
            log.requests.push({ method: req.method, url: req.url, headers: req.headers, body: json });
            const send = (status, data, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(data)); };

            if (req.url === '/api/admin/cli/login') {
                log.logins.push(json);
                if (json.email !== GOOD.email || json.password !== GOOD.password) return send(401, { error: 'Invalid credentials', code: 'invalid_credentials' });
                if (!json.code && !json.recoveryCode) return send(200, { mfaRequired: true });
                if (json.code !== GOOD.code) return send(401, { error: 'Invalid code', code: 'invalid_mfa' });
                return send(200, { token: TOKEN, tokenId: 'tid-1', scopes: json.scopes || ['read', 'write'], expiresAt: new Date(Date.now() + 12 * 3600e3).toISOString(), account: { email: GOOD.email, kind: 'user' }, domain: 'mail.example.test' });
            }

            const auth = req.headers.authorization;
            if (auth !== `Bearer ${TOKEN}` || !state.tokenValid) return send(401, { error: 'Unauthorized', code: state.revoked ? 'token_revoked' : 'token_unknown' });

            if (req.url === '/api/admin/cli/logout') { state.tokenValid = false; state.revoked = true; return send(200, { ok: true }); }
            if (req.url === '/api/admin/cli/reauth') {
                log.reauthBodies.push(json);
                if (json.password !== GOOD.password && json.code !== GOOD.code) return send(401, { ok: false, error: 'invalid_credentials', code: 'invalid_credentials' });
                return send(200, { ok: true, stepUp: 'proof.abc', expiresAt: Date.now() + 600e3, method: json.code ? 'mfa' : 'password' });
            }
            if (req.url.startsWith('/api/admin/cli/complete')) return send(200, { prefix: '', candidates: [{ value: 'users', kind: 'command' }, { value: 'user-x', kind: 'user' }] });
            if (req.url === '/api/admin/cli/exec') {
                log.execPayloads.push(json);
                const argv = json.argv || [];
                const jsonMode = argv.includes('--json');
                const name = argv.filter((a) => !a.startsWith('-')).slice(0, 2).join(' ');
                if (name === 'whoami') {
                    const o = { type: 'kv', items: [{ key: 'account', value: GOOD.email }, { key: 'role', value: 'app admin' }, { key: 'domain', value: 'mail.example.test' }, { key: 'scopes', value: 'read, write' }] };
                    return send(200, { ok: true, exitCode: 0, output: o, ...(jsonMode ? { json: { account: GOOD.email, role: 'app admin', domain: 'mail.example.test', scopes: 'read, write' } } : {}) });
                }
                if (name === 'users list') {
                    const rows = [{ email: 'ana@example.test', status: 'active' }, { email: 'bob@example.test', status: 'disabled' }];
                    return send(200, { ok: true, exitCode: 0, output: { type: 'table', columns: [{ key: 'email', label: 'email' }, { key: 'status', label: 'status' }], rows }, ...(jsonMode ? { json: rows } : {}) });
                }
                if (name === 'users disable') {
                    if (!argv.includes('--yes') && !json.confirm) return send(200, { ok: false, exitCode: 4, needs: 'confirm', command: 'users disable', risk: 'destructive', error: { code: 'confirmation_required', message: 'confirm' } });
                    if (json.stepUp !== 'proof.abc') return send(200, { ok: false, exitCode: 4, needs: 'stepup', command: 'users disable', risk: 'destructive', error: { code: 'stepup_required', message: 'stepup' } });
                    return send(200, { ok: true, exitCode: 0, output: { type: 'text', text: 'User disabled.', tone: 'success' } });
                }
                if (name === 'users export') return send(200, { ok: true, exitCode: 0, output: { type: 'csv', filename: 'u.csv', text: 'id,email\r\n1,a@x.test\r\n' } });
                if (name.startsWith('use')) return send(200, { ok: true, exitCode: 0, output: { type: 'text', text: 'ok' } });
                return send(200, { ok: false, exitCode: 127, error: { code: 'unknown_command', message: 'Unknown command' } });
            }
            return send(404, { error: 'not found' });
        });
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}`, log, state, close: () => new Promise((r) => server.close(r)) })));
}

function tmpConfig() { return fs.mkdtempSync(path.join(os.tmpdir(), 'bloomx-cli-test-')); }

/** Ejecuta el CLI como proceso real. stdin se cierra tras escribir `input` (no hay TTY: asi se prueban los modos no interactivos). */
function run(args, { env = {}, input } = {}) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [BIN, ...args], { env: { ...process.env, NO_COLOR: '1', BLOOMX_LANG: 'en', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = ''; let stderr = '';
        child.stdout.on('data', (c) => { stdout += c; });
        child.stderr.on('data', (c) => { stderr += c; });
        child.on('close', (code) => resolve({ code, stdout, stderr }));
        if (input !== undefined) child.stdin.write(input);
        child.stdin.end();
    });
}

module.exports = { mockServer, tmpConfig, run, TOKEN, GOOD, BIN };
