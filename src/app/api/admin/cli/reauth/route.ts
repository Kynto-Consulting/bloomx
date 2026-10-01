import { NextRequest, NextResponse } from 'next/server';
import { authenticateCli, noStore } from '@/lib/admin-cli/auth';
import { callAdminRoute } from '@/lib/admin-cli/bridge';
import { auditLog } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/cli/reauth { password } | { code } | { recoveryCode }  -> { ok, stepUp, expiresAt, method }
 * Step-up para comandos destructive/security: reutiliza la verificacion REAL de contrasena/MFA de importar-exportar correo
 * (mail-transfer postReauth: bcrypt / TOTP / backend para managers, con su limite de intentos). `stepUp` es una prueba HMAC de
 * 10 minutos atada al administrador: se envia en el campo `stepUp` de /exec. Nunca se registra la contrasena ni el codigo.
 */
export async function POST(req: NextRequest) {
    const a = await authenticateCli(req);
    if (!a.ok) return a.response;
    const raw = await req.text().catch(() => '');
    let body: Record<string, unknown> = {};
    try {
        body = raw && raw.length < 4096 ? JSON.parse(raw) : {};
    } catch {
        return NextResponse.json({ error: 'Invalid JSON', code: 'invalid_json' }, { status: 400, headers: noStore });
    }
    const pick = (k: string, max: number) => (typeof body[k] === 'string' && (body[k] as string).length <= max ? (body[k] as string) : undefined);
    const r = await callAdminRoute(
        { method: 'POST', path: '/mail-transfer/reauth', body: { password: pick('password', 1024), code: pick('code', 32), recoveryCode: pick('recoveryCode', 64) } },
        { actor: a.auth.actor, ip: a.auth.ip, userAgent: a.auth.userAgent, managerSession: a.auth.managerSession },
    );
    if (r.status !== 200) {
        auditLog('admin.cli.reauth_failed', { userId: a.auth.actor.id, ip: a.auth.ip, status: r.status });
        return NextResponse.json(
            { ok: false, error: r.data?.error ?? 'Re-authentication failed', code: r.data?.code ?? 'reauth_failed' },
            { status: r.status, headers: { ...noStore, ...(r.headers['retry-after'] ? { 'Retry-After': r.headers['retry-after'] } : {}) } },
        );
    }
    const proof = /(?:^|[,\s])bx_mt_reauth=([^;,\s]+)/.exec(r.headers['set-cookie'] ?? '')?.[1];
    if (!proof) return NextResponse.json({ ok: false, error: 'No proof issued', code: 'reauth_failed' }, { status: 500, headers: noStore });
    auditLog('admin.cli.reauth', { userId: a.auth.actor.id, ip: a.auth.ip, method: r.data?.method });
    return NextResponse.json({ ok: true, stepUp: proof, expiresAt: r.data?.expiresAt, method: r.data?.method }, { headers: noStore });
}
