import { describe, it, expect } from 'vitest';
import {
    FALLBACK_WINDOW_MS, MAX_REFS, MAX_THREAD_MESSAGES, SUBJECT_PREFIX_SOURCE, ThreadIndex, assignThreadKeys, buildForwardSubject, buildReplyHeaders,
    buildReplySubject, capRefs, effectiveThreadKey, isGroupableSubject, legacyThreadKey, normalizeMessageId, normalizeOutgoingSubject, normalizeSubject,
    parseMessageIdList, parseStoredHints, parseStoredRefs, participantsOf, serializeRefs, subjectLooksLikeReply, threadHeadersFrom, type ThreadMsg,
} from '../threading';
import { conversationHintFromThreadIndex, packRefs, threadInfoFromRawMime, threadInfoFromRecord, threadInfoFromWebhookPayload, unpackRefs } from '../thread-headers';
import { FIXTURE_KEYS_A, FIXTURE_KEYS_B, OWNER, buildFixtureMessages, shuffled } from './helpers/thread-fixtures';

const DAY = 24 * 3600 * 1000;
const T0 = Date.UTC(2026, 8, 1);

const m = (id: string, over: Partial<ThreadMsg> = {}): ThreadMsg => ({ id, mid: `${id}@x.test`, date: T0, refs: [], ...over });
const partition = (idx: ThreadIndex) => [...idx.groups().values()].map((g) => [...g].sort()).sort((a, b) => (a[0] < b[0] ? -1 : 1));

describe('normalizeSubject multilingue', () => {
    const cases: Array<[string, string, string]> = [
        ['es', 'Re: Presupuesto', 'Presupuesto'], ['es', 'RE: Presupuesto', 'Presupuesto'], ['es', 'RV: Presupuesto', 'Presupuesto'],
        ['es/pt', 'Res: Presupuesto', 'Presupuesto'], ['pt', 'ENC: Orçamento', 'Orçamento'], ['pt', 'Enc: Orçamento', 'Orçamento'],
        ['en', 'Fwd: Budget', 'Budget'], ['en', 'FW: Budget', 'Budget'], ['en', 'Fw: Re: Budget', 'Budget'],
        ['de', 'AW: Angebot', 'Angebot'], ['de', 'WG: Angebot', 'Angebot'], ['de', 'AW: WG: Angebot', 'Angebot'],
        ['fr', 'TR: Devis', 'Devis'], ['fr', 'RE : Devis', 'Devis'], ['it', 'R: Preventivo', 'Preventivo'], ['it', 'I: Preventivo', 'Preventivo'], ['it', 'Rif: Preventivo', 'Preventivo'],
        ['nl', 'Antw: Offerte', 'Offerte'], ['nl', 'VB: Offerte', 'Offerte'], ['sv/no', 'SV: Tilbud', 'Tilbud'], ['sv/no', 'Sv: Tilbud', 'Tilbud'], ['no/da', 'VS: Tilbud', 'Tilbud'], ['no/da', 'FS: Tilbud', 'Tilbud'],
        ['fi', 'VL: Tarjous', 'Tarjous'], ['pl', 'Odp: Oferta', 'Oferta'], ['pl', 'PD: Oferta', 'Oferta'], ['tr', 'YNT: Teklif', 'Teklif'],
        ['zh', '回复: 报价', '报价'], ['zh', '答复：报价', '报价'], ['zh', '回覆: 報價', '報價'], ['zh', '转发: 报价', '报价'], ['zh', '轉發：報價', '報價'],
        ['numerado', 'Re[2]: Presupuesto', 'Presupuesto'], ['numerado', 'Re(3): Presupuesto', 'Presupuesto'],
        ['mixto', 'Re: AW: Fwd: RV: Presupuesto', 'Presupuesto'], ['espacios', '  Re:   Presupuesto  ', 'Presupuesto'],
        ['calendario', 'Invitación: Reunión', 'Reunión'], ['calendario', 'Accepted: Reunion', 'Reunion'], ['calendario', 'Invitation updated: Meeting', 'Meeting'],
    ];
    for (const [lang, input, expected] of cases) {
        it(`${lang}: "${input}" -> "${expected}"`, () => expect(normalizeSubject(input)).toBe(expected));
    }
    it('no toca asuntos que solo contienen la palabra', () => {
        expect(normalizeSubject('Regalo de cumpleaños')).toBe('Regalo de cumpleaños');
        expect(normalizeSubject('Reunion re: presupuesto')).toBe('Reunion re: presupuesto');
        expect(normalizeSubject('Rv')).toBe('Rv');
        expect(normalizeSubject('Information: nuevo')).toBe('Information: nuevo');
        expect(normalizeSubject('Trabajo: informe')).toBe('Trabajo: informe');
        expect(normalizeSubject(null)).toBe('');
    });
    it('la fuente del prefijo usa solo sintaxis comun a JS y Postgres (sin \\s ni lookarounds ni grupos con nombre)', () => {
        expect(SUBJECT_PREFIX_SOURCE).not.toMatch(/\\s|\\d|\(\?[=!<]|\(\?P/);
    });
    it('subjectLooksLikeReply distingue respuestas de reenvios y de asuntos normales', () => {
        for (const s of ['Re: x', 'RE: x', 'AW: x', 'SV: x', 'Antw: x', 'Res: x', '回复: x', 'Odp: x', 'R: x', 'Re[2]: x']) expect(subjectLooksLikeReply(s), s).toBe(true);
        for (const s of ['Fwd: x', 'RV: x', 'x', 'Regalo', 'Reunion', 'WG: x', 'TR: x']) expect(subjectLooksLikeReply(s), s).toBe(false);
    });
    it('isGroupableSubject', () => {
        expect(isGroupableSubject('ab')).toBe(false);
        expect(isGroupableSubject('(No Subject)')).toBe(false);
        expect(isGroupableSubject('abc')).toBe(true);
    });
});

describe('asuntos salientes: un solo prefijo, idioma del original', () => {
    it('responder', () => {
        expect(buildReplySubject('Presupuesto')).toBe('Re: Presupuesto');
        expect(buildReplySubject('Re: Presupuesto')).toBe('Re: Presupuesto');
        expect(buildReplySubject('RE: Re: RE: Presupuesto')).toBe('Re: Presupuesto');
        expect(buildReplySubject('AW: Angebot')).toBe('AW: Angebot');
        expect(buildReplySubject('AW: Re: Angebot')).toBe('AW: Angebot');
        expect(buildReplySubject('SV: Tilbud')).toBe('SV: Tilbud');
        expect(buildReplySubject('Antw: Offerte')).toBe('Antw: Offerte');
        expect(buildReplySubject('Res: Orçamento')).toBe('Res: Orçamento');
        expect(buildReplySubject('回复: 报价')).toBe('Re: 报价');
        expect(buildReplySubject('Fwd: Budget')).toBe('Re: Budget'); // responder a un reenvio -> Re: estandar
        expect(buildReplySubject('WG: Angebot')).toBe('Re: Angebot');
        expect(buildReplySubject('')).toBe('Re:');
        expect(buildReplySubject('Invitación: Reunión')).toBe('Re: Invitación: Reunión'); // la marca de calendario se conserva
    });
    it('reenviar', () => {
        expect(buildForwardSubject('Presupuesto')).toBe('Fwd: Presupuesto');
        expect(buildForwardSubject('Re: Presupuesto')).toBe('Fwd: Presupuesto');
        expect(buildForwardSubject('Fwd: Fwd: Presupuesto')).toBe('Fwd: Presupuesto');
        expect(buildForwardSubject('WG: Angebot')).toBe('WG: Angebot');
        expect(buildForwardSubject('TR: Devis')).toBe('TR: Devis');
        expect(buildForwardSubject('RV: Presupuesto')).toBe('RV: Presupuesto');
        expect(buildForwardSubject('ENC: Orçamento')).toBe('ENC: Orçamento');
    });
    it('normalizeOutgoingSubject colapsa acumulaciones y respeta un asunto sin prefijo', () => {
        expect(normalizeOutgoingSubject('Re: Re: Presupuesto', 'reply', 'Presupuesto')).toBe('Re: Presupuesto');
        expect(normalizeOutgoingSubject('Re: AW: Presupuesto', 'reply', 'AW: Presupuesto')).toBe('AW: Presupuesto');
        expect(normalizeOutgoingSubject('Re: RV: Fwd: Presupuesto', 'reply', 'Presupuesto')).toBe('Re: Presupuesto');
        expect(normalizeOutgoingSubject('Fwd: Re: Presupuesto', 'forward', 'Re: Presupuesto')).toBe('Fwd: Presupuesto');
        expect(normalizeOutgoingSubject('Otro asunto nuevo', 'reply', 'Presupuesto')).toBe('Otro asunto nuevo');
        expect(normalizeOutgoingSubject('Re:', 'reply', 'AW: x')).toBe('AW:');
    });
});

describe('Message-ID / References', () => {
    it('normaliza <id>, minusculas del dominio, conserva la parte local', () => {
        expect(normalizeMessageId('<AbC123@Mail.GMAIL.com>')).toBe('AbC123@mail.gmail.com');
        expect(normalizeMessageId('  <a.b+c=d@ex.test> ')).toBe('a.b+c=d@ex.test');
        expect(normalizeMessageId('abc@x.test')).toBe('abc@x.test');
        expect(normalizeMessageId('identificadorlargosindominio')).toBe('identificadorlargosindominio');
    });
    it('descarta basura: vacios, angulos vacios, valores tipicos, gigantes, controles, un caracter repetido', () => {
        for (const bad of [null, undefined, '', '<>', '< >', '<null>', 'null', 'undefined', '<none@>', '<@x.test>', '0', '<0000000@x.test>', '<aaaa@x.test>', `<${'a'.repeat(300)}@x.test>`, 'x'.repeat(2000), '<a\u0001b@x.test>', '<a,b@x.test>', 'ab', '<id>', '<message-id>']) {
            expect(normalizeMessageId(bad as any), String(bad).slice(0, 30)).toBeNull();
        }
    });
    it('parseMessageIdList: varios, plegado, sin angulos, repetidos y con basura', () => {
        expect(parseMessageIdList('<a1@x.test>\r\n\t<B2@X.test> <a1@x.test> <> <null>')).toEqual(['a1@x.test', 'B2@x.test']);
        expect(parseMessageIdList('a1@x.test, b2@x.test')).toEqual(['a1@x.test', 'b2@x.test']);
        expect(parseMessageIdList(['<a1@x.test>', '<b2@x.test>'])).toEqual(['a1@x.test', 'b2@x.test']);
        expect(parseMessageIdList(null)).toEqual([]);
        expect(parseMessageIdList('   ')).toEqual([]);
    });
    it('tope: la raiz + las MAX_REFS mas recientes', () => {
        const ids = Array.from({ length: 200 }, (_, i) => `id${i}@x.test`);
        const capped = capRefs(ids);
        expect(capped).toHaveLength(MAX_REFS + 1);
        expect(capped[0]).toBe('id0@x.test');
        expect(capped[capped.length - 1]).toBe('id199@x.test');
        expect(capped[1]).toBe(`id${200 - MAX_REFS}@x.test`);
        expect(parseMessageIdList(ids.map((i) => `<${i}>`).join(' '))).toHaveLength(MAX_REFS + 1);
        expect(parseStoredRefs(serializeRefs(ids))).toEqual(capped);
    });
    it('threadHeadersFrom completa References con In-Reply-To y quita el propio id', () => {
        const h = threadHeadersFrom({ messageId: '<Me@X.test>', inReplyTo: '<p@x.test>', references: '<r1@x.test> <me@x.test>' });
        expect(h.messageId).toBe('Me@x.test');
        expect(h.inReplyTo).toBe('p@x.test');
        expect(h.refs).toEqual(['r1@x.test', 'me@x.test', 'p@x.test'].filter((x) => x !== 'Me@x.test'));
        expect(threadHeadersFrom({ messageId: '<a@x.test>', inReplyTo: '<a@x.test>' }).inReplyTo).toBeNull(); // no se cita a si mismo
        expect(threadHeadersFrom({ inReplyTo: '<a@x.test> <b@x.test>' }).inReplyTo).toBe('b@x.test'); // varios: el ultimo
    });
    it('buildReplyHeaders: In-Reply-To = padre; References = las del padre + padre; sin duplicar ni superar el tope', () => {
        const h = buildReplyHeaders({ messageId: 'p@x.test', refs: ['a@x.test', 'b@x.test'] })!;
        expect(h.inReplyTo).toBe('p@x.test');
        expect(h.references).toBe('<a@x.test> <b@x.test> <p@x.test>');
        expect(buildReplyHeaders({ messageId: 'p@x.test', refs: [], inReplyTo: 'q@x.test' })!.references).toBe('<q@x.test> <p@x.test>');
        expect(buildReplyHeaders({ messageId: null })).toBeNull();
        expect(buildReplyHeaders({ messageId: 'p@x.test', refs: ['p@x.test', 'a@x.test'] })!.references).toBe('<a@x.test> <p@x.test>');
        const big = buildReplyHeaders({ messageId: 'p@x.test', refs: Array.from({ length: 300 }, (_, i) => `i${i}@x.test`) })!;
        expect(big.references.match(/</g)!.length).toBe(MAX_REFS + 1);
        expect(big.references.startsWith('<i0@x.test>')).toBe(true);
        expect(big.references.endsWith('<p@x.test>')).toBe(true);
    });
    it('pistas de Outlook: Thread-Index -> ~ci:<22 bytes>, y se guardan aparte de las referencias', () => {
        const idx = Buffer.concat([Buffer.alloc(22, 7), Buffer.alloc(10, 9)]).toString('base64');
        const hint = conversationHintFromThreadIndex(idx)!;
        expect(hint).toBe(`~ci:${'07'.repeat(22)}`);
        expect(conversationHintFromThreadIndex(Buffer.alloc(10).toString('base64'))).toBeNull();
        const packed = packRefs(['a@x.test'], [hint])!;
        expect(unpackRefs(packed)).toEqual({ refs: ['a@x.test'], hints: [hint] });
        expect(parseStoredRefs(packed)).toEqual(['a@x.test']);
        expect(parseStoredHints(packed)).toEqual([hint]);
        expect(buildReplyHeaders({ messageId: 'p@x.test', refs: packed })!.references).toBe('<a@x.test> <p@x.test>');
    });
});

describe('ThreadIndex (union-find de cabeceras)', () => {
    it('cadena simple, aunque falten mensajes intermedios', () => {
        const idx = new ThreadIndex();
        idx.add(m('a', { date: T0 }));
        idx.add(m('c', { date: T0 + 2, inReplyTo: 'b@x.test', refs: ['a@x.test', 'b@x.test'] })); // b no existe
        expect(idx.keyOf('a')).toBe(idx.keyOf('c'));
        expect(idx.keyOf('a')).toBe('m:a@x.test');
    });
    it('referencias rotas: un padre que nunca llega no junta mensajes ajenos', () => {
        const idx = new ThreadIndex();
        idx.add(m('a', { date: T0, inReplyTo: 'ghost1@x.test', refs: ['ghost1@x.test'], subject: 'Uno' }));
        idx.add(m('b', { date: T0 + 5, inReplyTo: 'ghost2@x.test', refs: ['ghost2@x.test'], subject: 'Dos' }));
        expect(idx.keyOf('a')).not.toBe(idx.keyOf('b'));
    });
    it('dos respuestas al mismo padre ausente comparten hilo y su clave es la del padre citado', () => {
        const idx = new ThreadIndex();
        idx.add(m('a', { date: T0, inReplyTo: 'ghost@x.test', refs: ['ghost@x.test'] }));
        idx.add(m('b', { date: T0 + 5, inReplyTo: 'ghost@x.test', refs: ['ghost@x.test'] }));
        expect(idx.keyOf('a')).toBe(idx.keyOf('b'));
        expect(idx.keyOf('a')).toBe('m:ghost@x.test');
    });
    it('ciclos y auto-referencias no rompen nada', () => {
        const idx = new ThreadIndex();
        idx.add(m('a', { date: T0, inReplyTo: 'c@x.test', refs: ['c@x.test', 'a@x.test'] }));
        idx.add(m('b', { date: T0 + 1, inReplyTo: 'a@x.test', refs: ['a@x.test'] }));
        idx.add(m('c', { date: T0 + 2, inReplyTo: 'b@x.test', refs: ['b@x.test'] }));
        idx.add(m('d', { date: T0 + 3, inReplyTo: 'd@x.test', refs: ['d@x.test'] }));
        expect(partition(idx)).toEqual([['a', 'b', 'c'], ['d']]);
        for (const id of ['a', 'b', 'c', 'd']) expect(typeof idx.keyOf(id)).toBe('string');
    });
    it('cualquier orden de llegada da la misma particion y las mismas claves (fusion incluida)', () => {
        const base: ThreadMsg[] = [
            m('a', { date: T0 }),
            m('b', { date: T0 + 1, inReplyTo: 'a@x.test', refs: ['a@x.test'] }),
            m('c', { date: T0 + 2, inReplyTo: 'b@x.test', refs: ['a@x.test', 'b@x.test'] }),
            m('d', { date: T0 + 3, inReplyTo: 'c@x.test', refs: ['c@x.test'] }), // referencias recortadas: solo conoce c
            m('e', { date: T0 + 4, inReplyTo: 'd@x.test' }),
            m('z', { date: T0 + 5 }),
            m('y', { date: T0 + 6, inReplyTo: 'z@x.test', refs: ['z@x.test'] }),
        ];
        const expected = assignThreadKeys(base);
        expect(partition(expected.index)).toEqual([['a', 'b', 'c', 'd', 'e'], ['y', 'z']]);
        for (let seed = 1; seed <= 200; seed++) {
            const idx = new ThreadIndex();
            for (const msg of shuffled(base, seed)) idx.add(msg);
            expect(partition(idx), `seed ${seed}`).toEqual(partition(expected.index));
            for (const msg of base) expect(idx.keyOf(msg.id), `seed ${seed} ${msg.id}`).toBe(expected.keys.get(msg.id));
        }
    });
    it('un mensaje que une dos hilos los fusiona y la clave pasa a ser la de la raiz mas antigua', () => {
        const idx = new ThreadIndex();
        idx.add(m('a', { date: T0 }));
        idx.add(m('c', { date: T0 + 2, inReplyTo: 'b@x.test', refs: ['b@x.test'] }));
        const before = idx.keyOf('c');
        expect(idx.keyOf('a')).not.toBe(before);
        idx.add(m('b', { date: T0 + 1, inReplyTo: 'a@x.test', refs: ['a@x.test'] })); // b cita a y es citado por c
        expect(idx.keyOf('a')).toBe(idx.keyOf('c'));
        expect(idx.keyOf('c')).toBe('m:a@x.test');
    });
    it('tope de hilo: una union que superaria MAX_THREAD_MESSAGES se ignora', () => {
        const idx = new ThreadIndex();
        // un hilo enorme de respuestas encadenadas
        idx.add(m('r0', { date: T0 }));
        for (let i = 1; i < MAX_THREAD_MESSAGES; i++) idx.add(m(`r${i}`, { date: T0 + i, inReplyTo: `r${i - 1}@x.test`, refs: [`r${i - 1}@x.test`] }));
        expect(idx.groups().size).toBe(1);
        // un mensaje mas que intenta unirse al hilo lleno se queda aparte
        idx.add(m('extra', { date: T0 + 9999, inReplyTo: `r${MAX_THREAD_MESSAGES - 1}@x.test`, refs: ['r0@x.test'] }));
        expect(idx.keyOf('extra')).not.toBe(idx.keyOf('r0'));
        // y un "spam" que cita a 50 hilos distintos no los junta a todos
        const spam = new ThreadIndex();
        for (let i = 0; i < 40; i++) {
            spam.add(m(`t${i}a`, { date: T0 + i }));
            for (let j = 0; j < 20; j++) spam.add(m(`t${i}b${j}`, { date: T0 + i + j + 1, inReplyTo: `t${i}a@x.test`, refs: [`t${i}a@x.test`] }));
        }
        spam.add(m('list', { date: T0 + 5000, refs: Array.from({ length: 40 }, (_, i) => `t${i}a@x.test`), inReplyTo: 't39a@x.test' }));
        for (const size of [...spam.groups().values()].map((g) => g.length)) expect(size).toBeLessThanOrEqual(MAX_THREAD_MESSAGES);
    });
    it('ids basura o gigantes no forman hilos', () => {
        const idx = new ThreadIndex();
        const a = threadHeadersFrom({ messageId: '<null>', inReplyTo: '<>', references: '<undefined> <0>' });
        expect(a).toEqual({ messageId: null, inReplyTo: null, refs: [] });
        idx.add(m('a', { mid: a.messageId, subject: 'x' }));
        idx.add(m('b', { mid: a.messageId, subject: 'y' }));
        expect(idx.keyOf('a')).not.toBe(idx.keyOf('b'));
    });
    it('el hilo comparte clave con otro por Thread-Index (pista secundaria)', () => {
        const idx = new ThreadIndex();
        idx.add(m('a', { date: T0, hints: ['~ci:aa'] }));
        idx.add(m('b', { date: T0 + 1, hints: ['~ci:aa'], mid: 'otro@x.test' }));
        idx.add(m('c', { date: T0 + 2, hints: ['~ci:bb'] }));
        expect(idx.keyOf('a')).toBe(idx.keyOf('b'));
        expect(idx.keyOf('c')).not.toBe(idx.keyOf('a'));
    });
    it('las claves heredadas (h:) se conservan al unir', () => {
        const idx = new ThreadIndex();
        idx.add(m('old', { date: T0, key: 'h:a@x.test::Asunto', mid: null }));
        idx.add(m('new', { date: T0 + 1, inReplyTo: 'old-mid@x.test', refs: ['old-mid@x.test'], key: 'h:a@x.test::Asunto' }));
        expect(idx.keyOf('new')).toBe('h:a@x.test::Asunto');
        expect(idx.keyOf('old')).toBe('h:a@x.test::Asunto');
    });
});

describe('respaldo por asunto + participantes (ventana de 45 dias)', () => {
    const P = (...p: string[]) => p;
    it('una respuesta con padre desconocido se une por asunto y participantes', () => {
        const idx = new ThreadIndex();
        idx.add(m('a', { date: T0, subject: 'Reunión', participants: P('ana@x.test') }));
        const link = idx.add(m('b', { date: T0 + DAY, subject: 'Re: Reunión', inReplyTo: 'id-real-de-resend@x.test', refs: ['id-real-de-resend@x.test'], participants: P('ana@x.test') }));
        expect(link).toBe('fallback');
        expect(idx.keyOf('a')).toBe(idx.keyOf('b'));
    });
    it('NO junta "Reunión" de personas distintas', () => {
        const idx = new ThreadIndex();
        idx.add(m('a', { date: T0, subject: 'Reunión', participants: P('ana@x.test') }));
        idx.add(m('b', { date: T0 + DAY, subject: 'Re: Reunión', inReplyTo: 'q@x.test', refs: ['q@x.test'], participants: P('luis@x.test') }));
        expect(idx.keyOf('a')).not.toBe(idx.keyOf('b'));
    });
    it('NO junta fuera de la ventana', () => {
        const idx = new ThreadIndex();
        idx.add(m('a', { date: T0, subject: 'Reunión', participants: P('ana@x.test') }));
        idx.add(m('b', { date: T0 + FALLBACK_WINDOW_MS + DAY, subject: 'Re: Reunión', inReplyTo: 'q@x.test', participants: P('ana@x.test') }));
        expect(idx.keyOf('a')).not.toBe(idx.keyOf('b'));
        const dentro = new ThreadIndex();
        dentro.add(m('a', { date: T0, subject: 'Reunión', participants: P('ana@x.test') }));
        dentro.add(m('c', { date: T0 + FALLBACK_WINDOW_MS - DAY, subject: 'Re: Reunión', inReplyTo: 'q2@x.test', participants: P('ana@x.test') }));
        expect(dentro.keyOf('a')).toBe(dentro.keyOf('c'));
    });
    it('un mensaje NUEVO con su Message-ID y sin In-Reply-To es una conversacion nueva, aunque coincidan asunto y participantes', () => {
        const idx = new ThreadIndex();
        idx.add(m('a', { date: T0, subject: 'Reunión', participants: P('ana@x.test') }));
        idx.add(m('b', { date: T0 + DAY, subject: 'Reunión', participants: P('ana@x.test') }));
        expect(idx.keyOf('a')).not.toBe(idx.keyOf('b'));
    });
    it('un mensaje SIN Message-ID ni cabeceras (importado de un origen pobre) se agrupa por asunto + participantes', () => {
        const idx = new ThreadIndex();
        idx.add(m('a', { mid: null, date: T0, subject: 'Informe mensual', participants: P('ana@x.test') }));
        idx.add(m('b', { mid: null, date: T0 + DAY, subject: 'Re: Informe mensual', participants: P('ana@x.test', 'luis@x.test') }));
        idx.add(m('c', { mid: null, date: T0 + DAY, subject: 'Informe mensual', participants: P('otro@x.test') }));
        expect(idx.keyOf('a')).toBe(idx.keyOf('b'));
        expect(idx.keyOf('c')).not.toBe(idx.keyOf('a'));
    });
    it('noFallback (listas, autorespuestas) evita el respaldo', () => {
        const idx = new ThreadIndex();
        idx.add(m('a', { date: T0, subject: 'Reunión', participants: P('ana@x.test') }));
        idx.add(m('b', { date: T0 + DAY, subject: 'Re: Reunión', inReplyTo: 'q@x.test', participants: P('ana@x.test'), noFallback: true }));
        expect(idx.keyOf('a')).not.toBe(idx.keyOf('b'));
    });
    it('asuntos triviales no se agrupan por respaldo', () => {
        const idx = new ThreadIndex();
        idx.add(m('a', { date: T0, subject: 'Hi', participants: P('ana@x.test') }));
        idx.add(m('b', { date: T0 + 1, subject: 'Re: Hi', inReplyTo: 'q@x.test', participants: P('ana@x.test') }));
        expect(idx.keyOf('a')).not.toBe(idx.keyOf('b'));
    });
    it('participantsOf excluye al propietario y normaliza', () => {
        expect(participantsOf({ from: 'Ana <ANA@x.test>', to: 'Yo <me@x.test>, b@x.test', cc: 'ana@x.test' }, ['ME@x.test'])).toEqual(['ana@x.test', 'b@x.test']);
    });
});

describe('clave heredada (correos sin cabeceras guardadas)', () => {
    it('legacyThreadKey = h:<destinatarios>::<asunto normalizado> o u:<id>', () => {
        expect(legacyThreadKey({ id: '1', subject: 'Re: Hola mundo', to: 'A <a@x.test>, b@x.test' })).toBe('h:a@x.test, b@x.test::Hola mundo');
        expect(legacyThreadKey({ id: '2', subject: 'ab', to: 'a@x.test' })).toBe('u:2');
        expect(legacyThreadKey({ id: '3', subject: 'AW: Angebot', cleanTo: 'a@x.test', to: 'zzz@x.test' })).toBe('h:a@x.test::Angebot');
    });
    it('effectiveThreadKey prefiere la guardada', () => {
        expect(effectiveThreadKey({ id: '1', subject: 'Hola mundo', to: 'a@x.test', threadKey: 'm:root@x.test' })).toBe('m:root@x.test');
        expect(effectiveThreadKey({ id: '1', subject: 'Hola mundo', to: 'a@x.test', threadKey: null })).toBe('h:a@x.test::Hola mundo');
    });
});

describe('banco de fixtures por proveedor: 2 conversaciones distintas con el mismo asunto raiz', () => {
    const msgs = buildFixtureMessages();
    const infoOf = (msg: (typeof msgs)[number]) => threadInfoFromRawMime(Buffer.from(msg.mime, 'utf8'));
    const toThreadMsg = (msg: (typeof msgs)[number]): ThreadMsg => {
        const info = infoOf(msg);
        return {
            id: msg.key, mid: info.messageId, inReplyTo: info.inReplyTo, refs: info.refs, hints: info.hints, date: msg.date.getTime(), subject: msg.subject,
            participants: participantsOf({ from: msg.from, to: msg.to, cc: msg.cc }, [OWNER]), noFallback: info.autoSubmitted || info.bulk || Boolean(info.listId),
        };
    };

    it('son 13 mensajes de 12 clientes y cada MIME se analiza con sus cabeceras reales', () => {
        expect(msgs).toHaveLength(13);
        expect(new Set(msgs.map((x) => x.provider)).size).toBe(12);
        for (const msg of msgs) {
            const info = infoOf(msg);
            expect(info.messageId, msg.key).toBe(msg.mid.replace(/@(.*)$/, (_s, d) => `@${d.toLowerCase()}`));
            expect(info.inReplyTo, msg.key).toBe(msg.inReplyTo ? msg.inReplyTo.replace(/@(.*)$/, (_s, d) => `@${d.toLowerCase()}`) : null);
        }
        // Outlook aporta Thread-Index como pista; Gmail/Apple no
        expect(infoOf(msgs.find((x) => x.key === 'A2')!).hints).toHaveLength(1);
        expect(infoOf(msgs.find((x) => x.key === 'A1')!).hints).toHaveLength(0);
        // A7 lleva las References recortadas, A8 no lleva ninguna (solo In-Reply-To)
        expect(infoOf(msgs.find((x) => x.key === 'A7')!).refs.length).toBeLessThan(infoOf(msgs.find((x) => x.key === 'A6')!).refs.length);
        expect(msgs.find((x) => x.key === 'A8')!.mime).not.toMatch(/^References:/m);
    });

    it('el asunto cambia a mitad (Presupuesto 2027 -> version final -> Cierre trimestral) y aun asi es UN hilo; la otra conversacion con el mismo asunto es OTRO: exactamente 2', () => {
        const base = msgs.map(toThreadMsg);
        const expected = assignThreadKeys(base);
        const groups = [...expected.groups.values()].map((g) => [...g].sort());
        expect(groups).toHaveLength(2);
        expect(groups.find((g) => g.includes('A1'))).toEqual([...FIXTURE_KEYS_A].sort());
        expect(groups.find((g) => g.includes('B1'))).toEqual([...FIXTURE_KEYS_B].sort());
        // en 300 ordenes de llegada distintas
        for (let seed = 1; seed <= 300; seed++) {
            const idx = new ThreadIndex();
            for (const msg of shuffled(base, seed)) idx.add(msg);
            const g = [...idx.groups().values()].map((x) => [...x].sort());
            expect(g, `seed ${seed}`).toHaveLength(2);
            expect(g.find((x) => x.includes('A1')), `seed ${seed}`).toEqual([...FIXTURE_KEYS_A].sort());
            expect(g.find((x) => x.includes('B1')), `seed ${seed}`).toEqual([...FIXTURE_KEYS_B].sort());
        }
        // claves: raiz = Message-ID del primer mensaje de cada conversacion
        expect(expected.keys.get('A8')).toBe(`m:${infoOf(msgs.find((x) => x.key === 'A1')!).messageId}`);
        expect(expected.keys.get('B5')).toBe(`m:${infoOf(msgs.find((x) => x.key === 'B1')!).messageId}`);
    });

    it('sin cabeceras utilizables el asunto cambiado si separaria (por eso las cabeceras mandan); con la heuristica heredada eran 5+ grupos', () => {
        const keys = new Set(msgs.map((x) => legacyThreadKey({ id: x.key, subject: x.subject, to: x.to })));
        expect(keys.size).toBeGreaterThan(2);
    });

    it('el Message-ID del envio se sustituye (proveedor) : la respuesta que cita un id desconocido se une por el respaldo', () => {
        // Simula que nuestro A3 salio con OTRO Message-ID del que guardamos: A4 cita el real (desconocido) y solo trae References de A1 y A2
        const base = msgs.map(toThreadMsg).filter((x) => !['A5', 'A6', 'A7', 'A8'].includes(x.id));
        const a4 = base.find((x) => x.id === 'A4')!;
        a4.inReplyTo = 'id-real-asignado-por-el-proveedor@resend.test';
        a4.refs = ['id-real-asignado-por-el-proveedor@resend.test'];
        const { groups } = assignThreadKeys(base.filter((x) => x.id.startsWith('A')));
        expect(groups.size).toBe(1); // A4 se une por asunto + participantes (Alice/Bob) dentro de 45 dias
    });

    it('la webhook payload de Resend (data.headers + message_id) produce las mismas cabeceras', () => {
        const a2 = msgs.find((x) => x.key === 'A2')!;
        const payload = { type: 'email.received', data: { message_id: `<${a2.mid}>`, headers: { 'In-Reply-To': `<${a2.inReplyTo}>`, References: a2.refs.map((r) => `<${r}>`).join(' ') } } };
        const info = threadInfoFromWebhookPayload(payload)!;
        expect(info.messageId).toBe(infoOf(a2).messageId);
        expect(info.inReplyTo).toBe(infoOf(a2).inReplyTo);
        expect(info.refs).toEqual(infoOf(a2).refs);
        expect(threadInfoFromWebhookPayload({ data: { headers: {} } })).toBeNull();
        expect(threadInfoFromRecord({ 'Auto-Submitted': 'auto-replied', 'List-Id': '<l.x.test>', Precedence: 'bulk' }).autoSubmitted).toBe(true);
    });
});
