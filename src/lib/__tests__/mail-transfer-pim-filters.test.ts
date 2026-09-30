import { describe, expect, it } from 'vitest';
import { buildGmailFiltersXml, buildGmailFiltersXmlEx, literalAlternatives, mapGmailFilter, parseGmailFilters, type GmailFilter } from '../mail-transfer/pim/gmail-filters';
import { evaluateRules, validateRuleInput, type Action, type Rule, type RuleEmail } from '../rules/engine';

const feed = (entries: string[]) => `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns='http://www.w3.org/2005/Atom' xmlns:apps='http://schemas.google.com/apps/2006'>
<title>Mail Filters</title><id>tag:mail.google.com,2008:filters:1</id><updated>2024-01-01T00:00:00Z</updated>
<author><name>Ana</name><email>ana@example.test</email></author>
${entries.map((e) => `<entry><category term='filter'></category><title>Mail Filter</title><id>tag:mail.google.com,2008:filter:1</id><updated>2024-01-01T00:00:00Z</updated><content></content>${e}</entry>`).join('\n')}
</feed>`;
const p = (n: string, v: string) => `<apps:property name='${n}' value='${v.replace(/&/g, '&amp;').replace(/'/g, '&apos;')}'/>`;

const one = (...props: Array<[string, string]>): GmailFilter => parseGmailFilters(feed([props.map(([n, v]) => p(n, v)).join('')])).filters[0];

describe('parseGmailFilters', () => {
    it('lee propiedades, booleanos, etiquetas, tamano y desconocidas', () => {
        const r = parseGmailFilters(feed([
            p('from', 'news@example.test') + p('subject', 'Oferta & mas') + p('hasAttachment', 'true') + p('label', 'Noticias') + p('shouldArchive', 'true')
            + p('shouldMarkAsRead', 'true') + p('sizeOperator', 's_sl') + p('sizeUnit', 's_smb') + p('size', '5') + p('rareza', 'x'),
            p('to', 'ana+lista@example.test') + p('shouldStar', 'true') + p('forwardTo', 'otro@example.test'),
            '',
        ]));
        expect(r.invalid).toBe(1);
        expect(r.filters).toHaveLength(2);
        expect(r.filters[0]).toMatchObject({
            from: 'news@example.test', subject: 'Oferta & mas', hasAttachment: true, label: 'Noticias', labels: ['Noticias'], shouldArchive: true,
            shouldMarkAsRead: true, sizeOperator: 's_sl', sizeUnit: 's_smb', size: 5, shouldStar: false, other: { rareza: 'x' },
        });
        expect(r.filters[1]).toMatchObject({ to: 'ana+lista@example.test', shouldStar: true, forwardTo: 'otro@example.test' });
    });

    it('XML hostil o invalido: nunca lanza (DOCTYPE/entidades, basura, Buffer)', () => {
        const xxe = `<?xml version='1.0'?><!DOCTYPE feed [<!ENTITY x SYSTEM "file:///etc/passwd">]><feed><entry><apps:property name='from' value='&x;'/></entry></feed>`;
        expect(parseGmailFilters(xxe)).toEqual({ filters: [], invalid: 1 });
        expect(parseGmailFilters('no es xml')).toEqual({ filters: [], invalid: 1 });
        expect(parseGmailFilters('')).toEqual({ filters: [], invalid: 1 });
        expect(parseGmailFilters(Buffer.from(feed([p('from', 'a@example.test') + p('shouldStar', 'true')]))).filters).toHaveLength(1);
        expect(parseGmailFilters('<feed xmlns:apps="x"><entry><apps:property name="from" value="a@b.test"/></feed>').invalid).toBe(1);
    });
});

describe('mapGmailFilter', () => {
    it('caso simple: from + etiqueta + archivar + leido', () => {
        const m = mapGmailFilter(one(['from', 'news@example.test'], ['label', 'Noticias'], ['shouldArchive', 'true'], ['shouldMarkAsRead', 'true']));
        expect(m.skipped).toBeNull();
        expect(m.rule).toEqual({
            name: 'Gmail: news@example.test',
            conditions: { match: 'all', items: [{ field: 'from', op: 'contains', value: 'news@example.test' }] },
            actions: [{ type: 'addLabelByName', name: 'Noticias' }, { type: 'markRead' }, { type: 'archive' }],
            stopProcessing: false,
        });
        expect(m.labelNames).toEqual(['Noticias']);
        expect(m.unmapped).toEqual([]);
    });

    it('lista OR de un solo campo -> match any; con otro campo -> regex segura validada', () => {
        const a = mapGmailFilter(one(['from', 'a@x.test OR b@x.test OR {c@x.test d@x.test}'], ['shouldStar', 'true']));
        expect(a.rule!.conditions.match).toBe('any');
        expect(a.rule!.conditions.items.map((i: any) => i.value)).toEqual(['a@x.test', 'b@x.test', 'c@x.test', 'd@x.test']);
        const b = mapGmailFilter(one(['from', 'a@x.test OR b.c@x.test'], ['subject', 'factura'], ['shouldStar', 'true']));
        expect(b.rule!.conditions).toEqual({
            match: 'all',
            items: [{ field: 'subject', op: 'contains', value: 'factura' }, { field: 'from', op: 'regex', value: 'a@x\\.test|b\\.c@x\\.test' }],
        });
        // la regla resultante pasa la validacion del API (regex segura)
        expect(validateRuleInput({ conditions: b.rule!.conditions, actions: [{ type: 'star' }] }).ok).toBe(true);
    });

    it('lista OR muy larga con otro campo: se divide en varias reglas equivalentes', () => {
        const emails = Array.from({ length: 20 }, (_, i) => `usuario${i}@dominio-largo.example.test`);
        const m = mapGmailFilter(one(['from', emails.join(' OR ')], ['hasAttachment', 'true'], ['shouldTrash', 'true']));
        expect(m.rules.length).toBeGreaterThan(1);
        for (const r of m.rules) {
            expect(validateRuleInput({ conditions: r.conditions, actions: [{ type: 'delete' }] }).ok).toBe(true);
        }
        // semantica: la union de las reglas coincide exactamente con las 20 direcciones
        const rules: Rule[] = m.rules.map((r, i) => ({ id: `r${i}`, enabled: true, priority: i, conditions: r.conditions, actions: [{ type: 'delete' }] as Action[], stopProcessing: false }));
        const em = (from: string, att = true): RuleEmail => ({ from, to: '', subject: '', body: '', hasAttachment: att, labelIds: [] });
        for (const e of emails) expect(evaluateRules(em(`X <${e}>`), rules).folder).toBe('trash');
        expect(evaluateRules(em('otro@dominio-largo.example.test'), rules).folder).toBeNull();
        expect(evaluateRules(em(emails[0], false), rules).folder).toBeNull();
    });

    it('hasTheWord: palabras (AND), frases, operadores from:/to:/subject:/has:attachment/label:', () => {
        const m = mapGmailFilter(one(['hasTheWord', 'factura "pago pendiente" from:banco@x.test has:attachment label:Finanzas'], ['shouldStar', 'true']));
        expect(m.skipped).toBeNull();
        expect(m.rule!.conditions).toEqual({
            match: 'all',
            items: [
                { field: 'body', op: 'contains', value: 'factura' }, { field: 'body', op: 'contains', value: 'pago pendiente' },
                { field: 'from', op: 'contains', value: 'banco@x.test' }, { field: 'hasAttachment', value: true }, { field: 'label', value: 'Finanzas' },
            ],
        });
        const g = mapGmailFilter(one(['hasTheWord', '(alfa OR beta)'], ['shouldStar', 'true']));
        expect(g.rule!.conditions.match).toBe('any');
        const o = mapGmailFilter(one(['hasTheWord', 'alfa OR beta gamma'], ['shouldStar', 'true']));
        expect(o.rule!.conditions.items).toHaveLength(2); // (alfa OR beta) AND gamma
        expect(o.rule!.conditions.items.map((i: any) => i.op).sort()).toEqual(['contains', 'regex']);
    });

    it('doesNotHaveTheWord, negaciones, size y operadores desconocidos: el filtro NO se crea (seria mas amplio)', () => {
        const a = mapGmailFilter(one(['from', 'a@x.test'], ['doesNotHaveTheWord', 'spam'], ['shouldTrash', 'true']));
        expect(a.rule).toBeNull();
        expect(a.skipped).toMatch(/mas amplia/);
        expect(a.unmapped.join('\n')).toMatch(/doesNotHaveTheWord: .*negacion.*lookahead/);
        expect(mapGmailFilter(one(['hasTheWord', 'oferta -gratis'], ['shouldTrash', 'true'])).rule).toBeNull();
        expect(mapGmailFilter(one(['from', 'a@x.test'], ['size', '5'], ['sizeOperator', 's_sl'], ['sizeUnit', 's_smb'], ['shouldTrash', 'true'])).unmapped.join()).toMatch(/size:/);
        expect(mapGmailFilter(one(['hasTheWord', 'larger:5M'], ['shouldStar', 'true'])).skipped).not.toBeNull();
        expect(mapGmailFilter(one(['hasTheWord', 'oferta "sin cerrar'], ['shouldStar', 'true'])).rule).toBeNull();
    });

    it("modo partial:'safe' crea la regla solo si las acciones son inocuas", () => {
        const safe = mapGmailFilter(one(['from', 'a@x.test'], ['doesNotHaveTheWord', 'x'], ['label', 'L']), { partial: 'safe' });
        expect(safe.rule).not.toBeNull();
        expect(safe.unmapped.join()).toMatch(/mas amplia/);
        const risky = mapGmailFilter(one(['from', 'a@x.test'], ['doesNotHaveTheWord', 'x'], ['shouldArchive', 'true']), { partial: 'safe' });
        expect(risky.rule).toBeNull();
    });

    it('forwardTo, neverSpam, importancia, categorias van a unmapped (nunca reenvio) pero el resto se crea', () => {
        const m = mapGmailFilter(one(['from', 'a@x.test'], ['forwardTo', 'ext@example.test'], ['shouldNeverSpam', 'true'], ['shouldAlwaysMarkAsImportant', 'true'],
            ['shouldNeverMarkAsImportant', 'true'], ['shouldCategorize', 'true'], ['smartLabelToApply', '^smartlabel_promo'], ['rareza', 'y']));
        expect(m.rule!.actions).toEqual([{ type: 'addLabelByName', name: 'Category Promotions' }]);
        const keys = m.unmapped.map((u) => u.split(':')[0]).sort();
        expect(keys).toEqual(['forwardTo', 'rareza', 'shouldAlwaysMarkAsImportant', 'shouldCategorize', 'shouldNeverMarkAsImportant', 'shouldNeverSpam']);
        expect(JSON.stringify(m.rules)).not.toMatch(/ext@example/);
    });

    it('sin condicion mapeable o sin accion mapeable no se crea', () => {
        expect(mapGmailFilter(one(['shouldArchive', 'true'])).skipped).toBe('sin condiciones mapeables');
        const nf = mapGmailFilter(one(['from', 'a@x.test'], ['forwardTo', 'b@x.test']));
        expect(nf.rule).toBeNull();
        expect(nf.skipped).toBe('sin acciones mapeables');
        expect(nf.unmapped.join()).toMatch(/forwardTo/);
    });

    it('trash gana sobre archive; etiqueta con coma/larga se ajusta y se informa', () => {
        const m = mapGmailFilter(one(['from', 'a@x.test'], ['shouldArchive', 'true'], ['shouldTrash', 'true'], ['label', 'Uno, dos ' + 'x'.repeat(80)]));
        expect(m.rule!.actions.map((a) => a.type)).toEqual(['addLabelByName', 'delete']);
        expect(m.labelNames[0]).toHaveLength(50);
        expect(m.labelNames[0]).not.toContain(',');
        expect(m.unmapped.join()).toMatch(/label: nombre ajustado/);
    });

    it('el resultado siempre valida con validateRuleInput una vez resuelto el nombre de etiqueta', () => {
        const m = mapGmailFilter(one(['from', 'a@x.test'], ['subject', 'hola mundo'], ['label', 'L'], ['shouldMarkAsRead', 'true']));
        const actions = m.rule!.actions.map((a) => (a.type === 'addLabelByName' ? { type: 'addLabel', labelId: 'lab1' } : a));
        expect(validateRuleInput({ conditions: m.rule!.conditions, actions }).ok).toBe(true);
    });
});

describe('buildGmailFiltersXml y round-trip', () => {
    const labels = new Map([['lab1', 'Noticias'], ['lab2', 'Finanzas']]);
    const resolve = (r: { conditions: any; actions: any[] }) => ({
        ...r, actions: r.actions.map((a) => (a.type === 'addLabelByName' ? { type: 'addLabel', labelId: a.name === 'Noticias' ? 'lab1' : 'lab2' } : a)),
    });

    it('genera Atom valido que parseGmailFilters vuelve a leer', () => {
        const xml = buildGmailFiltersXml([
            { name: 'r1', enabled: true, conditions: { match: 'all', items: [{ field: 'from', op: 'contains', value: "o'neil & co <x>" }, { field: 'hasAttachment', value: true }] }, actions: [{ type: 'addLabel', labelId: 'lab1' }, { type: 'markRead' }] },
        ], labels, { now: new Date('2024-01-01T00:00:00Z') });
        expect(xml).toContain("xmlns:apps='http://schemas.google.com/apps/2006'");
        const back = parseGmailFilters(xml);
        expect(back.invalid).toBe(0);
        expect(back.filters[0]).toMatchObject({ from: `"o'neil & co <x>"`, hasAttachment: true, label: 'Noticias', shouldMarkAsRead: true });
    });

    it('round-trip parse -> map -> build -> parse conserva condiciones y acciones', () => {
        const src = parseGmailFilters(feed([
            p('from', 'a@x.test OR b@x.test') + p('label', 'Noticias') + p('shouldArchive', 'true'),
            p('from', 'c@x.test') + p('subject', 'hola mundo') + p('hasAttachment', 'true') + p('label', 'Finanzas') + p('shouldStar', 'true') + p('shouldMarkAsRead', 'true'),
            p('from', 'd@x.test OR e.f@x.test') + p('hasTheWord', 'factura "pago pendiente"') + p('shouldTrash', 'true'),
            p('hasTheWord', 'label:Finanzas') + p('shouldStar', 'true'),
        ])).filters;
        const rules = src.flatMap((f, i) => mapGmailFilter(f, { index: i }).rules).map(resolve);
        expect(rules).toHaveLength(4);
        const res = buildGmailFiltersXmlEx(rules, labels);
        expect(res.skipped).toEqual([]);
        const back = parseGmailFilters(res.xml).filters;
        expect(back).toHaveLength(4);
        const norm = (f: GmailFilter) => JSON.stringify(mapGmailFilter(f).rules.map((r) => [r.conditions, r.actions]));
        expect(back.map(norm)).toEqual(src.map(norm));
        expect(back[0]).toMatchObject({ from: '{a@x.test b@x.test}', label: 'Noticias', shouldArchive: true });
        expect(back[1]).toMatchObject({ from: 'c@x.test', subject: 'hola mundo', hasAttachment: true });
    });

    it('regla con varias etiquetas -> una entrada por etiqueta; desactivadas/no expresables se informan', () => {
        const res = buildGmailFiltersXmlEx([
            { name: 'multi', conditions: { match: 'all', items: [{ field: 'from', op: 'contains', value: 'a@x.test' }] }, actions: [{ type: 'addLabel', labelId: 'lab1' }, { type: 'addLabel', labelId: 'lab2' }, { type: 'moveToFolder', folder: 'archive' }] },
            { name: 'off', enabled: false, conditions: { match: 'all', items: [{ field: 'from', op: 'contains', value: 'a' }] }, actions: [{ type: 'star' }] },
            { name: 'regex', conditions: { match: 'all', items: [{ field: 'subject', op: 'regex', value: '^\\d+.*x' }] }, actions: [{ type: 'star' }] },
            { name: 'spam', conditions: { match: 'all', items: [{ field: 'from', op: 'contains', value: 'a' }] }, actions: [{ type: 'moveToFolder', folder: 'spam' }] },
            { name: 'sinlabel', conditions: [{ field: 'from', op: 'contains', value: 'a' }], actions: [{ type: 'addLabel', labelId: 'nope' }] },
            { name: 'noatt', conditions: { match: 'all', items: [{ field: 'hasAttachment', value: false }] }, actions: [{ type: 'star' }] },
        ], labels);
        expect(res.exported).toBe(2);
        expect(res.skipped.map((s) => s.name)).toEqual(['off', 'regex', 'spam', 'sinlabel', 'noatt']);
        const back = parseGmailFilters(res.xml).filters;
        expect(back.map((f) => f.label)).toEqual(['Noticias', 'Finanzas']);
        expect(back.every((f) => f.shouldArchive)).toBe(true);
    });

    it('lista vacia: feed valido sin entradas', () => {
        const xml = buildGmailFiltersXml([], labels);
        expect(parseGmailFilters(xml)).toEqual({ filters: [], invalid: 0 });
    });

    it('literalAlternatives solo acepta alternancias de literales', () => {
        expect(literalAlternatives('a@x\\.test|b\\.c')).toEqual(['a@x.test', 'b.c']);
        expect(literalAlternatives('a.*b')).toBeNull();
        expect(literalAlternatives('(a|b)')).toBeNull();
        expect(literalAlternatives('a||b')).toBeNull();
    });
});
