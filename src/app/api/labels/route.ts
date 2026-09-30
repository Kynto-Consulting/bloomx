import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from "@/lib/session";
import { validateLabelInput } from '@/lib/rules/label-validation';

const MAX_LABELS_PER_USER = 500;

export async function GET() {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const labels = await prisma.label.findMany({
        where: { userId: user.id },
        orderBy: { name: 'asc' }
    });

    return NextResponse.json(labels);
}

export async function POST(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: any;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const parsed = validateLabelInput(body, false);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { name, color, aliasSuffix, filterRegex } = parsed.data;

    try {
        const total = await prisma.label.count({ where: { userId: user.id } });
        if (total >= MAX_LABELS_PER_USER) {
            return NextResponse.json({ error: 'Label limit reached' }, { status: 400 });
        }

        if (aliasSuffix) {
            const clash = await prisma.label.findFirst({ where: { userId: user.id, aliasSuffix }, select: { id: true } });
            if (clash) return NextResponse.json({ error: 'Alias already in use' }, { status: 409 });
        }

        const label = await prisma.label.create({
            data: {
                name: name!,
                color: color || '#6366f1',
                aliasSuffix: aliasSuffix ?? null,
                filterRegex: filterRegex ?? null,
                userId: user.id,
            }
        });

        return NextResponse.json(label);
    } catch (error: any) {
        if (error?.code === 'P2002') {
            return NextResponse.json({ error: 'A label with that name already exists' }, { status: 409 });
        }
        console.error('Failed to create label:', error?.message);
        return NextResponse.json({ error: 'Failed to create label' }, { status: 500 });
    }
}
