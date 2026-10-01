import { describe, expect, it } from 'vitest';
import { createPublicKey } from 'node:crypto';
import { generateEd25519KeyPair, parseEd25519PrivateKey, sha256Hex, signCanonical } from '@/lib/bloomx-signature';
import { verifyConfigSignature, pinnedBackendKey } from '../registry-trust';
import { backendUrl } from '@/lib/backend-url';

const sign = (priv: string, domain: string, ts: number, body: string) => `${ts}.${signCanonical(parseEd25519PrivateKey(priv)!, `BLOOMX-CFG-V1\n${domain}\n${ts}\n${sha256Hex(body)}`)}`;

describe('M4: confianza en el registro de proveedores', () => {
    const kp = generateEd25519KeyPair();
    const pub = createPublicKey(kp.publicPem);
    const body = JSON.stringify({ extensions: [{ id: 'x' }] });
    const now = 1_800_000_000_000;
    const ts = Math.floor(now / 1000);

    it('acepta la firma del backend y rechaza cuerpo alterado, otro dominio, firma de otra clave, caducada o ausente', () => {
        const h = sign(kp.privatePem, 'acme.com', ts, body);
        expect(verifyConfigSignature({ domain: 'acme.com', body, header: h, publicKey: pub, now })).toBe(true);
        expect(verifyConfigSignature({ domain: 'acme.com', body: body.replace('x', 'y'), header: h, publicKey: pub, now })).toBe(false);
        expect(verifyConfigSignature({ domain: 'otro.com', body, header: h, publicKey: pub, now })).toBe(false);
        const other = generateEd25519KeyPair();
        expect(verifyConfigSignature({ domain: 'acme.com', body, header: sign(other.privatePem, 'acme.com', ts, body), publicKey: pub, now })).toBe(false);
        expect(verifyConfigSignature({ domain: 'acme.com', body, header: h, publicKey: pub, now: now + 10 * 60_000 })).toBe(false);
        expect(verifyConfigSignature({ domain: 'acme.com', body, header: null, publicKey: pub, now })).toBe(false);
        expect(verifyConfigSignature({ domain: 'acme.com', body, header: 'basura', publicKey: pub, now })).toBe(false);
    });

    it('la clave fijada se lee de BLOOMX_BACKEND_PUBLIC_KEY (y una invalida es null)', () => {
        expect(pinnedBackendKey({})).toBeNull();
        expect(pinnedBackendKey({ BLOOMX_BACKEND_PUBLIC_KEY: kp.publicKey })).not.toBeNull();
        expect(pinnedBackendKey({ BLOOMX_BACKEND_PUBLIC_KEY: 'no-es-una-clave' })).toBeNull();
    });

    it('NEXT_PUBLIC_BACKEND_URL: https obligatorio en produccion (http solo en localhost); el defecto es https', () => {
        expect(backendUrl({ NODE_ENV: 'production' })).toBe('https://backend.bloomx.arubik.dev');
        expect(() => backendUrl({ NODE_ENV: 'production', NEXT_PUBLIC_BACKEND_URL: 'http://backend.acme.com' })).toThrow('insecure_backend_url');
        expect(() => backendUrl({ NODE_ENV: 'production', NEXT_PUBLIC_BACKEND_URL: 'ftp://x' })).toThrow();
        expect(backendUrl({ NODE_ENV: 'production', NEXT_PUBLIC_BACKEND_URL: 'http://localhost:3001/' })).toBe('http://localhost:3001');
        expect(backendUrl({ NODE_ENV: 'development', NEXT_PUBLIC_BACKEND_URL: 'http://192.168.0.5:3001' })).toBe('http://192.168.0.5:3001');
        expect(backendUrl({ NODE_ENV: 'production', NEXT_PUBLIC_BACKEND_URL: 'https://backend.acme.com/' })).toBe('https://backend.acme.com');
    });
});

import { validateRegistryResponse } from '../registry-trust';
describe('registro de proveedores sin clave del backend: esquema estricto', () => {
    it('acepta la forma esperada y rechaza todo lo demas', () => {
        const ok = { extensions: [{ id: 'core-googlelib', template: { id: 'core-googlelib' }, settings: { config: {} } }, { id: 'x', template: '{"a":1}' }] };
        expect(validateRegistryResponse(ok)).toHaveLength(2);
        for (const bad of [null, [], {}, { extensions: 'x' }, { extensions: [null] }, { extensions: [{ id: '../x', template: {} }] }, { extensions: [{ id: 'a', template: 5 }] }, { extensions: [{ id: 'a', template: {}, settings: [] }] }, { extensions: Array.from({ length: 301 }, (_, i) => ({ id: `e${i}`, template: {} })) }]) {
            expect(validateRegistryResponse(bad)).toBeNull();
        }
    });
});
