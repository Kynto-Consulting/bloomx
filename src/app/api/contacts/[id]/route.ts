import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { parseContactInput } from '@/lib/contacts';
import { buildContactDeletedContext, buildContactSavedContext, fireLifecycleHook } from '@/lib/expansions/server-hooks';

// GET /api/contacts/[id] — un contacto propio.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    if (!user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;

    const contact = await prisma.contact.findFirst({ where: { id, userId: user.id } });
    if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    return NextResponse.json(contact);
}

// PUT /api/contacts/[id] — edita nombre, correo y/o notas. Solo contactos del usuario.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    if (!user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;

    const parsed = parseContactInput(await req.json().catch(() => null), { partial: true });
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const existing = await prisma.contact.findFirst({ where: { id, userId: user.id }, select: { id: true, email: true } });
    if (!existing) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

    if (parsed.value.email && parsed.value.email !== existing.email) {
        const clash = await prisma.contact.findUnique({
            where: { userId_email: { userId: user.id, email: parsed.value.email } },
            select: { id: true },
        });
        if (clash) {
            return NextResponse.json({ error: 'A contact with this email already exists' }, { status: 409 });
        }
    }

    try {
        const contact = await prisma.contact.update({
            where: { id: existing.id },
            data: {
                ...(parsed.value.email !== undefined ? { email: parsed.value.email } : {}),
                ...(parsed.value.name !== undefined ? { name: parsed.value.name } : {}),
                ...(parsed.value.notes !== undefined ? { notes: parsed.value.notes } : {}),
                // Una edicion manual hace que el contacto deje de sobrescribirse en la sincronizacion de Google.
                source: 'local',
            },
        });
        fireLifecycleHook('CONTACT_SAVED', user.id, buildContactSavedContext({ contactId: contact.id, email: contact.email, created: false, source: contact.source }));
        return NextResponse.json(contact);
    } catch (error: any) {
        if (error?.code === 'P2002') {
            return NextResponse.json({ error: 'A contact with this email already exists' }, { status: 409 });
        }
        throw error;
    }
}

// DELETE /api/contacts/[id] — elimina un contacto propio (idempotente: 200 aunque ya no exista).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    if (!user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;

    const result = await prisma.contact.deleteMany({ where: { id, userId: user.id } });
    if (result.count > 0) fireLifecycleHook('CONTACT_DELETED', user.id, buildContactDeletedContext({ contactId: id }));
    return NextResponse.json({ success: true, deleted: result.count });
}
