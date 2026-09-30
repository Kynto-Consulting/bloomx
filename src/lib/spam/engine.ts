/**
 * Motor de spam v2 (puro y determinista). score = suma ponderada de senales, acotada a 0-100.
 *
 *  - Cada familia ajustable se multiplica por su peso de dominio (0-2) y tiene un tope de puntos positivos, para que una sola
 *    familia (p. ej. solo "SPF fallo") no baste por si sola para llegar a "spam": hace falta corroboracion.
 *  - El contexto (contactos, hilos propios, historial) SOLO resta, con tope -40, y se recorta (x0.4) si hay una senal grave
 *    (suplantacion, ejecutable, enlace con credenciales...): una cuenta conocida comprometida sigue siendo peligrosa.
 *  - "Primera vez que escribe" suma poco y solo cuando ya hay otras senales.
 */
import {
    attachmentSignals, authSignals, contentSignals, contextSignals, headerSignals, impersonationSignals, linkSignals, originSignals, alignment,
} from './signals';
import { prepare } from './prepare';
import { TUNABLE_FAMILIES, type EngineConfig, type EngineResult, type RecipientContext, type Signal, type SignalFamily, type SpamInput, type TunableFamily } from './types';

export const FAMILY_CAPS: Record<SignalFamily, number> = {
    auth: 55, headers: 40, content: 60, links: 55, attachments: 60, impersonation: 60, origin: 50, context: 0, learning: 20, combo: 0,
};
export const CONTEXT_FLOOR = -40;
export const CRITICAL_CONTEXT_FACTOR = 0.4;

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
    familyWeights: { auth: 1, headers: 1, content: 1, links: 1, attachments: 1, impersonation: 1 },
    ownDomains: [],
    contentEnabled: true,
    linksEnabled: true,
    learningEnabled: true,
    contextEnabled: true,
};

const isTunable = (f: SignalFamily): f is TunableFamily => (TUNABLE_FAMILIES as readonly string[]).includes(f);

/** Agrega senales base (sin ponderar) en un score: pesos de familia, topes, corroboracion y contexto. Reutilizable para re-simular. */
export function aggregateSignals(raw: Signal[], c: EngineConfig, firstTime: boolean): { score: number; signals: Signal[] } {
    // 1) multiplicador de familia (solo positivos de familias ajustables)
    const weighted: Signal[] = raw.map((s) => {
        if (s.weight > 0 && isTunable(s.family)) return { ...s, weight: Math.round(s.weight * c.familyWeights[s.family]) };
        return { ...s, weight: Math.round(s.weight) };
    }).filter((s) => s.weight !== 0);

    // 2) tope de puntos positivos por familia (escala proporcional para que la explicacion cuadre)
    const scaled: Signal[] = [];
    for (const fam of Object.keys(FAMILY_CAPS) as SignalFamily[]) {
        const list = weighted.filter((s) => s.family === fam);
        if (list.length === 0) continue;
        if (fam === 'context') { scaled.push(...list); continue; }
        const mult = isTunable(fam) ? Math.max(1, c.familyWeights[fam]) : 1;
        const cap = FAMILY_CAPS[fam] * mult;
        const pos = list.filter((s) => s.weight > 0);
        const posSum = pos.reduce((a, s) => a + s.weight, 0);
        if (posSum > cap) {
            const k = cap / posSum;
            for (const s of list) scaled.push(s.weight > 0 ? { ...s, weight: Math.max(1, Math.round(s.weight * k)) } : s);
        } else scaled.push(...list);
    }

    // 2b) corroboracion: evidencias independientes de varias familias se refuerzan entre si
    const famSums = new Map<string, number>();
    for (const s of scaled) if (s.weight > 0 && !['context', 'learning', 'origin', 'combo'].includes(s.family)) famSums.set(s.family, (famSums.get(s.family) ?? 0) + s.weight);
    const strongFams = new Set(Array.from(famSums.entries()).filter(([, v]) => v >= 6).map(([k]) => k));
    if (strongFams.size >= 4) scaled.push({ id: 'combo.families', family: 'combo', weight: 14, params: { n: strongFams.size } });
    else if (strongFams.size >= 3) scaled.push({ id: 'combo.families', family: 'combo', weight: 8, params: { n: strongFams.size } });

    // 3) contexto: solo resta, con suelo, y recortado si hay una senal grave
    const critical = scaled.some((s) => s.critical && s.weight > 0);
    let signals = scaled;
    const ctxNeg = scaled.filter((s) => s.family === 'context' && s.weight < 0);
    const ctxSum = ctxNeg.reduce((a, s) => a + s.weight, 0);
    if (ctxSum !== 0) {
        const k = Math.min(1, CONTEXT_FLOOR / ctxSum) * (critical ? CRITICAL_CONTEXT_FACTOR : 1);
        signals = scaled.map((s) => (s.family === 'context' && s.weight < 0 ? { ...s, weight: Math.min(-1, Math.round(s.weight * k)) } : s));
    }
    // 4) primera vez: solo suma si ya hay otras senales
    const positive = signals.filter((s) => s.weight > 0 && s.family !== 'context').reduce((a, s) => a + s.weight, 0);
    if (firstTime && positive >= 15 && c.contextEnabled) signals = [...signals, { id: 'ctx.first_contact', family: 'context', weight: positive >= 25 ? 7 : 4 }];

    signals.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight) || a.id.localeCompare(b.id));
    const score = Math.max(0, Math.min(100, Math.round(signals.reduce((a, s) => a + s.weight, 0))));

    return { score, signals };
}

export function evaluateSpam(input: SpamInput, cfg: Partial<EngineConfig> = {}, ctx?: RecipientContext): EngineResult {
    const c: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, ...cfg, familyWeights: { ...DEFAULT_ENGINE_CONFIG.familyWeights, ...(cfg.familyWeights ?? {}) } };
    const p = prepare(input, c.ownDomains);
    let raw: Signal[] = [
        ...authSignals(p),
        ...headerSignals(p),
        ...(c.contentEnabled ? contentSignals(p) : []),
        ...(c.linksEnabled ? linkSignals(p) : []),
        ...attachmentSignals(p),
        ...impersonationSignals(p),
        ...originSignals(p),
        ...(c.contextEnabled || c.learningEnabled ? contextSignals(ctx) : []),
    ];
    if (!c.contextEnabled) raw = raw.filter((s) => s.family !== 'context');
    if (!c.learningEnabled) raw = raw.filter((s) => s.family !== 'learning');

    const { score, signals } = aggregateSignals(raw, c, ctx?.firstTime === true);

    const al = alignment(p);
    const hasUnsub = signals.some((s) => s.id === 'hdr.list_unsub');
    const category: EngineResult['category'] = hasUnsub || !!p.bag['list-id'] ? 'promotional' : (ctx?.senderInContacts || ctx?.userRepliedBefore || ctx?.inReplyToOwn ? 'personal' : 'unknown');
    return {
        score,
        signals,
        category,
        authFailed: p.auth.present && (p.auth.dmarc === 'fail' || (!al.any && (p.auth.dkim === 'fail' || p.auth.spf === 'fail'))),
        dangerousAttachment: signals.some((s) => s.id === 'att.dangerous_ext' || s.id === 'att.blocked_type' || s.id === 'att.double_ext'),
        raw,
        impersonation: signals.some((s) => s.id.startsWith('imp.')),
    };
}
