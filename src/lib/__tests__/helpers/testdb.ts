// Cliente Prisma sobre SQLite para tests de integracion. Requiere `npm run test:db:setup`.
// Los campos Json del esquema real son String (JSON serializado) en este esquema de pruebas.
import path from 'node:path';

let instance: import('@prisma/client').PrismaClient | undefined;

export function getTestPrisma() {
    if (instance) return instance;
    process.env.TEST_DATABASE_URL = `file:${path.resolve(process.cwd(), 'prisma/test.db')}`;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaClient } = require(path.resolve(process.cwd(), 'node_modules/.prisma/client-test'));
    instance = new PrismaClient() as import('@prisma/client').PrismaClient;
    return instance;
}
