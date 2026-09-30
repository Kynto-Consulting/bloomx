import { describe, it, expect } from 'vitest';
import { parseAuthenticationResults } from '../email-auth';

describe('parseAuthenticationResults', () => {
    it('devuelve null sin cabeceras de autenticacion', () => {
        expect(parseAuthenticationResults(null)).toBeNull();
        expect(parseAuthenticationResults({ subject: 'x' })).toBeNull();
    });

    it('lee SPF/DKIM/DMARC de Authentication-Results (nombre de cabecera insensible a mayusculas)', () => {
        const r = parseAuthenticationResults({
            'Authentication-Results': 'mx.example.com; spf=pass smtp.mailfrom=a@x.com; dkim=pass header.d=x.com; dmarc=pass header.from=x.com',
        });
        expect(r).toMatchObject({ spf: 'pass', dkim: 'pass', dmarc: 'pass', summary: 'verified', trusted: true });
    });

    it('marca failed si algun mecanismo falla y DMARC no pasa', () => {
        const r = parseAuthenticationResults({ 'authentication-results': 'mx; spf=fail; dkim=none; dmarc=fail' });
        expect(r?.summary).toBe('failed');
    });

    it('partial cuando solo SPF pasa', () => {
        const r = parseAuthenticationResults({ 'authentication-results': 'mx; spf=pass; dkim=none; dmarc=none' });
        expect(r?.summary).toBe('partial');
    });

    it('usa Received-SPF como respaldo', () => {
        const r = parseAuthenticationResults({ 'received-spf': 'pass (google.com: domain ok)' });
        expect(r?.spf).toBe('pass');
    });

    it('trusted=false si hay Authentication-Results contradictorios (posible falsificacion)', () => {
        const r = parseAuthenticationResults({
            'authentication-results': ['mx; dmarc=fail; spf=fail', 'attacker.example; dmarc=pass; spf=pass'],
        });
        expect(r?.dmarc).toBe('fail');
        expect(r?.trusted).toBe(false);
    });

    it('valores desconocidos dan unknown', () => {
        const r = parseAuthenticationResults({ 'authentication-results': 'mx; spf=weird; dkim=pass' });
        expect(r?.spf).toBe('unknown');
        expect(r?.dkim).toBe('pass');
    });
});
