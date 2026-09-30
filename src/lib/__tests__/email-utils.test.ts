import { describe, it, expect } from 'vitest';
import { splitAddressList, buildReplyAllRecipients } from '../email-utils';

describe('splitAddressList', () => {
    it('respeta comas dentro de comillas y separa por ; y ,', () => {
        expect(splitAddressList('"Doe, John" <j@x.com>, b@y.com; C <c@z.com>')).toEqual([
            '"Doe, John" <j@x.com>', 'b@y.com', 'C <c@z.com>',
        ]);
    });
});

describe('buildReplyAllRecipients', () => {
    it('incluye To y Cc originales, sin duplicados ni cuentas propias', () => {
        const r = buildReplyAllRecipients({
            from: 'Ana <ana@x.com>', to: 'me@me.com, "Lopez, Bo" <bo@y.com>',
            cc: 'cc1@z.com; ana@x.com', ownEmails: ['me@me.com'],
        });
        expect(r.to).toEqual(['Ana <ana@x.com>']);
        expect(r.cc).toEqual(['bo@y.com', 'cc1@z.com']);
    });
});
