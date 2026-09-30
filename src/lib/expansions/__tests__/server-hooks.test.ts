import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    buildPreSendContext,
    callBackendHooks,
    interpretPreSendResponse,
    runEmailPreSendHooks,
    runEmailReceivedHooks,
} from '../server-hooks';

const json = (body: any, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as any;

const savedEnv = { ...process.env };
beforeEach(() => {
    delete process.env.EXTENSION_HOOKS_DISABLED;
    delete process.env.EXTENSION_HOOKS_FAIL_CLOSED;
    delete process.env.EXTENSION_HOOKS_SECRET;
    delete process.env.INTERNAL_SECRET;
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
    it('envia JWT, dominio y evento al backend', async () => {
        const fetchImpl = vi.fn(async () => json({ success: true, stop: false }));
        await callBackendHooks('EMAIL_PRE_SEND', { subject: 's' }, { fetchImpl: fetchImpl as any, backendUrl: 'https://be.example.com/', token: 'jwt123', host: 'mail.acme.com:3000', userId: 'u1' });
        const [url, init] = fetchImpl.mock.calls[0] as any;
        expect(url).toBe('https://be.example.com/api/extension/hooks');
        expect(init.headers.Authorization).toBe('Bearer jwt123');
        expect(init.headers['X-BloomX-Domain']).toBe('mail.acme.com');
        expect(JSON.parse(init.body)).toEqual({ event: 'EMAIL_PRE_SEND', context: { subject: 's' } });
    });

    it('modo interno usa x-internal-secret y no manda JWT', async () => {
        process.env.EXTENSION_HOOKS_SECRET = 'sh';
        const fetchImpl = vi.fn(async () => json({ results: [] }));
        await callBackendHooks('EMAIL_RECEIVED', {}, { fetchImpl: fetchImpl as any, backendUrl: 'https://be', internal: true, host: 'acme.com' });
        const init = (fetchImpl.mock.calls[0] as any)[1];
        expect(init.headers['x-internal-secret']).toBe('sh');
        expect(init.headers.Authorization).toBeUndefined();
    });

    it('modo interno sin secreto configurado falla cerrado', async () => {
        await expect(callBackendHooks('EMAIL_RECEIVED', {}, { fetchImpl: vi.fn() as any, internal: true })).rejects.toThrow(/secret/);
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
    it('devuelve cuantos hooks corrieron y nunca lanza', async () => {
        process.env.EXTENSION_HOOKS_SECRET = 'sh';
        const ok = await runEmailReceivedHooks({ emailId: 'e1', userId: 'u1', domain: 'acme.com' }, { fetchImpl: (async () => json({ results: [{}, {}] })) as any, backendUrl: 'https://be' });
        expect(ok).toEqual({ executed: 2 });

        const failed = await runEmailReceivedHooks({ emailId: 'e1', userId: 'u1' }, { fetchImpl: (async () => { throw new Error('x'); }) as any, backendUrl: 'https://be' });
        expect(failed).toBeNull();
    });
});
