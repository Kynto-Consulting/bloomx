import { prisma } from './prisma';
import { auditLog } from './audit';
import { deleteManyFromStorage, deleteStoragePrefix, listStorageObjects } from './storage';
import { inboundEmailPrefix } from './attachment-keys';
import { purgeExpiredRevocations } from './session-revocation';

// Retencion y borrado completo (ISO 27001:2022 A.8.10 eliminacion de informacion, NIST 800-53 SI-12 / MP-6,
// CIS v8 3.4 / 3.5, GDPR art. 5(1)(e)).
//
// IMPORTANTE (reference counting): en un correo entrante con varios destinatarios TODAS las filas Email comparten
// las mismas claves de almacenamiento (emails/<fecha>/<uuid>/...). Un objeto solo se borra cuando ninguna otra
// fila Email/Attachment lo referencia; igual con el barrido del "directorio".

export interface DeleteEmailsResult {
    deleted: number;
    storageDeleted: number;
    storageFailed: string[];
    storageKept: number;
}

/**
 * Borra correos por id: HTML, texto, raw.json y TODOS los adjuntos del almacenamiento (si nadie mas los usa),
 * barre el prefijo del correo (adjuntos huerfanos/renombrados) y elimina las filas (Attachment/EmailEvent en cascada).
 * El llamador es responsable de comprobar la propiedad de los ids.
 */
export async function deleteEmailsCompletely(emailIds: string[]): Promise<DeleteEmailsResult> {
    const ids = Array.from(new Set(emailIds.filter(Boolean)));
    const result: DeleteEmailsResult = { deleted: 0, storageDeleted: 0, storageFailed: [], storageKept: 0 };
    if (ids.length === 0) return result;

    const emails = await prisma.email.findMany({
        where: { id: { in: ids } },
        select: { id: true, htmlKey: true, textKey: true, rawKey: true, attachments: { select: { key: true } } },
    });
    if (emails.length === 0) return result;
    const targetIds = emails.map((e) => e.id);

    const candidates = new Set<string>();
    for (const e of emails) {
        for (const k of [e.htmlKey, e.textKey, e.rawKey]) if (k) candidates.add(k);
        for (const a of e.attachments) if (a.key && a.key !== 'PENDING') candidates.add(a.key);
    }
    const keys = Array.from(candidates);

    // Claves aun referenciadas por OTRAS filas
    const referenced = new Set<string>();
    if (keys.length > 0) {
        const [otherEmails, otherAtts] = await Promise.all([
            prisma.email.findMany({
                where: { id: { notIn: targetIds }, OR: [{ htmlKey: { in: keys } }, { textKey: { in: keys } }, { rawKey: { in: keys } }] },
                select: { htmlKey: true, textKey: true, rawKey: true },
            }),
            prisma.attachment.findMany({
                where: { key: { in: keys }, OR: [{ emailId: null }, { emailId: { notIn: targetIds } }] },
                select: { key: true },
            }),
        ]);
        for (const o of otherEmails) for (const k of [o.htmlKey, o.textKey, o.rawKey]) if (k) referenced.add(k);
        for (const a of otherAtts) referenced.add(a.key);
    }

    const toDelete = keys.filter((k) => !referenced.has(k));
    result.storageKept = keys.length - toDelete.length;
    if (toDelete.length > 0) {
        const r = await deleteManyFromStorage(toDelete);
        result.storageDeleted += r.deleted;
        result.storageFailed.push(...r.failed);
    }

    // Barrido de prefijo (solo si ninguna otra fila cuelga de el)
    const prefixes = new Set<string>();
    for (const k of keys) {
        const p = inboundEmailPrefix(k);
        if (p) prefixes.add(p);
    }
    for (const prefix of prefixes) {
        const startsWith = `${prefix}/`;
        const [otherEmail, otherAtt] = await Promise.all([
            prisma.email.findFirst({
                where: { id: { notIn: targetIds }, OR: [{ htmlKey: { startsWith } }, { textKey: { startsWith } }, { rawKey: { startsWith } }] },
                select: { id: true },
            }),
            prisma.attachment.findFirst({
                where: { key: { startsWith }, OR: [{ emailId: null }, { emailId: { notIn: targetIds } }] },
                select: { id: true },
            }),
        ]);
        if (otherEmail || otherAtt) continue;
        try {
            const r = await deleteStoragePrefix(prefix);
            result.storageDeleted += r.deleted;
            result.storageFailed.push(...r.failed);
        } catch (e: any) {
            console.error('[retention] prefix sweep failed:', e?.message || 'unknown');
        }
    }

    const del = await prisma.email.deleteMany({ where: { id: { in: targetIds } } });
    result.deleted = del.count;

    if (result.storageFailed.length > 0) {
        // Queda constancia para limpieza manual/posterior (sin volcar las claves completas al log)
        auditLog('retention.storage_delete_failed', { count: result.storageFailed.length, sample: result.storageFailed[0]?.split('/').slice(0, 3).join('/') });
    }
    return result;
}

// ---------------------------------------------------------------------------
// Job de retencion configurable (todo apagado o acotado por defecto; tamano de lote limitado)
// ---------------------------------------------------------------------------
export interface RetentionConfig {
    spamDays: number;        // RETENTION_SPAM_DAYS         (30; 0 = desactivado)  correos en spam
    trashDays: number;       // RETENTION_TRASH_DAYS        (0 = desactivado)      correos en papelera (por createdAt: no hay fecha de "movido")
    rawDays: number;         // RETENTION_RAW_DAYS          (0 = desactivado)      solo el raw.json (payload del webhook)
    auditDays: number;       // AUDIT_RETENTION_DAYS        (365; 0 = no purgar)
    secureMessageDays: number; // SECURE_MESSAGE_TTL_DAYS   (30) + gracia 1 dia
    batch: number;           // RETENTION_BATCH             (200) correos por ejecucion y regla
}

function intEnv(name: string, def: number): number {
    const n = Number.parseInt(String(process.env[name] ?? ''), 10);
    return Number.isFinite(n) && n >= 0 ? n : def;
}

export function getRetentionConfig(): RetentionConfig {
    return {
        spamDays: intEnv('RETENTION_SPAM_DAYS', 30),
        trashDays: intEnv('RETENTION_TRASH_DAYS', 0),
        rawDays: intEnv('RETENTION_RAW_DAYS', 0),
        auditDays: intEnv('AUDIT_RETENTION_DAYS', 365),
        secureMessageDays: intEnv('SECURE_MESSAGE_TTL_DAYS', 30),
        batch: Math.max(1, Math.min(intEnv('RETENTION_BATCH', 200), 1000)),
    };
}

export interface RetentionReport {
    dryRun: boolean;
    spamEmails: number;
    trashEmails: number;
    rawPayloads: number;
    secureMessages: number;
    auditEventsPurged: number;
    revocationsPurged: number;
    storageFailed: number;
}

const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 3600 * 1000);

export async function runRetention(opts: { dryRun?: boolean } = {}): Promise<RetentionReport> {
    const cfg = getRetentionConfig();
    const dryRun = !!opts.dryRun;
    const report: RetentionReport = {
        dryRun, spamEmails: 0, trashEmails: 0, rawPayloads: 0, secureMessages: 0, auditEventsPurged: 0, revocationsPurged: 0, storageFailed: 0,
    };

    const purgeFolder = async (folder: string, days: number): Promise<number> => {
        if (days <= 0) return 0;
        const old = await prisma.email.findMany({
            where: { folder, createdAt: { lt: daysAgo(days) } },
            select: { id: true },
            orderBy: { createdAt: 'asc' },
            take: cfg.batch,
        });
        if (dryRun || old.length === 0) return old.length;
        const r = await deleteEmailsCompletely(old.map((e) => e.id));
        report.storageFailed += r.storageFailed.length;
        return r.deleted;
    };
    report.spamEmails = await purgeFolder('spam', cfg.spamDays);
    report.trashEmails = await purgeFolder('trash', cfg.trashDays);

    // raw.json antiguo (contiene cabeceras y metadatos completos del remitente)
    if (cfg.rawDays > 0) {
        const withRaw = await prisma.email.findMany({
            where: { rawKey: { not: null }, createdAt: { lt: daysAgo(cfg.rawDays) }, attachmentsChecked: true },
            select: { id: true, rawKey: true },
            take: cfg.batch,
        });
        const keys = Array.from(new Set(withRaw.map((e) => e.rawKey!).filter(Boolean)));
        report.rawPayloads = keys.length;
        if (!dryRun && keys.length > 0) {
            // Solo si ningun correo pendiente de reprocesar la necesita; se conserva la clave en BD (los lectores toleran null al fallar la lectura)
            const r = await deleteManyFromStorage(keys);
            report.storageFailed += r.failed.length;
        }
    }

    // Mensajes seguros caducados (el objeto lleva su expiresAt cifrado; se usa la fecha de subida + TTL + 1 dia de gracia)
    if (cfg.secureMessageDays > 0) {
        try {
            const cutoff = daysAgo(cfg.secureMessageDays + 1).getTime();
            const objs = (await listStorageObjects('secure/', 5000)).filter((o) => o.lastModified && o.lastModified.getTime() < cutoff);
            report.secureMessages = objs.length;
            if (!dryRun && objs.length > 0) {
                const r = await deleteManyFromStorage(objs.map((o) => o.key));
                report.storageFailed += r.failed.length;
            }
        } catch (e: any) {
            console.error('[retention] secure message sweep failed:', e?.message || 'unknown');
        }
    }

    // Auditoria y revocaciones caducadas (tolerante a tablas ausentes)
    if (cfg.auditDays > 0) {
        try {
            const cutoff = daysAgo(cfg.auditDays);
            report.auditEventsPurged = dryRun
                ? Number((await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM "AuditEvent" WHERE "ts" < ${cutoff}`)?.[0]?.n ?? 0)
                : Number(await prisma.$executeRaw`DELETE FROM "AuditEvent" WHERE "ts" < ${cutoff}`);
        } catch (e: any) {
            if (!/does not exist|42P01/i.test(String(e?.message))) console.error('[retention] audit purge failed:', e?.message || 'unknown');
        }
    }
    if (!dryRun) report.revocationsPurged = await purgeExpiredRevocations().catch(() => 0);

    auditLog('retention.run', { ...report });
    return report;
}
