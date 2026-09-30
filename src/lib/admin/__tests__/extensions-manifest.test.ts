import { describe, expect, it } from 'vitest';
import {
    compareSemver, declaredFunctions, declaresSettingsPanel, declaresTestConnection, deriveCategory, describeMounts, extractSettingsFields,
    hasUpdate, moveItem, normalizedOrders, overallRisk, parseSemver, permissionsByRisk, riskCounts, sortByOrder, summarizeTemplate, testConnectionAction,
} from '../extensions-manifest';
import {
    DEFAULT_FILTERS, buildRows, countByStatus, filterRows, installedFromConfig, type CatalogExtension, type InstalledExtension,
} from '../extensions-view';

describe('semver seguro', () => {
    it('compara mayor/menor/parche y pre-release', () => {
        expect(compareSemver('1.2.0', '1.3.0')).toBe(-1);
        expect(compareSemver('1.3.0', '1.2.9')).toBe(1);
        expect(compareSemver('1.10.0', '1.9.0')).toBe(1); // numerico, no lexicografico
        expect(compareSemver('2.0.0', '2.0.0')).toBe(0);
        expect(compareSemver('v1.0.0', '1.0.0')).toBe(0);
        expect(compareSemver('1.0.0-beta.1', '1.0.0')).toBe(-1);
        expect(compareSemver('1.0.0-beta.2', '1.0.0-beta.10')).toBe(-1);
        expect(compareSemver('1.0.0+build5', '1.0.0')).toBe(0);
    });
    it('entradas invalidas => null y nunca lanza', () => {
        for (const bad of [undefined, null, 5, '', '1.2', 'latest', '1.2.x', '1..3', {}, [], '1.0.0-' + 'a'.repeat(100), '9'.repeat(30) + '.0.0']) {
            expect(() => compareSemver(bad, '1.0.0')).not.toThrow();
            expect(compareSemver(bad, '1.0.0')).toBeNull();
        }
        expect(parseSemver('01.2.3')).toEqual({ major: 1, minor: 2, patch: 3, pre: [] });
    });
    it('hasUpdate: solo si el catalogo es estrictamente mayor', () => {
        expect(hasUpdate('1.2.0', '1.3.0')).toBe(true);
        expect(hasUpdate('1.3.0', '1.3.0')).toBe(false);
        expect(hasUpdate('1.4.0', '1.3.0')).toBe(false);
        expect(hasUpdate(null, '1.3.0')).toBe(false);
        expect(hasUpdate('1.0.0', 'rc')).toBe(false);
        expect(hasUpdate('1.0.0-beta', '1.0.0')).toBe(true);
    });
});

describe('deriveCategory', () => {
    it('usa template.category conocida (con alias, sin distinguir mayusculas)', () => {
        expect(deriveCategory({ category: 'AI' })).toBe('ai');
        expect(deriveCategory({ category: 'Productividad' })).toBe('productivity');
        expect(deriveCategory({ category: 'communication' })).toBe('mail');
    });
    it('si no hay categoria la deriva de permisos y puntos de montaje', () => {
        expect(deriveCategory({ permissions: ['CALENDAR_READ'] })).toBe('calendar');
        expect(deriveCategory({ mounts: [{ point: 'CALENDAR_TOOLBAR' }] })).toBe('calendar');
        expect(deriveCategory({ permissions: ['CONTACTS_WRITE'] })).toBe('contacts');
        expect(deriveCategory({ permissions: ['AI_GENERATE', 'READ_EMAIL'] })).toBe('ai');
        expect(deriveCategory({ permissions: ['READ_EMAIL'] })).toBe('mail');
        expect(deriveCategory({ mounts: [{ point: 'COMPOSER_TOOLBAR' }] })).toBe('mail');
        expect(deriveCategory({ intercepts: [{ point: 'EMAIL_PRE_SEND' }] })).toBe('mail');
        expect(deriveCategory({ permissions: ['HTTP_REQUEST'] })).toBe('integrations');
        expect(deriveCategory({ auth: { type: 'OAUTH2' } })).toBe('integrations');
        expect(deriveCategory({ auth: { type: 'NONE' }, permissions: ['NOTIFY'] })).toBe('other');
    });
    it('una categoria desconocida cae a la derivacion; datos raros => other', () => {
        expect(deriveCategory({ category: 'zzz', permissions: ['CALENDAR_READ'] })).toBe('calendar');
        expect(deriveCategory(null)).toBe('other');
        expect(deriveCategory('no-json')).toBe('other');
        expect(deriveCategory(JSON.stringify({ category: 'security' }))).toBe('security');
    });
});

describe('declaresTestConnection', () => {
    it('detecta api.functions.testConnection y template.testConnection', () => {
        expect(declaresTestConnection({ api: { functions: { testConnection: { handler: 'h' } } } })).toBe(true);
        expect(declaresTestConnection({ testConnection: true })).toBe(true);
        expect(declaresTestConnection({ testConnection: 'ping', api: { functions: { ping: { handler: 'p' } } } })).toBe(true);
        expect(testConnectionAction({ testConnection: 'ping', api: { functions: { ping: {} } } })).toBe('ping');
        expect(testConnectionAction({ testConnection: true })).toBe('testConnection');
    });
    it('no la inventa: un nombre que no existe como funcion, o nombres invalidos, no cuentan', () => {
        expect(declaresTestConnection({})).toBe(false);
        expect(declaresTestConnection(null)).toBe(false);
        expect(declaresTestConnection({ api: { functions: { other: {} } } })).toBe(false);
        expect(declaresTestConnection({ testConnection: 'ping', api: { functions: { other: {} } } })).toBe(false);
        expect(declaresTestConnection({ testConnection: 'rm -rf /' })).toBe(false);
        expect(declaresTestConnection({ testConnection: false })).toBe(false);
    });
});

describe('permisos legibles y riesgo', () => {
    const tpl = { permissions: ['READ_USER', 'HTTP_REQUEST', 'MAIL_LABEL', 'ENV_READ:NOTION_API_KEY', 'INVENTADO'] };
    it('ordena de mayor a menor riesgo y cuenta por nivel', () => {
        const list = permissionsByRisk(tpl);
        expect(list.map((p) => p.risk)).toEqual(['high', 'high', 'high', 'medium', 'low']);
        expect(list[0].permission).toBe('HTTP_REQUEST');
        expect(riskCounts(tpl)).toEqual({ high: 3, medium: 1, low: 1 });
        expect(list.find((p) => p.permission === 'INVENTADO')?.known).toBe(false);
    });
    it('riesgo global', () => {
        expect(overallRisk(tpl)).toBe('high');
        expect(overallRisk({ permissions: ['MAIL_LABEL'] })).toBe('medium');
        expect(overallRisk({ permissions: ['READ_USER'] })).toBe('low');
        expect(overallRisk({})).toBe('low');
    });
});

describe('SETTINGS_PANEL y resumen acotado', () => {
    const tpl = {
        id: 'x', name: 'X', version: '1.0.0', permissions: ['READ_USER'],
        mounts: [
            { point: 'EMAIL_TOOLBAR', component: { type: 'BUTTON', props: { label: 'secreto-ui', url: 'https://evil' } } },
            {
                point: 'SETTINGS_PANEL',
                component: {
                    type: 'COLUMN',
                    children: [
                        { type: 'INPUT', props: { name: 'apiBase', label: 'Base URL', defaultValue: 'https://x' } },
                        { type: 'ROW', children: [{ type: 'SWITCH', props: { key: 'auto', label: 'Auto', value: true } }] },
                        { type: 'TEXT', props: { text: 'no es campo' } },
                    ],
                },
            },
        ],
    };
    it('extrae los campos del panel de ajustes (recorrido anidado)', () => {
        expect(extractSettingsFields(tpl)).toEqual([
            { name: 'apiBase', type: 'INPUT', label: 'Base URL', defaultValue: 'https://x' },
            { name: 'auto', type: 'SWITCH', label: 'Auto', defaultValue: 'true' },
        ]);
        expect(declaresSettingsPanel(tpl)).toBe(true);
        expect(declaresSettingsPanel({ mounts: [{ point: 'EMAIL_TOOLBAR' }] })).toBe(false);
        expect(extractSettingsFields({})).toEqual([]);
    });
    it('el resumen no lleva componentes, props ni URLs', () => {
        const s = summarizeTemplate(tpl)!;
        const text = JSON.stringify(s);
        expect(text).not.toContain('secreto-ui');
        expect(text).not.toContain('evil');
        expect(s.mounts).toEqual([{ point: 'EMAIL_TOOLBAR' }, { point: 'SETTINGS_PANEL' }]);
        expect(s.settingsFields).toHaveLength(2);
    });
    it('acota tamanos y recorre sin colgarse con arboles enormes/profundos', () => {
        let deep: any = { type: 'TEXT' };
        for (let i = 0; i < 50; i++) deep = { type: 'COLUMN', children: [deep, { type: 'INPUT', props: { name: `f${i}` } }] };
        const fields = extractSettingsFields({ mounts: [{ point: 'SETTINGS_PANEL', component: deep }] });
        expect(fields.length).toBeLessThanOrEqual(50);
        const big = summarizeTemplate({ description: 'x'.repeat(5000), permissions: Array.from({ length: 500 }, (_, i) => `P${i}`) })!;
        expect(big.description!.length).toBe(1000);
        expect(big.permissions!.length).toBe(60);
        expect(summarizeTemplate(null)).toBeNull();
    });
    it('puntos de montaje y funciones', () => {
        expect(describeMounts({ mounts: [{ point: 'EMAIL_TOOLBAR' }, { point: 'RARO' }, { point: 'EMAIL_TOOLBAR' }] })).toEqual([
            { point: 'EMAIL_TOOLBAR', known: true },
            { point: 'RARO', known: false },
        ]);
        expect(declaredFunctions({ api: { functions: { a: {}, b: {} } } })).toEqual(['a', 'b']);
        expect(declaredFunctions({})).toEqual([]);
    });
});

describe('orden', () => {
    const items = [
        { id: 'c', name: 'Charlie', order: 20 },
        { id: 'a', name: 'Alpha', order: null },
        { id: 'b', name: 'Bravo', order: 0 },
        { id: 'd', name: 'Delta' },
    ];
    it('ordena por order y luego por nombre (sin orden al final)', () => {
        expect(sortByOrder(items).map((i) => i.id)).toEqual(['b', 'c', 'a', 'd']);
        expect(items[0].id).toBe('c'); // no muta
    });
    it('moveItem sube/baja una posicion y respeta los limites', () => {
        expect(moveItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
        expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
        expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
        expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
        expect(moveItem(['a'], 5, 1)).toEqual(['a']);
    });
    it('normalizedOrders numera de 10 en 10', () => {
        expect(normalizedOrders(['x', 'y', 'z'])).toEqual([{ extensionId: 'x', order: 0 }, { extensionId: 'y', order: 10 }, { extensionId: 'z', order: 20 }]);
    });
});

describe('modelo de vista: filas y filtros', () => {
    const cat = (over: Partial<CatalogExtension> & { id: string }): CatalogExtension => ({
        name: over.id, description: '', version: '1.0.0', authType: null, isPaid: false, price: '0', currency: 'USD', template: null, ...over,
    });
    const inst = (over: Partial<InstalledExtension> & { extensionId: string }): InstalledExtension => ({
        name: over.extensionId, description: null, enabled: true, state: 'enabled', installedVersion: '1.0.0', catalogVersion: '1.0.0', isPaid: false, ui: {}, hasCredentials: false, template: null, ...over,
    });
    const catalog = [
        cat({ id: 'notion', name: 'Notion', description: 'Sincroniza páginas', version: '1.3.0', template: { permissions: ['ENV_READ:NOTION_API_KEY'] } }),
        cat({ id: 'giphy', name: 'Giphy', description: 'GIFs', template: { permissions: ['HTTP_REQUEST'] } }),
        cat({ id: 'pro', name: 'Pro', isPaid: true, price: '5', template: { permissions: ['AI_GENERATE'] } }),
        cat({ id: 'cal', name: 'Agenda', template: { permissions: ['CALENDAR_READ'] } }),
    ];
    const installed = [inst({ extensionId: 'notion', installedVersion: '1.2.0', hasCredentials: true, ui: { order: 10 } }), inst({ extensionId: 'giphy', enabled: false, state: 'deactivated' }), inst({ extensionId: 'legacy', name: 'Legacy' })];
    const rows = buildRows({ catalog, installed, errorIds: ['giphy'] });

    it('une catalogo e instaladas (incluye las que ya no estan en el catalogo)', () => {
        expect(rows.map((r) => r.id)).toEqual(['notion', 'giphy', 'pro', 'cal', 'legacy']);
        const notion = rows[0];
        expect(notion).toMatchObject({ status: 'enabled', installed: true, updateAvailable: true, installedVersion: '1.2.0', version: '1.3.0', order: 10, hasCredentials: true, hasCredentialKeys: true, inCatalog: true });
        expect(rows[1]).toMatchObject({ status: 'disabled', enabled: false, hasErrors: true, hasCredentialKeys: false });
        expect(rows[2]).toMatchObject({ status: 'available', installed: false, isPaid: true, category: 'ai', hasCredentials: null });
        expect(rows[4]).toMatchObject({ inCatalog: false, name: 'Legacy', installed: true });
    });
    it('busqueda (sin acentos ni mayusculas) y filtros de categoria y estado', () => {
        expect(filterRows(rows, { ...DEFAULT_FILTERS, query: 'PAGINAS' }).map((r) => r.id)).toEqual(['notion']);
        expect(filterRows(rows, { ...DEFAULT_FILTERS, query: 'gif' }).map((r) => r.id)).toEqual(['giphy']);
        expect(filterRows(rows, { ...DEFAULT_FILTERS, category: 'calendar' }).map((r) => r.id)).toEqual(['cal']);
        expect(filterRows(rows, { ...DEFAULT_FILTERS, status: 'installed' }).map((r) => r.id)).toEqual(['notion', 'giphy', 'legacy']);
        expect(filterRows(rows, { ...DEFAULT_FILTERS, status: 'available' }).map((r) => r.id)).toEqual(['pro', 'cal']);
        expect(filterRows(rows, { ...DEFAULT_FILTERS, status: 'disabled' }).map((r) => r.id)).toEqual(['giphy']);
        expect(filterRows(rows, { ...DEFAULT_FILTERS, status: 'errors' }).map((r) => r.id)).toEqual(['giphy']);
        expect(filterRows(rows, { ...DEFAULT_FILTERS, status: 'paid' }).map((r) => r.id)).toEqual(['pro']);
        expect(filterRows(rows, { query: 'notion', category: 'calendar', status: 'all' })).toEqual([]);
    });
    it('contadores del resumen', () => {
        expect(countByStatus(rows)).toEqual({ installed: 3, enabled: 2, disabled: 1, updates: 1, errors: 1 });
    });
    it('modo solo lectura: las instaladas salen de /api/config', () => {
        const fromConfig = installedFromConfig([
            { id: 'core-notion', name: 'Notion', template: { description: 'd', version: '1.3.0', permissions: [] }, settings: { ui: { order: 5 }, meta: { installedVersion: '1.2.0' } } },
            { id: '', name: 'sin id' },
            { id: 'x', template: null },
        ]);
        expect(fromConfig.map((e) => e.extensionId)).toEqual(['core-notion', 'x']);
        expect(fromConfig[0]).toMatchObject({ enabled: true, ui: { order: 5 }, installedVersion: '1.2.0', catalogVersion: '1.3.0', description: 'd' });
    });
});
