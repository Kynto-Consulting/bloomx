import { describe, it, expect } from 'vitest';
import { splitPausedConfigExtensions } from '../dependency-filter';
import { buildRows } from '@/lib/admin/extensions-view';
import { dependencyPlanFor, dependentsToPause } from '@/lib/admin/extensions-view';

const dep = (range: string) => ({ requires: { clientApi: 3, capabilities: ['ext.dependencies.v1'], extensions: { 'core-googlelib': range } } });

describe('splitPausedConfigExtensions', () => {
    it('pausa al dependiente sin su dependencia y no toca al resto', () => {
        const r = splitPausedConfigExtensions([{ id: 'google-meet', version: '2.0.0', template: dep('^1.0.0') }, { id: 'giphy', version: '1.0.0', template: {} }]);
        expect(r.runnable.map((e) => e.id)).toEqual(['giphy']);
        expect(r.paused[0].issues[0].reason).toBe('missing');
    });
    it('no pausa si la dependencia esta activa y en rango; pausa si esta fuera de rango', () => {
        const lib = (version: string) => ({ id: 'core-googlelib', version, template: {} });
        expect(splitPausedConfigExtensions([lib('1.2.0'), { id: 'google-meet', version: '2', template: dep('^1.0.0') }]).paused).toHaveLength(0);
        expect(splitPausedConfigExtensions([lib('2.0.0'), { id: 'google-meet', version: '2', template: dep('^1.0.0') }]).paused).toHaveLength(1);
    });
    it('una extension sin dependencias (cliente/version antigua) nunca se pausa', () => {
        expect(splitPausedConfigExtensions([{ id: 'google-meet', version: '1.0.0', template: { permissions: [] } }]).paused).toHaveLength(0);
    });
});

describe('view model de dependencias', () => {
    const cat = (id: string, name: string, deps?: Record<string, string>) => ({ id, name, description: '', version: '1.0.0', authType: null, isPaid: false, price: '0', currency: 'USD', template: deps ? { dependencies: deps } : {} } as any);
    const inst = (id: string, enabled: boolean) => ({ extensionId: id, name: id, description: null, enabled, state: enabled ? 'enabled' : 'deactivated', installedVersion: '1.0.0', catalogVersion: '1.0.0', isPaid: false, ui: {}, hasCredentials: false, template: null } as any);
    it('marca pausada con el nombre amigable y calcula plan y dependientes', () => {
        const rows = buildRows({ catalog: [cat('core-googlelib', 'GoogleLib'), cat('google-meet', 'Meet', { 'core-googlelib': '^1.0.0' })], installed: [inst('google-meet', true)] });
        const meet = rows.find((r) => r.id === 'google-meet')!;
        expect(meet.pausedBy[0].name).toBe('GoogleLib');
        expect(dependencyPlanFor(meet, rows).dependencies.map((d) => d.id)).toEqual(['core-googlelib']);
        const rows2 = buildRows({ catalog: [cat('core-googlelib', 'GoogleLib'), cat('google-meet', 'Meet', { 'core-googlelib': '^1.0.0' })], installed: [inst('google-meet', true), inst('core-googlelib', true)] });
        expect(rows2.find((r) => r.id === 'google-meet')!.pausedBy).toHaveLength(0);
        expect(dependentsToPause(rows2.find((r) => r.id === 'core-googlelib')!, rows2)).toEqual(['google-meet']);
    });
});
