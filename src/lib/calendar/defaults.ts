import { prisma } from '@/lib/prisma';

const DEFAULT_CALENDARS = [
    { name: 'My calendar', source: 'local', color: '#2563eb', isReadOnly: false },
    { name: 'Shared invites', source: 'shared', color: '#f59e0b', isReadOnly: false },
    { name: 'Festivities', source: 'holidays', color: '#6b7280', isReadOnly: true },
] as const;

const listCalendars = (userId: string) => prisma.calendar.findMany({
    where: { userId },
    orderBy: [
        { source: 'asc' },
        { name: 'asc' }
    ]
});

/** Devuelve los calendarios del usuario creando los predeterminados que falten. */
export async function ensureDefaultCalendars(userId: string) {
    // Camino habitual: una sola lectura y ninguna escritura (antes eran 3 upserts en cada GET/reserva).
    const existing = await listCalendars(userId);
    const missing = DEFAULT_CALENDARS.filter(
        (d) => !existing.some((c) => c.source === d.source && c.name === d.name),
    );
    if (missing.length === 0) return existing;

    await Promise.all(missing.map(async (calendar) => {
        try {
            await prisma.calendar.upsert({
                where: {
                    userId_source_name: {
                        userId,
                        source: calendar.source,
                        name: calendar.name,
                    }
                },
                update: {},
                create: {
                    userId,
                    name: calendar.name,
                    source: calendar.source,
                    color: calendar.color,
                    isReadOnly: calendar.isReadOnly,
                }
            });
        } catch (error: any) {
            // Carrera con otra peticion que lo creo primero (P2002): el resultado deseado ya existe.
            if (error?.code !== 'P2002') throw error;
        }
    }));

    return listCalendars(userId);
}
