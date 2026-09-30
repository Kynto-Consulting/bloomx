import { describe, expect, it } from 'vitest';
import { shapeInstalled } from '../extensions-shape';
import { buildRows, installedFromConfig } from '../extensions-view';
import { summarizeTemplate } from '../extensions-manifest';
import { mandatoryBody } from '../extensions-schemas';

const raw = (over: Record<string, unknown> = {}) => ({ extensionId: 'core-dlp', name: 'DLP', enabled: true, installedVersion: '1.0.0', catalogVersion: '1.0.0', isPaid: false, ui: {}, hasCredentials: false, template: { id: 'core-dlp' }, ...over });

describe('obligatoria para todos: modelo de la consola', () => {
    it('shapeInstalled conserva solo booleanos estrictos (lista blanca)', () => {
        const [a, b, c] = shapeInstalled({ extensions: [raw({ mandatory: true, mandatoryByManifest: true }), raw({ extensionId: 'x', mandatory: 'true', mandatoryByManifest: 1 }), raw({ extensionId: 'y' })] });
        expect(a).toMatchObject({ mandatory: true, mandatoryByManifest: true });
        expect(b).toMatchObject({ mandatory: false, mandatoryByManifest: false });
        expect(c).toMatchObject({ mandatory: false, mandatoryByManifest: false });
    });

    it('summarizeTemplate marca mandatory solo con true', () => {
        expect(summarizeTemplate({ id: 'a', mandatory: true })?.mandatory).toBe(true);
        expect(summarizeTemplate({ id: 'a', mandatory: 'true' })?.mandatory).toBeUndefined();
        expect(summarizeTemplate({ id: 'a' })?.mandatory).toBeUndefined();
    });

    it('buildRows: obligatoria por politica del dominio, por manifest, o ninguna', () => {
        const installed = shapeInstalled({ extensions: [raw({ mandatory: true }), raw({ extensionId: 'core-x', name: 'X', template: { id: 'core-x', mandatory: true } }), raw({ extensionId: 'core-y', name: 'Y' })] });
        const rows = buildRows({ catalog: [], installed });
        const by = Object.fromEntries(rows.map((r) => [r.id, r]));
        expect(by['core-dlp']).toMatchObject({ mandatory: true, mandatoryByManifest: false });
        expect(by['core-x']).toMatchObject({ mandatory: true, mandatoryByManifest: true });
        expect(by['core-y']).toMatchObject({ mandatory: false, mandatoryByManifest: false });
    });

    it('buildRows: una no instalada del catalogo con mandatory en el manifest se ve como obligatoria por manifest', () => {
        const rows = buildRows({
            catalog: [{ id: 'core-dlp', name: 'DLP', description: '', version: '1.0.0', authType: null, isPaid: false, price: '0', currency: 'USD', template: summarizeTemplate({ id: 'core-dlp', mandatory: true }) }],
            installed: [],
        });
        expect(rows[0]).toMatchObject({ installed: false, mandatory: true, mandatoryByManifest: true });
    });

    it('installedFromConfig (solo lectura) lee la marca de /api/config: campo derivado o settings.meta.mandatory', () => {
        const list = installedFromConfig([
            { id: 'a', name: 'A', mandatory: true, template: { id: 'a' } },
            { id: 'b', name: 'B', settings: { meta: { mandatory: true } }, template: { id: 'b' } },
            { id: 'c', name: 'C', template: { id: 'c', mandatory: true } },
            { id: 'd', name: 'D', template: { id: 'd' } },
        ]);
        expect(list.map((i) => [i.extensionId, i.mandatory, i.mandatoryByManifest])).toEqual([['a', true, false], ['b', true, false], ['c', false, true], ['d', false, false]]);
    });

    it('mandatoryBody: ids acotados y mandatory booleano', () => {
        expect(mandatoryBody.safeParse({ domainId: 'd', extensionId: 'core-dlp', mandatory: true }).success).toBe(true);
        for (const bad of [{ domainId: 'd', extensionId: 'core-dlp', mandatory: 'yes' }, { domainId: 'd', extensionId: '../x', mandatory: true }, { domainId: 'd', extensionId: 'e' }, { domainId: '', extensionId: 'e', mandatory: true }]) {
            expect(mandatoryBody.safeParse(bad).success).toBe(false);
        }
    });
});
