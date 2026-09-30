import { describe, expect, it } from 'vitest';
import { createRawMimeFetcher, isPrivateAddress, isSafeRemoteMimeUrl, rawEmlKey, rawJsonKey, rawMimeMaxBytes, rawObjectKeys, storeRawMimeEnabled } from '../raw-mime';

describe('raw-mime: claves y configuracion', () => {
    it('raw.eml se deriva de raw.json (y viceversa) y solo con la forma esperada', () => {
        expect(rawEmlKey('emails/2024-01-01/abc/raw.json')).toBe('emails/2024-01-01/abc/raw.eml');
        expect(rawEmlKey('emails/2024-01-01/abc/raw.eml')).toBe('emails/2024-01-01/abc/raw.eml');
        expect(rawJsonKey('emails/2024-01-01/abc/raw.eml')).toBe('emails/2024-01-01/abc/raw.json');
        expect(rawEmlKey('otra/cosa.json')).toBeNull();
        expect(rawEmlKey(null)).toBeNull();
        expect(rawObjectKeys('emails/d/u/raw.json')).toEqual(['emails/d/u/raw.json', 'emails/d/u/raw.eml']);
        expect(rawObjectKeys(null)).toEqual([]);
    });
    it('RAW_MIME_MAX_MB (25 por defecto) y MAIL_STORE_RAW_MIME', () => {
        expect(rawMimeMaxBytes({} as any)).toBe(25 * 1024 * 1024);
        expect(rawMimeMaxBytes({ RAW_MIME_MAX_MB: '2.5' } as any)).toBe(Math.floor(2.5 * 1024 * 1024));
        expect(rawMimeMaxBytes({ RAW_MIME_MAX_MB: 'x' } as any)).toBe(25 * 1024 * 1024);
        expect(rawMimeMaxBytes({ RAW_MIME_MAX_MB: '-3' } as any)).toBe(25 * 1024 * 1024);
        expect(storeRawMimeEnabled({} as any)).toBe(true);
        expect(storeRawMimeEnabled({ MAIL_STORE_RAW_MIME: 'false' } as any)).toBe(false);
        expect(storeRawMimeEnabled({ MAIL_STORE_RAW_MIME: 'FALSE' } as any)).toBe(false);
        expect(storeRawMimeEnabled({ MAIL_STORE_RAW_MIME: 'true' } as any)).toBe(true);
    });
});

describe('raw-mime: descarga segura desde rawMimeUrl', () => {
    it('solo https publico sin credenciales', () => {
        expect(isSafeRemoteMimeUrl('https://raw.resend.example/x?sig=1')).not.toBeNull();
        for (const bad of ['http://a.test/x', 'https://u:p@a.test/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://[::1]/x', 'https://169.254.169.254/latest', 'https://x.internal/a', 'file:///etc/passwd', 'ftp://a/b', '', 'no es url']) {
            expect(isSafeRemoteMimeUrl(bad), bad).toBeNull();
        }
        expect(isPrivateAddress('192.168.1.1')).toBe(true);
        expect(isPrivateAddress('8.8.8.8')).toBe(false);
        expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
        expect(isPrivateAddress('fd00::1')).toBe(true);
    });

    const pub = async () => ['203.0.113.7'];
    const body = (n: number) => new Response(new Uint8Array(n).fill(65), { status: 200, headers: { 'content-length': String(n) } });

    it('devuelve el MIME, respeta tope de tamano, timeout, HTTP de error y host que resuelve a IP privada (sin llamar a fetch)', async () => {
        let calls = 0;
        const ok = createRawMimeFetcher({ resolve: pub, fetchImpl: (async () => { calls++; return body(100); }) as any });
        expect((await ok('https://h.test/a'))!.length).toBe(100);
        const tooBig = createRawMimeFetcher({ resolve: pub, maxBytes: 50, fetchImpl: (async () => body(100)) as any });
        expect(await tooBig('https://h.test/a')).toBeNull();
        // sin content-length pero cuerpo mayor que el tope: se corta mientras se lee
        const stream = createRawMimeFetcher({ resolve: pub, maxBytes: 50, fetchImpl: (async () => new Response(new Uint8Array(500).fill(66))) as any });
        expect(await stream('https://h.test/a')).toBeNull();
        const err = createRawMimeFetcher({ resolve: pub, fetchImpl: (async () => new Response('x', { status: 404 })) as any });
        expect(await err('https://h.test/a')).toBeNull();
        const throws = createRawMimeFetcher({ resolve: pub, fetchImpl: (async () => { throw new Error('red'); }) as any });
        expect(await throws('https://h.test/a')).toBeNull();
        calls = 0;
        const priv = createRawMimeFetcher({ resolve: async () => ['10.0.0.9'], fetchImpl: (async () => { calls++; return body(10); }) as any });
        expect(await priv('https://h.test/a')).toBeNull();
        const mixed = createRawMimeFetcher({ resolve: async () => ['203.0.113.7', '127.0.0.1'], fetchImpl: (async () => { calls++; return body(10); }) as any });
        expect(await mixed('https://h.test/a')).toBeNull();
        expect(calls).toBe(0);
        expect(await ok('http://h.test/a')).toBeNull();
    });

    it('timeout: un servidor que no responde no bloquea (se aborta y devuelve null)', async () => {
        const slow = createRawMimeFetcher({
            resolve: pub, timeoutMs: 50,
            fetchImpl: ((_u: string, init: RequestInit) => new Promise((_res, rej) => { init.signal!.addEventListener('abort', () => rej(new Error('abort'))); })) as any,
        });
        const t0 = Date.now();
        expect(await slow('https://h.test/a')).toBeNull();
        expect(Date.now() - t0).toBeLessThan(2000);
    });
});
