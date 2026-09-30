import { query, tolerant, num, toIso } from '@/lib/admin/sql';
import { redactAuditData } from '@/lib/audit';

/**
 * Estado y ultimo error/log por extension, a partir de la auditoria del frontend (`AuditEvent`). El backend NO persiste
 * logs de ejecucion: solo vemos las acciones de ADMIN (instalar, desinstalar, credenciales, activar, orden, prueba).
 * Consultas SIEMPRE parametrizadas y tolerantes a que la tabla no exista. Solo se devuelven escalares resumidos
 * (evento, fecha, resultado, estado HTTP); jamas `data` completo.
 */

/** Eventos de extensiones: `admin.extension*` (consola) o `extension.*` (backend/otros). */
const EVENT_FILTER = `("event" LIKE 'admin.extension%' OR "event" LIKE 'extension.%')`;
/** Fallo: outcome=failed o el nombre del evento lo dice. */
const FAILED_FILTER = `("data"->>'outcome' = 'failed' OR "event" ~* '(error|failed)')`;

export interface ExtensionLogEntry {
    id: string;
    event: string;
    ts: string | null;
    outcome: string | null;
    status: number | null;
}

export interface ExtensionStatus {
    lastEvent: ExtensionLogEntry | null;
    lastError: ExtensionLogEntry | null;
    errors24h: number;
    entries: ExtensionLogEntry[];
}

interface Row {
    id: string;
    ts: Date | string;
    event: string;
    outcome: string | null;
    status: string | null;
}

export function summarizeEntry(row: Row): ExtensionLogEntry {
    // Reusa el enmascarado de la auditoria: si algun dia se anadieran campos, solo pasan los no sensibles.
    const safe = redactAuditData({ event: String(row.event ?? '').slice(0, 80), outcome: row.outcome ?? null, status: row.status ?? null });
    const status = Number(safe.status);
    return {
        id: String(row.id).slice(0, 80),
        event: String(safe.event ?? ''),
        ts: toIso(row.ts),
        outcome: typeof safe.outcome === 'string' ? safe.outcome.slice(0, 20) : null,
        status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    };
}

const COLUMNS = `"id", "ts", "event", "data"->>'outcome' AS "outcome", "data"->>'status' AS "status"`;

function clampHours(value: number): number {
    return Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), 1), 24 * 90) : 24;
}

export async function getExtensionStatus(extensionId: string, sinceHours = 24): Promise<ExtensionStatus> {
    const empty: ExtensionStatus = { lastEvent: null, lastError: null, errors24h: 0, entries: [] };
    const hours = clampHours(sinceHours);
    return tolerant(async () => {
        const entries = await query<Row>(
            `SELECT ${COLUMNS} FROM "AuditEvent" WHERE "data"->>'extensionId' = $1 AND ${EVENT_FILTER} ORDER BY "ts" DESC, "id" DESC LIMIT 20`,
            extensionId,
        );
        const lastError = await query<Row>(
            `SELECT ${COLUMNS} FROM "AuditEvent" WHERE "data"->>'extensionId' = $1 AND ${EVENT_FILTER} AND ${FAILED_FILTER} ORDER BY "ts" DESC, "id" DESC LIMIT 1`,
            extensionId,
        );
        const count = await query<{ n: unknown }>(
            `SELECT COUNT(*) AS n FROM "AuditEvent" WHERE "data"->>'extensionId' = $1 AND ${EVENT_FILTER} AND ${FAILED_FILTER} AND "ts" >= NOW() - make_interval(hours => $2::int)`,
            extensionId,
            hours,
        );
        const summarized = entries.map(summarizeEntry);
        return {
            lastEvent: summarized[0] ?? null,
            lastError: lastError[0] ? summarizeEntry(lastError[0]) : null,
            errors24h: num(count[0]?.n),
            entries: summarized,
        };
    }, empty);
}

/** Ids de extension con al menos un error en las ultimas `sinceHours` horas (para el filtro "con errores"). */
export async function extensionIdsWithErrors(sinceHours = 24): Promise<string[]> {
    const hours = clampHours(sinceHours);
    return tolerant(async () => {
        const rows = await query<{ id: string | null }>(
            `SELECT DISTINCT "data"->>'extensionId' AS "id" FROM "AuditEvent" WHERE ${EVENT_FILTER} AND ${FAILED_FILTER} AND "ts" >= NOW() - make_interval(hours => $1::int) AND "data"->>'extensionId' IS NOT NULL LIMIT 500`,
            hours,
        );
        return rows.map((r) => r.id).filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200);
    }, [] as string[]);
}

/** Numero de extensiones distintas con errores en las ultimas `sinceHours` horas (tarjeta del Resumen). */
export async function countExtensionsWithErrors(sinceHours = 24): Promise<number> {
    return (await extensionIdsWithErrors(sinceHours)).length;
}
