import { backendUrl } from '@/lib/backend-url';
import { NextRequest, NextResponse } from 'next/server';
import { resolveEdgeIdentity } from '@/lib/ext-edge-identity';
import { evaluatePageAccess } from '@/lib/expansions/page-auth';
import { getClientIp, rateLimitAsync } from '@/lib/security';
import { PAGE_MOUNT_POINTS } from '@/lib/expansions/route-schema';

export const dynamic = 'force-dynamic';

const BACKEND_URL = (backendUrl()).replace(/\/+$/, '');
const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * GET /api/expansions/page-access?extensionId=<id>&path=<slug>
 * Decide si el usuario actual puede ver una pagina de extension con `auth: admin` (nivel minimo). El manifest se lee del backend (nunca
 * del navegador). Solo responde { access: 'allow'|'login'|'forbidden'|'not_found' }: nada de datos del usuario ni del manifest.
 * (Las paginas `none` viven en /p/** y no pasan por aqui; las `session` ya las protege el middleware.)
 */
export async function GET(req: NextRequest) {
    const ip = getClientIp(req);
    if (!(await rateLimitAsync(`page-access:${ip}`, 120, 60_000)).ok) return NextResponse.json({ access: 'not_found' }, { status: 429, headers: NO_STORE });
    const extensionId = req.nextUrl.searchParams.get('extensionId') ?? '';
    const slug = req.nextUrl.searchParams.get('path') ?? '';
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(extensionId) || !/^[A-Za-z0-9._~\/-]{1,200}$/.test(slug) || slug.includes('..')) {
        return NextResponse.json({ access: 'not_found' }, { headers: NO_STORE });
    }
    const host = (process.env.TOP_DOMAIN || req.headers.get('host') || '').split(':')[0];
    let mount: any = null;
    try {
        const res = await fetch(`${BACKEND_URL}/api/config?domain=${encodeURIComponent(host)}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
        const cfg = res.ok ? await res.json() : null;
        const ext = Array.isArray(cfg?.extensions) ? cfg.extensions.find((e: any) => e?.id === extensionId) : null;
        const template = typeof ext?.template === 'string' ? JSON.parse(ext.template) : ext?.template;
        mount = Array.isArray(template?.mounts) ? template.mounts.find((m: any) => PAGE_MOUNT_POINTS.includes(m?.point) && m?.path === slug) : null;
    } catch {
        mount = null;
    }
    const identity = mount ? await resolveEdgeIdentity(req).catch(() => null) : null;
    const access = evaluatePageAccess(mount, { signedIn: !!identity, level: identity?.level ?? null }, { publicRoute: false, where: 'app', publicApproved: false });
    return NextResponse.json({ access }, { headers: NO_STORE });
}
