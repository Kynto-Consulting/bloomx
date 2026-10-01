import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { compareBuild, needsMandatoryUpdate, shouldAutoReload, nextCheckDelay, parseMinClientApi, serviceWorkerUrl } from '../client-version';
import { hasUnsavedWork } from '../unsaved-work';
import { buildVersionPayload, parseMinClientApiEnv } from '../version-info';
import { CLIENT_API_VERSION } from '@/lib/expansions/client/capabilities';
import { GET } from '@/app/api/version/route';

const base = { newBuild: false, mandatory: false, hasUnsavedWork: false, userAccepted: false };

describe('comparacion de builds', () => {
    it('mismo build -> same; distinto -> newer; sin datos -> same', () => {
        expect(compareBuild('abc', 'abc')).toBe('same');
        expect(compareBuild('abc', 'def')).toBe('newer');
        expect(compareBuild('abc', undefined)).toBe('same');
    });
    it('el aviso solo aparece cuando cambia el build', () => {
        expect(shouldAutoReload({ ...base, newBuild: compareBuild('a', 'a') === 'newer', userAccepted: true })).toBe(false);
    });
});

describe('recarga', () => {
    it('opcional: nunca sola, y no con borrador abierto aunque el usuario pulse', () => {
        expect(shouldAutoReload({ ...base, newBuild: true })).toBe(false);
        expect(shouldAutoReload({ ...base, newBuild: true, userAccepted: true, hasUnsavedWork: true })).toBe(false);
        expect(shouldAutoReload({ ...base, newBuild: true, userAccepted: true })).toBe(true);
    });
    it('obligatoria: recarga siempre', () => {
        expect(needsMandatoryUpdate(1, 2)).toBe(true);
        expect(needsMandatoryUpdate(2, 2)).toBe(false);
        expect(shouldAutoReload({ ...base, mandatory: true, hasUnsavedWork: true })).toBe(true);
    });
    it('detecta trabajo sin guardar', () => {
        expect(hasUnsavedWork([], 0)).toBe(false);
        expect(hasUnsavedWork([{ to: '', subject: '', body: '<p></p>' }], 0)).toBe(false);
        expect(hasUnsavedWork([{ body: '<p>hola</p>' }], 0)).toBe(true);
        expect(hasUnsavedWork([], 2)).toBe(true);
    });
});

describe('temporizacion y cabecera', () => {
    it('jitter +-20% de 10 min', () => {
        expect(nextCheckDelay(0)).toBe(480000);
        expect(nextCheckDelay(1)).toBe(720000);
        expect(nextCheckDelay(0.5)).toBe(600000);
    });
    it('parsea la cabecera min-client-api', () => {
        expect(parseMinClientApi('3')).toBe(3);
        expect(parseMinClientApi('x')).toBeNull();
        expect(parseMinClientApi(null)).toBeNull();
    });
});

describe('/api/version', () => {
    it('responde sin sesion, no-store y con la forma esperada', async () => {
        const res = await GET();
        expect(res.headers.get('cache-control')).toBe('no-store');
        const body = await res.json();
        expect(body).toMatchObject({ clientApi: CLIENT_API_VERSION, minClientApi: expect.any(Number) });
        expect(typeof body.buildId).toBe('string');
    });
    it('minClientApi sale de BLOOMX_MIN_CLIENT_API (entero) o 1', () => {
        expect(parseMinClientApiEnv('3')).toBe(3);
        expect(parseMinClientApiEnv('abc')).toBe(1);
        expect(parseMinClientApiEnv(undefined)).toBe(1);
        expect(buildVersionPayload({ NEXT_PUBLIC_BUILD_ID: 'b1', BLOOMX_MIN_CLIENT_API: '4' })).toMatchObject({ buildId: 'b1', minClientApi: 4 });
    });
    it('el middleware lo deja pasar sin sesion', () => {
        const src = readFileSync(path.resolve(__dirname, '../../../middleware.ts'), 'utf8');
        expect(src).toContain("pathname === '/api/version'");
    });
});

describe('service worker por build', () => {
    const load = (search: string, names: string[]) => {
        const deleted: string[] = [];
        const listeners: Record<string, (e: any) => void> = {};
        const self: any = { addEventListener: (t: string, f: any) => { listeners[t] = f; }, location: { origin: 'https://a.test', search }, clients: { claim: async () => {} } };
        const caches = { keys: async () => names, delete: async (n: string) => { deleted.push(n); return true; } };
        vm.runInNewContext(readFileSync(path.resolve(__dirname, '../../../../public/sw.js'), 'utf8'), { self, URL, URLSearchParams, Response, caches, fetch: async () => { throw new Error('offline'); } });
        return { self, listeners, deleted };
    };
    it('deriva el nombre de cache del build id', () => {
        const { self } = load(`?v=${encodeURIComponent('abc123')}`, []);
        expect(self.__SW_POLICY__.SHELL_CACHE).toBe('bloomx-shell-abc123');
        expect(serviceWorkerUrl('abc123')).toBe('/sw.js?v=abc123');
    });
    it('activate borra las caches de builds anteriores y conserva las actuales', async () => {
        const { listeners, deleted } = load('?v=new', ['bloomx-shell-old', 'bloomx-static-old', 'bloomx-shell-new', 'bloomx-static-new', 'otra']);
        let p: Promise<unknown> = Promise.resolve();
        listeners.activate({ waitUntil: (x: Promise<unknown>) => { p = x; } });
        await p;
        expect(deleted.sort()).toEqual(['bloomx-shell-old', 'bloomx-static-old']);
    });
    it('no queda la nota manual CACHE_VERSION', () => {
        expect(readFileSync(path.resolve(__dirname, '../../../../public/sw.js'), 'utf8')).not.toContain('subir CACHE_VERSION');
    });
});
