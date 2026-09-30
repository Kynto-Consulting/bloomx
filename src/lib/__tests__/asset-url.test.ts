import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    buildSignedAssetUrl,
    computeAssetSignature,
    decideAssetAccess,
    resolveUnsignedPolicy,
    ttlSecondsForKey,
    verifyAssetSignature,
} from '../asset-url';

const ENV_KEYS = ['ASSET_SIGNING_KEY', 'NEXTAUTH_SECRET', 'ASSET_URL_TTL_SECONDS', 'ASSET_UPLOAD_URL_TTL_SECONDS', 'ASSET_UNSIGNED_INBOUND', 'ASSET_UNSIGNED_UPLOADS'];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.NEXTAUTH_SECRET = 'test-secret-for-assets';
});
afterEach(() => {
    for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
});

const KEY = 'emails/2026-09-29/abc-123/attachments/informe final.pdf';
const NOW = Date.UTC(2026, 8, 29, 12, 0, 0);

function parse(url: string) {
    const u = new URL(url, 'https://app.example');
    return { exp: u.searchParams.get('exp'), sig: u.searchParams.get('sig'), filename: u.searchParams.get('filename'), pathname: u.pathname };
}

describe('URLs firmadas de assets', () => {
    it('firma y verifica (ida y vuelta)', () => {
        const url = buildSignedAssetUrl(KEY, { baseUrl: 'https://app.example/', filename: 'informe final.pdf', nowMs: NOW });
        const { exp, sig, filename, pathname } = parse(url);
        expect(url.startsWith('https://app.example/api/assets/emails/2026-09-29/abc-123/attachments/')).toBe(true);
        expect(decodeURIComponent(pathname)).toBe(`/api/assets/${KEY}`);
        expect(filename).toBe('informe_final.pdf');
        expect(verifyAssetSignature(KEY, exp, sig, NOW + 1000)).toBe('ok');
    });

    it('caduca segun el TTL del prefijo (1 h adjuntos recibidos, 30 dias subidas)', () => {
        expect(ttlSecondsForKey(KEY)).toBe(3600);
        expect(ttlSecondsForKey('attachments/a@b.com/1-x.png')).toBe(30 * 24 * 3600);
        process.env.ASSET_URL_TTL_SECONDS = '60';
        const { exp, sig } = parse(buildSignedAssetUrl(KEY, { nowMs: NOW }));
        expect(verifyAssetSignature(KEY, exp, sig, NOW + 59_000)).toBe('ok');
        expect(verifyAssetSignature(KEY, exp, sig, NOW + 61_000)).toBe('expired');
    });

    it('rechaza clave, caducidad o firma manipuladas', () => {
        const { exp, sig } = parse(buildSignedAssetUrl(KEY, { nowMs: NOW }));
        expect(verifyAssetSignature(KEY + 'x', exp, sig, NOW)).toBe('invalid');
        expect(verifyAssetSignature(KEY, String(Number(exp) + 3600), sig, NOW)).toBe('invalid'); // alargar la vigencia
        expect(verifyAssetSignature(KEY, exp, sig!.slice(0, -2) + 'AA', NOW)).toBe('invalid');
        expect(verifyAssetSignature(KEY, exp, 'x', NOW)).toBe('invalid');
        expect(verifyAssetSignature(KEY, 'abc', sig, NOW)).toBe('invalid');
        expect(verifyAssetSignature(KEY, exp, null, NOW)).toBe('invalid');
    });

    it('sin parametros => missing', () => {
        expect(verifyAssetSignature(KEY, null, null)).toBe('missing');
    });

    it('la firma depende del secreto (ASSET_SIGNING_KEY tiene prioridad sobre NEXTAUTH_SECRET)', () => {
        const a = computeAssetSignature(KEY, 123);
        process.env.ASSET_SIGNING_KEY = 'otra-clave-distinta-de-firma';
        const b = computeAssetSignature(KEY, 123);
        expect(a).not.toBe(b);
        const { exp, sig } = parse(buildSignedAssetUrl(KEY, { nowMs: NOW }));
        delete process.env.ASSET_SIGNING_KEY;
        expect(verifyAssetSignature(KEY, exp, sig, NOW)).toBe('invalid');
    });

    it('la firma de un objeto no vale para otro (separacion por clave)', () => {
        const other = 'emails/2026-09-29/abc-123/attachments/otro.pdf';
        const { exp, sig } = parse(buildSignedAssetUrl(KEY, { nowMs: NOW }));
        expect(verifyAssetSignature(other, exp, sig, NOW)).toBe('invalid');
    });
});

describe('politica de acceso a assets (compatibilidad controlada por env)', () => {
    it('valores por defecto: recibidos=owner, subidas=allow', () => {
        expect(resolveUnsignedPolicy(KEY)).toBe('owner');
        expect(resolveUnsignedPolicy('attachments/a@b.com/1-x.png')).toBe('allow');
    });
    it('respeta las variables', () => {
        process.env.ASSET_UNSIGNED_UPLOADS = 'deny';
        process.env.ASSET_UNSIGNED_INBOUND = 'allow';
        expect(resolveUnsignedPolicy('attachments/a@b.com/1-x.png')).toBe('deny');
        expect(resolveUnsignedPolicy(KEY)).toBe('allow');
        process.env.ASSET_UNSIGNED_UPLOADS = 'basura';
        expect(resolveUnsignedPolicy('attachments/a@b.com/1-x.png')).toBe('allow');
    });

    it('matriz de decision', () => {
        expect(decideAssetAccess({ sig: 'ok', isOwner: false, policy: 'deny' })).toEqual({ allow: true, reason: 'signature' });
        expect(decideAssetAccess({ sig: 'expired', isOwner: true, policy: 'deny' }).allow).toBe(true); // propietario con firma caducada
        expect(decideAssetAccess({ sig: 'expired', isOwner: false, policy: 'allow' }).allow).toBe(false); // firma caducada nunca cae en "legacy"
        expect(decideAssetAccess({ sig: 'invalid', isOwner: false, policy: 'allow' }).allow).toBe(false);
        expect(decideAssetAccess({ sig: 'missing', isOwner: false, policy: 'allow' })).toEqual({ allow: true, reason: 'legacy_unsigned' });
        expect(decideAssetAccess({ sig: 'missing', isOwner: false, policy: 'owner' }).allow).toBe(false);
        expect(decideAssetAccess({ sig: 'missing', isOwner: true, policy: 'owner' })).toEqual({ allow: true, reason: 'owner' });
        expect(decideAssetAccess({ sig: 'missing', isOwner: false, policy: 'deny' }).allow).toBe(false);
    });
});
