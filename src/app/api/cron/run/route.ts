import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
// import { ensureCoreExpansions, expansionRegistry } from '@/lib/expansions/server';
import { prisma } from '@/lib/prisma';
import { sendPushNotification } from '@/lib/notifications/web-push';
import { decryptObject, encryptObject } from '@/lib/encryption';
import { createHash, timingSafeEqual } from 'crypto';
import { isMissingRelation, loadRules, migrateLegacyLabelRules } from '@/lib/rules/store';
import { applyRulesToEmailIds } from '@/lib/rules/apply';
import { backfillThreadHeaders, usersWithPendingThreads } from '@/lib/thread-backfill';

const THREAD_BACKFILL_BATCH = 40;

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

const RULE_CATCHUP_WINDOW_DAYS = 2;
const RULE_CATCHUP_BATCH = 200;
const MAX_USERS_PER_RUN = 50;

function sha(v: string) {
    return createHash('sha256').update(v).digest();
}

/** null = sin cabecera Bearer; true/false = valida o no contra CRON_SECRET. */
function checkCronSecret(req: NextRequest): boolean | null {
    const header = req.headers.get('authorization') || '';
    if (!header.startsWith('Bearer ')) return null;
    const secret = process.env.CRON_SECRET;
    if (!secret) return false; // sin secreto configurado no existe modo global
    return timingSafeEqual(sha(header.slice(7).trim()), sha(secret));
}

/**
 * Reglas "de recuperacion": aplica las reglas activas a correos recientes de la bandeja que
 * aun no fueron procesados (tabla RuleRun). Idempotente: cada correo se procesa una sola vez.
 * Tolera que las tablas Rule/RuleRun no existan todavia.
 */
async function runRuleCatchUp(userId: string) {
    try {
        await migrateLegacyLabelRules(userId).catch(() => 0);
        const rules = await loadRules(userId, true);
        if (rules.length === 0) return { processed: 0, changed: 0 };

        const since = new Date(Date.now() - RULE_CATCHUP_WINDOW_DAYS * 24 * 60 * 60 * 1000);
        const pending: Array<{ id: string }> = await prisma.$queryRaw`
            SELECT e."id" FROM "Email" e
            LEFT JOIN "RuleRun" r ON r."emailId" = e."id"
            WHERE e."userId" = ${userId} AND e."folder" = 'inbox' AND e."createdAt" > ${since} AND r."emailId" IS NULL
            ORDER BY e."createdAt" DESC LIMIT ${RULE_CATCHUP_BATCH}`;
        if (pending.length === 0) return { processed: 0, changed: 0 };

        return await applyRulesToEmailIds(userId, rules, pending.map((p) => p.id));
    } catch (e) {
        if (!isMissingRelation(e)) console.error('[Cron] rule catch-up failed:', (e as any)?.message);
        return { processed: 0, changed: 0, error: true };
    }
}

async function runForUser(userId: string, rawSettings: any, now: Date) {
    const settings: any = decryptObject(rawSettings || {});
    const reminders = await runEventReminders(userId, settings, now);
    const rules = await runRuleCatchUp(userId);
    // Relleno perezoso de las cabeceras de hilo de correos antiguos (lote pequeno por ejecucion; tolera columnas ausentes)
    const threads = await backfillThreadHeaders(userId, THREAD_BACKFILL_BATCH).catch(() => null);

    const lastRun = settings.lastCronRun ? new Date(settings.lastCronRun) : new Date(0);
    const fullDue = now.getTime() - lastRun.getTime() >= FULL_CRON_INTERVAL_MS;

    if (reminders.nextSettings || fullDue) {
        await prisma.user.update({
            where: { id: userId },
            data: {
                expansionSettings: encryptObject({
                    ...(reminders.nextSettings || settings),
                    ...(fullDue ? { lastCronRun: now.toISOString() } : {}),
                }),
            },
        });
    }
    return { reminders, rules, threads, fullRun: fullDue };
}

async function runGlobal(now: Date) {
    // Usuarios con reglas activas o eventos proximos (tolerante a tablas ausentes).
    const ids = new Set<string>();
    try {
        const rows: Array<{ userId: string }> = await prisma.$queryRaw`SELECT DISTINCT "userId" FROM "Rule" WHERE "enabled" = TRUE LIMIT ${MAX_USERS_PER_RUN}`;
        rows.forEach((r) => ids.add(r.userId));
    } catch (e) {
        if (!isMissingRelation(e)) console.error('[Cron] list rule users failed:', (e as any)?.message);
    }
    try {
        (await usersWithPendingThreads(MAX_USERS_PER_RUN)).forEach((id) => ids.add(id));
    } catch (e) {
        console.error('[Cron] list thread backfill users failed:', (e as any)?.message);
    }
    try {
        const events = await prisma.calendarEvent.findMany({
            where: {
                startsAt: { gte: now, lte: new Date(now.getTime() + EVENT_LOOKAHEAD_MINUTES * 60 * 1000) },
                status: { not: 'cancelled' },
            },
            select: { userId: true },
            distinct: ['userId'],
            take: MAX_USERS_PER_RUN,
        });
        events.forEach((e) => ids.add(e.userId));
    } catch (e) {
        console.error('[Cron] list reminder users failed:', (e as any)?.message);
    }

    const users = await prisma.user.findMany({
        where: { id: { in: Array.from(ids).slice(0, MAX_USERS_PER_RUN) } },
        select: { id: true, expansionSettings: true },
    });
    const results: Record<string, unknown> = {};
    for (const u of users) {
        try {
            results[u.id] = await runForUser(u.id, u.expansionSettings, now);
        } catch (e) {
            console.error('[Cron] user run failed:', (e as any)?.message);
            results[u.id] = { error: true };
        }
    }
    return { users: users.length, results };
}

/**
 * Modos:
 *  - Bearer CRON_SECRET (Vercel Cron envia GET con este header): ejecuta para todos los usuarios afectados.
 *  - Sesion (CronTrigger del navegador): ejecuta solo para el usuario autenticado.
 *  - Bearer invalido, o sin sesion: 401.
 * Idempotente: recordatorios con registro por evento, reglas con RuleRun, y debounce por usuario.
 */
async function handle(req: NextRequest, allowSession: boolean) {
    const now = new Date();
    const secretOk = checkCronSecret(req);
    if (secretOk === true) {
        return NextResponse.json({ success: true, mode: 'global', ...(await runGlobal(now)) });
    }
    if (secretOk === false) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!allowSession) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await getCurrentUser();
    if (!user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const dbUser = await prisma.user.findUnique({
        where: { email: user.email },
        select: { id: true, expansionSettings: true },
    });
    if (!dbUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const result = await runForUser(dbUser.id, dbUser.expansionSettings, now);
    return NextResponse.json({ success: true, mode: 'user', results: [], ...result });
}

export async function POST(req: NextRequest) {
    return handle(req, true);
}

// Vercel Cron invoca con GET: solo se acepta con Bearer CRON_SECRET.
export async function GET(req: NextRequest) {
    return handle(req, false);
}
