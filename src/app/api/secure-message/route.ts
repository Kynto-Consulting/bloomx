import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { rateLimitAsync } from '@/lib/security';
import { createSealedSchema, effectiveTtlDays } from '@/lib/sealed/schema';
import { createSealed, defaultDeps } from '@/lib/sealed/store';

/**
 * Crea un mensaje SELLADO. El navegador del remitente ya cifro el contenido con AES-256-GCM (WebCrypto) y la clave
 * viaja solo en el fragmento `#k=` del enlace: este endpoint recibe unicamente {iv, ct, salt?, iter?, pw}, nunca la clave
 * ni el texto en claro. Ver src/lib/sealed/crypto.ts para el protocolo.
 *
 * Requiere sesion (solo usuarios de la instancia pueden crear). Abrir el mensaje: /api/secure-message/[id].
 * SECURE_MESSAGE_ENABLED=false lo desactiva (p. ej. si la politica de DLP exige inspeccionar el cuerpo saliente).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const MAX_BODY_CHARS = 1_100_000;

export async function POST(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
    if (String(process.env.SECURE_MESSAGE_ENABLED || 'true').toLowerCase() === 'false') {
        return NextResponse.json({ error: 'Sealed messages are disabled' }, { status: 403, headers: NO_STORE });
    }

    const rl = await rateLimitAsync(`secure-msg:${user.email}`, 30, 60 * 60 * 1000);
    if (!rl.ok) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { ...NO_STORE, 'Retry-After': String(rl.retryAfter) } });
    }

    const declared = Number(req.headers.get('content-length') || 0);
    if (declared > MAX_BODY_CHARS) return NextResponse.json({ error: 'Content too large' }, { status: 413, headers: NO_STORE });
    const raw = await req.text();
    if (raw.length > MAX_BODY_CHARS) return NextResponse.json({ error: 'Content too large' }, { status: 413, headers: NO_STORE });

    let json: unknown = null;
    try { json = JSON.parse(raw); } catch { json = null; }

    // El formato anterior (texto en claro en el servidor) ya no se acepta: el servidor no debe ver el contenido.
    if (json && typeof json === 'object' && typeof (json as any).content === 'string') {
        return NextResponse.json({ error: 'Plaintext secure messages are no longer accepted; upgrade the client (sealed v1)' }, { status: 400, headers: NO_STORE });
    }

    const parsed = createSealedSchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid sealed message' }, { status: 400, headers: NO_STORE });

    try {
        const deps = await defaultDeps();
        const { id, expiresAt } = await createSealed(deps, {
            envelope: parsed.data.envelope as any,
            sender: user.email,
            ttlDays: effectiveTtlDays(parsed.data.ttlDays),
            maxViews: parsed.data.maxViews ?? null,
            userId: user.id,
        });
        const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://bloomx.arubik.dev').replace(/\/+$/, '');
        return NextResponse.json({ success: true, id, viewUrl: `${baseUrl}/secure/${id}`, expiresAt }, { headers: NO_STORE });
    } catch (e: any) {
        console.error('Secure Message Error', String(e?.message || 'error').slice(0, 120));
        return NextResponse.json({ error: 'Failed' }, { status: 500, headers: NO_STORE });
    }
}
