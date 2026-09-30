import { describe, it, expect } from 'vitest';
import {
    emailsCacheKey,
    isEmailListKey,
    shouldListRefresh,
    shouldSidebarRefresh,
    EMAIL_LISTS_AND_COUNTS_PATTERN,
    normalizeLabelList,
    mergeLabelCounts,
    planLabelToggles,
    applyLabelChange,
    labelSelectionState,
    unionLabels,
    groupEmailsByThread,
    mergeFirstPage,
    applyOptimisticUpdate,
    restoreEmails,
    isPermanentDelete,
    classifyBulkResponse,
    buildQuickReply,
    nextFocusIndex,
    type ListEmail,
} from '../mail-list';

const mk = (id: string, minutesAgo: number, extra: Partial<ListEmail> = {}): ListEmail => ({
    id,
    from: 'a@x.com',
    subject: `Asunto ${id}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 12, 0) - minutesAgo * 60000).toISOString(),
    read: false,
    ...extra,
});

describe('claves de cache', () => {
    it('la clave de lista coincide con el patron de invalidacion (realtime)', () => {
        const key = emailsCacheKey('a@x.com', '{"folder":"inbox"}');
        expect(key).toBe('emails:a@x.com:{"folder":"inbox"}');
        expect(EMAIL_LISTS_AND_COUNTS_PATTERN.test(key)).toBe(true);
        expect(EMAIL_LISTS_AND_COUNTS_PATTERN.test('stats-counts')).toBe(true);
        // no debe barrer otras claves
        expect(EMAIL_LISTS_AND_COUNTS_PATTERN.test('labels-all')).toBe(false);
        expect(EMAIL_LISTS_AND_COUNTS_PATTERN.test('email-1-thread-v2')).toBe(false);
    });

    it('usa "cookie" cuando no hay firma de buzon', () => {
        expect(emailsCacheKey('', 'ctx')).toBe('emails:cookie:ctx');
    });

    it('abrir un correo NO refresca la lista (no reinicia paginacion) pero un aviso global si', () => {
        expect(shouldListRefresh('email-abc-thread-v2')).toBe(false);
        expect(shouldListRefresh('labels-all')).toBe(false);
        expect(shouldListRefresh('emails:cookie:x')).toBe(true);
        expect(shouldListRefresh(undefined)).toBe(true);
        expect(isEmailListKey('emails-inbox')).toBe(false); // clave vieja inexistente
    });

    it('el sidebar solo refresca por claves relevantes', () => {
        expect(shouldSidebarRefresh('email-1-thread-v2')).toBe(false);
        expect(shouldSidebarRefresh('stats-counts')).toBe(true);
        expect(shouldSidebarRefresh('labels-all')).toBe(true);
        expect(shouldSidebarRefresh(undefined)).toBe(true);
    });
});

describe('labels-all: forma unica con id', () => {
    it('descarta entradas sin id y duplicados; acepta {labels: []}', () => {
        const out = normalizeLabelList([
            { id: 'l1', name: 'Work', color: '#fff', count: 3 },
            { name: 'SinId', color: '#000', count: 1 },
            { id: 'l1', name: 'Dup' },
            null,
        ]);
        expect(out).toEqual([{ id: 'l1', name: 'Work', color: '#fff', count: 3 }]);
        expect(normalizeLabelList({ labels: [{ id: 'l2', name: 'X' }] })).toEqual([{ id: 'l2', name: 'X', color: null, count: 0 }]);
        expect(normalizeLabelList('basura')).toEqual([]);
    });

    it('mergeLabelCounts une por id y, si falta, por nombre en minuscula', () => {
        const labels = normalizeLabelList([{ id: 'l1', name: 'Work' }, { id: 'l2', name: 'Home' }]);
        const merged = mergeLabelCounts(labels, [{ id: 'l1', name: 'Work', count: 5 }, { name: 'home', count: 2 }]);
        expect(merged.map((l) => [l.id, l.count])).toEqual([['l1', 5], ['l2', 2]]);
    });
});

describe('etiquetado masivo', () => {
    const emails = [
        mk('1', 1, { labels: [{ id: 'L', name: 'Work' }] }),
        mk('2', 2),
        mk('3', 3, { labels: [{ id: 'L', name: 'Work' }] }),
    ];

    it('add: solo alterna en los que NO tienen el label (toggle no debe quitarlo a quien ya lo tiene)', () => {
        const plan = planLabelToggles(emails, ['1', '2', '3'], 'L');
        expect(plan).toEqual({ mode: 'add', toggleIds: ['2'] });
    });

    it('remove: si todos lo tienen, se alterna en todos', () => {
        const plan = planLabelToggles(emails, ['1', '3'], 'L');
        expect(plan).toEqual({ mode: 'remove', toggleIds: ['1', '3'] });
    });

    it('applyLabelChange agrega/quita de forma optimista sin duplicar', () => {
        const added = applyLabelChange(emails, ['2'], { id: 'L', name: 'Work', color: '#f00' }, 'add');
        expect(added[1].labels).toEqual([{ id: 'L', name: 'Work', color: '#f00' }]);
        const again = applyLabelChange(added, ['2'], { id: 'L', name: 'Work' }, 'add');
        expect(again[1].labels).toHaveLength(1);
        const removed = applyLabelChange(added, ['1', '2'], { id: 'L', name: 'Work' }, 'remove');
        expect(removed[0].labels).toEqual([]);
        expect(removed[1].labels).toEqual([]);
        expect(removed[2].labels).toHaveLength(1); // no seleccionado
    });

    it('labelSelectionState distingue all/some/none', () => {
        expect(labelSelectionState(emails, ['1', '3'], 'L')).toBe('all');
        expect(labelSelectionState(emails, ['1', '2'], 'L')).toBe('some');
        expect(labelSelectionState(emails, ['2'], 'L')).toBe('none');
        expect(labelSelectionState(emails, [], 'L')).toBe('none');
    });

    it('unionLabels junta los labels reales de un hilo (chips)', () => {
        const u = unionLabels([
            { labels: [{ id: 'a', name: 'A' }] },
            { labels: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] },
            {},
        ]);
        expect(u.map((l) => l.id)).toEqual(['a', 'b']);
    });
});

describe('hilos', () => {
    it('agrupa por asunto normalizado + destinatarios y ordena por el mas reciente', () => {
        const list = [
            mk('1', 10, { subject: 'Hola', to: 'me@x.com' }),
            mk('2', 5, { subject: 'Re: Hola', to: 'me@x.com' }),
            mk('3', 1, { subject: 'Otro', to: 'me@x.com' }),
            mk('4', 20, { subject: 'ab', to: 'me@x.com' }),
            mk('5', 21, { subject: 'ab', to: 'me@x.com' }),
        ];
        const groups = groupEmailsByThread(list);
        expect(groups.map((g) => g.id)).toEqual(['3', '2', '4', '5']);
        expect(groups[1].count).toBe(2);
        expect(groups[1].allEmails.map((e) => e.id)).toEqual(['2', '1']);
    });
});

describe('paginacion estable', () => {
    it('mergeFirstPage conserva paginas cargadas mas antiguas cuando el servidor tiene mas', () => {
        const existing = [mk('1', 1), mk('2', 2), mk('3', 3), mk('4', 40), mk('5', 50)];
        const fresh = [mk('0', 0), mk('1', 1), mk('2', 2), mk('3', 3)];
        const { emails, preservedTail } = mergeFirstPage(existing, fresh, true);
        expect(preservedTail).toBe(true);
        expect(emails.map((e) => e.id)).toEqual(['0', '1', '2', '3', '4', '5']);
    });

    it('sin mas paginas en el servidor, la lista fresca reemplaza (refleja borrados)', () => {
        const existing = [mk('1', 1), mk('2', 2)];
        const fresh = [mk('1', 1)];
        expect(mergeFirstPage(existing, fresh, false)).toEqual({ emails: fresh, preservedTail: false });
    });

    it('no duplica ni resucita correos nuevos ya presentes', () => {
        const existing = [mk('1', 1), mk('9', 90)];
        const { emails } = mergeFirstPage(existing, [mk('1', 1)], true);
        expect(emails.map((e) => e.id)).toEqual(['1', '9']);
    });
});

describe('acciones masivas: optimista y reversion', () => {
    const base = [mk('1', 1), mk('2', 2), mk('3', 3)];

    it('mover de carpeta quita las filas; otras acciones las actualizan', () => {
        expect(applyOptimisticUpdate(base, ['2'], { folder: 'archive' }).map((e) => e.id)).toEqual(['1', '3']);
        const starred = applyOptimisticUpdate(base, ['2'], { starred: true });
        expect(starred[1].starred).toBe(true);
        expect(starred[0].starred).toBeUndefined();
    });

    it('restoreEmails repone las filas quitadas en su posicion cronologica y deshace cambios', () => {
        const snapshot = base.filter((e) => e.id === '2' || e.id === '3');
        const optimistic = applyOptimisticUpdate(base, ['2', '3'], { folder: 'trash' });
        expect(optimistic.map((e) => e.id)).toEqual(['1']);
        expect(restoreEmails(optimistic, snapshot).map((e) => e.id)).toEqual(['1', '2', '3']);

        const flagged = applyOptimisticUpdate(base, ['1'], { read: true });
        const restored = restoreEmails(flagged, [base[0]]);
        expect(restored[0].read).toBe(false);
    });

    it('borrado permanente solo en trash/borradores (requiere confirmacion)', () => {
        expect(isPermanentDelete('trash', { folder: 'trash' })).toBe(true);
        expect(isPermanentDelete('drafts', { folder: 'trash' })).toBe(true);
        expect(isPermanentDelete('inbox', { folder: 'trash' })).toBe(false);
        expect(isPermanentDelete('trash', { folder: 'inbox' })).toBe(false);
    });

    it('respuestas 4xx/5xx se revierten; 2xx no', () => {
        expect(classifyBulkResponse(200)).toBe('ok');
        expect(classifyBulkResponse(204)).toBe('ok');
        expect(classifyBulkResponse(403)).toBe('revert');
        expect(classifyBulkResponse(500)).toBe('revert');
    });
});

describe('respuesta rapida y foco', () => {
    it('buildQuickReply usa replyTo, no duplica Re: y cita el contenido', () => {
        const r = buildQuickReply(
            { from: 'Ana <a@x.com>', replyTo: 'r@x.com', subject: 'Re: Hola', createdAt: '2026-01-01' },
            '<p>hi</p>',
            '1 ene'
        );
        expect(r.to).toBe('r@x.com');
        expect(r.subject).toBe('Re: Hola');
        expect(r.body).toContain('<p>hi</p>');
        expect(buildQuickReply({ from: 'a@x.com', subject: 'Hola', createdAt: '' }, '', '').subject).toBe('Re: Hola');
    });

    it('nextFocusIndex se acota a los limites', () => {
        expect(nextFocusIndex(-1, 3, 1)).toBe(0);
        expect(nextFocusIndex(-1, 3, -1)).toBe(0);
        expect(nextFocusIndex(2, 3, 1)).toBe(2);
        expect(nextFocusIndex(0, 3, -1)).toBe(0);
        expect(nextFocusIndex(1, 3, 1)).toBe(2);
        expect(nextFocusIndex(0, 0, 1)).toBe(-1);
    });
});
