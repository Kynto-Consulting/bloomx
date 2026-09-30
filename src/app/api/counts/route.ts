import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/session';
import { getBadges, getScopeCounts, ownAddressesOf, resolveMailboxScope } from '@/lib/mail-store';
import { emptyScope } from '@/lib/mail-list-sql';
import { parseMailboxesParam } from '@/lib/mail-query';

/** Carpeta de la consulta `?folder=`: solo nombres simples (nada de SQL ni rutas); los borradores viven en otra tabla. */
const FOLDER_PARAM = /^[A-Za-z0-9_-]{1,50}$/;

/**
 * GET /api/counts[?folder=<carpeta>][&mailboxes=<ids|all>]
 *
 * UNIDAD = HILO (la interfaz muestra un hilo por fila, agrupando por destinatarios + asunto normalizado; ver lib/mail-list-sql.ts):
 *  - counts.<carpeta>: hilos con algun mensaje sin leer.          messageCounts.<carpeta>: mensajes sin leer.
 *  - totals.<carpeta>: hilos de la carpeta.                       messageTotals.<carpeta>: mensajes.
 *  - labels[].count / total: igual, por etiqueta (sin papelera ni spam, como la vista de etiqueta).
 *  - filters (con ?folder=): hilos con algun mensaje que cumple cada filtro rapido; messageFilters: mensajes.
 * `mailboxes` calcula todo sobre la UNION de esos buzones (solo los accesibles por la sesion; uno ajeno = 403).
 */
export async function GET(req?: NextRequest) {
    const user = await getCurrentUser();
    if (!user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const dbUser = await prisma.user.findUnique({
            where: { email: user.email },
            select: { id: true, email: true, accounts: { select: { providerAccountId: true } } }
        });
        if (!dbUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const params = req?.nextUrl?.searchParams;
        const mailboxesRaw = params?.get('mailboxes') ?? null;
        const requested = mailboxesRaw === null ? null : parseMailboxesParam(mailboxesRaw);
        if (mailboxesRaw !== null && (!requested || requested.length === 0)) {
            return NextResponse.json({ error: 'Invalid mailboxes' }, { status: 400 });
        }
        let userIds = [dbUser.id];
        if (requested) {
            const resolved = await resolveMailboxScope(dbUser.id, requested);
            if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
            userIds = resolved.userIds;
        }

        const owners = userIds.length === 1 && userIds[0] === dbUser.id
            ? [dbUser]
            : await prisma.user.findMany({ where: { id: { in: userIds } }, select: { email: true, accounts: { select: { providerAccountId: true } } } });
        const own = Array.from(new Set(owners.flatMap((u) => ownAddressesOf(u))));

        // Conteos EXACTOS por filtro rapido de la carpeta pedida (?folder=), en hilos y en mensajes, calculados en SQL.
        const folderParam = params?.get('folder') ?? null;
        let filters: Awaited<ReturnType<typeof getScopeCounts>> | undefined;
        if (folderParam && FOLDER_PARAM.test(folderParam) && folderParam !== 'drafts') {
            filters = await getScopeCounts(emptyScope(userIds, folderParam), own);
        }

        const [badges, draftsCount, labels] = await Promise.all([
            getBadges(userIds, true),
            prisma.draft.count({ where: { from: { in: Array.from(new Set(owners.map((u) => u.email))) } } }),
            prisma.label.findMany({ where: { userId: dbUser.id }, select: { id: true, name: true, color: true } }),
        ]);

        const folderOf = (name: string) => badges.folders[name];
        const unread = (name: string) => folderOf(name)?.unreadThreads ?? 0;
        const unreadMessages = (name: string) => folderOf(name)?.unreadMessages ?? 0;
        const total = (name: string) => folderOf(name)?.threads ?? 0;
        const totalMessages = (name: string) => folderOf(name)?.messages ?? 0;
        const NAMES = ['inbox', 'sent', 'archive', 'trash', 'spam', 'scheduled'] as const;

        const labelCounts: Record<string, number> = {};
        const labelList = labels.map((l) => {
            const b = badges.labels[l.name.toLowerCase()];
            labelCounts[l.name.toLowerCase()] = b?.unreadThreads ?? 0;
            return { id: l.id, name: l.name, color: l.color, count: b?.unreadThreads ?? 0, total: b?.threads ?? 0, messageCount: b?.unreadMessages ?? 0, messageTotal: b?.messages ?? 0 };
        });

        return NextResponse.json({
            ...(filters ? { folder: folderParam, filters: filters.threads, messageFilters: filters.messages } : {}),
            unit: 'thread',
            counts: {
                inbox: unread('inbox'),
                drafts: draftsCount,
                sent: unread('sent'),
                trash: unread('trash'),
                spam: unread('spam'),
                archive: unread('archive'),
                scheduled: 0,
            },
            messageCounts: Object.fromEntries(NAMES.map((n) => [n, unreadMessages(n)])),
            // Totales (leidos + no leidos) para mostrar "no leidos / total" en el Sidebar.
            totals: {
                inbox: total('inbox'),
                sent: total('sent'),
                archive: total('archive'),
                trash: total('trash'),
                spam: total('spam'),
                scheduled: total('scheduled'),
                drafts: draftsCount,
            },
            messageTotals: Object.fromEntries(NAMES.map((n) => [n, totalMessages(n)])),
            labels: labelList,
            ...(requested ? { mailboxes: userIds } : {}),
        });

    } catch (error) {
        console.error('Failed to fetch counts:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
