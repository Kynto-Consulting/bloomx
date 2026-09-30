import { HttpError, notFound } from '@/lib/admin/http';
import { query } from '@/lib/admin/sql';
import { canAccessEmail } from '@/lib/mailbox-access';
import { getSpamConfig } from '@/lib/spam/config-store';
import { effectiveThreshold } from '@/lib/spam/config-core';
import { getUserPrefs } from '@/lib/spam/learning-store';
import { explainSignal } from '@/lib/spam/reasons';
import { displaySignalsOf, unpackVerdict } from '@/lib/spam/verdict';
import { userRoute } from '@/lib/spam/user-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Por que un correo esta en spam / es sospechoso: puntuacion, decision y senales (id, peso, parametros y motivo en es/en).
 * Sin contenido del correo. Correos de otros buzones -> 404. Un correo sin veredicto (anterior al motor v2) -> { scored: false }.
 */
export const GET = userRoute<{ id: string }>({ scope: 'explain', limit: 240 }, async ({ user }, { id }) => {
    let rows: Array<{ userId: string; folder: string; spamScore: number | null; spamReasons: unknown; isExternal: boolean | null }> = [];
    try {
        rows = await query(`SELECT "userId","folder","spamScore","spamReasons","isExternal" FROM "Email" WHERE "id" = $1`, id);
    } catch {
        throw new HttpError(503, 'unavailable');
    }
    const row = rows[0];
    if (!row || !(await canAccessEmail(user.id, row.userId))) throw notFound('email_not_found');
    const v = unpackVerdict(row.spamReasons);
    if (!v || row.spamScore === null) return { scored: false, folder: row.folder, external: row.isExternal === true };
    const [cfg, prefs] = await Promise.all([getSpamConfig(), getUserPrefs(row.userId)]);
    return {
        scored: true,
        folder: row.folder,
        score: row.spamScore,
        decision: v.d,
        band: v.b,
        threshold: effectiveThreshold(cfg, prefs.sensitivity),
        allowed: !!v.al,
        external: row.isExternal === true,
        colleagueSpoof: v.ext?.c === 1,
        firstTime: v.ext?.f === 1,
        signals: displaySignalsOf(v).filter((s) => s.weight !== 0).map((s) => ({ id: s.id, weight: s.weight, params: s.params ?? null, es: explainSignal(s, 'es'), en: explainSignal(s, 'en') })),
    };
});
