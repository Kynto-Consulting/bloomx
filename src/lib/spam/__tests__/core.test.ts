import { describe, expect, it } from 'vitest';
import {
    PRESET_THRESHOLDS, SUSPICIOUS_MARGIN, bandOf, decisionFor, defaultSpamConfig, effectiveThreshold, normalizeDomain, sanitizePlainText, sanitizeSpamConfig,
} from '../config-core';
import { CompiledList, MAX_LIST_ENTRIES, blockGuard, dedupeKey, identityOf, normalizeEntry } from '../lists-core';
import { csvToInputs, entriesToCsv, parseCsv } from '../lists-csv';
import { classify, fnv1a, tokenize, type Model } from '../bayes';
import { classifyExternal } from '../external';
import { packVerdict, unpackVerdict, rawSignalsOf, MAX_REASONS_BYTES } from '../verdict';
import { aggregateSignals } from '../engine';
import { DEFAULT_ENGINE_CONFIG } from '../engine';
import type { Signal } from '../types';

const NOW = new Date('2026-05-04T10:00:00Z');
const E = (matchType: string, value: string, includeSubdomains = false, extra: Record<string, unknown> = {}) =>
    ({ id: `${matchType}:${value}`, matchType: matchType as never, value, includeSubdomains, expiresAt: null, ...extra });

describe('presets, umbrales y bandas', () => {
    it('presets de nivel', () => {
        expect(PRESET_THRESHOLDS).toEqual({ low: 80, balanced: 65, strict: 50, max: 35 });
        for (const [level, thr] of Object.entries(PRESET_THRESHOLDS)) {
            const c = sanitizeSpamConfig({ level, threshold: 12 });
            expect(c.threshold).toBe(thr);
        }
        expect(sanitizeSpamConfig({ level: 'custom', threshold: 72 }).threshold).toBe(72);
        expect(defaultSpamConfig({}).level).toBe('balanced');
        expect(defaultSpamConfig({}).threshold).toBe(65);
    });
    it('compatibilidad con las variables de entorno antiguas', () => {
        expect(defaultSpamConfig({ ENABLE_AUTO_SPAM_DETECTION: 'false' }).level).toBe('off');
        const c = defaultSpamConfig({ SPAM_SCORE_THRESHOLD: '70' });
        expect(c.level).toBe('custom');
        expect(c.threshold).toBe(70);
        expect(defaultSpamConfig({ SPAM_SCORE_THRESHOLD: 'abc' }).level).toBe('balanced');
    });
    it('bandas: limpio / sospechoso (umbral-15) / spam', () => {
        const c = sanitizeSpamConfig({ level: 'balanced' });
        expect(bandOf(49, c)).toBe('clean');
        expect(bandOf(65 - SUSPICIOUS_MARGIN, c)).toBe('suspicious');
        expect(bandOf(64, c)).toBe('suspicious');
        expect(bandOf(65, c)).toBe('spam');
        expect(bandOf(100, sanitizeSpamConfig({ level: 'off' }))).toBe('clean');
    });
    it('accion por banda: entregar, advertir, carpeta spam; limpio siempre entrega', () => {
        const c = sanitizeSpamConfig({ actions: { suspicious: 'warn', spam: 'spam' } });
        expect(decisionFor('clean', c)).toEqual({ decision: 'delivered', folder: 'inbox' });
        expect(decisionFor('suspicious', c)).toEqual({ decision: 'warned', folder: 'inbox' });
        expect(decisionFor('spam', c)).toEqual({ decision: 'spam', folder: 'spam' });
        const c2 = sanitizeSpamConfig({ actions: { suspicious: 'spam', spam: 'warn', clean: 'spam' } });
        expect(decisionFor('suspicious', c2).folder).toBe('spam');
        expect(decisionFor('spam', c2).decision).toBe('warned');
        expect(decisionFor('clean', c2).folder).toBe('inbox'); // "clean" no se puede enviar a spam
        expect(sanitizeSpamConfig({ actions: { spam: 'reject' } }).actions.spam).toBe('spam'); // rechazar nunca por score
    });
    it('sensibilidad del usuario +-1 nivel solo si el dominio lo permite', () => {
        const c = sanitizeSpamConfig({ level: 'balanced', allowUserSensitivity: true });
        expect(effectiveThreshold(c, 1)).toBe(55);
        expect(effectiveThreshold(c, -1)).toBe(75);
        expect(effectiveThreshold(c, 5)).toBe(55);
        expect(effectiveThreshold({ ...c, allowUserSensitivity: false }, 1)).toBe(65);
        expect(effectiveThreshold({ ...c, level: 'off' }, 1)).toBeNull();
    });
});

describe('saneado de la configuracion', () => {
    it('acota pesos 0-2, umbral 1-100 y descarta basura', () => {
        const c = sanitizeSpamConfig({ level: 'custom', threshold: 999, familyWeights: { auth: 9, content: -3, links: 'x' }, logRetentionDays: 99999, evil: { a: 1 } });
        expect(c.threshold).toBe(100);
        expect(c.familyWeights.auth).toBe(2);
        expect(c.familyWeights.content).toBe(0);
        expect(c.familyWeights.links).toBe(1);
        expect(c.logRetentionDays).toBe(365);
        expect((c as unknown as Record<string, unknown>).evil).toBeUndefined();
    });
    it('textos del aviso: planos, sin HTML ni caracteres de direccion, acotados', () => {
        const c = sanitizeSpamConfig({ external: { text: { es: '<script>alert(1)</script>Ojo‮ con esto', en: 'x'.repeat(1000) } } });
        expect(c.external.text.es).not.toMatch(/[<>‮]/);
        expect(c.external.text.en.length).toBe(300);
        expect(sanitizePlainText(12)).toBe('');
    });
    it('dominios internos: normalizados, validos, sin duplicados', () => {
        const c = sanitizeSpamConfig({ external: { internalDomains: ['Filial.COM', '@filial.com', '*.otra.org', 'no es dominio', 'http://x', 'a..b'] } });
        expect(c.external.internalDomains).toEqual(['filial.com', 'otra.org']);
        expect(normalizeDomain('ejemplo.com.')).toBe('ejemplo.com');
    });
    it('es idempotente', () => {
        const a = sanitizeSpamConfig({ level: 'strict', external: { enabled: true, style: 'info' } });
        expect(sanitizeSpamConfig(a)).toEqual(a);
    });
});

describe('listas: validacion y coincidencia', () => {
    const ok = (t: string, v: string, sub = false) => { const n = normalizeEntry({ matchType: t as never, value: v, includeSubdomains: sub }, NOW); if (!n.ok) throw new Error(n.error); return n; };
    it('normaliza y rechaza valores invalidos', () => {
        expect(ok('email', ' Ana@Ejemplo.COM ').value).toBe('ana@ejemplo.com');
        expect(ok('domain', 'Ejemplo.com').value).toBe('ejemplo.com');
        expect(ok('domain', '*.ejemplo.com').includeSubdomains).toBe(true);
        expect(ok('wildcard', '*@Ejemplo.com').value).toBe('*@ejemplo.com');
        expect(ok('tld', '.XYZ').value).toBe('xyz');
        for (const [t, v] of [['email', 'sin-arroba'], ['domain', 'localhost'], ['tld', 'x'], ['tld', 'a.b'], ['wildcard', '*@'], ['email', ''], ['domain', 'a'.repeat(300) + '.com']] as const) {
            expect(normalizeEntry({ matchType: t, value: v }, NOW).ok).toBe(false);
        }
        expect(normalizeEntry({ matchType: 'nope' as never, value: 'x' }).ok).toBe(false);
    });
    it('coincidencias exactas, subdominios, comodin, TLD', () => {
        const l = new CompiledList([E('email', 'ana@ejemplo.com'), E('domain', 'malo.com', true), E('domain', 'solo.net'), E('wildcard', '*@wild.org'), E('tld', 'xyz')], NOW);
        expect(l.match(identityOf('ana@ejemplo.com'))).not.toBeNull();
        expect(l.match(identityOf('otra@ejemplo.com'))).toBeNull();
        expect(l.match(identityOf('x@malo.com'))).not.toBeNull();
        expect(l.match(identityOf('x@a.b.malo.com'))).not.toBeNull(); // subdominios
        expect(l.match(identityOf('x@solo.net'))).not.toBeNull();
        expect(l.match(identityOf('x@sub.solo.net'))).toBeNull(); // sin opcion subdominios
        expect(l.match(identityOf('x@notmalo.com'))).toBeNull(); // no es un sufijo de etiqueta
        expect(l.match(identityOf('cualquiera@wild.org'))).not.toBeNull();
        expect(l.match(identityOf('x@algo.xyz'))).not.toBeNull();
        expect(l.match({ email: '', domain: 'firmante.malo.com' })).not.toBeNull(); // dominio DKIM sin direccion
    });
    it('regex acotada: segura se aplica, hostil se rechaza y nunca cuelga', () => {
        expect(normalizeEntry({ matchType: 'regex', value: '(a+)+$' }).ok).toBe(false);
        expect(normalizeEntry({ matchType: 'regex', value: '(a|aa)*b' }).ok).toBe(false);
        expect(normalizeEntry({ matchType: 'regex', value: '(?=x)y' }).ok).toBe(false);
        expect(normalizeEntry({ matchType: 'regex', value: 'x'.repeat(250) }).ok).toBe(false);
        expect(normalizeEntry({ matchType: 'regex', value: '[' }).ok).toBe(false);
        const l = new CompiledList([E('regex', '^promo\\d+@')], NOW);
        expect(l.match(identityOf('promo123@x.com'))).not.toBeNull();
        expect(l.match(identityOf('ana@x.com'))).toBeNull();
        // Aunque alguien consiga guardar una regex peligrosa, compileSafeRegex la ignora
        const evil = new CompiledList([E('regex', '(a+)+$')], NOW);
        const t0 = Date.now();
        expect(evil.match({ email: 'a'.repeat(5000) + '!', domain: 'x.com' })).toBeNull();
        expect(Date.now() - t0).toBeLessThan(200);
    });
    it('caducidad: al compilar y al usar', () => {
        const soon = new Date(NOW.getTime() + 60_000);
        const l = new CompiledList([E('domain', 'temporal.com', false, { expiresAt: soon }), E('domain', 'vieja.com', false, { expiresAt: new Date(NOW.getTime() - 1) })], NOW);
        expect(l.size).toBe(1);
        expect(l.match(identityOf('x@temporal.com'), NOW)).not.toBeNull();
        expect(l.match(identityOf('x@temporal.com'), new Date(NOW.getTime() + 120_000))).toBeNull();
        expect(l.match(identityOf('x@vieja.com'), NOW)).toBeNull();
        expect(normalizeEntry({ matchType: 'domain', value: 'x.com', expiresAt: new Date(NOW.getTime() - 5) }, NOW)).toEqual({ ok: false, error: 'expiry_in_past' });
        expect(normalizeEntry({ matchType: 'domain', value: 'x.com', expiresAt: 'no' }, NOW).ok).toBe(false);
    });
    it('dedupe key y tope', () => {
        expect(dedupeKey({ matchType: 'domain', value: 'a.com', includeSubdomains: false })).not.toBe(dedupeKey({ matchType: 'domain', value: 'a.com', includeSubdomains: true }));
        expect(MAX_LIST_ENTRIES).toBe(10_000);
    });
    it('guardas: no se bloquea el propio dominio ni a los administradores', () => {
        const prot = { ownDomains: ['mail.acme.test'], adminEmails: ['jefe@gmail.com'] };
        const g = (t: string, v: string, sub = false) => { const n = ok(t, v, sub); return blockGuard(n, prot); };
        expect(g('domain', 'mail.acme.test')).toBe('protected_own_domain');
        expect(g('domain', 'sub.mail.acme.test')).toBe('protected_own_domain');
        expect(g('domain', 'acme.test', true)).toBe('protected_own_domain'); // padre con subdominios cubre el propio
        expect(g('wildcard', '*@mail.acme.test')).toBe('protected_own_domain');
        expect(g('email', 'postmaster@mail.acme.test')).toBe('protected_own_domain');
        expect(g('tld', 'test')).toBe('protected_own_domain');
        expect(g('regex', '@mail\\.acme\\.test$')).toBe('protected_own_domain');
        expect(g('email', 'ana@mail.acme.test')).toBe('protected_own_domain'); // cualquier buzon del propio dominio
        expect(g('email', 'jefe@gmail.com')).toBe('protected_admin');
        expect(g('domain', 'gmail.com')).toBe('protected_admin');
        expect(g('regex', 'gmail')).toBe('protected_admin');
        expect(g('domain', 'spam.example')).toBeNull();
        expect(g('domain', 'acme.test', false)).toBeNull(); // padre exacto, sin subdominios: no afecta al propio
    });
});

describe('CSV de listas', () => {
    it('exporta e importa sin perder nada; neutraliza formulas', () => {
        const csv = entriesToCsv([
            { matchType: 'domain', value: 'malo.com', includeSubdomains: true, reason: 'spam, mucho', expiresAt: new Date('2027-01-01T00:00:00Z') },
            { matchType: 'email', value: 'a@b.com', includeSubdomains: false, reason: '=HYPERLINK("x")', expiresAt: null },
        ]);
        expect(csv).toContain("'=HYPERLINK");
        const back = csvToInputs(csv);
        expect(back.errors).toEqual([]);
        expect(back.entries).toHaveLength(2);
        expect(back.entries[0].input).toMatchObject({ matchType: 'domain', value: 'malo.com', includeSubdomains: true, reason: 'spam, mucho' });
    });
    it('acepta valores sueltos con tipo inferido, comillas y saltos de linea', () => {
        const r = csvToInputs('ana@x.com\n*@y.org\n.xyz\nz.net\n"a,b@c.com"\n');
        expect(r.entries.map((e) => e.input.matchType)).toEqual(['email', 'wildcard', 'tld', 'domain', 'email']);
        expect(parseCsv('a,"b\nc",d\r\n1,2,3')).toEqual([['a', 'b\nc', 'd'], ['1', '2', '3']]);
    });
    it('rechaza archivos enormes', () => {
        expect(csvToInputs('x'.repeat(3 * 1024 * 1024)).errors[0].error).toBe('too_large');
        expect(csvToInputs(Array.from({ length: 10_050 }, (_, i) => `d${i}.com`).join('\n')).errors[0].error).toBe('too_many_rows');
    });
});

describe('bayes', () => {
    const model = (spamTokens: string[], hamTokens: string[], ns = 10, nh = 10): Model => {
        const tokens = new Map<string, { spam: number; ham: number }>();
        for (const t of spamTokens) tokens.set(t, { spam: 8, ham: 0 });
        for (const t of hamTokens) tokens.set(t, { spam: 0, ham: 8 });
        return { spamMessages: ns, hamMessages: nh, tokens };
    };
    const msg = { subject: 'oferta exclusiva premio ganador', body: 'compra ahora premio ganador dinero facil inversion cripto', fromDomain: 'promo.example' };
    it('tokeniza de forma estable, acotada y sin duplicados', () => {
        const a = tokenize(msg);
        expect(a).toEqual(tokenize(msg));
        expect(new Set(a).size).toBe(a.length);
        expect(a.every((t) => /^[0-9a-f]{8}$/.test(t))).toBe(true);
        expect(fnv1a('x')).toBe(fnv1a('x'));
        expect(tokenize({ subject: '', body: 'palabra '.repeat(5000), fromDomain: '' }).length).toBeLessThanOrEqual(161);
    });
    it('direccion correcta: tokens de spam suben, de ham bajan; tope +-20', () => {
        const toks = tokenize(msg);
        const spammy = classify(toks, model(toks, []))!;
        const hammy = classify(toks, model([], toks))!;
        expect(spammy.points).toBeGreaterThan(10);
        expect(spammy.points).toBeLessThanOrEqual(20);
        expect(hammy.points).toBeLessThan(-10);
        expect(hammy.points).toBeGreaterThanOrEqual(-20);
    });
    it('no cuenta sin muestras suficientes ni con pocos tokens conocidos', () => {
        const toks = tokenize(msg);
        expect(classify(toks, model(toks, [], 2, 2))).toBeNull();
        expect(classify(toks, model(toks.slice(0, 2), []))).toBeNull();
        expect(classify(toks, { spamMessages: 0, hamMessages: 0, tokens: new Map() })).toBeNull();
    });
});

describe('externos', () => {
    const base = { internalDomains: ['acme.test', 'filial.org'] };
    it('interno, externo y externo de confianza', () => {
        expect(classifyExternal({ ...base, fromEmail: 'a@acme.test' }).external).toBe(false);
        expect(classifyExternal({ ...base, fromEmail: 'a@sub.acme.test' }).external).toBe(false);
        expect(classifyExternal({ ...base, fromEmail: 'a@filial.org' }).external).toBe(false);
        const ext = classifyExternal({ ...base, fromEmail: 'a@otro.com' });
        expect(ext).toMatchObject({ external: true, trusted: false, warn: true });
        const trusted = new CompiledList([E('domain', 'otro.com')], NOW);
        expect(classifyExternal({ ...base, fromEmail: 'a@otro.com', trusted })).toMatchObject({ external: true, trusted: true, warn: false });
        expect(classifyExternal({ ...base, fromEmail: 'nadie' }).external).toBe(false);
    });
    it('nombre de companero o dominio propio con direccion externa = suplantacion, aun en la whitelist', () => {
        const names = new Set(['laura gomez']);
        const trusted = new CompiledList([E('domain', 'otro.com')], NOW);
        const v = classifyExternal({ ...base, fromEmail: 'x@otro.com', fromName: 'Laura Gómez', internalNames: names, trusted });
        expect(v).toMatchObject({ colleagueSpoof: true, trusted: true, warn: true });
        expect(classifyExternal({ ...base, fromEmail: 'x@otro.com', fromName: 'Soporte acme.test' }).colleagueSpoof).toBe(true);
        expect(classifyExternal({ ...base, fromEmail: 'x@otro.com', fromName: 'Laura Gómez', internalNames: names, colleagueSpoof: false }).colleagueSpoof).toBe(false);
        expect(classifyExternal({ ...base, fromEmail: 'x@otro.com', fromName: 'Admin', internalNames: new Set(['admin']) }).colleagueSpoof).toBe(false); // un solo termino: demasiado comun
    });
    it('primera vez', () => {
        expect(classifyExternal({ ...base, fromEmail: 'x@otro.com', firstTime: true }).firstTime).toBe(true);
        expect(classifyExternal({ ...base, fromEmail: 'x@acme.test', firstTime: true }).firstTime).toBe(false);
    });
});

describe('veredicto guardado', () => {
    const sig = (id: string, family: Signal['family'], weight: number, critical = false, params?: Signal['params']): Signal => ({ id, family, weight, ...(critical ? { critical } : {}), ...(params ? { params } : {}) });
    it('cabe en 2 KB incluso con muchisimas senales y parametros largos', () => {
        const many = Array.from({ length: 200 }, (_, i) => sig(`content.lex.x${i}`, 'content', 5, false, { phrases: 'p'.repeat(200) }));
        const p = packVerdict({ decision: 'spam', band: 'spam', signals: many, raw: many });
        expect(JSON.stringify(p).length).toBeLessThanOrEqual(MAX_REASONS_BYTES);
        expect(p.sg.length).toBeGreaterThan(0);
    });
    it('ida y vuelta; tolera formas inesperadas', () => {
        const p = packVerdict({ decision: 'warned', band: 'suspicious', signals: [sig('auth.spf_fail', 'auth', 18)], raw: [sig('auth.spf_fail', 'auth', 18, true)], ext: { f: 1 }, allowId: 'abc' });
        const back = unpackVerdict(JSON.parse(JSON.stringify(p)))!;
        expect(back.d).toBe('warned');
        expect(rawSignalsOf(back)[0]).toMatchObject({ id: 'auth.spf_fail', critical: true });
        for (const bad of [null, 5, 'x', {}, { v: 2 }, { v: 1, sg: 'no' }]) expect(unpackVerdict(bad)).toBeNull();
        expect(unpackVerdict({ v: 1, sg: [['a', 1], 'x', [3]], rw: 7, d: 'zzz', b: 'q' })).toMatchObject({ d: 'delivered', b: 'clean', sg: [['a', 1]], rw: [] });
    });
    it('re-simula con otra configuracion sin leer el correo', () => {
        const raw = [sig('content.lex.phishing', 'content', 30), sig('auth.spf_fail', 'auth', 18)];
        const a = aggregateSignals(raw, DEFAULT_ENGINE_CONFIG, false).score;
        const b = aggregateSignals(raw, { ...DEFAULT_ENGINE_CONFIG, familyWeights: { ...DEFAULT_ENGINE_CONFIG.familyWeights, content: 0 } }, false).score;
        expect(a).toBe(48);
        expect(b).toBe(18);
    });
});
