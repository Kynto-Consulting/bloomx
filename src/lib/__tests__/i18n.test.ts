import { describe, expect, it } from 'vitest';
import {
    DEFAULT_LOCALE,
    LOCALES,
    createTranslator,
    dictionaries,
    fallbackChain,
    flattenMessages,
    getTranslator,
    interpolate,
    isLocale,
    negotiateLocale,
    parseAcceptLanguage,
    resolveLocale,
    type NestedMessages,
} from '../i18n';

describe('parseAcceptLanguage / negotiateLocale', () => {
    it('ordena por q y respeta el orden del header en empates', () => {
        const r = parseAcceptLanguage('en;q=0.5, es-PE, fr;q=0.9');
        expect(r.map((x) => x.tag)).toEqual(['es-pe', 'fr', 'en']);
    });

    it('elige el primer idioma soportado por prioridad', () => {
        expect(negotiateLocale('es-PE,es;q=0.9,en;q=0.8')).toBe('es');
        expect(negotiateLocale('en-US,en;q=0.9')).toBe('en');
        expect(negotiateLocale('fr-FR,fr;q=0.9,en;q=0.8')).toBe('en');
        expect(negotiateLocale('EN-gb')).toBe('en');
    });

    it('devuelve null si nada coincide o el header es basura', () => {
        expect(negotiateLocale('fr,de;q=0.8')).toBeNull();
        expect(negotiateLocale('')).toBeNull();
        expect(negotiateLocale(null)).toBeNull();
        expect(negotiateLocale(undefined)).toBeNull();
        expect(negotiateLocale('*')).toBeNull();
        expect(negotiateLocale('es;q=0')).toBeNull(); // q=0 = "no aceptable"
        expect(negotiateLocale(';;;,,,')).toBeNull();
    });
});

describe('resolveLocale', () => {
    it('la cookie del usuario gana sobre Accept-Language', () => {
        expect(resolveLocale({ cookie: 'en', acceptLanguage: 'es-PE,es' })).toBe('en');
        expect(resolveLocale({ cookie: 'es', acceptLanguage: 'en-US' })).toBe('es');
    });
    it('cookie invalida -> Accept-Language -> defecto', () => {
        expect(resolveLocale({ cookie: 'xx', acceptLanguage: 'en-US' })).toBe('en');
        expect(resolveLocale({ cookie: '<script>', acceptLanguage: null })).toBe(DEFAULT_LOCALE);
        expect(resolveLocale({})).toBe(DEFAULT_LOCALE);
        expect(resolveLocale({ acceptLanguage: 'fr' })).toBe(DEFAULT_LOCALE);
    });
    it('isLocale', () => {
        expect(isLocale('es')).toBe(true);
        expect(isLocale('fr')).toBe(false);
        expect(isLocale(undefined)).toBe(false);
    });
});

describe('createTranslator (fallback)', () => {
    const dicts = {
        es: { a: { hola: 'Hola {name}', solo_es: 'Solo en español' } },
        en: { a: { hola: 'Hello {name}', solo_en: 'English only' } },
    } as Record<'es' | 'en', NestedMessages>;

    it('traduce e interpola', () => {
        expect(createTranslator('en', dicts).t('a.hola', { name: 'Ana' })).toBe('Hello Ana');
        expect(createTranslator('es', dicts).t('a.hola', { name: 'Ana' })).toBe('Hola Ana');
    });

    it('si falta la clave en el idioma activo cae al idioma por defecto', () => {
        expect(createTranslator('en', dicts).t('a.solo_es')).toBe('Solo en español');
    });

    it('si tampoco esta en el defecto cae a ingles; si no existe en ninguno devuelve la clave', () => {
        const onlyEn = { en: { x: 'X in english' } } as any;
        expect(createTranslator('es', onlyEn).t('x')).toBe('X in english');
        expect(createTranslator('en', dicts).t('no.existe')).toBe('no.existe');
    });

    it('un diccionario ausente no rompe', () => {
        expect(createTranslator('en', {}).t('k')).toBe('k');
    });

    it('has() solo mira el idioma activo', () => {
        const tr = createTranslator('en', dicts);
        expect(tr.has('a.solo_en')).toBe(true);
        expect(tr.has('a.solo_es')).toBe(false);
    });

    it('interpolate deja visibles los parametros ausentes', () => {
        expect(interpolate('Hola {name} {x}', { name: 'Ana' })).toBe('Hola Ana {x}');
        expect(interpolate('sin params')).toBe('sin params');
        expect(interpolate('{n} min', { n: 30 })).toBe('30 min');
    });

    it('la cadena de respaldo no repite idiomas', () => {
        expect(fallbackChain('es')).toEqual(['es', 'en']);
        expect(fallbackChain('en')).toEqual(['en', 'es']);
    });
});

describe('diccionarios reales es/en', () => {
    const es = flattenMessages(dictionaries.es!);
    const en = flattenMessages(dictionaries.en!);

    it('tienen exactamente las mismas claves', () => {
        const missingInEn = Object.keys(es).filter((k) => !(k in en));
        const missingInEs = Object.keys(en).filter((k) => !(k in es));
        expect(missingInEn).toEqual([]);
        expect(missingInEs).toEqual([]);
    });

    it('no hay cadenas vacias', () => {
        for (const [k, v] of [...Object.entries(es), ...Object.entries(en)]) {
            expect(v.trim().length, k).toBeGreaterThan(0);
        }
    });

    it('los parametros {x} coinciden entre idiomas', () => {
        const params = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
        for (const k of Object.keys(es)) expect(params(en[k]), k).toBe(params(es[k]));
    });

    it('el traductor real resuelve claves del layout y de auth en ambos idiomas', () => {
        for (const l of LOCALES) {
            const tr = getTranslator(l);
            expect(tr.t('auth.login.title')).not.toBe('auth.login.title');
            expect(tr.t('layout.reauthMeetReason')).not.toBe('layout.reauthMeetReason');
            expect(tr.t('admin.users.searchPlaceholder')).not.toBe('admin.users.searchPlaceholder');
        }
        expect(getTranslator('es').t('auth.login.title')).not.toBe(getTranslator('en').t('auth.login.title'));
    });

    it('getTranslator cachea por idioma', () => {
        expect(getTranslator('es')).toBe(getTranslator('es'));
    });
});
