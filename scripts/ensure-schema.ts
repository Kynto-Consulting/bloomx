import { ensureDatabaseSchema } from '../src/lib/db/schema';

async function main() {
    if (!process.env.DATABASE_URL) {
        console.warn('[db:ensure] DATABASE_URL is not configured. Skipping schema bootstrap.');
        return;
    }

    await ensureDatabaseSchema();
    console.log('[db:ensure] Schema ready.');
}

main().catch((error) => {
    console.error('[db:ensure] Failed to ensure schema.', error);
    process.exit(1);
});