import { describe, expect, it } from 'vitest';
import { CAPABILITY_REGISTRY, LEGACY_BASELINE_CAPABILITIES, parseClientIdentity } from '../../client-contract';
import { CLIENT_API_VERSION, CLIENT_CAPABILITIES, CLIENT_IDENTITY, clientVersionHeaders, describeCapability } from '../capabilities';
import { buildBackendHeaders } from '@/lib/backend-auth';
import { canonicalString, generateEd25519KeyPair, parseEd25519PublicKey, sha256Hex, verifyCanonical } from '@/lib/bloomx-signature';

describe('capacidades del cliente (versionado de extensiones)', () => {
    it('toda capacidad esta registrada y documentada en es y en', () => {
        for (const id of CLIENT_CAPABILITIES) {
            const info = CAPABILITY_REGISTRY[id];
            expect(info, `${id} no esta en CAPABILITY_REGISTRY`).toBeTruthy();
            expect(info.es.length).toBeGreaterThan(10);
            expect(info.en.length).toBeGreaterThan(10);
            expect(describeCapability(id, 'en')).toBe(info.en);
        }
        for (const [id, info] of Object.entries(CAPABILITY_REGISTRY)) {
            expect(info.es.length, id).toBeGreaterThan(10);
            expect(info.en.length, id).toBeGreaterThan(10);
        }
    });

    it('CLIENT_CAPABILITIES = todo lo registrado hasta CLIENT_API_VERSION (la linea base va implicita); no sobra ni falta nada', () => {
        const expected = Object.entries(CAPABILITY_REGISTRY)
            .filter(([, info]) => info.since > 1 && info.since <= CLIENT_API_VERSION)
            .map(([id]) => id)
            .sort();
        expect([...CLIENT_CAPABILITIES].sort()).toEqual(expected);
        expect([...CLIENT_CAPABILITIES]).toEqual([...CLIENT_CAPABILITIES].sort());
        expect(Object.values(CAPABILITY_REGISTRY).every((i) => i.since <= CLIENT_API_VERSION), 'una capacidad exige subir CLIENT_API_VERSION').toBe(true);
    });

    it('la identidad incluye la linea base y las cabeceras son compactas y se leen igual en el backend', () => {
        for (const id of LEGACY_BASELINE_CAPABILITIES) expect(CLIENT_IDENTITY.capabilities).toContain(id);
        const h = clientVersionHeaders();
        expect(h['X-BloomX-Client-Api']).toBe(String(CLIENT_API_VERSION));
        expect(h['X-BloomX-Client-Caps'].length).toBeLessThanOrEqual(1024);
        const parsed = parseClientIdentity(new Headers(h));
        expect(parsed.legacy).toBe(false);
        expect(parsed.clientApi).toBe(CLIENT_API_VERSION);
        expect(parsed.capabilities).toEqual(CLIENT_IDENTITY.capabilities);
    });
});

describe('las cabeceras de version van en TODAS las llamadas y dentro de la firma', () => {
    const base = { method: 'POST', url: 'https://be.example.com/api/extension/execute', body: '{"a":1}', domain: 'acme.com', userId: 'u1', email: 'a@acme.com' };

    it('modo legado (sin clave): se envian igualmente como informativas', () => {
        const h = buildBackendHeaders({ ...base, env: {} });
        expect(h['X-BloomX-Client-Api']).toBe(String(CLIENT_API_VERSION));
        expect(h['X-BloomX-Client-Caps']).toContain('settings.schema.v1');
        expect(h['X-BloomX-Signature']).toBeUndefined();
    });

    it('con firma: el mensaje es V2 e incluye api y capacidades; quitarlas invalida la firma', () => {
        const kp = generateEd25519KeyPair();
        const nowMs = 1_800_000_000_000;
        const h = buildBackendHeaders({ ...base, env: { BLOOMX_DOMAIN_PRIVATE_KEY: kp.privatePem }, nowMs });
        const pub = parseEd25519PublicKey(kp.publicKey)!;
        const parts = { method: 'POST', pathAndQuery: '/api/extension/execute', bodySha256Hex: sha256Hex(base.body), domain: 'acme.com', timestamp: h['X-BloomX-Timestamp'], nonce: h['X-BloomX-Nonce'], userId: 'u1', userEmail: 'a@acme.com', callback: '' };
        const v2 = canonicalString({ ...parts, clientApi: h['X-BloomX-Client-Api'], clientCaps: h['X-BloomX-Client-Caps'] });
        expect(v2.startsWith('BLOOMX-SIG-V2\n')).toBe(true);
        expect(verifyCanonical(pub, v2, h['X-BloomX-Signature'])).toBe(true);
        expect(verifyCanonical(pub, canonicalString(parts), h['X-BloomX-Signature']), 'sin cabeceras de version no valida').toBe(false);
        expect(verifyCanonical(pub, canonicalString({ ...parts, clientApi: '1', clientCaps: h['X-BloomX-Client-Caps'] }), h['X-BloomX-Signature'])).toBe(false);
    });

    it('VECTOR V2 fijo compartido con el backend (bloomx-backend/tests/client-versions.test.mjs)', () => {
        const canonical = canonicalString({
            method: 'post', pathAndQuery: '/api/extension/execute', bodySha256Hex: '3f754fd453f218e11a4467884985d632db9438914374b6e1fa968108219d1fbc',
            domain: 'ULIMA.dev', timestamp: 1800000000, nonce: 'abcdefghijklmnop1234', userId: 'u1', userEmail: 'a@ulima.dev', callback: 'https://ulima.dev',
            clientApi: '2', clientCaps: 'ai.v1,core.mounts.v1',
        });
        expect(canonical).toBe('BLOOMX-SIG-V2\nPOST\n/api/extension/execute\n3f754fd453f218e11a4467884985d632db9438914374b6e1fa968108219d1fbc\nulima.dev\n1800000000\nabcdefghijklmnop1234\nu1\na@ulima.dev\nhttps://ulima.dev\n2\nai.v1,core.mounts.v1');
    });
});
