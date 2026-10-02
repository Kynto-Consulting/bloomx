import { describe, expect, it } from 'vitest';
import { centsToInput, formatCents, isCents, parseMoneyToCents, safeCents } from '../money';
import { PAYPAL_HOSTS, safePayPalUrl } from '../paypal-url';
import { bpsToPercentText, compareSemver, estimateNet, parseSemver, splitCents, validatePricing } from '../revenue';
import { CAPABILITY_REGISTRY } from '@/lib/expansions/client-contract';
import { CAPABILITY_CLASS, CLIENT_API_VERSION, CLIENT_CAPABILITIES, SIGNED_ONLY_CAPABILITIES, clientVersionHeaders } from '@/lib/expansions/client/capabilities';
import { manifestHints, slotForFileName, toPayload, withinLimit } from '@/components/admin/developer/files';

describe('importes en centavos (nunca floats)', () => {
    it('formatea centavos a texto en es y en', () => {
        expect(formatCents(0, 'USD', 'es')).toBe('0,00 USD');
        expect(formatCents(5, 'USD', 'es')).toBe('0,05 USD');
        expect(formatCents(1999, 'USD', 'es')).toBe('19,99 USD');
        expect(formatCents(1999, 'USD', 'en')).toBe('USD 19.99');
        expect(formatCents(123456789, 'USD', 'en')).toBe('USD 1,234,567.89');
        expect(formatCents(-250, 'USD', 'en')).toBe('USD -2.50');
    });
    it('el caso clasico 0,1 + 0,2: se suma en centavos y se muestra exacto', () => {
        expect(formatCents(10 + 20, 'USD', 'en')).toBe('USD 0.30');
    });
    it('valores no enteros o invalidos se muestran como 0 (nunca NaN ni decimales raros)', () => {
        expect(formatCents(NaN)).toBe('0,00 USD');
        expect(formatCents(12.5)).toBe('0,00 USD');
        expect(formatCents(null)).toBe('0,00 USD');
        expect(formatCents('100')).toBe('0,00 USD');
        expect(safeCents(Infinity)).toBe(0);
        expect(isCents(1.5)).toBe(false);
        expect(isCents(-1)).toBe(false);
    });
    it('parsea lo que escribe el usuario sin parseFloat', () => {
        expect(parseMoneyToCents('12')).toBe(1200);
        expect(parseMoneyToCents('12.5')).toBe(1250);
        expect(parseMoneyToCents('12,50')).toBe(1250);
        expect(parseMoneyToCents(' 0.07 ')).toBe(7);
        expect(parseMoneyToCents('19.99')).toBe(1999);
        for (const bad of ['', 'abc', '1.234', '-1', '1e3', '1,2,3', '$5', '12.']) expect(parseMoneyToCents(bad), bad).toBeNull();
        expect(centsToInput(1250)).toBe('12.50');
        expect(centsToInput(7)).toBe('0.07');
    });
});

describe('approveUrl / authorizeUrl de PayPal', () => {
    it('acepta solo https y los hosts fijos', () => {
        expect(PAYPAL_HOSTS).toEqual(['www.paypal.com', 'www.sandbox.paypal.com', 'paypal.com']);
        expect(safePayPalUrl('https://www.paypal.com/checkoutnow?token=ABC')).toBe('https://www.paypal.com/checkoutnow?token=ABC');
        expect(safePayPalUrl('https://www.sandbox.paypal.com/checkoutnow?token=ABC')).toContain('sandbox.paypal.com');
        expect(safePayPalUrl('https://paypal.com/x')).toBe('https://paypal.com/x');
    });
    it('rechaza http, otros hosts, subdominios enganosos, credenciales, puertos y esquemas peligrosos', () => {
        const bad = [
            'http://www.paypal.com/x', 'https://evil.com/x', 'https://www.paypal.com.evil.com/x', 'https://evilpaypal.com/x', 'https://paypal.com.evil.com',
            'https://www.paypal.com@evil.com/x', 'https://user:pw@www.paypal.com/x', 'https://www.paypal.com:8443/x', 'javascript:alert(1)', 'data:text/html,hi',
            '//www.paypal.com/x', 'www.paypal.com/x', '', 'https://sub.www.paypal.com/x',
        ];
        for (const u of bad) expect(safePayPalUrl(u), u).toBeNull();
        for (const v of [null, undefined, 5, {}, []]) expect(safePayPalUrl(v)).toBeNull();
        expect(safePayPalUrl('https://www.paypal.com/' + 'a'.repeat(3000))).toBeNull();
    });
});

describe('reparto 70/30 y neto estimado (el porcentaje viene del backend)', () => {
    it('reparte sin perder centavos: desarrollador + plataforma = bruto', () => {
        for (const gross of [1, 99, 100, 999, 1999, 12345]) {
            for (const bps of [0, 3333, 7000, 7250, 10000]) {
                const s = splitCents(gross, bps);
                expect(s.developerCents + s.platformCents).toBe(gross);
                expect(Number.isInteger(s.developerCents)).toBe(true);
            }
        }
        expect(splitCents(1000, 7000)).toEqual({ grossCents: 1000, developerCents: 700, platformCents: 300 });
        expect(splitCents(999, 7000).developerCents).toBe(699);
    });
    it('un bps invalido no da ganancia (falla cerrado)', () => {
        expect(splitCents(1000, -1).developerCents).toBe(0);
        expect(splitCents(1000, 10001).developerCents).toBe(0);
        expect(splitCents(1000, 70.5).developerCents).toBe(0);
    });
    it('neto por cobro y proyeccion anual segun el modelo', () => {
        const base = { oneTimeCents: 0, monthCents: 0, yearCents: 0, trialDays: 0 };
        expect(estimateNet({ ...base, model: 'free' }, 7000)).toEqual({ oneTime: null, month: null, year: null, annualMonthlyPlan: null, annualYearlyPlan: null });
        const sub = estimateNet({ ...base, model: 'subscription', monthCents: 500, yearCents: 5000 }, 7000);
        expect(sub.month?.developerCents).toBe(350);
        expect(sub.year?.developerCents).toBe(3500);
        expect(sub.annualMonthlyPlan).toBe(4200);
        expect(sub.annualYearlyPlan).toBe(3500);
        expect(estimateNet({ ...base, model: 'one_time', oneTimeCents: 1000 }, 6500).oneTime?.developerCents).toBe(650);
    });
    it('porcentaje legible sin floats y con otro reparto', () => {
        expect(bpsToPercentText(7000)).toBe('70');
        expect(bpsToPercentText(7250)).toBe('72,5');
        expect(bpsToPercentText(7250, '.')).toBe('72.5');
        expect(bpsToPercentText(7005)).toBe('70,05');
        expect(bpsToPercentText(-5)).toBe('0');
    });
    it('valida precios con los limites del backend y la prueba de 0 a 30 dias', () => {
        const limits = { minPriceCents: 99, maxPriceCents: 99900 };
        const base = { oneTimeCents: 0, monthCents: 0, yearCents: 0, trialDays: 0 };
        expect(validatePricing({ ...base, model: 'free' }, limits)).toEqual([]);
        expect(validatePricing({ ...base, model: 'one_time', oneTimeCents: 50 }, limits)).toEqual([{ field: 'oneTimeCents', code: 'min' }]);
        expect(validatePricing({ ...base, model: 'one_time', oneTimeCents: 100000 }, limits)).toEqual([{ field: 'oneTimeCents', code: 'max' }]);
        expect(validatePricing({ ...base, model: 'subscription' }, limits)).toEqual([{ field: 'plans', code: 'required' }]);
        expect(validatePricing({ ...base, model: 'subscription', monthCents: 500, trialDays: 31 }, limits)).toEqual([{ field: 'trialDays', code: 'trial' }]);
        expect(validatePricing({ ...base, model: 'subscription', monthCents: 500, yearCents: 5000, trialDays: 30 }, limits)).toEqual([]);
    });
    it('semver', () => {
        expect(parseSemver('1.2.3')).toEqual([1, 2, 3]);
        expect(parseSemver('1.2')).toBeNull();
        expect(parseSemver('1.2.3-beta')).toBeNull();
        expect(compareSemver('1.2.0', '1.10.0')).toBe(-1);
        expect(compareSemver('2.0.0', '1.99.99')).toBe(1);
        expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
        expect(compareSemver('x', '1.0.0')).toBeNull();
    });
});

describe('archivos del editor del portal', () => {
    it('clasifica por nombre y aplica los limites del overview', () => {
        expect(slotForFileName('manifest.json')).toBe('manifest');
        expect(slotForFileName('Server.JS')).toBe('serverJs');
        expect(slotForFileName('README.md')).toBe('readme');
        expect(slotForFileName('logo.svg')).toBe('icon');
        expect(slotForFileName('icon.webp')).toBe('icon');
        expect(slotForFileName('evil.exe')).toBeNull();
        expect(slotForFileName('a/b.png')).toBeNull();
        const limits = { maxManifestBytes: 1000, maxServerBytes: 5000 };
        expect(withinLimit(1000, 'manifest', limits)).toBe(true);
        expect(withinLimit(1001, 'manifest', limits)).toBe(false);
        expect(withinLimit(5001, 'serverJs', limits)).toBe(false);
        expect(withinLimit(NaN, 'serverJs', limits)).toBe(false);
    });
    it('payload y pistas del manifest', () => {
        expect(toPayload({})).toBeNull();
        expect(toPayload({ manifest: { name: 'manifest.json', bytes: 2, content: '{}' }, readme: { name: 'README.md', bytes: 1, content: 'x' } })).toEqual({ manifest: '{}', readme: 'x' });
        expect(manifestHints('{"id":"dev.a.b","version":"1.2.3"}')).toEqual({ id: 'dev.a.b', version: '1.2.3' });
        expect(manifestHints('no json')).toEqual({ id: null, version: null });
    });
});

describe('contrato de capacidades since 10', () => {
    it('billing.paypal.v1 y marketplace.developer.v1 estan registradas (es/en), anunciadas y son signed-only', () => {
        for (const id of ['billing.paypal.v1', 'marketplace.developer.v1']) {
            expect(CAPABILITY_REGISTRY[id]?.since, id).toBe(10);
            expect(CAPABILITY_REGISTRY[id].es.length).toBeGreaterThan(20);
            expect(CAPABILITY_REGISTRY[id].en.length).toBeGreaterThan(20);
            expect(CLIENT_CAPABILITIES).toContain(id);
            expect(CAPABILITY_CLASS[id]).toBe('signed-only');
            expect(SIGNED_ONLY_CAPABILITIES).toContain(id);
        }
    });
    it('CLIENT_API_VERSION es al menos 10 y una instancia sin clave no las anuncia', () => {
        expect(CLIENT_API_VERSION).toBeGreaterThanOrEqual(10);
        const unsigned = clientVersionHeaders(false)['X-BloomX-Client-Caps'];
        expect(unsigned).not.toContain('billing.paypal.v1');
        expect(unsigned).not.toContain('marketplace.developer.v1');
        const signed = clientVersionHeaders(true)['X-BloomX-Client-Caps'];
        expect(signed).toContain('billing.paypal.v1');
        expect(signed).toContain('marketplace.developer.v1');
    });
});
