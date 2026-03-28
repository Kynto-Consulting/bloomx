import webpush from 'web-push';
import { ensureDatabaseSchema } from '@/lib/db/schema';
import { getDbPool } from '@/lib/db/pool';

type StoredVapidConfigRow = {
    id: string;
    public_key: string;
    private_key: string;
    subject: string;
};

export type VapidConfig = {
    publicKey: string;
    privateKey: string;
    subject: string;
};

const CONFIG_ROW_ID = 'global';

let cachedVapidConfig: VapidConfig | null = null;
let vapidConfigPromise: Promise<VapidConfig> | null = null;

function normalizeHost(host: string | null | undefined) {
    return host?.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '') || null;
}

function buildDefaultSubject() {
    const host = normalizeHost(
        process.env.TOP_DOMAIN
        || process.env.NEXT_PUBLIC_APP_URL
        || process.env.VERCEL_PROJECT_PRODUCTION_URL
        || process.env.VERCEL_URL
    );

    if (host && host !== 'localhost') {
        return `https://${host}`;
    }

    return 'mailto:noreply@localhost';
}

function getEnvVapidConfig(): VapidConfig | null {
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;

    if (!publicKey || !privateKey) {
        return null;
    }

    return {
        publicKey,
        privateKey,
        subject: process.env.VAPID_SUBJECT || buildDefaultSubject(),
    };
}

function mapStoredConfig(row: StoredVapidConfigRow): VapidConfig {
    return {
        publicKey: row.public_key,
        privateKey: row.private_key,
        subject: row.subject,
    };
}

async function readStoredVapidConfig() {
    await ensureDatabaseSchema();

    const pool = getDbPool();
    const { rows } = await pool.query<StoredVapidConfigRow>(
        'SELECT id, public_key, private_key, subject FROM push_vapid_config WHERE id = $1 LIMIT 1',
        [CONFIG_ROW_ID]
    );

    return rows[0] ? mapStoredConfig(rows[0]) : null;
}

async function createStoredVapidConfig() {
    await ensureDatabaseSchema();

    const pool = getDbPool();
    const generatedKeys = webpush.generateVAPIDKeys();
    const subject = buildDefaultSubject();

    await pool.query(
        `INSERT INTO push_vapid_config (id, public_key, private_key, subject, created_at, updated_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (id)
         DO NOTHING`,
        [CONFIG_ROW_ID, generatedKeys.publicKey, generatedKeys.privateKey, subject]
    );

    const storedConfig = await readStoredVapidConfig();
    if (!storedConfig) {
        throw new Error('Failed to create persistent VAPID configuration.');
    }

    return storedConfig;
}

export async function getOrCreateVapidConfig() {
    if (cachedVapidConfig) {
        return cachedVapidConfig;
    }

    const envConfig = getEnvVapidConfig();
    if (envConfig) {
        cachedVapidConfig = envConfig;
        return envConfig;
    }

    if (!vapidConfigPromise) {
        vapidConfigPromise = (async () => {
            const storedConfig = await readStoredVapidConfig();
            const resolvedConfig = storedConfig || await createStoredVapidConfig();
            cachedVapidConfig = resolvedConfig;
            return resolvedConfig;
        })().catch((error) => {
            vapidConfigPromise = null;
            throw error;
        });
    }

    return vapidConfigPromise;
}

export async function getVapidPublicKey() {
    const { publicKey } = await getOrCreateVapidConfig();
    return publicKey;
}