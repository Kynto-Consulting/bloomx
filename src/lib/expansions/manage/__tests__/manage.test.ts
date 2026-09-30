import { describe, expect, it } from 'vitest';
import { KNOWN_MOUNT_POINTS, PERMISSION_CATALOG } from '@/lib/expansions/manifest-schema';
import { compareSemver, hasUpdate, parseSemver } from '../semver';
import { deriveCategory, tagsOf, mountPointsOf } from '../categories';
import { PERMISSION_TEXTS, describePermission, describePermissions, highestSensitivity } from '../permissions';
import { MOUNT_LABELS, mountLabel } from '../mount-labels';
import { buildRows, categoryCounts, filterRows, matchesQuery, normalizeText, orderableIds, safeChangelog, safeScreenshots, sortRows, statusCounts, tagCounts, formatRelativeTime } from '../model';
import { formatErrorReport, redactMessage } from '../report';
import { EMPTY_PREFS, withEnabled, withMoved } from '@/lib/expansions/client/prefs';

const button = (label = 'Hola') => ({ type: 'BUTTON', props: { label } });
const manifest = (over: Record<string, any> = {}) => ({ id: 'x', name: 'X', version: '1.0.0', mounts: [{ point: 'EMAIL_TOOLBAR', component: button() }], ...over });
const ext = (over: Record<string, any> = {}, wrap: Record<string, any> = {}) => ({ id: over.id ?? 'x', template: manifest(over), ...wrap });

describe('semver', () => {
    it('compara versiones', () => {
        expect(compareSemver('1.2.3', '1.2.4')).toBe(-1);
        expect(compareSemver('1.10.0', '1.9.9')).toBe(1);
        expect(compareSemver('v2.0.0', '2.0.0')).toBe(0);
        expect(compareSemver('1.0.0-beta.1', '1.0.0')).toBe(-1);
        expect(compareSemver('1.0.0-beta.2', '1.0.0-beta.10')).toBe(-1);
        expect(compareSemver('1.0.0-alpha', '1.0.0-1')).toBe(1);
        expect(compareSemver('1.0.0+build', '1.0.0')).toBe(0);
    });
    it('invalidas no comparan', () => {
        expect(compareSemver('abc', '1.0.0')).toBeNull();
        expect(compareSemver(undefined, '1.0.0')).toBeNull();
        expect(parseSemver('1.0')).toBeNull();
    });
    it('hasUpdate solo si el catalogo es estrictamente mayor', () => {
        expect(hasUpdate('1.0.0', '1.1.0')).toBe(true);
        expect(hasUpdate('1.1.0', '1.1.0')).toBe(false);
        expect(hasUpdate('2.0.0', '1.9.0')).toBe(false);
        expect(hasUpdate(null, '1.0.0')).toBe(false);
        expect(hasUpdate('1.0.0', null)).toBe(false);
        expect(hasUpdate('1.0.0-rc.1', '1.0.0')).toBe(true);
    });
});

describe('categorias', () => {
    const cases: Array<[string, any, string]> = [
        ['categoria explicita (alias es)', manifest({ category: 'Correo', mounts: [] }), 'mail'],
        ['categoria explicita id', manifest({ category: 'redactor' }), 'composer'],
        ['categoria desconocida cae a derivada', manifest({ category: 'zzz' }), 'mail'],
        ['barra del correo', manifest(), 'mail'],
        ['permiso READ_EMAIL', manifest({ mounts: [{ point: 'PAGE', path: 'a', component: button() }], permissions: ['READ_EMAIL'] }), 'mail'],
        ['redactor', manifest({ mounts: [{ point: 'COMPOSER_TOOLBAR', component: button() }] }), 'composer'],
        ['slash command', manifest({ mounts: [{ point: 'SLASH_COMMAND', component: button() }] }), 'composer'],
        ['calendario por mount', manifest({ mounts: [{ point: 'CALENDAR_TOOLBAR', component: button() }] }), 'calendar'],
        ['calendario por permiso', manifest({ mounts: [], permissions: ['CALENDAR_READ'] }), 'calendar'],
        ['contactos', manifest({ mounts: [{ point: 'CONTACTS_TOOLBAR', component: button() }] }), 'contacts'],
        ['automatizacion por hooks', manifest({ mounts: [], intercepts: [{ point: 'CRON', schedule: 'daily', handler: 'run' }] }), 'automation'],
        ['ia', manifest({ mounts: [], permissions: ['AI_GENERATE'] }), 'ai'],
        ['integraciones', manifest({ mounts: [], permissions: ['HTTP_REQUEST'] }), 'integrations'],
        ['integraciones por auth', manifest({ mounts: [], auth: { type: 'OAUTH2' } }), 'integrations'],
        ['ajustes', manifest({ mounts: [{ point: 'SETTINGS_TAB', component: button() }] }), 'settings'],
        ['otras', manifest({ mounts: [] }), 'other'],
    ];
    it.each(cases)('%s', (_name, template, expected) => expect(deriveCategory(template)).toBe(expected));
    it('entradas hostiles no lanzan', () => {
        expect(deriveCategory(null)).toBe('other');
        expect(deriveCategory('x')).toBe('other');
        expect(deriveCategory({ mounts: 'no', permissions: 5, category: 7 })).toBe('other');
    });
    it('tags: recorta, deduplica sin tildes y acota', () => {
        expect(tagsOf({ tags: ['  IA ', 'ia', 'Organización', 'organizacion', 5, '', 'x'.repeat(50)] })).toEqual(['IA', 'Organización', 'x'.repeat(30)]);
        expect(tagsOf({ tags: Array.from({ length: 40 }, (_, i) => `t${i}`) })).toHaveLength(12);
        expect(tagsOf({})).toEqual([]);
        expect(mountPointsOf(manifest({ mounts: [{ point: 'A' }, { point: 'A' }, { point: 'B' }, 3] }))).toEqual(['A', 'B']);
    });
});

describe('permisos legibles', () => {
    it('todos los permisos conocidos tienen texto es y en y nivel', () => {
        for (const key of Object.keys(PERMISSION_CATALOG)) {
            const info = PERMISSION_TEXTS[key];
            expect(info, `falta ${key}`).toBeTruthy();
            expect(info.es.length).toBeGreaterThan(5);
            expect(info.en.length).toBeGreaterThan(5);
            expect(['low', 'medium', 'high']).toContain(info.level);
            expect(describePermission(key, 'es').known).toBe(true);
            expect(describePermission(key, 'en').text).toBe(info.en);
        }
        // y no sobran claves que el schema no conozca
        for (const key of Object.keys(PERMISSION_TEXTS)) expect(PERMISSION_CATALOG[key], `sobra ${key}`).toBeTruthy();
    });
    it('frases del enunciado', () => {
        expect(describePermission('READ_EMAIL').text).toBe('Leer el correo que tienes abierto');
        expect(describePermission('HTTP_REQUEST').text).toBe('Conectarse a servicios externos');
    });
    it('ENV_READ:X usa el ajuste del administrador; las reservadas o invalidas son no documentadas', () => {
        expect(describePermission('ENV_READ:MI_CLAVE').text).toBe('Usar el ajuste MI_CLAVE del administrador');
        expect(describePermission('ENV_READ:MI_CLAVE', 'en').text).toContain('MI_CLAVE');
        expect(describePermission('ENV_READ:DATABASE_URL').known).toBe(false);
        expect(describePermission('ENV_READ:minuscula').known).toBe(false);
    });
    it('desconocidos se muestran tal cual y todo se ordena por sensibilidad', () => {
        const list = describePermissions(['NOTIFY', 'MAIL_LABEL', 'RARO', 'READ_EMAIL', 'NOTIFY', 'toString']);
        expect(list.map((p) => p.permission)).toEqual(['READ_EMAIL', 'RARO', 'toString', 'MAIL_LABEL', 'NOTIFY']);
        expect(list[1]).toMatchObject({ known: false, text: 'RARO' });
        expect(highestSensitivity(['NOTIFY', 'MAIL_LABEL'])).toBe('medium');
        expect(highestSensitivity([])).toBeNull();
        expect(describePermissions('no')).toEqual([]);
    });
    it('puntos de montaje: todos tienen nombre legible', () => {
        for (const point of KNOWN_MOUNT_POINTS) expect(MOUNT_LABELS[point], `falta ${point}`).toBeTruthy();
        expect(mountLabel('EMAIL_TOOLBAR')).toBe('Barra del correo');
        expect(mountLabel('COMPOSER_TOOLBAR')).toBe('Barra del redactor');
        expect(mountLabel('COMPOSER_TOOLBAR', 'en')).toBe('Composer toolbar');
        expect(mountLabel('NUEVO_X')).toBe('NUEVO_X');
        expect(mountLabel('constructor')).toBe('constructor');
    });
});

describe('filas, busqueda, filtros y contadores', () => {
    const extensions = [
        ext({ id: 'zoom', name: 'Reuniones Zoom', description: 'Crea videollamadas', tags: ['video', 'Organización'], mounts: [{ point: 'CALENDAR_TOOLBAR', component: button() }] }),
        ext({ id: 'signature', name: 'Firma', description: 'Añade tu firma', mounts: [{ point: 'COMPOSER_TOOLBAR', component: button() }] }),
        ext({ id: 'off', name: 'Apagada', status: 'disabled' }),
        { id: 'broken', template: { id: 'broken', name: 'Rota', version: 'no-es-semver', mounts: [] } },
        ext({ id: 'zoom' }), // duplicado: se ignora
    ];
    const errors = [{ id: 'e1', at: 1, extensionId: 'signature', kind: 'render' as const, message: 'boom', count: 1 }];
    const prefs = withEnabled(EMPTY_PREFS, 'zoom', false);
    const catalog = new Map([['signature', { version: '1.2.0', isPaid: true, price: '5', currency: 'USD' }], ['zoom', { isPaid: false }]]);
    const rows = buildRows({ extensions, prefs, errors, catalog });
    const byId = (id: string) => rows.find((r) => r.id === id)!;

    it('una fila por extension, con estado y motivo de invalidez', () => {
        expect(rows.map((r) => r.id)).toEqual(['zoom', 'signature', 'off', 'broken']);
        expect(byId('broken')).toMatchObject({ valid: false, hasErrors: true, active: false });
        expect(byId('broken').invalidReasons.join(' ')).toMatch(/semver/i);
        expect(byId('off')).toMatchObject({ orgDisabled: true, active: false });
        expect(byId('zoom')).toMatchObject({ userEnabled: false, active: false, category: 'calendar', isPaid: false });
        expect(byId('signature')).toMatchObject({ active: true, errorCount: 1, hasErrors: true, isPaid: true, price: '5', catalogVersion: '1.2.0', updateAvailable: true, category: 'composer' });
    });
    it('busqueda sin tildes ni mayusculas en nombre, descripcion, id y etiquetas', () => {
        expect(normalizeText('  ÁÉÍ  Ñu ')).toBe('aei nu');
        expect(filterRows(rows, { query: 'ANADE' }).map((r) => r.id)).toEqual(['signature']);
        expect(filterRows(rows, { query: 'añade firma' }).map((r) => r.id)).toEqual(['signature']);
        expect(filterRows(rows, { query: 'organizacion' }).map((r) => r.id)).toEqual(['zoom']);
        expect(filterRows(rows, { query: 'VIDEOLLAMADAS zoom' }).map((r) => r.id)).toEqual(['zoom']);
        expect(filterRows(rows, { query: 'broken' }).map((r) => r.id)).toEqual(['broken']);
        expect(matchesQuery(byId('zoom'), '   ')).toBe(true);
    });
    it('filtros por estado', () => {
        const ids = (status: any) => filterRows(rows, { status }).map((r) => r.id);
        expect(ids('active')).toEqual(['signature']);
        expect(ids('user-disabled')).toEqual(['zoom']);
        expect(ids('org-disabled')).toEqual(['off']);
        expect(ids('errors')).toEqual(['signature', 'broken']);
        expect(ids('paid')).toEqual(['signature']);
        expect(ids('free')).toEqual(['zoom']);
    });
    it('filtros por categoria y etiqueta, y contadores', () => {
        expect(filterRows(rows, { category: 'composer' }).map((r) => r.id)).toEqual(['signature']);
        expect(filterRows(rows, { tag: 'organizacion' }).map((r) => r.id)).toEqual(['zoom']);
        expect(statusCounts(rows)).toMatchObject({ all: 4, active: 1, 'user-disabled': 1, 'org-disabled': 1, errors: 2, paid: 1, free: 1 });
        expect(statusCounts(filterRows(rows, { query: 'firma' })).all).toBe(1);
        expect(categoryCounts(rows).get('calendar')).toBe(1);
        expect(tagCounts(rows)).toEqual([{ tag: 'video', count: 1 }, { tag: 'Organización', count: 1 }].sort((a, b) => a.tag.localeCompare(b.tag)));
    });
    it('orden efectivo: prefs primero, invalidas al final, numeracion solo de las validas', () => {
        const moved = withMoved(EMPTY_PREFS, orderableIds(rows, EMPTY_PREFS), 'off', -1);
        expect(orderableIds(rows, EMPTY_PREFS)).toEqual(['zoom', 'signature', 'off']);
        expect(sortRows(rows, moved).map((r) => r.id)).toEqual(['zoom', 'off', 'signature', 'broken']);
        const up = withMoved(EMPTY_PREFS, orderableIds(rows, EMPTY_PREFS), 'signature', -1);
        expect(orderableIds(rows, up)).toEqual(['signature', 'zoom', 'off']);
    });
    it('capturas solo https absolutas; changelog acotado y como texto', () => {
        expect(safeScreenshots(['https://a.test/x.png', 'http://a.test/x.png', 'javascript:alert(1)', 'data:image/png;base64,xx', '/rel.png', 5])).toEqual(['https://a.test/x.png']);
        expect(safeScreenshots(Array.from({ length: 20 }, (_, i) => `https://a.test/${i}.png`))).toHaveLength(6);
        const log = safeChangelog([{ version: '1.0.0', date: '2026-01-01', notes: '<b>x</b>' }, { notes: 'sin version' }, { version: '0.9.0', notes: ['a', 'b', 3] }, ...Array.from({ length: 50 }, (_, i) => ({ version: `0.${i}.0`, notes: 'n'.repeat(5000) }))]);
        expect(log).toHaveLength(20);
        expect(log[0]).toEqual({ version: '1.0.0', date: '2026-01-01', notes: '<b>x</b>' });
        expect(log[1].notes).toBe('a\nb');
        expect(log[2].notes.length).toBe(1000);
        expect(safeChangelog('x')).toEqual([]);
    });
    it('hora relativa', () => {
        expect(formatRelativeTime(1000, 1000 + 5 * 60_000, 'es')).toMatch(/5 min/);
        expect(formatRelativeTime(1000, 1000 + 2 * 3600_000, 'en')).toMatch(/2 hours ago/);
        expect(formatRelativeTime(1000, 1500, 'en')).toMatch(/now|0 seconds/);
    });
});

describe('informe de errores', () => {
    const errors = [
        { id: 'a', at: Date.UTC(2026, 0, 1), extensionId: 'zoom', kind: 'render' as const, message: 'Fallo con ana@example.com en https://api.test/v1/x?token=abc123', path: 'mounts[0]', count: 3 },
        { id: 'b', at: Date.UTC(2026, 0, 2), extensionId: 'zoom', kind: 'action' as const, message: 'sk_' + 'a'.repeat(40), count: 1 },
    ];
    it('texto plano con extension, version y errores, sin datos personales', () => {
        const text = formatErrorReport({ extensions: [{ id: 'zoom', name: 'Zoom', version: '1.2.3' }], errors, generatedAt: Date.UTC(2026, 0, 3) });
        expect(text).toContain('Extension: Zoom (zoom)');
        expect(text).toContain('Version: 1.2.3');
        expect(text).toContain('[render] mounts[0]');
        expect(text).toContain('(x3');
        expect(text).not.toContain('ana@example.com');
        expect(text).not.toContain('token=abc123');
        expect(text).not.toMatch(/a{32}/);
        expect(text).toContain('[email]');
    });
    it('sin errores', () => {
        expect(formatErrorReport({ extensions: [], errors: [], generatedAt: 0 })).toContain('Sin errores registrados.');
        expect(redactMessage('x'.repeat(900)).length).toBeLessThanOrEqual(500);
    });
});
