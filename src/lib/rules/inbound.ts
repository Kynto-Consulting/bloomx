/**
 * Etiquetado y reglas al recibir un correo (usado por el webhook de Resend).
 * Todo es tolerante a fallos: un error aqui nunca debe impedir guardar el correo.
 */
import { prisma } from '@/lib/prisma';
import { evaluateRules, type RuleEmail } from './engine';
import { safeRegexTest } from './regex-safety';
import { aliasSuffixFor } from './alias';
import { isMissingRelation, loadRules, plainTextFromHtml } from './store';


export interface InboundInput {
    userId: string;
    userEmail: string;
    recipients: string[];
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
    hasAttachment: boolean;
    deliveryFolder: string;
}

export interface InboundResult {
    labelIds: string[];
    read: boolean;
    starred: boolean;
    folder: string;
    appliedRuleIds: string[];
}

export async function computeInboundEffects(input: InboundInput): Promise<InboundResult> {
    const result: InboundResult = {
        labelIds: [], read: false, starred: false, folder: input.deliveryFolder, appliedRuleIds: [],
    };
    const labelIds = new Set<string>();

    // 1) Etiquetas por alias y por regex (una sola consulta por usuario).
    let userLabels: Array<{ id: string; name: string; aliasSuffix: string | null; filterRegex: string | null }> = [];
    try {
        userLabels = await prisma.label.findMany({
            where: { userId: input.userId },
            select: { id: true, name: true, aliasSuffix: true, filterRegex: true },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
        });
    } catch (e) {
        console.error('[inbound] label lookup failed:', (e as any)?.message);
    }

    const suffixes = new Set<string>();
    for (const r of input.recipients) {
        const s = aliasSuffixFor(input.userEmail, r);
        if (s) suffixes.add(s);
    }
    const bodyText = input.text || plainTextFromHtml(input.html);
    for (const label of userLabels) {
        if (label.aliasSuffix && suffixes.has(label.aliasSuffix.toLowerCase())) labelIds.add(label.id);
        if (label.filterRegex) {
            // safeRegexTest valida (longitud, anidamiento) y trunca la entrada; nunca lanza.
            if (safeRegexTest(label.filterRegex, input.subject.slice(0, 1000))
                || safeRegexTest(label.filterRegex, bodyText)) {
                labelIds.add(label.id);
            }
        }
    }

    // 2) Reglas del usuario (tolera tabla "Rule" inexistente).
    try {
        const rules = await loadRules(input.userId, true);
        if (rules.length > 0) {
            const ctx: RuleEmail = {
                from: input.from, to: input.to, subject: input.subject, body: bodyText,
                hasAttachment: input.hasAttachment,
                labelIds: Array.from(labelIds),
                labelNames: userLabels.filter((l) => labelIds.has(l.id)).map((l) => l.name),
            };
            const fx = evaluateRules(ctx, rules);
            const valid = new Set(userLabels.map((l) => l.id));
            fx.addLabelIds.filter((id) => valid.has(id)).forEach((id) => labelIds.add(id));
            result.read = fx.markRead;
            result.starred = fx.star;
            // El spam detectado por cabeceras no se saca de spam por una regla.
            if (fx.folder && input.deliveryFolder !== 'spam') result.folder = fx.folder;
            result.appliedRuleIds = fx.appliedRuleIds;
        }
    } catch (e) {
        if (!isMissingRelation(e)) console.error('[inbound] rules failed:', (e as any)?.message);
    }

    result.labelIds = Array.from(labelIds);
    return result;
}
