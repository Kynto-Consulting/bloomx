import { prisma } from '@/lib/prisma';

/**
 * Devuelve los userId cuyos buzones puede leer/modificar el usuario de la sesion:
 * el propio y los buzones vinculados (misma logica que el selector de cuenta en GET /api/emails).
 * Se usa para evitar IDOR en rutas /api/emails/[id]/*.
 *
 * Controles: CIS v8 3.3 (control de acceso a datos), ISO 27002:2022 5.15 / 8.3.
 */
export async function getAccessibleMailboxUserIds(sessionUserId: string): Promise<string[]> {
    const user = await prisma.user.findUnique({
        where: { id: sessionUserId },
        select: {
            id: true,
            email: true,
            accounts: { select: { providerAccountId: true } },
        },
    });

    if (!user) return [];

    const addresses = new Set<string>([
        user.email.toLowerCase(),
        ...user.accounts
            .map((a) => String(a.providerAccountId || '').trim().toLowerCase())
            .filter((e) => e.includes('@')),
    ]);

    const ids = new Set<string>([user.id]);

    if (addresses.size > 1) {
        const list = Array.from(addresses);
        const linked = await prisma.user.findMany({
            where: {
                OR: [
                    { email: { in: list } },
                    { accounts: { some: { providerAccountId: { in: list } } } },
                ],
            },
            select: { id: true },
        });
        linked.forEach((u) => ids.add(u.id));
    }

    return Array.from(ids);
}

/** True si el correo `emailId` pertenece a alguno de los buzones accesibles. */
export async function canAccessEmail(sessionUserId: string, emailUserId: string): Promise<boolean> {
    if (emailUserId === sessionUserId) return true;
    const ids = await getAccessibleMailboxUserIds(sessionUserId);
    return ids.includes(emailUserId);
}
