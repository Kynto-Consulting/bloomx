import { NextRequest, NextResponse } from 'next/server';
import { authenticateCli, noStore } from '@/lib/admin-cli/auth';
import { completeLine } from '@/lib/admin-cli/complete';
import { rateLimitAsync } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/cli/complete?line=...&locale=es|en -> { prefix, candidates: [{ value, hint?, kind }] }. Solo lectura. */
export async function GET(req: NextRequest) {
    const a = await authenticateCli(req);
    if (!a.ok) return a.response;
    const sp = new URL(req.url).searchParams;
    const line = sp.get('line') ?? '';
    if (line.length > 8192) return NextResponse.json({ error: 'line too long', code: 'line_too_long' }, { status: 400, headers: noStore });
    const rl = await rateLimitAsync(`admin:cli:complete:${a.auth.actor.id || a.auth.actor.email || a.auth.ip}`, 240, 60_000);
    if (!rl.ok) return NextResponse.json({ error: 'Too many requests', code: 'rate_limited' }, { status: 429, headers: { ...noStore, 'Retry-After': String(rl.retryAfter) } });
    return NextResponse.json(await completeLine(line, a.auth, sp.get('locale') === 'en' ? 'en' : 'es'), { headers: noStore });
}
