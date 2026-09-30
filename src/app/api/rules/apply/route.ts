import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { rateLimitAsync } from '@/lib/security';
import { loadRules } from '@/lib/rules/store';
import {
    MAX_PAGE, addBatchProgress, applyRulesToEmailIds, countMatchesForRules, createBatch, decodeCursor, encodeCursor, getBatch, scanPage,
} from '@/lib/rules/apply';

/**
 * Aplica reglas a correos EXISTENTES (bandeja y archivo), por paginas para mostrar progreso:
 *   { ruleId | labelId | (nada = todas las activas), cursor?, batchId?, pageSize?, dryRun? }
 *  - dryRun: solo cuenta coincidencias (sin efectos).
 *  - Sin dryRun: la primera llamada crea un lote (batchId) y cada pagina registra el estado previo para poder DESHACER
 *    con POST /api/rules/batches/{id}/undo. Idempotente. Nunca reenvia ni borra definitivamente.
 */
export async function POST(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const rl = await rateLimitAsync(`rules-apply:${user.id}`, 240, 60_000);
    if (!rl.ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } });

    const body = await req.json().catch(() => ({}));
    const ruleId: string | null = typeof body?.ruleId === 'string' ? body.ruleId : null;
    const labelId: string | null = typeof body?.labelId === 'string' ? body.labelId : null;

    let rules = await loadRules(user.id, false);
    if (ruleId) rules = rules.filter((r) => r.id === ruleId).map((r) => ({ ...r, enabled: true }));
    else if (labelId) rules = rules.filter((r) => r.labelId === labelId && r.enabled);
    else rules = rules.filter((r) => r.enabled);
    if ((ruleId || labelId) && rules.length === 0) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    if (rules.length === 0) return NextResponse.json({ processed: 0, changed: 0, matched: 0, done: true, nextCursor: null });

    const cursor = body?.cursor ? decodeCursor(body.cursor) : null;
    if (body?.cursor && !cursor) return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 });
    const scoped = Boolean(ruleId || labelId || body?.cursor || body?.batchId || body?.dryRun);
    const page = await scanPage(user.id, cursor, scoped ? Math.min(MAX_PAGE, Number(body?.pageSize) || MAX_PAGE) : MAX_PAGE);
    const nextCursor = page.next ? encodeCursor(page.next) : null;

    if (body?.dryRun === true) {
        const c = await countMatchesForRules(user.id, rules, page.ids);
        return NextResponse.json({ ...c, changed: 0, nextCursor, done: !page.next });
    }

    let batchId: string | undefined;
    if (typeof body?.batchId === 'string') {
        const b = await getBatch(user.id, body.batchId);
        if (!b || b.status !== 'applied') return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
        batchId = b.id;
    } else if (scoped) {
        batchId = await createBatch(user.id, ruleId, labelId);
    }
    const r = await applyRulesToEmailIds(user.id, rules, page.ids, { batchId });
    if (batchId) await addBatchProgress(user.id, batchId, r.processed, r.changed);
    return NextResponse.json({ processed: r.processed, changed: r.changed, matched: r.matched, batchId: batchId ?? null, nextCursor, done: !page.next });
}
