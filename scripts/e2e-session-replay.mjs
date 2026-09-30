// Prueba de revocacion: login (+MFA con un codigo de recuperacion), usa la cookie, cierra sesion y la REPITE (replay).
// Uso: node scripts/e2e-session-replay.mjs <codigo-recuperacion>
import fs from 'node:fs';
const env = {}; for (const l of fs.readFileSync(new URL('../.env.e2e', import.meta.url), 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2]; }
const base = 'http://127.0.0.1:3100';
const J = { 'content-type': 'application/json' };
const post = (p, b, h = {}) => fetch(base + p, { method: 'POST', headers: { ...J, ...h }, body: JSON.stringify(b), redirect: 'manual' });
const l = await (await post('/api/auth/login', { email: env.E2E_USER_EMAIL, password: env.E2E_USER_PASSWORD })).json();
console.log('login ->', l.mfaRequired ? 'mfaRequired' : JSON.stringify(Object.keys(l)));
const vr = await post('/api/auth/mfa/verify', { mfaToken: l.mfaToken, recoveryCode: process.argv[2] });
const v = await vr.json(); const token = v.token;
console.log('mfa verify ->', vr.status, token ? 'token emitido' : JSON.stringify(v));
const cookie = `next-auth.session-token=${token}`;
const probe = async (label, ck) => { const r = await fetch(base + '/api/emails?folder=inbox', { headers: { cookie: ck }, redirect: 'manual' }); const me = await (await fetch(base + '/api/auth/me', { headers: { cookie: ck } })).json(); console.log(label, '-> /api/emails', r.status, '| /api/auth/me user:', me.user ? 'presente' : 'null'); };
await probe('antes del logout  ', cookie);
const lo = await post('/api/auth/logout', {}, { cookie });
console.log('logout ->', lo.status);
await probe('replay (cookie)   ', cookie);
const r2 = await fetch(base + '/api/emails?folder=inbox', { headers: { authorization: `Bearer ${token}` }, redirect: 'manual' });
console.log('replay (Bearer)    -> /api/emails', r2.status);
