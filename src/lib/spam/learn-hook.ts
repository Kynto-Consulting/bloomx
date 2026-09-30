/**
 * Gancho de aprendizaje en el servidor: se llama desde mail-store (mover a/desde spam), NO desde el cliente. Toma una instantanea de los
 * correos afectados ANTES de mover y, tras mover, entrena el modelo del usuario (si "aprender de mis marcas" esta activo), actualiza los
 * contadores por remitente y registra el evento. Nunca lanza: el aprendizaje es de mejor esfuerzo y no debe romper el movimiento.
 */
import { prisma } from '@/lib/prisma';
import { recordEvent } from './events-store';
import { bumpSender, getUserPrefs, train } from './learning-store';
import { domainOf, parseAddress } from './text';

export interface LearnRow { id: string; userId: string; folder: string; from: string; subject: string; snippet: string }
const MAX_ROWS = 200;

/** ¿Este movimiento cuenta como "Es spam" o "No es spam"? */
export function labelForMove(fromFolder: string, toFolder: string): 'spam' | 'ham' | null {
    if (toFolder === 'spam' && fromFolder !== 'spam' && fromFolder !== 'sent' && fromFolder !== 'drafts' && fromFolder !== 'scheduled') return 'spam';
    if (fromFolder === 'spam' && (toFolder === 'inbox' || toFolder === 'archive')) return 'ham';
    return null;
}

/** Correos que cambian de estado spam/no spam con este movimiento. Devuelve [] si no aplica (barato: no consulta). */
export async function snapshotForLearning(ids: string[], userIds: string[], toFolder: string): Promise<LearnRow[]> {
    if (ids.length === 0 || userIds.length === 0) return [];
    if (toFolder !== 'spam' && toFolder !== 'inbox' && toFolder !== 'archive') return [];
    try {
        const rows = await prisma.email.findMany({
            where: { id: { in: ids.slice(0, MAX_ROWS) }, userId: { in: userIds }, ...(toFolder === 'spam' ? { folder: { notIn: ['spam', 'sent', 'drafts', 'scheduled'] } } : { folder: 'spam' }) },
            select: { id: true, userId: true, folder: true, from: true, subject: true, snippet: true },
        });
        return rows.map((r) => ({ id: r.id, userId: r.userId, folder: r.folder, from: r.from || '', subject: r.subject || '', snippet: r.snippet || '' }));
    } catch { return []; }
}

export async function applyLearning(rows: LearnRow[], toFolder: string): Promise<void> {
    if (rows.length === 0) return;
    const prefsCache = new Map<string, boolean>();
    for (const r of rows) {
        try {
            const label = labelForMove(r.folder, toFolder);
            if (!label) continue;
            const addr = parseAddress(r.from).email || r.from.toLowerCase();
            let learn = prefsCache.get(r.userId);
            if (learn === undefined) { learn = (await getUserPrefs(r.userId)).learn; prefsCache.set(r.userId, learn); }
            await recordEvent({ userId: r.userId, sender: addr || 'unknown', decision: label === 'spam' ? 'markspam' : 'notspam' });
            if (!learn) continue;
            await train(r.userId, { subject: r.subject, body: r.snippet, fromDomain: domainOf(addr) }, label);
            await bumpSender(r.userId, r.from, label);
        } catch (error) {
            console.error('[spam-learn] hook failed:', error instanceof Error ? error.message.slice(0, 200) : 'error');
        }
    }
}
