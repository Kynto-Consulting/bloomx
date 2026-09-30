/**
 * "Probar": evalua cabeceras + texto (pegados o de un correo propio de prueba) y devuelve la puntuacion POR SENAL, sin guardar nada
 * ni contar aciertos de lista. Lo usan la consola (admin) y las pruebas.
 */
import { getFromStorage } from '@/lib/storage';
import { prisma } from '@/lib/prisma';
import { getSpamConfig } from './config-store';
import { bandOf, decisionFor, effectiveThreshold } from './config-core';
import { evaluateSpam } from './engine';
import { DOMAIN_OWNER, getCompiledList } from './lists-store';
import { identityOf } from './lists-core';
import { engineConfigFor, internalDomainsFor, senderIdentities } from './pipeline';
import { explainSignal } from './reasons';
import { parseRawHeaders } from './raw-headers';
import { parseAddress } from './text';
import type { AttachmentInfo } from './types';

export interface ProbeInput {
    rawHeaders?: string;
    headers?: Record<string, unknown>;
    from?: string;
    subject?: string;
    text?: string;
    html?: string;
    attachments?: Array<{ filename: string }>;
}

export async function probe(input: ProbeInput) {
    const cfg = await getSpamConfig();
    const internal = internalDomainsFor(cfg);
    const headers = { ...(input.headers ?? {}), ...(input.rawHeaders ? parseRawHeaders(input.rawHeaders) : {}) } as Record<string, unknown>;
    const fromRaw = input.from || String(Array.isArray(headers.from) ? headers.from[0] : headers.from ?? '');
    const from = parseAddress(fromRaw);
    const subject = input.subject ?? String(headers.subject ?? '');
    const attachments: AttachmentInfo[] = (input.attachments ?? []).slice(0, 20).map((a) => ({ filename: String(a.filename).slice(0, 200) }));
    const result = evaluateSpam(
        { headers, from, subject: subject.slice(0, 1000), text: (input.text ?? '').slice(0, 100_000), html: (input.html ?? '').slice(0, 300_000), attachments },
        engineConfigFor(cfg, internal),
    );
    const ids = senderIdentities({ headers, from, envelopeFrom: null });
    const block = await getCompiledList('domain', DOMAIN_OWNER, 'block');
    const allow = await getCompiledList('domain', DOMAIN_OWNER, 'allow');
    const inBlock = ids.some((w) => block.match(w) !== null);
    const inAllow = from.email ? allow.match(identityOf(from.email)) !== null : false;
    const band = bandOf(result.score, cfg);
    return {
        score: result.score,
        threshold: effectiveThreshold(cfg),
        band,
        decision: inBlock ? 'blocked' : decisionFor(band, cfg).decision,
        blockedByList: inBlock,
        allowedByList: inAllow,
        authFailed: result.authFailed,
        category: result.category,
        signals: result.signals.map((s) => ({ id: s.id, family: s.family, weight: s.weight, critical: s.critical === true, params: s.params ?? null, es: explainSignal(s, 'es'), en: explainSignal(s, 'en') })),
    };
}

/** Cabeceras, asunto y cuerpos de un correo DEL PROPIO USUARIO (nunca de otro buzon) leyendo el crudo guardado. */
export async function loadOwnEmailForProbe(userId: string, emailId: string): Promise<ProbeInput | null> {
    const email = await prisma.email.findFirst({
        where: { id: emailId, userId },
        select: { from: true, subject: true, rawKey: true, textKey: true, htmlKey: true, attachments: { select: { filename: true } } },
    });
    if (!email) return null;
    const out: ProbeInput = { from: email.from, subject: email.subject ?? '', attachments: email.attachments.map((a) => ({ filename: a.filename })) };
    const readText = async (key: string | null): Promise<string> => {
        if (!key) return '';
        try {
            const obj = await getFromStorage(key);
            return typeof obj === 'string' ? obj.slice(0, 2_000_000) : '';
        } catch { return ''; }
    };
    const raw = await readText(email.rawKey);
    if (raw) {
        try {
            const j = JSON.parse(raw) as { data?: { headers?: Record<string, unknown> } };
            if (j?.data?.headers) out.headers = j.data.headers;
        } catch { /* crudo no JSON */ }
    }
    out.text = await readText(email.textKey);
    out.html = await readText(email.htmlKey);
    return out;
}
