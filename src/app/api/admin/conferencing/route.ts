import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { CONFERENCING_EXTENSIONS, fetchAdminDomain, fetchCredentialKeys } from '@/lib/conferencing/admin-backend';
import { zoomOAuthConfigured } from '@/lib/zoom/account';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * GET /api/admin/conferencing  (solo admin: requireAdmin)
 * -> { domainId, isAdmin, extensions: { 'core-zoom'|'core-google-meet'|'core-calendar': { installed, installId, keys } }, oauth }
 * `keys` = [{ name, configured }] (nunca valores). Sin sesion de manager dueno del dominio el backend no devuelve dominio:
 * 403 con motivo legible para que el panel no muestre "guardado".
 */
export async function GET(req: Request) {
    const guard = await requireAdmin(req);
    if (!guard.ok) return guard.response;

    const cookie = req.headers.get('cookie') || '';
    const info = await fetchAdminDomain(cookie);
    if (!info) {
        return NextResponse.json({ error: 'A manager session that owns this domain is required', code: 'manager_required' }, { status: 403, headers: NO_STORE });
    }

    const extensions: Record<string, { installed: boolean; installId: string | null; keys: Array<{ name: string; configured: boolean }> }> = {};
    await Promise.all(
        CONFERENCING_EXTENSIONS.map(async (id) => {
            const install = info.installs[id];
            extensions[id] = {
                installed: install.installed,
                installId: install.installId,
                keys: install.installId ? await fetchCredentialKeys(cookie, info.domainId, install.installId) : [],
            };
        }),
    );

    return NextResponse.json(
        {
            domainId: info.domainId,
            isAdmin: true,
            extensions,
            oauth: {
                google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
                zoom: zoomOAuthConfigured(),
                googleOrganizer: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
            },
        },
        { headers: NO_STORE },
    );
}
