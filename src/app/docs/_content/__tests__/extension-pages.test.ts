import { describe, expect, it } from 'vitest';
import { validateManifest } from '@/lib/expansions/manifest-schema';
import { validateManifestUi } from '@/lib/expansions/ui-schema';
import { checkExpression } from '@/lib/expansions/expressions';
import { NAV_LIMITS } from '@/lib/expansions/nav-schema';
import { DOC_CONTENT } from '../registry';
import { findDocPage } from '../nav';
import { guideManifest, EXAMPLE_FRAGMENTS } from '../pages/extension-pages';
import fs from 'node:fs';
import path from 'node:path';

/** La guia /docs/extension-pages no puede mostrar un manifest que la aplicacion rechazaria. */
describe('guia extension-pages', () => {
    for (const lang of ['es', 'en'] as const) {
        it(`el manifest de ejemplo (${lang}) valida con el validador real, sin avisos`, () => {
            const manifest = guideManifest(lang);
            const result = validateManifest(manifest);
            expect(result.errors).toEqual([]);
            expect(result.warnings).toEqual([]);
            const ui = validateManifestUi(manifest, { checkExpression });
            expect(ui.errors ?? []).toEqual([]);
        });
    }

    it('esta en la navegacion y los limites del texto coinciden con NAV_LIMITS', () => {
        expect(findDocPage('extension-pages')).toBeTruthy();
        const text = JSON.stringify(DOC_CONTENT['extension-pages']);
        expect(text).toContain(String(NAV_LIMITS.maxEntries));
        expect(text).toContain(String(NAV_LIMITS.maxLabel));
        expect(text).toContain('nav.entries.v1');
        expect(text).toContain('ui.pages.v1');
    });

    it('una entrada admin sobre una pagina sin auth admin se rechaza (la guia no ensena a abrir paginas)', () => {
        const manifest = guideManifest('es');
        delete manifest.mounts[0].auth;
        delete manifest.mounts[0].minLevel;
        expect(validateManifest(manifest).errors.some((e) => e.path.startsWith('navEntries'))).toBe(true);
    });

    const EXT = path.resolve(process.cwd(), '..', 'bloomx-extensions');
    const present = fs.existsSync(path.join(EXT, 'domain-metrics', 'manifest.json')) && fs.existsSync(path.join(EXT, 'quick-notes', 'manifest.json'));
    it.skipIf(!present)('los fragmentos citados coinciden con los manifest.src.mjs reales', () => {
        for (const fr of EXAMPLE_FRAGMENTS) expect(fs.readFileSync(path.join(EXT, fr.file), 'utf8'), fr.title).toContain(fr.code);
    });
    it.skipIf(!present)('los manifests de ejemplo reales validan', () => {
        for (const dir of ['domain-metrics', 'quick-notes']) {
            const manifest = JSON.parse(fs.readFileSync(path.join(EXT, dir, 'manifest.json'), 'utf8'));
            expect(validateManifest(manifest).errors, dir).toEqual([]);
            expect(validateManifestUi(manifest, { checkExpression }).errors ?? [], dir).toEqual([]);
        }
    });
});
