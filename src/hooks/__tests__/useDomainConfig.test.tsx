// @vitest-environment jsdom
/**
 * useDomainConfig: "no se pudo cargar" (red, timeout, 5xx, JSON invalido) es DISTINTO de "sin extensiones"; se conserva el ultimo
 * valor bueno (stale-while-error); reintento manual y automatico con backoff acotado; recuperacion.
 */
import React, { act } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, installCleanup, mount } from '@/components/expansions/kit/__tests__/harness';
import {
    CONFIG_MAX_RETRIES, DomainConfigError, computeRetryDelayMs, fetchDomainConfig, hasExtensionsList, useDomainConfig,
} from '../useDomainConfig';

const res = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as any;
const good = (extensions: any[] = [{ id: 'zoom', name: 'Zoom', template: { id: 'zoom' } }]) => ({ config: { id: 'd1', name: 'acme.com', displayName: 'Acme', logo: null, theme: {} }, extensions });

// ---------------------------------------------------------------------------------------------------------------
describe('fetchDomainConfig', () => {
    it('200 valido: devuelve los datos; una lista vacia es una respuesta BUENA ("sin extensiones")', async () => {
        const data = await fetchDomainConfig('/api/config', { fetchImpl: (async () => res(good([]))) as any });
        expect(hasExtensionsList(data)).toBe(true);
        expect(data.extensions).toEqual([]);
    });

    it('500/502/503: error http reintentable con su estado', async () => {
        for (const status of [500, 502, 503]) {
            const error = await fetchDomainConfig('/api/config', { fetchImpl: (async () => res({ error: 'x' }, status)) as any }).catch((e) => e);
            expect(error).toBeInstanceOf(DomainConfigError);
            expect(error).toMatchObject({ kind: 'http', status, retryable: true });
        }
    });

    it('400/404: error http NO reintentable; 408 y 429 si', async () => {
        for (const status of [400, 401, 403, 404]) {
            const error = await fetchDomainConfig('/api/config', { fetchImpl: (async () => res({}, status)) as any }).catch((e) => e);
            expect(error.retryable).toBe(false);
        }
        for (const status of [408, 429]) {
            const error = await fetchDomainConfig('/api/config', { fetchImpl: (async () => res({}, status)) as any }).catch((e) => e);
            expect(error.retryable).toBe(true);
        }
    });

    it('fallo de red => kind network', async () => {
        const error = await fetchDomainConfig('/api/config', { fetchImpl: (async () => { throw new TypeError('Failed to fetch'); }) as any }).catch((e) => e);
        expect(error).toMatchObject({ kind: 'network', retryable: true });
    });

    it('timeout: aborta la peticion y devuelve kind timeout', async () => {
        const hang = (_url: string, init: any) => new Promise((_ok, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
        const error = await fetchDomainConfig('/api/config', { fetchImpl: hang as any, timeoutMs: 15 }).catch((e) => e);
        expect(error).toMatchObject({ kind: 'timeout', retryable: true });
    });

    it('JSON invalido o de forma inesperada => kind invalid (nunca un config vacio "bueno")', async () => {
        const badJson = { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } } as any;
        expect(await fetchDomainConfig('/api/config', { fetchImpl: (async () => badJson) as any }).catch((e) => e)).toMatchObject({ kind: 'invalid' });
        for (const body of [null, [], 'x', {}, { config: null }, { config: [] }, { config: {}, extensions: 'zoom' }, { extensions: [] }]) {
            const error = await fetchDomainConfig('/api/config', { fetchImpl: (async () => res(body)) as any }).catch((e) => e);
            expect(error, JSON.stringify(body)).toMatchObject({ kind: 'invalid' });
        }
    });
});

describe('computeRetryDelayMs (backoff acotado)', () => {
    it('crece 1 s, 2 s, 4 s, 8 s, 16 s y se detiene al agotar los intentos', () => {
        const zero = () => 0;
        const delays = Array.from({ length: CONFIG_MAX_RETRIES }, (_, i) => computeRetryDelayMs(i, new DomainConfigError('network', 'x'), zero));
        expect(delays).toEqual([1000, 2000, 4000, 8000, 16000]);
        expect(computeRetryDelayMs(CONFIG_MAX_RETRIES, new DomainConfigError('network', 'x'), zero)).toBeNull();
    });
    it('el jitter no supera 250 ms y un error no reintentable no reintenta', () => {
        const d = computeRetryDelayMs(0, new DomainConfigError('network', 'x'), () => 0.999)!;
        expect(d).toBeGreaterThanOrEqual(1000);
        expect(d).toBeLessThan(1250);
        expect(computeRetryDelayMs(0, new DomainConfigError('http', 'x', 404))).toBeNull();
        expect(computeRetryDelayMs(0, new DomainConfigError('http', 'x', 503))).not.toBeNull();
    });
});

// ---------------------------------------------------------------------------------------------------------------
type Snapshot = ReturnType<typeof useDomainConfig>;
let last: Snapshot;
function Probe() {
    last = useDomainConfig();
    return (
        <div>
            <span data-testid="state">{last.isLoading ? 'loading' : last.isError ? 'error' : 'ok'}</span>
            <span data-testid="exts">{last.extensions.map((e: any) => e.id).join(',')}</span>
            <span data-testid="loaded">{String(last.extensionsLoaded)}</span>
            <span data-testid="stale">{String(last.isStale)}</span>
            <span data-testid="kind">{last.error?.kind ?? ''}</span>
            <button type="button" onClick={last.retry}>retry</button>
        </div>
    );
}
const text = (id: string) => document.querySelector(`[data-testid="${id}"]`)?.textContent;
const app = () => <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryInterval: 0 }}><Probe /></SWRConfig>;
async function settle() { for (let i = 0; i < 4; i++) await flush(); }
/** Como settle() pero con temporizadores simulados (flush usa setTimeout real). */
async function settleFake() { await act(async () => { for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(0); }); }

describe('useDomainConfig', () => {
    installCleanup();
    beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
    afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
    const fetchMock = () => globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

    it('respuesta buena con extensiones: estado ok y lista cargada', async () => {
        fetchMock().mockResolvedValue(res(good()));
        await mount(app());
        await settle();
        expect(text('state')).toBe('ok');
        expect(text('exts')).toBe('zoom');
        expect(text('loaded')).toBe('true');
        expect(last.isError).toBe(false);
        expect(last.error).toBeNull();
    });

    it('"sin extensiones" (200 con lista vacia) NO es un error', async () => {
        fetchMock().mockResolvedValue(res(good([])));
        await mount(app());
        await settle();
        expect(text('state')).toBe('ok');
        expect(text('loaded')).toBe('true');
        expect(text('exts')).toBe('');
        expect(last.isError).toBe(false);
    });

    it('500 en la primera carga: error (no "sin extensiones"), lista NO cargada; el boton reintenta y se recupera', async () => {
        fetchMock().mockResolvedValueOnce(res({ error: 'boom' }, 500)).mockResolvedValue(res(good()));
        await mount(app());
        await settle();
        expect(text('state')).toBe('error');
        expect(text('loaded')).toBe('false');
        expect(text('kind')).toBe('http');
        expect(last.error?.status).toBe(500);
        expect(last.extensions).toEqual([]);

        await act(async () => { (document.querySelector('button') as HTMLButtonElement).click(); });
        await settle();
        expect(text('state')).toBe('ok');
        expect(text('exts')).toBe('zoom');
        expect(last.isError).toBe(false);
    });

    it('JSON invalido => error kind invalid', async () => {
        fetchMock().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } });
        await mount(app());
        await settle();
        expect(text('state')).toBe('error');
        expect(text('kind')).toBe('invalid');
    });

    it('fallo de red => kind network', async () => {
        fetchMock().mockRejectedValue(new TypeError('Failed to fetch'));
        await mount(app());
        await settle();
        expect(text('kind')).toBe('network');
    });

    it('stale-while-error: si ya habia datos buenos y la recarga falla, se CONSERVAN (isStale) y se recupera al reintentar', async () => {
        fetchMock().mockResolvedValueOnce(res(good())).mockResolvedValueOnce(res({}, 503)).mockResolvedValue(res(good([{ id: 'giphy', template: { id: 'giphy' } }])));
        await mount(app());
        await settle();
        expect(text('exts')).toBe('zoom');

        await act(async () => { (document.querySelector('button') as HTMLButtonElement).click(); });
        await settle();
        expect(text('state')).toBe('error');
        expect(text('stale')).toBe('true');
        expect(text('exts')).toBe('zoom');
        expect(text('loaded')).toBe('true');

        await act(async () => { (document.querySelector('button') as HTMLButtonElement).click(); });
        await settle();
        expect(text('state')).toBe('ok');
        expect(text('stale')).toBe('false');
        expect(text('exts')).toBe('giphy');
    });

    it('precarga del servidor SIN lista de extensiones: no es "sin extensiones" (extensionsLoaded=false hasta que llega /api/config)', async () => {
        let resolve!: (v: any) => void;
        fetchMock().mockReturnValue(new Promise((r) => { resolve = r; }));
        const initial = { config: { name: 'acme.com', displayName: 'Acme', logo: null, theme: {} } };
        await mount(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, fallback: { '/api/config': initial } }}><Probe /></SWRConfig>);
        await flush();
        expect(last.config.displayName).toBe('Acme');
        expect(last.isLoading).toBe(false);
        expect(text('loaded')).toBe('false');
        await act(async () => { resolve(res(good([]))); });
        await settle();
        expect(text('loaded')).toBe('true');
    });

    it('reintento AUTOMATICO con backoff: tras el primer fallo vuelve a pedir a los ~1 s sin intervencion', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        fetchMock().mockResolvedValueOnce(res({}, 500)).mockResolvedValue(res(good()));
        await mount(app());
        await settleFake();
        expect(text('state')).toBe('error');
        expect(fetchMock()).toHaveBeenCalledTimes(1);

        await act(async () => { await vi.advanceTimersByTimeAsync(500); });
        expect(fetchMock()).toHaveBeenCalledTimes(1);
        await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
        await settleFake();
        expect(fetchMock()).toHaveBeenCalledTimes(2);
        expect(text('state')).toBe('ok');
    });

    it('un 404 (no reintentable) no dispara reintentos automaticos', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        fetchMock().mockResolvedValue(res({}, 404));
        await mount(app());
        await settleFake();
        await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
        expect(fetchMock()).toHaveBeenCalledTimes(1);
        expect(text('state')).toBe('error');
    });
});
