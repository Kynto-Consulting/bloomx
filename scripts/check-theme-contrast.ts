/**
 * Verifica el contraste WCAG 2.1 AA de:
 *   1. todos los temas genericos del registro (src/lib/themes.ts),
 *   2. los temas de empresa (brand-light / brand-dark) generados por el motor (src/lib/brand-theme.ts)
 *      para las configuraciones de prueba de src/lib/theme-fixtures.ts,
 *   3. las escalas 500/600 remapeadas en temas oscuros,
 *   4. que los valores de respaldo de @theme en globals.css coincidan con el tema "light" del registro.
 * Los requisitos (pares texto/superficie) salen de CONTRAST_REQUIREMENTS: una sola fuente para motor, tests y este script.
 *
 *   npx tsx scripts/check-theme-contrast.ts          # tabla + codigo de salida 1 si algo falla
 *   npx tsx scripts/check-theme-contrast.ts --md     # tabla en Markdown
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contrast, hslToHex } from '../src/lib/color';
import { CONTRAST_REQUIREMENTS, DARK_ACCENT_SHADES, HUES, THEMES, TOKEN_KEYS, type ThemeDefinition, type ThemeTokens } from '../src/lib/themes';
import { buildBrandThemes } from '../src/lib/brand-theme';
import { BRAND_FIXTURES } from '../src/lib/theme-fixtures';

const md = process.argv.includes('--md');
let failures = 0;

type Row = { key: string; ratio: number; ok: boolean; min: number };

function run(name: string, tokens: ThemeTokens): Row[] {
    return CONTRAST_REQUIREMENTS.map((c) => {
        const ratio = contrast(tokens[c.fg], tokens[c.on]);
        const ok = ratio >= c.min;
        if (!ok) { failures++; console.error(`FALLA  ${name}: ${c.label} = ${ratio.toFixed(2)} (< ${c.min})`); }
        return { key: c.label, ratio, ok, min: c.min };
    });
}

function complete(name: string, t: ThemeDefinition) {
    for (const k of TOKEN_KEYS) {
        const v = t.tokens[k];
        if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(v ?? '')) { failures++; console.error(`FALLA  ${name}: token ${k} invalido (${v})`); }
    }
}

// --- 1. Temas genericos ---------------------------------------------------
const rows: Record<string, Row[]> = {};
for (const t of THEMES) { complete(t.id, t); rows[t.id] = run(t.id, t.tokens); }

const header = ['Comprobacion', 'min', ...THEMES.map((t) => t.id)];
const lines: string[][] = CONTRAST_REQUIREMENTS.map((c, i) => [
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

// --- 2. Temas de empresa (motor) ------------------------------------------
console.log('\nTemas de empresa generados (brand-light / brand-dark):');
const brandDarks: ThemeDefinition[] = [];
for (const [bname, cfg] of Object.entries(BRAND_FIXTURES)) {
    const bt = buildBrandThemes(cfg, { name: bname });
    if (!bt) { failures++; console.error(`FALLA  ${bname}: no genero temas de empresa`); continue; }
    brandDarks.push(bt.dark);
    for (const th of bt.list) {
        complete(`${bname} @ ${th.id}`, th);
        const res = run(`${bname} @ ${th.id}`, th.tokens);
        const worst = res.reduce((a, b) => (b.ratio - b.min < a.ratio - a.min ? b : a));
        console.log(`  ${bname} @ ${th.id} (${th.scheme}): bg=${th.tokens.background} primary=${th.tokens.primary} peor margen: ${worst.key} ${worst.ratio.toFixed(2)}`);
    }
    if (bt.warnings.length) console.log(`    avisos: ${bt.warnings.map((w) => `${w.mode}/${w.token}${w.reason === 'scheme' ? ' (esquema)' : ''}`).join(', ')}`);
}

// --- 3. Escalas 500/600 remapeadas en temas oscuros --------------------------
// En temas oscuros las clases crudas text-<color>-500/600 se reasignan a tonos claros
// (ver darkPaletteRemap en themes.ts). Deben leerse (>= 4.5) sobre fondo, tarjeta y muted.
for (const t of [...THEMES.filter((x) => x.scheme === 'dark'), ...brandDarks]) {
    for (const shade of [500, 600] as const) {
        const { s: sat, l: lig } = DARK_ACCENT_SHADES[shade];
        for (const [hue, h] of Object.entries(HUES)) {
            const color = hslToHex(h, sat, lig);
            for (const surface of ['background', 'card', 'muted'] as const) {
                const ratio = contrast(color, t.tokens[surface]);
                if (ratio < 4.5) {
                    failures++;
                    console.error(`FALLA  ${t.id} (${t.label}): ${hue}-${shade} (${color}) sobre ${surface} = ${ratio.toFixed(2)} (< 4.5)`);
                }
            }
        }
    }
}

// --- 4. Deriva globals.css <-> registro ------------------------------------
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

console.log(failures === 0 ? '\nOK: todos los temas (genericos y de empresa) cumplen AA.' : `\n${failures} comprobacion(es) fallida(s).`);
process.exit(failures === 0 ? 0 : 1);
