/**
 * Verifica el contraste WCAG 2.1 AA de todos los temas del registro
 * (src/lib/themes.ts) y de la marca del dominio superpuesta.
 *
 *   npx tsx scripts/check-theme-contrast.ts          # tabla + codigo de salida 1 si algo falla
 *   npx tsx scripts/check-theme-contrast.ts --md     # tabla en Markdown
 *
 * Tambien comprueba que los valores de respaldo de @theme en globals.css
 * coinciden con el tema "light" del registro (evita deriva entre ambos).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contrast } from '../src/lib/color';
import { THEMES, applyBrand, TOKEN_KEYS, type ThemeDefinition, type ThemeTokens } from '../src/lib/themes';

type Check = { label: string; fg: keyof ThemeTokens; bg: keyof ThemeTokens; min: number };

const CHECKS: Check[] = [
    { label: 'texto / fondo', fg: 'foreground', bg: 'background', min: 4.5 },
    { label: 'texto / tarjeta', fg: 'card-foreground', bg: 'card', min: 4.5 },
    { label: 'texto / popover', fg: 'popover-foreground', bg: 'popover', min: 4.5 },
    { label: 'atenuado / fondo', fg: 'muted-foreground', bg: 'background', min: 4.5 },
    { label: 'atenuado / tarjeta', fg: 'muted-foreground', bg: 'card', min: 4.5 },
    { label: 'atenuado / muted', fg: 'muted-foreground', bg: 'muted', min: 4.5 },
    { label: 'boton primario', fg: 'primary-foreground', bg: 'primary', min: 4.5 },
    { label: 'texto primario / fondo', fg: 'primary', bg: 'background', min: 4.5 },
    { label: 'boton secundario', fg: 'secondary-foreground', bg: 'secondary', min: 4.5 },
    { label: 'hover accent', fg: 'accent-foreground', bg: 'accent', min: 4.5 },
    { label: 'boton peligro', fg: 'destructive-foreground', bg: 'destructive', min: 4.5 },
    { label: 'texto peligro / fondo', fg: 'destructive', bg: 'background', min: 4.5 },
    { label: 'texto peligro / tarjeta', fg: 'destructive', bg: 'card', min: 4.5 },
    { label: 'boton exito', fg: 'success-foreground', bg: 'success', min: 4.5 },
    { label: 'texto exito / fondo', fg: 'success', bg: 'background', min: 4.5 },
    { label: 'boton aviso', fg: 'warning-foreground', bg: 'warning', min: 4.5 },
    { label: 'texto aviso / fondo', fg: 'warning', bg: 'background', min: 4.5 },
    { label: 'boton info', fg: 'info-foreground', bg: 'info', min: 4.5 },
    { label: 'texto info / fondo', fg: 'info', bg: 'background', min: 4.5 },
    { label: 'acento marca', fg: 'brand-accent-foreground', bg: 'brand-accent', min: 4.5 },
    { label: 'borde de control / fondo (3:1)', fg: 'input', bg: 'background', min: 3 },
    { label: 'foco / fondo (3:1)', fg: 'ring', bg: 'background', min: 3 },
];

const md = process.argv.includes('--md');
let failures = 0;

function run(name: string, tokens: ThemeTokens): { key: string; ratio: number; ok: boolean; min: number }[] {
    return CHECKS.map((c) => {
        const ratio = contrast(tokens[c.fg], tokens[c.bg]);
        const ok = ratio >= c.min;
        if (!ok) { failures++; console.error(`FALLA  ${name}: ${c.label} = ${ratio.toFixed(2)} (< ${c.min})`); }
        return { key: c.label, ratio, ok, min: c.min };
    });
}

// --- 1. Temas base ---------------------------------------------------------
const rows: Record<string, { key: string; ratio: number; ok: boolean; min: number }[]> = {};
for (const t of THEMES) rows[t.id] = run(t.id, t.tokens);

const header = ['Comprobacion', 'min', ...THEMES.map((t) => t.id)];
const lines: string[][] = CHECKS.map((c, i) => [
    c.label, String(c.min),
    ...THEMES.map((t) => { const r = rows[t.id][i]; return `${r.ratio.toFixed(2)}${r.ok ? '' : ' X'}`; }),
]);
if (md) {
    console.log(`| ${header.join(' | ')} |`);
    console.log(`|${header.map(() => '---').join('|')}|`);
    lines.forEach((l) => console.log(`| ${l.join(' | ')} |`));
} else {
    console.table(Object.fromEntries(lines.map((l) => [l[0], Object.fromEntries(header.slice(1).map((h, i) => [h, l[i + 1]]))])));
}

// --- 2. Marca del dominio superpuesta --------------------------------------
const BRANDS: Record<string, any> = {
    'marca dorada #bfa13a (.env)': { primaryColor: '#bfa13a' },
    'azul por defecto #2563EB': { primaryColor: '#2563EB', accentColor: '#4f46e5' },
    'defaults del panel admin': {
        primaryColor: '#000000', secondaryColor: '#ffffff', backgroundColor: '#f9fafb', textColor: '#111827',
        accentColor: '#4f46e5', mutedColor: '#f3f4f6', borderColor: '#e5e7eb', cardColor: '#ffffff',
    },
    'marca rosa palido #ffb6c1 (peor caso)': { primaryColor: '#ffb6c1', accentColor: '#ffff99', backgroundColor: '#fffbe6', textColor: '#cccccc' },
};
console.log('\nMarca del dominio superpuesta (temas brandable):');
for (const [bname, cfg] of Object.entries(BRANDS)) {
    for (const t of THEMES.filter((x) => x.brandable)) {
        const merged: ThemeTokens = { ...t.tokens, ...(applyBrand(t as ThemeDefinition, cfg) as Partial<ThemeTokens>) };
        const res = run(`${bname} @ ${t.id}`, merged);
        const worst = res.reduce((a, b) => (b.ratio - b.min < a.ratio - a.min ? b : a));
        console.log(`  ${bname} @ ${t.id}: primary=${merged.primary} peor margen: ${worst.key} ${worst.ratio.toFixed(2)}`);
    }
}

// --- 3. Deriva globals.css <-> registro ------------------------------------
try {
    const css = readFileSync(join(__dirname, '..', 'src', 'app', 'globals.css'), 'utf8');
    const block = css.match(/@theme\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const light = THEMES.find((t) => t.id === 'light')!;
    for (const k of TOKEN_KEYS) {
        const m = block.match(new RegExp(`--color-${k}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`));
        if (!m) { failures++; console.error(`FALLA  globals.css: falta --color-${k}`); continue; }
        if (m[1].toLowerCase() !== light.tokens[k]) { failures++; console.error(`FALLA  globals.css: --color-${k} (${m[1]}) != registro light (${light.tokens[k]})`); }
    }
} catch (e) {
    console.warn('No se pudo leer globals.css:', (e as Error).message);
}

console.log(failures === 0 ? '\nOK: todos los temas cumplen AA.' : `\n${failures} comprobacion(es) fallida(s).`);
process.exit(failures === 0 ? 0 : 1);
