'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Almacen de credenciales del USUARIO (nunca el repositorio ni el directorio actual).
 *   Linux/macOS: $XDG_CONFIG_HOME/bloomx o ~/.config/bloomx      Windows: %APPDATA%\bloomx
 *   BLOOMX_CONFIG_DIR sustituye la ruta (pruebas / contenedores).
 * El directorio se crea con 0700 y credentials.json con 0600 (escritura atomica: temporal + rename). Si un archivo existente tiene
 * permisos mas abiertos se corrigen al leerlo. En Windows chmod apenas aplica: la proteccion es la ACL del perfil del usuario.
 * Se guarda SOLO el token (caduca, es revocable) y metadatos; jamas la contrasena ni codigos MFA.
 */

function configDir() {
    if (process.env.BLOOMX_CONFIG_DIR) return path.resolve(process.env.BLOOMX_CONFIG_DIR);
    if (process.platform === 'win32' && process.env.APPDATA) return path.join(process.env.APPDATA, 'bloomx');
    return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'bloomx');
}

const credentialsFile = () => path.join(configDir(), 'credentials.json');
const historyFile = () => path.join(configDir(), 'history');

function ensureDir() {
    const dir = configDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') { try { fs.chmodSync(dir, 0o700); } catch { /* best effort */ } }
    return dir;
}

function writePrivate(file, data) {
    ensureDir();
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, data, { mode: 0o600 });
    if (process.platform !== 'win32') fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
    if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
}

function load() {
    const file = credentialsFile();
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch { return { version: 1, active: null, profiles: {} }; }
    if (process.platform !== 'win32') {
        try { const mode = fs.statSync(file).mode & 0o777; if (mode & 0o077) fs.chmodSync(file, 0o600); } catch { /* ignore */ }
    }
    try {
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object' || typeof data.profiles !== 'object') throw new Error('bad');
        return { version: 1, active: data.active || null, profiles: data.profiles };
    } catch {
        throw new Error(`Credentials file is corrupt: ${file} (delete it and run "bloomx login" again)`);
    }
}

function save(data) {
    writePrivate(credentialsFile(), `${JSON.stringify(data, null, 2)}\n`);
}

function profileNameFromUrl(url) {
    try { return new URL(url).host; } catch { return 'default'; }
}

/** Perfil activo, con --profile / BLOOMX_PROFILE y --url/--token / BLOOMX_URL/BLOOMX_TOKEN como sustitutos explicitos. */
function resolveProfile(opts) {
    const cfg = load();
    const name = opts.profile || process.env.BLOOMX_PROFILE || cfg.active;
    const url = opts.url || process.env.BLOOMX_URL;
    const token = opts.token || process.env.BLOOMX_TOKEN;
    if (url && token) return { name: name || profileNameFromUrl(url), url, token, ephemeral: true };
    if (!name || !cfg.profiles[name]) {
        if (name && !cfg.profiles[name]) throw new Error(`Unknown profile "${name}". Run "bloomx profiles".`);
        throw new Error('Not logged in. Run: bloomx login https://<your-instance>');
    }
    const p = cfg.profiles[name];
    return { name, ...p, ...(token ? { token } : {}), ...(url ? { url } : {}) };
}

function addHistory(line) {
    try {
        const file = historyFile();
        ensureDir();
        const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
        prev.push(line);
        writePrivate(file, `${prev.slice(-500).join('\n')}\n`);
    } catch { /* el historial es opcional */ }
}
function readHistory() {
    try { return fs.readFileSync(historyFile(), 'utf8').split('\n').filter(Boolean).reverse(); } catch { return []; }
}

module.exports = { configDir, credentialsFile, load, save, resolveProfile, profileNameFromUrl, addHistory, readHistory };
