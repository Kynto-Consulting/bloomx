import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { validateLabelInput } from '@/lib/rules/label-validation';
import { deleteLabel, getLabel, planDelete, updateLabel } from '@/lib/labels/store';
import { pullExistingIntoFolder, releaseFolderEmails } from '@/lib/labels/behavior';
import { labelErrorResponse } from '@/lib/labels/http';

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
        const before = await getLabel(user.id, id);
        if (!before) return NextResponse.json({ error: 'Label not found' }, { status: 404 });

        // Cambio de comportamiento: "folder" -> "tag" devuelve a Entrada los correos que solo estaban ahi;
        // "tag" -> "folder" con moveExisting mueve los correos de Entrada con la etiqueta.
        let released = 0;
        let pulled = 0;
        if (data.behavior && data.behavior !== before.behavior && before.behavior === 'folder') {
            released = await releaseFolderEmails(user.id, [id]);
        }
        const label = await updateLabel(user.id, id, data);
        if (data.behavior === 'folder' && before.behavior !== 'folder' && body?.moveExisting === true) {
            pulled = await pullExistingIntoFolder(user.id, id);
        }
        const { userId: _u, ...out } = label;
        return NextResponse.json({ ...out, ...(released ? { released } : {}), ...(pulled ? { moved: pulled } : {}) });
    } catch (error: any) {
        const r = labelErrorResponse(error);
        if (r) return r;
        console.error('Failed to update label:', error?.message);
        return NextResponse.json({ error: 'Failed to update label' }, { status: 500 });
    }
}

/**
 * Borra una etiqueta. ?children=reparent (por defecto: las subetiquetas suben un nivel) | delete (todo el subarbol).
 * Los correos NUNCA se borran: los que estaban fuera de Entrada solo por una etiqueta-carpeta que desaparece vuelven a Entrada.
 */
export async function DELETE(req: NextRequest, { params }: Ctx) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const mode = req.nextUrl?.searchParams?.get('children') === 'delete' ? 'delete' : 'reparent';

    try {
        const plan = await planDelete(user.id, id, { children: mode });
        if (!plan) return NextResponse.json({ error: 'Label not found' }, { status: 404 });
        const released = await releaseFolderEmails(user.id, plan.deleteIds);
        const result = await deleteLabel(user.id, id, { children: mode });
        return NextResponse.json({ success: true, deleted: result.deleted, reparented: result.reparented, released });
    } catch (error: any) {
        const r = labelErrorResponse(error);
        if (r) return r;
        console.error('Failed to delete label:', error?.message);
        return NextResponse.json({ error: 'Failed to delete label' }, { status: 500 });
    }
}
