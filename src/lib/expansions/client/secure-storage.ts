/**
 * Almacenamiento local cifrado para extensiones (firma, llaves de Sealer, caches de CRM...).
 *
 * QUE HACE (y que no):
 *  - Cifra con AES-256-GCM (WebCrypto). La clave es aleatoria por usuario, se genera una vez y vive en IndexedDB como
 *    CryptoKey NO EXTRAIBLE: el valor guardado en localStorage no se puede descifrar leyendo solo localStorage,
 *    ni copiando el perfil sin IndexedDB. El nombre de la clave y el usuario van como datos autenticados (AAD), asi
 *    que un valor no se puede mover a otra clave/usuario.
 *  - NO protege contra codigo que se ejecute en esta misma pagina (XSS) ni contra alguien con la sesion del
 *    navegador abierta: es cifrado en reposo local, no un almacen de secretos. Para datos que deben sincronizarse
 *    entre dispositivos usa /api/settings (expansionSettings), no este modulo.
 *  - NO CADUCA: lo guardado permanece hasta que se borre (antes la clave rotaba cada 5 minutos y la firma, los
 *    grupos y las llaves se perdian a los 5-10 minutos).
 *  - Si el navegador no ofrece IndexedDB/WebCrypto (modo privado estricto), falla con SECURE_STORAGE_UNAVAILABLE
 *    en lugar de guardar en claro.
 */

const STORAGE_PREFIX = 'bx:sec:v2:';
const DB_NAME = 'bloomx-secure-storage';
const STORE = 'keys';

export interface KeyStore {
    get(userId: string): Promise<CryptoKey | undefined>;
    /** Guarda solo si no existe (evita que dos pestanas sobrescriban la clave). Devuelve la clave vigente. */
    add(userId: string, key: CryptoKey): Promise<CryptoKey>;
}

export interface KeyValueStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export interface SecureStorageDeps {
    keyStore: KeyStore;
    storage: KeyValueStorage;
    subtle: SubtleCrypto;
    getRandomValues: (array: Uint8Array) => Uint8Array;
}

function toBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
}

function storageKey(userId: string, key: string): string {
    return `${STORAGE_PREFIX}${encodeURIComponent(userId)}:${key}`;
}

export function createSecureStorage(deps: SecureStorageDeps) {
    const keyCache = new Map<string, Promise<CryptoKey>>();

    async function getKey(userId: string): Promise<CryptoKey> {
        let pending = keyCache.get(userId);
        if (!pending) {
            pending = (async () => {
                const existing = await deps.keyStore.get(userId);
                if (existing) return existing;
                const fresh = await deps.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
                return deps.keyStore.add(userId, fresh);
            })();
            keyCache.set(userId, pending);
            pending.catch(() => keyCache.delete(userId));
        }
        return pending;
    }

    return {
        async write(key: string, value: unknown, userId: string): Promise<void> {
            const cryptoKey = await getKey(userId);
            const id = storageKey(userId, key);
            const iv = deps.getRandomValues(new Uint8Array(12));
            const plaintext = new TextEncoder().encode(JSON.stringify(value === undefined ? null : value));
            const ciphertext = new Uint8Array(
                await deps.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: new TextEncoder().encode(id) }, cryptoKey, plaintext),
            );
            deps.storage.setItem(id, `v2.${toBase64(iv)}.${toBase64(ciphertext)}`);
            // Formato antiguo (clave con epoca de 5 min) bajo el nombre sin prefijo: ya no sirve, se limpia.
            deps.storage.removeItem(key);
        },

        async read(key: string, userId: string): Promise<any | null> {
            const id = storageKey(userId, key);
            const raw = deps.storage.getItem(id);
            if (!raw) return null;

            const [version, ivB64, dataB64] = raw.split('.');
            if (version !== 'v2' || !ivB64 || !dataB64) return null;

            try {
                const cryptoKey = await getKey(userId);
                const plaintext = await deps.subtle.decrypt(
                    { name: 'AES-GCM', iv: fromBase64(ivB64) as BufferSource, additionalData: new TextEncoder().encode(id) },
                    cryptoKey,
                    fromBase64(dataB64) as BufferSource,
                );
                return JSON.parse(new TextDecoder().decode(plaintext));
            } catch {
                // Clave rotada/perdida o dato manipulado: se trata como inexistente (sin volcar detalles a consola).
                return null;
            }
        },

        async remove(key: string, userId: string): Promise<void> {
            deps.storage.removeItem(storageKey(userId, key));
        },
    };
}

// ---------------------------------------------------------------------------------------------------------------
// Implementacion de navegador (IndexedDB + localStorage)
// ---------------------------------------------------------------------------------------------------------------

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

const browserKeyStore: KeyStore = {
    async get(userId) {
        const db = await openDb();
        try {
            return (await idbRequest(db.transaction(STORE, 'readonly').objectStore(STORE).get(userId))) as CryptoKey | undefined;
        } finally {
            db.close();
        }
    },
    async add(userId, key) {
        const db = await openDb();
        try {
            try {
                await idbRequest(db.transaction(STORE, 'readwrite').objectStore(STORE).add(key, userId));
                return key;
            } catch {
                // Otra pestana la creo primero: usar esa.
                const existing = (await idbRequest(db.transaction(STORE, 'readonly').objectStore(STORE).get(userId))) as CryptoKey | undefined;
                if (existing) return existing;
                throw new Error('SECURE_STORAGE_UNAVAILABLE');
            }
        } finally {
            db.close();
        }
    },
};

let browserInstance: ReturnType<typeof createSecureStorage> | null = null;

function getBrowserInstance() {
    if (browserInstance) return browserInstance;
    if (typeof window === 'undefined' || !window.crypto?.subtle || typeof indexedDB === 'undefined') {
        throw new Error('SECURE_STORAGE_UNAVAILABLE');
    }
    browserInstance = createSecureStorage({
        keyStore: browserKeyStore,
        storage: window.localStorage,
        subtle: window.crypto.subtle,
        getRandomValues: (array) => window.crypto.getRandomValues(array),
    });
    return browserInstance;
}

export function isSecureStorageAvailable(): boolean {
    try {
        getBrowserInstance();
        return true;
    } catch {
        return false;
    }
}

export async function secureWrite(key: string, value: any, userId: string): Promise<void> {
    return getBrowserInstance().write(key, value, userId);
}

export async function secureRead(key: string, userId: string): Promise<any | null> {
    try {
        return await getBrowserInstance().read(key, userId);
    } catch {
        return null;
    }
}

export async function secureRemove(key: string, userId: string): Promise<void> {
    return getBrowserInstance().remove(key, userId);
}
