/**
 * Genera la referencia TSDocs del SDK de extensiones a partir de los .d.ts reales de ../bloomx-extensions/_shared/sdk.
 *   npm run docs:tsdocs           escribe src/app/docs/_content/generated/sdk-tsdocs*.json
 *   npm run docs:tsdocs -- --check  falla (exit 1) si lo commiteado esta desactualizado
 */
import fs from 'node:fs';
import path from 'node:path';
import { FULL_JSON, SEARCH_JSON, generateFromRoot, sdkSourcesAvailable } from '../src/lib/tsdocs/generate';

const root = process.cwd();
const check = process.argv.includes('--check');

if (!sdkSourcesAvailable(root)) {
    console.error('No se encuentra ../bloomx-extensions/_shared/sdk (repo hermano). Clona bloomx-extensions junto a este repo.');
    process.exit(check ? 0 : 1);
}

const { data, full, search } = generateFromRoot(root);
const targets: Array<[string, string]> = [[FULL_JSON, full], [SEARCH_JSON, search]];
const stale: string[] = [];
for (const [rel, content] of targets) {
    const file = path.join(root, rel);
    const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
    if (cur === content) continue;
    if (check) stale.push(rel);
    else {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    }
}
if (check) {
    if (stale.length) {
        console.error(`TSDocs desactualizado: ${stale.join(', ')}. Ejecuta: npm run docs:tsdocs`);
        process.exit(1);
    }
    console.log('TSDocs al dia.');
} else {
    console.log(`TSDocs generado: ${data.symbols.length} simbolos en ${data.modules.length} modulos.`);
}
