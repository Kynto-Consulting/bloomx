import { describe, expect, it } from 'vitest';
import { groupEmailsByThread, type ListEmail } from '../mail-list';
import {
    AVATAR_TONES,
    attachmentSummary,
    avatarTone,
    dateBucket,
    filterGroups,
    flattenRows,
    flattenSections,
    focusAfterRemoval,
    headerIndexes,
    isFromMe,
    ownAddressSet,
    quickFilterCounts,
    reduceListEvent,
    sectionsByDate,
    selectionSummary,
    senderAddress,
    senderInitials,
    senderName,
    sortGroups,
    threadParticipants,
} from '../mail-list-view';

// Miercoles 15 de enero de 2025, 12:00 (hora local). Semana: lunes 13 a domingo 19.
const NOW = new Date(2025, 0, 15, 12, 0, 0).getTime();
const at = (y: number, m: number, d: number, h = 9) => new Date(y, m, d, h).toISOString();

const mail = (id: string, over: Partial<ListEmail> = {}): ListEmail => ({
    id, from: 'Ana <ana@x.com>', subject: `Asunto ${id}`, createdAt: at(2025, 0, 15), read: true, ...over,
});

describe('cubetas de fecha', () => {
    it('hoy, ayer, esta semana, este mes y mas antiguos', () => {
        expect(dateBucket(at(2025, 0, 15, 8), NOW)).toBe('today');
        expect(dateBucket(at(2025, 0, 14, 23), NOW)).toBe('yesterday');
        expect(dateBucket(at(2025, 0, 13), NOW)).toBe('thisWeek'); // lunes
        expect(dateBucket(at(2025, 0, 6), NOW)).toBe('thisMonth'); // lunes anterior, mismo mes
        expect(dateBucket(at(2024, 11, 20), NOW)).toBe('older');
        expect(dateBucket(at(2024, 0, 15), NOW)).toBe('older'); // mismo mes de otro anio
    });
    it('futuro y fechas invalidas', () => {
        expect(dateBucket(at(2025, 0, 20), NOW)).toBe('upcoming');
        expect(dateBucket('no-fecha', NOW)).toBe('older');
    });
    it('el lunes, el domingo anterior es "ayer" y el resto de la semana pasada es de este mes', () => {
        const monday = new Date(2025, 0, 13, 10).getTime();
        expect(dateBucket(at(2025, 0, 12), monday)).toBe('yesterday');
        expect(dateBucket(at(2025, 0, 11), monday)).toBe('thisMonth');
    });
});

describe('secciones por fecha (encabezados)', () => {
    const groups = groupEmailsByThread([
        mail('a', { createdAt: at(2025, 0, 15, 11) }),
        mail('b', { createdAt: at(2025, 0, 15, 8), subject: 'Otro' }),
        mail('c', { createdAt: at(2025, 0, 14), subject: 'Ayer' }),
        mail('d', { createdAt: at(2024, 10, 1), subject: 'Viejo' }),
    ]);

    it('agrupa hilos consecutivos por cubeta sin reordenar', () => {
        const sections = sectionsByDate(groups, NOW);
        expect(sections.map((s) => [s.bucket, s.groups.length])).toEqual([['today', 2], ['yesterday', 1], ['older', 1]]);
    });

    it('la lista plana intercala encabezados y filas y numera solo las filas', () => {
        const flat = flattenSections(sectionsByDate(groups, NOW));
        expect(flat.map((i) => i.kind)).toEqual(['header', 'row', 'row', 'header', 'row', 'header', 'row']);
        expect(flat.filter((i) => i.kind === 'row').map((i) => (i as any).rowIndex)).toEqual([0, 1, 2, 3]);
        expect(headerIndexes(flat)).toEqual([0, 3, 5]);
        expect(new Set(flat.map((i) => i.id)).size).toBe(flat.length); // ids unicos (clave de virtualizacion)
    });

    it('sin encabezados: solo filas', () => {
        const flat = flattenRows(groups);
        expect(flat.every((i) => i.kind === 'row')).toBe(true);
        expect(headerIndexes(flat)).toEqual([]);
    });
});

describe('remitente y avatar', () => {
    it('nombre, direccion e iniciales', () => {
        expect(senderName('"Ana López" <ana@x.com>')).toBe('Ana López');
        expect(senderName('Ana <ana@x.com>')).toBe('Ana');
        expect(senderName('ana.perez@x.com')).toBe('ana.perez');
        expect(senderName('')).toBe('');
        expect(senderAddress('Ana <ANA@X.com>')).toBe('ana@x.com');
        expect(senderInitials('Ana López <ana@x.com>')).toBe('AL');
        expect(senderInitials('ana.perez@x.com')).toBe('AP');
        expect(senderInitials('Kynto')).toBe('K');
        expect(senderInitials('')).toBe('?');
        expect(senderInitials('<>')).toBe('?');
    });

    it('el color es estable por remitente, esta en rango y se reparte', () => {
        expect(avatarTone('Ana <ana@x.com>')).toBe(avatarTone('ANA@x.com'));
        const tones = new Set<number>();
        for (let i = 0; i < 200; i++) {
            const t = avatarTone(`user${i}@dominio${i % 7}.com`);
            expect(t).toBeGreaterThanOrEqual(0);
            expect(t).toBeLessThan(AVATAR_TONES);
            tones.add(t);
        }
        expect(tones.size).toBe(AVATAR_TONES);
    });
});

describe('adjuntos y participantes', () => {
    it('cuenta adjuntos unicos por nombre en todo el hilo', () => {
        const s = attachmentSummary([
            { attachments: [{ filename: 'a.pdf' }, { filename: 'b.png' }] },
            { attachments: [{ filename: 'A.PDF' }] },
            {},
        ]);
        expect(s.count).toBe(2);
        expect(s.names).toEqual(['a.pdf', 'b.png']);
        expect(attachmentSummary([]).count).toBe(0);
    });

    it('participantes: nombres distintos, recientes primero, con "+n"', () => {
        const emails = [
            mail('1', { from: 'Ana <ana@x.com>', createdAt: at(2025, 0, 10) }),
            mail('2', { from: 'Luis <luis@x.com>', createdAt: at(2025, 0, 12) }),
            mail('3', { from: 'Ana <ana@x.com>', createdAt: at(2025, 0, 13) }),
            mail('4', { from: 'Eva <eva@x.com>', createdAt: at(2025, 0, 14) }),
            mail('5', { from: 'Kim <kim@x.com>', createdAt: at(2025, 0, 11) }),
        ];
        const p = threadParticipants(emails, 3);
        expect(p.names).toEqual(['Eva', 'Ana', 'Luis']);
        expect(p.extra).toBe(1);
    });
});

describe('filtros rapidos y orden', () => {
    const own = ownAddressSet(['yo@mi.com', 'Otra <OTRA@mi.com>']);
    const emails: ListEmail[] = [
        mail('1', { read: false, subject: 'Uno', createdAt: at(2025, 0, 15, 11) }),
        mail('2', { starred: true, subject: 'Dos', from: 'Zoe <zoe@x.com>', createdAt: at(2025, 0, 14) }),
        mail('3', { attachments: [{ filename: 'f.pdf' }], subject: 'Tres', from: 'Bob <bob@x.com>', createdAt: at(2025, 0, 13) }),
        mail('4', { from: 'Yo <yo@mi.com>', subject: 'Cuatro', createdAt: at(2025, 0, 12) }),
    ];
    const groups = groupEmailsByThread(emails);

    it('cada filtro deja solo los hilos que lo cumplen', () => {
        expect(filterGroups(groups, 'unread', own).map((g) => g.id)).toEqual(['1']);
        expect(filterGroups(groups, 'starred', own).map((g) => g.id)).toEqual(['2']);
        expect(filterGroups(groups, 'attachments', own).map((g) => g.id)).toEqual(['3']);
        expect(filterGroups(groups, 'fromMe', own).map((g) => g.id)).toEqual(['4']);
        expect(filterGroups(groups, 'all', own)).toBe(groups);
    });

    it('los conteos salen de los hilos', () => {
        expect(quickFilterCounts(groups, own)).toEqual({ all: 4, unread: 1, starred: 1, attachments: 1, fromMe: 1 });
    });

    it('isFromMe compara direcciones sin importar mayusculas ni nombre', () => {
        expect(isFromMe({ from: 'Yo <YO@mi.com>' }, own)).toBe(true);
        expect(isFromMe({ from: 'otra@mi.com' }, own)).toBe(true);
        expect(isFromMe({ from: 'zoe@x.com' }, own)).toBe(false);
    });

    it('orden: recientes, antiguos y por remitente (A-Z)', () => {
        expect(sortGroups(groups, 'newest').map((g) => g.id)).toEqual(['1', '2', '3', '4']);
        expect(sortGroups(groups, 'oldest').map((g) => g.id)).toEqual(['4', '3', '2', '1']);
        // ana (1), bob (3), yo (4), zoe (2)
        expect(sortGroups(groups, 'sender').map((g) => g.id)).toEqual(['1', '3', '4', '2']);
        expect(groups.map((g) => g.id)).toEqual(['1', '2', '3', '4']); // no muta la entrada
    });
});

describe('seleccion masiva', () => {
    it('todas las cargadas seleccionadas + mas en el servidor = se puede ofrecer toda la carpeta', () => {
        const ids = ['a', 'b', 'c'];
        const s = selectionSummary(new Set(ids), ids, 130, true);
        expect(s.allLoadedSelected).toBe(true);
        expect(s.canSelectWholeFolder).toBe(true);
        expect(s.wholeFolderCount).toBe(130);
    });
    it('sin tope: el alcance completo se ofrece con su total real (el servidor actua sobre todo)', () => {
        const s = selectionSummary(new Set(['a']), ['a'], 1_250_000, true);
        expect(s.wholeFolderCount).toBe(1_250_000);
        expect(s).not.toHaveProperty('exceedsLimit');
    });
    it('sin todas marcadas, sin paginas extra o sin total no se ofrece', () => {
        expect(selectionSummary(new Set(['a']), ['a', 'b'], 50, true).canSelectWholeFolder).toBe(false);
        expect(selectionSummary(new Set(['a', 'b']), ['a', 'b'], 2, false).canSelectWholeFolder).toBe(false);
        expect(selectionSummary(new Set(), [], null, false).allLoadedSelected).toBe(false);
    });
});

describe('eventos optimistas de la lista', () => {
    const list = [mail('1', { folder: 'inbox', read: false }), mail('2', { folder: 'inbox' })];
    const opts = { viewFolder: 'inbox', restrictToFolder: true };

    it('remove quita por id', () => {
        expect(reduceListEvent(list, { type: 'remove', ids: ['1'] }, opts).map((e) => e.id)).toEqual(['2']);
    });
    it('patch cambia solo los que estan y no anade nada', () => {
        const next = reduceListEvent(list, { type: 'patch', items: [{ id: '1', updates: { read: true } }, { id: 'zzz', updates: { read: true } }] }, opts);
        expect(next.find((e) => e.id === '1')!.read).toBe(true);
        expect(next).toHaveLength(2);
        expect(reduceListEvent(list, { type: 'patch', items: [{ id: 'zzz', updates: {} }] }, opts)).toBe(list);
    });
    it('upsert repone los quitados (deshacer) en su carpeta y ordena por fecha', () => {
        const removed = mail('9', { folder: 'inbox', createdAt: at(2025, 0, 16) });
        const next = reduceListEvent(list, { type: 'upsert', emails: [removed] }, opts);
        expect(next.map((e) => e.id)).toEqual(['9', '1', '2']);
    });
    it('upsert de otra carpeta no se cuela en una vista de carpeta, pero si en busquedas', () => {
        const other = mail('8', { folder: 'archive' });
        expect(reduceListEvent(list, { type: 'upsert', emails: [other] }, opts)).toHaveLength(2);
        expect(reduceListEvent(list, { type: 'upsert', emails: [other] }, { viewFolder: 'inbox', restrictToFolder: false })).toHaveLength(3);
    });
    it('upsert combina con lo existente (revierte una marca sin perder campos)', () => {
        const next = reduceListEvent(list, { type: 'upsert', emails: [{ id: '1', from: 'Ana <ana@x.com>', subject: 'Asunto 1', createdAt: list[0].createdAt, read: true }] }, opts);
        expect(next.find((e) => e.id === '1')).toMatchObject({ read: true, folder: 'inbox' });
    });
});

describe('foco al quitar filas', () => {
    const ids = ['a', 'b', 'c', 'd'];
    it('pasa a la siguiente fila que siga; si no hay, a la anterior', () => {
        expect(focusAfterRemoval(ids, new Set(['b']), 'b')).toBe('c');
        expect(focusAfterRemoval(ids, new Set(['b', 'c']), 'b')).toBe('d');
        expect(focusAfterRemoval(ids, new Set(['d']), 'd')).toBe('c');
        expect(focusAfterRemoval(ids, new Set(['c', 'd']), 'd')).toBe('b');
    });
    it('null si no quedan filas o el foco no estaba en una fila quitada', () => {
        expect(focusAfterRemoval(['a'], new Set(['a']), 'a')).toBeNull();
        expect(focusAfterRemoval(ids, new Set(['b']), 'c')).toBeNull();
        expect(focusAfterRemoval(ids, new Set(['b']), null)).toBeNull();
    });
});
