/**
 * Servicio de metricas agregadas del sandbox de extensiones (`services.stats.*`), lado frontend. SOLO LECTURA.
 *
 * Garantias:
 *  - La FUENTE es esta instancia (su propia BD). Devuelve SOLO agregados: conteos de usuarios y correos por dia (UTC). Nunca asuntos,
 *    remitentes, destinatarios, cuerpos ni identificadores.
 *  - Exige el permiso READ_STATS en la executionGrant firmada por la instancia (`grant.perms`), y ademas que el usuario que ejecuta sea
 *    ADMINISTRADOR (nivel efectivo >= 1): un usuario normal con la extension instalada no puede leer metricas del dominio.
 *  - Cuota: 60 consultas/min por extension. Auditoria sin PII.
 */
import { z } from 'zod';
import { BridgeError, op } from './bridge-route';

export const STATS_PERMISSION = 'READ_STATS';
export const STATS_MIN_LEVEL = 1;
export const STATS_DEFAULT_DAYS = 14;
export const STATS_MAX_DAYS = 30;
export const STATS_QUOTA_PER_MINUTE = 60;

export const statsRequest = z.discriminatedUnion('op', [
    op('overview', z.strictObject({ days: z.number().int().min(1).max(STATS_MAX_DAYS).default(STATS_DEFAULT_DAYS) }).default({ days: STATS_DEFAULT_DAYS })),
]);
export type StatsRequest = z.infer<typeof statsRequest>;

export interface MailDayRow { date: string; received: number; sent: number; spamBlocked: number }
export interface StatsOverview {
    users: { total: number; new7d: number; active30d: number };
    mail: { days: MailDayRow[]; totals: { received: number; sent: number; spamBlocked: number } };
    generatedAt: string;
}

export interface StatsDeps {
    /** Nivel de permiso efectivo (0 = usuario normal) del usuario que ejecuta. */
    levelOf: (userId: string) => Promise<number>;
    userCounts: () => Promise<{ total: number; new7d: number; active30d: number }>;
    /** Conteos por dia UTC desde `since` (inclusive). Los dias sin correos pueden faltar. */
    mailByDay: (since: Date) => Promise<MailDayRow[]>;
    rateLimit: (key: string, limit: number, windowMs: number) => Promise<{ ok: boolean; retryAfter: number }>;
    audit: (event: string, data: Record<string, unknown>) => void;
    now?: () => Date;
}

export async function defaultStatsDeps(): Promise<StatsDeps> {
    const { prisma } = await import('@/lib/prisma');
    const { rateLimitAsync } = await import('@/lib/security');
    const { auditLog } = await import('@/lib/audit');
    const { query, tolerant, num } = await import('@/lib/admin/sql');
    const { refreshPermissions } = await import('@/lib/permissions');
    const { effectiveLevelSync } = await import('@/lib/permissions-core');
    return {
        levelOf: async (userId) => {
            const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
            if (!u) return 0;
            await refreshPermissions().catch(() => undefined);
            return effectiveLevelSync(u.email).level;
        },
        userCounts: async () => {
            const [u] = await tolerant(
                () => query<{ total: unknown; new7d: unknown }>(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '7 days') AS new7d FROM "User"`),
                [],
            );
            const [a] = await tolerant(
                () => query<{ active: unknown }>(`SELECT COUNT(*) FILTER (WHERE "lastLoginAt" >= NOW() - INTERVAL '30 days') AS active FROM "UserAdminState"`),
                [],
            );
            return { total: num(u?.total), new7d: num(u?.new7d), active30d: num(a?.active) };
        },
        mailByDay: async (since) => {
            const rows = await tolerant(
                () => query<{ d: string; received: unknown; sent: unknown; spam: unknown }>(
                    `SELECT to_char(("createdAt" AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS d,
                            COUNT(*) FILTER (WHERE "status" = 'received') AS received,
                            COUNT(*) FILTER (WHERE "folder" = 'sent') AS sent,
                            COUNT(*) FILTER (WHERE "folder" = 'spam') AS spam
                     FROM "Email" WHERE "createdAt" >= $1 GROUP BY 1`,
                    since,
                ),
                [],
            );
            return rows.map((r) => ({ date: String(r.d), received: num(r.received), sent: num(r.sent), spamBlocked: num(r.spam) }));
        },
        rateLimit: rateLimitAsync,
        audit: auditLog,
    };
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export async function handleStats(deps: StatsDeps, req: StatsRequest, ctx: { grant?: { perms: string[] } } = {}): Promise<StatsOverview> {
    if (!ctx.grant || !Array.isArray(ctx.grant.perms) || !ctx.grant.perms.includes(STATS_PERMISSION)) throw new BridgeError('forbidden');
    // Solo administradores: el nivel lo decide la instancia para el usuario firmado, nunca el cuerpo.
    const level = await deps.levelOf(req.userId);
    if (!(level >= STATS_MIN_LEVEL)) throw new BridgeError('forbidden');

    const quota = await deps.rateLimit(`internal-stats-ext:${req.extensionId}`, STATS_QUOTA_PER_MINUTE, 60_000);
    if (!quota.ok) throw new BridgeError('rate_limited', quota.retryAfter);

    const days = req.args.days;
    const now = (deps.now ?? (() => new Date()))();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const since = new Date(today - (days - 1) * 86_400_000);

    const [users, rows] = await Promise.all([deps.userCounts(), deps.mailByDay(since)]);
    const byDate = new Map(rows.map((r) => [r.date, r]));
    const series: MailDayRow[] = [];
    for (let i = days - 1; i >= 0; i--) {
        const date = isoDay(new Date(today - i * 86_400_000));
        const r = byDate.get(date);
        series.push({ date, received: r?.received ?? 0, sent: r?.sent ?? 0, spamBlocked: r?.spamBlocked ?? 0 });
    }
    const totals = series.reduce((t, d) => ({ received: t.received + d.received, sent: t.sent + d.sent, spamBlocked: t.spamBlocked + d.spamBlocked }), { received: 0, sent: 0, spamBlocked: 0 });

    deps.audit('extension.stats.read', { userId: req.userId, extensionId: req.extensionId, op: req.op, days });
    return {
        users: { total: users.total, new7d: users.new7d, active30d: users.active30d },
        mail: { days: series, totals },
        generatedAt: now.toISOString(),
    };
}
