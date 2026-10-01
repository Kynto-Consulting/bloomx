/**
 * Genera src/app/docs/_content/generated/admin-cli-catalog.json a partir del catalogo REAL de comandos del Admin CLI
 * (src/lib/admin-cli/catalog.ts) y de las rutas excluidas con motivo (src/lib/admin-cli/coverage.ts). La pagina /docs/admin-cli
 * la lee de ahi (sin arrastrar los handlers al bundle de la documentacion). Ejecutar tras cambiar comandos:
 *   npm run docs:admin-cli
 * admin-cli/__tests__/docs-sync.test.ts falla si el JSON esta desactualizado.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildAdminCliDocsData } from '../src/lib/admin-cli/docs-data';

const target = path.join(process.cwd(), 'src', 'app', 'docs', '_content', 'generated', 'admin-cli-catalog.json');
const data = buildAdminCliDocsData();
fs.writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`);
console.log(`${data.commands.length} comandos, ${Object.keys(data.excluded).length} exclusiones -> ${path.relative(process.cwd(), target)}`);
