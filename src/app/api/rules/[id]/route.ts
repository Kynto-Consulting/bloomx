import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteRule, isMissingRelation, updateRule } from '@/lib/rules/store';
import { forwardActionsAllowed, ownsActionLabels, parseRuleBody } from '@/lib/rules/api-helpers';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;

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
        const rule = await updateRule(user.id, id, parsed.value);
        if (!rule) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
        return NextResponse.json(rule);
    } catch (e) {
        if (isMissingRelation(e)) return NextResponse.json({ error: 'Rules not available' }, { status: 503 });
        console.error('Failed to update rule:', (e as any)?.message);
        return NextResponse.json({ error: 'Failed to update rule' }, { status: 500 });
    }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    try {
        const ok = await deleteRule(user.id, id);
        if (!ok) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
        return NextResponse.json({ success: true });
    } catch (e) {
        if (isMissingRelation(e)) return NextResponse.json({ error: 'Rules not available' }, { status: 503 });
        console.error('Failed to delete rule:', (e as any)?.message);
        return NextResponse.json({ error: 'Failed to delete rule' }, { status: 500 });
    }
}
