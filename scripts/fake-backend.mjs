// Backend FALSO de extensiones/config para E2E local (puerto 54331). La app apunta aqui con NEXT_PUBLIC_BACKEND_URL,
// para que /api/config y los hooks NO contacten el backend real. Registra las peticiones en .e2e/backend-hits.log.
//
// Ademas EJECUTA de verdad el server.js de las extensiones del repo hermano (bloomx-extensions) en un contexto `vm`
// con los mismos globales que el sandbox real, para probar el flujo completo UI -> fachada del host -> extension:
//   POST /api/extension/execute  { extensionId, action, params, context }  ->  { success, result } | { success:false, error }
// La extension llama por HTTP a scripts/fake-conferencing.mjs (Google/Zoom falsos, puerto 54340) mediante las bases de
// API de modo prueba (BLOOMX_EXT_TEST_MODE=1). Credenciales "del panel" de prueba: .e2e/ext-credentials.json
//   { "core-zoom": { "ZOOM_ACCOUNT_ID": "...", ... } }   (vacio/ausente = la extension solo puede usar la cuenta del usuario)
// Nunca se contactan Google ni Zoom reales.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import nodeCrypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || 54331);
const fakeConf = `http://127.0.0.1:${process.env.E2E_CONFERENCING_PORT || 54340}`;
fs.mkdirSync(path.join(root, '.e2e'), { recursive: true });
const log = path.join(root, '.e2e', 'backend-hits.log');
const credentialsFile = path.join(root, '.e2e', 'ext-credentials.json');
const extRoot = path.join(root, '..', 'bloomx-extensions');

// Extensiones reales del repo hermano (solo lectura local): menu "/" del editor + Zoom / Meet / Calendar.
// E2E_EXT_EXTRA=notion,summarizer,... anade extensiones del repo hermano (para probar barras con muchos botones).
const EXT_DIRS = ['slash-commands', 'zoom', 'google-meet', 'calendar', ...String(process.env.E2E_EXT_EXTRA || '').split(',').map((s) => s.trim()).filter(Boolean)];
const installed = new Map(); // id canonico -> { dir, manifest }
let extensions = [];
for (const dir of EXT_DIRS) {
    try {
        const m = JSON.parse(fs.readFileSync(path.join(extRoot, dir, 'manifest.json'), 'utf8'));
        installed.set(m.id, { dir, manifest: m });
        extensions.push({ id: m.id, extensionId: m.id, template: m, status: 'active' });
    } catch { /* sin extension */ }
}

function loadHandlers(dir) {
    const source = fs.readFileSync(path.join(extRoot, dir, 'server.js'), 'utf8');
    const mod = { exports: {} };
    const sandbox = {
        module: mod,
        exports: mod.exports,
        console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
        crypto: {
            randomUUID: () => nodeCrypto.randomUUID(),
            sha256Hex: (m) => nodeCrypto.createHash('sha256').update(String(m)).digest('hex'),
            hmacSha256Hex: (k, m) => nodeCrypto.createHmac('sha256', String(k)).update(String(m)).digest('hex'),
            signRs256: (pem, msg) => nodeCrypto.createSign('RSA-SHA256').update(String(msg)).sign(String(pem)).toString('base64url'),
        },
        fetch, URL, URLSearchParams, Buffer, setTimeout, clearTimeout,
    };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: `${dir}/server.js` });
    return mod.exports && Object.keys(mod.exports).length ? mod.exports : sandbox.exports;
}

function credentialsFor(id) {
    try {
        return JSON.parse(fs.readFileSync(credentialsFile, 'utf8'))[id] || {};
    } catch {
        return {};
    }
}

async function execute(body, headers) {
    const ext = installed.get(body.extensionId);
    if (!ext) return { status: 404, body: { error: 'Extension is not installed for this domain' } };
    const handlers = loadHandlers(ext.dir);
    const action = ext.manifest.api?.functions?.[body.action]?.handler || body.action;
    if (typeof handlers[action] !== 'function') return { status: 404, body: { error: 'Action not found on extension' } };
    const ctx = {
        ...(body.context && typeof body.context === 'object' ? body.context : {}),
        args: body.params ?? {},
        env: {
            ...credentialsFor(body.extensionId),
            BLOOMX_EXT_TEST_MODE: '1',
            GOOGLE_API_BASE: `${fakeConf}/google`,
            MEET_API_BASE: `${fakeConf}/meet/v2`,
            GOOGLE_TOKEN_URL: `${fakeConf}/google/token`,
            ZOOM_API_BASE: `${fakeConf}/zoom/v2`,
            ZOOM_OAUTH_BASE: `${fakeConf}/zoom`,
        },
        domain: { id: 'e2e', name: 'localhost', displayName: 'Bloomx E2E', theme: {} },
        user: { id: headers['x-user-id'] || null, email: headers['x-user-email'] || null },
        settings: {},
        extension: { id: body.extensionId, name: ext.manifest.name, manifest: ext.manifest },
        services: { ai: { generate: async () => '' }, auth: { getToken: () => null } },
    };
    try {
        const result = await handlers[action](ctx);
        return { status: 200, body: { success: true, result: JSON.parse(JSON.stringify(result ?? null)) } };
    } catch (e) {
        return { status: 500, body: { success: false, error: String(e && e.message ? e.message : e).slice(0, 500) } };
    }
}

const server = http.createServer(async (req, res) => {
    fs.appendFileSync(log, `${new Date().toISOString()} ${req.method} ${req.url}\n`);
    const json = (status, body, extra = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...extra }); res.end(JSON.stringify(body)); };

    if ((req.url || '').startsWith('/api/extension/execute') && req.method === 'POST') {
        let raw = '';
        for await (const c of req) raw += c;
        let body;
        try { body = JSON.parse(raw); } catch { return json(400, { error: 'Bad JSON' }); }
        // Traza sin secretos: que extension/accion se ejecuto y si llego contexto de cuenta (nunca el token).
        fs.appendFileSync(log, `  -> ${body.extensionId}.${body.action} auth=${Object.keys(body.context?.auth || {}).join(',') || 'none'} user=${req.headers['x-user-id'] || '-'}\n`);
        const out = await execute(body, req.headers);
        return json(out.status, out.body, { 'x-bloomx-auth': 'signed' });
    }
    if ((req.url || '').startsWith('/api/config')) {
        // .e2e/theme.json (opcional): tema de empresa de PRUEBA (DomainThemeConfig) leido en cada peticion para cambiar de paleta sin reiniciar.
        let theme = { primaryColor: '#4f46e5', radius: 0.5 };
        try { theme = JSON.parse(fs.readFileSync(path.join(root, '.e2e', 'theme.json'), 'utf8')); } catch { /* tema por defecto */ }
        return json(200, { config: { id: 'e2e', name: 'localhost', displayName: 'Bloomx E2E', theme, logo: null }, extensions });
    }
    json(200, { ok: true, extensions: [] });
});
server.listen(port, '127.0.0.1', () => console.log(`fake-backend en http://127.0.0.1:${port}`));
const bye = () => server.close(() => process.exit(0));
process.on('SIGINT', bye); process.on('SIGTERM', bye);
