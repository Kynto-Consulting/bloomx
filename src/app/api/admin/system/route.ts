import { adminRoute } from '@/lib/admin/http';
import { query } from '@/lib/admin/sql';
import { backendBaseUrl, loadDomainPrivateKey } from '@/lib/backend-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/system -> estado del sistema para la cabecera de la consola (solo lectura, sin secretos):
 *  - db: SELECT 1 con tiempo
 *  - backend: GET {backend}/api/config con timeout de 3 s (endpoint publico del backend compartido)
 *  - rateLimit: "redis" si hay Upstash configurado, "memory" si no
 *  - legacy: true si ESTA instancia NO firma sus peticiones al backend (sin BLOOMX_DOMAIN_PRIVATE_KEY valida): modo heredado
 */
async function timed<T>(fn: () => Promise<T>): Promise<{ ok: boolean; ms: number }> {
    const t0 = Date.now();
    try {
        await fn();
        return { ok: true, ms: Date.now() - t0 };
    } catch {
        return { ok: false, ms: Date.now() - t0 };
    }
}

export const GET = adminRoute({ scope: 'system', limit: 120 }, async () => {
    const [db, backend] = await Promise.all([
        timed(() => query('SELECT 1 AS ok')),
        timed(async () => {
            const res = await fetch(`${backendBaseUrl()}/api/config`, { signal: AbortSignal.timeout(3000), cache: 'no-store' });
            // Cualquier respuesta HTTP < 500 demuestra que el backend esta vivo (el dominio puede no resolverse aqui).
            if (res.status >= 500) throw new Error('backend');
        }),
    ]);
    const redis = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
    const status = !db.ok ? 'down' : !backend.ok ? 'degraded' : 'ok';
    return {
        status,
        db,
        backend,
        rateLimit: redis ? 'redis' : 'memory',
        legacy: loadDomainPrivateKey() === null,
        checkedAt: new Date().toISOString(),
    };
});
