import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/session';
import { validateLabelInput } from '@/lib/rules/label-validation';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;

    let body: any;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const parsed = validateLabelInput(body, true);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const data = parsed.data;
    if (Object.keys(data).length === 0) {
        return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    try {
        const existing = await prisma.label.findFirst({ where: { id, userId: user.id }, select: { id: true } });
        if (!existing) return NextResponse.json({ error: 'Label not found' }, { status: 404 });

        if (data.aliasSuffix) {
            const clash = await prisma.label.findFirst({
                where: { userId: user.id, aliasSuffix: data.aliasSuffix, NOT: { id } },
                select: { id: true },
            });
            if (clash) return NextResponse.json({ error: 'Alias already in use' }, { status: 409 });
        }

        // updateMany con userId: defensa en profundidad frente a carreras / IDOR.
        const result = await prisma.label.updateMany({ where: { id, userId: user.id }, data });
        if (result.count === 0) return NextResponse.json({ error: 'Label not found' }, { status: 404 });

        const label = await prisma.label.findFirst({ where: { id, userId: user.id } });
        return NextResponse.json(label);
    } catch (error: any) {
        if (error?.code === 'P2002') {
            return NextResponse.json({ error: 'A label with that name already exists' }, { status: 409 });
        }
        console.error('Failed to update label:', error?.message);
        return NextResponse.json({ error: 'Failed to update label' }, { status: 500 });
    }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;

    try {
        // Las filas de la relacion _EmailToLabel caen por ON DELETE CASCADE.
        const result = await prisma.label.deleteMany({ where: { id, userId: user.id } });
        if (result.count === 0) return NextResponse.json({ error: 'Label not found' }, { status: 404 });
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Failed to delete label:', error?.message);
        return NextResponse.json({ error: 'Failed to delete label' }, { status: 500 });
    }
}
