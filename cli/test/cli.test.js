'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mockServer, tmpConfig, run, TOKEN, GOOD } = require('./helpers');
const { tokenize, quoteArg, maskSecrets } = require('../lib/tokenize');
const { normalizeUrl } = require('../lib/client');

const login = (m, dir, extra = []) => run(['login', m.url, '--email', GOOD.email, '--password-stdin', '--code', GOOD.code, ...extra], { env: { BLOOMX_CONFIG_DIR: dir }, input: `${GOOD.password}\n` });

test('login: guarda el token en el almacen del usuario (0600), nunca la contrasena, y muestra el dominio acotado', async (t) => {
    const m = await mockServer(); const dir = tmpConfig();
    t.after(() => m.close());
    const r = await login(m, dir);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Connected to mail\.example\.test as boss@example\.test/);
    assert.match(r.stdout, /scoped to domain: mail\.example\.test/);
    assert.ok(!r.stdout.includes(TOKEN) && !r.stderr.includes(TOKEN), 'el token no se imprime');
    const file = path.join(dir, 'credentials.json');
    const raw = fs.readFileSync(file, 'utf8');
    assert.ok(!raw.includes(GOOD.password), 'la contrasena no se guarda');
    assert.ok(!raw.includes(GOOD.code), 'el codigo MFA no se guarda');
    const data = JSON.parse(raw);
    assert.equal(data.profiles[`127.0.0.1:${m.port}`].token, TOKEN);
    assert.equal(data.active, `127.0.0.1:${m.port}`);
    if (process.platform !== 'win32') {
        assert.equal(fs.statSync(file).mode & 0o777, 0o600);
        assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
    }
    // el servidor recibio la contrasena UNA vez y el nombre del token
    assert.equal(m.log.logins.length, 1);
    assert.equal(m.log.logins[0].password, GOOD.password);
});

test('login con MFA: sin codigo ni TTY falla con mensaje claro; con --code funciona', async (t) => {
    const m = await mockServer(); const dir = tmpConfig();
    t.after(() => m.close());
    const r = await run(['login', m.url, '--email', GOOD.email, '--password-stdin'], { env: { BLOOMX_CONFIG_DIR: dir }, input: `${GOOD.password}\n` });
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /MFA code required/);
    assert.ok(!fs.existsSync(path.join(dir, 'credentials.json')), 'no se guarda nada si falla');
});

test('login con credenciales invalidas: error, exit 3 y no se guarda nada', async (t) => {
    const m = await mockServer(); const dir = tmpConfig();
    t.after(() => m.close());
    const r = await run(['login', m.url, '--email', GOOD.email, '--password-stdin'], { env: { BLOOMX_CONFIG_DIR: dir }, input: 'wrong-password\n' });
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /Invalid credentials/);
    assert.ok(!fs.existsSync(path.join(dir, 'credentials.json')));
});

test('ejecuta un comando y sale 0; --json es parseable (pipes)', async (t) => {
    const m = await mockServer(); const dir = tmpConfig();
    t.after(() => m.close());
    await login(m, dir);
    const env = { BLOOMX_CONFIG_DIR: dir };
    const text = await run(['users', 'list'], { env });
    assert.equal(text.code, 0, text.stderr);
    assert.match(text.stdout, /email\s+status/);
    assert.match(text.stdout, /ana@example\.test\s+active/);
    const j = await run(['users', 'list', '--json'], { env });
    assert.equal(j.code, 0);
    assert.deepEqual(JSON.parse(j.stdout).map((r) => r.email), ['ana@example.test', 'bob@example.test']);
    // el token viajo como Bearer en cada peticion de exec
    assert.ok(m.log.requests.filter((r) => r.url === '/api/admin/cli/exec').every((r) => r.headers.authorization === `Bearer ${TOKEN}`));
});

test('comando desconocido => codigo de salida 127; sin sesion => error claro', async (t) => {
    const m = await mockServer(); const dir = tmpConfig();
    t.after(() => m.close());
    const none = await run(['users', 'list'], { env: { BLOOMX_CONFIG_DIR: dir } });
    assert.notEqual(none.code, 0);
    assert.match(none.stderr, /Not logged in/);
    await login(m, dir);
    const r = await run(['nope'], { env: { BLOOMX_CONFIG_DIR: dir } });
    assert.equal(r.code, 127);
    assert.match(r.stderr, /Unknown command/);
});

test('destructivo: sin --yes y sin TTY => 4; con --yes pide step-up => 4; con BLOOMX_STEPUP_PASSWORD => 0 y la contrasena solo viaja a /reauth', async (t) => {
    const m = await mockServer(); const dir = tmpConfig();
    t.after(() => m.close());
    await login(m, dir);
    const env = { BLOOMX_CONFIG_DIR: dir };
    assert.equal((await run(['users', 'disable', 'bob'], { env })).code, 4);
    const noStep = await run(['users', 'disable', 'bob', '--yes'], { env });
    assert.equal(noStep.code, 4);
    assert.match(noStep.stderr, /BLOOMX_STEPUP/);
    const ok = await run(['users', 'disable', 'bob', '--yes'], { env: { ...env, BLOOMX_STEPUP_PASSWORD: GOOD.password } });
    assert.equal(ok.code, 0, ok.stderr);
    assert.match(ok.stdout, /User disabled/);
    assert.equal(m.log.reauthBodies.at(-1).password, GOOD.password);
    for (const p of m.log.execPayloads) assert.ok(!JSON.stringify(p).includes(GOOD.password), 'la contrasena de step-up nunca va en /exec');
    assert.equal(m.log.execPayloads.at(-1).stepUp, 'proof.abc');
});

test('token revocado/caducado => exit 3 con indicacion de volver a iniciar sesion', async (t) => {
    const m = await mockServer(); const dir = tmpConfig();
    t.after(() => m.close());
    await login(m, dir);
    m.state.tokenValid = false; m.state.revoked = true;
    const r = await run(['users', 'list'], { env: { BLOOMX_CONFIG_DIR: dir } });
    assert.equal(r.code, 3);
    assert.match(r.stderr, /revoked/);
});

test('csv: stdout crudo y --out lo guarda', async (t) => {
    const m = await mockServer(); const dir = tmpConfig();
    t.after(() => m.close());
    await login(m, dir);
    const env = { BLOOMX_CONFIG_DIR: dir };
    const r = await run(['users', 'export'], { env });
    assert.equal(r.stdout, 'id,email\r\n1,a@x.test\r\n');
    const out = path.join(dir, 'u.csv');
    const r2 = await run(['users', 'export', '--out', out], { env });
    assert.equal(r2.code, 0);
    assert.equal(fs.readFileSync(out, 'utf8'), 'id,email\r\n1,a@x.test\r\n');
});

test('--token/--url (sin perfil guardado) y BLOOMX_TOKEN/BLOOMX_URL funcionan y no escriben credenciales', async (t) => {
    const m = await mockServer(); const dir = tmpConfig();
    t.after(() => m.close());
    const env = { BLOOMX_CONFIG_DIR: dir };
    const a = await run(['whoami', '--json', '--url', m.url, '--token', TOKEN], { env });
    assert.equal(a.code, 0, a.stderr);
    assert.equal(JSON.parse(a.stdout).domain, 'mail.example.test');
    const b = await run(['whoami'], { env: { ...env, BLOOMX_URL: m.url, BLOOMX_TOKEN: TOKEN } });
    assert.equal(b.code, 0);
    assert.ok(!fs.existsSync(path.join(dir, 'credentials.json')));
});

test('login --token valida con whoami y guarda el perfil', async (t) => {
    const m = await mockServer(); const dir = tmpConfig();
    t.after(() => m.close());
    const r = await run(['login', m.url, '--token', TOKEN], { env: { BLOOMX_CONFIG_DIR: dir } });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(dir, 'credentials.json')));
    const bad = await run(['login', m.url, '--token', `bxa_${'x'.repeat(43)}`], { env: { BLOOMX_CONFIG_DIR: tmpConfig() } });
    assert.notEqual(bad.code, 0);
});

test('logout revoca en el servidor y borra el perfil local', async (t) => {
    const m = await mockServer(); const dir = tmpConfig();
    t.after(() => m.close());
    await login(m, dir);
    const r = await run(['logout'], { env: { BLOOMX_CONFIG_DIR: dir } });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(m.log.requests.some((q) => q.url === '/api/admin/cli/logout'));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'credentials.json'), 'utf8')).profiles, {});
    assert.equal(m.state.tokenValid, false);
    const after = await run(['whoami'], { env: { BLOOMX_CONFIG_DIR: dir } });
    assert.notEqual(after.code, 0);
});

test('perfiles: varias instancias, use cambia el activo y rechaza dominios sin sesion', async (t) => {
    const a = await mockServer(); const b = await mockServer(); const dir = tmpConfig();
    t.after(() => Promise.all([a.close(), b.close()]));
    await login(a, dir); await login(b, dir);
    const env = { BLOOMX_CONFIG_DIR: dir };
    const list = await run(['profiles'], { env });
    assert.match(list.stdout, new RegExp(`127\\.0\\.0\\.1:${a.port}`));
    assert.match(list.stdout, new RegExp(`\\* 127\\.0\\.0\\.1:${b.port}`)); // el ultimo login queda activo
    const use = await run(['use', `127.0.0.1:${a.port}`], { env });
    assert.equal(use.code, 0, use.stderr);
    assert.match((await run(['profiles'], { env })).stdout, new RegExp(`\\* 127\\.0\\.0\\.1:${a.port}`));
    const bad = await run(['use', 'otro.dominio.test'], { env });
    assert.notEqual(bad.code, 0);
    assert.match(bad.stderr, /No session for/);
    const viaFlag = await run(['whoami', '--json', '--profile', `127.0.0.1:${b.port}`], { env });
    assert.equal(viaFlag.code, 0);
});

test('shell/ssh: REPL no interactivo ejecuta lineas y sale con exit', async (t) => {
    const m = await mockServer(); const dir = tmpConfig();
    t.after(() => m.close());
    await login(m, dir);
    for (const alias of ['shell', 'ssh']) {
        const r = await run([alias], { env: { BLOOMX_CONFIG_DIR: dir }, input: 'whoami\nusers list --json\nexit\n' });
        assert.equal(r.code, 0, r.stderr);
        assert.match(r.stdout, /boss@example\.test/);
        assert.match(r.stderr, /not SSH/);
    }
    // el historial se guarda con 0600 y sin secretos
    const hist = fs.readFileSync(path.join(dir, 'history'), 'utf8');
    assert.match(hist, /whoami/);
});

test('shell: el historial enmascara banderas secretas', async (t) => {
    const m = await mockServer(); const dir = tmpConfig();
    t.after(() => m.close());
    await login(m, dir);
    await run(['shell'], { env: { BLOOMX_CONFIG_DIR: dir }, input: 'whoami --password hunter2hunter2\nexit\n' });
    const hist = fs.readFileSync(path.join(dir, 'history'), 'utf8');
    assert.ok(!hist.includes('hunter2'));
    assert.match(hist, /--password \*\*\*/);
});

test('__complete y completion generan candidatos / scripts', async (t) => {
    const m = await mockServer(); const dir = tmpConfig();
    t.after(() => m.close());
    await login(m, dir);
    const c = await run(['__complete', 'us'], { env: { BLOOMX_CONFIG_DIR: dir } });
    assert.deepEqual(c.stdout.trim().split('\n'), ['users', 'user-x']);
    assert.match((await run(['completion', 'bash'])).stdout, /complete -F _bloomx_complete bloomx/);
    assert.notEqual((await run(['completion', 'fish'])).code, 0);
});

test('solo HTTPS (http solo hacia localhost) y sin credenciales en la URL', () => {
    assert.equal(normalizeUrl('https://mail.example.com/x/y'), 'https://mail.example.com');
    assert.equal(normalizeUrl('mail.example.com'), 'https://mail.example.com');
    assert.equal(normalizeUrl('http://localhost:3000'), 'http://localhost:3000');
    assert.throws(() => normalizeUrl('http://mail.example.com'), /https/);
    assert.throws(() => normalizeUrl('ftp://mail.example.com'), /https/);
    assert.throws(() => normalizeUrl('https://user:pw@mail.example.com'), /credentials/);
});

test('tokenize/maskSecrets del cliente', () => {
    assert.deepEqual(tokenize('a "b c" \'d e\' f\\ g'), ['a', 'b c', 'd e', 'f g']);
    assert.throws(() => tokenize('a "b'), /Unterminated/);
    assert.equal(tokenize(quoteArg('x "y" z'))[0], 'x "y" z');
    assert.equal(maskSecrets('users create a@b.co --password S3cr3tS3cr3t --name Ana'), 'users create a@b.co --password *** --name Ana');
    assert.equal(maskSecrets('x --value=abc'), 'x --value=***');
});

test('--version y --help no requieren sesion', async () => {
    const v = await run(['--version']);
    assert.match(v.stdout, /^\d+\.\d+\.\d+/);
    const h = await run(['--help']);
    assert.equal(h.code, 0);
    assert.match(h.stdout, /bloomx login/);
    assert.match(h.stdout, /ssh/);
});

test('la contrasena nunca aparece en la salida ni en el historial del proceso', async (t) => {
    const m = await mockServer(); const dir = tmpConfig();
    t.after(() => m.close());
    const r = await login(m, dir);
    assert.ok(!(r.stdout + r.stderr).includes(GOOD.password));
    for (const f of fs.readdirSync(dir)) assert.ok(!fs.readFileSync(path.join(dir, f), 'utf8').includes(GOOD.password));
});
