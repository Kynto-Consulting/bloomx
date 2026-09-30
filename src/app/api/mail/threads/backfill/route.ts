import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { backfillThreadHeaders } from '@/lib/thread-backfill';

/**
 * POST /api/mail/threads/backfill { batch?: number, remote?: boolean }
 *
 * Rellena las cabeceras de hilo (Message-ID / In-Reply-To / References -> threadKey) de los correos ANTIGUOS del usuario de la sesion, un
 * lote por llamada (mas antiguos primero). Idempotente y seguro: solo lee raw.eml / raw.json / rawMimeUrl (descarga con las salvaguardas de
 * raw-mime.ts), nunca borra ni envia nada, y los correos sin cabeceras siguen agrupandose con la heuristica heredada.
 * El cron (/api/cron/run) hace lo mismo en segundo plano; esta ruta permite lanzarlo a mano (repetir hasta que `remaining` sea 0).
 */
export async function POST(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const batch = Math.min(Math.max(Number(body?.batch ?? 100) || 100, 1), 500);
    const result = await backfillThreadHeaders(user.id, batch, { remote: body?.remote !== false });
    return NextResponse.json(result);
}
