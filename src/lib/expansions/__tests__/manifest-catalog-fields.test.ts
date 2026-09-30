/**
 * manifest-schema (copia del frontend): catalogo de componentes DERIVADO de ui-schema y campos de catalogo (category, tags,
 * screenshots, changelog, mandatory, conferencingProviders) con limites. El modo `lenientCatalog` (carga en el navegador) los degrada a avisos.
 */
import { describe, expect, it } from 'vitest';
import {
    CATEGORY_ALIASES, CATEGORY_IDS, KNOWN_COMPONENT_TYPES, LEGACY_COMPONENT_TYPES, MANIFEST_LIMITS, isMandatoryManifest, isSafeScreenshotUrl, validateManifest,
} from '../manifest-schema';
import { UI_COMPONENT_TYPES } from '../ui-schema';
import { CATEGORY_IDS as MODEL_CATEGORY_IDS, explicitCategory } from '../manage/categories';
import { prepareManifest } from '../prepare-manifest';

const base = () => ({ id: 'core-x', name: 'X', version: '1.0.0', permissions: [], api: { functions: { go: { handler: 'go' }, createMeeting: { handler: 'createMeeting' } } } });
const paths = (r: { errors: { path: string }[] }) => r.errors.map((e) => e.path);

describe('catalogo de componentes derivado de ui-schema', () => {
    it('KNOWN_COMPONENT_TYPES = kit vigente + nombres del formato antiguo, sin duplicados', () => {
        expect(UI_COMPONENT_TYPES.length).toBeGreaterThanOrEqual(60);
        for (const type of [...UI_COMPONENT_TYPES, ...LEGACY_COMPONENT_TYPES]) expect(KNOWN_COMPONENT_TYPES).toContain(type);
        expect(new Set(KNOWN_COMPONENT_TYPES).size).toBe(KNOWN_COMPONENT_TYPES.length);
    });

    it('ningun tipo del kit produce el aviso "Componente desconocido"; uno inventado si', () => {
        const all = { ...base(), mounts: [{ point: 'PAGE', path: 'p', component: { type: 'STACK', props: {}, children: UI_COMPONENT_TYPES.map((type) => ({ type, props: {} })) } }] };
        expect(validateManifest(all).warnings.filter((w) => /Componente desconocido/.test(w.message))).toEqual([]);
        const bad = validateManifest({ ...base(), mounts: [{ point: 'PAGE', path: 'p', component: { type: 'WIDGET_X', props: {} } }] });
        expect(bad.warnings.some((w) => /Componente desconocido: WIDGET_X/.test(w.message))).toBe(true);
    });

    it('prepareManifest ya no filtra avisos de "componente desconocido" (el schema es exacto)', () => {
        const prepared = prepareManifest('core-x', { ...base(), mounts: [{ point: 'EMAIL_TOOLBAR', component: { type: 'WIDGET_X', props: {} } }] });
        expect(prepared.warnings.some((w) => /Componente desconocido: WIDGET_X/.test(w.message))).toBe(true);
    });

    it('las categorias de /extensions se derivan del schema (una sola tabla)', () => {
        expect([...MODEL_CATEGORY_IDS]).toEqual(CATEGORY_IDS);
        expect(explicitCategory({ category: 'Correo' })).toBe('mail');
        for (const alias of Object.keys(CATEGORY_ALIASES)) expect(explicitCategory({ category: alias })).toBe(CATEGORY_ALIASES[alias]);
    });
});

describe('campos de catalogo', () => {
    it('validos: category (id o alias), tags, screenshots https, changelog y mandatory', () => {
        const r = validateManifest({
            ...base(), category: 'Correo', tags: ['mail', 'dlp'], mandatory: true,
            screenshots: ['https://cdn.example.com/a.png', 'https://example.com/b.webp?x=1'],
            changelog: [{ version: '1.0.0', date: '2026-01-01', notes: 'Primera' }, { version: '0.9.0', notes: ['a', 'b'] }],
        });
        expect(r.ok).toBe(true);
        expect(r.warnings).toEqual([]);
        expect(isMandatoryManifest({ mandatory: true })).toBe(true);
        expect(isMandatoryManifest({ mandatory: 'true' })).toBe(false);
        expect(isMandatoryManifest([])).toBe(false);
    });

    it.each([
        [{ category: 7 }, 'category'],
        [{ category: 'x'.repeat(41) }, 'category'],
        [{ tags: 'mail' }, 'tags'],
        [{ tags: Array.from({ length: MANIFEST_LIMITS.maxTags + 1 }, (_, i) => `t${i}`) }, 'tags'],
        [{ tags: ['<b>x</b>'] }, 'tags[0]'],
        [{ tags: ['x'.repeat(31)] }, 'tags[0]'],
        [{ screenshots: 'https://x.com/a.png' }, 'screenshots'],
        [{ screenshots: ['http://x.com/a.png'] }, 'screenshots[0]'],
        [{ screenshots: ['javascript:alert(1)'] }, 'screenshots[0]'],
        [{ screenshots: ['data:image/png;base64,AAAA'] }, 'screenshots[0]'],
        [{ screenshots: ['https://user:pass@x.com/a.png'] }, 'screenshots[0]'],
        [{ screenshots: ['/relativa.png'] }, 'screenshots[0]'],
        [{ screenshots: Array.from({ length: MANIFEST_LIMITS.maxScreenshots + 1 }, () => 'https://x.com/a.png') }, 'screenshots'],
        [{ changelog: {} }, 'changelog'],
        [{ changelog: [{ notes: 'sin version' }] }, 'changelog[0].version'],
        [{ changelog: [{ version: '1', notes: 'n'.repeat(MANIFEST_LIMITS.maxChangelogNotes + 1) }] }, 'changelog[0].notes'],
        [{ changelog: Array.from({ length: MANIFEST_LIMITS.maxChangelog + 1 }, () => ({ version: '1' })) }, 'changelog'],
        [{ mandatory: 'yes' }, 'mandatory'],
    ])('invalido %j => error en %s (modo estricto = publicacion)', (extra, path) => {
        const r = validateManifest({ ...base(), ...extra });
        expect(r.ok).toBe(false);
        expect(paths(r)).toContain(path);
    });

    it('modo lenientCatalog (carga en el navegador): los mismos problemas son AVISOS y la extension se carga', () => {
        const r = validateManifest({ ...base(), screenshots: ['javascript:alert(1)'], tags: 'x', mandatory: 'yes' }, { lenientCatalog: true });
        expect(r.ok).toBe(true);
        expect(r.warnings.map((w) => w.path)).toEqual(expect.arrayContaining(['screenshots[0]', 'tags', 'mandatory']));
        // lo estructural sigue siendo error
        expect(validateManifest({ ...base(), id: '../x', screenshots: ['javascript:1'] }, { lenientCatalog: true }).ok).toBe(false);
    });

    it('isSafeScreenshotUrl', () => {
        expect(isSafeScreenshotUrl('https://a.com/x.png')).toBe(true);
        for (const bad of ['http://a.com/x', 'ftp://a.com', '//a.com/x', 'https://u:p@a.com/x', '', 5, null, 'https://' + 'a'.repeat(2100)]) expect(isSafeScreenshotUrl(bad)).toBe(false);
    });

    it('un manifest desmesurado se rechaza sin lanzar', () => {
        const big = validateManifest({ ...base(), state: { blob: 'x'.repeat(MANIFEST_LIMITS.maxBytes + 10) } });
        expect(big.ok).toBe(false);
        expect(big.errors.some((e) => e.path === '$' && /pesa/.test(e.message))).toBe(true);
        const circular: any = base();
        circular.self = circular;
        expect(validateManifest(circular).ok).toBe(false);
    });
});

describe('conferencingProviders', () => {
    const provider = { id: 'zoom', name: 'Zoom', icon: 'zoom', handlers: { createMeeting: 'createMeeting' } };

    it('valido', () => {
        expect(validateManifest({ ...base(), kind: 'conferencing-provider', conferencingProviders: [provider] }).ok).toBe(true);
    });

    it('forma, handlers que apuntan a api.functions, createMeeting obligatorio y duplicados', () => {
        const r = validateManifest({ ...base(), conferencingProviders: [{ ...provider, handlers: { createMeeting: 'nope', extra: 'go' } }, { id: 'zoom', name: '', handlers: {} }, 'x'] });
        expect(r.ok).toBe(false);
        expect(paths(r)).toEqual(expect.arrayContaining([
            'conferencingProviders[0].handlers.createMeeting', 'conferencingProviders[1].id', 'conferencingProviders[1].name', 'conferencingProviders[1].handlers.createMeeting', 'conferencingProviders[2]',
        ]));
        expect(r.warnings.some((w) => w.path === 'conferencingProviders[0].handlers.extra')).toBe(true);
        expect(validateManifest({ ...base(), conferencingProviders: 'zoom' }).ok).toBe(false);
        expect(validateManifest({ ...base(), kind: 'otra-cosa' }).warnings.some((w) => w.path === 'kind')).toBe(true);
    });
});
