import { describe, expect, it } from 'vitest';
import { classifyForDisplay, linkLeavesSender, noticeText, parseExternalPolicy, subjectWithTag, type ExternalPolicy } from '../external-display';

const policy = (over: Partial<ExternalPolicy> = {}): ExternalPolicy => ({
    enabled: true, style: 'info', subjectTag: true, colleagueSpoof: true, firstTime: true, hardenLinks: true, hardenAttachments: true,
    text: { es: 'Aviso es', en: 'Notice en' }, internalDomains: ['empresa.test'], trusted: [{ t: 'domain', v: 'socio.test', s: false }, { t: 'email', v: 'ana@otro.test', s: false }],
    ...over,
});

describe('classifyForDisplay', () => {
    it('remitente interno: ni externo ni aviso', () => {
        const v = classifyForDisplay(policy(), 'Luis <luis@empresa.test>');
        expect(v).toEqual({ external: false, trusted: false, warn: false, colleagueSpoof: false, firstTime: false });
        // subdominio interno
        expect(classifyForDisplay(policy(), 'x@ventas.empresa.test').external).toBe(false);
    });

    it('remitente externo no confiable: aviso', () => {
        const v = classifyForDisplay(policy(), 'Proveedor <ventas@proveedor.test>');
        expect(v).toMatchObject({ external: true, trusted: false, warn: true, colleagueSpoof: false, firstTime: false });
    });

    it('externo de confianza (dominio o correo): sin aviso', () => {
        expect(classifyForDisplay(policy(), 'a@socio.test')).toMatchObject({ external: true, trusted: true, warn: false });
        expect(classifyForDisplay(policy(), 'Ana <ana@otro.test>')).toMatchObject({ external: true, trusted: true, warn: false });
        expect(classifyForDisplay(policy(), 'otra@otro.test')).toMatchObject({ trusted: false, warn: true });
    });

    it('suplantacion de companero: el nombre menciona el dominio propio con direccion externa; la confianza NO la silencia', () => {
        const spoof = classifyForDisplay(policy(), '"Soporte empresa.test" <x@socio.test>');
        expect(spoof).toMatchObject({ external: true, trusted: true, colleagueSpoof: true, warn: true });
        // y con el indicador guardado por el servidor (nombres internos), aunque el navegador no los conozca
        expect(classifyForDisplay(policy(), 'Laura Gomez <laura@socio.test>', null, { colleagueSpoof: true })).toMatchObject({ colleagueSpoof: true, warn: true });
        // politica sin deteccion de suplantacion: se ignora incluso lo guardado
        expect(classifyForDisplay(policy({ colleagueSpoof: false }), 'Laura <laura@socio.test>', null, { colleagueSpoof: true })).toMatchObject({ colleagueSpoof: false, warn: false });
    });

    it('primera vez: solo si la politica lo activa y el servidor lo marco', () => {
        expect(classifyForDisplay(policy(), 'a@nuevo.test', null, { firstTime: true }).firstTime).toBe(true);
        expect(classifyForDisplay(policy({ firstTime: false }), 'a@nuevo.test', null, { firstTime: true }).firstTime).toBe(false);
        expect(classifyForDisplay(policy(), 'a@nuevo.test').firstTime).toBe(false);
    });

    it('sin politica / desactivada / sin direccion / mi propia direccion: nada', () => {
        const none = { external: false, trusted: false, warn: false, colleagueSpoof: false, firstTime: false };
        expect(classifyForDisplay(null, 'a@x.test')).toEqual(none);
        expect(classifyForDisplay(policy({ enabled: false }), 'a@x.test')).toEqual(none);
        expect(classifyForDisplay(policy(), 'sin direccion')).toEqual(none);
        expect(classifyForDisplay(policy(), 'Yo <yo@casa.test>', 'yo@casa.test')).toEqual(none);
        // el dominio del propio usuario cuenta como interno
        expect(classifyForDisplay(policy(), 'colega@casa.test', 'yo@casa.test').external).toBe(false);
    });
});

describe('subjectWithTag', () => {
    it('antepone la etiqueta por idioma y NO modifica el original', () => {
        const original = 'Factura de marzo';
        const copy = String(original);
        expect(subjectWithTag(original, policy(), 'es')).toBe('[EXTERNO] Factura de marzo');
        expect(subjectWithTag(original, policy(), 'en')).toBe('[EXTERNAL] Factura de marzo');
        expect(original).toBe(copy);
    });

    it('no etiqueta si la politica no lo pide, esta desactivada o el remitente no avisa; no duplica', () => {
        expect(subjectWithTag('Hola', policy({ subjectTag: false }), 'es')).toBe('Hola');
        expect(subjectWithTag('Hola', policy({ enabled: false }), 'es')).toBe('Hola');
        expect(subjectWithTag('Hola', null, 'es')).toBe('Hola');
        expect(subjectWithTag('Hola', policy(), 'es', { external: true, trusted: true, warn: false, colleagueSpoof: false, firstTime: false })).toBe('Hola');
        expect(subjectWithTag('[EXTERNO] Hola', policy(), 'es')).toBe('[EXTERNO] Hola');
        expect(subjectWithTag('', policy(), 'es')).toBe('[EXTERNO]');
    });
});

describe('parseExternalPolicy y utilidades', () => {
    it('es tolerante con formas inesperadas', () => {
        expect(parseExternalPolicy(null)).toBeNull();
        expect(parseExternalPolicy({ foo: 1 })).toBeNull();
        const p = parseExternalPolicy({ enabled: true, style: 'raro', text: null, internalDomains: ['a.test', 3], trusted: [{ t: 'regex', v: 'x', s: false }, { t: 'email', v: 'a@b.test', s: true }, 7] })!;
        expect(p.style).toBe('info');
        expect(p.internalDomains).toEqual(['a.test']);
        expect(p.trusted).toEqual([{ t: 'email', v: 'a@b.test', s: true }]);
        expect(p.text).toEqual({ es: '', en: '' });
    });

    it('noticeText usa el idioma pedido', () => {
        expect(noticeText(policy(), 'es')).toBe('Aviso es');
        expect(noticeText(policy(), 'en')).toBe('Notice en');
    });

    it('linkLeavesSender compara dominios registrables', () => {
        expect(linkLeavesSender('https://www.proveedor.test/x', 'proveedor.test')).toBe(false);
        expect(linkLeavesSender('https://news.proveedor.test/x', 'mail.proveedor.test')).toBe(false);
        expect(linkLeavesSender('https://evil.test/x', 'proveedor.test')).toBe(true);
        expect(linkLeavesSender('https://a.co.uk/x', 'b.co.uk')).toBe(true);
        expect(linkLeavesSender('mailto:a@b.test', 'proveedor.test')).toBe(false);
        expect(linkLeavesSender('no es url', 'proveedor.test')).toBe(false);
    });
});
