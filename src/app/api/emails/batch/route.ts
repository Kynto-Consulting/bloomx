import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from "@/lib/session";
import { prisma } from '@/lib/prisma';
import { getAccessibleMailboxUserIds } from '@/lib/mailbox-access';
import {
    parseBatchIds,
    parseBatchScope,
    parseEmailBatchUpdates,
    parseRestoreFallbacks,
} from '@/lib/batch-validation';
import { moveEmailsTracked, ownAddressesOf, resolveMailboxScope, restoreEmailsToPrevious, selectScopeIds, updateScope } from '@/lib/mail-store';
import { emptyScope } from '@/lib/mail-list-sql';
import type { BatchScope } from '@/lib/batch-validation';

/** Ambito de un alcance: buzones validados contra los accesibles por la sesion (nunca ajenos) + direcciones propias. */
async function resolveScope(sessionUserId: string, scope: BatchScope): Promise<
    | { ok: true; mailboxScope: ReturnType<typeof emptyScope>; own: string[] }
    | { ok: false; status: number; error: string }
> {
    let userIds = [sessionUserId];
    if (scope.mailboxes) {
        const resolved = await resolveMailboxScope(sessionUserId, scope.mailboxes);
        if (!resolved.ok) return resolved;
        userIds = resolved.userIds;
    }
    const owners = await prisma.user.findMany({ where: { id: { in: Array.from(new Set([...userIds, sessionUserId])) } }, select: { email: true, accounts: { select: { providerAccountId: true } } } });
    return { ok: true, mailboxScope: emptyScope(userIds, scope.folder), own: Array.from(new Set(owners.flatMap((u) => ownAddressesOf(u)))) };
}

const RESTORE_CHUNK = 1000;
const DELETE_CHUNK = 500;

/** Carpetas en las que una eliminacion definitiva por alcance esta permitida (nunca bandeja, enviados, archivo...). */
const SCOPE_DELETE_FOLDERS = ['trash', 'spam'];

/** Aplica `updates` a los ids (ya comprobada la propiedad por `userIds`). */
async function applyUpdates(ids: string[], userIds: string[], updates: NonNullable<ReturnType<typeof parseEmailBatchUpdates>>, fallbacks: Record<string, string>) {
    if (updates.restore) {
        const r = await restoreEmailsToPrevious(ids, userIds, fallbacks);
        return { count: r.count, targets: r.targets };
    }
    if (updates.folder) {
        // Carpeta (+ leido/destacado) en una sentencia; fija tambien previousFolder (origen para "Restaurar").
        const count = await moveEmailsTracked({ ids, userIds, folder: updates.folder, read: updates.read, starred: updates.starred });
        return { count };
    }
    const data: { read?: boolean; starred?: boolean } = {};
    if (updates.read !== undefined) data.read = updates.read;
    if (updates.starred !== undefined) data.starred = updates.starred;
    const result = await prisma.email.updateMany({ where: { id: { in: ids }, userId: { in: userIds } }, data });
    return { count: result.count };
}

export async function PATCH(req: NextRequest) {
    try {
        const user = await getCurrentUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json().catch(() => null);

        // Lista cerrada de campos y valores (folder solo en las carpetas conocidas; read/starred booleanos).
        const safeUpdates = parseEmailBatchUpdates(body?.updates);
        if (!safeUpdates) {
            return NextResponse.json({ error: 'No valid updates' }, { status: 400 });
        }

        // --- Alcance (carpeta + filtro) resuelto en el servidor: "seleccionar toda la carpeta" sin cargar ids -----------
        if (body && body.scope !== undefined) {
            if (body.ids !== undefined) return NextResponse.json({ error: 'Use ids or scope, not both' }, { status: 400 });
            const scope = parseBatchScope(body.scope);
            if (!scope) return NextResponse.json({ error: 'Invalid scope' }, { status: 400 });
            if (safeUpdates.folder === scope.folder) return NextResponse.json({ count: 0, ids: [], capped: false });

            const ctx = await resolveScope(user.id, scope);
            if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
            let ids: string[];
            let targets: Record<string, string> | undefined;
            if (safeUpdates.restore) {
                // Restaurar necesita la carpeta de origen de cada correo: se resuelve por trozos (sin tope de total).
                const all = await selectScopeIds(ctx.mailboxScope, scope.filter, ctx.own);
                ids = [];
                targets = {};
                for (let i = 0; i < all.length; i += RESTORE_CHUNK) {
                    const r = await restoreEmailsToPrevious(all.slice(i, i + RESTORE_CHUNK), ctx.mailboxScope.userIds, {});
                    Object.assign(targets, r.targets);
                }
                ids = Object.keys(targets);
            } else {
                // Una sola sentencia atomica sobre TODO el alcance (sin tope): UPDATE ... WHERE id IN (subconsulta) RETURNING id.
                ids = await updateScope(ctx.mailboxScope, scope.filter, ctx.own, { folder: safeUpdates.folder, read: safeUpdates.read, starred: safeUpdates.starred });
            }
            return NextResponse.json({ count: ids.length, ids, capped: false, ...(targets ? { targets } : {}) });
        }

        const ids = parseBatchIds(body?.ids);
        if (!ids) {
            return NextResponse.json({ error: 'Invalid IDs' }, { status: 400 });
        }

        const mailboxIds = await getAccessibleMailboxUserIds(user.id);
        const r = await applyUpdates(ids, mailboxIds, safeUpdates, parseRestoreFallbacks(body?.fallbacks, ids));
        return NextResponse.json({ count: r.count, ...(r.targets ? { targets: r.targets } : {}) });
    } catch (error) {
        console.error('Failed to batch update emails:', error);
        return NextResponse.json({ error: 'Failed to update emails' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const user = await getCurrentUser();
        if (!user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json().catch(() => null);

        let ids: string[] | null;
        let userIds: string[];
        if (body && body.scope !== undefined) {
            if (body.ids !== undefined) return NextResponse.json({ error: 'Use ids or scope, not both' }, { status: 400 });
            const scope = parseBatchScope(body.scope);
            if (!scope || !SCOPE_DELETE_FOLDERS.includes(scope.folder)) {
                return NextResponse.json({ error: 'Invalid scope' }, { status: 400 });
            }
            const ctx = await resolveScope(user.id, scope);
            if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
            ids = await selectScopeIds(ctx.mailboxScope, scope.filter, ctx.own);
            userIds = ctx.mailboxScope.userIds;
            if (ids.length === 0) return NextResponse.json({ count: 0, capped: false });
        } else {
            ids = parseBatchIds(body?.ids);
            if (!ids) {
                return NextResponse.json({ error: 'Invalid IDs' }, { status: 400 });
            }
            userIds = await getAccessibleMailboxUserIds(user.id);
        }

        // Borrado completo (DB + storage) respetando objetos compartidos entre correos; por trozos para no cargar todo a la vez.
        const { deleteEmailsCompletely } = await import('@/lib/retention');
        let deleted = 0;
        for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
            const owned = await prisma.email.findMany({ where: { id: { in: ids.slice(i, i + DELETE_CHUNK) }, userId: { in: userIds } }, select: { id: true } });
            const result = await deleteEmailsCompletely(owned.map((e) => e.id));
            deleted += result.deleted;
        }
        return NextResponse.json({ count: deleted });
    } catch (error) {
        console.error('Failed to batch delete emails:', error);
        return NextResponse.json({ error: 'Failed to delete emails' }, { status: 500 });
    }
}
