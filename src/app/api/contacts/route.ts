import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';

export async function GET() {
    const user = await getCurrentUser();
    if (!user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const contacts = await prisma.contact.findMany({
        where: { userId: user.id },
        orderBy: [
            { name: 'asc' },
            { email: 'asc' }
        ]
    });

    return NextResponse.json(contacts);
}

export async function POST(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const email = String(body?.email || '').trim().toLowerCase();
    const name = String(body?.name || '').trim() || null;
    const notes = String(body?.notes || '').trim() || null;

    if (!email || !email.includes('@')) {
        return NextResponse.json({ error: 'Valid contact email is required' }, { status: 400 });
    }

    const contact = await prisma.contact.upsert({
        where: {
            userId_email: {
                userId: user.id,
                email,
            }
        },
        update: {
            name,
            notes,
        },
        create: {
            userId: user.id,
            email,
            name,
            notes,
            source: 'local',
        }
    });

    return NextResponse.json(contact, { status: 201 });
}