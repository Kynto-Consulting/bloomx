import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { rateLimitAsync } from '@/lib/security';
import { verifyHostCall } from '@/lib/host-call-auth';
import { internalMailRequest } from '@/lib/organizer/schemas';
import { applyBatch, defaultDeps, getEmail, listRecent, undoRun } from '@/lib/organizer/mail-service';

/**
 * Puente servidor-a-servidor para `services.mail.*` del sandbox de extensiones (bloomx-backend).
 *
 * Auth SIN secretos compartidos: firma Ed25519 DEL BACKEND (X-BloomX-Signature/Timestamp/Nonce sobre metodo+ruta+sha256(cuerpo)
 * +dominio+usuario), verificada con la clave PUBLICA del backend (BLOOMX_BACKEND_PUBLIC_KEY o descubrimiento con cache desde
 * NEXT_PUBLIC_BACKEND_URL/.well-known/bloomx-backend-key.json). La audiencia (X-BloomX-Domain) debe ser esta instancia y el
 * nonce no puede repetirse. Sin clave publica del backend la ruta responde 503 solo para este puente (Organizer usa su
 * heuristica). El `userId` del cuerpo es el que el backend derivo de una identidad que ESTE dominio firmo al llamarle:
 * la extension nunca lo controla y debe coincidir con el X-User-Id firmado.
 * Ver src/lib/organizer/mail-service.ts para las garantias de propiedad y minimo privilegio.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 256 * 1024;
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(req: NextRequest) {
    const declared = Number(req.headers.get('content-length') || 0);
    if (declared > MAX_BODY_BYTES) return NextResponse.json({ error: 'Payload too large' }, { status: 413, headers: NO_STORE });
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Payload too large' }, { status: 413, headers: NO_STORE });

    const verified = await verifyHostCall(req, raw);
    if (!verified.ok) {
        return verified.reason === 'unavailable'
            ? NextResponse.json({ error: 'Backend key unavailable' }, { status: 503, headers: { ...NO_STORE, 'Retry-After': '30' } })
            : NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
    }

    let json: unknown = null;
    try { json = JSON.parse(raw); } catch { json = null; }
    const parsed = internalMailRequest.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: NO_STORE });
    const { userId } = parsed.data;
    // El usuario del cuerpo debe ser el firmado en la cabecera (evita reutilizar una firma con otro userId).
    if (verified.userId !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });

    const rl = await rateLimitAsync(`internal-mail:${userId}`, 300, 60_000);
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
