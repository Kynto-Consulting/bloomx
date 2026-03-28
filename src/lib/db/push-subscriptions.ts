import { randomUUID } from 'crypto';
import { ensureDatabaseSchema } from './schema';
import { getDbPool } from './pool';

export interface StoredPushSubscription {
    id: string;
    user_id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    expiration_time: number | null;
    user_agent: string | null;
    created_at: Date;
    updated_at: Date;
    last_success_at: Date | null;
}

export interface PushSubscriptionInput {
    endpoint: string;
    expirationTime?: number | null;
    keys: {
        p256dh: string;
        auth: string;
    };
    userAgent?: string | null;
}

export async function savePushSubscription(userId: string, subscription: PushSubscriptionInput) {
    await ensureDatabaseSchema();

    const pool = getDbPool();
    const { rows } = await pool.query<StoredPushSubscription>(
        `INSERT INTO push_subscriptions (
            id,
            user_id,
            endpoint,
            p256dh,
            auth,
            expiration_time,
            user_agent,
            created_at,
            updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (endpoint)
        DO UPDATE SET
            user_id = EXCLUDED.user_id,
            p256dh = EXCLUDED.p256dh,
            auth = EXCLUDED.auth,
            expiration_time = EXCLUDED.expiration_time,
            user_agent = EXCLUDED.user_agent,
            updated_at = CURRENT_TIMESTAMP
        RETURNING *`,
        [
            randomUUID(),
            userId,
            subscription.endpoint,
            subscription.keys.p256dh,
            subscription.keys.auth,
            subscription.expirationTime ?? null,
            subscription.userAgent ?? null,
        ]
    );

    return rows[0];
}

export async function deletePushSubscription(userId: string, endpoint: string) {
    await ensureDatabaseSchema();

    const pool = getDbPool();
    await pool.query(
        'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
        [userId, endpoint]
    );
}

export async function listPushSubscriptions(userId: string) {
    await ensureDatabaseSchema();

    const pool = getDbPool();
    const { rows } = await pool.query<StoredPushSubscription>(
        'SELECT * FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at DESC',
        [userId]
    );

    return rows;
}

export async function markPushSubscriptionSuccess(endpoint: string) {
    await ensureDatabaseSchema();

    const pool = getDbPool();
    await pool.query(
        'UPDATE push_subscriptions SET last_success_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE endpoint = $1',
        [endpoint]
    );
}

export async function deletePushSubscriptionsByEndpoints(endpoints: string[]) {
    if (endpoints.length === 0) {
        return;
    }

    await ensureDatabaseSchema();

    const pool = getDbPool();
    await pool.query(
        'DELETE FROM push_subscriptions WHERE endpoint = ANY($1::text[])',
        [endpoints]
    );
}