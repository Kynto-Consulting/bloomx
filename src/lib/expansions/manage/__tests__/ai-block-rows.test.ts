import { describe, expect, it } from 'vitest';
import { buildRows as manageRows } from '../model';
import { buildRows as adminRows, type CatalogExtension, type InstalledExtension } from '@/lib/admin/extensions-view';
import { summarizeTemplate } from '@/lib/admin/extensions-manifest';

const prefs = { disabled: [], order: [] } as any;
const manifest = (id: string, extra: Record<string, unknown> = {}) => ({
    manifestVersion: '1.0', id, version: '1.0.0', name: id, permissions: ['AI_GENERATE'], ai: { features: ['composer'], purpose: { es: 'Redactar', en: 'Compose' } }, mounts: [], ...extra,
});
const FEATURES = { composer: true, 'smart-reply': true, summarize: true, translate: true, organizer: true, other: true };
const off = { enabled: false, features: FEATURES, extensions: {} };

describe('manage/model: ai por fila', () => {
    it('sin aiBlock del servidor asume IA disponible y deriva requiresAi del manifest', () => {
        const [row] = manageRows({ extensions: [{ id: 'a', template: manifest('a') }], prefs });
        expect(row.ai).toMatchObject({ requiresAi: true, blocked: false, optional: false, features: ['composer'], purpose: { es: 'Redactar', en: 'Compose' } });
        expect(row.active).toBe(true);
    });

    it('aiBlock.blocked => fila pausada (active=false) pero sigue listada y con motivo', () => {
        const [row] = manageRows({ extensions: [{ id: 'a', template: manifest('a'), aiBlock: { requiresAi: true, blocked: true, reason: 'ai_disabled', degraded: false, features: ['composer'], disabledFeatures: [], optional: false } }], prefs });
        expect(row.ai).toMatchObject({ blocked: true, reason: 'ai_disabled' });
        expect(row.active).toBe(false);
        expect(row.userEnabled).toBe(true);
    });

    it('ai.required=false => IA opcional, nunca bloqueada', () => {
        const [row] = manageRows({ extensions: [{ id: 'a', template: manifest('a', { ai: { features: ['composer'], required: false, purpose: { es: 'x', en: 'x' } } }) }], prefs });
        expect(row.ai).toMatchObject({ requiresAi: true, optional: true, blocked: false });
    });

    it('extension sin IA: requiresAi=false', () => {
        const [row] = manageRows({ extensions: [{ id: 'p', template: manifest('p', { permissions: ['READ_EMAIL'], ai: undefined }) }], prefs });
        expect(row.ai.requiresAi).toBe(false);
    });
});

describe('admin/extensions-view: requiresAi / aiBlock', () => {
    const cat = (id: string, tpl: any): CatalogExtension => ({ id, name: id, description: '', version: '1.0.0', authType: null, isPaid: false, price: '0', currency: 'USD', template: summarizeTemplate(tpl) });
    const inst = (id: string, tpl: any): InstalledExtension => ({ extensionId: id, name: id, description: null, enabled: true, state: 'enabled', installedVersion: '1.0.0', catalogVersion: '1.0.0', isPaid: false, ui: {}, hasCredentials: false, template: summarizeTemplate(tpl) });

    it('catalogo con IA off: requiresAi y blocked con motivo; la opcional degradada; la normal libre', () => {
        const rows = adminRows({
            catalog: [cat('ai', manifest('ai')), cat('opt', manifest('opt', { ai: { features: ['composer'], required: false, purpose: { es: 'x', en: 'x' } } })), cat('plain', manifest('plain', { permissions: ['READ_EMAIL'], ai: undefined }))],
            installed: [], ai: off,
        });
        const by = Object.fromEntries(rows.map((r) => [r.id, r]));
        expect(by.ai).toMatchObject({ requiresAi: true, aiBlock: { blocked: true, reason: 'ai_disabled', features: ['composer'] } });
        expect(by.opt.aiBlock).toMatchObject({ blocked: false, degraded: true, optional: true });
        expect(by.plain).toMatchObject({ requiresAi: false, aiBlock: { blocked: false } });
    });

    it('instalada y activa con IA off sigue enabled (pausada), y al reactivar la IA se desbloquea', () => {
        const input = { catalog: [], installed: [inst('ai', manifest('ai'))] };
        const [paused] = adminRows({ ...input, ai: off });
        expect(paused).toMatchObject({ enabled: true, installed: true, aiBlock: { blocked: true } });
        const [back] = adminRows({ ...input, ai: { ...off, enabled: true } });
        expect(back.aiBlock.blocked).toBe(false);
    });

    it('funcion desactivada => feature_disabled; sin estado de IA => nada bloqueado', () => {
        const c = [cat('ai', manifest('ai'))];
        expect(adminRows({ catalog: c, installed: [], ai: { enabled: true, features: { ...FEATURES, composer: false }, extensions: {} } })[0].aiBlock.reason).toBe('feature_disabled');
        expect(adminRows({ catalog: c, installed: [] })[0].aiBlock.blocked).toBe(false);
    });
});
