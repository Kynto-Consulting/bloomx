import { describe, expect, it } from 'vitest';
import { parseTransportDetails } from '../email-auth';

describe('parseTransportDetails', () => {
    it('extrae cifrado, dominios y proveedor de las cabeceras', () => {
        const d = parseTransportDetails({
            'Return-Path': '<bounce@mail.spendbase.com>',
            'DKIM-Signature': 'v=1; a=rsa-sha256; d=spendbase.com; s=k1',
            Received: [
                'from mx.google.com (mx.google.com [1.2.3.4]) by inbound.resend.com with ESMTPS (version=TLSv1.3 cipher=TLS_AES_256_GCM_SHA384); Fri, 8 May 2026 04:24:00 +0000',
                'from mail-sor-f41.google.com by mx.google.com with SMTP',
            ],
            'Message-ID': '<abc@spendbase.com>',
        });
        expect(d).toMatchObject({
            mailedBy: 'mail.spendbase.com', signedBy: 'spendbase.com', encrypted: true,
            tlsVersion: 'TLSv1.3', cipher: 'TLS_AES_256_GCM_SHA384', receivedBy: 'inbound.resend.com', messageId: '<abc@spendbase.com>',
        });
        expect(d?.provider).toBe('Google');
    });
    it('marca sin cifrado y devuelve null sin datos', () => {
        expect(parseTransportDetails({ Received: 'from a.b by c.d with SMTP; x' })?.encrypted).toBe(false);
        expect(parseTransportDetails({})).toBeNull();
        expect(parseTransportDetails(null)).toBeNull();
    });
});
