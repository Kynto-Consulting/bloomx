import { adminEmails } from '@/lib/mfa';
import { num, query, tolerant, toIso } from './sql';

/**
 * Metricas del Resumen de la consola. SOLO agregados y metadatos de cuenta (nunca contenido de correos).
 * Cada bloque es independiente y tolerante a tablas ausentes: si falta una, ese bloque degrada a ceros / `available:false`.
 */

export interface OverviewData {
    users: { total: number; active30d: number; disabled: number; new7d: number; recent: Array<{ id: string; name: string | null; email: string; createdAt: string | null }> };
    mail: { sent24h: number; received24h: number; bounces7d: number; complaints7d: number; scheduledPending: number };
    elixir: { available: boolean; running: number; pendingRows: number };
    storage: { attachmentBytes: number; attachmentCount: number; emailCount: number };
    extensions: { errors24h: number };
    adminMfa: { total: number; withMfa: number; missing: string[]; available: boolean };
    generatedAt: string;
}

const one = async <T extends Record<string, unknown>>(sql: string, ...p: unknown[]): Promise<T | undefined> => (await query<T>(sql, ...p))[0];

export async function getOverview(): Promise<OverviewData> {
    const [users, recent, mail, elixir, storage, extErrors, adminMfa] = await Promise.all([
        tolerant(async () => {
            const r = await one<{ total: bigint; new7d: bigint }>(
                `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '7 days') AS new7d FROM "User"`,
            );
            return { total: num(r?.total), new7d: num(r?.new7d) };
        }, { total: 0, new7d: 0 }),
        tolerant(
            () => query<{ id: string; name: string | null; email: string; createdAt: Date }>(
                `SELECT "id", "name", "email", "createdAt" FROM "User" ORDER BY "createdAt" DESC LIMIT 5`,
            ),
            [],
        ),
        tolerant(async () => {
            const r = await one<{ sent: bigint; received: bigint; scheduled: bigint }>(
                `SELECT COUNT(*) FILTER (WHERE "folder" = 'sent' AND "createdAt" >= NOW() - INTERVAL '24 hours') AS sent,
                        COUNT(*) FILTER (WHERE "status" = 'received' AND "createdAt" >= NOW() - INTERVAL '24 hours') AS received,
                        COUNT(*) FILTER (WHERE "folder" = 'scheduled') AS scheduled
                 FROM "Email"`,
            );
            const ev = await tolerant(
                () => one<{ bounces: bigint; complaints: bigint }>(
                    `SELECT COUNT(*) FILTER (WHERE "data"->>'reason' = 'bounce') AS bounces,
                            COUNT(*) FILTER (WHERE "data"->>'reason' = 'complaint') AS complaints
                     FROM "EmailEvent" WHERE "type" = 'unsubscribe' AND "createdAt" >= NOW() - INTERVAL '7 days'`,
                ),
                undefined,
            );
            return { sent24h: num(r?.sent), received24h: num(r?.received), scheduledPending: num(r?.scheduled), bounces7d: num(ev?.bounces), complaints7d: num(ev?.complaints) };
        }, { sent24h: 0, received24h: 0, scheduledPending: 0, bounces7d: 0, complaints7d: 0 }),
        tolerant(async () => {
            const r = await one<{ running: bigint; pending: bigint }>(
                `SELECT (SELECT COUNT(*) FROM "ElixirCampaign" WHERE "status" = 'running') AS running,
                        (SELECT COUNT(*) FROM "ElixirCampaignRow" WHERE "status" = 'pending') AS pending`,
            );
            return { available: true, running: num(r?.running), pendingRows: num(r?.pending) };
        }, { available: false, running: 0, pendingRows: 0 }),
        tolerant(async () => {
            const r = await one<{ bytes: bigint | null; n: bigint; emails: bigint }>(
                `SELECT COALESCE((SELECT SUM("size") FROM "Attachment"), 0) AS bytes, (SELECT COUNT(*) FROM "Attachment") AS n, (SELECT COUNT(*) FROM "Email") AS emails`,
            );
            return { attachmentBytes: num(r?.bytes), attachmentCount: num(r?.n), emailCount: num(r?.emails) };
        }, { attachmentBytes: 0, attachmentCount: 0, emailCount: 0 }),
        // Extensiones con errores: eventos de auditoria de extension con fallo en las ultimas 24 h (distintas extensiones).
        tolerant(async () => {
            const r = await one<{ n: bigint }>(
                `SELECT COUNT(DISTINCT "data"->>'extensionId') AS n FROM "AuditEvent"
                 WHERE "ts" >= NOW() - INTERVAL '24 hours' AND "data"->>'extensionId' IS NOT NULL
                   AND ("event" LIKE '%extension%') AND ("data"->>'outcome' = 'failed' OR "event" LIKE '%error%' OR "event" LIKE '%failed%')`,
            );
            return { errors24h: num(r?.n) };
        }, { errors24h: 0 }),
        (async () => {
            const emails = adminEmails();
            if (emails.length === 0) return { total: 0, withMfa: 0, missing: [] as string[], available: true };
            return tolerant(async () => {
                const rows = await query<{ email: string; enabled: boolean | null }>(
                    `SELECT u."email", m."enabled" FROM "User" u LEFT JOIN "UserMfa" m ON m."userId" = u."id" WHERE LOWER(u."email") = ANY($1::text[])`,
                    emails,
                );
                const withMfa = rows.filter((r) => r.enabled).length;
                return { total: rows.length, withMfa, missing: rows.filter((r) => !r.enabled).map((r) => r.email), available: true };
            }, { total: emails.length, withMfa: 0, missing: [] as string[], available: false });
        })(),
    ]);

    const active = await tolerant(async () => {
        const r = await one<{ active: bigint; disabled: bigint }>(
            `SELECT COUNT(*) FILTER (WHERE "lastLoginAt" >= NOW() - INTERVAL '30 days') AS active, COUNT(*) FILTER (WHERE "disabled") AS disabled FROM "UserAdminState"`,
        );
        return { active30d: num(r?.active), disabled: num(r?.disabled) };
    }, { active30d: 0, disabled: 0 });

    return {
        users: { ...users, ...active, recent: recent.map((r) => ({ ...r, createdAt: toIso(r.createdAt) })) },
        mail,
        elixir,
        storage,
        extensions: extErrors,
        adminMfa,
        generatedAt: new Date().toISOString(),
    };
}
