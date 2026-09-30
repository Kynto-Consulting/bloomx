/**
 * Simulacion de un cambio de configuracion sobre los ultimos N correos YA evaluados (usa las senales base guardadas en
 * Email.spamReasons, sin releer cuerpos ni tocar nada). Devuelve solo conteos.
 */
import { query } from '@/lib/admin/sql';
import { isMissingRelation } from '@/lib/admin/sql';
import { bandOf, decisionFor, sanitizeSpamConfig, type SpamConfig } from './config-core';
import { DEFAULT_ENGINE_CONFIG, aggregateSignals } from './engine';
import { mergeConfig } from './config-store';
import { engineConfigFor } from './pipeline';
import { rawSignalsOf, unpackVerdict } from './verdict';
import type { Signal } from './types';

export const SIMULATION_SAMPLE = 200;

export interface SimulationResult {
    analyzed: number;
    /** Correos de esa muestra sin senales guardadas (anteriores al motor v2). */
    skipped: number;
    current: { spam: number; warned: number; delivered: number };
    proposed: { spam: number; warned: number; delivered: number };
    /** Cuantos cambian de destino con el ajuste. */
    changed: { toSpam: number; fromSpam: number; toWarned: number; fromWarned: number };
}

const empty = () => ({ spam: 0, warned: 0, delivered: 0 });

/** Quita las senales de las familias que el ajuste desactiva en el motor. */
function dropDisabled(raw: Signal[], cfg: SpamConfig): Signal[] {
    return raw.filter((s) => {
        if (!cfg.engine.content && s.id.startsWith('content.')) return false;
        if (!cfg.engine.links && s.id.startsWith('link.')) return false;
        if (!cfg.engine.learning && s.family === 'learning') return false;
        if (!cfg.engine.context && s.family === 'context') return false;
        return true;
    });
}

export function simulateRows(rows: Array<{ spamReasons: unknown }>, proposed: SpamConfig, current: SpamConfig): SimulationResult {
    const res: SimulationResult = { analyzed: 0, skipped: 0, current: empty(), proposed: empty(), changed: { toSpam: 0, fromSpam: 0, toWarned: 0, fromWarned: 0 } };
    const eng = engineConfigFor(proposed, []);
    for (const r of rows) {
        const v = unpackVerdict(r.spamReasons);
        if (!v || v.rw.length === 0) { res.skipped++; continue; }
        res.analyzed++;
        const raw = dropDisabled(rawSignalsOf(v), proposed);
        const { score } = aggregateSignals(raw, { ...DEFAULT_ENGINE_CONFIG, ...eng }, false);
        // Un correo de la lista PERMITIDA entregado por ello sigue entregandose igual
        const was = v.d;
        const now = v.al && was === 'delivered' ? 'delivered' : decisionFor(bandOf(score, proposed), proposed).decision;
        const key = (d: string) => (d === 'spam' ? 'spam' : d === 'warned' ? 'warned' : 'delivered') as 'spam' | 'warned' | 'delivered';
        res.current[key(was)]++;
        res.proposed[key(now)]++;
        if (now === 'spam' && was !== 'spam') res.changed.toSpam++;
        if (was === 'spam' && now !== 'spam') res.changed.fromSpam++;
        if (now === 'warned' && was !== 'warned') res.changed.toWarned++;
        if (was === 'warned' && now !== 'warned') res.changed.fromWarned++;
    }
    return res;
}

/** Ultimos correos evaluados: los del administrador (si es usuario) o, sin buzon propio, los mas recientes del dominio. */
export async function simulate(patch: unknown, current: SpamConfig, userId: string | null): Promise<SimulationResult> {
    const proposed = sanitizeSpamConfig(mergeConfig(current, patch), current);
    try {
        const rows = await query<{ spamReasons: unknown }>(
            `SELECT "spamReasons" FROM "Email" WHERE "spamReasons" IS NOT NULL AND "folder" IN ('inbox','spam','archive') ${userId ? 'AND "userId" = $2' : ''}
             ORDER BY "createdAt" DESC LIMIT $1`,
            ...(userId ? [SIMULATION_SAMPLE, userId] : [SIMULATION_SAMPLE]),
        );
        return simulateRows(rows, proposed, current);
    } catch (error) {
        if (isMissingRelation(error)) return simulateRows([], proposed, current);
        throw error;
    }
}
