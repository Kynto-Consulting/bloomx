/**
 * runtime.ts - cableado del worker con las dependencias reales (Prisma, storage, PST, avisos) y encadenamiento.
 * La logica esta en import-engine.ts / export-engine.ts (probada con dobles y con Postgres embebido).
 */
import { deriveInternalKey } from '@/lib/internal-auth';
import { defaultEngineDeps, runImportTick, type EngineDeps, type TickResult } from './import-engine';
import { runExportTick } from './export-engine';
import { makePstConverter } from './pst';
import { jobs, type JobRow } from './store';
import { transferLimits } from './limits';
import { createRawMimeFetcher } from '@/lib/raw-mime';

export const MAX_CHAIN_HOPS = 2000;

async function notifyOwners(job: JobRow, emails: string[]): Promise<void> {
    const topDomain = process.env.TOP_DOMAIN;
    if (!topDomain || !process.env.RESEND_API_KEY || emails.length === 0) return;
    const { resend } = await import('@/lib/resend');
    const verb = job.kind === 'import' ? 'importado correo en' : 'exportado';
    for (const to of emails.slice(0, 500)) {
        try {
            await resend.emails.send({
                from: `noreply@${topDomain}`,
                to,
                subject: job.kind === 'import' ? 'Se ha importado correo en tu buzon' : 'Se ha exportado tu buzon',
                text: `El administrador de ${topDomain} ha ${verb} tu buzon (${to}). Si no lo esperabas, contacta con el administrador.\n\nAn administrator of ${topDomain} has ${job.kind === 'import' ? 'imported mail into' : 'exported'} your mailbox. If you did not expect this, contact the administrator.`,
                headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
            });
        } catch { /* aviso opcional: nunca rompe el trabajo */ }
    }
}

export function realEngineDeps(over: Partial<EngineDeps> = {}): EngineDeps {
    const limits = transferLimits();
    return defaultEngineDeps({ limits, pstConvert: makePstConverter(limits), notify: notifyOwners, fetchRaw: createRawMimeFetcher(), ...over });
}

/** Ejecuta un tick del trabajo (importacion o exportacion). */
export async function runTick(jobId: string, deps: EngineDeps = realEngineDeps()): Promise<TickResult> {
    const job = await jobs.get(jobId);
    if (!job) return { ran: false, more: false, reason: 'not_found', processed: 0 };
    return job.kind === 'export' ? runExportTick(jobId, deps) : runImportTick(jobId, deps);
}

/**
 * Encadena otra invocacion del worker (fire-and-forget), autenticada con CRON_SECRET o la clave interna derivada.
 * Sin URL publica no hace nada: lo seguira el cron programado o el empuje desde el navegador.
 */
export async function chainNextTick(jobId: string, hop: number): Promise<boolean> {
    const secret = process.env.CRON_SECRET || deriveInternalKey();
    const base = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
    if (!secret || !/^https?:\/\//.test(base) || hop >= MAX_CHAIN_HOPS) return false;
    try {
        await fetch(`${base}/api/cron/mail-transfer?job=${encodeURIComponent(jobId)}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${secret}`, 'x-mt-hop': String(hop + 1) },
            signal: AbortSignal.timeout(5_000),
        }).catch(() => undefined);
        return true;
    } catch {
        return false;
    }
}

/** Purga del almacenamiento de trabajos caducados o abandonados (llamada desde la retencion y el cron). */
export async function purgeExpiredMailTransfers(deps: Pick<EngineDeps, 'storage'> = realEngineDeps()): Promise<{ jobs: number; objects: number }> {
    const { purgeJobStorage } = await import('./import-engine');
    const expired = await jobs.expiredForPurge(50);
    let objects = 0;
    for (const j of expired) {
        objects += await purgeJobStorage(j.id, deps).catch(() => 0);
        // Sin material de cifrado residual; solo los trabajos sin terminar (o exportaciones caducadas) pasan a "expired"
        const { stripSecrets } = await import('./export-engine');
        const becomesExpired = j.kind === 'export' ? j.status === 'done' : ['created', 'uploading', 'uploaded', 'ready'].includes(j.status);
        await jobs.update(j.id, { ...(becomesExpired ? { status: 'expired' } : {}), options: stripSecrets(j.options) }).catch(() => undefined);
    }
    return { jobs: expired.length, objects };
}
