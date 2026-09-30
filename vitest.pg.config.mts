// Pruebas de integracion contra un Postgres REAL embebido y efimero (ver scripts/pg-test-server.mjs).
// NO carga vitest.setup.ts (que bloquea DATABASE_URL): aqui DATABASE_URL apunta al cluster temporal local.
import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    resolve: { alias: { '@': path.resolve(root, 'src') } },
    test: {
        include: ['src/**/*.pg.test.ts'],
        environment: 'node',
        globalSetup: ['./src/lib/__tests__/helpers/pg-global-setup.ts'],
        // Un solo cluster compartido: los archivos corren en serie y usan ids unicos.
        fileParallelism: false,
        testTimeout: 60_000,
        hookTimeout: 120_000,
    },
});
