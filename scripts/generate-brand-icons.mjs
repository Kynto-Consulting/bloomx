/**
 * Genera src/lib/expansions/brand-icons.ts a partir de `simple-icons` (CC0-1.0, devDependency SOLO de este script).
 *
 *   npm run icons:brands
 *
 * El modulo generado contiene UNICAMENTE los iconos listados abajo (ruta SVG del viewBox 24 + color oficial), asi que el bundle
 * del cliente no importa `simple-icons` (16 MB) sino ~15 KB de datos. Para anadir una marca: anade su slug de simple-icons a
 * BRANDS, ejecuta el script y revisa el diff. Las marcas que simple-icons NO incluye (retiradas a peticion de la marca) van en
 * NEUTRAL: se muestran como una inicial en una ficha neutra, nunca como un logotipo dibujado a mano.
 */
import { writeFileSync } from 'node:fs';
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
    'stripe', 'dropbox', 'calendly', 'discord', 'whatsapp', 'telegram', 'anthropic',
];

/** Marcas ausentes de simple-icons: ficha neutra con inicial (y el icono Lucide de reserva para los contextos que lo prefieran). */
const NEUTRAL = [
    { slug: 'slack', name: 'Slack', initial: 'S', lucide: 'Hash' },
    { slug: 'microsoft', name: 'Microsoft', initial: 'M', lucide: 'LayoutGrid' },
    { slug: 'microsoftteams', name: 'Microsoft Teams', initial: 'T', lucide: 'Users' },
    { slug: 'microsoftoutlook', name: 'Microsoft Outlook', initial: 'O', lucide: 'Mail' },
    { slug: 'salesforce', name: 'Salesforce', initial: 'S', lucide: 'Cloud' },
    { slug: 'openai', name: 'OpenAI', initial: 'O', lucide: 'Bot' },
];

const missing = [];
const brandLines = [];
for (const slug of BRANDS) {
    const key = `si${slug[0].toUpperCase()}${slug.slice(1)}`;
    const icon = si[key];
    if (!icon) { missing.push(slug); continue; }
    if (!/^[MmLlHhVvCcSsQqTtAaZz0-9 .,\-]+$/.test(icon.path)) throw new Error(`Ruta SVG inesperada en ${slug}`);
    brandLines.push(`    ${slug}: { slug: '${slug}', name: ${JSON.stringify(icon.title)}, hex: '#${icon.hex.toLowerCase()}', path: '${icon.path}' },`);
}
if (missing.length > 0) throw new Error(`Faltan en simple-icons (muevelas a NEUTRAL): ${missing.join(', ')}`);
for (const n of NEUTRAL) if (si[`si${n.slug[0].toUpperCase()}${n.slug.slice(1)}`]) throw new Error(`${n.slug} ya existe en simple-icons: muevela a BRANDS`);

const neutralLines = NEUTRAL.map((n) => `    ${n.slug}: { slug: '${n.slug}', name: ${JSON.stringify(n.name)}, initial: '${n.initial}', lucide: '${n.lucide}' },`);

const source = `/**
 * REGISTRO DE ICONOS DE MARCA de las apps que integran las extensiones. ARCHIVO GENERADO: no lo edites a mano.
 *   Fuente:    simple-icons ${SI_VERSION} (CC0-1.0), solo los iconos listados en scripts/generate-brand-icons.mjs
 *   Regenerar: npm run icons:brands
 *
 * Cada entrada es DATO (ruta SVG del viewBox 24 + color oficial de la marca), no estilo de la app: por eso este fichero esta en la
 * allowlist de la guardia no-raw-colors. El componente ExtensionIcon aplica una garantia de contraste (>= 3:1) al color oficial
 * segun el tema activo.
 *
 * Marcas registradas: los logotipos pertenecen a sus titulares y se usan SOLO para identificar la integracion con ese servicio; no
 * implican patrocinio ni afiliacion. Las marcas que simple-icons no incluye (retiradas a peticion del titular) NO se dibujan a mano:
 * se muestran como una inicial en una ficha neutra (NEUTRAL_BRANDS).
 */

export interface BrandIcon {
    /** Identificador estable (minusculas), el de \`brand:<slug>\`. */
    slug: string;
    /** Nombre comercial. */
    name: string;
    /** Color oficial \`#rrggbb\`. */
    hex: string;
    /** Datos del atributo \`d\` de un unico <path> (viewBox 0 0 24 24). */
    path: string;
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
