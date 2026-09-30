import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { __setAuditSink, auditLog, maskEmail, redactAuditData, type AuditRecord } from '../audit';
import { inboundEmailPrefix, sanitizeKeyFilename, uniqueAttachmentKey } from '../attachment-keys';
import { avShouldBlock, parseAvResponse, scanBuffer } from '../av-hook';
import {
    ACCOUNT_TOKEN_FIELDS,
    accountRecordNeedsMigration,
    decryptAccountRecord,
    encryptAccountData,
    withAccountTokenEncryption,
} from '../account-tokens';
import { decodeOAuthState, createOAuthState, verifyOAuthState, oauthStateCookieName } from '../oauth-state';
import { detectFormat, encrypt, decrypt } from '../encryption';

const saveEnv = (keys: string[]) => {
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    return () => keys.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
};

// ---------------------------------------------------------------------------------------------------------------------
describe('audit: redaccion y persistencia con fallback', () => {
    let restore = () => {};
    beforeEach(() => {
        restore = saveEnv(['AUDIT_DB']);
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => {
        __setAuditSink(null);
        restore();
        vi.restoreAllMocks();
    });

    it('enmascara emails y elimina secretos', () => {
        expect(maskEmail('juan@dom.com')).toBe('j***@dom.com');
        const out = redactAuditData({ userId: 'u1', email: 'juan@dom.com', password: 'x', accessToken: 't', mfaCode: '123456', recoveryCode: 'A', keyId: 'k1', ip: '1.2.3.4' });
        expect(out).toEqual({ userId: 'u1', email: 'j***@dom.com', keyId: 'k1', ip: '1.2.3.4' });
    });

    it('escribe a stdout y persiste el registro', async () => {
        const seen: AuditRecord[] = [];
        __setAuditSink(async (r) => { seen.push(r); });
        auditLog('auth.login.success', { userId: 'u1', email: 'a@b.com', ip: '9.9.9.9', password: 'no' });
        await new Promise((r) => setTimeout(r, 5));
        expect(console.log).toHaveBeenCalledTimes(1);
        const line = JSON.parse((console.log as any).mock.calls[0][0]);
        expect(line).toMatchObject({ type: 'audit', event: 'auth.login.success', userId: 'u1', email: 'a***@b.com' });
        expect(JSON.stringify(line)).not.toContain('no');
        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatchObject({ event: 'auth.login.success', userId: 'u1', ip: '9.9.9.9' });
        expect(seen[0].data).not.toHaveProperty('password');
    });

    it('si la BD falla sigue a stdout, no lanza y abre el circuit breaker', async () => {
        const sink = vi.fn(async () => { throw new Error('db down'); });
        __setAuditSink(sink);
        for (let i = 0; i < 8; i++) {
            expect(() => auditLog('x.y', { i })).not.toThrow();
            await new Promise((r) => setTimeout(r, 2)); // deja que el fallo se contabilice antes del siguiente evento
        }
        expect(console.log).toHaveBeenCalledTimes(8); // stdout siempre
        expect(sink.mock.calls.length).toBe(5); // tras 5 fallos deja de intentar durante el enfriamiento
    });

    it('AUDIT_DB=off no persiste', async () => {
        process.env.AUDIT_DB = 'off';
        const sink = vi.fn(async () => undefined);
        __setAuditSink(sink);
        auditLog('a.b');
        await new Promise((r) => setTimeout(r, 5));
        expect(sink).not.toHaveBeenCalled();
        expect(console.log).toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('claves de adjuntos unicas (colision de nombres)', () => {
    it('el segundo adjunto con el mismo nombre recibe sufijo unico y conserva la extension', () => {
        const used = new Set<string>();
        const k1 = uniqueAttachmentKey('emails/2026-09-29/u1/attachments', 'foto.jpg', used);
        const k2 = uniqueAttachmentKey('emails/2026-09-29/u1/attachments', 'foto.jpg', used);
        const k3 = uniqueAttachmentKey('emails/2026-09-29/u1/attachments', 'FOTO.JPG', used); // sin distinguir mayusculas
        expect(k1).toBe('emails/2026-09-29/u1/attachments/foto.jpg');
        expect(k2).toMatch(/^emails\/2026-09-29\/u1\/attachments\/foto-[0-9a-f]{8}\.jpg$/);
        expect(k3).toMatch(/FOTO-[0-9a-f]{8}\.JPG$/);
        expect(new Set([k1, k2, k3].map((k) => k.toLowerCase())).size).toBe(3);
    });

    it('nombres sin extension y claves ya existentes en BD', () => {
        const used = new Set<string>(['emails/d/u/attachments/readme']);
        expect(uniqueAttachmentKey('emails/d/u/attachments', 'readme', used)).toMatch(/readme-[0-9a-f]{8}$/);
    });

    it('sanea nombres peligrosos (separadores, ..., control, longitud)', () => {
        expect(sanitizeKeyFilename('../../etc/passwd')).toBe('_._etc_passwd');
        expect(sanitizeKeyFilename('a/b\\c.txt')).toBe('a_b_c.txt');
        expect(sanitizeKeyFilename('\u0000\u0001x.pdf')).toBe('x.pdf');
        expect(sanitizeKeyFilename('')).toBe('attachment');
        const long = sanitizeKeyFilename('a'.repeat(400) + '.pdf');
        expect(long.length).toBeLessThanOrEqual(150);
        expect(long.endsWith('.pdf')).toBe(true);
    });

    it('prefijo de correo entrante', () => {
        expect(inboundEmailPrefix('emails/2026-09-29/abc/attachments/x.pdf')).toBe('emails/2026-09-29/abc');
        expect(inboundEmailPrefix('attachments/a@b.com/x.png')).toBeNull();
        expect(inboundEmailPrefix(null)).toBeNull();
    });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('hook de antivirus', () => {
    let restore = () => {};
    beforeEach(() => {
        restore = saveEnv(['AV_SCAN_URL', 'AV_FAIL_MODE', 'AV_SCAN_MAX_BYTES', 'AV_SCAN_TOKEN']);
        delete process.env.AV_SCAN_URL;
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        __setAuditSink(async () => undefined);
    });
    afterEach(() => {
        restore();
        __setAuditSink(null);
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('sin AV_SCAN_URL: skipped y nunca bloquea', async () => {
        const r = await scanBuffer(Buffer.from('x'), 'a.txt');
        expect(r.status).toBe('skipped');
        expect(avShouldBlock(r)).toBe(false);
    });

    it('interpreta respuestas tipicas de servicios ClamAV REST', () => {
        expect(parseAvResponse('{"Status":"OK","Description":""}').infected).toBe(false);
        expect(parseAvResponse('{"Status":"FOUND","Description":"Eicar-Test-Signature"}')).toEqual({ infected: true, signature: 'Eicar-Test-Signature' });
        expect(parseAvResponse('{"data":{"result":[{"name":"a","is_infected":true,"viruses":["Win.Test"]}]}}')).toEqual({ infected: true, signature: 'Win.Test' });
        expect(parseAvResponse('stream: Eicar-Test-Signature FOUND\n')).toEqual({ infected: true, signature: 'Eicar-Test-Signature' });
        expect(parseAvResponse('stream: OK')).toEqual({ infected: false });
    });

    it('infectado => bloquea; error => abre por defecto y cierra con AV_FAIL_MODE=closed', async () => {
        process.env.AV_SCAN_URL = 'http://av.local/scan';
        vi.stubGlobal('fetch', vi.fn(async () => new Response('{"Status":"FOUND","Description":"Eicar"}', { status: 200, headers: { 'content-type': 'application/json' } })));
        const bad = await scanBuffer(Buffer.from('x'), 'e.txt');
        expect(bad).toMatchObject({ status: 'infected', signature: 'Eicar' });
        expect(avShouldBlock(bad)).toBe(true);

        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom'); }));
        const err = await scanBuffer(Buffer.from('x'), 'e.txt');
        expect(err.status).toBe('error');
        expect(avShouldBlock(err)).toBe(false);
        process.env.AV_FAIL_MODE = 'closed';
        expect(avShouldBlock(err)).toBe(true);
    });

    it('limpio y archivos demasiado grandes', async () => {
        process.env.AV_SCAN_URL = 'http://av.local/scan';
        const fetchMock = vi.fn(async () => new Response('{"Status":"OK"}', { status: 200, headers: { 'content-type': 'application/json' } }));
        vi.stubGlobal('fetch', fetchMock);
        expect((await scanBuffer(Buffer.from('x'), 'a.txt')).status).toBe('clean');
        process.env.AV_SCAN_MAX_BYTES = '4';
        expect((await scanBuffer(Buffer.from('demasiado grande'), 'a.txt')).status).toBe('skipped');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('cifrado de tokens OAuth de Account (capa de acceso)', () => {
    let restore = () => {};
    beforeEach(() => {
        restore = saveEnv(['DATA_ENCRYPTION_KEY', 'NEXTAUTH_SECRET', 'ACCOUNT_TOKENS_LAZY_MIGRATE', 'ENCRYPTION_WRITE_FORMAT']);
        process.env.DATA_ENCRYPTION_KEY = 'clave-de-pruebas';
        delete process.env.ENCRYPTION_WRITE_FORMAT;
    });
    afterEach(() => restore());

    it('cifra los tres campos y respeta el resto; no cifra dos veces', () => {
        const data = { access_token: 'ya29.abc', refresh_token: '1//0gxyz', id_token: 'eyJ.x.y', scope: 'a b', expires_at: 5 };
        const enc = encryptAccountData(data);
        for (const f of ACCOUNT_TOKEN_FIELDS) expect(detectFormat((enc as any)[f]).format).toBe('v3');
        expect(enc.scope).toBe('a b');
        expect(enc.expires_at).toBe(5);
        expect(data.access_token).toBe('ya29.abc'); // no muta
        expect(encryptAccountData(enc).access_token).toBe(enc.access_token);
        expect(encryptAccountData({ refresh_token: { set: 'r1' } } as any).refresh_token.set).toMatch(/^v3:/);
        expect(encryptAccountData({ refresh_token: null } as any).refresh_token).toBeNull();
    });

    it('lee ambos formatos: cifrado y texto plano heredado', () => {
        const enc = encryptAccountData({ access_token: 'ya29.abc', refresh_token: 'ref' });
        expect(decryptAccountRecord(enc)).toMatchObject({ access_token: 'ya29.abc', refresh_token: 'ref' });
        expect(decryptAccountRecord({ access_token: 'en-claro', refresh_token: null })).toMatchObject({ access_token: 'en-claro', refresh_token: null });
    });

    it('un token cifrado que no se puede descifrar (clave equivocada) se devuelve como null', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const enc = encryptAccountData({ refresh_token: 'ref' });
        process.env.DATA_ENCRYPTION_KEY = 'otra-clave';
        delete process.env.NEXTAUTH_SECRET;
        expect(decryptAccountRecord(enc).refresh_token).toBeNull();
    });

    it('detecta filas que requieren migracion perezosa', () => {
        expect(accountRecordNeedsMigration({ access_token: 'en-claro' })).toBe(true);
        expect(accountRecordNeedsMigration(encryptAccountData({ access_token: 'x' }))).toBe(false);
        expect(accountRecordNeedsMigration({ access_token: null, refresh_token: '' })).toBe(false);
    });

    it('extension de Prisma: cifra al escribir, descifra al leer y migra en segundo plano', async () => {
        const update = vi.fn(async () => ({}));
        let config: any;
        withAccountTokenEncryption({ $extends: (c: any) => { config = c; return c; }, account: { update } } as any);
        const op = config.query.account.$allOperations as (p: any) => Promise<any>;

        // ESCRITURA (upsert: create + update)
        let sent: any;
        await op({ operation: 'upsert', args: { where: {}, create: { access_token: 'a', refresh_token: 'r' }, update: { access_token: 'a2' } }, query: async (a: any) => { sent = a; return { id: '1', ...a.create }; } });
        expect(sent.create.access_token).toMatch(/^v3:/);
        expect(sent.update.access_token).toMatch(/^v3:/);
        expect(decrypt(sent.create.refresh_token)).toBe('r');

        // LECTURA de fila en texto plano => devuelve plano y agenda re-cifrado con el cliente BASE
        const rows = await op({ operation: 'findMany', args: {}, query: async () => [{ id: 'acc1', access_token: 'plano', refresh_token: encrypt('cifrado'), scope: 's' }] });
        expect(rows[0]).toMatchObject({ access_token: 'plano', refresh_token: 'cifrado', scope: 's' });
        await new Promise((r) => setTimeout(r, 5));
        expect(update).toHaveBeenCalledTimes(1);
        const arg = (update.mock.calls[0] as any[])[0];
        expect(arg.where).toEqual({ id: 'acc1' });
        expect(Object.keys(arg.data)).toEqual(['access_token']); // solo lo que estaba en claro
        expect(decrypt(arg.data.access_token)).toBe('plano');

        // count/aggregate pasan sin tocar
        expect(await op({ operation: 'count', args: {}, query: async () => 7 })).toBe(7);
    });

    it('ACCOUNT_TOKENS_LAZY_MIGRATE=false desactiva la escritura en segundo plano', async () => {
        process.env.ACCOUNT_TOKENS_LAZY_MIGRATE = 'false';
        const update = vi.fn(async () => ({}));
        let config: any;
        withAccountTokenEncryption({ $extends: (c: any) => { config = c; return c; }, account: { update } } as any);
        await config.query.account.$allOperations({ operation: 'findFirst', args: {}, query: async () => ({ id: 'x', access_token: 'plano' }) });
        await new Promise((r) => setTimeout(r, 5));
        expect(update).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('OAuth de terceros: state anti-CSRF con nonce en cookie', () => {
    const reqWith = (state: string | null, cookieNonce: string | null, provider = 'slack') =>
        ({
            nextUrl: { searchParams: new URLSearchParams(state ? { state, code: 'c' } : { code: 'c' }) },
            cookies: { get: (n: string) => (cookieNonce && n === oauthStateCookieName(provider) ? { value: cookieNonce } : undefined) },
        }) as unknown as NextRequest;

    it('flujo legitimo', () => {
        const { state, nonce } = createOAuthState('slack', 'user-1');
        expect(decodeOAuthState(state)).toEqual({ p: 'slack', n: nonce, u: 'user-1' });
        expect(verifyOAuthState(reqWith(state, nonce), 'slack', 'user-1')).toEqual({ ok: true });
    });

    it('rechaza: sin state, sin cookie, nonce distinto, otro proveedor u otro usuario', () => {
        const { state, nonce } = createOAuthState('slack', 'user-1');
        expect(verifyOAuthState(reqWith(null, nonce), 'slack').ok).toBe(false);
        expect(verifyOAuthState(reqWith(state, null), 'slack').ok).toBe(false);
        expect(verifyOAuthState(reqWith(state, 'otro-nonce'), 'slack').reason).toBe('nonce_mismatch');
        // state generado para slack usado en el callback de zoom
        expect(verifyOAuthState(reqWith(state, nonce, 'zoom'), 'zoom').reason).toBe('provider_mismatch');
        // callback completado por un usuario distinto del que inicio el flujo (vinculacion forzada)
        expect(verifyOAuthState(reqWith(state, nonce), 'slack', 'user-2').reason).toBe('user_mismatch');
    });

    it('state malformado', () => {
        expect(decodeOAuthState('%%%')).toBeNull();
        expect(decodeOAuthState(Buffer.from('{"p":1}').toString('base64url'))).toBeNull();
        expect(decodeOAuthState('a'.repeat(2000))).toBeNull();
    });

    it('nonces distintos en cada flujo', () => {
        expect(createOAuthState('notion').nonce).not.toBe(createOAuthState('notion').nonce);
    });
});
