import { describe, expect, it } from 'vitest';
import { validateManifest } from '@/lib/expansions/manifest-schema';
import { guideMetadata } from '../pages/marketplace-metadata';
import { detectCatalogMetadataRequires } from './marketplace-metadata-helpers';

describe('guia «Publicar tus metadatos de catalogo»', () => {
    for (const lang of ['es', 'en'] as const) {
        it(`el manifest de ejemplo (${lang}) valida con el mismo validador que la aplicacion`, () => {
            const result = validateManifest(guideMetadata(lang));
            expect(result.errors).toEqual([]);
            expect(result.ok).toBe(true);
        });
    }

    it('el ejemplo no declara market.catalog.v1 en requires (los metadatos son informativos)', () => {
        expect(detectCatalogMetadataRequires(guideMetadata('es'))).toBe(false);
    });

    it('un tercero que se declara oficial/verificado o pide la capacidad de catalogo es rechazado', () => {
        const third = { ...guideMetadata('en'), id: 'acme-example' };
        expect(validateManifest(third).ok).toBe(false);
        const noFlags = { ...third, publisher: { id: 'acme', name: 'Acme' } };
        expect(validateManifest(noFlags).ok).toBe(true);
        expect(validateManifest({ ...noFlags, requires: { clientApi: 11, capabilities: ['market.catalog.v1'] } }).ok).toBe(false);
    });
});
