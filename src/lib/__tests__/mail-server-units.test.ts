import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    MAIL_FILTERS, MAIL_SORTS, MS_NOW_SQL, decodeCursor, encodeCursor, filterToApi, msTimestamp, normalizeFilterCounts, parseFilter,
    parseMailboxesParam, parseSort, sumFilterCounts,
} from '../mail-query';
import {
    DEFAULT_SQL_OPTIONS, SUBJECT_PREFIX_RE, SqlParams, THREAD_KEY_SQL, buildPageSql, emptyScope, normalizeOwn, scopeClauses,
} from '../mail-list-sql';
import { PREVIOUS_FOLDER_TARGETS, RESTORE_TARGETS, ownAddressesOf, previousFolderAfterMove, restoreFolderFor } from '../mail-store';
import { parseBatchScope, parseEmailBatchUpdates, parseRestoreFallbacks } from '../batch-validation';
import {
    BODY_ESTIMATE, MB, buildStatus, levelFor, parseQuotaMb, resolvePolicy,
} from '../mail-quota';
import { formatStorage, parseQuotaView, quotaFillClass, quotaNoticeKey, quotaTextClass } from '../mail-quota-view';
import { MAX_SCHEDULE_DAYS, MIN_SCHEDULE_LEAD_MS, SEND_NOW_FALLBACK_MS, SEND_NOW_RESTORE_MS, validateScheduleDate } from '../mail-scheduled';
import { appendServerPage, compareEmailsBy, groupEmailsByThread, mergeMailboxPages, planRequestGroups, senderSortKey } from '../mail-list';
import { orderGroupsLike } from '../mail-list-view';

const mail = (id: string, over: Record<string, unknown> = {}) => ({ id, from: 'a@x.com', subject: `S${id}`, createdAt: '2025-01-01T00:00:00.000Z', ...over });

describe('mail-query: orden, filtros y cursor', () => {
    it('valores desconocidos caen al defecto; filterToApi traduce el nombre de la interfaz', () => {
        expect(parseSort('hax')).toBe('newest');
        expect(parseSort(undefined)).toBe('newest');
        for (const s of MAIL_SORTS) expect(parseSort(s)).toBe(s);
        expect(parseFilter('x')).toBe('all');
        for (const f of MAIL_FILTERS) expect(parseFilter(f)).toBe(f);
        expect(filterToApi('fromMe')).toBe('from_me');
        expect(filterToApi('unread')).toBe('unread');
        expect(filterToApi('zzz')).toBe('all');
    });

    it('cursor: ida y vuelta con microsegundos, sensible al orden y rechaza basura', () => {
        const row = { ct: '2031-01-01T00:00:01.500123Z', id: 'abc', sk: 'ana perez' };
        for (const sort of MAIL_SORTS) {
            const c = decodeCursor(encodeCursor(sort, row), sort)!;
            expect(c).toMatchObject({ s: sort, t: '2031-01-01T00:00:01.500123Z', id: 'abc' });
            expect(c.f).toBe(sort === 'sender' ? 'ana perez' : undefined);
        }
        const newest = encodeCursor('newest', row);
        expect(decodeCursor(newest, 'oldest')).toBeNull();
        expect(decodeCursor(newest, 'sender')).toBeNull();
        for (const bad of [undefined, null, '', 5, '%%%', 'a'.repeat(5000), Buffer.from('{"s":"newest"}').toString('base64url'),
            Buffer.from(JSON.stringify({ s: 'newest', t: 'no-fecha', id: 'x' })).toString('base64url'),
            Buffer.from(JSON.stringify({ s: 'newest', t: '2031-01-01', id: 'x' })).toString('base64url'),
            Buffer.from(JSON.stringify({ s: 'newest', t: '2031-01-01T00:00:00Z', id: 5 })).toString('base64url'),
            Buffer.from(JSON.stringify({ s: 'sender', t: '2031-01-01T00:00:00Z', id: 'x' })).toString('base64url')]) {
            expect(decodeCursor(bad, 'newest') ?? decodeCursor(bad, 'sender')).toBeNull();
        }
    });

    it('msTimestamp: siempre milisegundos exactos (sin microsegundos) y tolera entradas invalidas', () => {
        expect(msTimestamp(new Date('2031-01-01T00:00:00.123Z'))).toBe('2031-01-01T00:00:00.123Z');
        expect(msTimestamp('2031-01-01T00:00:00.123456Z')).toBe('2031-01-01T00:00:00.123Z');
        expect(msTimestamp(Date.UTC(2031, 0, 1, 0, 0, 0, 7))).toBe('2031-01-01T00:00:00.007Z');
        expect(msTimestamp('basura')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        expect(MS_NOW_SQL).toContain('milliseconds');
    });

    it('mailboxes=: ids validos, all, sin repetidos; basura o demasiados = null', () => {
        expect(parseMailboxesParam(null)).toEqual([]);
        expect(parseMailboxesParam('a, b,a,,c')).toEqual(['a', 'b', 'c']);
        expect(parseMailboxesParam('all')).toEqual(['all']);
        expect(parseMailboxesParam("a;drop table")).toBeNull();
        expect(parseMailboxesParam('x'.repeat(201))).toBeNull();
        expect(parseMailboxesParam(Array.from({ length: 51 }, (_, i) => `id${i}`).join(','))).toBeNull();
    });

    it('conteos: normaliza filas de la BD y suma varias cuentas', () => {
        expect(normalizeFilterCounts({ all: '5', unread: BigInt(2), starred: -1, attachments: null, from_me: 1.9 } as any)).toEqual({ all: 5, unread: 2, starred: 0, attachments: 0, from_me: 1 });
        expect(normalizeFilterCounts(undefined)).toEqual({ all: 0, unread: 0, starred: 0, attachments: 0, from_me: 0 });
        expect(sumFilterCounts([{ all: 1, unread: 1, starred: 0, attachments: 2, from_me: 0 }, { all: 4, unread: 0, starred: 1, attachments: 0, from_me: 3 }]))
            .toEqual({ all: 5, unread: 1, starred: 1, attachments: 2, from_me: 3 });
    });
});

describe('mail-list-sql: SQL parametrizado (sin interpolar datos del usuario)', () => {
    const scope = { ...emptyScope(['u1', 'u2'], 'inbox'), fromContains: "x'; DROP TABLE \"Email\"; --" };

    it('pagina: tupla (createdAt, id) para fecha y clave de remitente para el orden por nombre', () => {
        const cursor = { s: 'newest' as const, t: '2031-01-01T00:00:00.123456Z', id: 'i' };
        const newest = buildPageSql({ scope, sort: 'newest', filter: 'all', own: [], cursor, take: 21, offset: 0 }, DEFAULT_SQL_OPTIONS);
        expect(newest.sql).toContain('(e."createdAt", e."id") < ($');
        expect(newest.sql).toContain('ORDER BY e."createdAt" DESC, e."id" DESC');
        expect(newest.values).toContain('2031-01-01T00:00:00.123456Z');
        expect(newest.sql).not.toContain('DROP TABLE'); // el texto del usuario viaja como parametro
        expect(newest.values).toContain("x'; DROP TABLE \"Email\"; --");
        const oldest = buildPageSql({ scope, sort: 'oldest', filter: 'all', own: [], cursor: { ...cursor, s: 'oldest' }, take: 21, offset: 0 }, DEFAULT_SQL_OPTIONS);
        expect(oldest.sql).toContain('(e."createdAt", e."id") > ($');
        const sender = buildPageSql({ scope, sort: 'sender', filter: 'all', own: [], cursor: { ...cursor, s: 'sender', f: 'ana' }, take: 21, offset: 0 }, DEFAULT_SQL_OPTIONS);
        expect(sender.sql).toContain('bloomx_sender_key(e."from") COLLATE "C"');
        expect(sender.sql).toContain('ORDER BY (bloomx_sender_key(e."from") COLLATE "C") ASC, e."createdAt" DESC, e."id" DESC');
        // Sin la funcion en la BD: la misma expresion en linea (sin indice)
        const inline = buildPageSql({ scope, sort: 'sender', filter: 'all', own: [], cursor: null, take: 21, offset: 0 }, { ...DEFAULT_SQL_OPTIONS, senderKeyFn: false });
        expect(inline.sql).not.toContain('bloomx_sender_key');
        expect(inline.sql).toContain('translate(lower(');
    });

    it('tipo real de createdAt: timestamptz o timestamp(3) cambian solo los moldes', () => {
        const cursor = { s: 'newest' as const, t: '2031-01-01T00:00:00.123456Z', id: 'i' };
        const tz = buildPageSql({ scope, sort: 'newest', filter: 'all', own: [], cursor, take: 21, offset: 0 }, DEFAULT_SQL_OPTIONS);
        const ts = buildPageSql({ scope, sort: 'newest', filter: 'all', own: [], cursor, take: 21, offset: 0 }, { ...DEFAULT_SQL_OPTIONS, createdAtKind: 'timestamp' });
        expect(tz.sql).toContain("AT TIME ZONE 'UTC'");
        expect(tz.sql).toContain('::timestamptz');
        expect(ts.sql).not.toContain("AT TIME ZONE 'UTC'");
        expect(ts.sql).toContain('::timestamp,');
    });

    it('filtro from_me sin direcciones propias es imposible (no "todo"); con direcciones compara la direccion exacta', () => {
        const none = buildPageSql({ scope, sort: 'newest', filter: 'from_me', own: [], cursor: null, take: 21, offset: 0 }, DEFAULT_SQL_OPTIONS);
        expect(none.sql).toContain('AND FALSE');
        const some = buildPageSql({ scope, sort: 'newest', filter: 'from_me', own: ['A@x.com', 'sin-arroba'], cursor: null, take: 21, offset: 0 }, DEFAULT_SQL_OPTIONS);
        expect(some.sql).toContain('= ANY(');
        expect(some.values).toContainEqual(['a@x.com']);
        expect(normalizeOwn(['Ana_1@X.com', 'sin-arroba', 'ana_1@x.com'])).toEqual(['ana_1@x.com']);
    });

    it('clave de hilo en SQL espeja la de la interfaz (prefijos, minimo 3 letras, sin asunto = hilo propio)', () => {
        expect(SUBJECT_PREFIX_RE).toContain('fwd|res|enc|wg|tr|fw|rv|aw|sv');
        expect(SUBJECT_PREFIX_RE).toContain('invitaci[oó]n');
        expect(THREAD_KEY_SQL).toContain("'u:' || e.\"id\"");
        expect(THREAD_KEY_SQL).toContain('char_length(n."norm") < 3');
        expect(THREAD_KEY_SQL).toContain("'(No Subject)'");
    });

    it('ambito de etiquetas y busquedas excluye papelera y spam; una carpeta la filtra por igualdad', () => {
        const p1 = new SqlParams();
        const labelSql = scopeClauses({ ...emptyScope(['u'], 'inbox'), labels: ['Facturas'] }, p1, DEFAULT_SQL_OPTIONS).join(' ');
        expect(labelSql).toContain(`NOT IN ('trash','spam')`);
        expect(labelSql).not.toContain('e."folder" =');
        const p2 = new SqlParams();
        expect(scopeClauses(emptyScope(['u'], 'trash'), p2, DEFAULT_SQL_OPTIONS).join(' ')).toContain('e."folder" = $');
    });
});

describe('mail-store (puro): carpeta de origen', () => {
    it('previousFolderAfterMove: origen solo al mover a archive/trash/spam; se limpia al volver a otra carpeta', () => {
        expect([...PREVIOUS_FOLDER_TARGETS]).toEqual(['archive', 'trash', 'spam']);
        expect(previousFolderAfterMove('inbox', 'trash')).toBe('inbox');
        expect(previousFolderAfterMove('archive', 'trash')).toBe('archive');
        expect(previousFolderAfterMove('trash', 'trash', 'inbox')).toBe('inbox'); // ya estaba: conserva
        expect(previousFolderAfterMove('trash', 'inbox')).toBeNull();
        expect(previousFolderAfterMove('trash', 'sent')).toBeNull();
        expect(previousFolderAfterMove('../x', 'spam')).toBeNull();
    });

    it('restoreFolderFor: previousFolder valido > respaldo valido > bandeja (nunca papelera ni carpetas internas)', () => {
        expect([...RESTORE_TARGETS]).toEqual(['inbox', 'archive', 'spam', 'sent']);
        expect(restoreFolderFor('archive')).toBe('archive');
        expect(restoreFolderFor(null, 'spam')).toBe('spam');
        expect(restoreFolderFor('archive', 'spam')).toBe('archive');
        for (const bad of ['trash', 'snoozed', 'scheduled', 'drafts', '', undefined, null]) expect(restoreFolderFor(bad as any)).toBe('inbox');
        expect(restoreFolderFor('scheduled', 'nope')).toBe('inbox');
    });

    it('ownAddressesOf: cuenta + conectadas con @, en minuscula y sin repetir', () => {
        expect(ownAddressesOf({ email: 'Me@X.com', accounts: [{ providerAccountId: 'me@x.com' }, { providerAccountId: 'otra@y.com' }, { providerAccountId: '12345' }, { providerAccountId: null }] }))
            .toEqual(['me@x.com', 'otra@y.com']);
    });
});

describe('batch-validation: restore, fallbacks y scope', () => {
    it('restore solo como true y sin folder', () => {
        expect(parseEmailBatchUpdates({ restore: true })).toEqual({ restore: true });
        expect(parseEmailBatchUpdates({ restore: false })).toBeNull();
        expect(parseEmailBatchUpdates({ restore: 'yes' })).toBeNull();
        expect(parseEmailBatchUpdates({ restore: true, folder: 'inbox' })).toBeNull();
    });

    it('fallbacks: solo ids pedidos y carpetas conocidas (no borradores)', () => {
        expect(parseRestoreFallbacks({ a: 'archive', b: 'drafts', c: 'zzz', d: 'spam', z: 'inbox', e: 5 }, ['a', 'b', 'c', 'd', 'e'])).toEqual({ a: 'archive', d: 'spam' });
        expect(parseRestoreFallbacks('x', ['a'])).toEqual({});
        expect(parseRestoreFallbacks([], ['a'])).toEqual({});
    });

    it('scope: carpeta conocida (no borradores), filtro de la lista cerrada y buzones opcionales; SIN tope de correos', () => {
        expect(parseBatchScope({ folder: 'inbox' })).toEqual({ folder: 'inbox', filter: 'all' });
        expect(parseBatchScope({ folder: 'trash', filter: 'from_me' })).toEqual({ folder: 'trash', filter: 'from_me' });
        expect(parseBatchScope({ folder: 'inbox', mailboxes: ['a', 'b'] })).toEqual({ folder: 'inbox', filter: 'all', mailboxes: ['a', 'b'] });
        expect(parseBatchScope({ folder: 'inbox', mailboxes: 'all' })).toEqual({ folder: 'inbox', filter: 'all', mailboxes: ['all'] });
        for (const bad of [{ folder: 'drafts' }, { folder: 'snoozed' }, { folder: 'inbox', filter: 'fromMe' }, { folder: 'inbox', filter: 5 }, { folder: 'inbox', mailboxes: [] }, { folder: 'inbox', mailboxes: ['a;b'] }, { folder: 'inbox', mailboxes: 5 }, {}, null, 'inbox', []]) {
            expect(parseBatchScope(bad)).toBeNull();
        }
    });
});

describe('cuota: politica, niveles y presentacion', () => {
    it('parseQuotaMb: solo enteros 0..max', () => {
        expect(parseQuotaMb(0)).toBe(0);
        expect(parseQuotaMb('50')).toBe(50);
        for (const bad of [-1, 1.5, '', 'abc', null, undefined, NaN, Infinity, 10_000_001, {}, true]) expect(parseQuotaMb(bad)).toBeUndefined();
    });

    it('resolvePolicy: usuario > dominio > entorno > nada; 0 = sin limite; el bloqueo solo con enforce === true', () => {
        expect(resolvePolicy({})).toEqual({ limitBytes: null, source: 'none', enforce: false });
        expect(resolvePolicy({ envMb: '10' })).toEqual({ limitBytes: 10 * MB, source: 'env', enforce: false });
        expect(resolvePolicy({ envMb: '10', domainMb: 20 })).toMatchObject({ limitBytes: 20 * MB, source: 'domain' });
        expect(resolvePolicy({ envMb: '10', domainMb: 20, userMb: 30 })).toMatchObject({ limitBytes: 30 * MB, source: 'user' });
        expect(resolvePolicy({ domainMb: 20, userMb: 0 })).toEqual({ limitBytes: null, source: 'user', enforce: false });
        expect(resolvePolicy({ domainMb: 0, envMb: '10' })).toMatchObject({ limitBytes: null, source: 'domain' });
        expect(resolvePolicy({ envMb: '0' })).toMatchObject({ limitBytes: null, source: 'none' });
        expect(resolvePolicy({ domainMb: 5, enforce: true }).enforce).toBe(true);
        for (const notTrue of [false, 'true', 1, null, undefined]) expect(resolvePolicy({ domainMb: 5, enforce: notTrue }).enforce).toBe(false);
    });

    it('niveles: exito (<80) -> aviso (80) -> critico (95) -> excedido (100); aviso de texto por encima del 90 %', () => {
        expect([0, 79.9, 80, 94.9, 95, 99.9, 100, 250].map(levelFor)).toEqual(['ok', 'ok', 'warning', 'warning', 'critical', 'critical', 'exceeded', 'exceeded']);
        expect(levelFor(null)).toBe('unlimited');
        const policy = { limitBytes: 100, source: 'domain' as const, enforce: false };
        expect(buildStatus(policy, { attachmentsBytes: 90, bodiesBytes: 0, emails: 1 }).notice).toBe(false);
        expect(buildStatus(policy, { attachmentsBytes: 91, bodiesBytes: 0, emails: 1 }).notice).toBe(true);
        expect(buildStatus({ ...policy, limitBytes: null }, { attachmentsBytes: 91, bodiesBytes: 5, emails: 1 })).toMatchObject({ level: 'unlimited', percent: null, notice: false, usedBytes: 96 });
        expect(BODY_ESTIMATE.html).toBeGreaterThan(BODY_ESTIMATE.text);
    });

    it('vista: tokens de estado, avisos y validacion de la respuesta', () => {
        expect(['ok', 'warning', 'critical', 'exceeded', 'unlimited'].map((l) => quotaFillClass(l as any))).toEqual(['bg-success', 'bg-warning', 'bg-destructive', 'bg-destructive', 'bg-success']);
        expect(['ok', 'warning', 'critical', 'exceeded'].map((l) => quotaTextClass(l as any))).toEqual(['text-muted-foreground', 'text-warning', 'text-destructive', 'text-destructive']);
        const base = { usedBytes: 1, limitBytes: 100, percent: 91, level: 'warning' as const, notice: true, enforce: false };
        expect(quotaNoticeKey(base)).toBe('sidebar.quota.notice');
        expect(quotaNoticeKey({ ...base, notice: false, level: 'ok' })).toBeNull();
        expect(quotaNoticeKey({ ...base, level: 'exceeded', percent: 120 })).toBe('sidebar.quota.exceeded');
        expect(quotaNoticeKey({ ...base, level: 'exceeded', enforce: true })).toBe('sidebar.quota.blocked');
        expect(quotaNoticeKey({ ...base, limitBytes: null, level: 'unlimited' })).toBeNull();
        expect(formatStorage(1536, 'en')).toBe('1.5 KB');
        expect(formatStorage(5 * MB, 'es')).toBe('5 MB');
        expect(formatStorage(1.25 * MB, 'es')).toBe('1,25 MB');
        expect(formatStorage(-1)).toBe('—');
        expect(parseQuotaView(null)).toBeNull();
        expect(parseQuotaView({ usedBytes: 'x' })).toBeNull();
        expect(parseQuotaView({ usedBytes: 10, limitBytes: 0, level: 'exceeded', notice: true })).toMatchObject({ limitBytes: null, level: 'unlimited', notice: false });
        expect(parseQuotaView({ usedBytes: 10, limitBytes: 100, percent: 10, level: 'weird' })).toMatchObject({ level: 'unlimited' });
    });
});

describe('programados: ventana de fechas', () => {
    const now = Date.UTC(2031, 0, 1, 12, 0, 0);
    it('entre 1 minuto y 30 dias', () => {
        expect(MIN_SCHEDULE_LEAD_MS).toBe(60_000);
        expect(MAX_SCHEDULE_DAYS).toBe(30);
        expect(validateScheduleDate(new Date(now + 59_000).toISOString(), now)).toEqual({ ok: false, reason: 'too_soon' });
        expect(validateScheduleDate(new Date(now + 60_000).toISOString(), now)).toMatchObject({ ok: true });
        expect(validateScheduleDate(new Date(now + 30 * 86_400_000).toISOString(), now)).toMatchObject({ ok: true });
        expect(validateScheduleDate(new Date(now + 30 * 86_400_000 + 1000).toISOString(), now)).toEqual({ ok: false, reason: 'too_far' });
        for (const bad of ['', 'hoy', {}, null, undefined, [], true]) expect(validateScheduleDate(bad, now)).toEqual({ ok: false, reason: 'invalid' });
    });
    it('enviar ahora es inmediato: solo quedan los margenes de reprogramacion tras un rechazo (2 min) y de ultimo recurso (30 s)', () => {
        expect(SEND_NOW_RESTORE_MS).toBe(120_000);
        expect(SEND_NOW_FALLBACK_MS).toBe(30_000);
    });
});

describe('lista paginada por cursor: fusion respetando el orden del servidor', () => {
    it('appendServerPage conserva el orden recibido y descarta repetidos', () => {
        const a = [mail('3'), mail('1')];
        const merged = appendServerPage(a, [mail('1'), mail('0'), mail('2')]);
        expect(merged.map((e) => e.id)).toEqual(['3', '1', '0', '2']);
        expect(appendServerPage(a, [mail('1')])).toBe(a);
    });

    it('comparador por orden y mezcla de varias cuentas', () => {
        const old = mail('old', { createdAt: '2020-01-01T00:00:00.000Z', from: 'Zoe <z@x>' });
        const recent = mail('new', { createdAt: '2024-01-01T00:00:00.000Z', from: 'ana <a@x>' });
        expect(mergeMailboxPages('newest', [old], [recent]).map((e) => e.id)).toEqual(['new', 'old']);
        expect(mergeMailboxPages('oldest', [recent], [old]).map((e) => e.id)).toEqual(['old', 'new']);
        expect(mergeMailboxPages('sender', [old], [recent]).map((e) => e.id)).toEqual(['new', 'old']);
        expect([recent, old].sort(compareEmailsBy('oldest')).map((e) => e.id)).toEqual(['old', 'new']);
        // desempate estable por id
        const tie = [mail('b'), mail('a')];
        expect([...tie].sort(compareEmailsBy('newest')).map((e) => e.id)).toEqual(['b', 'a']);
        expect([...tie].sort(compareEmailsBy('oldest')).map((e) => e.id)).toEqual(['a', 'b']);
    });

    it('orderGroupsLike: los hilos ocupan la posicion de su primer mensaje en el orden recibido (no se reordenan por fecha)', () => {
        const emails = [
            mail('a1', { subject: 'Alfa', createdAt: '2024-01-01T00:00:00.000Z' }),
            mail('b1', { subject: 'Beta', createdAt: '2025-01-01T00:00:00.000Z' }),
            mail('a2', { subject: 'Re: Alfa', createdAt: '2026-01-01T00:00:00.000Z' }),
        ];
        const groups = groupEmailsByThread(emails as any);
        // groupEmailsByThread ordena por fecha del ultimo mensaje (Alfa primero por a2); el servidor entrego Alfa, Beta
        expect(orderGroupsLike(groups, emails).map((g) => g.count)).toEqual([2, 1]);
        const reversed = [emails[1], emails[0], emails[2]];
        expect(orderGroupsLike(groups, reversed).map((g) => g.allEmails.map((e) => e.id).sort()[0])).toEqual(['b1', 'a1']);
    });
});

describe('resend-scheduled: cancelar y reprogramar por REST (Resend simulado)', () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

    async function load(fetchImpl: (url: string, init?: RequestInit) => Promise<Response> | Response) {
        vi.resetModules();
        vi.stubEnv('RESEND_BASE_URL', 'http://resend.local');
        vi.stubEnv('RESEND_API_KEY', 're_key');
        vi.doMock('@/lib/resend', () => ({ resend: { emails: {} } }));
        const fetchMock = vi.fn(fetchImpl);
        vi.stubGlobal('fetch', fetchMock);
        const mod = await import('../resend-scheduled');
        return { mod, fetchMock };
    }

    it('reprogramar: PATCH /emails/{id} con scheduled_at ISO y Bearer; id escapado', async () => {
        const { mod, fetchMock } = await load(() => new Response('{}', { status: 200 }));
        const when = new Date('2031-05-05T10:00:00Z');
        expect(await mod.rescheduleSend('re/1?x', when)).toEqual({ ok: true });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('http://resend.local/emails/re%2F1%3Fx');
        expect(init).toMatchObject({ method: 'PATCH', headers: { Authorization: 'Bearer re_key' } });
        expect(JSON.parse(String(init!.body))).toEqual({ scheduled_at: '2031-05-05T10:00:00.000Z' });
    });

    it.each([
        [404, 'not_found', 404, 'NOT_FOUND'],
        [409, 'already_sent', 409, 'ALREADY_SENT'],
        [422, 'already_sent', 409, 'ALREADY_SENT'],
        [400, 'invalid', 400, 'INVALID_SCHEDULE'],
        [429, 'unavailable', 502, 'PROVIDER_UNAVAILABLE'],
        [500, 'unavailable', 502, 'PROVIDER_UNAVAILABLE'],
    ])('respuesta %i del proveedor -> %s -> HTTP %i %s', async (status, kind, httpStatus, code) => {
        const { mod } = await load(() => new Response(JSON.stringify({ message: 'x'.repeat(500) }), { status }));
        const r = await mod.cancelScheduledSend('re_1');
        expect(r).toMatchObject({ ok: false, kind, status });
        expect((r as any).message.length).toBeLessThanOrEqual(200);
        expect(mod.failureToHttp(r as any)).toMatchObject({ status: httpStatus, code });
    });

    it('sin red o cuerpo no JSON: unavailable, sin lanzar', async () => {
        const down = await load(() => { throw new Error('ECONNREFUSED'); });
        expect(await down.mod.rescheduleSend('re_1', new Date())).toMatchObject({ ok: false, kind: 'unavailable', status: 0 });
        const html = await load(() => new Response('<html>502</html>', { status: 502 }));
        expect(await html.mod.cancelScheduledSend('re_1')).toMatchObject({ ok: false, kind: 'unavailable', status: 502 });
    });

    it('si el SDK trae emails.cancel se usa primero (traduciendo su error)', async () => {
        vi.resetModules();
        vi.doMock('@/lib/resend', () => ({ resend: { emails: { cancel: vi.fn(async () => ({ error: { statusCode: 422, message: 'sent' } })) } } }));
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const mod = await import('../resend-scheduled');
        expect(await mod.cancelScheduledSend('re_1')).toMatchObject({ ok: false, kind: 'already_sent' });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('varias cuentas: peticiones agrupadas y clave de remitente del cliente', () => {
    const acc = (id: string, token: string | null = `tok-${id}`) => ({ id, email: `${id}@x.test`, token });

    it('sin cuentas: la sesion por cookie; sin lista de buzones: una peticion por cuenta con su token', () => {
        expect(planRequestGroups([], null)).toEqual([{ key: '__session', token: null, mailboxes: null }]);
        expect(planRequestGroups([acc('a'), acc('b')], null)).toEqual([
            { key: 'a@x.test', token: 'tok-a', mailboxes: null }, { key: 'b@x.test', token: 'tok-b', mailboxes: null },
        ]);
    });

    it('las cuentas accesibles por la sesion viajan juntas (mailboxes ordenados); las de otro login, aparte con su token', () => {
        const groups = planRequestGroups([acc('c'), acc('a'), acc('z')], new Set(['a', 'c']));
        expect(groups).toEqual([
            { key: 'mb:a,c', token: null, mailboxes: ['a', 'c'] },
            { key: 'z@x.test', token: 'tok-z', mailboxes: null },
        ]);
        // una sola cuenta accesible no justifica la union: mantiene su peticion normal
        expect(planRequestGroups([acc('a'), acc('z')], new Set(['a']))).toEqual([
            { key: 'a@x.test', token: 'tok-a', mailboxes: null }, { key: 'z@x.test', token: 'tok-z', mailboxes: null },
        ]);
        // nunca se inventan ids: lo que no esta en la lista accesible no entra en mailboxes
        expect(planRequestGroups([acc('x'), acc('y')], new Set(['a'])).every((g) => g.mailboxes === null)).toBe(true);
    });

    it('senderSortKey: nombre visible o direccion, sin acentos, comillas ni mayusculas', () => {
        expect(senderSortKey('"Álvaro Núñez" <alvaro@x.test>')).toBe('alvaro nunez');
        expect(senderSortKey('  ÉMILE <e@x.test>')).toBe('emile');
        expect(senderSortKey('<Zulu@X.test>')).toBe('zulu@x.test');
        expect(senderSortKey('BOB@x.test')).toBe('bob@x.test');
        expect(senderSortKey(null)).toBe('');
    });

    it('compareEmailsBy(sender) ordena como el servidor (clave C, fecha desc, id desc)', () => {
        const mk = (id: string, from: string, createdAt = '2025-01-01T00:00:00.000Z') => ({ id, from, subject: 's', createdAt });
        const list = [mk('1', 'Zoe <z@x>'), mk('2', '"Ángel" <a@x>'), mk('3', 'ana@x'), mk('4', 'Ángel <b@x>', '2025-02-01T00:00:00.000Z'), mk('5', 'Álvaro <v@x>')];
        expect([...list].sort(compareEmailsBy('sender')).map((e) => e.id)).toEqual(['5', '3', '4', '2', '1']);
    });
});
