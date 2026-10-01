import { NextRequest, NextResponse } from 'next/server';
import { authenticateCli, noStore } from '@/lib/admin-cli/auth';
import { revokeCliToken } from '@/lib/admin-cli/tokens';
import { releaseIfOwner } from '@/lib/privileged-session';
import { auditLog } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/admin/cli/logout -> revoca el token de CLI que hace la peticion (el servidor lo invalida al instante). Solo con Bearer. */
export async function POST(req: NextRequest) {
    const a = await authenticateCli(req);
    if (!a.ok) return a.response;
    const id = a.auth.session.tokenId;
    const adminId = a.auth.actor.id || a.auth.actor.email;
    if (a.auth.session.source !== 'token' || !id || !adminId) {
        return NextResponse.json({ error: 'Only CLI tokens can log out here', code: 'not_a_token' }, { status: 400, headers: noStore });
    }
    const r = await revokeCliToken(adminId, id);
    await releaseIfOwner(adminId, id).catch(() => undefined); // un cierre normal libera el slot de sesion privilegiada
    auditLog('admin.cli.logout', { userId: a.auth.actor.id, ip: a.auth.ip, revoked: !!r });
    return NextResponse.json({ ok: !!r }, { headers: noStore });
}
