/**
 * generate-icons.mjs
 * Rasteriza public/icon.svg y public/icon-maskable.svg a los PNG que exige el manifest PWA
 * (Chrome/Android piden 192 y 512; iOS usa apple-touch-icon de 180).
 *
 * Uso manual (no forma parte del build):   node scripts/generate-icons.mjs
 * Requiere `sharp`, que ya viene como dependencia de Next.js. No toca la base de datos.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = (name) => path.join(root, 'public', name);

const { default: sharp } = await import('sharp');

const jobs = [
    { src: 'icon.svg', out: 'icon-192.png', size: 192 },
    { src: 'icon.svg', out: 'icon-512.png', size: 512 },
    { src: 'icon.svg', out: 'apple-touch-icon.png', size: 180 },
    { src: 'icon-maskable.svg', out: 'icon-maskable-512.png', size: 512 },
];

for (const job of jobs) {
    const svg = await readFile(pub(job.src));
    // density alto para que el vector se rasterice nitido antes de reducirlo.
    const png = await sharp(svg, { density: 384 }).resize(job.size, job.size).png({ compressionLevel: 9 }).toBuffer();
    await writeFile(pub(job.out), png);
    console.log(`[icons] ${job.out} (${job.size}x${job.size}, ${png.length} bytes)`);
}
