// Resend FALSO para E2E local: registra cada POST /emails (payload completo incl. adjuntos) en .e2e/resend-captured.json
// y devuelve ids. La app apunta aqui con RESEND_BASE_URL (node_modules/resend lee process.env.RESEND_BASE_URL).
// Uso: node scripts/fake-resend.mjs [puerto=54330]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || process.env.E2E_RESEND_PORT || 54330);
const outFile = path.join(root, '.e2e', 'resend-captured.json');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
let captured = [];
try { captured = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch { /* nuevo */ }
const save = () => fs.writeFileSync(outFile, JSON.stringify(captured, null, 2));

const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body = null;
        try { body = raw ? JSON.parse(raw) : null; } catch { body = { __unparsed: raw.slice(0, 2000) }; }
        const url = req.url || '';
        if (req.method === 'POST' && (url === '/emails' || url === '/emails/batch')) {
            const id = crypto.randomUUID();
            captured.push({ at: new Date().toISOString(), id, url, headers: { 'idempotency-key': req.headers['idempotency-key'], authorization: req.headers.authorization ? 'present' : 'absent' }, payload: body });
            save();
            res.writeHead(200, { 'content-type': 'application/json' });
            return res.end(JSON.stringify({ id }));
        }
        if (req.method === 'GET' && url === '/__captured') {
            res.writeHead(200, { 'content-type': 'application/json' });
            return res.end(JSON.stringify(captured));
        }
        if (req.method === 'POST' && url === '/__reset') { captured = []; save(); res.writeHead(200); return res.end('ok'); }
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'fake-resend: ruta no soportada', statusCode: 404, name: 'not_found' }));
    });
});
server.listen(port, '127.0.0.1', () => console.log(`fake-resend escuchando en http://127.0.0.1:${port}`));
const bye = () => server.close(() => process.exit(0));
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
