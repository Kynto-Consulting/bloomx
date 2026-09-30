/**
 * elixir-worker-runtime.ts — cableado del worker de Elixir con Prisma/Resend reales (servidor).
 * La logica esta en elixir-worker.ts (probada con dobles); aqui solo se inyectan las dependencias.
 */
import { prisma } from '@/lib/prisma';
import { createResendSender } from '@/lib/elixir-send';
import { buildAbsoluteUnsubscribeUrl, buildUnsubscribeHeaders, getSuppressedRecipients } from '@/lib/unsubscribe';
import { runCampaignTick, type TickResult, type WorkerDeps, type WorkerLimits, type WorkerUser } from '@/lib/elixir-worker';
import { pgCampaignStore } from '@/lib/elixir-campaign-store';

export async function loadWorkerUser(userId: string): Promise<WorkerUser | null> {
    const u = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, accounts: { select: { providerAccountId: true } } },
    });
    if (!u) return null;
    return {
        id: u.id, email: u.email, name: u.name,
        allowedEmails: new Set<string>([
            u.email.toLowerCase(),
            ...u.accounts.map(a => String(a.providerAccountId || '').trim().toLowerCase()).filter(e => e.includes('@')),
        ]),
    };
}

export function realDeps(): WorkerDeps {
    return {
        store: pgCampaignStore,
        loadUser: loadWorkerUser,
        getSuppressed: getSuppressedRecipients,
        send: createResendSender(process.env.RESEND_API_KEY),
        unsubscribeUrl: buildAbsoluteUnsubscribeUrl,
        unsubscribeHeaders: buildUnsubscribeHeaders,
    };
}

export async function tickCampaign(campaignId: string, limits: Partial<WorkerLimits> = {}): Promise<TickResult> {
    return runCampaignTick(realDeps(), campaignId, limits);
}

/**
 * Encadena otra invocacion del worker (fire-and-forget) para no depender de la frecuencia del cron.
 * Autenticada con CRON_SECRET; `hop` acota la cadena. Sin CRON_SECRET o URL publica no hace nada
 * (el cron programado seguira el trabajo).
 */
export async function chainNextTick(campaignId: string, hop: number): Promise<boolean> {
    const secret = process.env.CRON_SECRET;
    const base = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
    if (!secret || !/^https?:\/\//.test(base) || hop >= MAX_CHAIN_HOPS) return false;
    try {
        await fetch(`${base}/api/cron/elixir?campaign=${encodeURIComponent(campaignId)}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${secret}`, 'x-elixir-hop': String(hop + 1) },
            signal: AbortSignal.timeout(5_000),
        }).catch(() => undefined); // el destino sigue ejecutandose aunque este fetch expire
        return true;
    } catch { return false; }
}

export const MAX_CHAIN_HOPS = 400;
