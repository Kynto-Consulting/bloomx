import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { dictionaries, flattenMessages } from '@/lib/i18n';
import { TOKEN_KEYS } from '@/lib/theme-config';
import { PRESETS, TOKEN_GROUPS } from '../model';

const DIR = path.resolve(__dirname, '..');
const ROOT = path.resolve(__dirname, '../../../../..');
const es = flattenMessages(dictionaries.es!);
const en = flattenMessages(dictionaries.en!);
const sources = fs.readdirSync(DIR).filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => ({ f, src: fs.readFileSync(path.join(DIR, f), 'utf8') }));

describe('i18n del editor (namespace themeEditor)', () => {
    it('es y en tienen exactamente las mismas claves themeEditor.*', () => {
        const k = (m: Record<string, string>) => Object.keys(m).filter((x) => x.startsWith('themeEditor.')).sort();
        expect(k(en)).toEqual(k(es));
        expect(k(es).length).toBeGreaterThan(250);
        for (const key of k(es)) expect(es[key], key).not.toBe('');
    });

    it('cada clave literal usada en los componentes existe', () => {
        const missing: string[] = [];
        for (const { f, src } of sources) {
            if (f === 'model.ts') continue;
            for (const m of src.matchAll(/'(themeEditor\.[A-Za-z0-9_.]+)'/g)) if (!(m[1] in es)) missing.push(`${f}: ${m[1]}`);
            // Maquetas: p('clave') -> themeEditor.preview.clave
            if (f === 'mockups.tsx') for (const m of src.matchAll(/\bp\('([A-Za-z0-9_.]+)'\)/g)) if (!(`themeEditor.preview.${m[1]}` in es)) missing.push(`${f}: preview.${m[1]}`);
        }
        expect(missing).toEqual([]);
    });

    it('las familias dinamicas existen (tokens, grupos, presets, radios, modos, estados)', () => {
        const need: string[] = [];
        for (const t of TOKEN_KEYS) need.push(`themeEditor.tokens.${t}`);
        for (const g of TOKEN_GROUPS) need.push(`themeEditor.colors.groups.${g.id}`, `themeEditor.colors.groupHelp.${g.id}`);
        for (const p of PRESETS) need.push(`themeEditor.colors.presets.${p.id}`);
        for (const r of ['none', 'sm', 'md', 'lg', 'xl']) need.push(`themeEditor.typography.radius.${r}`);
        for (const s of ['success', 'warning', 'error', 'info']) need.push(`themeEditor.preview.state.${s}`);
        for (const s of ['explicit', 'derived', 'corrected']) need.push(`themeEditor.colors.status.${s}`);
        for (const s of ['contrast', 'scheme', 'invisible']) need.push(`themeEditor.contrast.reason.${s}`);
        for (const c of ['not_object', 'too_large', 'unknown_key', 'invalid_color', 'invalid_token', 'alpha_not_allowed', 'invalid_value', 'too_many', 'landing_invalid']) need.push(`themeEditor.advanced.issue.${c}`);
        for (const c of ['empty', 'too_large', 'invalid_json', 'not_object', 'nothing_valid']) need.push(`themeEditor.advanced.importError.${c}`);
        for (const c of ['tooLong', 'not_https', 'invalid', 'too_long', 'too_large', 'not_object', 'server']) need.push(`themeEditor.errors.${c}`);
        for (const c of ['inbox', 'compose', 'dialog', 'ui']) need.push(`themeEditor.scene.${c}`);
        const missing = need.filter((k) => !(k in es) || !(k in en));
        expect(missing).toEqual([]);
    });
});

describe('fidelidad de la vista previa: solo tokens', () => {
    const mock = fs.readFileSync(path.join(DIR, 'mockups.tsx'), 'utf8');
    it('las maquetas no usan hex, colores crudos de Tailwind ni estilos de color inline', () => {
        expect(mock).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(mock).not.toMatch(/\b(?:bg|text|border|ring|fill|stroke|from|to|via|divide)-(?:white|black|(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})\b/);
        expect(mock).not.toMatch(/style=\{\{[^}]*(?:color|background)/i);
    });
    it('usan los tokens clave de la app', () => {
        for (const cls of ['bg-sidebar', 'text-sidebar-foreground', 'bg-sidebar-accent', 'border-sidebar-border', 'bg-header', 'bg-unread', 'bg-row-hover', 'bg-row-selected', 'text-row-selected-foreground', 'bg-chip', 'bg-code', 'bg-overlay', 'text-link', 'bg-popover', 'bg-brand-accent', 'bg-success/10', 'bg-warning/10', 'bg-destructive/10', 'bg-info/10', 'ring-ring', 'border-input', 'bg-selection']) {
            expect(mock, cls).toContain(cls);
        }
    });
});

describe('el admin ya no usa applyBrand (legado)', () => {
    it('ni el dashboard ni los componentes admin lo importan', () => {
        const files = [
            'src/app/admin/dashboard/page.tsx', 'src/components/admin/LandingPreview.tsx', 'src/components/admin/LandingEditor.tsx', 'src/lib/brand-check.ts',
            ...sources.map((s) => `src/components/admin/theme-editor/${s.f}`),
        ];
        for (const f of files) expect(fs.readFileSync(path.join(ROOT, f), 'utf8'), f).not.toMatch(/\bapplyBrand\b/);
    });
});
