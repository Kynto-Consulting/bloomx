// globalSetup de vitest.pg.config.ts: levanta Postgres embebido, aplica el DDL real (ensureDatabaseSchema)
// y publica DATABASE_URL / PG_TEST_* para los workers (heredan process.env).
import { startPgTestServer } from '../../../../scripts/pg-test-server.mjs';

let server: { url: string; port: number; stop: () => Promise<void> } | null = null;

export async function setup() {
    if (process.env.DATABASE_URL && /neon\.tech|amazonaws|supabase/i.test(process.env.DATABASE_URL)) {
        // Red de seguridad: jamas heredar una BD remota del entorno
        delete process.env.DATABASE_URL;
    }
    server = await startPgTestServer({ quiet: true });
    process.env.DATABASE_URL = server.url;
    process.env.PG_TEST_URL = server.url;
    process.env.PG_TEST_PORT = String(server.port);
    delete process.env.DIRECT_URL;
    const { ensureDatabaseSchema } = await import('../../db/schema');
    await ensureDatabaseSchema();
    const g = globalThis as any;
    await g.__bloomxCustomPool?.end?.();
    g.__bloomxCustomPool = undefined;
}

export async function teardown() {
    await server?.stop();
    server = null;
}
