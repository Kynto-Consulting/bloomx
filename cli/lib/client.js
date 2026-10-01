'use strict';

const pkg = require('../package.json');

/** Cliente HTTPS de la API de administracion (/api/admin/cli/**). Sin dependencias: fetch nativo de Node 18+. */

class ApiError extends Error {
    constructor(message, { status = 0, code = 'error', data = null } = {}) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.data = data;
    }
}

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Solo HTTPS (HTTP unicamente hacia localhost, para desarrollo). Devuelve el origen sin ruta ni credenciales. */
function normalizeUrl(input) {
    let u;
    try { u = new URL(/^[a-z]+:\/\//i.test(input) ? input : `https://${input}`); } catch { throw new ApiError(`Invalid URL: ${String(input).slice(0, 80)}`); }
    if (u.username || u.password) throw new ApiError('The URL must not contain credentials.');
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOCAL.has(u.hostname))) throw new ApiError('Only https:// URLs are allowed (http:// only for localhost).');
    return u.origin;
}

function anySignal(signals) {
    if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals);
    const c = new AbortController();
    for (const s of signals) {
        if (s.aborted) { c.abort(); break; }
        s.addEventListener('abort', () => c.abort(), { once: true });
    }
    return c.signal;
}

async function request(profile, method, path, { body, headers = {}, signal, raw = false, timeoutMs = 70_000, auth = true } = {}) {
    const url = `${profile.url}${path}`;
    const h = { 'User-Agent': `bloomx-cli/${pkg.version}`, Accept: 'application/json', ...headers };
    if (auth && profile.token) h.Authorization = `Bearer ${profile.token}`;
    if (body !== undefined && !(body instanceof Uint8Array) && typeof body !== 'string') { h['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    const timeout = AbortSignal.timeout(timeoutMs);
    const sig = signal ? anySignal([signal, timeout]) : timeout;
    let res;
    try {
        // redirect: 'manual' => jamas se reenvia el token a otro destino
        res = await fetch(url, { method, headers: h, body, signal: sig, redirect: 'manual' });
    } catch (e) {
        if (signal && signal.aborted) throw new ApiError('Cancelled', { code: 'cancelled' });
        throw new ApiError(`Could not reach ${profile.url} (${e && e.cause && e.cause.code ? e.cause.code : e.name === 'TimeoutError' ? 'timeout' : 'network error'}).`, { code: 'network' });
    }
    if (res.status >= 300 && res.status < 400) throw new ApiError(`Unexpected redirect from ${profile.url}. Check the URL (it must be the instance origin).`, { status: res.status, code: 'redirect' });
    if (raw) return { status: res.status, res };
    let data = null;
    try { data = await res.json(); } catch { /* sin cuerpo */ }
    return { status: res.status, data, headers: res.headers };
}

const isEs = () => ((process.env.BLOOMX_LANG || process.env.LC_ALL || process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale || 'en').toLowerCase().startsWith('es'));
const T = (es, en) => (isEs() ? es : en);

/** Cuando/desde donde termino la sesion (para superseded / expired). */
function where(data) {
    if (!data || !data.at) return '';
    const bits = [data.byKind === 'cli' ? 'CLI' : data.byKind === 'web' ? 'web' : null, data.byDevice, data.byIp, String(data.at).replace('T', ' ').replace(/.d+Z$/, 'Z')].filter(Boolean);
    return bits.length ? ` (${bits.join(' · ')})` : '';
}

function authError(status, data) {
    const code = (data && data.code) || (status === 401 ? 'unauthorized' : 'forbidden');
    if (code === 'superseded') return new ApiError(T(`Tu sesión de administración se cerró porque iniciaste otra${where(data)}. Vuelve a iniciar sesión: bloomx login <url>`, `Your administration session was closed because you started another${where(data)}. Sign in again: bloomx login <url>`), { status, code, data });
    if (code === 'expired') return new ApiError(T(`Tu sesión de administración caducó${data && data.reason === 'expired_absolute' ? ' (tiempo máximo de 12 h)' : ' por inactividad'}. Vuelve a iniciar sesión: bloomx login <url>`, `Your administration session expired${data && data.reason === 'expired_absolute' ? ' (12 h maximum)' : ' due to inactivity'}. Sign in again: bloomx login <url>`), { status, code, data });
    if (code === 'locked') return new ApiError(T('El acceso privilegiado de esta cuenta está BLOQUEADO por reemplazos de sesión repetidos. Un superadministrador debe desbloquearlo (perms unlock). Cambia tu contraseña y cierra todas las sesiones.', 'Privileged access for this account is LOCKED because of repeated session replacements. A super administrator must unlock it (perms unlock). Change your password and sign out of all sessions.'), { status, code, data });
    const hints = {
        token_expired: 'Your token expired. Run: bloomx login <url>',
        token_revoked: 'Your token was revoked. Run: bloomx login <url>',
        token_unknown: 'Unknown token. Run: bloomx login <url>',
        not_admin: 'This account is no longer an administrator of the instance.',
        domain_mismatch: 'This token belongs to another domain.',
        domain_not_owned: 'This account does not manage this domain.',
    };
    return new ApiError(hints[code] || (data && data.error) || (status === 401 ? 'Unauthorized' : 'Forbidden'), { status, code, data });
}

async function exec(profile, payload, signal) {
    const { status, data } = await request(profile, 'POST', '/api/admin/cli/exec', { body: payload, signal });
    if (status === 401 || status === 403) throw authError(status, data);
    if (status === 429 && data && data.error) return data;
    if (!data || typeof data !== 'object' || (status >= 500)) throw new ApiError(`Server error (HTTP ${status}).`, { status, code: 'server' });
    return data;
}

async function complete(profile, line, locale, signal) {
    const q = new URLSearchParams({ line, locale });
    const { status, data } = await request(profile, 'GET', `/api/admin/cli/complete?${q}`, { signal, timeoutMs: 8000 });
    if (status !== 200 || !data) return { prefix: '', candidates: [] };
    return data;
}

async function reauth(profile, body, signal) {
    const { status, data } = await request(profile, 'POST', '/api/admin/cli/reauth', { body, signal });
    if (status === 200 && data && data.stepUp) return data;
    throw new ApiError((data && data.error) || 'Re-authentication failed', { status, code: (data && data.code) || 'reauth_failed', data });
}

async function login(profile, body) {
    const { status, data } = await request(profile, 'POST', '/api/admin/cli/login', { body, auth: false });
    return { status, data };
}

async function logout(profile) {
    try { const { status } = await request(profile, 'POST', '/api/admin/cli/logout', { body: {}, timeoutMs: 10_000 }); return status === 200; } catch { return false; }
}

module.exports = { ApiError, normalizeUrl, request, exec, complete, reauth, login, logout, authError };
