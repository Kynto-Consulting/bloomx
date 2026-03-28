import { prisma } from '@/lib/prisma';

const DEFAULT_CALENDARS = [
    { name: 'My calendar', source: 'local', color: '#2563eb', isReadOnly: false },
    { name: 'Shared invites', source: 'shared', color: '#f59e0b', isReadOnly: false },
    { name: 'Festivities', source: 'holidays', color: '#6b7280', isReadOnly: true },
] as const;

export async function ensureDefaultCalendars(userId: string) {
    await Promise.all(DEFAULT_CALENDARS.map((calendar) =>
        prisma.calendar.upsert({
            where: {
                userId_source_name: {
                    userId,
                    source: calendar.source,
                    name: calendar.name,
                }
            },
            update: {
                color: calendar.color,
                isReadOnly: calendar.isReadOnly,
            },
            create: {
                userId,
                name: calendar.name,
                source: calendar.source,
                color: calendar.color,
                isReadOnly: calendar.isReadOnly,
            }
        })
    ));

    return prisma.calendar.findMany({
        where: { userId },
        orderBy: [
            { source: 'asc' },
            { name: 'asc' }
        ]
    });
}