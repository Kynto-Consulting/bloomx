'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/**
 * El tarball que se publicaria (`npm pack --dry-run`) contiene SOLO la lista blanca (bin/, lib/, README, LICENSE, package.json):
 * nunca .env, pruebas, fixtures, credenciales ni tokens.
 */
const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function pack() {
    const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' });
    assert.equal(r.status, 0, r.stderr);
    const json = JSON.parse(r.stdout);
    return json[0];
}

test('package.json: nombre, bin, version, engines, publishConfig y lista blanca explicita', () => {
    assert.equal(pkg.name, '@kyntocg/bloomx-cli');
    assert.equal(pkg.version, '0.1.0');
    assert.equal(pkg.bin.bloomx, 'bin/bloomx.js');
    assert.equal(pkg.engines.node, '>=18');
    assert.deepEqual(pkg.publishConfig, { access: 'public' });
    assert.deepEqual(pkg.files, ['bin/', 'lib/', 'README.md', 'LICENSE']);
    assert.deepEqual(pkg.dependencies, {}); // sin dependencias
    assert.equal(pkg.scripts.postinstall, undefined);
    assert.equal(pkg.scripts.install, undefined);
    assert.equal(pkg.scripts.preinstall, undefined);
});

test('el tarball solo contiene la lista blanca y ningun secreto', () => {
    const p = pack();
    const files = p.files.map((f) => f.path);
    assert.ok(files.includes('bin/bloomx.js') && files.includes('package.json') && files.includes('README.md') && files.includes('LICENSE'));
    for (const f of files) assert.match(f, /^(bin\/|lib\/|README\.md$|LICENSE$|package\.json$)/, `fuera de la lista blanca: ${f}`);
    for (const f of files) assert.doesNotMatch(f, /(^|\/)(\.env|test|tests|fixtures?|node_modules|\.git)(\/|$|\.)|credentials|\.pem$|\.key$|history/i, `archivo sospechoso: ${f}`);
    for (const f of p.files) {
        const text = fs.readFileSync(path.join(ROOT, f.path), 'utf8');
        assert.doesNotMatch(text, /bxa_[A-Za-z0-9_-]{43}/, `token en ${f.path}`);
        assert.doesNotMatch(text, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, `clave privada en ${f.path}`);
    }
    assert.ok(p.size < 100 * 1024, 'el paquete es pequeno');
});

test('el binario es ejecutable con shebang y todos los modulos cargan', () => {
    assert.match(fs.readFileSync(path.join(ROOT, 'bin', 'bloomx.js'), 'utf8'), /^#!\/usr\/bin\/env node/);
    for (const m of fs.readdirSync(path.join(ROOT, 'lib'))) require(path.join(ROOT, 'lib', m));
});
