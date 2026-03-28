import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
// import { ensureCoreExpansions, expansionRegistry } from '@/lib/expansions/server';
import { prisma } from '@/lib/prisma';
import { sendPushNotification } from '@/lib/notifications/web-push';
import { decryptObject, encryptObject } from '@/lib/encryption';

const FULL_CRON_INTERVAL_MS = 60 * 60 * 1000;
const EVENT_REMINDER_INTERVAL_MS = 5 * 60 * 1000;
const EVENT_LOOKAHEAD_MINUTES = 15;
const MAX_TRACKED_EVENT_REMINDERS = 200;

async function runEventReminders(userId: string, settings: any, now: Date) {
    if (settings?.calendarNotificationsEnabled === false) {
        return { sent: 0, skipped: true };
    }

    const lastReminderRun = settings?.lastEventReminderRun ? new Date(settings.lastEventReminderRun) : new Date(0);
    if (now.getTime() - lastReminderRun.getTime() < EVENT_REMINDER_INTERVAL_MS) {
        return { sent: 0, skipped: true };
    }

    const lookAhead = new Date(now.getTime() + EVENT_LOOKAHEAD_MINUTES * 60 * 1000);
    const reminderLog = typeof settings?.eventReminderLog === 'object' && settings.eventReminderLog
        ? settings.eventReminderLog
        : {};

    const upcomingEvents = await prisma.calendarEvent.findMany({
        where: {
            userId,
            startsAt: {
                gte: now,
                lte: lookAhead,
            },
            status: {
                not: 'cancelled',
            },
        },
        select: {
            id: true,
            title: true,
            location: true,
            startsAt: true,
        },
        orderBy: {
            startsAt: 'asc',
        },
    });

    let sent = 0;

    for (const event of upcomingEvents) {
        const existingReminder = reminderLog[event.id];
        if (existingReminder === event.startsAt.toISOString()) {
            continue;
        }

        const minutesUntilStart = Math.max(1, Math.round((event.startsAt.getTime() - now.getTime()) / 60000));
        const locationSuffix = event.location ? ` at ${event.location}` : '';

        await sendPushNotification(userId, {
            title: event.title,
            body: `Starts in ${minutesUntilStart} min${minutesUntilStart === 1 ? '' : 's'}${locationSuffix}`,
            url: '/calendar',
            tag: `calendar-event-${event.id}`,
        });

        reminderLog[event.id] = event.startsAt.toISOString();
        sent += 1;
    }

    const trimmedReminderLog = Object.fromEntries(
        Object.entries(reminderLog)
            .sort(([, leftValue], [, rightValue]) => new Date(rightValue as string).getTime() - new Date(leftValue as string).getTime())
            .slice(0, MAX_TRACKED_EVENT_REMINDERS)
    );

    return {
        sent,
        skipped: false,
        nextSettings: {
            ...settings,
            eventReminderLog: trimmedReminderLog,
            lastEventReminderRun: now.toISOString(),
        },
    };
}

export async function POST(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Check Rate Limiting / Debounce via User Settings
    const dbUser = await prisma.user.findUnique({
        where: { email: user.email },
        select: { id: true, expansionSettings: true }
    });

    if (!dbUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const settings: any = decryptObject(dbUser.expansionSettings || {});
    const lastRun = settings.lastCronRun ? new Date(settings.lastCronRun) : new Date(0);
    const now = new Date();

    const reminderResult = await runEventReminders(dbUser.id, settings, now);

    if (now.getTime() - lastRun.getTime() < FULL_CRON_INTERVAL_MS) {
        if (!reminderResult.nextSettings) {
            return NextResponse.json({ skipped: true, reason: 'Too soon', reminders: reminderResult });
        }

        await prisma.user.update({
            where: { id: user.id },
            data: {
                expansionSettings: encryptObject(reminderResult.nextSettings),
            }
        });

        return NextResponse.json({ success: true, skipped: true, reason: 'Too soon', reminders: reminderResult });
    }

    // 2. Execute Crons

    // 2. Execute Crons
    // Local expansions removed.
    console.log(`[Cron] Local expansions removed. Updates via backend.`);

    // Placeholder results
    // const results = [];

    // 3. Update Last Run
    await prisma.user.update({
        where: { id: user.id },
        data: {
            expansionSettings: encryptObject({
                ...(reminderResult.nextSettings || settings),
                lastCronRun: now.toISOString()
            })
        }
    });

    return NextResponse.json({ success: true, results: [], reminders: reminderResult });
}
