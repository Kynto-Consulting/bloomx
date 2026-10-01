import { beforeEach, describe, expect, it, vi } from 'vitest';

const lookupMock = vi.hoisted(() => vi.fn());
vi.mock('node:dns', () => ({ lookup: lookupMock, default: { lookup: lookupMock } }));

import { UnsafeUrlError, assertSafeBaseUrl, isPrivateIp, parseSafeBaseUrl } from '../url-guard';

const reason = (u: unknown) => { try { parseSafeBaseUrl(u); return null; } catch (e) { return e instanceof UnsafeUrlError ? e.reason : 'other'; } };

describe('parseSafeBaseUrl', () => {
    it('acepta https publico y normaliza la barra final', () => {
        expect(parseSafeBaseUrl('https://api.example.com/v1/').toString()).toBe('https://api.example.com/v1');
        expect(parseSafeBaseUrl('https://api.example.com:8443/v1').port).toBe('8443');
        expect(parseSafeBaseUrl('https://api.example.com:443').hostname).toBe('api.example.com');
    });
    it('rechaza http, credenciales, query/fragmento, no URL', () => {
        expect(reason('http://api.example.com')).toBe('not_https');
        expect(reason('https://user:pw@api.example.com')).toBe('credentials');
        expect(reason('https://user@api.example.com')).toBe('credentials');
        expect(reason('https://api.example.com/v1?x=1')).toBe('query_or_fragment');
        expect(reason('https://api.example.com/v1#x')).toBe('query_or_fragment');
        expect(reason('nope')).toBe('invalid');
        expect(reason(42)).toBe('invalid');
        expect(reason('')).toBe('invalid');
        expect(reason('ftp://x.com')).toBe('not_https');
    });
    it('rechaza IPs privadas v4/v6 y mapeadas', () => {
        for (const h of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '[::1]', '[fd00::1]', '[fe80::1]', '[::ffff:127.0.0.1]', '[::ffff:10.0.0.1]', '[::ffff:7f00:1]'])
            expect(reason(`https://${h}/v1`), h).toBe('private_ip');
    });
    it('rechaza formas numericas / hex de IP', () => {
        for (const h of ['2130706433', '0x7f.1', '0x7f000001', '017700000001', '127.1', '0177.0.0.1'])
            expect(reason(`https://${h}/`), h).not.toBeNull();
    });
    it('rechaza localhost, *.internal, *.local y hosts sin punto', () => {
        for (const h of ['localhost', 'foo.localhost', 'db.internal', 'printer.local', 'intranet', 'metadata.google.internal', 'x.corp', 'localhost.'])
            expect(reason(`https://${h}/`), h).toBe('internal_host');
    });
    it('puertos <1024 distintos de 443 rechazados', () => {
        expect(reason('https://api.example.com:22')).toBe('port');
        expect(reason('https://api.example.com:80')).toBe('port');
        expect(reason('https://api.example.com:1024')).toBeNull();
    });
});

describe('isPrivateIp', () => {
    it('publicas vs privadas', () => {
        expect(isPrivateIp('8.8.8.8')).toBe(false);
        expect(isPrivateIp('2606:4700:4700::1111')).toBe(false);
        expect(isPrivateIp('::ffff:8.8.8.8')).toBe(false);
        expect(isPrivateIp('::ffff:192.168.0.1')).toBe(true);
        expect(isPrivateIp('172.32.0.1')).toBe(false);
        expect(isPrivateIp('224.0.0.1')).toBe(true);
        expect(isPrivateIp('basura')).toBe(true);
    });
});

describe('assertSafeBaseUrl (DNS)', () => {
    beforeEach(() => lookupMock.mockReset());
    const resolves = (addrs: string[]) => lookupMock.mockImplementation((...a: any[]) => { const cb = a[a.length - 1]; if (typeof cb === 'function') cb(null, addrs.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))); });

    it('acepta si todas las direcciones son publicas', async () => {
        resolves(['93.184.216.34']);
        await expect(assertSafeBaseUrl('https://api.example.com/v1')).resolves.toBeInstanceOf(URL);
    });
    it('rechaza si una sola direccion resuelta es privada (DNS rebinding)', async () => {
        resolves(['93.184.216.34', '10.0.0.7']);
        await expect(assertSafeBaseUrl('https://api.example.com')).rejects.toMatchObject({ reason: 'private_ip' });
        resolves(['::1']);
        await expect(assertSafeBaseUrl('https://api.example.com')).rejects.toMatchObject({ reason: 'private_ip' });
        resolves(['169.254.169.254']);
        await expect(assertSafeBaseUrl('https://metadata.example.com')).rejects.toBeInstanceOf(UnsafeUrlError);
    });
    it('error de DNS -> UnsafeUrlError dns', async () => {
        lookupMock.mockImplementation((...a: any[]) => { const cb = a[a.length - 1]; if (typeof cb === 'function') cb(new Error('ENOTFOUND')); });
        await expect(assertSafeBaseUrl('https://nope.example.com')).rejects.toMatchObject({ reason: 'dns' });
    });
    it('lista vacia falla cerrado', async () => {
        resolves([]);
        await expect(assertSafeBaseUrl('https://empty.example.com')).rejects.toMatchObject({ reason: 'private_ip' });
    });
});
