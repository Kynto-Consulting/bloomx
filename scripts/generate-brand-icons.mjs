/**
 * Genera a partir de `simple-icons` (CC0-1.0, devDependency SOLO de este script):
 *   1. src/lib/expansions/brand-icons.ts: indice MINIMO slug -> nombre + color oficial (placeholder instantaneo). SIN rutas SVG: los
 *      dibujos ya NO viajan en el bundle, se sirven desde el backend (GET /api/extensions/icons/...), asi que cambiar un logo no exige redeploy.
 *   2. ../bloomx-extensions/_brands/<slug>.svg (fuente de los iconos `brand.<slug>` del backend) y, con --extensions=<dir,dir>, el
 *      icon.svg de esas extensiones (el de su `icon: brand:<slug>`). Nunca sobrescribe un icon.svg existente salvo --force.
 *
 *   npm run icons:brands                          solo brand-icons.ts
 *   node scripts/generate-brand-icons.mjs --svg   ademas _brands/*.svg
 *   node scripts/generate-brand-icons.mjs --svg --extensions=zoom,notion [--force]
 *
 * Los logotipos oscuros (luminancia baja: Notion, GitHub, Anthropic) llevan una placa blanca redondeada dentro del propio SVG para que se
 * lean igual en tema claro y oscuro (un <img> no hereda colores). Las marcas retiradas de simple-icons (Microsoft, Teams, Slack) van en CUSTOM:
 * SVG propio en _brands/, solo indexadas aqui; las demas sin logotipo (NEUTRAL) son ficha neutra con inicial.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as si from 'simple-icons';
import { readFileSync } from 'node:fs';

const SI_VERSION = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'simple-icons', 'package.json'), 'utf8')).version;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'expansions', 'brand-icons.ts');

/** slug BloomX -> export de simple-icons (siXxx). */
const BRANDS = [
    'googlemeet', 'googlecalendar', 'googledrive', 'googlesheets', 'googledocs', 'googlegemini', 'gmail', 'google',
    'zoom', 'notion', 'trello', 'hubspot', 'giphy', 'zoho', 'github', 'gitlab', 'jira', 'linear', 'asana', 'clickup', 'airtable',
    'stripe', 'dropbox', 'todoist', 'calendly', 'discord', 'whatsapp', 'telegram', 'anthropic',
];

/** Marcas retiradas de simple-icons: se sirven como SVG PROPIO (trazos sencillos) desde bloomx-extensions/_brands/<slug>.svg (fuente de verdad,
 *  este script NO los genera ni sobrescribe); aqui solo se indexa nombre + color de placeholder. */
const CUSTOM = [
    { slug: "microsoft", name: "Microsoft", hex: "#00a4ef" },
    { slug: "microsoftteams", name: "Microsoft Teams", hex: "#5059c9" },
    { slug: "slack", name: "Slack", hex: "#e01e5a" },
];

/** Marcas sin logotipo aun: ficha neutra con inicial (y el icono Lucide de reserva). */
const NEUTRAL = [
    { slug: "microsoftoutlook", name: "Microsoft Outlook", initial: "O", lucide: "Mail" },
    { slug: "salesforce", name: "Salesforce", initial: "S", lucide: "Cloud" },
    { slug: "openai", name: "OpenAI", initial: "O", lucide: "Bot" },
];

function luminance(hex) {
    const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
/** SVG del logotipo: viewBox 24, color oficial; los muy oscuros sobre placa blanca (legibles en cualquier tema). */
function brandSvg(path, hex, title) {
    const label = title.replace(/[^A-Za-z0-9 .+-]/g, '');
    if (luminance(hex) < 0.12) {
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>${label}</title><rect width="24" height="24" rx="5" fill="#ffffff"/><path transform="translate(4 4) scale(0.6667)" fill="#${hex}" d="${path}"/></svg>\n`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>${label}</title><path fill="#${hex}" d="${path}"/></svg>\n`;
}

const missing = [];
const brandLines = [];
const svgs = {};
for (const slug of BRANDS) {
    const key = `si${slug[0].toUpperCase()}${slug.slice(1)}`;
    const icon = si[key];
    if (!icon) { missing.push(slug); continue; }
    if (!/^[MmLlHhVvCcSsQqTtAaZz0-9 .,\-]+$/.test(icon.path)) throw new Error(`Ruta SVG inesperada en ${slug}`);
    brandLines.push(`    ${slug}: { slug: '${slug}', name: ${JSON.stringify(icon.title)}, hex: '#${icon.hex.toLowerCase()}' },`);
    svgs[slug] = brandSvg(icon.path, icon.hex.toLowerCase(), icon.title);
}
if (missing.length > 0) throw new Error(`Faltan en simple-icons (muevelas a NEUTRAL): ${missing.join(', ')}`);
for (const n of NEUTRAL) if (si[`si${n.slug[0].toUpperCase()}${n.slug.slice(1)}`]) throw new Error(`${n.slug} ya existe en simple-icons: muevela a BRANDS`);

for (const c of CUSTOM) brandLines.push(`    ${c.slug}: { slug: '${c.slug}', name: ${JSON.stringify(c.name)}, hex: '${c.hex}' },`);
const neutralLines = NEUTRAL.map((n) => `    ${n.slug}: { slug: '${n.slug}', name: ${JSON.stringify(n.name)}, initial: '${n.initial}', lucide: '${n.lucide}' },`);

const source = `/**
 * REGISTRO DE ICONOS DE MARCA de las apps que integran las extensiones. ARCHIVO GENERADO: no lo edites a mano.
 *   Fuente:    simple-icons ${SI_VERSION} (CC0-1.0), solo nombre y color de los iconos listados en scripts/generate-brand-icons.mjs
 * SIN rutas SVG: los dibujos se cargan async desde GET /api/extensions/icons/brand.<slug> (bloomx-extensions/_brands). Este indice solo da el
 * placeholder instantaneo (ficha con inicial en el color de la marca) y el respaldo si el backend no responde.
 *   Regenerar: npm run icons:brands
 *
 * Cada entrada es DATO (nombre + color oficial de la marca; el dibujo vive en el backend), no estilo de la app: por eso este fichero esta en la
 * allowlist de la guardia no-raw-colors. El componente ExtensionIcon aplica una garantia de contraste (>= 3:1) al color oficial
 * segun el tema activo.
 *
 * Marcas registradas: los logotipos pertenecen a sus titulares y se usan SOLO para identificar la integracion con ese servicio; no
 * implican patrocinio ni afiliacion. Microsoft, Teams y Slack (retiradas de simple-icons) se sirven como SVG propio desde el backend
 * (_brands/); el resto sin logotipo se muestra como inicial en una ficha neutra (NEUTRAL_BRANDS).
 */

export interface BrandIcon {
    /** Identificador estable (minusculas), el de \`brand:<slug>\`. */
    slug: string;
    /** Nombre comercial. */
    name: string;
    /** Color oficial \`#rrggbb\`. */
    hex: string;
}

export interface NeutralBrand {
    slug: string;
    name: string;
    /** Inicial que se muestra en la ficha neutra. */
    initial: string;
    /** Icono Lucide de reserva. */
    lucide: string;
}

export const BRAND_ICONS: Readonly<Record<string, BrandIcon>> = {
${brandLines.join('\n')}
};

export const NEUTRAL_BRANDS: Readonly<Record<string, NeutralBrand>> = {
${neutralLines.join('\n')}
};
`;

writeFileSync(OUT, source);
console.log(`brand-icons.ts: ${BRANDS.length} marcas, ${NEUTRAL.length} neutras, ${(source.length / 1024).toFixed(1)} KB`);

if (process.argv.includes('--svg')) {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bloomx-extensions');
    const force = process.argv.includes('--force');
    const put = (file, content) => {
        if (existsSync(file) && !force) return false;
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, content);
        return true;
    };
    let wrote = 0;
    for (const [slug, svg] of Object.entries(svgs)) if (put(join(root, '_brands', `${slug}.svg`), svg)) wrote += 1;
    const only = (process.argv.find((a) => a.startsWith('--extensions=')) ?? '').slice('--extensions='.length).split(',').filter(Boolean);
    for (const dir of only) {
        const manifest = JSON.parse(readFileSync(join(root, dir, 'manifest.json'), 'utf8'));
        const m = /^brand:([a-z0-9]+)$/.exec(manifest.icon ?? '');
        if (m && svgs[m[1]] && put(join(root, dir, 'icon.svg'), svgs[m[1]])) wrote += 1;
    }
    console.log(`svg: ${wrote} archivos escritos (los existentes se respetan; --force para sobrescribir)`);
}
