import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

/**
 * public/sw.js es un script clasico (no importable). Se ejecuta en un contexto aislado con un `self`
 * falso y se prueba la politica de cache que expone en `self.__SW_POLICY__`.
 */
type Policy = {
    classifyRequest: (req: any, url: URL, origin: string) => 'skip' | 'navigate' | 'static';
    isCacheableResponse: (res: any) => boolean;
    PRECACHE_URLS: string[];
};

function loadPolicy(): Policy {
    const source = readFileSync(path.resolve(__dirname, '../../../public/sw.js'), 'utf8');
    const self: any = { addEventListener: () => {}, location: { origin: 'https://app.test' } };
    vm.runInNewContext(source, { self, URL, Response, caches: {}, fetch: () => {} });
    return self.__SW_POLICY__;
}

const ORIGIN = 'https://app.test';
const req = (pathname: string, init: { method?: string; mode?: string; headers?: Record<string, string> } = {}) => {
    const headers = new Headers(init.headers || {});
    return {
        request: { method: init.method || 'GET', mode: init.mode || 'no-cors', headers },
        url: new URL(pathname, ORIGIN),
    };
};

describe('service worker: politica de cache', () => {
    const policy = loadPolicy();
    const classify = (pathname: string, init?: Parameters<typeof req>[1]) => {
        const r = req(pathname, init);
        return policy.classifyRequest(r.request, r.url, ORIGIN);
    };

    it('cachea solo estaticos del shell', () => {
        expect(classify('/_next/static/chunks/app-123.js')).toBe('static');
        expect(classify('/icon-192.png')).toBe('static');
    });

    it('nunca intercepta /api ni respuestas autenticadas', () => {
        expect(classify('/api/emails')).toBe('skip');
        expect(classify('/api/auth/me')).toBe('skip');
        expect(classify('/_next/static/x.js', { headers: { authorization: 'Bearer abc' } })).toBe('skip');
    });

    it('no intercepta metodos distintos de GET, RSC ni otros origenes', () => {
        expect(classify('/api/emails', { method: 'POST' })).toBe('skip');
        expect(classify('/inbox?_rsc=abc')).toBe('skip');
        expect(classify('/inbox', { headers: { rsc: '1' } })).toBe('skip');
        const other = req('/_next/static/x.js');
        expect(policy.classifyRequest(other.request, new URL('https://cdn.other/_next/static/x.js'), ORIGIN)).toBe('skip');
    });

    it('las navegaciones usan el fallback offline (sin cachear HTML)', () => {
        expect(classify('/', { mode: 'navigate' })).toBe('navigate');
        expect(classify('/calendar', { mode: 'navigate' })).toBe('navigate');
        expect(classify('/api/emails', { mode: 'navigate' })).toBe('skip');
    });

    it('otros recursos (p. ej. /app.json) no se cachean', () => {
        expect(classify('/some/data.json')).toBe('skip');
    });

    it('solo guarda respuestas 200, basicas, sin no-store/private ni redireccion', () => {
        const ok = (init: { status?: number; headers?: Record<string, string> } = {}, extra: Record<string, unknown> = {}) => {
            const res: any = new Response('x', { status: init.status ?? 200, headers: init.headers });
            for (const [k, v] of Object.entries({ type: 'basic', redirected: false, ...extra })) Object.defineProperty(res, k, { value: v });
            return res;
        };
        expect(policy.isCacheableResponse(ok({ headers: { 'cache-control': 'public, max-age=31536000, immutable' } }))).toBe(true);
        expect(policy.isCacheableResponse(ok({ headers: { 'cache-control': 'no-store' } }))).toBe(false);
        expect(policy.isCacheableResponse(ok({ headers: { 'cache-control': 'private, max-age=0' } }))).toBe(false);
        expect(policy.isCacheableResponse(ok({ status: 500 }))).toBe(false);
        expect(policy.isCacheableResponse(ok({}, { redirected: true }))).toBe(false);
        expect(policy.isCacheableResponse(ok({}, { type: 'opaque' }))).toBe(false);
    });

    it('precachea la pagina offline', () => {
        expect(policy.PRECACHE_URLS).toContain('/offline.html');
    });
});
