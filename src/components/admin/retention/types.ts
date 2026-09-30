export const RETENTION_KEYS = ['spamDays', 'trashDays', 'rawDays', 'auditDays', 'secureMessageDays', 'batch'] as const;
export type RetentionKey = (typeof RETENTION_KEYS)[number];
export type RetentionValues = Record<RetentionKey, number>;

export interface RetentionLimit { min: number; max: number; zeroOrMin?: number }

export interface SettingsResponse {
    effective: RetentionValues;
    env: RetentionValues;
    overrides: Partial<RetentionValues>;
    updatedAt: string | null;
    updatedBy: string | null;
    limits?: Record<RetentionKey, RetentionLimit>;
}

/** GET/PUT /api/admin/retention/quota */
export interface QuotaSettingsResponse {
    /** Valor guardado desde la consola (null = no hay: manda el entorno). */
    mailQuotaMb: number | null;
    enforceMailQuota: boolean;
    envMailQuotaMb: number | null;
    /** Limite efectivo del dominio en MB (null = sin limite). */
    effectiveMb: number | null;
    source: 'console' | 'env' | 'none';
    updatedAt: string | null;
    updatedBy: string | null;
    maxMb: number;
}

export interface RetentionReportView {
    dryRun: boolean;
    spamEmails: number;
    trashEmails: number;
    rawPayloads: number;
    secureMessages: number;
    auditEventsPurged: number;
    revocationsPurged: number;
    extensionNotificationsPurged: number;
    storageFailed: number;
    sessionRowsPurged?: number;
}

export interface StorageResponse {
    attachments: { count: number; bytes: number } | null;
    emailsByFolder: Array<{ folder: string; count: number }> | null;
    topUsers: Array<{ userId: string; email: string; bytes: number; attachments: number }> | null;
    tables: { userSessions: number | null; auditEvents: number | null; oldestAuditAt: string | null; revokedSessions: number | null };
    policy: RetentionValues;
    wouldDelete: RetentionReportView | null;
}

export const DEFAULT_LIMITS: Record<RetentionKey, RetentionLimit> = {
    spamDays: { min: 0, max: 3650 },
    trashDays: { min: 0, max: 3650 },
    rawDays: { min: 0, max: 3650 },
    auditDays: { min: 0, max: 3650, zeroOrMin: 30 },
    secureMessageDays: { min: 0, max: 3650 },
    batch: { min: 1, max: 1000 },
};

/** Elementos que borraria un informe (las revocaciones y notificaciones no se cuentan en simulacion). */
export function totalToDelete(r: RetentionReportView): number {
    return r.spamEmails + r.trashEmails + r.rawPayloads + r.secureMessages + r.auditEventsPurged + (r.sessionRowsPurged ?? 0)
        + (r.dryRun ? 0 : r.revocationsPurged + r.extensionNotificationsPurged);
}
