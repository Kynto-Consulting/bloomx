import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    NonceStore,
    canonicalString,
    generateEd25519KeyPair,
    parseEd25519PrivateKey,
    parseEd25519PublicKey,
    sha256Hex,
    signCanonical,
    signRequest,
    verifyBackendSignature,
    verifyCanonical,
} from '../bloomx-signature';
import { clientVersionHeaders } from '@/lib/expansions/client/capabilities';
import { __resetBackendKeyCache, buildBackendHeaders, getBackendPublicKey, loadDomainPrivateKey, ownDomains, verifyBackendRequest } from '../backend-auth';

// Vector fijo generado con bloomx-backend/src/lib/signing.ts: garantiza que ambos repos hablan el MISMO protocolo.
const VECTOR = {
    seed: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=',
    pub: '6kpsY-KcUgq-9VB7Ey7F-ZVHdq6-vnuSQh7qaRRG0iw',
    body: '{"extensionId":"slash","action":"run"}',
    bodyHash: '3f754fd453f218e11a4467884985d632db9438914374b6e1fa968108219d1fbc',
    canonical:
        'BLOOMX-SIG-V1\nPOST\n/api/extension/execute\n3f754fd453f218e11a4467884985d632db9438914374b6e1fa968108219d1fbc\nulima.dev\n1800000000\nabcdefghijklmnop1234\nu1\na@ulima.dev\nhttps://ulima.dev',
    sig: 'ycBicrvX9WI0JdLJwwN8dOIwpBUhbDq24G5PxKl58aTGkKRUvUAphW_mUpCbnFsY74QN-nkQs6RBhgGC7vA6BQ',
};

describe('protocolo compartido con el backend (vector fijo)', () => {
    it('mismo mensaje canonico, mismo hash y misma firma que el backend', () => {
        expect(sha256Hex(VECTOR.body)).toBe(VECTOR.bodyHash);
        const canonical = canonicalString({
            method: 'post',
            pathAndQuery: '/api/extension/execute',
            bodySha256Hex: VECTOR.bodyHash,
            domain: 'ULIMA.dev',
            timestamp: 1800000000,
            nonce: 'abcdefghijklmnop1234',
            userId: 'u1',
            userEmail: 'a@ulima.dev',
            callback: 'https://ulima.dev',
        });
        expect(canonical).toBe(VECTOR.canonical);
        const priv = parseEd25519PrivateKey(VECTOR.seed)!;
        expect(signCanonical(priv, canonical)).toBe(VECTOR.sig);
        expect(verifyCanonical(parseEd25519PublicKey(VECTOR.pub)!, canonical, VECTOR.sig)).toBe(true);
    });
});

describe('buildBackendHeaders: firma con la clave del dominio o protocolo legado', () => {
    const base = { method: 'POST', url: 'https://be.example.com/api/extension/execute?x=1', body: '{"a":1}', domain: 'Mail.Acme.com:3000', userId: 'u1', email: 'a@acme.com' };

    it('SIN BLOOMX_DOMAIN_PRIVATE_KEY: solo cabeceras antiguas, nunca Authorization/JWT/firma', () => {
        const h = buildBackendHeaders({ ...base, env: {} });
        // Cabeceras antiguas + version del cliente (informativas en modo legado); ni firma, ni Authorization, ni JWT.
        expect(h).toEqual({ 'X-BloomX-Domain': 'mail.acme.com', 'X-User-ID': 'u1', 'X-User-Email': 'a@acme.com', ...clientVersionHeaders() });
    });

    it('con clave invalida: se cae al modo legado sin lanzar', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(buildBackendHeaders({ ...base, env: { BLOOMX_DOMAIN_PRIVATE_KEY: 'basura' } })['X-BloomX-Signature']).toBeUndefined();
        warn.mockRestore();
    });

    it('CON clave (PEM, DER base64 o semilla): la firma verifica con la clave publica', () => {
        const kp = generateEd25519KeyPair();
        for (const raw of [kp.privatePem, kp.privatePem.replace(/\n/g, '\\n')]) {
            const h = buildBackendHeaders({ ...base, env: { BLOOMX_DOMAIN_PRIVATE_KEY: raw, NEXT_PUBLIC_APP_URL: 'https://mail.acme.com/x' }, nowMs: 1_800_000_000_000 });
            expect(h['X-BloomX-Domain']).toBe('mail.acme.com');
            expect(h['X-BloomX-Timestamp']).toBe('1800000000');
            expect(h['X-BloomX-Callback']).toBe('https://mail.acme.com');
            const canonical = canonicalString({
                method: 'POST',
                pathAndQuery: '/api/extension/execute?x=1',
                bodySha256Hex: sha256Hex(base.body),
                domain: 'mail.acme.com',
                timestamp: h['X-BloomX-Timestamp'],
                nonce: h['X-BloomX-Nonce'],
                userId: 'u1',
                userEmail: 'a@acme.com',
                callback: 'https://mail.acme.com',
                // El cliente firma tambien su version (mensaje V2).
                clientApi: h['X-BloomX-Client-Api'],
                clientCaps: h['X-BloomX-Client-Caps'],
            });
            expect(verifyCanonical(parseEd25519PublicKey(kp.publicKey)!, canonical, h['X-BloomX-Signature'])).toBe(true);
        }
        expect(loadDomainPrivateKey({ BLOOMX_DOMAIN_PRIVATE_KEY: kp.privatePem })).not.toBeNull();
    });

    it('cada llamada usa un nonce distinto; un cuerpo alterado invalida la firma', () => {
        const kp = generateEd25519KeyPair();
        const env = { BLOOMX_DOMAIN_PRIVATE_KEY: kp.privatePem };
        const a = buildBackendHeaders({ ...base, env });
        const b = buildBackendHeaders({ ...base, env });
        expect(a['X-BloomX-Nonce']).not.toBe(b['X-BloomX-Nonce']);
        const tampered = canonicalString({
            method: 'POST',
            pathAndQuery: '/api/extension/execute?x=1',
            bodySha256Hex: sha256Hex('{"a":2}'),
            domain: 'mail.acme.com',
            timestamp: a['X-BloomX-Timestamp'],
            nonce: a['X-BloomX-Nonce'],
            userId: 'u1',
            userEmail: 'a@acme.com',
            callback: '',
        });
        expect(verifyCanonical(parseEd25519PublicKey(kp.publicKey)!, tampered, a['X-BloomX-Signature'])).toBe(false);
    });
});

describe('verificacion de la firma del backend (puente services.mail)', () => {
    const backend = generateEd25519KeyPair();
    const backendPriv = parseEd25519PrivateKey(backend.privatePem)!;
    const backendPub = parseEd25519PublicKey(backend.publicKey)!;
    const NOW = 1_800_000_000_000;
    const body = JSON.stringify({ op: 'listRecent', userId: 'u1', args: {} });
    const url = 'https://app.acme.com/api/internal/mail';

    const request = (over: { body?: string; domain?: string; userId?: string; nowMs?: number; nonce?: string } = {}) => {
        const sig = signRequest(backendPriv, { method: 'POST', pathAndQuery: '/api/internal/mail', body, domain: over.domain ?? 'app.acme.com', userId: over.userId ?? 'u1', nowMs: over.nowMs ?? NOW, nonce: over.nonce });
        const headers = new Headers({ ...sig, 'X-BloomX-Domain': over.domain ?? 'app.acme.com', 'X-User-Id': over.userId ?? 'u1' });
        return { headers, rawBody: over.body ?? body };
    };
    const verify = (r: { headers: Headers; rawBody: string }, extra: Partial<Parameters<typeof verifyBackendSignature>[0]> = {}) =>
        verifyBackendSignature({ method: 'POST', url, headers: r.headers, rawBody: r.rawBody, backendPublicKey: backendPub, expectedDomains: ['app.acme.com'], nowMs: NOW, nonces: new NonceStore(), ...extra });

    it('firma valida del backend => ok con el userId firmado', () => {
        expect(verify(request())).toEqual({ ok: true, userId: 'u1' });
    });

    it('rechaza: cuerpo alterado, otro usuario, otra audiencia, firma de otra clave, expirada y replay', () => {
        expect(verify(request({ body: body + ' ' })).ok).toBe(false);
        const swapped = request();
        swapped.headers.set('x-user-id', 'victima');
        expect(verify(swapped).ok).toBe(false);
        expect(verify(request({ domain: 'otro.com' })).ok).toBe(false);

        const other = generateEd25519KeyPair();
        expect(verify(request(), { backendPublicKey: parseEd25519PublicKey(other.publicKey)! }).ok).toBe(false);

        expect(verify(request({ nowMs: NOW - 200_000 })).ok).toBe(false);
        expect(verify(request({ nowMs: NOW + 200_000 })).ok).toBe(false);

        const nonces = new NonceStore();
        const r = request({ nonce: 'nonce-unico-1234567' });
        expect(verify(r, { nonces }).ok).toBe(true);
        expect(verify(r, { nonces }).ok).toBe(false);
    });

    it('sin cabeceras de firma => rechazado', () => {
        expect(verify({ headers: new Headers(), rawBody: body }).ok).toBe(false);
    });

    describe('clave publica del backend: fijada o descubierta con cache', () => {
        beforeEach(() => __resetBackendKeyCache());

        it('BLOOMX_BACKEND_PUBLIC_KEY fijada: no hace red', async () => {
            const fetchImpl = vi.fn();
            const key = await getBackendPublicKey({ BLOOMX_BACKEND_PUBLIC_KEY: backend.publicKey }, fetchImpl as any);
            expect(key).not.toBeNull();
            expect(fetchImpl).not.toHaveBeenCalled();
        });

        it('descubrimiento desde NEXT_PUBLIC_BACKEND_URL con cache', async () => {
            const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ publicKey: backend.publicKey }) }) as any);
            const env = { NEXT_PUBLIC_BACKEND_URL: 'https://be.example.com/' };
            expect(await getBackendPublicKey(env, fetchImpl as any)).not.toBeNull();
            expect(await getBackendPublicKey(env, fetchImpl as any)).not.toBeNull();
            expect(fetchImpl).toHaveBeenCalledTimes(1);
            expect((fetchImpl.mock.calls[0] as any)[0]).toBe('https://be.example.com/.well-known/bloomx-backend-key.json');
        });

        it('backend sin clave (404) o caido: null y cache corta; verifyBackendRequest => unavailable (no exception)', async () => {
            const fetchImpl = vi.fn(async () => ({ ok: false, json: async () => ({ available: false }) }) as any);
            const r = await verifyBackendRequest({ method: 'POST', url, headers: new Headers() }, body, { env: { NEXT_PUBLIC_BACKEND_URL: 'https://be2.example.com' }, fetchImpl: fetchImpl as any });
            expect(r).toEqual({ ok: false, reason: 'unavailable' });
        });

        it('verifyBackendRequest de extremo a extremo con la clave fijada', async () => {
            const env = { BLOOMX_BACKEND_PUBLIC_KEY: backend.publicKey, TOP_DOMAIN: 'app.acme.com' };
            const req = request();
            const ok = await verifyBackendRequest({ method: 'POST', url, headers: req.headers }, req.rawBody, { env, nowMs: NOW, nonces: new NonceStore() });
            expect(ok).toEqual({ ok: true, userId: 'u1' });
            const bad = await verifyBackendRequest({ method: 'POST', url, headers: req.headers }, req.rawBody + 'x', { env, nowMs: NOW, nonces: new NonceStore() });
            expect(bad).toEqual({ ok: false, reason: 'invalid' });
        });
    });

    it('ownDomains: TOP_DOMAIN y host de NEXT_PUBLIC_APP_URL', () => {
        expect(ownDomains({ TOP_DOMAIN: 'A.com:3000', NEXT_PUBLIC_APP_URL: 'https://mail.a.com' }).sort()).toEqual(['a.com', 'mail.a.com']);
        expect(ownDomains({})).toEqual([]);
    });
});
