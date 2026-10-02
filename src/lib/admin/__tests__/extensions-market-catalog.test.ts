import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/admin/extensions-instance', () => ({ backendUrl: () => 'https://backend.test' }));

import { __resetCatalogCache, fetchCatalog, shapeCatalog } from '@/lib/admin/extensions-catalog';
import { UNSIGNED_CLIENT_IDENTITY, announcedIdentity, catalogClientHeaders } from '@/lib/expansions/client/capabilities';
import { parseClientIdentity } from '@/lib/expansions/client-contract';

const fetchMock = vi.fn();
beforeEach(() => {
    __resetCatalogCache();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('catalogo publico: capacidad market.catalog.v1 tambien SIN clave de dominio', () => {
    it('la peticion del catalogo declara la capacidad con o sin clave, sin cambiar el clientApi anunciado', () => {
        for (const signed of [false, true]) {
            const h = catalogClientHeaders(signed);
            const id = parseClientIdentity(new Headers(h));
            expect(id.capabilities).toContain('market.catalog.v1');
            expect(id.clientApi).toBe(announcedIdentity(signed).clientApi);
        }
    });

    it('la identidad anunciada sin clave NO incluye la capacidad: las versiones de extensiones que recibe la instancia no cambian', () => {
        expect(UNSIGNED_CLIENT_IDENTITY.capabilities).not.toContain('market.catalog.v1');
        // y el resto de capacidades de la peticion del catalogo son EXACTAMENTE las de siempre
        const withMarket = parseClientIdentity(new Headers(catalogClientHeaders(false))).capabilities.filter((c) => c !== 'market.catalog.v1');
        expect(withMarket).toEqual(UNSIGNED_CLIENT_IDENTITY.capabilities);
    });

    it('fetchCatalog envia esas cabeceras al catalogo publico', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
        await fetchCatalog({ fresh: true });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://backend.test/api/admin/extensions/public-list');
        expect(String(init.headers['X-BloomX-Client-Caps'])).toContain('market.catalog.v1');
    });
});

describe('shapeCatalog: el bloque market se vuelve a sanear', () => {
    const base = { id: 'core-x', name: 'X', description: '', version: '1.0.0', template: { permissions: [] } };

    it('conserva editor, suite, categorias, etiquetas, instalaciones e historial y descarta lo peligroso', () => {
        const [e] = shapeCatalog([{
            ...base,
            market: {
                v: 1, installCount: 42, publisher: { id: 'bloomx', name: 'Bloomx', official: true, verified: true }, suite: { id: 'google', name: 'Google', icon: 'brand:google' },
                categories: ['calendar', 'hack'], tags: ['a', '<img src=x>'], screenshots: ['https://cdn.test/a.png', 'http://cdn.test/b.png', 'data:image/png;base64,AAAA'],
                history: [{ version: '1.0.0', status: 'published', date: '2026-10-01', compatible: true, notes: ['ok', '<b>x</b>'] }, { version: 'no-semver' }],
            },
        }]);
        expect(e.market).toMatchObject({ installCount: 42, categories: ['calendar'], tags: ['a'], screenshots: ['https://cdn.test/a.png'], fromBackend: true });
        expect(e.market!.publisher).toMatchObject({ id: 'bloomx', official: true });
        expect(e.market!.suite).toMatchObject({ id: 'google', name: 'Google' });
        expect(e.market!.history).toEqual([{ version: '1.0.0', status: 'published', date: '2026-10-01', compatible: true, notes: ['ok'] }]);
    });

    it('un backend antiguo (sin market) da market null: la pantalla usa el respaldo derivado', () => {
        expect(shapeCatalog([base])[0].market).toBeNull();
    });

    it('un tercero no se hace pasar por oficial aunque el backend lo diga', () => {
        const [e] = shapeCatalog([{ ...base, id: 'evil-tool', market: { publisher: { id: 'bloomx', name: 'Bloomx', official: true, verified: true } } }]);
        expect(e.market!.publisher).toMatchObject({ official: false, verified: false });
    });
});
