// Genera prisma/schema.test.prisma (SQLite) a partir de prisma/schema.prisma (Postgres).
// Prisma 5.22 no soporta Json ni @db.* en SQLite: Json -> String (JSON serializado), @db.* se eliminan.
// El cliente de pruebas se genera en node_modules/.prisma/client-test, sin tocar el cliente real.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
let out = src
    .replace(/provider\s*=\s*"postgresql"/, 'provider = "sqlite"')
    .replace(/url\s*=\s*env\("DATABASE_URL"\)/, 'url      = env("TEST_DATABASE_URL")')
    .replace(/generator client \{[^}]*\}/, 'generator client {\n  provider = "prisma-client-js"\n  output   = "../node_modules/.prisma/client-test"\n}')
    .replace(/\s+@db\.\w+(\([^)]*\))?/g, '')
    .replace(/^(\s+\w+\s+)Json(\??)/gm, '$1String$2');
if (/\bJson\b/.test(out.replace(/\/\/.*$/gm, ''))) throw new Error('Quedan campos Json sin convertir');
writeFileSync(new URL('../prisma/schema.test.prisma', import.meta.url), '// AUTO-GENERADO por scripts/make-test-schema.mjs. No editar.\n' + out);
console.log('prisma/schema.test.prisma generado');
