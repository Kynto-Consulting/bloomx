import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    LEVELS, MAX_PRIVILEGED_ACCOUNTS, __resetPermissionSnapshot, checkPermissionChange, effectiveLevelSync, emailsAtLeast, envAdminEmails, isLevel, setPermissionSnapshot, type ChangeInput, type PermissionLevel,
} from '../permissions-core';
import { adminEmails, isAdminEmail, mfaRequiredFor } from '../mfa';

/** Escala 0-4, nivel efectivo (max entorno/consola), LOCKED y reglas de asignacion (puras, sin BD). */

beforeEach(() => { __resetPermissionSnapshot(); vi.stubEnv('ADMIN_EMAILS', 'Root@Corp.test, boss@corp.test'); vi.stubEnv('ADMIN_EMAILS_LOCKED', ''); vi.stubEnv('MFA_ENFORCE_ADMIN', ''); vi.stubEnv('MFA_REQUIRED_ALL', ''); });
afterEach(() => { vi.unstubAllEnvs(); __resetPermissionSnapshot(); });

describe('nivel efectivo', () => {
    it('ADMIN_EMAILS = nivel 4 fijado por entorno (sin distinguir mayusculas) y compatibilidad total hacia atras', () => {
        expect(envAdminEmails()).toEqual(['root@corp.test', 'boss@corp.test']);
        expect(effectiveLevelSync('ROOT@corp.test')).toEqual({ level: 4, source: 'env' });
        expect(isAdminEmail('boss@corp.test')).toBe(true);
        expect(adminEmails()).toEqual(['root@corp.test', 'boss@corp.test']);
        expect(mfaRequiredFor('boss@corp.test')).toBe(true);
        expect(effectiveLevelSync('nadie@corp.test')).toEqual({ level: 0, source: 'none' });
        expect(effectiveLevelSync('')).toEqual({ level: 0, source: 'none' });
        expect(mfaRequiredFor('nadie@corp.test')).toBe(false);
    });

    it('nivel efectivo = max(entorno, consola): la consola nunca baja a una cuenta del entorno', () => {
        setPermissionSnapshot([['root@corp.test', 1], ['ana@corp.test', 2], ['cto@corp.test', 4]]);
        expect(effectiveLevelSync('root@corp.test')).toEqual({ level: 4, source: 'env' });
        expect(effectiveLevelSync('ana@corp.test')).toEqual({ level: 2, source: 'console' });
        expect(effectiveLevelSync('cto@corp.test')).toEqual({ level: 4, source: 'console' });
    });

    it('isAdminEmail == nivel >= 3; MFA obligatorio desde el nivel 1; adminEmails = nivel >= 1', () => {
        setPermissionSnapshot([['sup@corp.test', 1], ['op@corp.test', 2], ['adm@corp.test', 3]]);
        expect(isAdminEmail('sup@corp.test')).toBe(false);
        expect(isAdminEmail('op@corp.test')).toBe(false);
        expect(isAdminEmail('adm@corp.test')).toBe(true);
        for (const e of ['sup', 'op', 'adm']) expect(mfaRequiredFor(`${e}@corp.test`), e).toBe(true);
        expect(adminEmails().sort()).toEqual(['adm@corp.test', 'boss@corp.test', 'op@corp.test', 'root@corp.test', 'sup@corp.test']);
        expect(emailsAtLeast(3).sort()).toEqual(['adm@corp.test', 'boss@corp.test', 'root@corp.test']);
        expect(emailsAtLeast(4).sort()).toEqual(['boss@corp.test', 'root@corp.test']);
        vi.stubEnv('MFA_ENFORCE_ADMIN', 'false');
        expect(mfaRequiredFor('sup@corp.test')).toBe(false);
    });

    it('ADMIN_EMAILS_LOCKED=true: solo entorno (4) o 0; las concesiones de consola se ignoran', () => {
        setPermissionSnapshot([['ana@corp.test', 3]]);
        vi.stubEnv('ADMIN_EMAILS_LOCKED', 'true');
        expect(effectiveLevelSync('ana@corp.test')).toEqual({ level: 0, source: 'none' });
        expect(effectiveLevelSync('root@corp.test')).toEqual({ level: 4, source: 'env' });
        expect(emailsAtLeast(1).sort()).toEqual(['boss@corp.test', 'root@corp.test']);
    });

    it('isLevel solo acepta enteros 0..4', () => {
        expect(LEVELS).toEqual([0, 1, 2, 3, 4]);
        for (const v of [0, 1, 2, 3, 4]) expect(isLevel(v)).toBe(true);
        for (const v of [-1, 5, 1.5, '2', null, undefined, NaN]) expect(isLevel(v)).toBe(false);
    });
});

const base = (over: Partial<ChangeInput> & { actorLevel?: PermissionLevel; targetLevel?: PermissionLevel; source?: 'env' | 'console' | 'none' } = {}): ChangeInput => ({
    actor: { email: 'admin@corp.test', level: over.actorLevel ?? 3 },
    target: { email: 'ana@corp.test', level: { level: over.targetLevel ?? 0, source: over.source ?? 'none' }, hasAccount: true, mfaEnabled: true },
    newLevel: 1, locked: false, mfaEnforced: true, privilegedCount: 3, ...over,
});
const deny = (o?: Parameters<typeof base>[0]) => checkPermissionChange(base(o));

describe('reglas de asignacion (checkPermissionChange)', () => {
    it('un admin (3) asigna 0-2 a cuentas de nivel menor', () => {
        for (const n of [0, 1, 2]) expect(deny({ newLevel: n, targetLevel: n === 0 ? 1 : 0 }), `to ${n}`).toBeNull();
    });
    it('solo niveles ESTRICTAMENTE menores al propio (3 no asigna 3 ni 4; 2 y 1 no gestionan)', () => {
        expect(deny({ newLevel: 3 })).toBe('level_not_assignable');
        expect(deny({ newLevel: 4, confirmSuper: true })).toBe('level_not_assignable');
        expect(deny({ actorLevel: 2, newLevel: 1 })).toBe('insufficient_level');
        expect(deny({ actorLevel: 1, newLevel: 0 })).toBe('insufficient_level');
        expect(deny({ actorLevel: 0, newLevel: 1 })).toBe('insufficient_level');
    });
    it('el superadmin asigna 0..4, pero conceder el 4 exige confirmacion explicita', () => {
        for (const n of [1, 2, 3]) expect(deny({ actorLevel: 4, newLevel: n })).toBeNull();
        expect(deny({ actorLevel: 4, newLevel: 4 })).toBe('confirm_super_required');
        expect(deny({ actorLevel: 4, newLevel: 4, confirmSuper: true })).toBeNull();
    });
    it('nadie modifica a alguien de nivel >= al suyo (excepto un superadmin sobre otro de consola)', () => {
        expect(deny({ actorLevel: 3, targetLevel: 3, newLevel: 1 })).toBe('cannot_modify_peer_or_higher');
        expect(deny({ actorLevel: 3, targetLevel: 4, source: 'console', newLevel: 1 })).toBe('cannot_modify_peer_or_higher');
        expect(deny({ actorLevel: 4, targetLevel: 4, source: 'console', newLevel: 2 })).toBeNull();
        expect(deny({ actorLevel: 3, targetLevel: 2, newLevel: 0 })).toBeNull();
    });
    it('nadie se modifica a si mismo (ni auto-escala ni auto-degrada)', () => {
        const i = base({ actorLevel: 4 });
        i.target.email = 'ADMIN@corp.test';
        expect(checkPermissionChange({ ...i, newLevel: 3 })).toBe('cannot_target_self');
        expect(checkPermissionChange({ ...i, newLevel: 0 })).toBe('cannot_target_self');
    });
    it('las cuentas de ADMIN_EMAILS estan fijadas por entorno (incluso para un superadmin)', () => {
        expect(deny({ actorLevel: 4, targetLevel: 4, source: 'env', newLevel: 0 })).toBe('fixed_by_env');
    });
    it('modo LOCKED desactiva toda gestion', () => {
        expect(deny({ actorLevel: 4, newLevel: 1, locked: true })).toBe('permissions_locked');
    });
    it('nivel invalido o sin cambio', () => {
        for (const n of [5, -1, 1.5, NaN]) expect(deny({ newLevel: n }), String(n)).toBe('invalid_level');
        expect(deny({ targetLevel: 2, newLevel: 2 })).toBe('no_change');
    });
    it('para dar nivel >= 1 la cuenta debe existir y tener MFA (o MFA obligatorio)', () => {
        const noAccount = base(); noAccount.target.hasAccount = false;
        expect(checkPermissionChange(noAccount)).toBe('account_required');
        const noMfa = base({ mfaEnforced: false }); noMfa.target.mfaEnabled = false;
        expect(checkPermissionChange(noMfa)).toBe('mfa_required_for_level');
        const enforced = base({ mfaEnforced: true }); enforced.target.mfaEnabled = false; // se enrola en su primer acceso
        expect(checkPermissionChange(enforced)).toBeNull();
        const revoke = base({ targetLevel: 1, newLevel: 0 }); revoke.target.hasAccount = false; // revocar siempre se puede
        expect(checkPermissionChange(revoke)).toBeNull();
    });
    it(`maximo ${MAX_PRIVILEGED_ACCOUNTS} cuentas con nivel >= 3`, () => {
        expect(deny({ actorLevel: 4, newLevel: 3, privilegedCount: MAX_PRIVILEGED_ACCOUNTS })).toBe('privileged_limit');
        expect(deny({ actorLevel: 4, newLevel: 3, privilegedCount: MAX_PRIVILEGED_ACCOUNTS - 1 })).toBeNull();
        expect(deny({ actorLevel: 4, newLevel: 2, privilegedCount: MAX_PRIVILEGED_ACCOUNTS })).toBeNull(); // niveles bajos no cuentan
    });
});
