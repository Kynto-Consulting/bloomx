import { loadDomainPrivateKey } from '@/lib/backend-auth';
import { getSessionAbsoluteMaxSeconds, getSessionTtlSeconds } from '@/lib/jwt';
import { adminEmails } from '@/lib/mfa';
import { maskIp, sanitizeAuditData } from './audit-store';
import { isMissingRelation, num, query, tolerant, toIso } from './sql';

/**
 * Estado de seguridad de la instancia para /admin/security.
 * REGLA: la respuesta nunca contiene valores de secretos (ni parciales ni longitudes): solo booleanos y conteos.
 * Cada comprobacion lleva un `code` estable (la UI lo traduce y da la recomendacion) y un estado ok|warn|fail|info.
 */

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'info';
export type CheckGroup = 'admins' | 'session' | 'config' | 'events';

export interface SecurityCheck {
    id: string;
    group: CheckGroup;
    status: CheckStatus;
    /** Clave estable, p. ej. `mfa.admins_missing`. */
    code: string;
    params?: Record<string, number>;
}

export interface AdminMfaRow { email: string; userId: string | null; mfaEnabled: boolean | null }

export const SECURITY_EVENTS = [
    'auth.login.failure',
    'auth.login.locked',
    'auth.login.rate_limited',
    'admin.access_denied',
    'auth.mfa.verify_failed',
    'auth.mfa.recovery_used',
] as const;

export interface SecurityEventRow { id: string; ts: string | null; event: string; userId: string | null; ip: string | null; reason: string | null }

export interface SecurityStatus {
    generatedAt: string;
    checks: SecurityCheck[];
    admins: AdminMfaRow[];
    mfaPolicy: { enforceAdmin: boolean; requiredAll: boolean; available: boolean };
    session: { ttlSeconds: number; absoluteMaxSeconds: number };
    config: {
        nextauthSecret: boolean;
        dataEncryptionKey: boolean;
        webhookSecret: boolean;
        resendWebhookSecret: boolean;
        internalSecret: boolean;
        cronSecret: boolean;
        adminEmails: boolean;
        rateLimitBackend: 'redis' | 'memory';
        domainSigning: boolean;
    };
    events: {
        available: boolean;
        last24h: Record<string, number>;
        last7d: Record<string, number>;
        recent: SecurityEventRow[];
    };
    counts: { disabledUsers: number | null; mustChangePassword: number | null; activeSessions: number | null };
}

const has = (name: string) => !!String(process.env[name] ?? '').trim();

// Misma definicion de "sesion activa" que el registro de sesiones (session-registry.ts).
const ACTIVE_SESSIONS_SQL = `SELECT COUNT(*) AS n FROM "UserSession" s
    WHERE s."expiresAt" > NOW()
      AND NOT EXISTS (SELECT 1 FROM "RevokedSession" r WHERE r."jti" = s."jti")
      AND s."tv" >= COALESCE((SELECT u."tokenVersion" FROM "User" u WHERE u."id" = s."userId"), 0)`;

async function loadAdmins(emails: string[]): Promise<{ rows: AdminMfaRow[]; mfaAvailable: boolean }> {
    if (emails.length === 0) return { rows: [], mfaAvailable: true };
    let mfaAvailable = true;
    let found: Array<{ id: string; email: string; enabled: boolean | null }>;
    try {
        found = await query(
            `SELECT u."id", u."email", m."enabled" FROM "User" u LEFT JOIN "UserMfa" m ON m."userId" = u."id" WHERE LOWER(u."email") = ANY($1::text[])`,
            emails,
        );
    } catch (error) {
        if (!isMissingRelation(error)) throw error;
        mfaAvailable = false;
        found = await tolerant(
            async () => (await query<{ id: string; email: string }>(`SELECT u."id", u."email" FROM "User" u WHERE LOWER(u."email") = ANY($1::text[])`, emails)).map((r) => ({ ...r, enabled: null })),
            [],
        );
    }
    const byEmail = new Map(found.map((r) => [String(r.email).toLowerCase(), r]));
    const rows = emails.map((email) => {
        const r = byEmail.get(email);
        return { email, userId: r ? String(r.id) : null, mfaEnabled: r ? (mfaAvailable ? !!r.enabled : null) : null };
    });
    return { rows, mfaAvailable };
}

async function loadEvents(): Promise<SecurityStatus['events']> {
    const events: string[] = [...SECURITY_EVENTS];
    const empty = { available: false, last24h: {}, last7d: {}, recent: [] as SecurityEventRow[] };
    return tolerant(async () => {
        const counts = await query<{ event: string; h24: bigint; d7: bigint }>(
            `SELECT "event", COUNT(*) FILTER (WHERE "ts" > NOW() - INTERVAL '24 hours') AS h24, COUNT(*) AS d7
             FROM "AuditEvent" WHERE "event" = ANY($1::text[]) AND "ts" > NOW() - INTERVAL '7 days' GROUP BY "event"`,
            events,
        );
        const recent = await query<{ id: string; ts: Date; event: string; userId: string | null; ip: string | null; data: unknown }>(
            `SELECT "id", "ts", "event", "userId", "ip", "data" FROM "AuditEvent"
             WHERE "event" = ANY($1::text[]) AND "ts" > NOW() - INTERVAL '7 days' ORDER BY "ts" DESC, "id" DESC LIMIT 10`,
            events,
        );
        const last24h: Record<string, number> = {};
        const last7d: Record<string, number> = {};
        for (const e of events) { last24h[e] = 0; last7d[e] = 0; }
        for (const c of counts) { last24h[c.event] = num(c.h24); last7d[c.event] = num(c.d7); }
        return {
            available: true,
            last24h,
            last7d,
            recent: recent.map((r) => {
                const reason = sanitizeAuditData(r.data).reason;
                return {
                    id: String(r.id),
                    ts: toIso(r.ts),
                    event: String(r.event),
                    userId: r.userId ? String(r.userId).slice(0, 200) : null,
                    ip: maskIp(r.ip),
                    reason: typeof reason === 'string' ? reason.slice(0, 60) : null,
                };
            }),
        };
    }, empty);
}

const countWhere = (sql: string) => tolerant(async () => num((await query<{ n: bigint }>(sql))[0]?.n), null as number | null);

export async function getSecurityStatus(): Promise<SecurityStatus> {
    const admins = adminEmails();
    const enforceAdmin = process.env.MFA_ENFORCE_ADMIN !== 'false';
    const requiredAll = process.env.MFA_REQUIRED_ALL === 'true';
    const ttlSeconds = getSessionTtlSeconds();
    const absoluteMaxSeconds = getSessionAbsoluteMaxSeconds();

    const [{ rows, mfaAvailable }, events, disabledUsers, mustChangePassword, activeSessions] = await Promise.all([
        loadAdmins(admins),
        loadEvents(),
        countWhere(`SELECT COUNT(*) AS n FROM "UserAdminState" WHERE "disabled" = TRUE`),
        countWhere(`SELECT COUNT(*) AS n FROM "UserAdminState" WHERE "mustChangePassword" = TRUE`),
        countWhere(ACTIVE_SESSIONS_SQL),
    ]);

    const config: SecurityStatus['config'] = {
        nextauthSecret: has('NEXTAUTH_SECRET'),
        dataEncryptionKey: has('DATA_ENCRYPTION_KEY'),
        webhookSecret: has('WEBHOOK_SECRET'),
        resendWebhookSecret: has('RESEND_WEBHOOK_SECRET'),
        internalSecret: has('INTERNAL_SECRET'),
        cronSecret: has('CRON_SECRET'),
        adminEmails: admins.length > 0,
        rateLimitBackend: has('UPSTASH_REDIS_REST_URL') && has('UPSTASH_REDIS_REST_TOKEN') ? 'redis' : 'memory',
        domainSigning: loadDomainPrivateKey() !== null,
    };

    const checks: SecurityCheck[] = [];
    const add = (group: CheckGroup, id: string, status: CheckStatus, code: string, params?: Record<string, number>) =>
        checks.push({ id, group, status, code, ...(params ? { params } : {}) });

    // 1. Administradores y MFA
    add('admins', 'admin_emails', config.adminEmails ? 'ok' : 'warn', config.adminEmails ? 'admins.configured' : 'admins.none_configured', { count: admins.length });
    add('admins', 'mfa_policy', requiredAll ? 'ok' : enforceAdmin ? 'ok' : 'fail', requiredAll ? 'mfa.required_all' : enforceAdmin ? 'mfa.admin_enforced' : 'mfa.admin_not_enforced');
    if (admins.length > 0) {
        if (!mfaAvailable) add('admins', 'mfa_enrolled', 'info', 'mfa.unavailable');
        else {
            const withUser = rows.filter((r) => r.userId);
            const missing = withUser.filter((r) => !r.mfaEnabled).length;
            const noAccount = rows.length - withUser.length;
            if (missing > 0) add('admins', 'mfa_enrolled', 'warn', 'mfa.admins_missing', { count: missing });
            else if (withUser.length > 0) add('admins', 'mfa_enrolled', 'ok', 'mfa.admins_enrolled', { count: withUser.length });
            if (noAccount > 0) add('admins', 'admins_no_account', 'info', 'admins.no_account', { count: noAccount });
        }
    }

    // 2. Sesiones
    const longSessions = ttlSeconds > 7 * 86400 || absoluteMaxSeconds > 30 * 86400;
    add('session', 'session_limits', longSessions ? 'warn' : 'ok', longSessions ? 'session.limits_long' : 'session.limits_ok', {
        ttlHours: Math.round(ttlSeconds / 3600), absoluteDays: Math.round(absoluteMaxSeconds / 86400),
    });

    // 3. Configuracion (solo presencia)
    add('config', 'nextauth_secret', !config.nextauthSecret ? 'fail' : String(process.env.NEXTAUTH_SECRET).length < 32 ? 'warn' : 'ok',
        !config.nextauthSecret ? 'config.nextauth_secret_missing' : String(process.env.NEXTAUTH_SECRET).length < 32 ? 'config.nextauth_secret_short' : 'config.nextauth_secret_ok');
    add('config', 'encryption_key', config.dataEncryptionKey ? 'ok' : 'warn', config.dataEncryptionKey ? 'config.encryption_key_ok' : 'config.encryption_key_missing');
    add('config', 'webhook_secret', config.webhookSecret ? 'ok' : 'info', config.webhookSecret ? 'config.webhook_secret_ok' : 'config.webhook_secret_unset');
    add('config', 'resend_webhook_secret', config.resendWebhookSecret ? 'ok' : 'info', config.resendWebhookSecret ? 'config.resend_webhook_secret_ok' : 'config.resend_webhook_secret_unset');
    add('config', 'internal_secret', config.internalSecret ? 'ok' : 'info', config.internalSecret ? 'config.internal_secret_set' : 'config.internal_secret_derived');
    add('config', 'cron_secret', config.cronSecret ? 'ok' : 'warn', config.cronSecret ? 'config.cron_secret_ok' : 'config.cron_secret_missing');
    add('config', 'rate_limit', config.rateLimitBackend === 'redis' ? 'ok' : 'warn', config.rateLimitBackend === 'redis' ? 'config.rate_limit_redis' : 'config.rate_limit_memory');
    add('config', 'domain_signing', config.domainSigning ? 'ok' : 'warn', config.domainSigning ? 'config.signing_key_present' : 'config.signing_legacy');

    // 4. Eventos de seguridad
    if (!events.available) add('events', 'events', 'info', 'events.unavailable');
    else {
        const failures = events.last24h['auth.login.failure'] ?? 0;
        const locked = events.last24h['auth.login.locked'] ?? 0;
        const denied = events.last24h['admin.access_denied'] ?? 0;
        if (failures >= 20) add('events', 'login_failures', 'warn', 'events.login_failures_high', { count: failures });
        if (locked > 0) add('events', 'login_locked', 'info', 'events.accounts_locked', { count: locked });
        if (denied >= 5) add('events', 'access_denied', 'warn', 'events.access_denied_high', { count: denied });
        if (!checks.some((c) => c.group === 'events')) add('events', 'events', 'ok', 'events.quiet');
    }

    return {
        generatedAt: new Date().toISOString(),
        checks,
        admins: rows,
        mfaPolicy: { enforceAdmin, requiredAll, available: mfaAvailable },
        session: { ttlSeconds, absoluteMaxSeconds },
        config,
        events,
        counts: { disabledUsers, mustChangePassword, activeSessions },
    };
}
