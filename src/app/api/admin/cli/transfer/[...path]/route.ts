import { NextRequest, NextResponse } from 'next/server';
import { authenticateCli, noStore } from '@/lib/admin-cli/auth';
import { callAdminRoute } from '@/lib/admin-cli/bridge';
import { stepUpKey } from '@/lib/admin-cli/exec';
import { scopeAllows } from '@/lib/admin-cli/tokens';
import { verifyReauthToken } from '@/lib/mail-transfer/auth';
import { auditLog } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Transporte BINARIO de importar/exportar para la CLI (`bloomx transfer import <archivo>` / `transfer download`).
 * Los comandos de texto (/exec) crean y confirman trabajos; los trozos del archivo y la descarga van por aqui, solo estas rutas:
 *   PUT  jobs/<id>/chunks/<n>   (cabecera x-chunk-sha256; cuerpo = trozo)
 *   GET  jobs/<id>/chunks       (trozos ya recibidos: reanudar)
 *   GET  jobs/<id>/download?exp=&sig=   (enlace firmado de `transfer download-link`)
 * Pasa por el MISMO enrutador de mail-transfer (propiedad del trabajo, hash por trozo, limites, enlace firmado de 10 min). Exige token
 * (o consola) con ambito `write` y prueba de step-up en la cabecera `x-bloomx-stepup` (ver /api/admin/cli/reauth).
 */
const ALLOWED: Array<{ method: string; re: RegExp }> = [
    { method: 'PUT', re: /^jobs\/[A-Za-z0-9_-]{6,64}\/chunks\/\d{1,6}$/ },
    { method: 'GET', re: /^jobs\/[A-Za-z0-9_-]{6,64}\/chunks$/ },
    { method: 'GET', re: /^jobs\/[A-Za-z0-9_-]{6,64}\/download$/ },
];
const MAX_CHUNK = 12 * 1024 * 1024;

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
    const a = await authenticateCli(req);
    if (!a.ok) return a.response;
    const segments = (await ctx.params).path ?? [];
    const rel = segments.join('/');
    if (!ALLOWED.some((r) => r.method === req.method && r.re.test(rel))) return NextResponse.json({ error: 'Not found', code: 'not_found' }, { status: 404, headers: noStore });
    if (!scopeAllows(a.auth.session.scopes, 'write')) return NextResponse.json({ error: 'Forbidden', code: 'insufficient_scope' }, { status: 403, headers: noStore });

    const proof = req.headers.get('x-bloomx-stepup') ?? '';
    if (!verifyReauthToken(proof, stepUpKey(a.auth.actor), null).ok) {
        return NextResponse.json({ error: 'Re-authentication required', code: 'reauth_required', needs: 'stepup' }, { status: 403, headers: noStore });
    }

    let body: Uint8Array | undefined;
    if (req.method === 'PUT') {
        const buf = new Uint8Array(await req.arrayBuffer());
        if (buf.byteLength > MAX_CHUNK) return NextResponse.json({ error: 'Chunk too large', code: 'chunk_too_large' }, { status: 413, headers: noStore });
        body = buf;
    }
    const query: Record<string, string> = {};
    new URL(req.url).searchParams.forEach((v, k) => { if (/^(exp|sig)$/.test(k) && v.length < 200) query[k] = v; });
    const hash = req.headers.get('x-chunk-sha256');
    const res = await callAdminRoute(
        { method: req.method as 'GET' | 'PUT', path: `/mail-transfer/${rel}`, body, query, headers: hash ? { 'x-chunk-sha256': hash } : undefined, raw: true as const },
        { actor: a.auth.actor, ip: a.auth.ip, userAgent: a.auth.userAgent, managerSession: a.auth.managerSession, reauthProof: proof },
    );
    if (req.method === 'GET' && /download$/.test(rel)) auditLog('admin.cli.transfer_download', { userId: a.auth.actor.id, ip: a.auth.ip, status: res.status });
    const headers = new Headers(res.headers);
    headers.set('Cache-Control', 'no-store');
    return new Response(res.body, { status: res.status, headers });
}

export const GET = handle;
export const PUT = handle;
