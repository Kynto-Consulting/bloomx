import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { ensureDefaultCalendars } from '@/lib/calendar/defaults';
import { getGoogleAccessToken } from '@/lib/google/account';

type GoogleCalendarListItem = {
    id: string;
    summary?: string;
    backgroundColor?: string;
    accessRole?: string;
    primary?: boolean;
};

type GoogleEventDate = {
    date?: string;
    dateTime?: string;
};

type GoogleEventItem = {
    id: string;
    summary?: string;
    description?: string;
    location?: string;
    status?: string;
    start?: GoogleEventDate;
    end?: GoogleEventDate;
    organizer?: { email?: string; displayName?: string };
    attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string; organizer?: boolean }>;
    updated?: string;
};

type GooglePersonItem = {
    names?: Array<{ displayName?: string }>;
    emailAddresses?: Array<{ value?: string }>;
    biographies?: Array<{ value?: string }>;
};

function getGoogleEventDate(date?: GoogleEventDate) {
    if (!date?.date && !date?.dateTime) {
        return null;
    }

    if (date.dateTime) {
        return {
            value: new Date(date.dateTime),
            allDay: false,
        };
    }

    const startOfDay = new Date(`${date.date}T00:00:00.000Z`);
    return {
        value: startOfDay,
        allDay: true,
    };
}

async function fetchGoogleJson<T>(accessToken: string, url: string): Promise<T> {
    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
        cache: 'no-store',
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(data?.error?.message || 'Google API request failed');
    }

    return data as T;
}

export async function POST() {
    const user = await getCurrentUser();
    if (!user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        await ensureDefaultCalendars(user.id);

        const { accessToken } = await getGoogleAccessToken(user.id);

        const calendarList = await fetchGoogleJson<{ items?: GoogleCalendarListItem[] }>(
            accessToken,
            'https://www.googleapis.com/calendar/v3/users/me/calendarList'
        );

        let syncedCalendars = 0;
        let syncedEvents = 0;
        let syncedContacts = 0;

        for (const googleCalendar of calendarList.items || []) {
            const calendarName = (googleCalendar.summary || (googleCalendar.primary ? 'Google Calendar' : 'Untitled Calendar')).trim();
            const calendar = await prisma.calendar.upsert({
                where: {
                    userId_source_name: {
                        userId: user.id,
                        source: 'google',
                        name: calendarName,
                    },
                },
                update: {
                    color: googleCalendar.backgroundColor || '#34a853',
                    isReadOnly: ['reader', 'freeBusyReader'].includes(String(googleCalendar.accessRole || '')),
                    externalId: googleCalendar.id,
                    lastSyncedAt: new Date(),
                },
                create: {
                    userId: user.id,
                    name: calendarName,
                    color: googleCalendar.backgroundColor || '#34a853',
                    source: 'google',
                    isReadOnly: ['reader', 'freeBusyReader'].includes(String(googleCalendar.accessRole || '')),
                    externalId: googleCalendar.id,
                    lastSyncedAt: new Date(),
                },
            });
            syncedCalendars += 1;

            const timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
            const timeMax = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
            const eventsUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(googleCalendar.id)}/events?singleEvents=true&showDeleted=false&maxResults=250&orderBy=startTime&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`;
            const googleEvents = await fetchGoogleJson<{ items?: GoogleEventItem[] }>(accessToken, eventsUrl);

            for (const googleEvent of googleEvents.items || []) {
                const start = getGoogleEventDate(googleEvent.start);
                const end = getGoogleEventDate(googleEvent.end);
                if (!start?.value || !end?.value) {
                    continue;
                }

                const existingEvent = await prisma.calendarEvent.findFirst({
                    where: {
                        userId: user.id,
                        calendarId: calendar.id,
                        externalId: googleEvent.id,
                    },
                    select: { id: true },
                });

                const attendees = (googleEvent.attendees || [])
                    .filter((attendee) => attendee.email)
                    .map((attendee) => ({
                        email: String(attendee.email).toLowerCase(),
                        name: attendee.displayName || attendee.email || null,
                        responseStatus: attendee.responseStatus || null,
                        isOrganizer: Boolean(attendee.organizer),
                    }));

                const eventData = {
                    title: googleEvent.summary || 'Untitled event',
                    description: googleEvent.description || null,
                    location: googleEvent.location || null,
                    startsAt: start.value,
                    endsAt: end.value,
                    allDay: start.allDay,
                    status: googleEvent.status || 'confirmed',
                    source: 'google',
                    externalId: googleEvent.id,
                    organizerEmail: googleEvent.organizer?.email || null,
                    organizerName: googleEvent.organizer?.displayName || googleEvent.organizer?.email || null,
                    lastSyncedAt: googleEvent.updated ? new Date(googleEvent.updated) : new Date(),
                };

                if (existingEvent) {
                    await prisma.calendarEvent.update({
                        where: { id: existingEvent.id },
                        data: {
                            ...eventData,
                            attendees: {
                                deleteMany: {},
                                create: attendees,
                            },
                        },
                    });
                } else {
                    await prisma.calendarEvent.create({
                        data: {
                            userId: user.id,
                            calendarId: calendar.id,
                            ...eventData,
                            attendees: {
                                create: attendees,
                            },
                        },
                    });
                }

                syncedEvents += 1;
            }
        }

        const peopleResponse = await fetchGoogleJson<{ connections?: GooglePersonItem[] }>(
            accessToken,
            'https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses,biographies&pageSize=200'
        );

        for (const person of peopleResponse.connections || []) {
            const primaryEmail = person.emailAddresses?.find((item) => item.value)?.value?.trim().toLowerCase();
            if (!primaryEmail) {
                continue;
            }

            await prisma.contact.upsert({
                where: {
                    userId_email: {
                        userId: user.id,
                        email: primaryEmail,
                    },
                },
                update: {
                    name: person.names?.[0]?.displayName || primaryEmail,
                    notes: person.biographies?.[0]?.value || null,
                    source: 'google',
                },
                create: {
                    userId: user.id,
                    email: primaryEmail,
                    name: person.names?.[0]?.displayName || primaryEmail,
                    notes: person.biographies?.[0]?.value || null,
                    source: 'google',
                },
            });

            syncedContacts += 1;
        }

        return NextResponse.json({
            success: true,
            syncedCalendars,
            syncedEvents,
            syncedContacts,
            syncedAt: new Date().toISOString(),
        });
    } catch (error: any) {
        console.error('Google sync failed:', error);
        const message = error?.message || 'Failed to sync Google data';
        const status = /not linked|reconnected/i.test(message) ? 409 : 500;
        return NextResponse.json({ error: message }, { status });
    }
}