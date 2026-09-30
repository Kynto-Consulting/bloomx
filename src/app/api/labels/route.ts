import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from "@/lib/session";
import { validateLabelInput } from '@/lib/rules/label-validation';
import { createLabel, ensureLabelPath, listLabels, updateLabel } from '@/lib/labels/store';
import { labelErrorResponse } from '@/lib/labels/http';
import { migrateLegacyLabelRules } from '@/lib/rules/store';
import { splitPath } from '@/lib/labels/model';

export async function GET() {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Migracion perezosa de alias/regex de etiquetas a reglas equivalentes (idempotente, tolerante).
    await migrateLegacyLabelRules(user.id).catch(() => 0);
    const labels = await listLabels(user.id);
    // Orden estable por ruta completa (la interfaz construye el arbol a partir de parentId/sortOrder).
    labels.sort((a, b) => a.fullPath.localeCompare(b.fullPath));
    return NextResponse.json(labels.map(({ userId: _u, ...l }) => l));
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
    const { name, ...rest } = parsed.data;

    try {
        const segs = splitPath(name!);
        // "Trabajo/Proyecto A": crea la jerarquia que falte; las opciones se aplican a la etiqueta final.
        if (segs.length > 1 && !rest.parentId) {
            const { id } = await ensureLabelPath(user.id, name!, { behavior: rest.behavior, color: rest.color });
            const leaf = await updateLabel(user.id, id, {
                ...(rest.color ? { color: rest.color } : {}),
                ...(rest.behavior ? { behavior: rest.behavior } : {}),
                ...(rest.icon !== undefined ? { icon: rest.icon } : {}),
                ...(rest.showInSidebar !== undefined ? { showInSidebar: rest.showInSidebar } : {}),
                ...(rest.showUnread !== undefined ? { showUnread: rest.showUnread } : {}),
            });
            const { userId: _u, ...out } = leaf;
            return NextResponse.json(out);
        }
        const label = await createLabel(user.id, { name: segs[0] ?? name!, ...rest });
        const { userId: _u, ...out } = label;
        return NextResponse.json(out);
    } catch (error: any) {
        const r = labelErrorResponse(error);
        if (r) return r;
        console.error('Failed to create label:', error?.message);
        return NextResponse.json({ error: 'Failed to create label' }, { status: 500 });
    }
}
