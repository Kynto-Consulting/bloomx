import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { canAccessEmail } from '@/lib/mailbox-access';
import { resolveAuthorizedSenders } from '@/lib/draft-access';
import { rateLimitAsync } from '@/lib/security';
import { buildComposeOpenedContext, fireLifecycleHook } from '@/lib/expansions/server-hooks';

/**
 * POST /api/expansions/events — eventos de ciclo de vida que solo la UI conoce. Hoy solo COMPOSE_OPENED.
 * El userId sale de la sesion (nunca del cuerpo). Los ids de referencia que no pertenezcan al usuario se descartan
 * en silencio (sin oraculo de existencia). Responde 202 siempre que el cuerpo sea valido; el disparo es no bloqueante.
 */
const ID = z.string().min(1).max(100);
const bodySchema = z.object({
    event: z.literal('COMPOSE_OPENED'),
    context: z.object({
        mode: z.enum(['new', 'reply', 'replyAll', 'forward']),
        inReplyToEmailId: ID.optional(),
        draftId: ID.optional(),
    }).strict(),
}).strict();

export async function POST(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (!(await rateLimitAsync(`ext-events:${user.id}`, 120, 60_000)).ok) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const raw = await req.text().catch(() => '');
    if (raw.length > 4096) return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    let json: unknown;
    try { json = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Invalid event' }, { status: 400 }); }

    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid event' }, { status: 400 });
    const { mode, inReplyToEmailId, draftId } = parsed.data.context;

    let safeEmailId: string | undefined;
    let safeDraftId: string | undefined;
    try {
        if (inReplyToEmailId) {
            const email = await prisma.email.findUnique({ where: { id: inReplyToEmailId }, select: { id: true, userId: true } });
            if (email && await canAccessEmail(user.id, email.userId)) safeEmailId = email.id;
        }
        if (draftId) {
            // Los borradores pertenecen a un remitente autorizado del usuario (igual que /api/drafts).
            const senders = Array.from(await resolveAuthorizedSenders(user.id, user.email));
            const draft = await prisma.draft.findFirst({ where: { id: draftId, from: { in: senders } }, select: { id: true } });
            if (draft) safeDraftId = draft.id;
        }
    } catch {
        // Si la verificacion falla se descartan los ids: el evento sigue siendo util sin ellos.
    }

    fireLifecycleHook('COMPOSE_OPENED', user.id, buildComposeOpenedContext({ mode, inReplyToEmailId: safeEmailId, draftId: safeDraftId }));
    return NextResponse.json({ success: true }, { status: 202 });
}
