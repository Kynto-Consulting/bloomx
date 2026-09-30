// Crea/recrea la base SQLite de pruebas (prisma/test.db) y genera el cliente de pruebas.
// NUNCA usa DATABASE_URL: solo TEST_DATABASE_URL apuntando a un archivo local.
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const url = 'file:./test.db';
rmSync(new URL('../prisma/test.db', import.meta.url), { force: true });
rmSync(new URL('../prisma/test.db-journal', import.meta.url), { force: true });
const env = { ...process.env, TEST_DATABASE_URL: url, DATABASE_URL: 'file:./unused.db' };
execSync('node scripts/make-test-schema.mjs', { stdio: 'inherit', env });
execSync('npx prisma db push --schema prisma/schema.test.prisma --skip-generate --accept-data-loss', { stdio: 'inherit', env });
execSync('npx prisma generate --schema prisma/schema.test.prisma', { stdio: 'inherit', env });
console.log('SQLite de pruebas lista: prisma/test.db');
