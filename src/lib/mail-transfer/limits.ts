/** Limites y ajustes por entorno de importar/exportar correo (todos con valores por defecto seguros). */
function intEnv(name: string, def: number, min = 1, max = Number.MAX_SAFE_INTEGER): number {
    const n = Number.parseInt(String(process.env[name] ?? ''), 10);
    return Number.isFinite(n) && n >= min && n <= max ? n : def;
}

export interface TransferLimits {
    /** Tamano maximo del archivo subido. */
    maxUploadBytes: number;
    /** Tamano maximo de UN mensaje importado (mayor => error `too_large`). */
    maxMessageBytes: number;
    maxAttachmentsPerMessage: number;
    /** Trabajos activos simultaneos por dominio. */
    maxConcurrentJobs: number;
    /** Presupuesto de una invocacion del worker. */
    budgetMs: number;
    lockMs: number;
    /** Mensajes por tick (tope duro). */
    maxItemsPerTick: number;
    /** PST: tamano maximo. Se lee por rangos (cache LRU de trozos de 4 MiB), sin copiarlo a disco: el tope es de tiempo, no de /tmp. */
    maxPstBytes: number;
    /** Horas hasta que caduca un paquete exportado. */
    exportTtlHours: number;
    maxMailboxesPerExport: number;
    /** Buzones nuevos que se pueden crear en una llamada (bcrypt es lento). */
    maxCreatePerCall: number;
    /** Tope de descompresion (zip-bomb) para el total del archivo. */
    maxExpandedBytes: number;
}

export function transferLimits(): TransferLimits {
    return {
        maxUploadBytes: intEnv('MAIL_TRANSFER_MAX_UPLOAD_MB', 16 * 1024) * 1024 * 1024,
        maxMessageBytes: intEnv('MAIL_TRANSFER_MAX_MESSAGE_MB', 50) * 1024 * 1024,
        maxAttachmentsPerMessage: intEnv('MAIL_TRANSFER_MAX_ATTACHMENTS', 100, 1, 500),
        maxConcurrentJobs: intEnv('MAIL_TRANSFER_MAX_CONCURRENT', 2, 1, 20),
        budgetMs: intEnv('MAIL_TRANSFER_BUDGET_MS', 45_000, 2_000, 280_000),
        lockMs: intEnv('MAIL_TRANSFER_LOCK_MS', 90_000, 5_000, 600_000),
        maxItemsPerTick: intEnv('MAIL_TRANSFER_MAX_ITEMS_PER_TICK', 2_000, 1, 50_000),
        maxPstBytes: intEnv('MAIL_TRANSFER_PST_MAX_MB', 2048) * 1024 * 1024,
        exportTtlHours: intEnv('MAIL_TRANSFER_EXPORT_TTL_HOURS', 24, 1, 168),
        maxMailboxesPerExport: intEnv('MAIL_TRANSFER_MAX_EXPORT_MAILBOXES', 2_000, 1, 20_000),
        maxCreatePerCall: intEnv('MAIL_TRANSFER_MAX_CREATE_PER_CALL', 50, 1, 200),
        maxExpandedBytes: intEnv('MAIL_TRANSFER_MAX_EXPANDED_GB', 40) * 1024 * 1024 * 1024,
    };
}

export const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
export const jobPrefix = (jobId: string) => `mailtransfer/${jobId}`;
