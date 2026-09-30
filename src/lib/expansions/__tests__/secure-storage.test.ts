import { describe, expect, it } from 'vitest';
import { createSecureStorage, type KeyStore, type KeyValueStorage } from '../client/secure-storage';

function makeDeps() {
    const keys = new Map<string, CryptoKey>();
    const keyStore: KeyStore = {
        async get(userId) { return keys.get(userId); },
        async add(userId, key) {
            if (!keys.has(userId)) keys.set(userId, key);
            return keys.get(userId)!;
        },
    };
    const data = new Map<string, string>();
    const storage: KeyValueStorage = {
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => { data.set(k, v); },
        removeItem: (k) => { data.delete(k); },
    };
    const deps = {
        keyStore,
        storage,
        subtle: globalThis.crypto.subtle,
        getRandomValues: (array: Uint8Array) => globalThis.crypto.getRandomValues(array),
    };
    return { deps, keys, data };
}

describe('secure-storage (AES-GCM, sin caducidad)', () => {
    it('guarda y recupera cualquier JSON', async () => {
        const { deps } = makeDeps();
        const store = createSecureStorage(deps);
        await store.write('signature-content', '<p>Saludos, Ana</p>', 'u1');
        await store.write('mail', { a: [1, 2], b: null }, 'u1');
        expect(await store.read('signature-content', 'u1')).toBe('<p>Saludos, Ana</p>');
        expect(await store.read('mail', 'u1')).toEqual({ a: [1, 2], b: null });
        expect(await store.read('no-existe', 'u1')).toBeNull();
    });

    it('NO caduca: sigue legible pasadas horas (antes fallaba a los 5-10 minutos)', async () => {
        const { deps } = makeDeps();
        const store = createSecureStorage(deps);
        await store.write('sealer-keys', [{ name: 'k' }], 'u1');

        const realNow = Date.now;
        try {
            Date.now = () => realNow() + 24 * 60 * 60 * 1000; // +24 h
            expect(await store.read('sealer-keys', 'u1')).toEqual([{ name: 'k' }]);
            Date.now = () => realNow() + 400 * 24 * 60 * 60 * 1000; // +400 dias
            expect(await store.read('sealer-keys', 'u1')).toEqual([{ name: 'k' }]);
        } finally {
            Date.now = realNow;
        }
    });

    it('el valor almacenado esta cifrado (no aparece el texto en claro) y es no determinista', async () => {
        const { deps, data } = makeDeps();
        const store = createSecureStorage(deps);
        await store.write('k', 'texto-secreto-visible', 'u1');
        const first = [...data.values()][0];
        expect(first.startsWith('v2.')).toBe(true);
        expect(first).not.toContain('texto-secreto-visible');
        await store.write('k', 'texto-secreto-visible', 'u1');
        expect([...data.values()][0]).not.toBe(first); // IV distinto
    });

    it('aislado por usuario: otro usuario no lee ni con la misma clave', async () => {
        const { deps } = makeDeps();
        const store = createSecureStorage(deps);
        await store.write('sig', 'de-u1', 'u1');
        expect(await store.read('sig', 'u2')).toBeNull();
    });

    it('un valor movido a otra clave o usuario no descifra (AAD)', async () => {
        const { deps, data } = makeDeps();
        const store = createSecureStorage(deps);
        await store.write('a', 'valor-a', 'u1');
        const [[storedKey, storedValue]] = [...data.entries()];
        data.set(storedKey.replace(':a', ':b'), storedValue);
        expect(await store.read('b', 'u1')).toBeNull();
    });

    it('un valor manipulado o con formato desconocido devuelve null sin lanzar', async () => {
        const { deps, data } = makeDeps();
        const store = createSecureStorage(deps);
        await store.write('a', 'x', 'u1');
        const [storedKey] = [...data.keys()];
        data.set(storedKey, 'v2.AAAA.BBBB');
        expect(await store.read('a', 'u1')).toBeNull();
        data.set(storedKey, 'basura');
        expect(await store.read('a', 'u1')).toBeNull();
    });

    it('la clave se genera una sola vez por usuario y no es extraible', async () => {
        const { deps, keys } = makeDeps();
        const store = createSecureStorage(deps);
        await Promise.all([store.write('a', 1, 'u1'), store.write('b', 2, 'u1')]);
        expect(keys.size).toBe(1);
        expect(keys.get('u1')!.extractable).toBe(false);
    });

    it('write limpia el formato antiguo bajo la clave sin prefijo; remove borra', async () => {
        const { deps, data } = makeDeps();
        data.set('signature-content', '123:abc:def');
        const store = createSecureStorage(deps);
        await store.write('signature-content', 'nueva', 'u1');
        expect(data.has('signature-content')).toBe(false);
        await store.remove('signature-content', 'u1');
        expect(await store.read('signature-content', 'u1')).toBeNull();
    });
});
