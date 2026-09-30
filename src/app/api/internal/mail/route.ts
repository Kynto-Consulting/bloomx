import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { rateLimit, safeEqual } from '@/lib/security';
import { internalMailRequest } from '@/lib/organizer/schemas';
import { applyBatch, defaultDeps, getEmail, listRecent, undoRun } from '@/lib/organizer/mail-service';

/**
 * Puente servidor-a-servidor para `services.mail.*` del sandbox de extensiones (bloomx-backend).
 *
 * Auth: secreto compartido `x-internal-secret` (EXTENSION_HOOKS_SECRET o INTERNAL_SECRET, el mismo valor que en el
 * backend). Sin secreto configurado se rechaza siempre (fail-closed). El `userId` del cuerpo es el que el backend
 * derivo de una identidad verificada (JWT del usuario o webhook interno): la extension nunca lo controla.
 * Ver src/lib/organizer/mail-service.ts para las garantias de propiedad y minimo privilegio.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 256 * 1024;
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(req: NextRequest) {
    const expected = process.env.EXTENSION_HOOKS_SECRET || process.env.INTERNAL_SECRET;
    if (!expected) return NextResponse.json({ error: 'Service not configured' }, { status: 503, headers: NO_STORE });
    const provided = req.headers.get('x-internal-secret') || '';
    if (!provided || !safeEqual(provided, expected)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
    }

    const declared = Number(req.headers.get('content-length') || 0);
    if (declared > MAX_BODY_BYTES) return NextResponse.json({ error: 'Payload too large' }, { status: 413, headers: NO_STORE });
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Payload too large' }, { status: 413, headers: NO_STORE });

    let json: unknown = null;
    try { json = JSON.parse(raw); } catch { json = null; }
    const parsed = internalMailRequest.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: NO_STORE });
    const { userId } = parsed.data;

    const rl = rateLimit(`internal-mail:${userId}`, 300, 60_000);
    if (!rl.ok) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { ...NO_STORE, 'Retry-After': String(rl.retryAfter) } });
    }

    try {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
        if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });

        const deps = await defaultDeps();
        let data: unknown;
        switch (parsed.data.op) {
            case 'listRecent': data = await listRecent(deps, userId, parsed.data.args); break;
            case 'getEmail': data = await getEmail(deps, userId, parsed.data.args); break;
            case 'applyBatch': data = await applyBatch(deps, userId, parsed.data.args); break;
            case 'undoRun': data = await undoRun(deps, userId, parsed.data.args); break;
        }
        return NextResponse.json({ success: true, data }, { headers: NO_STORE });
    } catch (e: any) {
        // Sin contenido de correos en el log
        console.error('[internal-mail] failed:', parsed.data.op, String(e?.message || 'error').slice(0, 120));
        return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: NO_STORE });
    }
}
