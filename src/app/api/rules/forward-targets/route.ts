import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { forwardingEnabled, verifiedForwardTargets } from '@/lib/rules/forward';

/** Si el reenvio automatico esta habilitado y a que direcciones verificadas del usuario se puede reenviar. */
export async function GET() {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const enabled = forwardingEnabled();
    return NextResponse.json({ enabled, targets: enabled ? await verifiedForwardTargets(user.id) : [] });
}
