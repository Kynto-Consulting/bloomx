import { describe, expect, it } from 'vitest';
import { CAPABILITY_REGISTRY, LEGACY_BASELINE_CAPABILITIES, parseClientIdentity } from '../../client-contract';
import { CAPABILITY_CLASS, CLIENT_API_VERSION, CLIENT_CAPABILITIES, CLIENT_IDENTITY, SIGNED_ONLY_CAPABILITIES, UNSIGNED_CLIENT_IDENTITY, announcedIdentity, clientVersionHeaders, currentClientIdentity, describeCapability } from '../capabilities';
import { buildVersionPayload } from '@/lib/pwa/version-info';
import { buildBackendHeaders } from '@/lib/backend-auth';
import { canonicalString, generateEd25519KeyPair, parseEd25519PublicKey, sha256Hex, verifyCanonical } from '@/lib/bloomx-signature';

const PENDING_CAPABILITIES: string[] = [];

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
        // Capacidades registradas pero AUN NO implementadas en este cliente (se anuncian al completar su codigo; vaciar esta lista al hacerlo).
        const pending = Object.entries(CAPABILITY_REGISTRY).filter(([, i]) => i.since > CLIENT_API_VERSION).map(([id]) => id).sort();
        expect(pending).toEqual(PENDING_CAPABILITIES);
    });

    it('la identidad incluye la linea base y las cabeceras son compactas y se leen igual en el backend', () => {
        for (const id of LEGACY_BASELINE_CAPABILITIES) expect(CLIENT_IDENTITY.capabilities).toContain(id);
        const h = clientVersionHeaders(true);
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
        // Sin clave de dominio: solo lo que funciona sin firmar (ver CAPABILITY_CLASS) y el clientApi mas alto cuyo conjunto completo es anunciable.
        expect(h['X-BloomX-Client-Api']).toBe(String(UNSIGNED_CLIENT_IDENTITY.clientApi));
        expect(h['X-BloomX-Client-Caps']).toContain('settings.schema.v1');
        for (const c of SIGNED_ONLY_CAPABILITIES) expect(h['X-BloomX-Client-Caps']).not.toContain(c);
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

describe('instancia SIN clave de dominio: solo anuncia lo que funciona sin firmar', () => {
    it('clasificacion: signed-only = grants, oauth.* y rutas; el resto es unsigned-ok', () => {
        expect([...SIGNED_ONLY_CAPABILITIES].sort()).toEqual(['billing.paypal.v1', 'ext.grants.v1', 'ext.routes.auth.v1', 'ext.routes.v1', 'lifecycle.events.v2', 'marketplace.developer.v1', 'oauth.broker.v1', 'oauth.provider.v1', 'oauth.provider.v2', 'oauth.provider.v3']);
        for (const c of CLIENT_CAPABILITIES) expect(CAPABILITY_CLASS[c]).toBeDefined();
    });
    it('el clientApi sin clave es la mayor version cuyo conjunto completo es anunciable (justo antes de la primera signed-only) y ninguna capacidad supera esa version', () => {
        const un = announcedIdentity(false);
        const firstSigned = Math.min(...SIGNED_ONLY_CAPABILITIES.map((c) => CAPABILITY_REGISTRY[c].since));
        expect(un.clientApi).toBe(firstSigned - 1);
        expect(un.clientApi).toBeLessThan(CLIENT_API_VERSION);
        for (const c of un.capabilities) expect(CAPABILITY_REGISTRY[c]?.since ?? 1).toBeLessThanOrEqual(un.clientApi);
        for (const c of SIGNED_ONLY_CAPABILITIES) expect(un.capabilities).not.toContain(c);
        expect(un.capabilities).toContain('ext.dependencies.v1');
    });
    it('coincide con la identidad que usa el test de catalogo de bloomx-extensions (unsigned-catalog.test.mjs): clientApi 3 + capacidades de siempre + ext.dependencies.v1', () => {
        const prev = ['ai.json', 'ai.v1', 'conferencing.picker', 'lifecycle.events.v1', 'services.host.v1', 'settings.schema.v1', 'toolbar.compact', 'ui.input.onSubmit', 'ui.kit.v2', 'ext.dependencies.v1'];
        const un = announcedIdentity(false);
        expect(un.clientApi).toBe(3);
        expect(un.capabilities.filter((c) => !LEGACY_BASELINE_CAPABILITIES.includes(c)).sort()).toEqual([...prev].sort());
    });
    it('con clave valida se anuncia todo y la version completa; con clave invalida cuenta como sin clave', () => {
        const kp = generateEd25519KeyPair();
        expect(currentClientIdentity({ BLOOMX_DOMAIN_PRIVATE_KEY: kp.privatePem })).toEqual(CLIENT_IDENTITY);
        expect(currentClientIdentity({ BLOOMX_DOMAIN_PRIVATE_KEY: 'basura' })).toEqual(UNSIGNED_CLIENT_IDENTITY);
        expect(currentClientIdentity({})).toEqual(UNSIGNED_CLIENT_IDENTITY);
        const h = buildBackendHeaders({ method: 'POST', url: 'https://be.example.com/api/x', body: '{}', domain: 'acme.com', env: { BLOOMX_DOMAIN_PRIVATE_KEY: kp.privatePem } });
        expect(h['X-BloomX-Client-Api']).toBe(String(CLIENT_API_VERSION));
        expect(h['X-BloomX-Client-Caps']).toContain('oauth.broker.v1');
    });
    it('/api/version: clientApi = build; announcedClientApi/signed reflejan la clave de la instancia', () => {
        const kp = generateEd25519KeyPair();
        expect(buildVersionPayload({})).toMatchObject({ clientApi: CLIENT_API_VERSION, announcedClientApi: UNSIGNED_CLIENT_IDENTITY.clientApi, signed: false });
        expect(buildVersionPayload({ BLOOMX_DOMAIN_PRIVATE_KEY: kp.privatePem })).toMatchObject({ announcedClientApi: CLIENT_API_VERSION, signed: true });
    });
});
