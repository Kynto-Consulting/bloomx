import { NextRequest, NextResponse } from 'next/server';
import { authenticateCli, noStore } from '@/lib/admin-cli/auth';
import { CATEGORIES, CLIENT_BUILTINS, publicCatalog } from '@/lib/admin-cli/catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/cli/commands -> catalogo de comandos (sin handlers): nombre, categoria, riesgo, banderas, descripciones es/en. */
export async function GET(req: NextRequest) {
    const a = await authenticateCli(req);
    if (!a.ok) return a.response;
    return NextResponse.json({ commands: publicCatalog(), builtins: CLIENT_BUILTINS, categories: CATEGORIES, scopes: a.auth.session.scopes }, { headers: noStore });
}
