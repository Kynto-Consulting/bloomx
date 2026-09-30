import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { loadRules, setRulesPriorities } from '@/lib/rules/store';

/** Ordena las reglas por prioridad: `order` = ids en el orden deseado (los ids ajenos o desconocidos se ignoran). */
export async function POST(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json().catch(() => null);
    const order: unknown = body?.order;
    if (!Array.isArray(order) || order.length === 0 || order.length > 200 || order.some((x) => typeof x !== 'string')) {
        return NextResponse.json({ error: 'Invalid order' }, { status: 400 });
    }
    const mine = new Set((await loadRules(user.id)).map((r) => r.id));
    const ids = Array.from(new Set(order as string[])).filter((id) => mine.has(id));
    const updated = await setRulesPriorities(user.id, ids);
    return NextResponse.json({ updated });
}
