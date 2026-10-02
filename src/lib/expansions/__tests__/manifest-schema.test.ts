import { describe, expect, it } from 'vitest';
import { describePermissions, EVENT_PERMISSIONS, KNOWN_MOUNT_POINTS, LIFECYCLE_EVENTS, LIFECYCLE_EVENTS_V1, LIFECYCLE_EVENTS_V2, normalizeMount, PERMISSION_CATALOG, validateManifest } from '../manifest-schema';
import { MOUNT_POINT_CONTEXT } from '../mount-points';

const base = () => ({
    id: 'core-x',
    name: 'X',
    version: '1.0.0',
    permissions: ['READ_EMAIL'],
    api: { functions: { go: { handler: 'go' } } },
});

const button = (onClick: any) => ({ point: 'EMAIL_TOOLBAR', component: { type: 'BUTTON', props: { label: 'x', onClick } } });

describe('validateManifest', () => {
    it('acepta un manifest valido', () => {
        const r = validateManifest({ ...base(), mounts: [button({ action: 'CALL_BACKEND', function: 'go' })] });
        expect(r.ok).toBe(true);
        expect(r.errors).toEqual([]);
    });

    it('rechaza lo que no es un objeto', () => {
        expect(validateManifest(null).ok).toBe(false);
        expect(validateManifest([]).ok).toBe(false);
        expect(validateManifest('x').ok).toBe(false);
    });

    it('valida identidad: id, nombre y semver', () => {
        const r = validateManifest({ id: '../etc', name: '', version: 'abc' });
        expect(r.ok).toBe(false);
        expect(r.errors.map((e) => e.path).sort()).toEqual(['id', 'name', 'version']);
    });

    it('ENV_READ: formato y variables reservadas de plataforma', () => {
        const r = validateManifest({ ...base(), permissions: ['ENV_READ:NOTION_API_KEY', 'ENV_READ:DATABASE_URL', 'ENV_READ:ADMIN_PASSWORD', 'ENV_READ:bad-name'] });
        expect(r.errors.map((e) => e.path)).toEqual(['permissions[1]', 'permissions[2]', 'permissions[3]']);
    });

    it('permisos desconocidos son solo aviso', () => {
        const r = validateManifest({ ...base(), permissions: ['MAKE_COFFEE'] });
        expect(r.ok).toBe(true);
        expect(r.warnings).toHaveLength(1);
    });

    it('CALL_BACKEND debe referirse a una funcion de api.functions', () => {
        const r = validateManifest({ ...base(), mounts: [button({ action: 'CALL_BACKEND', function: 'otra' })] });
        expect(r.ok).toBe(false);
        expect(r.errors[0].message).toMatch(/no esta declarada/);

        const noApi = validateManifest({ id: 'a', name: 'A', version: '1.0.0', mounts: [button({ action: 'CALL_BACKEND', function: 'go' })] });
        expect(noApi.ok).toBe(false);
        expect(noApi.errors[0].message).toMatch(/no declara "api"/);
    });

    it('detecta acciones anidadas (onSuccess, actions, steps) desconocidas', () => {
        const r = validateManifest({
            ...base(),
            mounts: [button({ action: 'CALL_BACKEND', function: 'go', onSuccess: { actions: [{ action: 'TOAST' }, { action: 'RUN_JS', code: 'x' }] } })],
        });
        expect(r.ok).toBe(false);
        expect(r.errors[0].message).toMatch(/RUN_JS/);
    });

    it('componentes desconocidos: aviso; mounts sin component ni handler: error', () => {
        const unknown = validateManifest({ ...base(), mounts: [{ point: 'EMAIL_TOOLBAR', component: { type: 'HOLOGRAM', props: {} } }] });
        expect(unknown.ok).toBe(true);
        expect(unknown.warnings.some((w) => /HOLOGRAM/.test(w.message))).toBe(true);

        const empty = validateManifest({ ...base(), mounts: [{ point: 'EMAIL_TOOLBAR' }] });
        expect(empty.ok).toBe(false);
    });

    it('los OVERLAY requieren id', () => {
        const r = validateManifest({ ...base(), mounts: [{ point: 'OVERLAY', component: { type: 'MODAL', props: {} } }] });
        expect(r.errors.some((e) => e.path === 'mounts[0].id')).toBe(true);
    });

    it('intercepts: punto, handler, prioridad, onError y schedule', () => {
        const ok = validateManifest({ ...base(), intercepts: [{ point: 'EMAIL_PRE_SEND', handler: 'go', priority: 'HIGH', onError: 'block' }, { point: 'CRON', handler: 'go', schedule: 'daily' }] });
        expect(ok.ok).toBe(true);

        const bad = validateManifest({ ...base(), intercepts: [{ point: 'BOOM', handler: 'nope', priority: 'URGENT', onError: 'explode', schedule: 'weekly' }] });
        expect(bad.errors.length).toBeGreaterThanOrEqual(5);
    });

    it('eventos de ciclo de vida y alias hooks son validos; onError block no aplica a ellos', () => {
        for (const point of LIFECYCLE_EVENTS) {
            expect(validateManifest({ ...base(), permissions: ['READ_USERS', 'READ_EMAIL'], hooks: [{ point, handler: 'go' }] }).ok, point).toBe(true);
        }
        const blocked = validateManifest({ ...base(), intercepts: [{ point: 'EMAIL_OPENED', handler: 'go', onError: 'block' }] });
        expect(blocked.errors.length + blocked.warnings.length).toBeGreaterThan(0);
    });

    it('eventos v2: exigen su permiso (USER_* => READ_USERS, EMAIL_SPAM_DETECTED/LABEL_APPLIED => READ_EMAIL) y el catalogo describe READ_USERS como riesgo alto', () => {
        for (const [point, perm] of Object.entries(EVENT_PERMISSIONS)) {
            const without = validateManifest({ ...base(), permissions: ['NOTIFY'], hooks: [{ point, handler: 'go' }] });
            expect(without.ok, point).toBe(false);
            expect(JSON.stringify(without.errors), point).toContain(perm);
            expect(validateManifest({ ...base(), permissions: [perm], hooks: [{ point, handler: 'go' }] }).ok, point).toBe(true);
        }
        expect(PERMISSION_CATALOG.READ_USERS.risk).toBe('high');
        expect(LIFECYCLE_EVENTS_V2).toEqual(['USER_CREATED', 'USER_DISABLED', 'USER_ENABLED', 'EMAIL_SPAM_DETECTED', 'LABEL_APPLIED']);
        // los eventos v1 no cambian
        expect(LIFECYCLE_EVENTS.slice(0, 9)).toEqual(LIFECYCLE_EVENTS_V1);
    });

    it('nuevos puntos de montaje conocidos y documentados en MOUNT_POINT_CONTEXT', () => {
        for (const point of ['EMAIL_READER_SIDEBAR', 'EMAIL_LIST_ROW_ACTION', 'CONTEXT_MENU', 'SIDEBAR_PANEL', 'COMPOSER_SIDEBAR', 'CALENDAR_TOOLBAR', 'CALENDAR_EVENT_PANEL', 'CONTACTS_TOOLBAR', 'CONTACT_CARD_PANEL', 'SETTINGS_PANEL']) {
            expect(KNOWN_MOUNT_POINTS).toContain(point);
            expect(MOUNT_POINT_CONTEXT[point], point).toBeDefined();
        }
    });

    it('describePermissions cubre los permisos nuevos', () => {
        const described = describePermissions(['CALENDAR_READ', 'CALENDAR_WRITE', 'CONTACTS_READ', 'CONTACTS_WRITE', 'FORMATS', 'STORAGE', 'NOTIFY']);
        expect(described.every((d) => d.known)).toBe(true);
    });

    it('status solo admite active|disabled', () => {
        expect(validateManifest({ ...base(), status: 'disabled' }).ok).toBe(true);
        expect(validateManifest({ ...base(), status: 'maybe' }).ok).toBe(false);
    });

    it('slashCommands validan key y accion', () => {
        const ok = validateManifest({ ...base(), slashCommands: [{ key: 'shrug', description: 'x', action: { action: 'INSERT_CONTENT', content: 'x' } }] });
        expect(ok.ok).toBe(true);
        const bad = validateManifest({ ...base(), slashCommands: [{ key: 'with space', description: 1 }] });
        expect(bad.ok).toBe(false);
    });

    it('anidamiento excesivo se rechaza sin desbordar la pila', () => {
        let node: any = { type: 'TEXT', props: {} };
        for (let i = 0; i < 80; i++) node = { type: 'ROW', props: {}, children: [node] };
        const r = validateManifest({ ...base(), mounts: [{ point: 'EMAIL_TOOLBAR', component: node }] });
        expect(r.ok).toBe(false);
    });
});

describe('normalizeMount', () => {
    it('convierte component:"MODAL" heredado con props/children en el mount', () => {
        const m = normalizeMount({ point: 'CUSTOM_SETTINGS_TAB', component: 'MODAL', props: { title: 'T', icon: 'PenLine', children: [{ type: 'TEXT', props: { content: 'x' } }] } });
        expect(m.component).toEqual({ type: 'MODAL', props: { title: 'T', icon: 'PenLine' }, children: [{ type: 'TEXT', props: { content: 'x' } }] });
        expect(m.props).toBeUndefined();
    });

    it('COMPOSER_INIT de firma pasa a un componente HEADLESS con SECURE_READ + APPEND_BODY', () => {
        const m = normalizeMount({ point: 'COMPOSER_INIT', config: { action: 'APPEND_BODY', storageKey: 'signature-content' } });
        expect(m.component.type).toBe('HEADLESS');
        expect(m.component.props.onLoad).toEqual({
            action: 'SECURE_READ',
            key: 'signature-content',
            onSuccess: { action: 'APPEND_BODY', content: '${value}' },
        });
    });

    it('no toca mounts ya normalizados ni valores raros', () => {
        const mount = { point: 'EMAIL_TOOLBAR', component: { type: 'BUTTON' } };
        expect(normalizeMount(mount)).toBe(mount);
        expect(normalizeMount(null)).toBeNull();
    });
});
