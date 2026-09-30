// Envia un webhook FIRMADO (Svix) `email.received` a la app local. Uso:
//   node scripts/e2e-webhook.mjs <from> <subject> <messageId> [repeticiones=1] [to=tester@bloomx.test]
// No incluye email_id a proposito: la app intentaria consultar la API real de Resend para completar el cuerpo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Webhook } from 'svix';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
for (const l of fs.readFileSync(path.join(root, '.env.e2e'), 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && !l.startsWith('#')) env[m[1]] = m[2]; }
const [from, subject, messageId, reps = '1', to = 'tester@bloomx.test'] = process.argv.slice(2);
const body = JSON.stringify({
    type: 'email.received', created_at: new Date().toISOString(),
    data: { from, to: [to], cc: ['otro@ext.test'], subject, messageId, text: `Cuerpo de ${subject}`, html: `<p>Cuerpo de ${subject}</p>`,
        headers: { 'Authentication-Results': 'mx.resend.test; spf=pass; dkim=pass; dmarc=pass' } },
});
const wh = new Webhook(env.WEBHOOK_SECRET);
for (let i = 0; i < Number(reps); i++) {
    const id = `msg_${Date.now()}_${i}`; const ts = new Date();
    const sig = wh.sign(id, ts, body);
    const r = await fetch(`http://127.0.0.1:${env.NEXT_PUBLIC_APP_URL.split(':').pop()}/api/webhooks/resend`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': String(Math.floor(ts.getTime() / 1000)), 'svix-signature': sig }, body });
    console.log(`#${i + 1} -> ${r.status} ${(await r.text()).slice(0, 120)}`);
}
if (process.env.BAD_SIG) { const r = await fetch(`http://127.0.0.1:3100/api/webhooks/resend`, { method: 'POST', headers: { 'content-type': 'application/json', 'svix-id': 'x', 'svix-timestamp': '1', 'svix-signature': 'v1,bad' }, body }); console.log('firma invalida ->', r.status); }
