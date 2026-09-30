import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    buildPreSendContext,
    callBackendHooks,
    interpretPreSendResponse,
    runEmailPreSendHooks,
    runEmailReceivedHooks,
} from '../server-hooks';
import { canonicalString, generateEd25519KeyPair, parseEd25519PublicKey, sha256Hex, verifyCanonical } from '@/lib/bloomx-signature';

const json = (body: any, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as any;

const savedEnv = { ...process.env };
beforeEach(() => {
    delete process.env.EXTENSION_HOOKS_DISABLED;
    delete process.env.EXTENSION_HOOKS_FAIL_CLOSED;
    delete process.env.EXTENSION_HOOKS_SECRET;
    delete process.env.INTERNAL_SECRET;
    delete process.env.BLOOMX_DOMAIN_PRIVATE_KEY;
    delete process.env.NEXT_PUBLIC_APP_URL;
    vi.spyOn(console, 'error').mockImplementation(() => { });
});
afterEach(() => {
    process.env = { ...savedEnv };
    vi.restoreAllMocks();
});

describe('interpretPreSendResponse', () => {
    it('stop:true bloquea con el mensaje de la extension', () => {
        expect(interpretPreSendResponse({ stop: true, message: 'DLP Violation: password' })).toMatchObject({ stop: true, message: 'DLP Violation: password' });
    });

    it('stop sin mensaje usa uno generico; sin stop no bloquea', () => {
        expect(interpretPreSendResponse({ stop: true }).message).toMatch(/blocked/i);
        expect(interpretPreSendResponse({ stop: false, message: 'x' }).stop).toBe(false);
        expect(interpretPreSendResponse(null)).toEqual({ stop: false, warnings: [], modify: {} });
    });

    it('modify solo admite subject/html/text como string (nunca destinatarios)', () => {
        const r = interpretPreSendResponse({ modify: { subject: 'S', html: '<p>x</p>', text: 5, to: ['evil@x.com'], from: 'a@b.c' } });
        expect(r.modify).toEqual({ subject: 'S', html: '<p>x</p>' });
    });

    it('warnings: solo strings y con tope', () => {
        const r = interpretPreSendResponse({ warnings: ['a', 1, 'b', ...Array(20).fill('z')] });
        expect(r.warnings.length).toBe(10);
        expect(r.warnings.slice(0, 2)).toEqual(['a', 'b']);
    });
});

describe('buildPreSendContext', () => {
    it('expone lo que lee DLP: subject, emailContent y nombres de adjuntos', () => {
        const ctx: any = buildPreSendContext({ subject: 'Asunto', html: '<p>hola</p>', text: 'hola', to: ['a@x.com'], attachments: [{ filename: 'a.pdf' }, {}] });
        expect(ctx.subject).toBe('Asunto');
        expect(ctx.emailContent).toBe('<p>hola</p>\nhola');
        expect(ctx.attachments).toEqual([{ filename: 'a.pdf' }, { filename: '' }]);
        expect(ctx.to).toEqual(['a@x.com']);
    });
});

describe('callBackendHooks', () => {
    it('SIN clave de dominio: protocolo antiguo por cabeceras (legado), sin JWT ni firma', async () => {
        const fetchImpl = vi.fn(async () => json({ success: true, stop: false }));
        await callBackendHooks('EMAIL_PRE_SEND', { subject: 's' }, { fetchImpl: fetchImpl as any, backendUrl: 'https://be.example.com/', token: 'jwt123', host: 'mail.acme.com:3000', userId: 'u1', email: 'a@acme.com' });
        const [url, init] = fetchImpl.mock.calls[0] as any;
        expect(url).toBe('https://be.example.com/api/extension/hooks');
        expect(init.headers.Authorization).toBeUndefined();
        expect(JSON.stringify(init.headers)).not.toContain('jwt123');
        expect(init.headers['X-BloomX-Domain']).toBe('mail.acme.com');
        expect(init.headers['X-User-ID']).toBe('u1');
        expect(init.headers['X-User-Email']).toBe('a@acme.com');
        expect(init.headers['X-BloomX-Signature']).toBeUndefined();
        expect(JSON.parse(init.body)).toEqual({ event: 'EMAIL_PRE_SEND', context: { subject: 's' } });
    });

    it('CON BLOOMX_DOMAIN_PRIVATE_KEY firma (Ed25519) metodo+ruta+cuerpo+dominio+usuario', async () => {
        const kp = generateEd25519KeyPair();
        process.env.BLOOMX_DOMAIN_PRIVATE_KEY = kp.privatePem;
        const fetchImpl = vi.fn(async () => json({ results: [] }));
        await callBackendHooks('EMAIL_RECEIVED', { emailId: 'e1' }, { fetchImpl: fetchImpl as any, backendUrl: 'https://be/', internal: true, host: 'acme.com', userId: 'u9' });
        const [url, init] = fetchImpl.mock.calls[0] as any;
        expect(init.headers.Authorization).toBeUndefined();
        expect(init.headers['x-internal-secret']).toBeUndefined();
        const canonical = canonicalString({
            method: 'POST',
            pathAndQuery: new URL(url).pathname,
            bodySha256Hex: sha256Hex(init.body),
            domain: 'acme.com',
            timestamp: init.headers['X-BloomX-Timestamp'],
            nonce: init.headers['X-BloomX-Nonce'],
            userId: 'u9',
            userEmail: '',
            callback: init.headers['X-BloomX-Callback'] || '',
        });
        expect(verifyCanonical(parseEd25519PublicKey(kp.publicKey)!, canonical, init.headers['X-BloomX-Signature'])).toBe(true);
    });

    it('modo interno (EMAIL_RECEIVED/CRON) sin clave de dominio no se degrada a legado: lanza', async () => {
        await expect(callBackendHooks('EMAIL_RECEIVED', {}, { fetchImpl: vi.fn() as any, internal: true, host: 'acme.com' })).rejects.toThrow(/signing key/);
    });

    it('respuesta no-2xx lanza', async () => {
        await expect(callBackendHooks('EMAIL_PRE_SEND', {}, { fetchImpl: (async () => json({}, 500)) as any, token: 't' })).rejects.toThrow(/500/);
    });
});

describe('runEmailPreSendHooks: el DLP realmente bloquea o avisa al enviar', () => {
    const msg = { subject: 'x', html: '<p>la password es 1234</p>', to: ['a@x.com'] };

    it('stop:true del backend => stop (la ruta responde 422 y no envia)', async () => {
        const fetchImpl = (async () => json({ success: true, stop: true, message: 'DLP Violation: Found sensitive content: password', results: [] })) as any;
        const r = await runEmailPreSendHooks(msg, { fetchImpl, backendUrl: 'https://be', token: 't' });
        expect(r.stop).toBe(true);
        expect(r.message).toMatch(/DLP Violation/);
    });

    it('avisos y modificaciones se devuelven sin bloquear', async () => {
        const fetchImpl = (async () => json({ stop: false, warnings: ['Revisa el adjunto'], modify: { html: '<p>ok</p>' } })) as any;
        const r = await runEmailPreSendHooks(msg, { fetchImpl, backendUrl: 'https://be', token: 't' });
        expect(r.stop).toBe(false);
        expect(r.warnings).toEqual(['Revisa el adjunto']);
        expect(r.modify.html).toBe('<p>ok</p>');
    });

    it('backend caido: por defecto NO bloquea (fail-open) pero lo marca como no disponible', async () => {
        const fetchImpl = (async () => { throw new Error('ECONNREFUSED'); }) as any;
        const r = await runEmailPreSendHooks(msg, { fetchImpl, backendUrl: 'https://be', token: 't' });
        expect(r.stop).toBe(false);
        expect(r.unavailable).toBe(true);
    });

    it('backend caido con EXTENSION_HOOKS_FAIL_CLOSED=true: bloquea', async () => {
        process.env.EXTENSION_HOOKS_FAIL_CLOSED = 'true';
        const fetchImpl = (async () => json({}, 503)) as any;
        const r = await runEmailPreSendHooks(msg, { fetchImpl, backendUrl: 'https://be', token: 't' });
        expect(r.stop).toBe(true);
        expect(r.unavailable).toBe(true);
    });

    it('EXTENSION_HOOKS_DISABLED=true no llama al backend', async () => {
        process.env.EXTENSION_HOOKS_DISABLED = 'true';
        const fetchImpl = vi.fn();
        const r = await runEmailPreSendHooks(msg, { fetchImpl: fetchImpl as any, token: 't' });
        expect(r.stop).toBe(false);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('no vuelca el contenido del correo en el log de errores', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => { });
        await runEmailPreSendHooks(msg, { fetchImpl: (async () => { throw new Error('boom'); }) as any, token: 't' });
        expect(JSON.stringify(spy.mock.calls)).not.toContain('password');
        expect(JSON.stringify(spy.mock.calls)).not.toContain('a@x.com');
    });
});

describe('runEmailReceivedHooks', () => {
    it('sin clave de dominio se omite en silencio (el backend solo lo admite firmado) y no llama a la red', async () => {
        const fetchImpl = vi.fn();
        expect(await runEmailReceivedHooks({ emailId: 'e1', userId: 'u1', domain: 'acme.com' }, { fetchImpl: fetchImpl as any, backendUrl: 'https://be' })).toBeNull();
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('devuelve cuantos hooks corrieron y nunca lanza', async () => {
        process.env.BLOOMX_DOMAIN_PRIVATE_KEY = generateEd25519KeyPair().privatePem;
        const ok = await runEmailReceivedHooks({ emailId: 'e1', userId: 'u1', domain: 'acme.com' }, { fetchImpl: (async () => json({ results: [{}, {}] })) as any, backendUrl: 'https://be', loadDisabled: async () => [] });
        expect(ok).toEqual({ executed: 2 });

        const failed = await runEmailReceivedHooks({ emailId: 'e1', userId: 'u1' }, { fetchImpl: (async () => { throw new Error('x'); }) as any, backendUrl: 'https://be', loadDisabled: async () => [] });
        expect(failed).toBeNull();
    });
});
