import { describe, expect, it } from 'vitest';
import GENERATED from '@/app/docs/_content/generated/admin-cli-catalog.json';
import { buildAdminCliDocsData } from '../docs-data';

describe('docs de Admin CLI', () => {
    it('admin-cli-catalog.json esta al dia respecto al catalogo (ejecuta: npm run docs:admin-cli)', () => {
        expect(JSON.parse(JSON.stringify(buildAdminCliDocsData()))).toEqual(GENERATED);
    });
});
