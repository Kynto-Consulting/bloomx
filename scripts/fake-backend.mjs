// Backend FALSO de extensiones/config para E2E local (puerto 54331). La app apunta aqui con NEXT_PUBLIC_BACKEND_URL,
// para que /api/config y los hooks NO contacten el backend real. Registra las peticiones en .e2e/backend-hits.log.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || 54331);
fs.mkdirSync(path.join(root, '.e2e'), { recursive: true });
const log = path.join(root, '.e2e', 'backend-hits.log');
// Extension real del repo hermano (solo lectura local) para probar el menu "/" del editor.
let extensions = [];
try {
    const m = JSON.parse(fs.readFileSync(path.join(root, '..', 'bloomx-extensions', 'slash-commands', 'manifest.json'), 'utf8'));
    extensions = [{ id: m.id, template: m, status: 'active' }];
} catch { /* sin extension */ }
const server = http.createServer((req, res) => {
    fs.appendFileSync(log, `${new Date().toISOString()} ${req.method} ${req.url}\n`);
    res.writeHead(200, { 'content-type': 'application/json' });
    if ((req.url || '').startsWith('/api/config')) {
        return res.end(JSON.stringify({ config: { id: 'e2e', name: 'localhost', displayName: 'Bloomx E2E', theme: { primaryColor: '#4f46e5', radius: 0.5 }, logo: null }, extensions }));
    }
    res.end(JSON.stringify({ ok: true, extensions: [] }));
});
server.listen(port, '127.0.0.1', () => console.log(`fake-backend en http://127.0.0.1:${port}`));
const bye = () => server.close(() => process.exit(0));
process.on('SIGINT', bye); process.on('SIGTERM', bye);
