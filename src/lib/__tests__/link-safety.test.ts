import { describe, it, expect } from 'vitest';
import { analyzeLink, registrableDomain, extractVisibleDomain } from '../link-safety';

describe('analyzeLink', () => {
    it('no marca un enlace normal ni mailto', () => {
        expect(analyzeLink('Ver factura', 'https://www.empresa.com/factura/1')).toBeNull();
        expect(analyzeLink('https://empresa.com/x', 'https://www.empresa.com/y')).toBeNull();
        expect(analyzeLink('escribe', 'mailto:a@x.com')).toBeNull();
    });

    it('marca cuando el texto muestra otro dominio', () => {
        const r = analyzeLink('https://paypal.com/login', 'https://paypa1-secure.example.net/login');
        expect(r?.host).toBe('paypa1-secure.example.net');
        expect(r?.reasons).toContain('mismatch');
    });

    it('un subdominio del mismo dominio registrable no es discrepancia', () => {
        expect(analyzeLink('mail.empresa.com', 'https://click.empresa.com/r?id=1')).toBeNull();
        expect(analyzeLink('tienda.co.uk', 'https://www.tienda.co.uk/')).toBeNull();
        expect(analyzeLink('tienda.co.uk', 'https://otra.co.uk/')?.reasons).toContain('mismatch');
    });

    it('marca punycode, IP, credenciales en la URL y acortadores', () => {
        expect(analyzeLink('entrar', 'https://xn--pypal-4ve.com/')?.reasons).toContain('punycode');
        expect(analyzeLink('entrar', 'http://192.168.1.10/login')?.reasons).toContain('ip');
        expect(analyzeLink('https://banco.com', 'https://banco.com@evil.io/')?.reasons).toEqual(expect.arrayContaining(['userinfo', 'mismatch']));
        expect(analyzeLink('mira', 'https://bit.ly/abc')?.reasons).toContain('shortener');
    });

    it('href invalido o esquema no http devuelve null', () => {
        expect(analyzeLink('x', 'not a url')).toBeNull();
        expect(analyzeLink('x', 'javascript:alert(1)')).toBeNull();
    });
});

describe('helpers', () => {
    it('registrableDomain', () => {
        expect(registrableDomain('www.a.b.empresa.com')).toBe('empresa.com');
        expect(registrableDomain('x.empresa.com.mx')).toBe('empresa.com.mx');
    });
    it('extractVisibleDomain', () => {
        expect(extractVisibleDomain('https://Banco.com/login')).toBe('banco.com');
        expect(extractVisibleDomain('Haz clic aqui')).toBeNull();
        expect(extractVisibleDomain('Sr.Perez')).toBeNull();
    });
});
