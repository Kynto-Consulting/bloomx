import { describe, expect, it } from 'vitest';
import { blockReason, canActivate, canInstall, canUpdate, describeIncompatible, describeRequires, describeUpgrade, sanitizeUpgrade, sanitizeVersionInfo } from '@/lib/admin/extensions-compat';
import { backendError } from '@/lib/admin/extensions-proxy';
import { shapeInstalled } from '@/lib/admin/extensions-shape';
import { shapeCatalog } from '@/lib/admin/extensions-catalog';
import { buildRows, installedFromConfig } from '@/lib/admin/extensions-view';
import { describeCapability } from '@/lib/expansions/client/capabilities';

const upgrade = { latestVersion: '2.0.0', requires: { clientApi: '3', capabilities: ['ai.v1', 'x.new'] }, missingCaps: ['ui.kit.v3'], clientApiNeeded: '3' };

describe('describeUpgrade', () => {
    it('sin upgrade no hay aviso', () => {
        expect(describeUpgrade(null)).toBeNull();
        expect(describeUpgrade(undefined, 'en')).toBeNull();
    });
    it('nombra la version y la capacidad faltante legible, en es y en', () => {
        const es = describeUpgrade({ ...upgrade, clientApiNeeded: null }, 'es')!;
        expect(es).toContain('Hay una versión más nueva (2.0.0)');
        expect(es).toContain('falta ' + describeCapability('ui.kit.v3', 'es'));
        const en = describeUpgrade({ ...upgrade, clientApiNeeded: null }, 'en')!;
        expect(en).toContain('A newer version (2.0.0) requires updating the client');
        expect(en).toContain('missing ' + describeCapability('ui.kit.v3', 'en'));
    });
    it('sin capacidades pero con clientApi: requiere clientApi >=N', () => {
        expect(describeUpgrade({ ...upgrade, missingCaps: [] }, 'es')).toContain('requiere clientApi >=3');
        expect(describeUpgrade({ ...upgrade, missingCaps: [] }, 'en')).toContain('requires clientApi >=3');
    });
    it('describeRequires lista clientApi y capacidades legibles', () => {
        expect(describeRequires(upgrade.requires, 'es')).toContain('clientApi >=3');
        expect(describeRequires(null, 'en')).toBe('No special requirements');
    });
});

describe('bloqueo por incompatibilidad', () => {
    it('canActivate/install/update false solo si incompatible', () => {
        expect(canActivate({ incompatible: true })).toBe(false);
        expect(canInstall({ incompatible: true })).toBe(false);
        expect(canUpdate({ incompatible: true })).toBe(false);
        expect(canActivate({ incompatible: false, upgrade })).toBe(true);
        expect(canActivate({})).toBe(true);
    });
    it('blockReason da el motivo en es/en y es null si se puede', () => {
        expect(blockReason({ incompatible: false }, 'enable')).toBeNull();
        expect(blockReason({ incompatible: true, upgrade }, 'enable', 'es')).toMatch(/No se puede activar.*falta/);
        expect(blockReason({ incompatible: true }, 'install', 'en')).toBe('Cannot install: no version is compatible with this client.');
        expect(describeIncompatible({ incompatible: true }, 'en')).toContain('No version of this extension is compatible');
        expect(describeIncompatible({ incompatible: false, upgrade })).toBeNull();
    });
});

describe('saneado', () => {
    it('upgrade descarta versiones/capacidades invalidas y acota', () => {
        const u = sanitizeUpgrade({ latestVersion: '<script>', requires: { clientApi: 3, capabilities: ['ok.v1', '<b>', 5, ...Array(100).fill('a.b')] }, missingCaps: ['x y', 'good'], clientApiNeeded: '9' })!;
        expect(u.latestVersion).toBeNull();
        expect(u.requires.clientApi).toBe('3');
        expect(u.requires.capabilities.length).toBe(32);
        expect(u.requires.capabilities).not.toContain('<b>');
        expect(u.missingCaps).toEqual(['good']);
        expect(sanitizeUpgrade('x')).toBeNull();
        expect(sanitizeVersionInfo(undefined)).toBeNull();
    });
});

describe('propagacion por las capas', () => {
    const versionInfo = { resolvedVersion: '1.2.0', latestVersion: '2.0.0', pinnedVersion: null, deprecated: true, incompatible: false, upgrade, secret: 'x' };
    it('shapeInstalled conserva versionInfo saneado', () => {
        const [e] = shapeInstalled({ extensions: [{ extensionId: 'a', enabled: true, versionInfo, authData: 'S' }] });
        expect(e.versionInfo).toEqual({ resolvedVersion: '1.2.0', latestVersion: '2.0.0', pinnedVersion: null, deprecated: true, incompatible: false, upgrade });
        expect(JSON.stringify(e)).not.toContain('authData');
    });
    it('shapeCatalog conserva latestVersion/incompatible/deprecated/upgrade', () => {
        const [c] = shapeCatalog([{ id: 'a', version: '1.2.0', latestVersion: '2.0.0', incompatible: true, deprecated: true, upgrade }]);
        expect(c).toMatchObject({ latestVersion: '2.0.0', incompatible: true, deprecated: true, upgrade });
    });
    it('buildRows prioriza versionInfo de la instalacion y cae al catalogo', () => {
        const cat = shapeCatalog([{ id: 'a', version: '1.2.0', latestVersion: '2.0.0', incompatible: false, upgrade: null }]);
        const inst = shapeInstalled({ extensions: [{ extensionId: 'a', enabled: false, installedVersion: '1.0.0', catalogVersion: '1.2.0', versionInfo: { ...versionInfo, incompatible: true } }] });
        const [row] = buildRows({ catalog: cat, installed: inst });
        expect(row).toMatchObject({ incompatible: true, deprecated: true, latestVersion: '2.0.0', version: '1.2.0' });
        expect(row.upgrade?.missingCaps).toEqual(['ui.kit.v3']);
        const [avail] = buildRows({ catalog: cat, installed: [] });
        expect(avail).toMatchObject({ incompatible: false, upgrade: null, latestVersion: '2.0.0' });
    });
    it('installedFromConfig no inventa incompatibilidad', () => {
        expect(installedFromConfig([{ id: 'a' }])[0].versionInfo).toBeNull();
    });
});

describe('409 EXTENSION_CLIENT_INCOMPATIBLE', () => {
    it('se mapea a client_incompatible con upgrade saneado en el cuerpo', () => {
        const err = backendError({ status: 409, data: { error: 'x', code: 'EXTENSION_CLIENT_INCOMPATIBLE', upgrade: { ...upgrade, latestVersion: '2.0.0<x>' }, missingCaps: ['ui.kit.v3'] } });
        expect(err.status).toBe(409);
        expect(err.code).toBe('client_incompatible');
        expect((err.extra as any).upgrade.latestVersion).toBeNull();
        expect((err.extra as any).missingCaps).toEqual(['ui.kit.v3']);
    });
    it('usa missingCaps del nivel superior si no hay upgrade y mapea VERSION_NOT_FOUND', () => {
        const err = backendError({ status: 409, data: { code: 'EXTENSION_CLIENT_INCOMPATIBLE', missingCaps: ['a.b', '<'] } });
        expect((err.extra as any).upgrade).toBeNull();
        expect((err.extra as any).missingCaps).toEqual(['a.b']);
        expect(backendError({ status: 404, data: { code: 'VERSION_NOT_FOUND' } }).code).toBe('version_not_found');
        expect(backendError({ status: 409, data: {} }).status).toBe(502);
    });
});
