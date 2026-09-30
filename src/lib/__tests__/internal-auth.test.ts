import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { acceptedInternalSecrets, deriveInternalKey, internalSecretToSend, INTERNAL_HKDF_INFO, verifyInternalRequest } from '../internal-auth';

const hdr = (value?: string) => ({ get: (n: string) => (n.toLowerCase() === 'x-internal-secret' ? value ?? null : null) });

describe('internal-auth: clave interna derivada de NEXTAUTH_SECRET (HKDF-SHA256)', () => {
    it('es determinista, de 32 bytes hex y coincide con HKDF-SHA256 info "bloomx-internal-v1"', () => {
        const env = { NEXTAUTH_SECRET: 'secreto-de-esta-instancia' };
        const a = deriveInternalKey(env)!;
        expect(a).toMatch(/^[0-9a-f]{64}$/);
        expect(deriveInternalKey(env)).toBe(a);
        expect(INTERNAL_HKDF_INFO).toBe('bloomx-internal-v1');
        const expected = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(env.NEXTAUTH_SECRET), Buffer.alloc(0), Buffer.from('bloomx-internal-v1'), 32)).toString('hex');
        expect(a).toBe(expected);
    });

    it('instancias distintas derivan claves distintas y la clave no revela el secreto', () => {
        const a = deriveInternalKey({ NEXTAUTH_SECRET: 'instancia-A' })!;
        const b = deriveInternalKey({ NEXTAUTH_SECRET: 'instancia-B' })!;
        expect(a).not.toBe(b);
        expect(a).not.toContain('instancia-A');
    });

    it('sin NEXTAUTH_SECRET no hay clave derivada', () => {
        expect(deriveInternalKey({})).toBeNull();
    });

    it('SIN INTERNAL_SECRET: acepta la derivada, nunca 403 por falta de INTERNAL_SECRET', () => {
        const env = { NEXTAUTH_SECRET: 'n', NODE_ENV: 'production' };
        const key = internalSecretToSend(env);
        expect(key).toBe(deriveInternalKey(env));
        expect(verifyInternalRequest(hdr(key), env)).toEqual({ ok: true, via: 'derived' });
        expect(acceptedInternalSecrets(env)).toEqual([key]);
    });

    it('rechaza cabecera ausente, incorrecta o con la clave de OTRA instancia', () => {
        const env = { NEXTAUTH_SECRET: 'n', NODE_ENV: 'production' };
        expect(verifyInternalRequest(hdr(undefined), env)).toEqual({ ok: false });
        expect(verifyInternalRequest(hdr('cualquiera'), env)).toEqual({ ok: false });
        expect(verifyInternalRequest(hdr(deriveInternalKey({ NEXTAUTH_SECRET: 'otra' })!), env)).toEqual({ ok: false });
    });

    it('INTERNAL_SECRET, solo si esta definido, tambien se acepta (compat) y es lo que se envia', () => {
        const env = { NEXTAUTH_SECRET: 'n', INTERNAL_SECRET: 'legado-123', NODE_ENV: 'production' };
        expect(internalSecretToSend(env)).toBe('legado-123');
        expect(verifyInternalRequest(hdr('legado-123'), env)).toEqual({ ok: true, via: 'env' });
        expect(verifyInternalRequest(hdr(deriveInternalKey(env)!), env)).toEqual({ ok: true, via: 'derived' });
        expect(verifyInternalRequest(hdr('otro'), env)).toEqual({ ok: false });
    });

    it('sin ningun secreto: cerrado en produccion, abierto en desarrollo (como antes)', () => {
        expect(verifyInternalRequest(hdr('x'), { NODE_ENV: 'production' })).toEqual({ ok: false });
        expect(verifyInternalRequest(hdr(undefined), { NODE_ENV: 'development' })).toEqual({ ok: true, via: 'dev-open' });
    });
});
