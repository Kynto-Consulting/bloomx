/**
 * Registro de iconos de marca (brand-icons.ts) y referencias de icono (icon-ref.ts): validez de los SVG, tamano acotado, cobertura,
 * compatibilidad con el campo `icon` antiguo, garantia de contraste (>= 3:1) sobre los 8 temas y las paletas de empresa, y
 * AUDITORIA de los manifests reales: si uno referencia un icono inexistente, este test falla.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as Lucide from 'lucide-react';
import { BRAND_ICONS, NEUTRAL_BRANDS } from '../brand-icons';
import { FUNCTIONAL_ICONS } from '../functional-icons';
import { BRAND_MIN_CONTRAST, BRAND_SURFACE_TOKENS, LEGACY_BRAND_ALIASES, brandGlyphColor, initialsOf, resolveIconRef } from '../icon-ref';
import { ICON_REF_RE, isIconRef, validateUi } from '../ui-schema';
import { manifestIcon, manifestTexts, validateManifest } from '../manifest-schema';
import { contrast } from '@/lib/color';
import { THEMES } from '@/lib/themes';
import { buildBrandThemes } from '@/lib/brand-theme';
import { BRAND_FIXTURES } from '@/lib/theme-fixtures';

const ROOT = path.resolve(__dirname, '../../../..');
const EXTENSIONS_DIR = path.resolve(ROOT, '..', 'bloomx-extensions');

/** Marcas que el producto integra: deben tener logotipo real. */
const REQUIRED_BRANDS = ['googlemeet', 'googlecalendar', 'googledrive', 'zoom', 'notion', 'trello', 'hubspot', 'giphy', 'zoho', 'github', 'jira', 'linear', 'asana', 'airtable', 'stripe', 'dropbox', 'anthropic', 'googlegemini', 'whatsapp', 'telegram', 'microsoft', 'microsoftteams', 'slack'];
/** Marcas sin logotipo (Microsoft/Teams/Slack ya se sirven como SVG propio desde _brands/): ficha neutra con inicial, nunca un logotipo inventado. */
const ABSENT_BRANDS = ['microsoftoutlook', 'salesforce', 'openai'];

describe('registro de iconos de marca', () => {
    it('cubre todas las marcas integradas con logotipo real', () => {
        for (const slug of REQUIRED_BRANDS) expect(BRAND_ICONS[slug], slug).toBeDefined();
    });

    it('las marcas ausentes de simple-icons son fichas neutras (sin ruta SVG) y no coinciden con ninguna marca real', () => {
        for (const slug of ABSENT_BRANDS) {
            expect(NEUTRAL_BRANDS[slug], slug).toBeDefined();
            expect(BRAND_ICONS[slug], slug).toBeUndefined();
            expect((NEUTRAL_BRANDS[slug] as unknown as { path?: string }).path).toBeUndefined();
        }
        for (const neutral of Object.values(NEUTRAL_BRANDS)) {
            expect(neutral.initial).toMatch(/^\p{L}$/u);
            expect((Lucide as unknown as Record<string, unknown>)[neutral.lucide], `${neutral.slug}: icono Lucide ${neutral.lucide}`).toBeTruthy();
        }
    });

    it('cada entrada: slug estable = clave, nombre y color oficial hex; SIN dibujo en el bundle (viene del backend)', () => {
        const slugs = Object.keys(BRAND_ICONS);
        expect(slugs.length).toBeGreaterThanOrEqual(REQUIRED_BRANDS.length);
        for (const [key, icon] of Object.entries(BRAND_ICONS)) {
            expect(icon.slug, key).toBe(key);
            expect(key).toMatch(/^[a-z][a-z0-9]{0,39}$/);
            expect(icon.name.trim().length, key).toBeGreaterThan(1);
            expect(icon.hex, key).toMatch(/^#[0-9a-f]{6}$/);
            expect(Object.keys(icon).sort(), key).toEqual(['hex', 'name', 'slug']);
        }
        expect(new Set(slugs.map((s) => s.toLowerCase())).size).toBe(slugs.length);
    });

    it('el modulo esta acotado (~21 KB: solo los iconos usados, no simple-icons entero)', () => {
        const size = fs.statSync(path.join(__dirname, '..', 'brand-icons.ts')).size;
        expect(size).toBeLessThan(8 * 1024); // solo indice slug/nombre/color: los dibujos ya no estan en el bundle
    });

    it('los iconos funcionales (lucide:) existen en Lucide y sus slugs no se repiten', () => {
        const seen = new Set<string>();
        for (const f of FUNCTIONAL_ICONS) {
            expect((Lucide as unknown as Record<string, unknown>)[f.lucide], `${f.slug}: ${f.lucide}`).toBeTruthy();
            expect(seen.has(f.slug), f.slug).toBe(false);
            seen.add(f.slug);
            expect(f.name.es && f.name.en).toBeTruthy();
        }
        for (const need of ['dlp', 'signature', 'translator', 'ai-summary', 'organizer', 'sealer', 'mail-groups', 'webhooks', 'slash-commands']) expect(seen.has(need), need).toBe(true);
    });
});

describe('resolveIconRef y compatibilidad con el campo icon antiguo', () => {
    it('brand:, lucide:, initials: y nombre Lucide sin esquema', () => {
        expect(resolveIconRef('brand:zoom')).toMatchObject({ kind: 'brand', icon: { slug: 'zoom' } });
        expect(resolveIconRef('brand:slack')).toMatchObject({ kind: 'brand', icon: { slug: 'slack' } });
        expect(resolveIconRef('brand:salesforce')).toMatchObject({ kind: 'neutral', brand: { initial: 'S' } });
        expect(resolveIconRef('lucide:ShieldCheck')).toEqual({ kind: 'lucide', name: 'ShieldCheck' });
        expect(resolveIconRef('initials:ab')).toEqual({ kind: 'initials', text: 'AB' });
        // Compatibilidad: un nombre Lucide sin esquema sigue valiendo.
        expect(resolveIconRef('Video')).toEqual({ kind: 'lucide', name: 'Video' });
        expect(resolveIconRef('Sparkles')).toEqual({ kind: 'lucide', name: 'Sparkles' });
    });

    it('los nombres antiguos de apps (GoogleDrive, Zoom, HubSpot...) ahora resuelven al logotipo', () => {
        for (const [legacy, slug] of Object.entries(LEGACY_BRAND_ALIASES)) expect(resolveIconRef(legacy), legacy).toMatchObject({ kind: 'brand', icon: { slug } });
    });

    it('un slug de marca desconocido no rompe: ficha con inicial; entradas hostiles o vacias -> null', () => {
        expect(resolveIconRef('brand:noexiste')).toEqual({ kind: 'initials', text: 'N' });
        for (const bad of ['brand:', 'brand:UPPER', 'brand:a b', 'brand:zoom"onload=x', 'lucide:', 'initials:', 'initials:ABCD', 'https://x.test/a.png', 'data:image/svg+xml,<svg/>', '<svg>', '😀', '', 'x'.repeat(200), 5, null, undefined, {}]) {
            expect(resolveIconRef(bad as unknown), String(bad)).toBeNull();
        }
    });

    it('initialsOf', () => {
        expect(initialsOf('Zoom Integration')).toBe('ZI');
        expect(initialsOf('Notion')).toBe('N');
        expect(initialsOf('  ')).toBe('');
    });
});

describe('esquema: icon con esquema en manifests y en UI', () => {
    it('isIconRef / ICON_REF_RE', () => {
        for (const ok of ['brand:zoom', 'brand:googlemeet', 'lucide:Users', 'initials:AB', 'initials:7']) expect(isIconRef(ok), ok).toBe(true);
        for (const bad of ['brand:Zoom', 'brand:', 'lucide:1x', 'initials:abcd', 'http://a/b.png', 'Video', 3]) expect(isIconRef(bad), String(bad)).toBe(false);
        expect(ICON_REF_RE.test('brand:zoom\n<script>')).toBe(false);
    });

    const base = (extra: Record<string, unknown>) => ({ manifestVersion: '1.0', id: 'x', version: '1.0.0', name: 'X', mounts: [], ...extra });

    it('manifest.icon: acepta las 3 formas y el nombre Lucide antiguo; rechaza URLs y basura', () => {
        for (const icon of ['brand:zoom', 'lucide:Users', 'initials:XY', 'Users']) expect(validateManifest(base({ icon })).ok, icon).toBe(true);
        for (const icon of ['https://evil.test/logo.png', 'data:image/png;base64,AAAA', 'brand:', '<img src=x>', 42, {}]) {
            const res = validateManifest(base({ icon }));
            expect(res.ok, String(icon)).toBe(false);
            expect(res.errors.some((e) => e.path === 'icon')).toBe(true);
        }
    });

    it('manifest.i18n: valida idiomas, nombre y descripcion', () => {
        expect(validateManifest(base({ i18n: { es: { name: 'Uno', description: 'Desc' }, en: { name: 'One' } } })).ok).toBe(true);
        for (const i18n of [[], 'x', {}, { 'not a lang': { name: 'x' } }, { es: 'x' }, { es: { name: '' } }, { es: { name: 5 } }, { es: { description: 'x'.repeat(2001) } }]) {
            expect(validateManifest(base({ i18n })).ok, JSON.stringify(i18n)).toBe(false);
        }
    });

    it('manifestTexts: idioma exacto, base, en/es y respaldo a name/description', () => {
        const m = { name: 'Zoom Integration', description: 'Create Zoom meetings', i18n: { es: { name: 'Zoom', description: 'Crea reuniones de Zoom' }, en: { name: 'Zoom Integration' } } };
        expect(manifestTexts(m, 'es')).toEqual({ name: 'Zoom', description: 'Crea reuniones de Zoom' });
        expect(manifestTexts(m, 'es-MX')).toEqual({ name: 'Zoom', description: 'Crea reuniones de Zoom' });
        // en no traduce la descripcion: cae al campo description del manifest? No: pick busca en, luego es (la unica variante disponible).
        expect(manifestTexts(m, 'en').name).toBe('Zoom Integration');
        expect(manifestTexts(m, 'fr').name).toBe('Zoom Integration');
        expect(manifestTexts({ name: ' N ', description: 'D' }, 'es')).toEqual({ name: 'N', description: 'D' });
        expect(manifestTexts(null, 'es')).toEqual({ name: '', description: '' });
        expect(manifestTexts({ name: 'N', i18n: 'roto' }, 'es').name).toBe('N');
    });

    it('manifestIcon', () => {
        expect(manifestIcon({ icon: 'brand:zoom' })).toBe('brand:zoom');
        expect(manifestIcon({ icon: 'Users' })).toBe('Users');
        expect(manifestIcon({ icon: 'http://x/y.png' })).toBeNull();
        expect(manifestIcon(null)).toBeNull();
    });

    it('un ICON / BUTTON con brand: valida en el UI; con una URL no', () => {
        expect(validateUi({ type: 'ICON', props: { name: 'brand:zoom' } }).ok).toBe(true);
        expect(validateUi({ type: 'BUTTON', props: { label: 'Zoom', icon: 'brand:googlemeet' } }).ok).toBe(true);
        expect(validateUi({ type: 'BUTTON', props: { label: 'Zoom', icon: 'brand:Zoom' } }).ok).toBe(false);
        expect(validateUi({ type: 'BUTTON', props: { label: 'Zoom', icon: 'https://x.test/a.png' } }).ok).toBe(false);
    });
});

// ------------------------------------------------------------------ contraste
type Palette = { id: string; tokens: Record<string, string> };
function allPalettes(): Palette[] {
    const out: Palette[] = THEMES.map((t) => ({ id: t.id, tokens: t.tokens as Record<string, string> }));
    for (const [name, cfg] of Object.entries(BRAND_FIXTURES)) {
        const brand = buildBrandThemes(cfg, { name });
        if (!brand) continue;
        for (const theme of brand.list) out.push({ id: `${name} @ ${theme.id}`, tokens: theme.tokens as Record<string, string> });
    }
    return out;
}

describe('contraste del logotipo de marca (>= 3:1 tras la correccion)', () => {
    const palettes = allPalettes();

    it('hay 8 temas genericos y paletas de empresa en claro y oscuro', () => {
        expect(THEMES.length).toBe(8);
        expect(palettes.length).toBeGreaterThan(8 + 2 * 8);
        expect(palettes.some((p) => p.id.includes('brand-dark'))).toBe(true);
        expect(palettes.some((p) => p.id.includes('brand-light'))).toBe(true);
    });

    it('todos los iconos, en todos los temas y paletas, contrastan >= 3:1 con fondo, tarjeta, atenuado y hover', () => {
        const failures: string[] = [];
        for (const palette of palettes) {
            const surfaces = BRAND_SURFACE_TOKENS.map((t) => palette.tokens[t]);
            for (const icon of Object.values(BRAND_ICONS)) {
                const color = brandGlyphColor(icon.hex, surfaces);
                const worst = Math.min(...surfaces.map((s) => contrast(color, s)));
                if (worst < BRAND_MIN_CONTRAST) failures.push(`${palette.id} / ${icon.slug}: ${worst.toFixed(2)}`);
            }
        }
        expect(failures).toEqual([]);
    });

    it('un color oficial que ya contrasta NO se toca (se conserva el reconocimiento)', () => {
        const light = THEMES.find((t) => t.id === 'light')!.tokens;
        const surfaces = BRAND_SURFACE_TOKENS.map((t) => light[t]);
        expect(brandGlyphColor(BRAND_ICONS.zoom.hex, surfaces)).toBe(BRAND_ICONS.zoom.hex);
        expect(brandGlyphColor(BRAND_ICONS.notion.hex, surfaces)).toBe(BRAND_ICONS.notion.hex);
    });

    it('Notion (negro) en un tema oscuro y Zoom sobre un fondo azul similar se corrigen', () => {
        const dark = THEMES.find((t) => t.scheme === 'dark')!.tokens;
        const surfaces = BRAND_SURFACE_TOKENS.map((t) => dark[t]);
        const notion = brandGlyphColor(BRAND_ICONS.notion.hex, surfaces);
        expect(notion).not.toBe(BRAND_ICONS.notion.hex);
        expect(Math.min(...surfaces.map((s) => contrast(notion, s)))).toBeGreaterThanOrEqual(3);
        const navy = ['#0b57f0', '#0a52e8'];
        const zoom = brandGlyphColor(BRAND_ICONS.zoom.hex, navy);
        expect(zoom).not.toBe(BRAND_ICONS.zoom.hex);
        expect(Math.min(...navy.map((s) => contrast(zoom, s)))).toBeGreaterThanOrEqual(3);
    });

    it('superficies opuestas (imposible para un solo tono): elige el extremo de mayor contraste y sin superficies valida usa el oficial', () => {
        const color = brandGlyphColor('#808080', ['#000000', '#ffffff']);
        expect(color).toMatch(/^#[0-9a-f]{6}$/);
        expect(brandGlyphColor('#123456', [])).toBe('#123456');
        expect(brandGlyphColor('#123456', ['no-es-color'])).toBe('#123456');
        expect(brandGlyphColor('roto', ['#ffffff'])).toBe('#000000');
    });
});

// ------------------------------------------------------------------ auditoria de manifests reales
const manifestFiles = fs.existsSync(EXTENSIONS_DIR)
    ? fs.readdirSync(EXTENSIONS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(EXTENSIONS_DIR, d.name, fs.existsSync(path.join(EXTENSIONS_DIR, d.name, 'manifest.json')) ? 'manifest.json' : 'manifest.template.json')).filter((f) => fs.existsSync(f))
    : [];

/** Todos los valores `icon` de un manifest (raiz, botones, menus, overlays...). */
function iconValues(node: unknown, out: string[] = [], keyName = ''): string[] {
    if (Array.isArray(node)) node.forEach((n) => iconValues(n, out, keyName));
    else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) { if (k === 'icon' && typeof v === 'string') out.push(v); else iconValues(v, out, k); }
    return out;
}

describe.skipIf(manifestFiles.length === 0)('auditoria: los manifests de bloomx-extensions referencian iconos que existen', () => {
    it('hay manifests que auditar (>= 21)', () => {
        expect(manifestFiles.length).toBeGreaterThanOrEqual(21);
    });

    it.each(manifestFiles.map((f) => [path.basename(path.dirname(f)), f]))('%s', (_name, file) => {
        const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
        expect(typeof manifest.icon, 'manifest.icon declarado').toBe('string');
        for (const value of [manifest.icon, ...iconValues(manifest.mounts), ...iconValues(manifest.overlays)] as string[]) {
            if (/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(value)) {
                // nombre Lucide antiguo (o alias de marca): debe existir
                const known = (Lucide as unknown as Record<string, unknown>)[value] || LEGACY_BRAND_ALIASES[value];
                expect(known, `icono "${value}" no existe`).toBeTruthy();
                continue;
            }
            const ref = resolveIconRef(value);
            expect(ref, `icono "${value}" invalido`).not.toBeNull();
            if (value.startsWith('brand:')) expect(ref!.kind === 'brand' || ref!.kind === 'neutral', `marca inexistente en el registro: ${value}`).toBe(true);
            if (value.startsWith('lucide:')) expect((Lucide as unknown as Record<string, unknown>)[value.slice(7)], `Lucide no tiene ${value}`).toBeTruthy();
            // nunca una URL ni una imagen remota
            expect(value).not.toMatch(/https?:|data:|\/\//i);
        }
        expect(validateManifest(manifest).ok).toBe(true);
    });

    it('las extensiones con marca usan su logotipo y se distinguen entre si (Meet != Zoom)', () => {
        const read = (dir: string) => JSON.parse(fs.readFileSync(path.join(EXTENSIONS_DIR, dir, 'manifest.json'), 'utf8'));
        const expected: Record<string, string> = { zoom: 'brand:zoom', 'google-meet': 'brand:googlemeet', calendar: 'brand:googlecalendar', notion: 'brand:notion', trello: 'brand:trello', hubspot: 'brand:hubspot', 'google-drive': 'brand:googledrive', giphy: 'brand:giphy' };
        for (const [dir, icon] of Object.entries(expected)) expect(read(dir).icon, dir).toBe(icon);
        // La fuente de verdad del dibujo (backend) coincide con el indice: cada marca tiene su SVG en _brands/ con el color oficial.
        for (const icon of Object.values(BRAND_ICONS)) {
            const svg = fs.readFileSync(path.join(EXTENSIONS_DIR, '_brands', `${icon.slug}.svg`), 'utf8');
            expect(svg, icon.slug).toContain(`fill="${icon.hex}"`);
            expect(svg, icon.slug).toMatch(/viewBox="0 0 24 24"/);
            expect(svg, icon.slug).not.toMatch(/<script|onload|href|<foreignObject/i);
        }
        expect(BRAND_ICONS.zoom.hex).not.toBe(BRAND_ICONS.googlemeet.hex);
    });

    it('nombre y descripcion localizados es/en en las extensiones principales, y el texto del tooltip de Meet ya no depende del ingles', () => {
        const read = (dir: string) => JSON.parse(fs.readFileSync(path.join(EXTENSIONS_DIR, dir, 'manifest.json'), 'utf8'));
        for (const dir of ['zoom', 'google-meet', 'calendar', 'notion', 'trello', 'hubspot', 'summarizer', 'translator', 'signature', 'sealer', 'mail-groups']) {
            const m = read(dir);
            const es = manifestTexts(m, 'es');
            const en = manifestTexts(m, 'en');
            expect(es.name && es.description && en.name && en.description, dir).toBeTruthy();
            expect(es.description, `${dir}: la descripcion en espanol debe diferir de la inglesa`).not.toBe(en.description);
        }
        const meet = read('google-meet');
        expect(manifestTexts(meet, 'es').description).toMatch(/Crea videollamadas de Google Meet/);
        // La accion de la barra lleva su propio texto por idioma para el tooltip y el menu.
        const button = meet.mounts.find((mnt: any) => mnt.point === 'COMPOSER_TOOLBAR').component.props;
        expect(button.toolbar.description.es).toMatch(/videollamada/i);
        expect(button.toolbar.description.en).toMatch(/video call/i);
    });
});
