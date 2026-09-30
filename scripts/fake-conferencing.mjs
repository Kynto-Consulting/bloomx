// Google y Zoom FALSOS para E2E local (puerto 54340): nunca se contactan servicios reales.
// Emula lo minimo que usan las extensiones core-zoom / core-google-meet y el host:
//   Google  POST /google/token | GET /google/oauth2/v2/userinfo | POST|PATCH|DELETE /google/calendar/v3/calendars/primary/events[/{id}]
//           POST /meet/v2/spaces | POST /meet/v2/spaces/{id}:endActiveConference
//   Zoom    POST /zoom/oauth/token | GET /zoom/v2/users/me | POST /zoom/v2/users/{me|id}/meetings | PATCH|DELETE /zoom/v2/meetings/{id}
// Control (solo para pruebas):  POST /__fail {"provider":"zoom|google","mode":"none|revoked|rate_limited|server_error"}
//                               GET /__captured  ->  peticiones recibidas (sin cabeceras Authorization)   POST /__reset
// Las bases se configuran en las extensiones con GOOGLE_API_BASE / MEET_API_BASE / GOOGLE_TOKEN_URL / ZOOM_API_BASE /
// ZOOM_OAUTH_BASE (solo aceptadas con BLOOMX_EXT_TEST_MODE=1 o NODE_ENV != production, ver src/lib/conferencing/api-bases.ts).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || 54340);
fs.mkdirSync(path.join(root, '.e2e'), { recursive: true });
const capturedFile = path.join(root, '.e2e', 'conferencing-captured.json');

let captured = [];
let fail = { zoom: 'none', google: 'none' };
const googleEvents = new Map(); // id -> event
const byRequestId = new Map(); // requestId -> event id (idempotencia nativa de Google)
const zoomMeetings = new Map();
let seq = 1000;

const code = (n) => Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyz'[crypto.randomInt(26)]).join('');
const meetCode = () => `${code(3)}-${code(4)}-${code(3)}`;

function persist() {
    fs.writeFileSync(capturedFile, JSON.stringify(captured, null, 2));
}

function readBody(req) {
    return new Promise((resolve) => {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => resolve(raw));
    });
}

function send(res, status, body, headers = {}) {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
}

function injectedFailure(provider, res) {
    const mode = fail[provider];
    if (mode === 'revoked') return send(res, provider === 'google' ? 401 : 401, provider === 'google' ? { error: { code: 401, status: 'UNAUTHENTICATED', message: 'invalid credentials' } } : { code: 124, message: 'Invalid access token.' }), true;
    if (mode === 'rate_limited') return send(res, 429, { message: 'Too many requests', error: { code: 429, message: 'rate limit' } }, { 'retry-after': '7' }), true;
    if (mode === 'server_error') return send(res, 500, { message: 'boom' }), true;
    return false;
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    const p = url.pathname;
    const raw = await readBody(req);
    let body = null;
    try { body = raw && (/json/.test(req.headers['content-type'] || '') || p.startsWith('/__')) ? JSON.parse(raw) : raw; } catch { body = raw; }

    if (p === '/__fail' && req.method === 'POST') {
        fail = { ...fail, [body.provider]: body.mode || 'none' };
        return send(res, 200, fail);
    }
    if (p === '/__captured') return send(res, 200, captured);
    if (p === '/__reset' && req.method === 'POST') {
        captured = []; fail = { zoom: 'none', google: 'none' };
        googleEvents.clear(); byRequestId.clear(); zoomMeetings.clear(); persist();
        return send(res, 200, { ok: true });
    }

    captured.push({ at: new Date().toISOString(), method: req.method, path: p, query: url.search, body: typeof body === 'string' && body.length > 500 ? '[big]' : body, hasAuth: Boolean(req.headers.authorization) });
    persist();

    // ─── Google ──────────────────────────────────────────────────────────────
    if (p === '/google/token' && req.method === 'POST') {
        if (fail.google === 'revoked') return send(res, 400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
        if (injectedFailure('google', res)) return;
        return send(res, 200, { access_token: `fake-google-access-${crypto.randomBytes(4).toString('hex')}`, expires_in: 3600, token_type: 'Bearer', scope: 'https://www.googleapis.com/auth/calendar.events' });
    }
    if (p === '/google/oauth2/v2/userinfo') return send(res, 200, { email: 'organizer@fake.test' });

    if (p === '/google/calendar/v3/calendars/primary/events' && req.method === 'POST') {
        if (injectedFailure('google', res)) return;
        const requestId = body?.conferenceData?.createRequest?.requestId;
        if (requestId && byRequestId.has(requestId)) return send(res, 200, googleEvents.get(byRequestId.get(requestId)));
        const id = `evt${++seq}`;
        const mc = meetCode();
        const event = {
            id, status: 'confirmed', summary: body?.summary || '', htmlLink: `https://calendar.google.com/calendar/event?eid=${id}`,
            hangoutLink: `https://meet.google.com/${mc}`,
            conferenceData: {
                conferenceId: mc,
                conferenceSolution: { key: { type: 'hangoutsMeet' }, name: 'Google Meet' },
                entryPoints: [
                    { entryPointType: 'video', uri: `https://meet.google.com/${mc}`, label: `meet.google.com/${mc}` },
                    { entryPointType: 'phone', uri: 'tel:+1-555-0100', label: '+1 555-0100', pin: '123456789' },
                ],
                createRequest: { requestId, status: { statusCode: 'success' } },
            },
        };
        googleEvents.set(id, event);
        if (requestId) byRequestId.set(requestId, id);
        return send(res, 200, event);
    }
    const ev = /^\/google\/calendar\/v3\/calendars\/primary\/events\/([^/]+)$/.exec(p);
    if (ev) {
        if (injectedFailure('google', res)) return;
        const cur = googleEvents.get(ev[1]);
        if (!cur) return send(res, 404, { error: { code: 404, message: 'Not Found' } });
        if (req.method === 'DELETE') { googleEvents.delete(ev[1]); return send(res, 204); }
        if (req.method === 'PATCH') { Object.assign(cur, body || {}, { id: cur.id }); return send(res, 200, cur); }
        return send(res, 200, cur);
    }
    if (p === '/meet/v2/spaces' && req.method === 'POST') {
        if (injectedFailure('google', res)) return;
        const mc = meetCode();
        return send(res, 200, { name: `spaces/${mc}`, meetingUri: `https://meet.google.com/${mc}`, meetingCode: mc, config: { accessType: 'OPEN' } });
    }
    if (/^\/meet\/v2\/spaces\/[^/]+:endActiveConference$/.test(p)) return send(res, 200, {});

    // ─── Zoom ────────────────────────────────────────────────────────────────
    if (p === '/zoom/oauth/token' && req.method === 'POST') {
        if (fail.zoom === 'revoked') return send(res, 400, { reason: 'Invalid client_id or client_secret', error: 'invalid_client' });
        if (injectedFailure('zoom', res)) return;
        return send(res, 200, { access_token: `fake-zoom-access-${crypto.randomBytes(4).toString('hex')}`, token_type: 'bearer', expires_in: 3600, scope: 'meeting:write:admin' });
    }
    if (p === '/zoom/v2/users/me' && req.method === 'GET') {
        if (injectedFailure('zoom', res)) return;
        return send(res, 200, { id: 'zoomfakeuser1', email: 'host@fake.test', account_id: 'fakeacct' });
    }
    const zu = /^\/zoom\/v2\/users\/([^/]+)\/meetings$/.exec(p);
    if (zu && req.method === 'POST') {
        if (injectedFailure('zoom', res)) return;
        const id = 8_100_000_000 + ++seq;
        const m = {
            id, uuid: crypto.randomUUID(), topic: body?.topic || '', type: body?.type ?? 2, start_time: body?.start_time, duration: body?.duration,
            join_url: `https://fake.zoom.us/j/${id}?pwd=fakepwd${seq}`, start_url: `https://fake.zoom.us/s/${id}?zak=fakezak`, password: `pw${seq}`,
            settings: { global_dial_in_numbers: [{ country_name: 'Peru', number: '+51 1 700 0000', country: 'PE' }] },
        };
        zoomMeetings.set(String(id), m);
        return send(res, 201, m);
    }
    const zm = /^\/zoom\/v2\/meetings\/([^/]+)$/.exec(p);
    if (zm) {
        if (injectedFailure('zoom', res)) return;
        const cur = zoomMeetings.get(zm[1]);
        if (!cur) return send(res, 404, { code: 3001, message: 'Meeting does not exist' });
        if (req.method === 'DELETE') { zoomMeetings.delete(zm[1]); return send(res, 204); }
        if (req.method === 'PATCH') { Object.assign(cur, body || {}); return send(res, 204); }
        return send(res, 200, cur);
    }

    send(res, 404, { error: 'not found', path: p });
});

server.listen(port, '127.0.0.1', () => console.log(`fake-conferencing en http://127.0.0.1:${port}`));
const bye = () => server.close(() => process.exit(0));
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
