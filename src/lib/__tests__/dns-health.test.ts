import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
    checkDomainDns, clearDnsCache, getDnsHealth, isPlausibleDomain, parseDkim, parseDmarc, parseMx, parseSpf,
    DKIM_SELECTOR_RE, type DnsResolver,
} from '../admin/dns-health';

const err = (code: string) => Object.assign(new Error(code), { code });

function fakeResolver(txt: Record<string, string[][] | Error | 'hang'>, mx: { exchange: string; priority: number }[] | Error | 'hang' = []): DnsResolver & { calls: string[] } {
    const calls: string[] = [];
    return {
        calls,
        async resolveTxt(name) {
            calls.push(`txt:${name}`);
            const v = txt[name];
            if (v === 'hang') return new Promise(() => undefined);
            if (v === undefined) throw err('ENODATA');
            if (v instanceof Error) throw v;
            return v;
        },
        async resolveMx(name) {
            calls.push(`mx:${name}`);
            if (mx === 'hang') return new Promise(() => undefined);
            if (mx instanceof Error) throw mx;
            return mx;
        },
    };
}

describe('parseSpf', () => {
    it('sin registro -> missing', () => {
        expect(parseSpf(['google-site-verification=abc'])).toMatchObject({ status: 'missing', record: null, notes: ['spf_missing'] });
    });
    it('-all con include de Resend/SES -> ok', () => {
        const r = parseSpf(['v=spf1 include:amazonses.com include:_spf.google.com -all']);
        expect(r.status).toBe('ok');
        expect(r.includes).toBe(2);
        expect(r.notes).toEqual(expect.arrayContaining(['spf_hardfail', 'spf_sender_include']));
        const r2 = parseSpf(['v=spf1 include:send.resend.com ~all']);
        expect(r2.status).toBe('ok');
        expect(r2.notes).toContain('spf_softfail');
    });
    it('+all es un aviso grave; ?all tambien', () => {
        expect(parseSpf(['v=spf1 include:amazonses.com +all'])).toMatchObject({ status: 'warn' });
        expect(parseSpf(['v=spf1 include:amazonses.com +all']).notes).toContain('spf_allow_all');
        expect(parseSpf(['v=spf1 include:amazonses.com all']).notes).toContain('spf_allow_all');
        expect(parseSpf(['v=spf1 include:amazonses.com ?all']).notes).toContain('spf_neutral');
    });
    it('sin mecanismo final o sin proveedor de envio -> warn', () => {
        expect(parseSpf(['v=spf1 include:amazonses.com']).notes).toContain('spf_no_all');
        const r = parseSpf(['v=spf1 include:_spf.google.com -all']);
        expect(r.status).toBe('warn');
        expect(r.notes).toContain('spf_no_sender_include');
    });
    it('mas de 10 consultas DNS -> warn', () => {
        const includes = Array.from({ length: 11 }, (_, i) => `include:s${i}.example.com`).join(' ');
        const r = parseSpf([`v=spf1 include:amazonses.com ${includes} -all`]);
        expect(r.lookups).toBe(12);
        expect(r.status).toBe('warn');
        expect(r.notes).toContain('spf_too_many_lookups');
    });
    it('varios registros SPF -> warn; ptr -> warn', () => {
        expect(parseSpf(['v=spf1 include:amazonses.com -all', 'v=spf1 -all']).notes).toContain('spf_multiple');
        expect(parseSpf(['v=spf1 ptr include:amazonses.com -all']).notes).toContain('spf_ptr');
    });
    it('recorta el registro a 500 caracteres', () => {
        const r = parseSpf([`v=spf1 include:amazonses.com ${'ip4:1.2.3.4 '.repeat(100)}-all`]);
        expect(r.record!.length).toBe(500);
    });
});

describe('parseDkim', () => {
    it('con p= -> ok', () => {
        const r = parseDkim(['v=DKIM1; k=rsa; p=MIGfMA0GCSq'], 'resend', ['resend']);
        expect(r).toMatchObject({ status: 'ok', selector: 'resend' });
        expect(r.notes).toContain('dkim_key_present');
    });
    it('sin p= -> warn; p= vacio (revocada) -> warn', () => {
        expect(parseDkim(['v=DKIM1; k=rsa'], 's', ['s'])).toMatchObject({ status: 'warn', notes: ['dkim_no_public_key'] });
        expect(parseDkim(['v=DKIM1; p='], 's', ['s']).notes).toContain('dkim_revoked');
    });
    it('modo de pruebas t=y -> warn', () => {
        expect(parseDkim(['v=DKIM1; t=y; p=ABC'], 's', ['s']).status).toBe('warn');
    });
    it('vacio -> missing', () => {
        expect(parseDkim([], null, ['a', 'b'])).toMatchObject({ status: 'missing', record: null, selectorsTried: ['a', 'b'] });
    });
});

describe('parseDmarc', () => {
    it('reject / quarantine -> ok; none -> warn', () => {
        expect(parseDmarc(['v=DMARC1; p=reject; rua=mailto:a@b.co'])).toMatchObject({ status: 'ok', policy: 'reject' });
        expect(parseDmarc(['v=DMARC1; p=quarantine; rua=mailto:a@b.co']).status).toBe('ok');
        const none = parseDmarc(['v=DMARC1; p=none']);
        expect(none.status).toBe('warn');
        expect(none.notes).toEqual(expect.arrayContaining(['dmarc_policy_none', 'dmarc_no_rua']));
    });
    it('sin rua solo informa; pct<100 avisa; sin p= es invalido', () => {
        expect(parseDmarc(['v=DMARC1; p=reject']).status).toBe('ok');
        expect(parseDmarc(['v=DMARC1; p=reject; pct=50']).notes).toContain('dmarc_pct_partial');
        expect(parseDmarc(['v=DMARC1; rua=mailto:a@b.co'])).toMatchObject({ status: 'warn', policy: null });
    });
    it('sin registro -> missing; duplicado -> warn', () => {
        expect(parseDmarc([]).status).toBe('missing');
        expect(parseDmarc(['v=DMARC1; p=reject', 'v=DMARC1; p=none']).notes).toContain('dmarc_multiple');
    });
});

describe('parseMx', () => {
    it('ordena por prioridad y distingue redundancia', () => {
        const r = parseMx([{ exchange: 'b.mx', priority: 20 }, { exchange: 'a.mx', priority: 10 }]);
        expect(r.status).toBe('ok');
        expect(r.hosts[0].exchange).toBe('a.mx');
        expect(r.notes).toEqual(['mx_redundant']);
        expect(parseMx([{ exchange: 'a.mx', priority: 10 }]).notes).toEqual(['mx_single']);
    });
    it('vacio -> missing; MX nulo -> warn', () => {
        expect(parseMx([]).status).toBe('missing');
        expect(parseMx([{ exchange: '', priority: 0 }]).status).toBe('warn');
    });
});

describe('checkDomainDns con resolvedor falso', () => {
    const good = () => fakeResolver(
        {
            'acme.com': [['v=spf1 include:amazonses.com ', '-all']],
            '_dmarc.acme.com': [['v=DMARC1; p=reject; rua=mailto:r@acme.com']],
            'resend._domainkey.acme.com': [['v=DKIM1; p=KEY']],
        },
        [{ exchange: 'mx.acme.com', priority: 10 }],
    );

    it('todo correcto (une los fragmentos TXT)', async () => {
        const res = good();
        const h = await checkDomainDns('acme.com', { resolver: res });
        expect(h).toMatchObject({ configured: true, domain: 'acme.com' });
        expect(h.spf?.status).toBe('ok');
        expect(h.spf?.record).toBe('v=spf1 include:amazonses.com -all');
        expect(h.dkim).toMatchObject({ status: 'ok', selector: 'resend' });
        expect(h.dmarc?.status).toBe('ok');
        expect(h.mx?.status).toBe('ok');
        // Sin selector: prueba los habituales
        expect(res.calls).toEqual(expect.arrayContaining(['txt:default._domainkey.acme.com', 'txt:google._domainkey.acme.com', 'txt:selector1._domainkey.acme.com', 'txt:k1._domainkey.acme.com']));
    });

    it('con selector explicito solo consulta ese', async () => {
        const res = good();
        await checkDomainDns('acme.com', { resolver: res, selector: 'miselector' });
        expect(res.calls.filter((c) => c.includes('_domainkey'))).toEqual(['txt:miselector._domainkey.acme.com']);
    });

    it('registros inexistentes -> missing', async () => {
        const h = await checkDomainDns('vacio.com', { resolver: fakeResolver({}, err('ENODATA') as any) });
        expect([h.spf?.status, h.dkim?.status, h.dmarc?.status, h.mx?.status]).toEqual(['missing', 'missing', 'missing', 'missing']);
    });

    it('timeout o error del servidor DNS -> status error sin lanzar', async () => {
        vi.useFakeTimers();
        try {
            const p = checkDomainDns('lento.com', {
                resolver: fakeResolver({ 'lento.com': 'hang', '_dmarc.lento.com': err('ESERVFAIL'), 'resend._domainkey.lento.com': 'hang' }, 'hang'),
                selector: 'resend',
                timeoutMs: 3000,
            });
            await vi.advanceTimersByTimeAsync(3100);
            const h = await p;
            expect(h.spf).toMatchObject({ status: 'error', notes: ['dns_error'] });
            expect(h.dmarc?.status).toBe('error');
            expect(h.mx?.status).toBe('error');
            expect(h.dkim?.status).toBe('error');
        } finally {
            vi.useRealTimers();
        }
    });

    it('DKIM: si un selector falla por error y otro existe, gana el que existe', async () => {
        const res = fakeResolver({ 'x.com': [['v=spf1 -all']], 'default._domainkey.x.com': [['v=DKIM1; p=AAA']], 'resend._domainkey.x.com': err('ETIMEOUT') });
        const h = await checkDomainDns('x.com', { resolver: res });
        expect(h.dkim).toMatchObject({ status: 'ok', selector: 'default' });
    });
});

describe('cache de 60 s', () => {
    beforeEach(() => clearDnsCache());
    it('reutiliza el resultado hasta 60 s y fresh lo omite', async () => {
        const res = fakeResolver({ 'c.com': [['v=spf1 -all']] }, []);
        await getDnsHealth('c.com', { resolver: res, nowMs: 1_000 });
        const n = res.calls.length;
        await getDnsHealth('c.com', { resolver: res, nowMs: 30_000 });
        expect(res.calls.length).toBe(n);
        await getDnsHealth('c.com', { resolver: res, nowMs: 30_000, fresh: true });
        expect(res.calls.length).toBe(n * 2);
        await getDnsHealth('c.com', { resolver: res, nowMs: 100_000 });
        expect(res.calls.length).toBe(n * 3);
    });
});

describe('validaciones', () => {
    it('selector DKIM', () => {
        for (const ok of ['resend', 'k1', 'a-b', 's2024']) expect(DKIM_SELECTOR_RE.test(ok)).toBe(true);
        for (const bad of ['', '-a', 'A', 'a.b', 'a_b', 'a b', 'x'.repeat(64), 'a/../b']) expect(DKIM_SELECTOR_RE.test(bad)).toBe(false);
    });
    it('dominio plausible', () => {
        expect(isPlausibleDomain('mail.acme.com')).toBe(true);
        for (const bad of ['localhost', '127.0.0.1', 'a b.com', '', undefined, 'x.com:3000']) expect(isPlausibleDomain(bad as any)).toBe(false);
    });
});
