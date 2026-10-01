/**
 * Genera src/app/docs/_content/ui-usages.json: un uso real de cada componente del kit, tomado de los manifests de
 * ../bloomx-extensions (se citan en /docs/extension-ui/<componente>). Ejecutar tras cambiar manifests o el kit:
 *   npx tsx scripts/gen-ui-usages.ts
 * El JSON se versiona (el build no ve el otro repositorio); ui-kit.test.ts falla si esta desactualizado.
 */
import fs from 'node:fs';
import path from 'node:path';
import { collectUsages, type ManifestFile } from '../src/app/docs/_content/ui-kit/usages';

export function readManifests(root: string): ManifestFile[] {
    const out: ManifestFile[] = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name === 'node_modules') continue;
        const file = path.join(root, entry.name, 'manifest.json');
        if (!fs.existsSync(file)) continue;
        out.push({ file: `${entry.name}/manifest.json`, manifest: JSON.parse(fs.readFileSync(file, 'utf8')) });
    }
    return out;
}

if (process.argv[1] && /gen-ui-usages/.test(process.argv[1])) {
    const root = path.resolve(process.cwd(), '..', 'bloomx-extensions');
    if (!fs.existsSync(root)) { console.error(`No existe ${root}`); process.exit(1); }
    const doc = collectUsages(readManifests(root));
    const target = path.join(process.cwd(), 'src', 'app', 'docs', '_content', 'ui-usages.json');
    fs.writeFileSync(target, JSON.stringify(doc, null, 2) + '\n');
    console.log(`${Object.keys(doc.components).length} componentes con uso real -> ${path.relative(process.cwd(), target)}`);
}
