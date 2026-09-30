import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { rateLimitAsync } from '@/lib/security';
import { validateConditionsV2 } from '@/lib/rules/conditions';
import { PREVIEW_LIMITS, decodeCursor, encodeCursor, latestEmailIds, previewConditions, scanPage } from '@/lib/rules/apply';

const MAX_BODY_BYTES = 64 * 1024;

/**
 * Probar unas condiciones contra correos REALES del usuario, sin ningun efecto (nada se guarda ni se modifica).
 *  - modo 'test' (por defecto): los ultimos 50 o 200 correos y cuales coincidirian.
 *  - modo 'count': cuenta coincidencias en TODO el correo por paginas (cursor) para la confirmacion de "Aplicar a existentes".
 * Solo se leen correos del propio usuario. Limitado por ritmo.
 */
export async function POST(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const rl = await rateLimitAsync(`rules-preview:${user.id}`, 120, 60_000);
    if (!rl.ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } });

    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    let body: any;
    try { body = JSON.parse(text); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

    const v = validateConditionsV2(body?.conditions);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

    try {
        if (body?.mode === 'count') {
            const cursor = body.cursor ? decodeCursor(body.cursor) : null;
            if (body.cursor && !cursor) return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 });
            const page = await scanPage(user.id, cursor, Number(body.pageSize) || 200);
            const r = await previewConditions(user.id, v.value, page.ids, 0);
            return NextResponse.json({
                processed: r.evaluated, matched: r.matched, unknown: r.unknown,
                nextCursor: page.next ? encodeCursor(page.next) : null, done: !page.next,
            });
        }
        const limit = (PREVIEW_LIMITS as readonly number[]).includes(Number(body?.limit)) ? Number(body.limit) : 50;
        const ids = await latestEmailIds(user.id, limit);
        const r = await previewConditions(user.id, v.value, ids, limit);
        return NextResponse.json({ limit, ...r });
    } catch (e) {
        console.error('[rules] preview failed:', (e as any)?.message);
        return NextResponse.json({ error: 'Preview failed' }, { status: 500 });
    }
}
