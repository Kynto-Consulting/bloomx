import { describe, it, expect } from 'vitest';
import { evaluateRules, validateRuleInput, type Rule, type RuleEmail } from '../engine';
import { parseSearchQuery, buildOperatorFilters } from '../search';
import { validateUserRegex, safeRegexTest, MAX_REGEX_LENGTH } from '../regex-safety';
import { validateLabelInput } from '../label-validation';
import { aliasSuffixFor } from '../alias';

const email = (o: Partial<RuleEmail> = {}): RuleEmail => ({
    from: 'Ana <ana@shop.com>', to: 'me@x.com', subject: 'Factura de octubre', body: 'Adjunto su factura',
    hasAttachment: true, labelIds: [], ...o,
});
const rule = (o: Partial<Rule>): Rule => ({
    id: 'r1', enabled: true, priority: 0, stopProcessing: false, actions: [],
    conditions: { match: 'all', items: [] }, ...o,
});

describe('motor de reglas', () => {
    it('AND / OR de condiciones', () => {
        const items: any[] = [
            { field: 'from', op: 'contains', value: 'shop.com' },
            { field: 'subject', op: 'contains', value: 'nada' },
        ];
        const all = rule({ conditions: { match: 'all', items }, actions: [{ type: 'markRead' }] });
        expect(evaluateRules(email(), [all]).appliedRuleIds).toEqual([]);
        const any = { ...all, conditions: { match: 'any' as const, items } };
        expect(evaluateRules(email(), [any]).markRead).toBe(true);
    });

    it('soporta equals, regex, hasAttachment y label', () => {
        const r = (items: any[]) => rule({ conditions: { match: 'all', items }, actions: [{ type: 'star' }] });
        expect(evaluateRules(email({ subject: 'Hola' }), [r([{ field: 'subject', op: 'equals', value: 'hola' }])]).star).toBe(true);
        expect(evaluateRules(email(), [r([{ field: 'subject', op: 'regex', value: '^factura\\b' }])]).star).toBe(true);
        expect(evaluateRules(email({ hasAttachment: false }), [r([{ field: 'hasAttachment', value: true }])]).star).toBe(false);
        expect(evaluateRules(email({ labelIds: ['L1'] }), [r([{ field: 'label', value: 'L1' }])]).star).toBe(true);
        expect(evaluateRules(email({ labelIds: [], labelNames: ['Work'] }), [r([{ field: 'label', value: 'work' }])]).star).toBe(true);
    });

    it('regex peligrosa nunca coincide ni bloquea', () => {
        const r = rule({ conditions: { match: 'all', items: [{ field: 'body', op: 'regex', value: '(a+)+$' }] }, actions: [{ type: 'star' }] });
        const t = Date.now();
        expect(evaluateRules(email({ body: 'a'.repeat(50) + '!' }), [r]).star).toBe(false);
        expect(Date.now() - t).toBeLessThan(200);
    });

    it('orden por prioridad, stopProcessing y la primera carpeta gana', () => {
        const base = { conditions: { match: 'all' as const, items: [{ field: 'from' as const, op: 'contains' as const, value: 'ana' }] } };
        const rules = [
            rule({ ...base, id: 'b', priority: 2, actions: [{ type: 'delete' }, { type: 'addLabel', labelId: 'LB' }] }),
            rule({ ...base, id: 'a', priority: 1, actions: [{ type: 'archive' }, { type: 'addLabel', labelId: 'LA' }], stopProcessing: true }),
        ];
        const fx = evaluateRules(email(), rules);
        expect(fx.appliedRuleIds).toEqual(['a']);
        expect(fx.folder).toBe('archive');
        expect(fx.addLabelIds).toEqual(['LA']);
        const fx2 = evaluateRules(email(), [rules[0], { ...rules[1], stopProcessing: false }]);
        expect(fx2.appliedRuleIds).toEqual(['a', 'b']);
        expect(fx2.folder).toBe('archive');
        expect(new Set(fx2.addLabelIds)).toEqual(new Set(['LA', 'LB']));
    });

    it('es idempotente y no encadena reglas', () => {
        const rules = [
            rule({ id: '1', priority: 1, conditions: { match: 'all', items: [{ field: 'from', op: 'contains', value: 'ana' }] }, actions: [{ type: 'addLabel', labelId: 'X' }] }),
            rule({ id: '2', priority: 2, conditions: { match: 'all', items: [{ field: 'label', value: 'X' }] }, actions: [{ type: 'star' }] }),
        ];
        const e = email();
        const a = evaluateRules(e, rules);
        expect(a.star).toBe(false);
        expect(evaluateRules(e, rules)).toEqual(a);
    });

    it('ignora reglas deshabilitadas y reglas sin condiciones', () => {
        const disabled = rule({ enabled: false, conditions: { match: 'all', items: [{ field: 'from', op: 'contains', value: 'ana' }] }, actions: [{ type: 'star' }] });
        expect(evaluateRules(email(), [disabled]).star).toBe(false);
        expect(evaluateRules(email(), [rule({ actions: [{ type: 'delete' }] })]).folder).toBeNull();
    });

    it('validateRuleInput rechaza entradas invalidas y regex peligrosos', () => {
        const ok = { conditions: { match: 'any', items: [{ field: 'from', op: 'contains', value: 'x' }] }, actions: [{ type: 'archive' }] };
        expect(validateRuleInput(ok).ok).toBe(true);
        expect(validateRuleInput({ ...ok, actions: [] }).ok).toBe(false);
        expect(validateRuleInput({ ...ok, actions: [{ type: 'moveToFolder', folder: 'sent' }] }).ok).toBe(false);
        expect(validateRuleInput({ ...ok, actions: [{ type: 'rm -rf' }] }).ok).toBe(false);
        expect(validateRuleInput({ ...ok, conditions: { items: [{ field: 'subject', op: 'regex', value: '(x+)+y' }] } }).ok).toBe(false);
        expect(validateRuleInput({ ...ok, conditions: { items: [] } }).ok).toBe(false);
    });
});

describe('parseSearchQuery', () => {
    it('extrae operadores y texto libre', () => {
        const p = parseSearchQuery('hola label:Trabajo from:ana@x.com to:bob subject:"plan q4" has:attachment is:unread mundo');
        expect(p.text).toBe('hola mundo');
        expect(p.labels).toEqual(['Trabajo']);
        expect(p.from).toEqual(['ana@x.com']);
        expect(p.to).toEqual(['bob']);
        expect(p.subject).toEqual(['plan q4']);
        expect(p.hasAttachment).toBe(true);
        expect(p.unread).toBe(true);
    });
    it('acepta comillas y clave sin distinguir mayusculas', () => {
        expect(parseSearchQuery('LABEL:"Mis facturas"').labels).toEqual(['Mis facturas']);
    });
    it('deja como texto claves desconocidas, valores vacios y horas', () => {
        expect(parseSearchQuery('foo:bar 12:30 label:').text).toBe('foo:bar 12:30 label:');
        expect(parseSearchQuery('has:nada is:raro').text).toBe('has:nada is:raro');
    });
    it('vacio / nulo y limite de longitud', () => {
        expect(parseSearchQuery(null).text).toBe('');
        expect(parseSearchQuery('a'.repeat(1000)).text.length).toBeLessThanOrEqual(300);
    });
    it('is:read + is:unread se anulan; genera filtros Prisma', () => {
        const f = buildOperatorFilters(parseSearchQuery('is:read is:unread is:starred label:x'));
        expect(f).toContainEqual({ starred: true });
        expect(f.find((x) => 'read' in x)).toBeUndefined();
        expect(f).toContainEqual({ labels: { some: { name: { equals: 'x', mode: 'insensitive' } } } });
    });
});

describe('validacion de regex', () => {
    it('acepta patrones normales', () => {
        for (const p of ['factura', '^\\[SPAM\\]', 'inv(oice)?-\\d{4}', '(foo|bar)baz', '[a-z]+@shop\\.com']) {
            expect(validateUserRegex(p).ok, p).toBe(true);
        }
    });
    it('rechaza ReDoS clasico, backrefs, lookarounds, longitud e invalidos', () => {
        const bad = ['(a+)+$', '(a*)*b', '(a|aa)+c', '(.*a){20}x', '(\\d+)*$', '(a+){2,}', '(a)\\1', '(?=a)b', '(?<!a)b', '(unclosed', 'a)', '[', 'x'.repeat(MAX_REGEX_LENGTH + 1), '', '(a|b*)+'];
        for (const p of bad) expect(validateUserRegex(p).ok, p).toBe(false);
    });
    it('safeRegexTest no lanza, trunca la entrada y es rapido', () => {
        expect(safeRegexTest('(a+)+$', 'a'.repeat(40) + '!')).toBe(false);
        expect(safeRegexTest('x', 'a'.repeat(30000) + 'x')).toBe(false);
        expect(safeRegexTest('HOLA', 'hola mundo')).toBe(true);
        expect(safeRegexTest('(', 'x')).toBe(false);
    });
});

describe('validateLabelInput', () => {
    it('normaliza y valida', () => {
        const r = validateLabelInput({ name: '  Trabajo ', color: '#ABCDEF', aliasSuffix: ' News ', filterRegex: 'boletin' }, false);
        expect(r).toEqual({ ok: true, data: { name: 'Trabajo', color: '#abcdef', aliasSuffix: 'news', filterRegex: 'boletin' } });
    });
    it('rechaza nombre vacio, color invalido, alias con @ o +, regex peligrosa', () => {
        expect(validateLabelInput({ name: ' ' }, false).ok).toBe(false);
        expect(validateLabelInput({ name: 'a', color: 'red' }, false).ok).toBe(false);
        expect(validateLabelInput({ name: 'a', aliasSuffix: 'a+b' }, false).ok).toBe(false);
        expect(validateLabelInput({ name: 'a', aliasSuffix: 'a@b' }, false).ok).toBe(false);
        expect(validateLabelInput({ name: 'a', filterRegex: '(a+)+$' }, false).ok).toBe(false);
        expect(validateLabelInput({ name: 'a,b' }, false).ok).toBe(false);
    });
    it('parcial: cadena vacia borra alias/regex', () => {
        expect(validateLabelInput({ aliasSuffix: '', filterRegex: '' }, true)).toEqual({ ok: true, data: { aliasSuffix: null, filterRegex: null } });
        expect(validateLabelInput({}, true)).toEqual({ ok: true, data: {} });
    });
});

describe('aliasSuffixFor', () => {
    it('detecta alias solo del propio usuario', () => {
        expect(aliasSuffixFor('bob@x.com', 'bob+news@x.com')).toBe('news');
        expect(aliasSuffixFor('bob@x.com', 'b.o.b+News@X.com')).toBe('news');
        expect(aliasSuffixFor('bob@x.com', 'bobby+news@x.com')).toBeNull();
        expect(aliasSuffixFor('bob@x.com', 'bob+news@otro.com')).toBeNull();
        expect(aliasSuffixFor('bob@x.com', 'bob@x.com')).toBeNull();
    });
});
