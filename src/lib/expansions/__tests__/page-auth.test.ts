import { describe, it, expect } from 'vitest';
import { evaluatePageAccess } from '../page-auth';

const app = { publicRoute: false, where: 'app' as const, publicApproved: false };
const pub = (over = {}) => ({ publicRoute: true, where: 'public' as const, publicApproved: true, ...over });

describe('evaluatePageAccess', () => {
    it('sin auth declarado equivale a session: sin sesion pide login, con sesion permite', () => {
        expect(evaluatePageAccess({}, { signedIn: false, level: null }, app)).toBe('login');
        expect(evaluatePageAccess({}, { signedIn: true, level: null }, app)).toBe('allow');
        expect(evaluatePageAccess({ auth: 'rara' }, { signedIn: false, level: null }, app)).toBe('login');
    });
    it('admin: usuario normal prohibido, nivel insuficiente prohibido, suficiente permitido', () => {
        const m = { auth: 'admin', minLevel: 3 };
        expect(evaluatePageAccess(m, { signedIn: false, level: null }, app)).toBe('login');
        expect(evaluatePageAccess(m, { signedIn: true, level: null }, app)).toBe('forbidden');
        expect(evaluatePageAccess(m, { signedIn: true, level: 2 }, app)).toBe('forbidden');
        expect(evaluatePageAccess(m, { signedIn: true, level: 3 }, app)).toBe('allow');
        expect(evaluatePageAccess({ auth: 'admin' }, { signedIn: true, level: 1 }, app)).toBe('allow');
    });
    it('none: solo en /p/**, con PUBLIC_ROUTE declarado y aprobado; nunca dentro de la app', () => {
        const m = { auth: 'none' };
        expect(evaluatePageAccess(m, { signedIn: false, level: null }, pub())).toBe('allow');
        expect(evaluatePageAccess(m, { signedIn: false, level: null }, pub({ publicApproved: false }))).toBe('not_found');
        expect(evaluatePageAccess(m, { signedIn: false, level: null }, pub({ publicRoute: false }))).toBe('not_found');
        expect(evaluatePageAccess(m, { signedIn: true, level: 4 }, { ...app, publicRoute: true, publicApproved: true })).toBe('not_found');
    });
    it('/p/** jamas sirve paginas con sesion, aunque haya un admin firmado', () => {
        expect(evaluatePageAccess({ auth: 'admin' }, { signedIn: true, level: 4 }, pub())).toBe('not_found');
        expect(evaluatePageAccess({}, { signedIn: true, level: 4 }, pub())).toBe('not_found');
        expect(evaluatePageAccess(null, { signedIn: true, level: 4 }, app)).toBe('not_found');
    });
});

// M3: auth "admin" aplicado en el servidor.
import { adminProtectedActions, mayInvokeAction, stripAdminMounts } from '../page-auth';

describe('M3: acciones y arbol de componentes de paginas admin', () => {
    const template = {
        api: { functions: { loadUsers: { handler: 'listUsersHandler' }, publicInfo: { handler: 'info' } } },
        state: { secretStats: 1 },
        mounts: [
            { point: 'PAGE', path: 'admin', auth: 'admin', minLevel: 3, component: { type: 'Button', onClick: { type: 'call', function: 'loadUsers' } } },
            { point: 'PAGE', path: 'hello', component: { type: 'Button', onClick: { type: 'call', function: 'publicInfo' } } },
        ],
    };

    it('las acciones invocadas desde una pagina admin (y su handler) exigen el nivel; las demas no', () => {
        const p = adminProtectedActions(template);
        expect(p.get('loadUsers')).toBe(3);
        expect(p.get('listUsersHandler')).toBe(3);
        expect(p.has('publicInfo')).toBe(false);
        expect(mayInvokeAction(p, 'loadUsers', null)).toBe(false);
        expect(mayInvokeAction(p, 'loadUsers', 2)).toBe(false);
        expect(mayInvokeAction(p, 'loadUsers', 3)).toBe(true);
        expect(mayInvokeAction(p, 'listUsersHandler', 1)).toBe(false); // llamar al handler directo no evita la guardia
        expect(mayInvokeAction(p, 'publicInfo', null)).toBe(true);
    });

    it('la configuracion del navegador no lleva el arbol ni el estado de paginas admin sin nivel', () => {
        const exts = [{ id: 'x', template }];
        const anon = stripAdminMounts(exts, null)[0].template as typeof template;
        expect(anon.mounts.map((m) => m.path)).toEqual(['hello']);
        expect(JSON.stringify(anon)).not.toContain('"function":"loadUsers"');
        expect(stripAdminMounts(exts, 2)[0].template).toEqual(expect.objectContaining({ mounts: [expect.objectContaining({ path: 'hello' })] }));
        expect((stripAdminMounts(exts, 3)[0].template as typeof template).mounts).toHaveLength(2);
        // extension SOLO con paginas admin: tampoco el estado
        const only = stripAdminMounts([{ id: 'y', template: JSON.stringify({ state: { s: 1 }, mounts: [template.mounts[0]] }) }], null)[0];
        const parsed = JSON.parse(only.template as string);
        expect(parsed.mounts).toEqual([]);
        expect(parsed.state).toBeUndefined();
    });
});
