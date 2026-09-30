import { describe, expect, it } from 'vitest';
import { DEFAULT_MAIL_PREFS, densityClasses, estimateRowHeight, parseMailPrefs } from '../mail-prefs';
import { isValidSnoozeDate, snoozePresets } from '../mail-snooze';
import { MAIL_DND_TYPE, buildDragPayload, canDropOnFolder, parseDragPayload } from '../mail-dnd';
import { SHORTCUT_DEFS, buildShortcutMap, resolveShortcutKey } from '../shortcuts';
import { attachmentKind, formatBytes, initialExpandedIds, isPreviewable, summarizeRecipients } from '../mail-view-state';
import { neighbours } from '../../components/mail/mail-bus';
import { pullDistance, PULL_MAX, PULL_TRIGGER } from '../../components/mail/usePullToRefresh';

describe('preferencias de la bandeja', () => {
    it('valores por defecto y saneado de lo guardado', () => {
        expect(parseMailPrefs(null)).toEqual(DEFAULT_MAIL_PREFS);
        expect(parseMailPrefs('{malformed')).toEqual(DEFAULT_MAIL_PREFS);
        expect(parseMailPrefs('[]')).toEqual(DEFAULT_MAIL_PREFS);
        const p = parseMailPrefs(JSON.stringify({ density: 'compact', snippetLines: 2, sort: 'sender', groupByDate: false, swipeRight: 'read', swipeLeft: 'none' }));
        expect(p).toEqual({ density: 'compact', snippetLines: 2, sort: 'sender', groupByDate: false, swipeRight: 'read', swipeLeft: 'none' });
    });
    it('descarta valores invalidos campo a campo', () => {
        const p = parseMailPrefs({ density: 'huge', snippetLines: 7, sort: 'random', groupByDate: 'yes', swipeRight: 'explode', swipeLeft: 3 });
        expect(p).toEqual(DEFAULT_MAIL_PREFS);
        expect(parseMailPrefs({ density: 'spacious' }).density).toBe('spacious');
    });
    it('la altura estimada crece con la densidad y las lineas de vista previa', () => {
        expect(estimateRowHeight('compact', 2)).toBe(estimateRowHeight('compact', 0));
        expect(estimateRowHeight('comfortable', 2)).toBeGreaterThan(estimateRowHeight('comfortable', 0));
        expect(estimateRowHeight('spacious', 1)).toBeGreaterThan(estimateRowHeight('comfortable', 1));
        expect(densityClasses('compact').subjectLine).toBe(true);
        expect(densityClasses('spacious').subjectLine).toBe(false);
    });
});

describe('posponer', () => {
    it('todos los atajos son fechas futuras (miercoles por la manana)', () => {
        const now = new Date(2025, 0, 15, 9, 30); // miercoles
        const p = Object.fromEntries(snoozePresets(now).map((x) => [x.id, x.date]));
        expect(Object.keys(p)).toEqual(['laterToday', 'tomorrow', 'weekend', 'nextWeek']);
        for (const d of Object.values(p)) expect(d.getTime()).toBeGreaterThan(now.getTime());
        expect(p.laterToday.getHours()).toBe(12);
        expect(p.tomorrow.getDate()).toBe(16);
        expect(p.weekend.getDay()).toBe(6); // sabado
        expect(p.nextWeek.getDay()).toBe(1); // lunes
        expect(p.nextWeek.getDate()).toBe(20);
    });
    it('por la tarde noche no hay "mas tarde hoy" y en fin de semana no hay "este fin de semana"', () => {
        const night = new Date(2025, 0, 15, 20, 0);
        expect(snoozePresets(night).map((x) => x.id)).not.toContain('laterToday');
        const saturday = new Date(2025, 0, 18, 10, 0);
        const ids = snoozePresets(saturday).map((x) => x.id);
        expect(ids).not.toContain('weekend');
        expect(snoozePresets(saturday).find((x) => x.id === 'nextWeek')!.date.getDay()).toBe(1);
        const sunday = new Date(2025, 0, 19, 10, 0);
        expect(snoozePresets(sunday).find((x) => x.id === 'nextWeek')!.date.getDate()).toBe(20);
    });
    it('una fecha elegida debe ser valida y futura', () => {
        const now = new Date(2025, 0, 15, 9, 0);
        expect(isValidSnoozeDate(new Date(2025, 0, 15, 10, 0), now)).toBe(true);
        expect(isValidSnoozeDate(new Date(2025, 0, 15, 8, 0), now)).toBe(false);
        expect(isValidSnoozeDate(new Date('x'), now)).toBe(false);
    });
});

describe('arrastrar correos al Sidebar', () => {
    const emails = [{ id: 'a', folder: 'inbox', read: true, from: 'Ana', subject: 'S', createdAt: '2025-01-01T00:00:00.000Z', labels: [{ id: 'l1', name: 'Work', color: null, extra: 1 }] }, { id: 'b' }];

    it('ida y vuelta del payload', () => {
        const payload = buildDragPayload(emails, 'inbox');
        expect(payload.emails[1].folder).toBe('inbox'); // sin folder: el de la vista
        const back = parseDragPayload(JSON.stringify(payload))!;
        expect(back.emails.map((e) => e.id)).toEqual(['a', 'b']);
        expect(back.source).toBe('inbox');
        expect(MAIL_DND_TYPE).toMatch(/bloomx/);
    });
    it('rechaza payloads ajenos o invalidos', () => {
        expect(parseDragPayload('')).toBeNull();
        expect(parseDragPayload('{oops')).toBeNull();
        expect(parseDragPayload(JSON.stringify({ emails: [] }))).toBeNull();
        expect(parseDragPayload(JSON.stringify({ emails: [{ nope: 1 }] }))).toBeNull();
        expect(parseDragPayload(JSON.stringify({ emails: Array.from({ length: 501 }, (_, i) => ({ id: `x${i}` })) }))).toBeNull();
        expect(parseDragPayload(undefined)).toBeNull();
    });
    it('solo se suelta sobre destinos de "mover" y no sobre la carpeta de origen', () => {
        const payload = parseDragPayload(JSON.stringify(buildDragPayload(emails, 'inbox')))!;
        expect(canDropOnFolder('archive', payload)).toBe(true);
        expect(canDropOnFolder('trash', payload)).toBe(true);
        expect(canDropOnFolder('inbox', payload)).toBe(false);
        expect(canDropOnFolder('sent', payload)).toBe(false);
        expect(canDropOnFolder('drafts', payload)).toBe(false);
        expect(canDropOnFolder('archive', null)).toBe(false);
    });
});

describe('registro de atajos (lo usan el teclado y el overlay de ayuda)', () => {
    it('no hay teclas duplicadas y todas estan en minusculas como las normaliza resolveShortcutKey', () => {
        const all = SHORTCUT_DEFS.flatMap((d) => d.keys);
        expect(new Set(all).size).toBe(all.length);
        for (const k of all) expect(k).toBe(k.toLowerCase());
        for (const d of SHORTCUT_DEFS) {
            expect(d.display.length).toBeGreaterThan(0);
            expect(d.labelKey).toBe(`emailList.shortcuts.${d.id}`);
        }
    });
    it('buildShortcutMap asigna cada tecla del registro y omite ids sin manejador', () => {
        const fn = () => {};
        const map = buildShortcutMap({ archive: fn, delete: fn, undo: fn });
        expect(Object.keys(map).sort()).toEqual(['#', 'backspace', 'delete', 'e', 'z']);
    });
    it('incluye los atajos pedidos: e, # / Supr, !, z, v, j/k, ?', () => {
        const all = SHORTCUT_DEFS.flatMap((d) => d.keys);
        for (const k of ['e', '#', 'delete', '!', 'z', 'v', 'j', 'k', '?', 'l', 'u', 's', 'b']) expect(all).toContain(k);
    });
    it('los caracteres con Shift ("?", "!", "#") llegan como teclas resolubles', () => {
        for (const key of ['?', '!', '#']) expect(resolveShortcutKey({ key, target: { tagName: 'DIV' } })).toBe(key);
        expect(resolveShortcutKey({ key: 'z', target: { tagName: 'INPUT' } })).toBeNull();
        expect(resolveShortcutKey({ key: 'z', ctrlKey: true })).toBeNull();
    });
});

describe('lector: adjuntos, destinatarios e hilo', () => {
    it('tipo de adjunto por MIME y por extension', () => {
        expect(attachmentKind('image/png', 'x')).toBe('image');
        expect(attachmentKind('application/pdf', 'x')).toBe('pdf');
        expect(attachmentKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a.docx')).toBe('doc');
        expect(attachmentKind('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'a.xlsx')).toBe('sheet');
        expect(attachmentKind('application/octet-stream', 'foto.JPG')).toBe('image');
        expect(attachmentKind('application/octet-stream', 'backup.zip')).toBe('archive');
        expect(attachmentKind('text/calendar', 'invite.ics')).toBe('calendar');
        expect(attachmentKind('', 'cosa.xyz')).toBe('other');
    });
    it('solo imagenes (no SVG) y PDF se previsualizan', () => {
        expect(isPreviewable('image', 'image/png', 'a.png')).toBe(true);
        expect(isPreviewable('image', 'image/svg+xml', 'a.svg')).toBe(false);
        expect(isPreviewable('pdf')).toBe(true);
        expect(isPreviewable('doc')).toBe(false);
    });
    it('tamano legible', () => {
        expect(formatBytes(0)).toBe('');
        expect(formatBytes(512, 'en')).toBe('512 B');
        expect(formatBytes(1536, 'en')).toBe('1.5 KB');
        expect(formatBytes(5 * 1024 * 1024, 'en')).toBe('5 MB');
        expect(formatBytes(1536, 'es')).toBe('1,5 KB');
        expect(formatBytes(undefined)).toBe('');
    });
    it('resumen de destinatarios', () => {
        expect(summarizeRecipients(['A', 'B', 'C', 'D'], 2)).toEqual({ shown: ['A', 'B'], extra: 2 });
        expect(summarizeRecipients([' ', 'A'], 2)).toEqual({ shown: ['A'], extra: 0 });
    });
    it('al abrir un hilo se expande el mas reciente y cada mensaje sin leer', () => {
        const thread = [{ id: 'new', read: true }, { id: 'mid', read: false }, { id: 'old', read: true }];
        expect([...initialExpandedIds(thread)].sort()).toEqual(['mid', 'new']);
        expect([...initialExpandedIds([{ id: 'solo', read: true }], 'solo')]).toEqual(['solo']);
        expect(initialExpandedIds([]).size).toBe(0);
    });
    it('vecinos para anterior/siguiente segun el orden de la lista', () => {
        const ids = ['a', 'b', 'c'];
        expect(neighbours(ids, 'b')).toEqual({ prev: 'a', next: 'c', index: 1 });
        expect(neighbours(ids, 'a')).toEqual({ prev: null, next: 'b', index: 0 });
        expect(neighbours(ids, 'c').next).toBeNull();
        expect(neighbours(ids, 'zzz')).toEqual({ prev: null, next: null, index: -1 });
        expect(neighbours(ids, null).index).toBe(-1);
    });
});

describe('pull-to-refresh', () => {
    it('la distancia es amortiguada, acotada y cero hacia arriba', () => {
        expect(pullDistance(-10)).toBe(0);
        expect(pullDistance(100)).toBe(50);
        expect(pullDistance(10_000)).toBe(PULL_MAX);
        expect(pullDistance(PULL_TRIGGER * 2)).toBeGreaterThanOrEqual(PULL_TRIGGER);
    });
});
