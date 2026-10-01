import { NextRequest, NextResponse } from 'next/server';
import { authenticateCli, noStore } from '@/lib/admin-cli/auth';
import { LIMITS, executeCommand, type ExecRequest } from '@/lib/admin-cli/exec';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/admin/cli/exec  { line } | { argv }  (+ input?, confirm?, stepUp?, locale?)
 *   -> { ok, exitCode, command, risk, output, text | json, error?, needs?: 'confirm' | 'stepup', durationMs }
 * Autenticacion: token de CLI (Bearer bxa_...) o cookie de la consola web + X-Requested-With (ver lib/admin-cli/auth.ts).
 * Falla cerrado: sin credencial valida 401/403. El cuerpo se limita (8 KB de linea, 512 KB de entrada).
 */
export async function POST(req: NextRequest) {
    const a = await authenticateCli(req);
    if (!a.ok) return a.response;

    const text = await req.text().catch(() => '');
    if (text.length > LIMITS.maxInputBytes + 64 * 1024) {
        return NextResponse.json({ ok: false, exitCode: 2, error: { code: 'payload_too_large', message: 'Request too large' } }, { status: 413, headers: noStore });
    }
    let body: Record<string, unknown>;
    try {
        body = text ? JSON.parse(text) : {};
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('shape');
    } catch {
        return NextResponse.json({ ok: false, exitCode: 2, error: { code: 'invalid_json', message: 'Body must be a JSON object' } }, { status: 400, headers: noStore });
    }
    const request: ExecRequest = {
        line: typeof body.line === 'string' ? body.line : undefined,
        argv: Array.isArray(body.argv) ? (body.argv as string[]) : undefined,
        input: typeof body.input === 'string' ? body.input : undefined,
        confirm: body.confirm === true,
        stepUp: typeof body.stepUp === 'string' && body.stepUp.length <= 600 ? body.stepUp : undefined,
        locale: body.locale === 'en' ? 'en' : 'es',
    };
    const res = await executeCommand(request, a.auth);
    const status = res.error?.code === 'rate_limited' ? 429 : 200;
    return NextResponse.json(res, { status, headers: noStore });
}
