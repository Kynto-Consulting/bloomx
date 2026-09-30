import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { parseContactInput, parseContactPagination } from '@/lib/contacts';
import { buildContactSavedContext, fireLifecycleHook } from '@/lib/expansions/server-hooks';

/**
 * GET /api/contacts?limit=&offset=&q=
 * Devuelve un arreglo (compatible con el cliente actual). El total y si hay mas se informan por cabecera:
 * X-Total-Count y X-Has-More. `q` filtra en servidor por nombre o correo.
 */
export async function GET(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { limit, offset, q } = parseContactPagination(req.nextUrl.searchParams);
    const where = {
        userId: user.id,
        ...(q ? {
            OR: [
                { name: { contains: q, mode: 'insensitive' as const } },
                { email: { contains: q, mode: 'insensitive' as const } },
            ],
        } : {}),
    };

    const [contacts, total] = await Promise.all([
        prisma.contact.findMany({
            where,
            // (name, email) es determinista porque (userId, email) es unico: la paginacion por offset es estable.
            orderBy: [
                { name: 'asc' },
                { email: 'asc' }
            ],
            skip: offset,
            take: limit,
        }),
        prisma.contact.count({ where }),
    ]);

    return NextResponse.json(contacts, {
        headers: {
            'X-Total-Count': String(total),
            'X-Has-More': String(offset + contacts.length < total),
        },
    });
}

export async function POST(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const parsed = parseContactInput(body);
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { email, name, notes } = parsed.value as { email: string; name: string | null; notes: string | null };

    // Crear NO es un upsert: si el correo ya existe (unico por usuario) se responde 409 con el contacto existente
    // para que la UI ofrezca "editar el existente" en vez de pisar sus datos en silencio. Editar es PUT /api/contacts/[id].
    const findExisting = () => prisma.contact.findUnique({ where: { userId_email: { userId: user.id, email } } });
    const conflict = (existing: unknown) => NextResponse.json(
        { error: 'A contact with this email already exists', code: 'CONTACT_EXISTS', existing },
        { status: 409 },
    );

    const existing = await findExisting();
    if (existing) return conflict(existing);

    try {
        const contact = await prisma.contact.create({
            data: { userId: user.id, email, name, notes, source: 'local' },
        });
        fireLifecycleHook('CONTACT_SAVED', user.id, buildContactSavedContext({ contactId: contact.id, email: contact.email, created: true, source: contact.source }));
        return NextResponse.json(contact, { status: 201 });
    } catch (error: any) {
        // Carrera: otra peticion lo creo entre la comprobacion y el INSERT (violacion de unicidad).
        if (error?.code === 'P2002') {
            const raced = await findExisting();
            if (raced) return conflict(raced);
        }
        throw error;
    }
}
