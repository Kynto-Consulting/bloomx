import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { rateLimitAsync } from '@/lib/security';
import { acceptProposal, defaultDeps, dismissProposal } from '@/lib/organizer/mail-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const body = z.strictObject({ action: z.enum(['accept', 'dismiss']) });
const idString = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

/** POST { action: 'accept' | 'dismiss' }: aceptar aplica la etiqueta (servicio de correo autorizado); rechazar la marca como dismissed. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ emailId: string }> }) {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });

    const rl = await rateLimitAsync(`organizer-proposal-act:${user.id}`, 300, 60_000);
    if (!rl.ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { ...NO_STORE, 'Retry-After': String(rl.retryAfter) } });

    const id = idString.safeParse((await params).emailId);
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!id.success || !parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: NO_STORE });

    try {
        const deps = await defaultDeps();
        const out = parsed.data.action === 'accept'
            ? await acceptProposal(deps, user.id, { emailId: id.data })
            : await dismissProposal(deps, user.id, { emailId: id.data });
        if (!out.ok) return NextResponse.json({ error: out.reason }, { status: out.reason === 'not_found' ? 404 : 422, headers: NO_STORE });
        return NextResponse.json({ success: true, ...('label' in out && out.label ? { label: out.label } : {}) }, { headers: NO_STORE });
    } catch {
        return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: NO_STORE });
    }
}
