import { Pool } from 'pg';

declare global {
    // eslint-disable-next-line no-var
    var __bloomxCustomPool: Pool | undefined;
}

export function getDbPool() {
    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is required for the custom database layer.');
    }

    if (!global.__bloomxCustomPool) {
        global.__bloomxCustomPool = new Pool({
            connectionString: process.env.DATABASE_URL,
        });
    }

    return global.__bloomxCustomPool;
}