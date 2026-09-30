import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { forwardActionsAllowed, ownsActionLabels, parseRuleBody } from '@/lib/rules/api-helpers';
import { MAX_RULES_PER_USER, insertRule, isMissingRelation, loadRules, migrateLegacyLabelRules } from '@/lib/rules/store';

export async function GET(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // Migracion perezosa de alias/regex de etiquetas a reglas (idempotente).
    await migrateLegacyLabelRules(user.id).catch(() => 0);
    const labelParam = req.nextUrl?.searchParams?.get('labelId');
    const rules = await loadRules(user.id, false, labelParam ? { labelId: labelParam } : {});
    return NextResponse.json(rules);
}

export async function POST(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: any;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

    const parsed = parseRuleBody(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    try {
        if (!(await ownsActionLabels(user.id, parsed.value.actions, parsed.value.labelId))) {
            return NextResponse.json({ error: 'Etiqueta no encontrada' }, { status: 400 });
        }
        const fwd = await forwardActionsAllowed(user.id, parsed.value.actions);
        if (!fwd.ok) return NextResponse.json({ error: fwd.error }, { status: 400 });
        const existing = await loadRules(user.id);
        if (existing.length >= MAX_RULES_PER_USER) {
            return NextResponse.json({ error: 'Limite de reglas alcanzado' }, { status: 400 });
        }
        const rule = await insertRule(user.id, parsed.value);
        return NextResponse.json(rule);
    } catch (e) {
        if (isMissingRelation(e)) {
            return NextResponse.json({ error: 'Las reglas aun no estan disponibles (base de datos sin migrar)' }, { status: 503 });
        }
        console.error('Failed to create rule:', (e as any)?.message);
        return NextResponse.json({ error: 'Failed to create rule' }, { status: 500 });
    }
}
