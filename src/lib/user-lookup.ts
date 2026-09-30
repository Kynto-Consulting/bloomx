import { prisma } from '@/lib/prisma';

/**
 * Busca un usuario por correo: primero coincidencia exacta (el unico indice unico existente, no rompe a nadie) y,
 * si no existe, sin distinguir mayusculas (quien escribe Ana@X.com entra como ana@x.com). No crea duplicados.
 */
export async function findUserByEmail(rawEmail: string) {
    const email = String(rawEmail ?? '').trim();
    if (!email) return null;
    const exact = await prisma.user.findUnique({ where: { email } });
    if (exact) return exact;
    return prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
}
