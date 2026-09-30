import { describe, it, expect } from 'vitest';
import {
    conditionsMatch, evaluateConditions, validateConditionsV2, validateLeaf, toV2, describeConditions, detectLanguage, fieldsUsed,
    MAX_DEPTH, MAX_LEAVES, type EmailContext, type Group, type Leaf,
} from '../conditions';
import { evaluateRules, validateRuleInput, validateActions, type Rule } from '../engine';
import { pickHeaders } from '../headers';

const base = (o: Partial<EmailContext> = {}): EmailContext => ({
    from: 'Ana Perez <ana@Empresa.com>',
    to: 'yo@mio.com, Otro <otro@ext.org>',
    cc: 'jefe@empresa.com',
    bcc: '',
    subject: 'Factura de octubre',
    body: 'Adjunto la factura del mes. Gracias por su pago.',
    hasAttachment: true,
    attachments: [{ name: 'factura-1042.PDF', type: 'application/pdf', size: 250_000 }, { name: 'logo.png', type: 'image/png', size: 5_000 }],
    size: 300_000,
    date: '2026-03-04T15:30:00Z', // miercoles
    labelIds: ['L1'],
    labelNames: ['Trabajo/Proyecto A'],
    hdrs: { 'list-id': '<news.empresa.com>', 'list-unsubscribe': '<mailto:u@empresa.com>', precedence: 'bulk', 'authentication-results': 'mx; spf=pass; dkim=fail; dmarc=pass' },
    senderInContacts: true,
    isThread: false,
    ownAddresses: ['yo@mio.com'],
    aliasSuffixes: ['facturas'],
    folder: 'inbox',
    read: false,
    starred: false,
    spamScore: 12,
    ...o,
});

const all = (...children: any[]): any => ({ v: 2, root: { type: 'group', op: 'and', children } });
const m = (leaf: any, email: EmailContext = base()) => conditionsMatch(all(leaf), email);
const text = (field: string, op: string, value?: string, extra: object = {}) => ({ field, op, ...(value !== undefined ? { value } : {}), ...extra });

describe('condiciones v2: campos de texto y operadores', () => {
    it('from: direccion completa, cabecera cruda y sin distinguir mayusculas', () => {
        expect(m(text('from', 'equals', 'ana@empresa.com'))).toBe(true);
        expect(m(text('from', 'equals', 'ANA@EMPRESA.COM'))).toBe(true);
        expect(m(text('from', 'contains', 'perez'))).toBe(true);
        expect(m(text('from', 'notContains', 'perez'))).toBe(false);
        expect(m(text('from', 'notContains', 'zzz'))).toBe(true);
        expect(m(text('from', 'notEquals', 'otro@x.com'))).toBe(true);
        expect(m(text('from', 'startsWith', 'ana@'))).toBe(true);
        expect(m(text('from', 'endsWith', 'empresa.com'))).toBe(true);
        expect(m(text('from', 'regex', '^ana@\\w+\\.com$'))).toBe(true);
        expect(m(text('from', 'notRegex', '^ana@'))).toBe(false);
    });

    it('sensibilidad a mayusculas y palabra completa', () => {
        expect(m(text('subject', 'contains', 'FACTURA'))).toBe(true);
        expect(m(text('subject', 'contains', 'FACTURA', { caseSensitive: true }))).toBe(false);
        expect(m(text('subject', 'contains', 'Factura', { caseSensitive: true }))).toBe(true);
        expect(m(text('subject', 'contains', 'fact', { wholeWord: true }))).toBe(false);
        expect(m(text('subject', 'contains', 'factura', { wholeWord: true }))).toBe(true);
        expect(m(text('subject', 'contains', 'octubre', { wholeWord: true }))).toBe(true);
        expect(m(text('subject', 'containsAny', undefined, { values: ['nada', 'oct'] }))).toBe(true);
        expect(m(text('subject', 'containsAny', undefined, { values: ['nada', 'oct'], wholeWord: true }))).toBe(false);
        expect(m(text('subject', 'regex', 'FACTURA', { caseSensitive: true }))).toBe(false);
    });

    it('fromName, fromDomain (con subdominios), toDomain', () => {
        expect(m(text('fromName', 'contains', 'perez'))).toBe(true);
        expect(m(text('fromName', 'equals', 'ana perez'))).toBe(true);
        expect(m(text('fromDomain', 'equals', 'empresa.com'))).toBe(true);
        expect(m(text('fromDomain', 'equals', '@empresa.com'))).toBe(true);
        expect(m(text('fromDomain', 'equals', 'empresa.com'), base({ from: 'x@mail.empresa.com' }))).toBe(false);
        expect(m(text('fromDomain', 'equals', 'empresa.com', { subdomains: true }), base({ from: 'x@mail.empresa.com' }))).toBe(true);
        expect(m(text('fromDomain', 'in', 'foo.com, empresa.com'))).toBe(true);
        expect(m(text('fromDomain', 'in', 'empresa.com', { subdomains: true }), base({ from: 'x@a.b.empresa.com' }))).toBe(true);
        expect(m(text('fromDomain', 'notIn', 'foo.com, bar.com'))).toBe(true);
        expect(m(text('fromDomain', 'notIn', 'empresa.com'))).toBe(false);
        expect(m(text('fromDomain', 'wildcard', '*.empresa.com'), base({ from: 'x@mail.empresa.com' }))).toBe(true);
        expect(m(text('fromDomain', 'endsWith', '.com'))).toBe(true);
        expect(m(text('toDomain', 'in', 'ext.org'))).toBe(true);
        expect(m(text('toDomain', 'in', 'zzz.org'))).toBe(false);
    });

    it('to / cc / bcc / replyTo consideran cada direccion de la lista', () => {
        expect(m(text('to', 'equals', 'otro@ext.org'))).toBe(true);
        expect(m(text('to', 'contains', 'yo@mio'))).toBe(true);
        expect(m(text('to', 'notContains', 'otro@ext'))).toBe(false);
        expect(m(text('cc', 'equals', 'jefe@empresa.com'))).toBe(true);
        expect(m(text('bcc', 'contains', 'x'))).toBe(false);
        expect(m(text('bcc', 'notContains', 'x'))).toBe(true); // vacio conocido
        expect(m(text('replyTo', 'contains', 'x'), base({ replyTo: 'rt@x.com' }))).toBe(true);
        expect(m(text('replyTo', 'contains', 'x'), base({ replyTo: undefined, hdrs: { 'reply-to': 'rt@x.com' } }))).toBe(true);
    });

    it('in / wildcard con listas separadas por comas', () => {
        expect(m(text('from', 'in', 'a@b.com; ana@empresa.com'))).toBe(true);
        expect(m(text('from', 'wildcard', '*@empresa.com'))).toBe(true);
        expect(m(text('from', 'wildcard', '*@EMPRESA.COM'))).toBe(true);
        expect(m(text('from', 'wildcard', 'a?a@empresa.com'))).toBe(true);
        expect(m(text('from', 'wildcard', '*@otra.com'))).toBe(false);
        expect(m(text('from', 'notWildcard', '*@otra.com'))).toBe(true);
        expect(m(text('from', 'in', undefined, { values: ['x@y.com'] }))).toBe(false);
    });

    it('subject / body / bodyHtml', () => {
        expect(m(text('body', 'contains', 'gracias'))).toBe(true);
        expect(m(text('body', 'regex', 'pago\\.$'))).toBe(true);
        expect(m(text('bodyHtml', 'contains', '<b>'), base({ bodyHtml: '<p><b>x</b></p>' }))).toBe(true);
        expect(m(text('bodyHtml', 'contains', '<b>'))).toBe(false); // sin HTML: desconocido
    });

    it('adjuntos: nombre, tipo/extension, cantidad y tamano', () => {
        expect(m(text('attachmentName', 'contains', 'factura'))).toBe(true);
        expect(m(text('attachmentName', 'endsWith', '.pdf'))).toBe(true);
        expect(m(text('attachmentType', 'equals', 'pdf'))).toBe(true);
        expect(m(text('attachmentType', 'equals', 'application/pdf'))).toBe(true);
        expect(m(text('attachmentType', 'wildcard', 'image/*'))).toBe(true);
        expect(m(text('attachmentType', 'in', 'zip, rar'))).toBe(false);
        expect(m(text('attachmentType', 'notIn', 'zip, rar'))).toBe(true);
        expect(m({ field: 'attachmentCount', op: 'eq', value: 2 })).toBe(true);
        expect(m({ field: 'attachmentCount', op: 'gt', value: 2 })).toBe(false);
        expect(m({ field: 'attachmentsSize', op: 'gte', value: 255_000 })).toBe(true);
        expect(m({ field: 'attachmentName', op: 'contains', value: 'x' }, base({ hasAttachment: false, attachments: undefined }))).toBe(false);
        expect(m({ field: 'attachmentCount', op: 'eq', value: 0 }, base({ hasAttachment: false, attachments: undefined }))).toBe(true);
    });

    it('toAlias (alias usuario+sufijo@) y language', () => {
        expect(m(text('toAlias', 'equals', 'facturas'))).toBe(true);
        expect(m(text('toAlias', 'equals', 'otro'))).toBe(false);
        expect(m(text('toAlias', 'equals', 'x'), base({ aliasSuffixes: undefined }))).toBe(false);
        expect(m(text('language', 'equals', 'es'))).toBe(true);
        expect(m(text('language', 'in', 'en, fr'))).toBe(false);
        expect(m(text('language', 'equals', 'en'), base({ subject: 'Hello dear customer', body: 'Thanks for the order and the payment that you sent to us' }))).toBe(true);
        expect(detectLanguage('xyz')).toBeUndefined();
    });
});

describe('condiciones v2: numericos, fechas y booleanos', () => {
    it('size con todos los operadores', () => {
        const s = (op: string, value: number) => m({ field: 'size', op, value });
        expect(s('lt', 300_001)).toBe(true);
        expect(s('lt', 300_000)).toBe(false);
        expect(s('lte', 300_000)).toBe(true);
        expect(s('eq', 300_000)).toBe(true);
        expect(s('gte', 300_000)).toBe(true);
        expect(s('gt', 300_000)).toBe(false);
        expect(m({ field: 'size', op: 'gt', value: 1 }, base({ size: undefined }))).toBe(false); // desconocido
    });

    it('spamScore, hour y dayOfWeek (UTC y zona horaria)', () => {
        expect(m({ field: 'spamScore', op: 'lt', value: 50 })).toBe(true);
        expect(m({ field: 'spamScore', op: 'lt', value: 50 }, base({ spamScore: undefined }))).toBe(false);
        expect(m({ field: 'hour', op: 'eq', value: 15 })).toBe(true);
        expect(m({ field: 'hour', op: 'eq', value: 10, tz: 'America/New_York' })).toBe(true); // 15:30Z = 10:30 EST (el 4 de marzo aun no hay horario de verano)
        expect(m({ field: 'dayOfWeek', op: 'eq', value: 3 })).toBe(true);
        expect(m({ field: 'dayOfWeek', op: 'in', values: [0, 6] })).toBe(false);
        expect(m({ field: 'dayOfWeek', op: 'notIn', values: [0, 6] })).toBe(true);
        expect(m({ field: 'hour', op: 'eq', value: 0, tz: 'Asia/Tokyo' }, base({ date: '2026-03-04T15:30:00Z' }))).toBe(true);
    });

    it('date: antes, despues y entre', () => {
        expect(m({ field: 'date', op: 'after', value: '2026-03-01T00:00:00Z' })).toBe(true);
        expect(m({ field: 'date', op: 'before', value: '2026-03-01T00:00:00Z' })).toBe(false);
        expect(m({ field: 'date', op: 'between', value: '2026-03-01T00:00:00Z', value2: '2026-03-31T00:00:00Z' })).toBe(true);
        expect(m({ field: 'date', op: 'between', value: '2026-04-01T00:00:00Z', value2: '2026-04-30T00:00:00Z' })).toBe(false);
        expect(m({ field: 'date', op: 'after', value: '2020-01-01T00:00:00Z' }, base({ date: undefined }))).toBe(false);
    });

    it('booleanos: adjuntos, respuestas, reenvios, hilo, contactos, yo, invitacion, leido, destacado', () => {
        expect(m({ field: 'hasAttachment', value: true })).toBe(true);
        expect(m({ field: 'hasAttachment', value: false })).toBe(false);
        expect(m({ field: 'isReply', value: false })).toBe(true);
        expect(m({ field: 'isReply', value: true }, base({ subject: 'Re: hola' }))).toBe(true);
        expect(m({ field: 'isReply', value: true }, base({ subject: 'hola', inReplyTo: 'abc@x' }))).toBe(true);
        expect(m({ field: 'isForward', value: true }, base({ subject: 'Fwd: hola' }))).toBe(true);
        expect(m({ field: 'isForward', value: true }, base({ subject: 'RV: hola' }))).toBe(true);
        expect(m({ field: 'isForward', value: true })).toBe(false);
        expect(m({ field: 'isThread', value: true }, base({ isThread: true }))).toBe(true);
        expect(m({ field: 'isThread', value: true }, base({ isThread: null }))).toBe(false);
        expect(m({ field: 'senderInContacts', value: true })).toBe(true);
        expect(m({ field: 'senderInContacts', value: false })).toBe(false);
        expect(m({ field: 'senderIsMe', value: true }, base({ from: 'Yo <YO@mio.com>' }))).toBe(true);
        expect(m({ field: 'senderIsMe', value: true })).toBe(false);
        expect(m({ field: 'isCalendarInvite', value: true }, base({ attachments: [{ name: 'invite.ics', type: 'text/calendar', size: 10 }] }))).toBe(true);
        expect(m({ field: 'isCalendarInvite', value: true })).toBe(false);
        expect(m({ field: 'isRead', value: false })).toBe(true);
        expect(m({ field: 'isStarred', value: true })).toBe(false);
    });

    it('hasLabel (id, ruta y ancestros), inFolder', () => {
        expect(m({ field: 'hasLabel', value: 'L1' })).toBe(true);
        expect(m({ field: 'hasLabel', value: 'trabajo/proyecto a' })).toBe(true);
        expect(m({ field: 'hasLabel', value: 'Trabajo' })).toBe(true); // un padre incluye a sus descendientes
        expect(m({ field: 'hasLabel', value: 'Trab' })).toBe(false);
        expect(m({ field: 'hasLabel', value: 'Proyecto A' })).toBe(false);
        expect(m({ field: 'inFolder', value: 'inbox' })).toBe(true);
        expect(m({ field: 'inFolder', value: 'spam' })).toBe(false);
    });

    it('cabeceras: presencia, valores y autenticacion', () => {
        expect(m({ field: 'header', name: 'List-Unsubscribe', op: 'exists' })).toBe(true);
        expect(m({ field: 'header', name: 'x-mailer', op: 'exists' })).toBe(false);
        expect(m({ field: 'header', name: 'x-mailer', op: 'notExists' })).toBe(true);
        expect(m({ field: 'header', name: 'precedence', op: 'equals', value: 'bulk' })).toBe(true);
        expect(m({ field: 'header', name: 'list-id', op: 'contains', value: 'empresa' })).toBe(true);
        expect(m({ field: 'header', name: 'list-id', op: 'in', value: 'a, <news.empresa.com>' })).toBe(true);
        expect(m({ field: 'auth', mech: 'spf', value: 'pass' })).toBe(true);
        expect(m({ field: 'auth', mech: 'dkim', value: 'fail' })).toBe(true);
        expect(m({ field: 'auth', mech: 'dkim', value: 'pass' })).toBe(false);
        expect(m({ field: 'auth', mech: 'dmarc', value: 'none' }, base({ hdrs: { 'authentication-results': 'mx; spf=pass' } }))).toBe(true);
        // Correos antiguos (sin cabeceras guardadas): desconocido => no coincide, tampoco al negar
        const old = base({ hdrs: null });
        expect(m({ field: 'header', name: 'list-id', op: 'exists' }, old)).toBe(false);
        expect(m({ field: 'header', name: 'list-id', op: 'notExists' }, old)).toBe(false);
        expect(m({ field: 'auth', mech: 'spf', value: 'pass' }, old)).toBe(false);
        expect(evaluateConditions(all({ field: 'header', name: 'list-id', op: 'notExists' }), old)).toBeNull();
    });
});

describe('condiciones v2: grupos AND / OR / NOT anidados y logica de tres valores', () => {
    const t = text('subject', 'contains', 'factura');
    const f = text('subject', 'contains', 'nada');
    const g = (op: string, ...children: any[]) => ({ type: 'group', op, children });

    it('and / or / not', () => {
        const run = (root: any, email = base()) => conditionsMatch({ v: 2, root }, email);
        expect(run(g('and', t, t))).toBe(true);
        expect(run(g('and', t, f))).toBe(false);
        expect(run(g('or', f, t))).toBe(true);
        expect(run(g('or', f, f))).toBe(false);
        expect(run(g('not', f))).toBe(true);
        expect(run(g('not', t))).toBe(false);
        expect(run(g('not', f, f))).toBe(true); // ninguna coincide
        expect(run(g('not', f, t))).toBe(false);
    });

    it('anidados: (A o B) y no(C y D)', () => {
        const root = g('and', g('or', f, t), g('not', g('and', t, f)), text('fromDomain', 'equals', 'empresa.com'));
        expect(conditionsMatch({ v: 2, root }, base())).toBe(true);
        const root2 = g('and', g('or', f, f), t);
        expect(conditionsMatch({ v: 2, root: root2 }, base())).toBe(false);
    });

    it('desconocido no coincide ni siquiera bajo NOT; falso lo domina en AND, verdadero en OR', () => {
        const unknown = { field: 'header', name: 'list-id', op: 'exists' };
        const old = base({ hdrs: null });
        const ev = (root: any) => evaluateConditions({ v: 2, root }, old);
        expect(ev(g('not', unknown))).toBeNull();
        expect(ev(g('and', unknown, t))).toBeNull();
        expect(ev(g('and', unknown, f))).toBe(false);
        expect(ev(g('or', unknown, t))).toBe(true);
        expect(ev(g('or', unknown, f))).toBeNull();
        expect(conditionsMatch({ v: 2, root: g('not', unknown) }, old)).toBe(false);
    });

    it('un grupo sin hojas nunca coincide', () => {
        expect(conditionsMatch({ v: 2, root: g('and') }, base())).toBe(false);
        expect(conditionsMatch({ match: 'all', items: [] }, base())).toBe(false);
    });
});

describe('condiciones v2: seguridad y limites', () => {
    it('regex hostil: rechazada al validar y nunca coincide al evaluar', () => {
        expect(validateLeaf(text('body', 'regex', '(a+)+$')).ok).toBe(false);
        expect(validateLeaf(text('body', 'regex', '(a|a)*$')).ok).toBe(false);
        expect(validateLeaf(text('body', 'notRegex', '(x+x+)+y')).ok).toBe(false);
        expect(validateLeaf(text('body', 'regex', '(?=a)a')).ok).toBe(false);
        expect(validateLeaf(text('body', 'regex', '(a)\\1')).ok).toBe(false);
        const t0 = Date.now();
        expect(m(text('body', 'regex', '(a+)+$'), base({ body: 'a'.repeat(40) + '!' }))).toBe(false);
        expect(Date.now() - t0).toBeLessThan(300);
    });

    it('el texto se acota a 20 KB', () => {
        const long = 'x'.repeat(25_000) + 'FIN';
        expect(m(text('body', 'contains', 'FIN'), base({ body: long }))).toBe(false);
        expect(m(text('body', 'contains', 'xxx'), base({ body: long }))).toBe(true);
    });

    it('valida profundidad, cantidad y campos desconocidos (estricto)', () => {
        const leaf = text('subject', 'contains', 'a');
        let deep: any = leaf;
        for (let i = 0; i < MAX_DEPTH; i++) deep = { type: 'group', op: 'and', children: [deep] };
        expect(validateConditionsV2({ v: 2, root: deep }).ok).toBe(false); // root + MAX_DEPTH anidados > MAX_DEPTH
        let ok: any = leaf;
        for (let i = 0; i < MAX_DEPTH - 1; i++) ok = { type: 'group', op: 'and', children: [ok] };
        expect(validateConditionsV2({ v: 2, root: ok }).ok).toBe(true);
        const many = { type: 'group', op: 'or', children: Array.from({ length: MAX_LEAVES + 1 }, () => leaf) };
        expect(validateConditionsV2({ v: 2, root: many }).ok).toBe(false);
        expect(validateConditionsV2({ v: 2, root: { ...many, children: many.children.slice(0, MAX_LEAVES) } }).ok).toBe(true);
        expect(validateLeaf({ field: 'subject', op: 'contains', value: 'a', extra: 1 }).ok).toBe(false);
        expect(validateLeaf({ field: 'nope', op: 'contains', value: 'a' }).ok).toBe(false);
        expect(validateLeaf({ field: 'subject', op: 'drop table', value: 'a' }).ok).toBe(false);
        expect(validateLeaf({ field: 'subject', op: 'contains', value: '' }).ok).toBe(false);
        expect(validateLeaf({ field: 'subject', op: 'in', value: '' }).ok).toBe(false);
        expect(validateLeaf({ field: 'subject', op: 'contains', value: 'x'.repeat(501) }).ok).toBe(false);
        expect(validateLeaf({ field: 'header', name: 'x-secret', op: 'exists' }).ok).toBe(false);
        expect(validateLeaf({ field: 'hour', op: 'eq', value: 24 }).ok).toBe(false);
        expect(validateLeaf({ field: 'hour', op: 'eq', value: 5, tz: 'No/Zone' }).ok).toBe(false);
        expect(validateLeaf({ field: 'size', op: 'in', values: [1] }).ok).toBe(false);
        expect(validateLeaf({ field: 'date', op: 'between', value: '2026-01-02', value2: '2026-01-01' }).ok).toBe(false);
        expect(validateLeaf({ field: 'date', op: 'after', value: 'no-fecha' }).ok).toBe(false);
        expect(validateLeaf({ field: 'inFolder', value: 'secret' }).ok).toBe(false);
        expect(validateLeaf({ field: 'language', op: 'contains', value: 'es' }).ok).toBe(false);
        expect(validateConditionsV2({ v: 2, root: { type: 'group', op: 'and', children: [] } }).ok).toBe(false);
        expect(validateConditionsV2('x').ok).toBe(false);
        expect(validateConditionsV2({ v: 2, root: { type: 'group', op: 'xor', children: [leaf] } }).ok).toBe(false);
    });

    it('listas: maximo 100 elementos; se normalizan y sin repetidos', () => {
        const doms = (n: number) => Array.from({ length: n }, (_, i) => `d${i}.com`);
        expect(validateLeaf(text('fromDomain', 'in', undefined, { values: doms(101) })).ok).toBe(false);
        const r = validateLeaf(text('fromDomain', 'in', undefined, { values: doms(100) }));
        expect(r.ok).toBe(true);
        if (r.ok) expect((r.leaf as any).values).toHaveLength(100);
        const r2 = validateLeaf(text('fromDomain', 'in', 'a.com, A.com , b.com,,'));
        if (r2.ok) expect((r2.leaf as any).values).toEqual(['a.com', 'b.com']);
    });

    it('el presupuesto de tiempo no bloquea (evaluacion de muchas hojas)', () => {
        const children = Array.from({ length: MAX_LEAVES }, (_, i) => text('body', 'regex', `pago${i}|gracias`));
        const t0 = Date.now();
        expect(conditionsMatch({ v: 2, root: { type: 'group', op: 'or', children } }, base())).toBe(true);
        expect(Date.now() - t0).toBeLessThan(500);
    });
});

describe('compatibilidad v1 y conversion', () => {
    it('lee {match, items} y arrays v1', () => {
        const v1 = { match: 'any', items: [{ field: 'subject', op: 'contains', value: 'nada' }, { field: 'label', value: 'L1' }] };
        expect(conditionsMatch(v1, base())).toBe(true);
        expect(conditionsMatch([{ field: 'from', op: 'contains', value: 'empresa' }, { field: 'hasAttachment', value: true }], base())).toBe(true);
        expect(conditionsMatch([{ field: 'from', op: 'contains', value: 'empresa' }, { field: 'hasAttachment', value: false }], base())).toBe(false);
        const c = toV2(v1);
        expect(c.v).toBe(2);
        expect(c.root.op).toBe('or');
        expect((c.root.children[1] as Leaf).field).toBe('hasLabel');
    });

    it('toV2 es idempotente y descarta hojas invalidas sin lanzar', () => {
        const once = toV2({ match: 'all', items: [{ field: 'subject', op: 'contains', value: 'a' }, { field: 'zzz' }, null, 5] });
        expect((once.root.children as any[]).length).toBe(1);
        expect(toV2(once)).toEqual(once);
        expect(toV2(null).root.children).toEqual([]);
        expect(toV2('basura').root.children).toEqual([]);
    });

    it('validateRuleInput acepta v1 (queda v1) y v2 (queda v2)', () => {
        const a = validateRuleInput({ conditions: { match: 'all', items: [{ field: 'subject', op: 'contains', value: 'a' }] }, actions: [{ type: 'star' }] });
        expect(a.ok && (a.conditions as any).match).toBe('all');
        const b = validateRuleInput({ conditions: all(text('fromDomain', 'in', 'a.com,b.com')), actions: [{ type: 'markSpam' }] });
        expect(b.ok && (b.conditions as any).v).toBe(2);
        expect(validateRuleInput({ conditions: all(text('body', 'regex', '(a+)+')), actions: [{ type: 'star' }] }).ok).toBe(false);
    });
});

describe('acciones y evaluateRules v2', () => {
    const rule = (o: Partial<Rule>): Rule => ({ id: 'r', enabled: true, priority: 0, stopProcessing: false, conditions: all(text('subject', 'contains', 'factura')), actions: [], ...o });

    it('addLabel/removeLabel/moveToLabelFolder/markSpam/snooze/forwardTo/stop', () => {
        const rules = [
            rule({ id: 'a', priority: 1, actions: [{ type: 'addLabel', labelId: 'A' }, { type: 'addLabel', labelId: 'B' }, { type: 'moveToLabelFolder', labelId: 'F' }, { type: 'snooze', hours: 4 }, { type: 'forwardTo', address: 'Yo2@Mio.com' }] }),
            rule({ id: 'b', priority: 2, actions: [{ type: 'removeLabel', labelId: 'B' }, { type: 'markSpam' }, { type: 'markRead' }, { type: 'stopProcessing' }] }),
            rule({ id: 'c', priority: 3, actions: [{ type: 'star' }] }),
        ];
        const fx = evaluateRules(base(), rules);
        expect(fx.appliedRuleIds).toEqual(['a', 'b']);
        expect(fx.addLabelIds.sort()).toEqual(['A', 'F']);
        expect(fx.removeLabelIds).toEqual(['B']);
        expect(fx.moveToLabelFolderIds).toEqual(['F']);
        expect(fx.folder).toBe('spam');
        expect(fx.markRead).toBe(true);
        expect(fx.star).toBe(false);
        expect(fx.snoozeHours).toBe(4);
        expect(fx.forwardTo).toEqual(['yo2@mio.com']);
    });

    it('la ultima accion sobre una etiqueta gana; la primera carpeta gana; stopProcessing como campo', () => {
        const fx = evaluateRules(base(), [
            rule({ id: 'a', priority: 1, actions: [{ type: 'removeLabel', labelId: 'X' }, { type: 'archive' }] }),
            rule({ id: 'b', priority: 2, actions: [{ type: 'addLabel', labelId: 'X' }, { type: 'delete' }], stopProcessing: true }),
            rule({ id: 'c', priority: 3, actions: [{ type: 'star' }] }),
        ]);
        expect(fx.addLabelIds).toEqual(['X']);
        expect(fx.removeLabelIds).toEqual([]);
        expect(fx.folder).toBe('archive');
        expect(fx.star).toBe(false);
    });

    it('reglas deshabilitadas o sin coincidencia no aplican; v1 sigue funcionando', () => {
        expect(evaluateRules(base(), [rule({ enabled: false, actions: [{ type: 'star' }] })]).star).toBe(false);
        const fx = evaluateRules(base(), [rule({ conditions: { match: 'all', items: [{ field: 'from', op: 'contains', value: 'empresa' }] }, actions: [{ type: 'star' }] })]);
        expect(fx.star).toBe(true);
    });

    it('validateActions valida y limpia', () => {
        expect(validateActions([{ type: 'snooze', hours: 0 }]).ok).toBe(false);
        expect(validateActions([{ type: 'snooze', hours: 99999 }]).ok).toBe(false);
        expect(validateActions([{ type: 'forwardTo', address: 'nope' }]).ok).toBe(false);
        expect(validateActions([{ type: 'forwardTo', address: 'A@B.com' }])).toEqual({ ok: true, actions: [{ type: 'forwardTo', address: 'a@b.com' }] });
        expect(validateActions([{ type: 'deleteForever' }]).ok).toBe(false);
        expect(validateActions([{ type: 'moveToLabelFolder' }]).ok).toBe(false);
        expect(validateActions(Array.from({ length: 13 }, () => ({ type: 'star' }))).ok).toBe(false);
        expect(validateActions([{ type: 'markSpam' }, { type: 'stopProcessing' }, { type: 'removeLabel', labelId: 'x' }]).ok).toBe(true);
    });
});

describe('descripcion en lenguaje natural y utilidades', () => {
    it('describe reglas en es y en', () => {
        const c = { v: 2, root: { type: 'group', op: 'and', children: [
            { field: 'fromDomain', op: 'equals', value: 'empresa.com', subdomains: true },
            { field: 'subject', op: 'contains', value: 'factura' },
            { field: 'hasAttachment', value: true },
        ] } };
        expect(describeConditions(c, 'es')).toBe('Si el dominio del remitente es "empresa.com" (o subdominios) y el asunto contiene "factura" y tiene adjuntos');
        expect(describeConditions(c, 'en')).toBe('If the sender domain is "empresa.com" (or subdomains) and the subject contains "factura" and has attachments');
        expect(describeConditions({ match: 'all', items: [] }, 'es')).toBe('Sin condiciones');
        const nested = { v: 2, root: { type: 'group', op: 'and', children: [
            { type: 'group', op: 'or', children: [{ field: 'size', op: 'gt', value: 2 * 1024 * 1024 }, { field: 'attachmentCount', op: 'gte', value: 3 }] },
            { type: 'group', op: 'not', children: [{ field: 'senderInContacts', value: true }] },
        ] } };
        const d = describeConditions(nested, 'es');
        expect(d).toContain('(el tamano es mayor que 2 MB o el numero de adjuntos es como minimo 3)');
        expect(d).toContain('no ( el remitente esta en tus contactos )');
    });

    it('fieldsUsed y pickHeaders (lista blanca y 4 KB)', () => {
        expect([...fieldsUsed(all(text('body', 'contains', 'a'), { field: 'hasAttachment', value: true }))].sort()).toEqual(['body', 'hasAttachment']);
        const h = pickHeaders({ 'List-Id': '<x>', 'X-Secret-Token': 'no', 'Authentication-Results': ['a', 'b'], 'x_mailer': 'M', Precedence: '' });
        expect(h).toEqual({ 'list-id': '<x>', 'authentication-results': 'a, b', 'x-mailer': 'M' });
        const big = pickHeaders(Object.fromEntries(['list-id', 'list-unsubscribe', 'x-mailer', 'reply-to', 'authentication-results', 'references', 'user-agent', 'return-path', 'in-reply-to', 'message-id', 'x-original-sender', 'importance', 'x-priority', 'precedence'].map((k) => [k, 'v'.repeat(400)])));
        expect(JSON.stringify(big).length).toBeLessThanOrEqual(4096);
        expect(Object.values(big).every((v) => v.length <= 300)).toBe(true);
    });

    it('group typing helper', () => {
        const g: Group = { type: 'group', op: 'and', children: [] };
        expect(g.children).toEqual([]);
    });
});
