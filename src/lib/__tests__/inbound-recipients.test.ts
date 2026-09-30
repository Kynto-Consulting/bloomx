import { describe, it, expect } from 'vitest';
import {
    collectAddresses,
    collectInboundRecipients,
    isUniqueViolation,
    recipientsForUser,
    stableStorageId,
    userScopedMessageId,
} from '../inbound-recipients';

describe('collectAddresses', () => {
    it('acepta string, lista con comillas, objetos y arreglos mixtos', () => {
        expect(collectAddresses('"Doe, John" <J@X.com>, b@y.com')).toEqual(['j@x.com', 'b@y.com']);
        expect(collectAddresses([{ email: 'A@B.com', name: 'A' }, 'C <c@d.com>'])).toEqual(['a@b.com', 'c@d.com']);
        expect(collectAddresses(undefined)).toEqual([]);
        expect(collectAddresses('sin-arroba')).toEqual([]);
    });
});

describe('collectInboundRecipients', () => {
    it('reconoce correos dirigidos solo por CC/BCC', () => {
        const r = collectInboundRecipients({ to: [], cc: ['Yo <me@x.com>'], bcc: 'oculto@x.com' });
        expect(r.to).toEqual([]);
        expect(r.all).toEqual(['me@x.com', 'oculto@x.com']);
        expect(r.lookupKeys).toContain('me@x.com');
    });

    it('incluye la forma tal cual y la normalizada, sin duplicados', () => {
        const r = collectInboundRecipients({ to: ['john.doe+news@x.com'], cc: ['john.doe+news@x.com'] });
        expect(r.all).toEqual(['john.doe+news@x.com']);
        expect(r.lookupKeys).toEqual(['john.doe+news@x.com', 'johndoe@x.com']);
    });

    it('tolera un payload sin destinatarios', () => {
        expect(collectInboundRecipients(null).all).toEqual([]);
    });
});

describe('recipientsForUser', () => {
    it('devuelve solo las direcciones que resuelven a ese usuario', () => {
        expect(recipientsForUser('johndoe@x.com', ['john.doe+news@x.com', 'otro@x.com'])).toEqual(['john.doe+news@x.com']);
    });
});

describe('idempotencia', () => {
    it('stableStorageId es determinista y tiene forma de UUID', () => {
        const a = stableStorageId('msg-1');
        expect(a).toBe(stableStorageId('msg-1'));
        expect(a).not.toBe(stableStorageId('msg-2'));
        expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('userScopedMessageId no duplica el sufijo en reintentos', () => {
        const once = userScopedMessageId('<abc@mail>', 'u1', 'fallback');
        expect(once).toBe('<abc@mail>-u1');
        expect(userScopedMessageId(once, 'u1', 'fallback')).toBe(once);
        expect(userScopedMessageId('', 'u1', 'fallback')).toBe('fallback-u1');
    });

    it('isUniqueViolation detecta P2002', () => {
        expect(isUniqueViolation({ code: 'P2002' })).toBe(true);
        expect(isUniqueViolation({ code: 'P2025' })).toBe(false);
        expect(isUniqueViolation(new Error('x'))).toBe(false);
        expect(isUniqueViolation(null)).toBe(false);
    });
});
